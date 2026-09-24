#!/usr/bin/env python3
"""TEN-270 — join Kibl STREAM rows to OUR board cards. Pure functions.

Used by BOTH the access-test harness (report) and the Now worker (writes), so
the rule measured in the report is the rule that ships.

JOIN RULE 1 — FOUNDER RULING 2026-09-24T01:21Z, verbatim:
  "Match a stream fixture to a card on both player names, choosing the nearest
   fixture within ±24 h of the card's start time. Clock time is not a match
   condition. If two candidate fixtures qualify, match neither and log it.
   Unmatched rows are dropped and counted, never guessed. The routing-key
   league is a cross-check only."

  As a test someone can apply:
    * CANDIDATE = a Kibl fixture whose two players' surname keys are the card's
      two surname keys (either order), with no given-initial conflict on either
      pairing (ruling D), and whose Kibl scheduled start is within ±24 h of the
      card's start. A fixture with no scheduled start cannot be measured and is
      not a candidate.
    * Exactly one candidate -> matched. Two or more -> NEITHER, logged with
      names. Zero -> the card has no stream price.
    * One fixture that is the sole candidate of two cards -> NEITHER card.
  Exception, measured not assumed: Kibl lists some matches at the day's first
  session (02:00Z) 300–570 min before the card (6 of 20, run 35940618497); the
  ±24 h window is what keeps them. Clock time is never a match condition.

  Why not the ±day match_key: it keys on a calendar day, and a match near
  midnight lands on two different days on two feeds. The window has no edge.

WHAT A STREAM ROW CARRIES
  A fixture_id and no names (probe run 35937443000: 27 fields, no name, no
  league). Names come from Kibl's own fixture record (`kibl_fixtures`, else
  /info/fixtures). The card's `date`+`time` are api-tennis local time, UTC+2.

PRE-MATCH ONLY (ruled): market 1, segment 1 (Full Game), betting_type_id 1,
  is_live false. In-play rows (betting_type 3 or is_live true) are ignored.

SIDES
  Each Kibl side is placed on the card by NAME: a fixture's two
  fixture_participant_ids ordered ascending are Kibl's first- and second-named
  players (the card path's documented assumption, side_labels_for), and each is
  matched to the card player with the same surname key. A side that cannot be
  placed is reported, never guessed. Keys to the page are SURNAME keys, exactly
  as odds_card_state keys its sides (`ocsNameKey`).
"""
import collections
from datetime import datetime, timedelta, timezone

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from ten225_names import (  # noqa: E402
    match_key, name_key, nfd, split_kibl_fixture_name,
)

CARD_TZ = timezone(timedelta(hours=2))      # api-tennis event_time is UTC+2
WINDOW = timedelta(hours=24)                # ruling 1
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


def card_key(card):
    """The key the PAGE looks the card up by: ocsKeyOf(m) = ocsMatchKey(m.date, p1, p2).
    Parity with the JS is already pinned by test-ten225-ocs-key.mjs."""
    return match_key(card.get("date") or "", card.get("p1"), card.get("p2"))


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
            and r.get("betting_type_id") == 1 and r.get("is_live") is False)


def is_inplay(r):
    return r.get("betting_type_id") == 3 or r.get("is_live") is True


def real_price(r):
    p = r.get("price_decimal")
    try:
        p = float(p)
    except (TypeError, ValueError):
        return None
    return p if p >= MIN_REAL_PRICE else None


def _board_parts(name):
    """Our card's name -> (initials, surname tokens), accent-folded, lower-case.

    'C. Ugo Carabelli' -> (['c'], ['ugo', 'carabelli'])
    'J. M. Cerundolo'  -> (['j', 'm'], ['cerundolo'])
    'Van de Zandschulp, Botic' -> (['b'], ['van', 'de', 'zandschulp'])
    Leading one-letter tokens are initials; everything after them is surname.
    """
    raw = name or ""
    if "," in raw:
        sur, giv = raw.split(",", 1)
        return [t[0] for t in nfd(giv).split()], nfd(sur).split()
    toks = nfd(raw).split()
    i = 0
    while i < len(toks) - 1 and len(toks[i]) == 1:
        i += 1
    return [t[0] for t in toks[:i]], toks[i:]


