#!/usr/bin/env python3
"""bet105 line prices on the live Kibl stream (founder ruling 2026-10-25: same path as the Now prices, through Supabase).

The Now worker (now_worker.py) hands every stream row to LineEngine.accept as well as to its own NowEngine. This module
takes ONLY the six line-price markets of line_prices.MARKETS, pre-match, from the entitled book, for Kibl fixtures that
join an api-tennis fixture (line_prices.join_fixtures, the names ruling). Per fixture it keeps the newest current row
and the opener of every slot; a fixture that changed is recomputed whole a COALESCE_S later — line_prices.normalise +
apply_guards, the same four guards as before — so a guard that compares lines (pair coherence, ladder, guard d) always
sees the fixture's full current ladder. Only then is anything written:

  line_price_ticks     a row when a key's price or status changes (append-only; identical re-sends are ignored);
  line_prices_current  an upsert when a key's price, status, implied, open, limit or Kibl insert time changes.

A line Kibl stops offering (an alternate slot that moved to another line) is written once as status 'withdrawn' with no
price, so the page never shows a line that is gone. The first in-play row of a fixture is its Closing point: every key
is written once as 'started', and nothing more for it.

ISOLATION. Every entry point catches its own exceptions and counts them: a fault here never reaches the Now worker's
loop, so the match-winner path cannot be broken by a line-price bug. WRITES ARE OPT-IN, separately from the Now
writes: `KIBL_LINES_WRITE=1` (and `KIBL_NOW_WRITE=1`). Without it every write is computed and counted ('would_*' in
the heartbeat), never sent.
"""
import collections
import json
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import line_prices as LP  # noqa: E402

TABLE_CUR = "line_prices_current"
TABLE_TICK = "line_price_ticks"
LEAGUES = (19, 537, 962)          # ATP, Challenger, ITF Men — what we ask Kibl for (the old pull's leagues)
COALESCE_S = 2.0                  # a fixture's rows arrive as separate participant rows; recompute once they have landed
RETRY_S = 10
MAPPING_EVERY_S = 600             # Kibl fixtures + api-tennis fixtures, re-joined
RESEED_EVERY_S = 1800             # REST state repair on top of the reconnect seed
UNSEEDED_RESEED_S = 120           # sooner when a newly joined fixture waits for its first full ladder
CHUNK = 500
WITHDRAWN = "withdrawn"
CMP = ("price", "status", "implied", "open_price", "max_limit", "inserted_on",
       "close_price", "close_implied", "close_at", "close_src")
CLOSE_FIELDS = ("close_price", "close_implied", "close_at", "close_src")
NUMERIC = ("price", "implied", "open_price", "max_limit", "close_price", "close_implied")
_ERR_LOG_EVERY_S = 60


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(v):
    return LP._num(v)


def row_key(r):
    return (int(r["event_key"]), r["market"], str(r["side"]), _num(r.get("line")), r.get("book") or LP.BOOK)


