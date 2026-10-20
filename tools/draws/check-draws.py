#!/usr/bin/env python3
"""Staleness checks for draws.json (founder brief 2026-10-20, C16 + C17). Exit 1 = a visible failure, never a green badge.

    python3 tools/draws/check-draws.py --board matches.json [--draws draws.json] [--calendar …] [--now ISO]
                                       [--last-fetch-run ISO]   # when the draw fetcher last ran successfully

A board tournament is ACTIVE when today falls inside its calendar week (start − 2 days … end). For each one:
  F1  no ATP id in the calendar                                   → fail ("no id")
  F2  main-draw matches have started on the board but draws.json has no posted main draw → fail
  F3  the draw's content has not changed for 24 h while the board shows a main-draw match completed AFTER that change
      → fail ("source stopped updating, or the fetcher is not running")
and across the board:
  F4  zero draws posted while at least one board tournament is active → fail
  F5  --last-fetch-run older than 6 h while any board tournament is active → fail ("fetcher not running") — this is what
      separates a sleeping/offline fetcher host from a dead source: the source can be fine and the run still red.
Nothing to check (no active board tournament) prints SKIP and exits 0 — said out loud, not a vacuous pass.
"""
import argparse, datetime, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
STALE_H = 24
FETCH_STALE_H = 6


def iso(s):
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    d = datetime.datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)


def board_tournaments(board):
    """{'Almaty': [match, …]} from matches.json `tour` ('ATP Almaty'), main draw only (qualifying is never carded)."""
    out = {}
    for m in board:
        if m.get("qualifying"):
            continue
        name = str(m.get("tour") or "").replace("ATP ", "", 1).strip()
        if name:
            out.setdefault(name, []).append(m)
    return out


def calendar_for(cal, name, today):
    # The board names an event by its feed city ("Paris"); the calendar city can be the venue's ("Nanterre" for the
    # 2026 Paris Masters) — so the article title counts too, as a whole word ("2026 Rolex Paris Masters").
    word = re.compile(r"\b" + re.escape(name.lower()) + r"\b")
    hits = [t for t in cal["tournaments"] if (t.get("city") or "").lower() == name.lower() or word.search((t.get("article") or "").lower())]
    def live(t):
        if not t.get("startDate") or not t.get("endDate"):
            return False
        return datetime.date.fromisoformat(t["startDate"]) - datetime.timedelta(days=2) <= today <= datetime.date.fromisoformat(t["endDate"])
    act = [t for t in hits if live(t)]
    return act[0] if len(act) == 1 else (None if not hits else "inactive")


def started(m):
    return str(m.get("id", "")).startswith("past-") or bool(m.get("live")) or bool(m.get("finalScore"))


def completed_at(m):
    if not str(m.get("id", "")).startswith("past-") or not m.get("finalScore") and not m.get("retired") and not m.get("walkover"):
        return None
    return iso(m.get("finishedAt")) or (iso(m["date"] + "T23:59:59Z") if m.get("date") else None)


def run(board, draws, cal, now, last_fetch_run=None):
    today = now.date()
    fails, notes, active = [], [], []
    for name, ms in sorted(board_tournaments(board).items()):
        t = calendar_for(cal, name, today)
        if t == "inactive":
            continue
        if t is None:
            # Only an event actually in play this week can fail for a missing id.
            if any(m.get("date") and abs((datetime.date.fromisoformat(m["date"]) - today).days) <= 3 for m in ms):
                fails.append(f"F1 {name}: on the board this week but has no ATP id in the calendar")
            continue
        active.append(name)
        e = draws.get("tournaments", {}).get(str(t["atpId"]))
        main = (e or {}).get("main") or {}
        if main.get("status") != "posted":
            if any(started(m) for m in ms):
                fails.append(f"F2 {name} ({t['atpId']}): main-draw matches have started but no draw is posted ({main.get('status', 'absent')})")
            else:
                notes.append(f"{name}: draw not posted yet, no main-draw match started — fine")
            continue
        changed = iso(e.get("contentChangedAt"))
        newer = [m for m in ms if completed_at(m) and changed and completed_at(m) > changed]
        if changed and now - changed > datetime.timedelta(hours=STALE_H) and newer:
            fails.append(f"F3 {name} ({t['atpId']}): draw unchanged since {e['contentChangedAt']} (> {STALE_H} h) while "
                         f"{len(newer)} main-draw match(es) completed after it — source stopped updating, or the fetcher is not running")
    posted = sum(1 for e in draws.get("tournaments", {}).values() if ((e.get("main") or {}).get("status") == "posted"))
    if active and posted == 0:
        fails.append(f"F4 zero draws posted while {len(active)} board tournament(s) are active: {', '.join(active)}")
    if active and last_fetch_run is not None and now - last_fetch_run > datetime.timedelta(hours=FETCH_STALE_H):
        fails.append(f"F5 the draw fetcher last ran {last_fetch_run.isoformat()} (> {FETCH_STALE_H} h ago) during an active week — host asleep/offline or job disabled")
    return active, fails, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--board", required=True)
    ap.add_argument("--draws", default=os.path.join(REPO, "draws.json"))
    ap.add_argument("--calendar", default=os.path.join(HERE, "calendar-2026.json"))
    ap.add_argument("--now")
    ap.add_argument("--last-fetch-run")
    a = ap.parse_args()
    now = iso(a.now) if a.now else datetime.datetime.now(datetime.timezone.utc)
    draws = json.load(open(a.draws)) if os.path.exists(a.draws) else {"tournaments": {}}
    active, fails, notes = run(json.load(open(a.board)), draws, json.load(open(a.calendar)), now, iso(a.last_fetch_run))
    if not active and not fails:
        print("SKIP: no board tournament is in an active week — nothing to check")
        return 0
    for n in notes:
        print("  note", n)
    for f in fails:
        print("  FAIL", f)
    print(f"draw staleness: {len(active)} active board tournament(s), {len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
