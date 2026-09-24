#!/usr/bin/env python3
"""TEN-270 — join Kibl STREAM rows to OUR board cards. Report-only, pure functions.

Founder brief 2026-09-24 00:48Z, change 1: "Match rows to our cards, not to
Kibl's league. Join each stream row to a live card in matches.json on both
player names plus start time. League comes from our card. Unmatched rows are
dropped and counted, never guessed. Keep the routing-key league as a
cross-check only, and report any disagreement."

WHAT THE JOIN IS
  A stream row carries a fixture_id and no names (measured, probe run
  35937443000: 27 fields, no name, no league). The fixture's names come from
  Kibl's own fixture record (`kibl_fixtures`, else /info/fixtures). The match
  itself is the EXISTING cross-feed key, `ten225_names.match_key(day, p1, p2)`
  — UTC day + both surname keys, sorted — so the stream pairs to a card exactly
  the way the poller's card path does. Not a second matcher.

  Start time: the card's `date`+`time` are api-tennis local time, UTC+2
  (measured, [[apitennis-event-time-is-scheduled-only]]); both sides are keyed
  on the UTC day, and the minutes between the card's start and Kibl's
  scheduled start are REPORTED per match rather than used to drop anything —
  the tolerance is the founder's call, not this file's.

PRE-MATCH vs IN-PLAY
  The stream says so on every row: `betting_type_id` 1 = Prematch, 3 = Live
  Fluid, and `is_live`. A row is pre-match match-winner only when market 1,
  segment 1 (Full Game), betting_type 1 and is_live is not true — the card
  path's own `is_match_winner()` test, restated here only because that module
  cannot be imported without its Supabase side effects.

SIDES
  A fixture's two sides are ordered by `fixture_participant_id`, lower = the
  first-named player in Kibl's fixture string. That ordering is the card
  path's documented ASSUMPTION (side_labels_for), adjudicated there against an
  independent book. Here each side is named, then placed on the card by
  surname key — and a side that cannot be placed is reported, never guessed.
"""
import collections
from datetime import datetime, timedelta, timezone

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from ten225_names import match_key, name_key, split_kibl_fixture_name  # noqa: E402

CARD_TZ = timezone(timedelta(hours=2))      # api-tennis event_time is UTC+2
TIER_LEAGUE = {"ATP": 19, "Challenger": 537, "ITF": 962}
MIN_REAL_PRICE = 1.01


def parse_ts(v):
    if v in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def card_start_utc(card):
    d, t = (card.get("date") or "")[:10], (card.get("time") or "")[:5]
    try:
        return datetime.fromisoformat(f"{d}T{t}:00").replace(tzinfo=CARD_TZ).astimezone(timezone.utc)
    except ValueError:
        return None


def card_tier(card):
    """League comes from OUR card. The board's tier label, verbatim."""
    b = (card.get("tourBadge") or "").strip()
    if b in TIER_LEAGUE:
        return b
    t = (card.get("tour") or "").lower()
    if "challenger" in t:
        return "Challenger"
    if t.startswith("itf") or " itf" in t:
        return "ITF"
    return b or None


def is_prematch_winner(r):
    return (r.get("market_type_id") == 1 and r.get("segment_id") == 1
            and r.get("betting_type_id") == 1 and r.get("is_live") is not True)


def is_inplay(r):
    return r.get("betting_type_id") == 3 or r.get("is_live") is True


def real_price(r):
    p = r.get("price_decimal")
    try:
        p = float(p)
    except (TypeError, ValueError):
        return None
    return p if p >= MIN_REAL_PRICE else None


def index_cards(cards, since=None):
    """{match_key: card} for pre-match cards; ambiguous keys dropped and counted."""
    idx, dup, unkeyable, pool = {}, set(), [], []
    for c in cards or []:
        st = card_start_utc(c)
        if st is None or (since is not None and st < since):
            continue
        pool.append(c)
        k = match_key(st.date().isoformat(), c.get("p1"), c.get("p2"))
        if not k:
            unkeyable.append(c)
            continue
        if k in idx:
            dup.add(k)
        idx[k] = c
    for k in dup:
        idx.pop(k, None)
    return idx, pool, sorted(dup), unkeyable


