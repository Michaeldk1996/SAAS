#!/usr/bin/env python3
"""live_ml.py — Bet105 in-play match winner kept for the live arbitrage (founder 2026-11-10). Each check names its mutant."""
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import live_ml as LM

fails = []
def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok: fails.append(what)

RK_ATP = "get.info.markets.0.5.19.0.2.796182.171.1.1.3.0"
RK_CH = "get.info.markets.0.5.537.0.2.796999.171.1.1.3.0"
RK_NBA = "get.info.markets.0.4.487.0.1.700000.171.1.1.3.0"
def row(fp=101, price=1.6, ins="2026-11-10T12:05:00.000Z", **kw):
    r = {"fixture_id": 796182, "fixture_participant_id": fp, "market_type_id": 1, "segment_id": 1, "betting_type_id": 3,
         "feed_source_id": 171, "is_previous": False, "is_current": True, "price_decimal": price, "market_status_id": 1,
         "inserted_on": ins, "routing_key": RK_ATP}
    r.update(kw); return r

L = LM.LiveMl(171)
check(L.accept(row(), "t0"), "an ATP in-play match-winner row is kept")
check(L.accept(row(fixture_id=796999, routing_key=RK_CH), "t0"), "a Challenger one too")
check(not L.accept(row(betting_type_id=1), "t0"), "a pre-match row is not (mutant: any betting type)")
check(not L.accept(row(market_type_id=2), "t0"), "another market is not")
check(not L.accept(row(segment_id=2), "t0"), "a set market is not (mutant: any segment)")
check(not L.accept(row(feed_source_id=43), "t0"), "another book is not")
check(not L.accept(row(routing_key=RK_NBA, fixture_id=700000), "t0"), "another sport is not (mutant: no routing-key filter)")
check(not L.accept(row(fp=202, is_previous=True), "t0"), "a superseded row is not")
r = row(fp=303); r.pop("routing_key")
check(L.accept(r, "t0", RK_ATP), "a row without its own routing key takes the message's")
check(not L.accept(row(ins="2026-11-10T12:04:00.000Z"), "t1"), "an older row never replaces a newer one (mutant: last wins)")
check(L.accept(row(price=0, market_status_id=2, ins="2026-11-10T12:06:00.000Z"), "t2"), "a suspension is kept as sent")
w = {(x["fixture_id"], x["fixture_participant_id"]): x for x in L.drain()}
check(w[(796182, 101)]["price"] == 0.0 and w[(796182, 101)]["market_status_id"] == 2, "the suspended side is written as suspended, not its last price")
check(w[(796182, 101)]["league_id"] == 19 and w[(796999, 101)]["league_id"] == 537, "league from the routing key")
check(L.drain() == [], "drain empties the queue")
L.accept(row(price=1.7, ins="2026-11-10T12:07:00.000Z"), "t3"); first = L.drain()
L.accept(row(price=1.8, ins="2026-11-10T12:08:00.000Z"), "t4"); L.requeue(first)
check(L.drain()[0]["price"] == 1.8, "a failed write put back never overrides a newer price (mutant: requeue overwrites)")

src = open(os.path.join(HERE, "now_worker.py")).read()
check("live.accept(r, rcv, method.routing_key)" in src, "the consume loop feeds every row to the in-play keeper")
check("post_live(env, a, b, log, enabled)" in src and "live_ml=live.summary()" in src, "it is flushed and on the heartbeat")

# ── founder 2026-11-12: the stream position (both 11 Nov signals priced Bet105 from a backlog up to ~2 min old) ──
from datetime import datetime, timezone, timedelta
P = LM.LiveMl(171)
check(P.position_row("x") is None and P.lag_s() is None, "no position before any message")
t0 = datetime(2026, 11, 11, 14, 21, 10, tzinfo=timezone.utc)
P.see("2026-11-11T14:19:26.000Z", t0)
check(P.lag_s() == 104.0, "lag = processed at − newest Kibl time (Sonego v Tabilo, 104 s)")
P.see("2026-11-11T14:10:00.000Z", t0 + timedelta(seconds=1))
check(P.pos == datetime(2026, 11, 11, 14, 19, 26, tzinfo=timezone.utc), "an older message never moves the position back")
P.see(None, t0 + timedelta(seconds=2))
check(P.lag_s() == 106.0, "a message with no Kibl time still stamps when the loop last ran")
pr = P.position_row("2026-11-11T14:21:12Z")
check((pr["fixture_id"], pr["fixture_participant_id"]) == LM.POSITION_KEY == (0, 0) and pr["price"] is None
      and pr["kibl_inserted_on"] == "2026-11-11T14:19:26Z" and pr["received_at"] == "2026-11-11T14:21:12Z",
      "the position row: key (0, 0), no price, Kibl time + when")