class LineEngine:
    """The decisions and the in-memory state. I/O is injected (fetch / sb), so tests run offline."""

    def __init__(self, fsid, write=False, log=print):
        self.fsid, self.write, self.log = fsid, bool(write), log
        self.mapping, self.by_ev, self.unmatched = {}, {}, []
        self.rows = collections.defaultdict(dict)   # fixture -> slot -> current row
        self.openers = collections.defaultdict(dict)  # fixture -> slot -> opener row
        self.started = set()                          # fixtures past their Closing point
        self.flip = {}                                # fixture -> when THIS worker saw its first in-play row (seeded)
        self.seeded = set()                           # fixtures a full REST seed has covered (only these are computed)
        self.written = {}                             # row_key -> the row as last written (or read back)
        self.dirty = {}                               # fixture -> monotonic due time
        self.count = collections.Counter()
        self.write_ok = True
        self.mapping_at = self.seed_at = self.written_loaded_at = None
        self.kibl_fixtures = 0
        self._last_err_log = 0.0

    # ── fault isolation ──────────────────────────────────────────────────────
    def _fault(self, where, e):
        self.count["error_" + where] += 1
        t = time.time()
        if t - self._last_err_log >= _ERR_LOG_EVERY_S:
            self._last_err_log = t
            self.log(f"::warning::lines {where} failed ({type(e).__name__}: {str(e)[:160]}) — Now path unaffected")

    # ── inputs ───────────────────────────────────────────────────────────────
    def set_mapping(self, kibl_fixtures, at_fixtures, now_mono=None):
        mapping, st = LP.join_fixtures(kibl_fixtures, at_fixtures)
        self.kibl_fixtures = len(kibl_fixtures or ())
        self.unmatched = st.get("unmatched_list") or []
        gone = set(self.mapping) - set(mapping)
        self.mapping = mapping
        for fid in gone:                                    # a fixture that no longer joins keeps no state
            self.rows.pop(fid, None)
            self.openers.pop(fid, None)
            self.dirty.pop(fid, None)
        self.by_ev = {m["event_key"]: m for m in mapping.values()}
        for fid, m in mapping.items():
            if m.get("status") not in LP.AT_NOT_STARTED and fid not in self.started:
                self.started.add(fid)
                self._mark(fid, now_mono)
        self.mapping_at = iso(datetime.now(timezone.utc))
        self.count["mapping_refreshes"] += 1
        return st

    def load_written(self, rows):
        """line_prices_current as read back at start-up: what is already there, so a restart neither re-ticks an
        unchanged price nor leaves a line that has gone since (it is withdrawn on the fixture's first recompute)."""
        for r in rows or ():
            self.written[row_key(r)] = {k: (_num(r.get(k)) if k in NUMERIC else r.get(k)) for k in CMP}
        self.written_loaded_at = iso(datetime.now(timezone.utc))

    def _mark(self, fid, now_mono=None):
        self.dirty.setdefault(fid, (time.monotonic() if now_mono is None else now_mono) + COALESCE_S)

    def accept(self, row, now_mono=None):
        """One stream or seed row. Returns True when the row was a line-price row we keep (counted either way)."""
        try:
            return self._accept(row, now_mono)
        except Exception as e:  # noqa: BLE001 — never reaches the Now loop
            self._fault("accept", e)
            return False

    def _accept(self, row, now_mono):
        if LP.MARKETS.get((row.get("market_type_id"), row.get("segment_id"))) is None:
            return False
        if row.get("feed_source_id") != self.fsid:
            self.count["skip_other_book"] += 1
            return False
        fid = row.get("fixture_id")
        if fid not in self.mapping:
            self.count["skip_unmatched_fixture"] += 1
            return False
        if row.get("is_live"):
            # The first in-play row is the fixture's Closing point: written once as 'started', never priced again.
            self.count["inplay_seen"] += 1
            if fid not in self.started:
                self.started.add(fid)
                self.count["fixtures_started"] += 1
                if fid in self.seeded:
                    # Seen live, with a full ladder held: the guarded state just before this row IS the close
                    # (founder 2026-10-26: the last price before the start). A start found any other way — the
                    # api-tennis status at a join, a restart mid-match — captures no close.
                    self.flip[fid] = iso(datetime.now(timezone.utc))
                self._mark(fid, now_mono)
            return False
        if fid in self.started:
            self.count["skip_past_closing_point"] += 1
            return False
        slot = (row.get("market_type_id"), row.get("segment_id"), row.get("alt_id") or 0,
                row.get("participant_side_id"), row.get("side_id"))
        ins = row.get("inserted_on") or ""
        kept = False
        if row.get("is_opener"):
            op = self.openers[fid].get(slot)
            # The NEWEST opener of a slot: an alternate slot moved to a new line opens again there.
            if op is None or (LP._ts(ins) or 0) > (LP._ts(op.get("inserted_on")) or 0):
                self.openers[fid][slot] = row
                self.count["opener_held"] += 1
                self._mark(fid, now_mono)
            kept = True
        if row.get("is_current") is not True:
            # An opener that is not current is the line's opening price only. Anything else not current is a
            # superseded row (Kibl can send one) — never a price.
            if not kept:
                self.count["skip_not_current"] += 1
            return kept
        prev = self.rows[fid].get(slot)
        if prev is not None and LP._ts(ins) is not None and LP._ts(prev.get("inserted_on")) is not None \
                and LP._ts(ins) <= LP._ts(prev.get("inserted_on")):
            self.count["skip_not_newer"] += 1
            return True
        self.rows[fid][slot] = row
        self.count["accepted"] += 1
        self._mark(fid, now_mono)
        return True

    # ── one fixture, recomputed whole ───────────────────────────────────────
    def compute(self, fid, seen_at):
        """-> (current rows to upsert, ticks to insert, the written-state update to apply once they land)."""
        m = self.mapping.get(fid)
        if m is None:
            return [], [], {}
        m = dict(m)
        started = fid in self.started
        if started:
            # The guards run on the last PRE-MATCH rows as if not started (the stored rows are pre-match only), so a
            # started key keeps the verdict it closed on; every key is then written as 'started'.
            m["status"] = ""
        rows = list(self.rows.get(fid, {}).values()) + list(self.openers.get(fid, {}).values())
        entries, _ = LP.normalise(rows, {fid: m})
        LP.apply_guards(entries, {m["event_key"]: m})
        start = iso(datetime.fromtimestamp(m["start_ts"], timezone.utc)) if m.get("start_ts") else None
        cur, ticks, upd, seen = [], [], {}, set()
        for e in entries:
            price = e["price"] if e["status"] != "suspended" else None
            row = {"event_key": e["event_key"], "market": e["market"], "side": str(e["side"]), "line": e["line"],
                   "book": LP.BOOK, "price": price, "implied": e["implied"], "status": e["status"],
                   "open_price": e["open_price"], "open_ts": e["open_ts"], "max_limit": e["max_limit"],
                   "inserted_on": e["inserted_on"], "seen_at": seen_at, "start_ts": start,
                   "kibl_fixture": fid, "alt_id": e["alt_id"]}
            k = row_key(row)
            row.update(self._close_of(fid, k, e if started else None))
            if started:
                row["status"] = "started"
            seen.add(k)
            self._diff(k, row, cur, ticks, upd, e.get("is_opener", False), seen_at)
        for k, w in list(self.written.items()):
            if k[0] != m["event_key"] or k in seen or w.get("status") == WITHDRAWN:
                continue
            if fid in self.started and w.get("status") == "started":
                continue
            row = {"event_key": k[0], "market": k[1], "side": k[2], "line": k[3], "book": k[4], "price": None,
                   "implied": None, "status": "started" if fid in self.started else WITHDRAWN, "open_price": w.get("open_price"),
                   "open_ts": None, "max_limit": None, "inserted_on": w.get("inserted_on"), "seen_at": seen_at,
                   "start_ts": start, "kibl_fixture": fid, "alt_id": None}
            row.update(self._close_of(fid, k, None))
            self._diff(k, row, cur, ticks, upd, False, seen_at)
        return cur, ticks, upd

    def _close_of(self, fid, k, e):
        """The close fields for one key. A start THIS worker saw live (`flip`) closes the key on its pre-start verdict:
        an ok pair gives its price and de-vigged implied, a dashed one (suspended, one-sided, a guard) no close. Any
        other key keeps the close it already holds (a read-back after a restart), or none — never one inferred."""
        if e is not None and fid in self.flip:
            if e["status"] == "ok" and e["price"] is not None:
                return {"close_price": e["price"], "close_implied": e["implied"], "close_at": e["inserted_on"],
                        "close_src": "live-flip"}
            return {f: None for f in CLOSE_FIELDS}
        w = self.written.get(k) or {}
        return {f: w.get(f) for f in CLOSE_FIELDS}

    def _diff(self, k, row, cur, ticks, upd, is_opener, seen_at):
        w = self.written.get(k)
        new = {f: row[f] for f in CMP}
        if w is not None and all(_same(w.get(f), new[f]) for f in CMP):
            return
        cur.append(row)
        if w is None or not _same(w.get("price"), new["price"]) or w.get("status") != new["status"]:
            ticks.append({"event_key": row["event_key"], "market": row["market"], "side": row["side"], "line": row["line"],
                          "book": row["book"], "price": row["price"], "status": row["status"], "is_opener": bool(is_opener),
                          "max_limit": row["max_limit"], "inserted_on": row["inserted_on"], "seen_at": seen_at})
        upd[k] = new

    def due(self, now_mono, force=False):
        out = [f for f, t in self.dirty.items() if force or t <= now_mono]
        for f in out:
            del self.dirty[f]
        return out

    # ── the write ────────────────────────────────────────────────────────────
    def flush(self, sb, now_mono=None, force=False):
        """Recompute every due fixture and write it. `sb(method, path, body, prefer)` -> (status, text). A failed write
        re-marks the fixture due in RETRY_S and leaves the written state alone, so the retry is recomputed from the
        newest rows — it can never write an older price over a newer one."""
        try:
            return self._flush(sb, time.monotonic() if now_mono is None else now_mono, force)
        except Exception as e:  # noqa: BLE001
            self._fault("flush", e)
            return None

    def _flush(self, sb, now_mono, force):
        fids = []
        for fid in self.due(now_mono, force):
            # A fixture only the stream has touched holds a PARTIAL ladder: computing it would withdraw every line the
            # stream has not re-sent. It waits for a seed (the driver reseeds soon when one is waiting).
            if fid in self.seeded or fid in self.started:
                fids.append(fid)
            else:
                self.count["held_unseeded"] += 1
        if not fids:
            return {"fixtures": 0, "current": 0, "ticks": 0}
        seen_at = iso(datetime.now(timezone.utc))
        cur, ticks, upd = [], [], {}
        for fid in fids:
            c, t, u = self.compute(fid, seen_at)
            cur += c
            ticks += t
            upd.update(u)
        res = {"fixtures": len(fids), "current": len(cur), "ticks": len(ticks)}
        if not cur:
            return res
        if not self.write:
            self.count["would_write_current"] += len(cur)
            self.count["would_write_ticks"] += len(ticks)
            self.written.update(upd)                   # a dry run tracks what it WOULD have written, so counts are real
            return res
        err = _post_chunks(sb, TABLE_TICK, ticks, "resolution=ignore-duplicates,return=minimal",
                           "event_key,market,side,line,book,inserted_on,price,status")
        if err is None:
            err = _post_chunks(sb, TABLE_CUR, cur, "resolution=merge-duplicates,return=minimal",
                               "event_key,market,side,line,book")
        if err is not None:
            self.write_ok = False
            self.count["write_failed"] += 1
            due = now_mono + RETRY_S
            for fid in fids:
                self.dirty.setdefault(fid, due)
            self.log(f"::warning::lines write failed ({err[:200]}) — {len(fids)} fixture(s) retry in {RETRY_S}s")
            return dict(res, error=err)
        self.write_ok = True
        self.written.update(upd)
        self.count["current_written"] += len(cur)
        self.count["ticks_written"] += len(ticks)
        return res

    # ── heartbeat ────────────────────────────────────────────────────────────
    def summary(self):
        try:
            by = collections.Counter(w.get("status") for w in self.written.values())
            return {"write": self.write, "write_ok": self.write_ok, "kibl_fixtures": self.kibl_fixtures,
                    "matched": len(self.mapping), "unmatched": len(self.unmatched), "started": len(self.started),
                    "seeded": len(self.seeded), "slots_held": sum(len(v) for v in self.rows.values()),
                    "keys": len(self.written),
                    "keys_ok": by.get("ok", 0), "mapping_at": self.mapping_at, "seed_at": self.seed_at,
                    "counts": dict(self.count)}
        except Exception as e:  # noqa: BLE001
            self._fault("summary", e)
            return {"error": type(e).__name__}