def join(rows, cards, fixtures, openers=None, since=None):
    """rows: [(rec, row)] from the capture. cards: matches.json list.
    fixtures: {fixture_id: {"name", "scheduled_start", "league_id"}}.
    openers: {fixture_id: [archive is_opener match-winner rows]}.
    since: only cards scheduled at/after this instant are in the denominator.
    """
    openers = openers or {}
    idx, pool, dup_keys, unkeyable = index_cards(cards, since)
    surnames_by_day = collections.defaultdict(set)
    for c in pool:
        st = card_start_utc(c)
        for p in (c.get("p1"), c.get("p2")):
            nk = name_key(p)
            if nk:
                surnames_by_day[st.date().isoformat()].add(nk)

    by_fx = collections.defaultdict(list)
    for rec, r in rows:
        if r.get("fixture_id") is not None:
            by_fx[r["fixture_id"]].append((rec, r))

    buckets = collections.defaultdict(list)
    matched = {}
    for fid, items in by_fx.items():
        fx = fixtures.get(fid)
        base = {"fixture_id": fid, "rows": len(items),
                "rk_league": sorted({r.get("_league_id") for _, r in items
                                     if r.get("_league_id") is not None})}
        if not fx:
            buckets["no_fixture_record"].append(dict(base, fixture="—"))
            continue
        p1, p2 = split_kibl_fixture_name(fx.get("name"))
        sched = parse_ts(fx.get("scheduled_start"))
        base.update(fixture=fx.get("name") or "—", kibl_scheduled=fx.get("scheduled_start"))
        k = match_key(sched.date().isoformat(), p1, p2) if (sched and p1 and p2) else None
        if not k:
            buckets["name_not_two_singles_players"].append(base)
            continue
        base["match_key"] = k
        if k in idx:
            matched[fid] = (idx[k], fx, p1, p2, sched, items)
            continue
        day, ka, kb = k.split("|")
        on_day = surnames_by_day.get(day, set())
        buckets["surname_on_board" if (ka in on_day or kb in on_day) else "not_on_board"].append(base)

    per_card, disagreements = [], []
    for fid, (card, fx, p1, p2, sched, items) in matched.items():
        tier = card_tier(card)
        want = TIER_LEAGUE.get(tier)
        rk = sorted({r.get("_league_id") for _, r in items if r.get("_league_id") is not None})
        if want is not None and rk and rk != [want]:
            disagreements.append({"fixture_id": fid, "card": f"{card.get('p1')} vs {card.get('p2')}",
                                  "card_tier": tier, "routing_key_league": rk})
        pre = [(rec, r) for rec, r in items if is_prematch_winner(r)]
        inplay = [(rec, r) for rec, r in items if is_inplay(r)]
        # Sides: lower fixture_participant_id = first-named (the card path's
        # documented assumption), then placed on the card by surname key.
        fpids = sorted({r.get("fixture_participant_id") for _, r in pre
                        if r.get("fixture_participant_id") is not None}
                       | {o.get("fixture_participant_id") for o in openers.get(fid, [])
                          if o.get("fixture_participant_id") is not None})
        side_name = {}
        if len(fpids) == 2:
            side_name = {fpids[0]: p1, fpids[1]: p2}
        card_side = {}
        for fp, nm in side_name.items():
            nk = name_key(nm)
            if nk and nk == name_key(card.get("p1")):
                card_side[fp] = "p1"
            elif nk and nk == name_key(card.get("p2")):
                card_side[fp] = "p2"
        out = {"fixture_id": fid, "card": f"{card.get('p1')} vs {card.get('p2')}",
               "tier": tier, "card_start_utc": card_start_utc(card).isoformat(),
               "kibl_scheduled": fx.get("scheduled_start"),
               "start_delta_min": round((card_start_utc(card) - sched).total_seconds() / 60.0, 1),
               "stream_rows": len(items), "prematch_winner_rows": len(pre),
               "inplay_rows": len(inplay), "sides_placed": len(card_side),
               "open": {}, "now": {}, "updates": {}, "last_update": None,
               "last_received": None, "card_odds": card.get("odds")}
        for fp, side in card_side.items():
            mine = [r for _, r in pre if r.get("fixture_participant_id") == fp]
            cur = [r for r in mine if r.get("is_current") and real_price(r) is not None]
            out["updates"][side] = len(mine)
            if cur:
                last = max(cur, key=lambda r: parse_ts(r.get("inserted_on")) or datetime.min.replace(tzinfo=timezone.utc))
                out["now"][side] = real_price(last)
            ops = sorted([o for o in openers.get(fid, []) if o.get("fixture_participant_id") == fp
                          and real_price(o) is not None],
                         key=lambda o: (parse_ts(o.get("observed_at")) or parse_ts(o.get("inserted_on"))
                                        or datetime.max.replace(tzinfo=timezone.utc)))
            if not ops:
                ops = [r for r in mine if r.get("is_opener") and real_price(r) is not None]
            if ops:
                out["open"][side] = real_price(ops[0])
        ins = [parse_ts(r.get("inserted_on")) for _, r in pre]
        rcv = [parse_ts(rec.get("received_at")) for rec, _ in pre]
        ins, rcv = [t for t in ins if t], [t for t in rcv if t]
        if ins:
            out["last_update"] = max(ins).isoformat()
        if rcv:
            out["last_received"] = max(rcv).isoformat()
        per_card.append(out)

    # Denominator: pre-match cards on the board, split by OUR tier.
    tiers = collections.Counter(card_tier(c) for c in pool)
    found = collections.Counter(p["tier"] for p in per_card)
    priced = collections.Counter(p["tier"] for p in per_card if p["prematch_winner_rows"])
    return {"cards_in_denominator": len(pool), "cards_by_tier": dict(tiers),
            "cards_with_stream_rows_by_tier": dict(found),
            "cards_with_prematch_price_by_tier": dict(priced),
            "ambiguous_card_keys": dup_keys, "unkeyable_cards": len(unkeyable),
            "stream_fixtures": len(by_fx), "matched_fixtures": len(matched),
            "unmatched": {k: v for k, v in buckets.items()},
            "unmatched_rows": {k: sum(x["rows"] for x in v) for k, v in buckets.items()},
            "league_disagreements": disagreements,
            "per_card": sorted(per_card, key=lambda p: -p["prematch_winner_rows"])}