check("stream_lag_s" in P.summary(), "the heartbeat carries the lag")
import now_worker as W
calls = []
real = W.C.sb_request
W.C.sb_request = lambda env, m, path, body=None, prefer=None: (calls.append((path, body)) or (201, ""))
W.post_live({}, [{"fixture_id": 1, "fixture_participant_id": 2}], pr, lambda *_: None, True)
check(LM.HISTORY in calls[0][0] and pr not in calls[0][1], "the position never goes to the history (mutant: position in history)")
check(LM.TABLE + "?" in calls[1][0] and calls[1][1][-1] is pr, "it rides the latest upsert, after the prices it vouches for")
calls.clear(); W.C.sb_request = lambda env, m, path, body=None, prefer=None: (calls.append((path, body)) or (503, "down"))
check(W.post_live({}, [{"fixture_id": 1, "fixture_participant_id": 2}], pr, lambda *_: None, True) is False and len(calls) == 1,
      "a failed history write writes no position (a fresh position always means the prices landed)")
W.C.sb_request = real

# the writer thread: the loop never waits on a write
import threading, time as _t
gate = threading.Event()
wr = W.Writer(lambda *_: None)
t1 = _t.monotonic(); wr.submit("now", ["x"], lambda: gate.wait(5) and [])
check(_t.monotonic() - t1 < 0.05 and wr.busy("now"), "submit returns at once while the write is still running")
gate.set()
for _ in range(100):
    res = wr.results()
    if res: break
    _t.sleep(0.01)
check(res == [("now", ["x"], [])] and not wr.busy("now"), "the result comes back to the loop, kind + context")
wr.submit("x", None, lambda: 1 / 0)
for _ in range(100):
    res = wr.results()
    if res: break
    _t.sleep(0.01)
check(isinstance(res[0][2], ZeroDivisionError), "a job that raises never kills the writer")
loop = src[src.index("if method is not None:\n                    # Only a RECEIVED"):src.index("except KeyboardInterrupt")]
direct = [l.strip() for l in loop.splitlines()
          if re.search(r"\b(flush|flush_cards|flush_live|post_live|post_cards|write_hb|write_gap|prune)\(env", l)
          and "lambda" not in l and "def beat" not in l]
direct = [l for l in direct if not l.startswith("write_hb(env, hb, log, enabled)")]
check(direct == [], "the consume loop makes no Supabase call itself (mutant: a write back on the loop)")
check('wl.submit("live"' in loop and 'wr.submit("live"' not in loop, "in-play prices have their own writer, never behind a line write")
dock = open(os.path.join(HERE, "Dockerfile")).read()
mods = set(re.findall(r"^import (\w+) as \w+\s+# noqa: E402", src, re.M))
for m in sorted(mods):
    if os.path.exists(os.path.join(HERE, m + ".py")):
        check(f"kibl-stream/{m}.py" in dock, f"the image ships kibl-stream/{m}.py (mutant: module left out → the worker cannot start)")
sql = open(os.path.join(HERE, "now-schema.sql")).read()
blk = sql[sql.index("create table if not exists public.kibl_live_ml"):]
check("primary key (fixture_id, fixture_participant_id)" in blk, "one row per player")
check("alter table public.kibl_live_ml enable row level security" in blk and "revoke all on public.kibl_live_ml from anon, authenticated" in blk,
      "server-side only (mutant: browser can read)")
check("new.kibl_inserted_on <= old.kibl_inserted_on" in blk, "newer-only in the database too")
hist = sql[sql.index("create table if not exists public.kibl_live_ml_history"):]
check("unique (fixture_id, fixture_participant_id, kibl_inserted_on)" in hist, "history: one row per change, a retry never doubles it")
check("alter table public.kibl_live_ml_history enable row level security" in hist and "revoke all on public.kibl_live_ml_history from anon, authenticated" in hist,
      "history is server-side only")
fl = src[src.index("def flush_live"):src.index("def prune")]
check(fl.index("LM.HISTORY") < fl.index("LM.TABLE}?on_conflict"), "every batch goes to the history first, then the latest (mutant: history skipped)")
check("resolution=ignore-duplicates" in fl and "live.requeue(rows)" in fl, "a failed batch is retried whole (history idempotent)")
pr = src[src.index("def prune"):src.index("def broker_rtt_ms")]
check("timedelta(days=30)" in pr and "LM.HISTORY" in pr, "history kept 30 days")
print(f"\n{len(fails)} failure(s)"); sys.exit(1 if fails else 0)
