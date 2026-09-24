#!/usr/bin/env python3
"""TEN-270 — the Kibl stream -> live "Now" worker.

Founder brief 2026-09-24T01:21Z, "Build authorised". This process:

  1. keeps our pre-match CARDS (the live matches.json) and Kibl's FIXTURE names
     (/info/fixtures) fresh, and joins them under JOIN RULE 1 (card_join.pick);
  2. consumes the Kibl RabbitMQ queue and takes ONLY pre-match full-match
     match-winner rows (betting_type_id 1, is_live false, market 1, segment 1);
  3. writes the latest price per card and side to `kibl_now_price`, and every
     accepted pre-match price change to `kibl_now_history`;
  4. SEEDS every matched card from Kibl's /info/markets REST call (the current
     prices — the same call the poller makes) at start-up and after every
     reconnect, because the stream only sends CHANGES;
  5. stops updating a card at its Closing point — the moment our board marks it
     live or finished — and ignores in-play rows throughout.

WHAT IT DOES NOT TOUCH. It never writes `kibl_line_observations`, `kibl_fixtures`,
`odds_card_state` or anything else the poller owns. The poller keeps running
unchanged as the fallback. The only tables written are the two new ones.

WRITES ARE OPT-IN: `KIBL_NOW_WRITE=1`. Without it every write is logged and
counted, never sent — so a dry run cannot become a production write by default.
"""
import collections
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import card_join as CJ  # noqa: E402
import consumer as C    # noqa: E402
import sweep_bridge as B  # noqa: E402  — the sweep's own row key, for history dedupe