def _same(a, b):
    if a is None or b is None:
        return a is None and b is None
    na, nb = _num(a), _num(b)
    if na is not None and nb is not None:
        return abs(na - nb) < 1e-9
    ta, tb = LP._ts(a), LP._ts(b)
    if ta is not None and tb is not None:
        return ta == tb
    return str(a) == str(b)


def _post_chunks(sb, table, rows, prefer, conflict):
    q = "?" + urllib.parse.urlencode({"on_conflict": conflict})
    for i in range(0, len(rows), CHUNK):
        st, body = sb("POST", f"/rest/v1/{table}{q}", rows[i:i + CHUNK], prefer)
        if st not in (200, 201, 204):
            return f"{table} HTTP {st}: {str(body)[:200]}"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# I/O (the worker's)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_kibl_fixtures(kc, now):
    out = []
    w0, w1 = iso(now - timedelta(hours=3)), iso(now + timedelta(hours=60))
    for lid in LEAGUES:
        payload, meta = kc.get("/info/fixtures", {"league_id": lid, "start_time": w0, "end_time": w1})
        if meta.get("status") != 200:
            raise RuntimeError(f"Kibl fixtures league {lid}: HTTP {meta.get('status')}")
        out += [f for f in kc.rows(payload) if isinstance(f, dict)]
    return out