def same_player(board, kibl):
    """NAME RULING, founder 2026-09-24T08:24Z: "extra given names on either side
    must not block a match." As a test someone can apply:

      * the board's FULL surname (every token after its initials) is the tail of
        Kibl's name — so compound surnames match whole: 'C. Ugo Carabelli' never
        matches 'Carlos Carabelli', 'P. Carreno Busta' never matches 'Pedro Busta';
      * and the board's first initial matches ANY of Kibl's given names —
        'D. Vallejo' matches 'Adolfo Daniel Vallejo' (the case that was missed);
      * a side with no initial, or a Kibl name with no given name, is not a
        conflict (unchanged from ruling D: one-sided absence never blocks).

    Supersedes, FOR THE STREAM JOIN, ruling D's "given-name initials conflict =
    drop" (which compared only Kibl's first given name). Exactly-one-candidate,
    ambiguity and ±24 h are unchanged and live in pick().
    """
    ini, sur = _board_parts(board)
    k = nfd(kibl or "").split()
    if not sur or len(k) < len(sur) or k[-len(sur):] != sur:
        return False
    givens = k[:-len(sur)]
    if not ini or not givens:
        return True
    return ini[0] in {g[0] for g in givens}


def _names_match(card, kp1, kp2):
    """Both players, either order, under same_player()."""
    c1, c2 = card.get("p1"), card.get("p2")
    s1, s2 = _board_parts(c1)[1], _board_parts(c2)[1]
    if not s1 or not s2 or s1 == s2 or not (kp1 and kp2):
        return False
    return ((same_player(c1, kp1) and same_player(c2, kp2))
            or (same_player(c1, kp2) and same_player(c2, kp1)))


def pre_match_cards(cards, now=None):
    """Cards still before their start (and not live/finished) — the denominator."""
    out = []
    for c in cards or []:
        st = card_start_utc(c)
        if st is None or c.get("finalScore") or c.get("live"):
            continue
        if now is not None and st < now:
            continue
        out.append(c)
    return out


def pick(cards, fixtures):
    """Ruling 1. cards: pre-match cards. fixtures: {fid: {name, scheduled_start}}.

    Returns {"by_fixture": {fid: card}, "by_card": {card_key: fid},
             "ambiguous": [...], "names_outside_24h": [...]}.
    """
    parsed = {}
    for fid, fx in fixtures.items():
        p1, p2 = split_kibl_fixture_name(fx.get("name"))
        if p1 and p2:
            parsed[fid] = (p1, p2, parse_ts(fx.get("scheduled_start")))
    choice, ambiguous, outside = {}, [], []
    for c in cards:
        st = card_start_utc(c)
        k = card_key(c)
        if st is None or not k:
            continue
        cands, far = [], []
        for fid, (p1, p2, sched) in parsed.items():
            if not _names_match(c, p1, p2):
                continue
            if sched is None or abs(sched - st) > WINDOW:
                far.append((fid, p1, p2, sched))
                continue
            cands.append((abs(sched - st), fid, p1, p2, sched))
        if len(cands) == 1:
            choice[k] = (c, cands[0][1])
        elif len(cands) > 1:
            ambiguous.append({"card": f"{c.get('p1')} vs {c.get('p2')}", "card_key": k,
                              "why": "two or more fixtures qualify",
                              "fixtures": [{"fixture_id": f, "fixture": f"{a} vs {b}",
                                            "kibl_scheduled": s.isoformat() if s else None}
                                           for _, f, a, b, s in sorted(cands)]})
        elif far:
            outside.append({"card": f"{c.get('p1')} vs {c.get('p2')}", "card_key": k,
                            "fixtures": [{"fixture_id": f, "fixture": f"{a} vs {b}",
                                          "kibl_scheduled": s.isoformat() if s else None}
                                         for f, a, b, s in far]})
    # A fixture chosen by two cards is ambiguous for BOTH.
    claims = collections.defaultdict(list)
    for k, (c, fid) in choice.items():
        claims[fid].append(k)
    by_fixture, by_card = {}, {}
    for fid, ks in claims.items():
        if len(ks) > 1:
            ambiguous.append({"card": " / ".join(f"{choice[k][0].get('p1')} vs {choice[k][0].get('p2')}"
                                                  for k in ks),
                              "card_key": ks, "why": "one fixture is the candidate of two cards",
                              "fixtures": [{"fixture_id": fid}]})
            continue
        by_fixture[fid] = choice[ks[0]][0]
        by_card[ks[0]] = fid
    return {"by_fixture": by_fixture, "by_card": by_card,
            "ambiguous": ambiguous, "names_outside_24h": outside}