BOARD_URL = "https://michaeldk1996.github.io/SAAS/matches.json"
TABLE_NOW = "kibl_now_price"
TABLE_HIST = "kibl_now_history"
HB_KEY = ("__stream__", "__hb__")
CARDS_EVERY_S = 60
FIXTURES_EVERY_S = 600
HEARTBEAT_EVERY_S = 60
PRUNE_AFTER = timedelta(days=3)
# A card is dropped from the join 12 h after its SCHEDULED start if the board
# never marked it live or finished — a stale card, not a pre-match one. The
# Closing point itself is the board's live flag, NOT the scheduled time: the
# scheduled time lands after the real start 58% of the time and follow-on
# matches start hours later (odds.md), so a clock cut would stop Now early.
STALE_AFTER = timedelta(hours=12)
# Men's tennis leagues the seed and the fixture list are asked for. The board
# decides what is OURS (ruling 1); these only bound what we ask Kibl for.
SEED_LEAGUES = (19, 537, 962)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class NowEngine:
    """All the decisions, no I/O. Fed cards, fixtures and rows; returns writes."""

    def __init__(self, book_tag, book_name, feed_source_id):
        self.book_tag, self.book_name, self.fsid = book_tag, book_name, feed_source_id
        self.cards, self.fixtures = [], {}
        self.by_fixture, self.ambiguous = {}, []
        self.closed = set()                          # card_keys past their Closing point
        self.fpids = collections.defaultdict(set)    # fixture -> participant ids seen
        self.pending = collections.defaultdict(dict)  # fixture -> fpid -> (row, source)
        self.latest = {}                             # (card_key, side_key) -> inserted_on
        self.fid_key = {}                            # fixture -> card_key it was ever joined to
        self.count = collections.Counter()

    # ── inputs ──────────────────────────────────────────────────────────────
    def set_cards(self, cards, now):
        """Pre-match cards only. A card our board shows live or finished is at
        its Closing point: it is closed for good and never written again."""
        for c in cards or []:
            k = CJ.card_key(c)
            if k and (c.get("live") or c.get("finalScore")):
                self.closed.add(k)
        self.cards = CJ.pre_match_cards(cards, now - STALE_AFTER)
        self._rejoin()

    def set_fixtures(self, fixtures):
        self.fixtures = dict(fixtures)
        self._rejoin()

    def _rejoin(self):
        res = CJ.pick(self.cards, self.fixtures)
        self.by_fixture, self.ambiguous = res["by_fixture"], res["ambiguous"]
        self.fid_key.update({f: CJ.card_key(c) for f, c in self.by_fixture.items()})

    # ── one row ─────────────────────────────────────────────────────────────
    def accept(self, row, received_at, source="stream"):
        """-> list of ('now'|'hist', record). Every rejection is counted by reason."""
        if not CJ.is_prematch_winner(row):
            self.count["skip_inplay" if CJ.is_inplay(row) else "skip_not_match_winner"] += 1
            return []
        if row.get("feed_source_id") != self.fsid:
            self.count["skip_other_book"] += 1
            return []
        fid = row.get("fixture_id")
        card = self.by_fixture.get(fid)
        if card is None:
            # A card that went live leaves the pre-match pool; its rows are
            # past the Closing point, not unmatched — counted as what they are.
            closed = self.fid_key.get(fid) in self.closed
            self.count["skip_past_closing_point" if closed else "drop_unmatched"] += 1
            return []
        ck = CJ.card_key(card)
        if ck in self.closed:
            self.count["skip_past_closing_point"] += 1
            return []
        if CJ.real_price(row) is None:
            # Kibl's 0.000 suspension marker is dated and pre-match and is not
            # a price (standing rule). Never a Now, never a history point.
            self.count["skip_not_a_price"] += 1
            return []
        fp = row.get("fixture_participant_id")
        if fp is None:
            self.count["drop_no_participant"] += 1
            return []
        self.fpids[fid].add(fp)
        self.pending[fid][fp] = (row, received_at, source)
        sides = CJ.side_map(card, self.fixtures.get(fid, {}).get("name"), self.fpids[fid])
        if not sides:
            # One side seen so far, or names that do not place: HELD, not guessed.
            self.count["held_side_unplaced"] += 1
            return []
        out = []
        for f, (r, rcv, src) in list(self.pending[fid].items()):
            if f not in sides:
                continue
            del self.pending[fid][f]
            out += self._write(card, ck, sides[f], r, rcv, src)
        return out

    def _write(self, card, ck, side, row, received_at, source):
        card_side, sk = side
        ins = CJ.parse_ts(row.get("inserted_on"))
        if ins is None:
            self.count["drop_no_kibl_time"] += 1
            return []
        common = {"card_key": ck, "side_key": sk, "price": CJ.real_price(row),
                  "book": self.book_tag, "book_name": self.book_name,
                  "feed_source_id": self.fsid, "fixture_id": row.get("fixture_id"),
                  "kibl_inserted_on": iso(ins), "source": source}
        out = [("hist", dict(common, received_at=received_at, row_key=B.row_key_of(row)))]
        prev = self.latest.get((ck, sk))
        if prev is not None and ins <= prev:
            # Older than what we already hold (a seed arriving after a stream
            # change, or a redelivery): history keeps it, Now does not move back.
            self.count["now_not_newer"] += 1
            return out
        self.latest[(ck, sk)] = ins
        self.count["now_written"] += 1
        out.append(("now", dict(common, kind="price")))
        return out

    def heartbeat(self, now, connected, extra=None):
        body = {"connected": bool(connected), "cards": len(self.cards),
                "matched": len(self.by_fixture), "ambiguous": len(self.ambiguous),
                "closed": len(self.closed), "counts": dict(self.count)}
        body.update(extra or {})
        return {"card_key": HB_KEY[0], "side_key": HB_KEY[1], "kind": "heartbeat",
                "price": None, "book": self.book_tag, "book_name": self.book_name,
                "feed_source_id": self.fsid, "fixture_id": None,
                "kibl_inserted_on": None, "source": "worker",
                "note": body}


# ─────────────────────────────────────────────────────────────────────────────
# I/O
# ─────────────────────────────────────────────────────────────────────────────

def fetch_cards(url=BOARD_URL):
    # A cache-buster: Pages' CDN serves matches.json with max-age=600.
    sep = "&" if "?" in url else "?"
    with urllib.request.urlopen(f"{url}{sep}t={int(time.time())}", timeout=30) as r:
        d = json.loads(r.read().decode())
    return d if isinstance(d, list) else d.get("matches", [])