def fetch_at_fixtures(api_key, now):
    """api-tennis get_fixtures, yesterday .. +2 days, UTC. The URL carries the key: never logged, never raised."""
    d0, d1 = (now - timedelta(days=1)).strftime("%Y-%m-%d"), (now + timedelta(days=2)).strftime("%Y-%m-%d")
    u = "https://api.api-tennis.com/tennis/?" + urllib.parse.urlencode(
        {"method": "get_fixtures", "APIkey": api_key, "date_start": d0, "date_stop": d1, "timezone": "UTC"})
    try:
        with urllib.request.urlopen(u, timeout=120) as r:
            res = json.load(r).get("result") or []
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"api-tennis get_fixtures failed ({type(e).__name__})") from None
    if not res:
        raise RuntimeError("api-tennis get_fixtures returned no fixtures")
    return res


def seed_rows(kc, fsid, now):
    """Current + opener rows for the six markets, pre-match — the stream only sends changes."""
    w0, w1 = iso(now - timedelta(hours=3)), iso(now + timedelta(hours=60))
    out = []
    for lid in LEAGUES:
        rows, metas = kc.markets_all_states(league_id=lid, betting_type_id=1, feed_source_id=fsid,
                                            start_time=w0, end_time=w1)
        if not all(m.get("status") == 200 for m in metas):
            raise RuntimeError(f"Kibl markets league {lid}: {[m.get('status') for m in metas]}")
        out += rows
    return out