def report_lines(res, n_sample=10):
    """Markdown for the report. Missing is an em dash, never 0."""
    D = lambda v: "—" if v in (None, {}, []) else v  # noqa: E731
    L = ["## TEN-270 · Stream rows → our board cards (names + start time)", ""]
    L.append(f"Denominator: **{res['cards_in_denominator']}** pre-match cards on the live "
             f"board (scheduled at/after capture start), by our tier {res['cards_by_tier'] or '—'}.")
    L.append("")
    L.append("| tier (from our card) | cards | with any stream row | with a pre-match match-winner price |")
    L.append("|---|---:|---:|---:|")
    for t in sorted(set(res["cards_by_tier"]) | {"ATP", "ITF"}):
        n = res["cards_by_tier"].get(t, 0)
        if n == 0:
            L.append(f"| {t} | 0 | — | — |")
        else:
            a = res["cards_with_stream_rows_by_tier"].get(t, 0)
            b = res["cards_with_prematch_price_by_tier"].get(t, 0)
            L.append(f"| {t} | {n} | {a} of {n} | {b} of {n} |")
    L.append("")
    L.append(f"Stream fixtures seen: **{res['stream_fixtures']}**; matched to a card: "
             f"**{res['matched_fixtures']}**. Ambiguous card keys dropped: "
             f"{len(res['ambiguous_card_keys'])}; unkeyable cards: {res['unkeyable_cards']}.")
    L.append("")
    L.append("### Unmatched stream fixtures — dropped and counted, never guessed")
    L.append("| bucket | fixtures | rows |")
    L.append("|---|---:|---:|")
    for b, v in sorted(res["unmatched"].items()):
        L.append(f"| {b} | {len(v)} | {res['unmatched_rows'][b]} |")
    for b in ("surname_on_board", "name_not_two_singles_players", "not_on_board"):
        v = res["unmatched"].get(b) or []
        if v:
            L.append("")
            L.append(f"**{b}** ({len(v)}{', first 40' if len(v) > 40 else ''}):")
            for x in v[:40]:
                L.append(f"- `{x['fixture_id']}` {x['fixture']} · sched {x.get('kibl_scheduled', '—')} "
                         f"· rk league {x['rk_league'] or '—'} · {x['rows']} rows")
    L.append("")
    L.append("### Routing-key league vs our card's tier (cross-check only)")
    if not res["league_disagreements"]:
        L.append(f"No disagreement on {res['matched_fixtures']} matched fixture(s)."
                 + ("  ⚠️ n<30" if res["matched_fixtures"] < 30 else ""))
    else:
        for d in res["league_disagreements"]:
            L.append(f"- ⚠️ `{d['fixture_id']}` {d['card']}: card {d['card_tier']}, "
                     f"routing key {d['routing_key_league']}")
    L.append("")
    L.append(f"### Sample — up to {n_sample} matched cards (stream window only)")
    L.append("| card | tier | Open p1 / p2 | Now p1 / p2 | updates p1 / p2 | last update (Kibl) | "
             "in-play rows | start Δ min (card − Kibl) |")
    L.append("|---|---|---|---|---|---|---:|---:|")
    for p in res["per_card"][:n_sample]:
        o, nw, u = p["open"], p["now"], p["updates"]
        L.append(f"| {p['card']} | {p['tier']} | {D(o.get('p1'))} / {D(o.get('p2'))} | "
                 f"{D(nw.get('p1'))} / {D(nw.get('p2'))} | {D(u.get('p1'))} / {D(u.get('p2'))} | "
                 f"{D(p['last_update'])} | {p['inplay_rows']} | {p['start_delta_min']} |")
    if not res["per_card"]:
        L.append("| — | — | — | — | — | — | — | — |")
    return L