def fetch_fixtures(kc, now):
    out = {}
    for lid in SEED_LEAGUES:
        payload, meta = kc.get("/info/fixtures", {
            "league_id": lid, "start_time": iso(now - timedelta(days=1)),
            "end_time": iso(now + timedelta(days=3))})
        if meta.get("status") != 200:
            continue
        for f in kc.rows(payload):
            if isinstance(f, dict) and f.get("fixture_id") is not None:
                out[f["fixture_id"]] = {"name": f.get("name"),
                                        "scheduled_start": f.get("start_time"),
                                        "league_id": f.get("league_id", lid)}
    return out


def resolve_book(kc):
    """Name the book from Kibl's own reference — re-read every start, because
    the entitlement has swapped once already (Sports411 -> Bet105, 2026-09-19)."""
    payload, meta = kc.get("/reference/sportsbooks")
    rows = [b for b in kc.rows(payload) if isinstance(b, dict) and b.get("feed_source_id") is not None]
    if len(rows) != 1:
        raise RuntimeError(f"expected exactly one entitled book, got {len(rows)} — refusing to "
                           "label prices with a guessed book")
    b = rows[0]
    return int(b["feed_source_id"]), (b.get("tag") or b.get("name") or "").lower(), b.get("name")


def seed(kc, engine, log):
    """Current prices for every matched card — the stream only sends changes."""
    n = 0
    now = datetime.now(timezone.utc)
    writes = []
    for lid in SEED_LEAGUES:
        payload, meta = kc.markets(feed_source_id=engine.fsid, league_id=lid,
                                   start_time=iso(now - timedelta(days=1)),
                                   end_time=iso(now + timedelta(days=3)))
        if meta.get("status") != 200:
            log(f"::warning::seed league {lid}: HTTP {meta.get('status')}")
            continue
        for row in kc.market_participants(payload):
            if row.get("fixture_id") in engine.by_fixture and row.get("is_current"):
                n += 1
                writes += engine.accept(row, iso(now), source="seed")
    log(f"seed: {n} current match-winner row(s) on matched cards -> "
        f"{sum(1 for k, _ in writes if k == 'now')} Now write(s)")
    return writes


def flush(env, writes, log, enabled):
    now_rows = [r for k, r in writes if k == "now"]
    hist_rows = [r for k, r in writes if k == "hist"]
    if not enabled:
        for r in now_rows:
            log(f"DRY now {r['card_key']} {r['side_key']} {r['price']} @ {r['kibl_inserted_on']}")
        return
    if now_rows:
        st, body = C.sb_request(env, "POST", f"/rest/v1/{TABLE_NOW}?on_conflict=card_key,side_key",
                                now_rows, prefer="resolution=merge-duplicates,return=minimal")
        if st not in (200, 201, 204):
            log(f"::warning::now upsert HTTP {st}: {body[:200]}")
    if hist_rows:
        st, body = C.sb_request(env, "POST", f"/rest/v1/{TABLE_HIST}?on_conflict=row_key",
                                hist_rows, prefer="resolution=ignore-duplicates,return=minimal")
        if st not in (200, 201, 204):
            log(f"::warning::history insert HTTP {st}: {body[:200]}")


def write_hb(env, row, log, enabled):
    if not enabled:
        log("heartbeat " + json.dumps(row["note"]))
        return
    st, body = C.sb_request(env, "POST", f"/rest/v1/{TABLE_NOW}?on_conflict=card_key,side_key",
                            [row], prefer="resolution=merge-duplicates,return=minimal")
    if st not in (200, 201, 204):
        log(f"::warning::heartbeat HTTP {st}: {body[:200]}")


def prune(env, log, enabled):
    """Price rows for cards long gone. History is kept — it is the product."""
    if not enabled:
        return
    cutoff = urllib.parse.quote(iso(datetime.now(timezone.utc) - PRUNE_AFTER))
    C.sb_request(env, "DELETE", f"/rest/v1/{TABLE_NOW}?kind=eq.price&written_at=lt.{cutoff}")