def side_map(card, fixture_name, fpids):
    """{fixture_participant_id: (card_side 'p1'|'p2', surname_key)} for the sides
    that can be placed by name; {} when the fixture does not carry exactly two."""
    p1, p2 = split_kibl_fixture_name(fixture_name)
    fp = sorted(x for x in set(fpids) if x is not None)
    if len(fp) != 2 or not (p1 and p2):
        return {}
    out = {}
    # Placed by the same rule that joined the fixture (same_player), keyed by
    # the CARD's surname key — the key the page looks the side up by.
    for f, nm in zip(fp, (p1, p2)):
        if same_player(card.get("p1"), nm) and name_key(card.get("p1")):
            out[f] = ("p1", name_key(card.get("p1")))
        elif same_player(card.get("p2"), nm) and name_key(card.get("p2")):
            out[f] = ("p2", name_key(card.get("p2")))
    return out if len(out) == 2 and len({v[0] for v in out.values()}) == 2 else {}


def join(rows, cards, fixtures, openers=None, since=None):
    """Report view. rows: [(rec, row)] from the capture. cards: matches.json list.
    fixtures: {fixture_id: {"name", "scheduled_start", "league_id"}}.
    openers: {fixture_id: [archive is_opener match-winner rows]}.
    since: only cards scheduled at/after this instant are in the denominator.
    """
    openers = openers or {}
    pool = pre_match_cards(cards, since)
    chosen = pick(pool, fixtures)
    surnames_by_day = collections.defaultdict(set)
    for c in pool:
        for p in (c.get("p1"), c.get("p2")):
            nk = name_key(p)
            if nk:
                surnames_by_day[card_start_utc(c).date().isoformat()].add(nk)
    amb_fids = {f["fixture_id"] for a in chosen["ambiguous"] for f in a["fixtures"]}
    far_fids = {f["fixture_id"] for a in chosen["names_outside_24h"] for f in a["fixtures"]}

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
        base.update(fixture=fx.get("name") or "—", kibl_scheduled=fx.get("scheduled_start"))
        p1, p2 = split_kibl_fixture_name(fx.get("name"))
        if fid in chosen["by_fixture"]:
            matched[fid] = (chosen["by_fixture"][fid], fx, items)
        elif not (p1 and p2):
            buckets["name_not_two_singles_players"].append(base)
        elif fid in amb_fids:
            buckets["ambiguous_rule1"].append(base)
        elif fid in far_fids:
            buckets["names_match_outside_24h"].append(base)
        else:
            sched = parse_ts(fx.get("scheduled_start"))
            day = sched.date().isoformat() if sched else ""
            on_day = surnames_by_day.get(day, set())
            hit = name_key(p1) in on_day or name_key(p2) in on_day
            buckets["surname_on_board" if hit else "not_on_board"].append(base)

    per_card, disagreements = [], []
    for fid, (card, fx, items) in matched.items():
        tier = card_tier(card)
        want = TIER_LEAGUE.get(tier)
        rk = sorted({r.get("_league_id") for _, r in items if r.get("_league_id") is not None})
        if want is not None and rk and rk != [want]:
            disagreements.append({"fixture_id": fid, "card": f"{card.get('p1')} vs {card.get('p2')}",
                                  "card_tier": tier, "routing_key_league": rk})
        pre = [(rec, r) for rec, r in items if is_prematch_winner(r)]
        inplay = [(rec, r) for rec, r in items if is_inplay(r)]
        fpids = ({r.get("fixture_participant_id") for _, r in pre}
                 | {o.get("fixture_participant_id") for o in openers.get(fid, [])})
        sides = side_map(card, fx.get("name"), fpids)
        sched = parse_ts(fx.get("scheduled_start"))
        out = {"fixture_id": fid, "card": f"{card.get('p1')} vs {card.get('p2')}",
               "tier": tier, "card_start_utc": card_start_utc(card).isoformat(),
               "kibl_scheduled": fx.get("scheduled_start"),
               "start_delta_min": (round((card_start_utc(card) - sched).total_seconds() / 60.0, 1)
                                   if sched else None),
               "stream_rows": len(items), "prematch_winner_rows": len(pre),
               "inplay_rows": len(inplay), "sides_placed": len(sides),
               "open": {}, "now": {}, "updates": {}, "last_update": None,
               "last_received": None, "card_odds": card.get("odds")}
        for fp, (side, _) in sides.items():
            mine = [r for _, r in pre if r.get("fixture_participant_id") == fp]
            cur = [r for r in mine if r.get("is_current") and real_price(r) is not None]
            out["updates"][side] = len(mine)
            if cur:
                last = max(cur, key=lambda r: parse_ts(r.get("inserted_on"))
                           or datetime.min.replace(tzinfo=timezone.utc))
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

    tiers = collections.Counter(card_tier(c) for c in pool)
    found = collections.Counter(p["tier"] for p in per_card)
    priced = collections.Counter(p["tier"] for p in per_card if p["prematch_winner_rows"])
    return {"cards_in_denominator": len(pool), "cards_by_tier": dict(tiers),
            "cards_with_kibl_fixture": len(chosen["by_card"]),
            "cards_with_stream_rows_by_tier": dict(found),
            "cards_with_prematch_price_by_tier": dict(priced),
            "ambiguous_rule1": chosen["ambiguous"],
            "names_match_outside_24h": chosen["names_outside_24h"],
            "stream_fixtures": len(by_fx), "matched_fixtures": len(matched),
            "unmatched": {k: v for k, v in buckets.items()},
            "unmatched_rows": {k: sum(x["rows"] for x in v) for k, v in buckets.items()},
            "league_disagreements": disagreements,
            "per_card": sorted(per_card, key=lambda p: -p["prematch_winner_rows"])}


