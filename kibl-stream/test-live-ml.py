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
check("flush_live(env, live, log, enabled)" in src and "live_ml=live.summary()" in src, "it is flushed and on the heartbeat")
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
print(f"\n{len(fails)} failure(s)"); sys.exit(1 if fails else 0)