def main(env=None, log=print):
    env = dict(os.environ) if env is None else dict(env)
    conn, missing = C.read_conn_env(env)
    if missing:
        log(f"KIBL_RMQ_* not fully set (missing: {', '.join(missing)}) — nothing to connect to.")
        return 0
    secrets = C.env_secrets(env, conn) + [s for s in (env.get("KIBL_USERNAME"),
                                                      env.get("KIBL_PASSWORD")) if s]
    C.install_log_redaction(secrets)
    import pika
    from kibl_client import KiblClient
    enabled = env.get("KIBL_NOW_WRITE") == "1"
    log("writes ENABLED" if enabled else "writes DISABLED (KIBL_NOW_WRITE != 1) — dry run")

    kc = KiblClient(verbose=False)
    fsid, tag, name = resolve_book(kc)
    log(f"book: feed_source_id {fsid} = {name} ({tag})")
    eng = NowEngine(tag, name, fsid)
    board_url = env.get("BOARD_URL") or BOARD_URL

    state = {"cards": 0.0, "fx": 0.0}

    def refresh(force=False):
        t = time.time()
        now = datetime.now(timezone.utc)
        if force or t - state["fx"] >= FIXTURES_EVERY_S:
            try:
                eng.set_fixtures(fetch_fixtures(kc, now))
                state["fx"] = t
            except Exception as e:  # noqa: BLE001
                log(f"::warning::fixtures refresh failed: {C.redact(e, secrets)[:160]}")
        if force or t - state["cards"] >= CARDS_EVERY_S:
            try:
                eng.set_cards(fetch_cards(board_url), now)
                state["cards"] = t
            except Exception as e:  # noqa: BLE001
                log(f"::warning::board refresh failed: {C.redact(e, secrets)[:160]}")
        if eng.ambiguous and force:
            for a in eng.ambiguous:
                log(f"ambiguous (ruling 1, matched to neither): {a['card']} — {a['why']}")

    attempt, last_beat, last_prune, connected = 0, 0.0, 0.0, False
    while True:
        try:
            refresh(force=True)
            connection = pika.BlockingConnection(C.connection_parameters(conn, pika))
            channel = connection.channel()
            channel.basic_qos(prefetch_count=200)
            connected, attempt = True, 0
            # Seed AFTER the consumer is attached, so no change can fall into
            # the gap between the snapshot and the first delivery; a change that
            # races the seed is resolved by the newer-inserted_on rule.
            first = True
            for method, _p, body in channel.consume(conn["queue"], inactivity_timeout=1.0,
                                                    auto_ack=False):
                if first:
                    first = False
                    try:
                        flush(env, seed(kc, eng, log), log, enabled)
                    except Exception as e:  # noqa: BLE001
                        log(f"::warning::seed failed — cards stay on the poller: "
                            f"{C.redact(e, secrets)[:160]}")
                if method is not None:
                    rcv = iso(datetime.now(timezone.utc))
                    try:
                        payload = json.loads(body.decode("utf-8", "replace"))
                    except ValueError:
                        payload = None
                    rows = C.envelope_rows(payload) if payload is not None else None
                    writes = []
                    for r in rows or []:
                        if isinstance(r, dict):
                            writes += eng.accept(r, rcv)
                    if writes:
                        flush(env, writes, log, enabled)
                    # Ack everything, tennis or not: an unacked message counts
                    # against the vendor's backlog cap.
                    channel.basic_ack(method.delivery_tag)
                t = time.time()
                refresh()
                if t - last_beat >= HEARTBEAT_EVERY_S:
                    write_hb(env, eng.heartbeat(datetime.now(timezone.utc), True), log, enabled)
                    last_beat = t
                if t - last_prune >= 3600:
                    prune(env, log, enabled)
                    last_prune = t
        except KeyboardInterrupt:
            return 0
        except Exception as e:  # noqa: BLE001
            if connected:
                write_hb(env, eng.heartbeat(datetime.now(timezone.utc), False), log, enabled)
            connected = False
            wait = C.backoff_for(attempt)
            attempt += 1
            log(f"::warning::stream lost ({C.redact(e, secrets)[:200]}); retrying in {wait}s")
            time.sleep(wait)


if __name__ == "__main__":
    sys.exit(main())