def report_lines(res, n_sample=10):
    """Markdown for the report. Missing is an em dash, never 0."""
    D = lambda v: "—" if v in (None, {}, []) else v  # noqa: E731
    L = ["## TEN-270 · Stream rows → our board cards (ruling 1: names, nearest within ±24 h)", ""]
    n = res["cards_in_denominator"]
    L.append(f"Denominator: **{n}** pre-match cards on the live board, by our tier "
             f"{res['cards_by_tier'] or '—'}. Cards with exactly one Kibl fixture under ruling 1: "
             f"**{res['cards_with_kibl_fixture']} of {n}**.")
    L.append("")
    L.append("| tier (from our card) | cards | with any stream row | with a pre-match match-winner price |")
    L.append("|---|---:|---:|---:|")
    for t in sorted(set(res["cards_by_tier"]) | {"ATP", "ITF"}):
        c = res["cards_by_tier"].get(t, 0)
        if c == 0:
            L.append(f"| {t} | 0 | — | — |")
        else:
            a = res["cards_with_stream_rows_by_tier"].get(t, 0)
            b = res["cards_with_prematch_price_by_tier"].get(t, 0)
            L.append(f"| {t} | {c} | {a} of {c} | {b} of {c} |")
    L.append("")
    L.append("### Ambiguous under ruling 1 — matched to NEITHER")
    if not res["ambiguous_rule1"]:
        L.append(f"None, on {n} card(s).")
    for a in res["ambiguous_rule1"]:
        L.append(f"- ⚠️ {a['card']} — {a['why']}: "
                 + "; ".join(f"`{f['fixture_id']}` {f.get('fixture', '')} {f.get('kibl_scheduled') or ''}".strip()
                             for f in a["fixtures"]))
    if res["names_match_outside_24h"]:
        L.append("")
        L.append("Names match but Kibl's start is more than 24 h from the card (not matched):")
        for a in res["names_match_outside_24h"]:
            L.append(f"- {a['card']}: " + "; ".join(f"`{f['fixture_id']}` {f.get('kibl_scheduled') or '—'}"
                                                   for f in a["fixtures"]))
    L.append("")
    L.append(f"Stream fixtures seen: **{res['stream_fixtures']}**; matched to a card: "
             f"**{res['matched_fixtures']}**.")
    L.append("")
    L.append("### Unmatched stream fixtures — dropped and counted, never guessed")
    L.append("| bucket | fixtures | rows |")
    L.append("|---|---:|---:|")
    for b, v in sorted(res["unmatched"].items()):
        L.append(f"| {b} | {len(v)} | {res['unmatched_rows'][b]} |")
    for b in ("surname_on_board", "ambiguous_rule1", "names_match_outside_24h",
              "name_not_two_singles_players", "not_on_board"):
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
                 f"{D(p['last_update'])} | {p['inplay_rows']} | {D(p['start_delta_min'])} |")
    if not res["per_card"]:
        L.append("| — | — | — | — | — | — | — | — |")
    return L