def read_written(sb, now):
    """line_prices_current for events starting from a day back: the keys already there and their last values."""
    out, offset = [], 0
    since = iso(now - timedelta(days=1))
    while True:
        q = urllib.parse.urlencode({"select": "event_key,market,side,line,book," + ",".join(CMP),
                                    "start_ts": f"gte.{since}", "order": "event_key.asc,market.asc,side.asc,line.asc",
                                    "limit": 1000, "offset": offset})
        st, body = sb("GET", f"/rest/v1/{TABLE_CUR}?{q}", None, None)
        if st != 200:
            raise RuntimeError(f"{TABLE_CUR} read HTTP {st}")
        got = json.loads(body)
        out += got
        if len(got) < 1000:
            return out
        offset += 1000


class LineDriver:
    """The worker's hooks: everything wrapped, everything counted.

    The slow I/O — the read-back, the Kibl + api-tennis join, the REST seeds — runs on its OWN thread with its OWN Kibl
    client, so a slow api-tennis answer never holds up the stream loop the Now prices ride on. The stream loop only
    calls accept / tick / summary: in-memory work plus the line write itself. One lock guards the engine."""

    def __init__(self, fsid, env, sb, kc_factory, write, log=print):
        self.env, self.sb, self.kc_factory, self.log = env, sb, kc_factory, log
        self.key = (env.get("API_TENNIS_KEY") or "").strip()
        self.eng = LineEngine(fsid, write=write, log=log)
        self.lock = threading.Lock()
        self.state = {"map": 0.0, "seed": 0.0, "rb": 0.0, "written": False, "seed_now": False}
        self.disabled = None if self.key else "API_TENNIS_KEY not set — line prices off"
        self.kc = None
        log("lines: " + (self.disabled or ("writes ENABLED" if write else "writes DISABLED (KIBL_LINES_WRITE != 1) — dry run")))

    # ── the background thread ───────────────────────────────────────────────
    def start(self):
        if self.disabled:
            return None
        th = threading.Thread(target=self._run, name="lines-io", daemon=True)
        th.start()
        return th

    def _run(self):
        while True:
            try:
                self.step()
            except Exception as e:  # noqa: BLE001 — the thread never dies
                with self.lock:
                    self.eng._fault("io_thread", e)
            time.sleep(5)

    def step(self):
        if self.kc is None:
            self.kc = self.kc_factory()
        self.refresh()
        self.seed()

    def refresh(self, force=False):
        if self.disabled:
            return
        t = time.time()
        now = datetime.now(timezone.utc)
        if not self.state["written"]:
            if not force and t - self.state["rb"] < 60:
                return
            self.state["rb"] = t
            try:
                rows = read_written(self.sb, now)
                with self.lock:
                    self.eng.load_written(rows)
                self.state["written"] = True
                self.log(f"lines: {len(rows)} current row(s) read back from {TABLE_CUR}")
            except Exception as e:  # noqa: BLE001
                with self.lock:
                    self.eng._fault("read_back", e)
                return                                     # never compute without knowing what is there
        if force or t - self.state["map"] >= MAPPING_EVERY_S:
            self.state["map"] = t
            try:
                t0 = time.time()
                kfx, at = fetch_kibl_fixtures(self.kc, now), fetch_at_fixtures(self.key, now)
                with self.lock:
                    st = self.eng.set_mapping(kfx, at)
                self.log(f"lines: join {len(kfx)} Kibl fixture(s) -> {st.get('matched', 0)} matched, "
                         f"{len(self.eng.unmatched)} unmatched ({time.time() - t0:.1f}s)")
            except Exception as e:  # noqa: BLE001
                with self.lock:
                    self.eng._fault("mapping", e)

    def request_seed(self):
        """The stream (re)connected: seed on the next thread turn."""
        self.state["seed_now"] = True

    def seed(self, force=False):
        if self.disabled or not self.state["written"] or not self.eng.mapping:
            return
        t = time.time()
        force = force or self.state["seed_now"]
        waiting = bool(set(self.eng.mapping) - self.eng.seeded - self.eng.started)
        if not force and t - self.state["seed"] < (UNSEEDED_RESEED_S if waiting else RESEED_EVERY_S):
            return
        self.state["seed"], self.state["seed_now"] = t, False
        try:
            t0 = time.time()
            rows = seed_rows(self.kc, self.eng.fsid, datetime.now(timezone.utc))
            with self.lock:
                covered = set(self.eng.mapping)
                kept = sum(1 for r in rows if self.eng.accept(r))
                for fid in covered - self.eng.seeded:
                    self.eng.seeded.add(fid)
                    self.eng._mark(fid)                     # computed now, with its full ladder
                self.eng.seed_at = iso(datetime.now(timezone.utc))
                self.eng.count["seeds"] += 1
            self.log(f"lines: seed {len(rows)} row(s), {kept} kept on {len(covered)} matched fixture(s) "
                     f"({time.time() - t0:.1f}s)")
        except Exception as e:  # noqa: BLE001
            with self.lock:
                self.eng._fault("seed", e)

    # ── the stream loop's hooks ─────────────────────────────────────────────
    def accept(self, row):
        if self.disabled or not self.state["written"]:
            return
        with self.lock:
            self.eng.accept(row)

    def tick(self):
        if self.disabled or not self.state["written"]:
            return
        with self.lock:
            res = self.eng.flush(self.sb)
        if res and res.get("current") and not self.eng.write:
            self.log(f"DRY lines: {res['fixtures']} fixture(s) -> {res['current']} current, {res['ticks']} tick(s)")

    def summary(self):
        if self.disabled:
            return {"off": self.disabled}
        with self.lock:
            return self.eng.summary()
