#!/usr/bin/env python3
"""TEN-270 — the Kibl stream -> live "Now" worker.

Founder brief 2026-09-24T01:21Z, "Build authorised". This process:

  1. keeps our pre-match CARDS (the live matches.json) and Kibl's FIXTURE names
     (/info/fixtures) fresh, and joins them under JOIN RULE 1 (card_join.pick);
  2. consumes the Kibl RabbitMQ queue and takes ONLY pre-match full-match
     match-winner rows (betting_type_id 1, is_live false, market 1, segment 1);
  3. writes the latest price per card and side to `kibl_now_price`, ONE row per
     card (both sides) to `kibl_now_card` — the only Realtime-published table,
     so a change costs one message per viewer — and every accepted pre-match
     price change to `kibl_now_history`;
  4. SEEDS every matched card from Kibl's /info/markets REST call (the current
     prices — the same call the poller makes) at start-up and after every
     reconnect, because the stream only sends CHANGES;
  5. stops updating a card at its Closing point — the moment our board marks it
     live or finished — and ignores in-play rows throughout.

WHAT IT DOES NOT TOUCH. It never writes `kibl_line_observations`, `kibl_fixtures`,
`odds_card_state` or anything else the poller owns. The poller keeps running
unchanged as the fallback. The only tables written are the three new ones.

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
TABLE_CARD = "kibl_now_card"   # ONE row per card, both sides: the only Realtime-published table
HB_KEY = ("__stream__", "__hb__")
# How long a card row waits after the first side of a move lands, so the other
# side's row (Kibl sends them as separate participant rows, not always in one
# message) rides in the SAME row — one Realtime message per change, not two.
COALESCE_S = 1.5
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
        self.now_side = {}                           # (card_key, side_key) -> the Now row written
        self.dirty = {}                              # card_key -> monotonic time the card row is due
        self.fid_key = {}                            # fixture -> card_key it was ever joined to
        self.count = collections.Counter()
        self.write_ok = True                         # did the last write land? (heartbeat -> page)
        self.card_ok = True                          # did the last CARD row write land?

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
        if row.get("is_current") is not True:
            # Kibl can send a superseded row (is_previous) — never a Now.
            # (clean-context review, finding 4)
            self.count["skip_not_current"] += 1
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
        now_row = dict(common, kind="price")
        self.now_side[(ck, sk)] = now_row
        # The card row goes out once, COALESCE_S after the first side of a move
        # lands, carrying both sides — one Realtime message per change, not two.
        self.dirty.setdefault(ck, time.monotonic() + COALESCE_S)
        out.append(("now", now_row))
        return out

    def card_rows(self, now_mono, force=False):
        """-> the due card rows (both sides known), clearing them from `dirty`.
        A card with one side known stays pending until the other arrives."""
        out = []
        for ck, due in list(self.dirty.items()):
            if not force and due > now_mono:
                continue
            sides = sorted(sk for (c, sk) in self.now_side if c == ck)
            if len(sides) != 2:
                continue
            a, b = (self.now_side[(ck, s)] for s in sides)
            del self.dirty[ck]
            out.append({"card_key": ck, "book": a["book"], "book_name": a["book_name"],
                        "feed_source_id": a["feed_source_id"], "fixture_id": a["fixture_id"],
                        "a_side": sides[0], "a_price": a["price"], "a_at": a["kibl_inserted_on"],
                        "b_side": sides[1], "b_price": b["price"], "b_at": b["kibl_inserted_on"],
                        # The source of the side that moved last.
                        "source": max((a, b), key=lambda r: CJ.parse_ts(r["kibl_inserted_on"]))["source"]})
        self.count["card_written"] += len(out)
        return out

    def still_latest(self, r):
        """Is this Now row still the newest we hold for its side? A retry of a
        failed write must never overwrite a newer price that landed since."""
        held = self.latest.get((r["card_key"], r["side_key"]))
        return held is not None and CJ.parse_ts(r["kibl_inserted_on"]) == held

    def heartbeat(self, now, connected, extra=None):
        body = {"connected": bool(connected), "write_ok": self.write_ok and self.card_ok, "cards": len(self.cards),
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
    log(f"seed: {n} current row(s) on matched cards -> "
        f"{sum(1 for k, _ in writes if k == 'now')} Now write(s); engine counts {dict(engine.count)}")
    return writes


def dedupe(writes):
    """One row per primary key per request. A batch carrying two rows for one
    (card, side) makes Postgres reject the WHOLE upsert ("cannot affect row a
    second time") — review finding 4. Keep the newest by Kibl's clock."""
    now, hist = {}, {}
    for k, r in writes:
        if k == "now":
            key = (r["card_key"], r["side_key"])
            # Parsed, not string-compared: iso() drops a zero fraction, so
            # '…10:00:00Z' would sort above '…10:00:00.5Z' as text.
            if key not in now or (CJ.parse_ts(r["kibl_inserted_on"])
                                  > CJ.parse_ts(now[key]["kibl_inserted_on"])):
                now[key] = r
        else:
            hist.setdefault(r["row_key"], r)
    return list(now.values()), list(hist.values())


def flush(env, writes, log, enabled, eng=None):
    """-> the writes that did NOT land, for the caller to retry (review finding 5)."""
    now_rows, hist_rows = dedupe(writes)
    failed = []
    if not enabled:
        for r in now_rows:
            log(f"DRY now {r['card_key']} {r['side_key']} {r['price']} @ {r['kibl_inserted_on']}")
        return []
    if now_rows:
        st, body = C.sb_request(env, "POST", f"/rest/v1/{TABLE_NOW}?on_conflict=card_key,side_key",
                                now_rows, prefer="resolution=merge-duplicates,return=minimal")
        if st not in (200, 201, 204):
            log(f"::warning::now upsert HTTP {st}: {body[:200]}")
            failed += [("now", r) for r in now_rows]
    if hist_rows:
        st, body = C.sb_request(env, "POST", f"/rest/v1/{TABLE_HIST}?on_conflict=row_key",
                                hist_rows, prefer="resolution=ignore-duplicates,return=minimal")
        if st not in (200, 201, 204):
            log(f"::warning::history insert HTTP {st}: {body[:200]}")
            failed += [("hist", r) for r in hist_rows]
    if eng is not None:
        eng.count["write_failed"] += len(failed)
        eng.write_ok = not failed
    return failed


def flush_cards(env, rows, log, enabled, eng):
    """Upsert the due card rows. A failed row is re-marked due in 10 s; the retry
    is rebuilt from the engine's latest sides, so it can never write an older
    price over a newer one."""
    if not rows:
        return
    if not enabled:
        for r in rows:
            log(f"DRY card {r['card_key']} {r['a_side']} {r['a_price']} / {r['b_side']} {r['b_price']}")
        return
    st, body = C.sb_request(env, "POST", f"/rest/v1/{TABLE_CARD}?on_conflict=card_key",
                            rows, prefer="resolution=merge-duplicates,return=minimal")
    if st not in (200, 201, 204):
        log(f"::warning::card upsert HTTP {st}: {body[:200]}")
        due = time.monotonic() + 10
        for r in rows:
            eng.dirty.setdefault(r["card_key"], due)
        eng.count["card_write_failed"] += len(rows)
        eng.card_ok = False
        return
    eng.card_ok = True


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
    C.sb_request(env, "DELETE", f"/rest/v1/{TABLE_CARD}?written_at=lt.{cutoff}")


def broker_rtt_ms(host, port, n=5):
    """Median TCP connect time to the broker, ms — the region choice, measured."""
    import socket
    out = []
    for _ in range(n):
        t0 = time.time()
        try:
            socket.create_connection((host, int(port)), timeout=10).close()
            out.append((time.time() - t0) * 1000.0)
        except (OSError, ValueError):
            # A measurement must never crash the worker (review 2nd pass, finding 3).
            pass
    out.sort()
    return round(out[len(out) // 2], 1) if out else None


B64_SECRETS = ("KIBL_RMQ_HOST", "KIBL_RMQ_PORT", "KIBL_RMQ_VHOST", "KIBL_RMQ_USER",
               "KIBL_RMQ_PASS", "KIBL_RMQ_QUEUE", "KIBL_USERNAME", "KIBL_PASSWORD",
               "SUPABASE_URL", "SUPABASE_SECRET_KEY")


def decode_b64_env(env):
    """`NAME_B64` -> `NAME` for every such key, in place; returns the names set.

    ⚠️ WHY THIS EXISTS (TEN-270, 2026-09-24 07:40Z). The deploy piped the
    credentials into `flyctl secrets import`, which parses DOTENV: quotes, `#`,
    `$` and backslashes in a value are interpreted, not kept. Kibl's login then
    answered "Incorrect username or password" from Fly while the poller, reading
    the very same GitHub secrets, authenticated fine at 07:30Z. Base64 survives
    any parser, so every secret now travels as NAME_B64 and is decoded here.
    """
    import base64
    done, failed = [], []
    # Allowlist, not a suffix match: an unrelated FOO_B64 must never overwrite
    # FOO (clean-context review, 2nd pass, finding 2).
    for name in B64_SECRETS:
        k = name + "_B64"
        if k not in env:
            continue
        try:
            # validate=True: junk characters are an error, not silently dropped.
            env[name] = base64.b64decode(env[k], validate=True).decode("utf-8")
            done.append(name)
        except (ValueError, UnicodeDecodeError):
            failed.append(name)
    decode_b64_env.failed = failed
    return done


def main(env=None, log=print):
    # kibl_client reads os.environ itself, so the decode must land THERE too.
    decoded = decode_b64_env(os.environ)
    env = dict(os.environ) if env is None else dict(env)
    if decoded:
        log(f"decoded {len(decoded)} base64 secret(s)")
    if getattr(decode_b64_env, "failed", None):
        # Names only, never values. A failed decode would otherwise fall back to
        # the stale plain secret and fail later as a misleading auth error.
        log(f"::warning::base64 secret(s) failed to decode: {', '.join(decode_b64_env.failed)}")
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
    attempt = 0
    while True:
        try:
            fsid, tag, name = resolve_book(kc)
            break
        except Exception as e:  # noqa: BLE001 — retry, never crash-loop the host
            wait = C.backoff_for(attempt)
            attempt += 1
            log(f"::warning::book lookup failed ({C.redact(e, secrets)[:160]}); retrying in {wait}s")
            time.sleep(wait)
    log(f"book: feed_source_id {fsid} = {name} ({tag})")
    if tag not in ("bet105", "sports411"):
        # The page matches the stream to a card by the card's book string
        # ('bet105' in odds_card_state). A different tag fails SAFE — nothing
        # shows — but silently, so it is said loudly here (review finding 6).
        log(f"::warning::Kibl book tag {tag!r} is not one the card state uses — "
            "stream prices will not reach any card until they agree")
    eng = NowEngine(tag, name, fsid)
    where = {"region": env.get("FLY_REGION") or None,
             "broker_rtt_ms": broker_rtt_ms(conn["host"], conn["port"])}
    log(f"region {where['region']}: broker TCP RTT median {where['broker_rtt_ms']} ms (n=5)")
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
    retry, last_retry = [], 0.0
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
                        retry += flush(env, seed(kc, eng, log), log, enabled, eng)
                        flush_cards(env, eng.card_rows(time.monotonic(), force=True), log, enabled, eng)
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
                        retry += flush(env, writes, log, enabled, eng)
                    # Ack everything, tennis or not: an unacked message counts
                    # against the vendor's backlog cap.
                    channel.basic_ack(method.delivery_tag)
                # Card rows whose coalescing window has closed. The loop turns at
                # least once a second (inactivity_timeout), so a row waits
                # COALESCE_S to ~COALESCE_S + 1 s.
                if eng.dirty:
                    flush_cards(env, eng.card_rows(time.monotonic()), log, enabled, eng)
                t = time.time()
                if retry and t - last_retry >= 10:
                    # Only rows still the newest for their side; a newer price
                    # that landed meanwhile is never overwritten by a retry.
                    retry = [(k, r) for k, r in retry if k == "hist" or eng.still_latest(r)]
                    retry = flush(env, retry, log, enabled, eng) if retry else []
                    last_retry = t
                refresh()
                if t - last_beat >= HEARTBEAT_EVERY_S:
                    write_hb(env, eng.heartbeat(datetime.now(timezone.utc), True, where), log, enabled)
                    last_beat = t
                if t - last_prune >= 3600:
                    prune(env, log, enabled)
                    last_prune = t
        except KeyboardInterrupt:
            return 0
        except Exception as e:  # noqa: BLE001
            if connected:
                write_hb(env, eng.heartbeat(datetime.now(timezone.utc), False, where), log, enabled)
            connected = False
            wait = C.backoff_for(attempt)
            attempt += 1
            log(f"::warning::stream lost ({C.redact(e, secrets)[:200]}); retrying in {wait}s")
            time.sleep(wait)


if __name__ == "__main__":
    sys.exit(main())
