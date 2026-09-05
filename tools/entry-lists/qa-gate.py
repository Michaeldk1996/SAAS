#!/usr/bin/env python3
"""
TEN-150 Entry-Lists data-QA gate  (FAIL-CLOSED).

Validates entry_lists.json against the v1 schema. Exposed as validate(path)
(used by build-entry-lists.py against its temp file before atomic publish) and
runnable standalone against the committed entry_lists.json (e.g. in CI):

    python3 tools/entry-lists/qa-gate.py [path/to/entry_lists.json]

Exit code 0 = PASS, non-zero = FAIL. On FAIL the build never overwrites the
prior good entry_lists.json, so a bad scrape can never publish.
"""

import os
import re
import sys
import json
import math

KNOWN_SURFACES = {"Hard", "Clay", "Grass", "Carpet"}
VALID_SECTION_TITLES = {"Main Draw", "Qualifying"}
PLAYER_KEYS = {"name", "rank", "country", "status", "playerKey"}

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_PATH = os.path.join(REPO_ROOT, "entry_lists.json")


def _has_nan(x):
    if isinstance(x, float):
        return math.isnan(x) or math.isinf(x)
    if isinstance(x, dict):
        return any(_has_nan(v) for v in x.values())
    if isinstance(x, list):
        return any(_has_nan(v) for v in x)
    return False


def validate(path):
    """Return (ok: bool, summary: str)."""
    errors = []
    try:
        with open(path) as f:
            data = json.load(f)
    except Exception as e:
        return False, f"QA GATE: FAIL\n  - could not read/parse {path}: {e!r}"

    if _has_nan(data):
        errors.append("document contains NaN/Infinity")

    for k in ("generatedAt", "source", "tournaments"):
        if k not in data:
            errors.append(f"missing top-level key: {k}")

    if not isinstance(data.get("generatedAt"), str) or not data.get("generatedAt"):
        errors.append("generatedAt must be a non-empty string")
    if data.get("source") != "protennislive":
        errors.append("source must be 'protennislive'")

    tours = data.get("tournaments")
    total_players = 0
    total_md = total_q = 0
    if not isinstance(tours, list) or len(tours) == 0:
        errors.append("tournaments must be a non-empty list")
        tours = []

    n_active = n_pending = 0
    for ti, t in enumerate(tours):
        tag = f"tournament[{ti}] id={t.get('tournamentId')!r}"
        for k in ("tour", "tournamentId", "counts", "sections"):
            if k not in t:
                errors.append(f"{tag}: missing key {k}")

        # weekStart, when present, must be an ISO date (drives the week rail).
        ws = t.get("weekStart")
        if ws is not None and not (isinstance(ws, str)
                                   and re.match(r"^\d{4}-\d{2}-\d{2}$", ws)):
            errors.append(f"{tag}: weekStart must be YYYY-MM-DD or null (got {ws!r})")

        status = t.get("status", "active")
        if status not in ("active", "pending"):
            errors.append(f"{tag}: status {status!r} not in ('active','pending')")
        is_pending = status == "pending"
        if is_pending:
            n_pending += 1
        else:
            n_active += 1

        surface = t.get("surface")
        if surface is not None and surface not in KNOWN_SURFACES:
            errors.append(f"{tag}: surface {surface!r} not in {sorted(KNOWN_SURFACES)} or null")

        counts = t.get("counts", {})
        if not isinstance(counts, dict):
            errors.append(f"{tag}: counts must be an object")
            counts = {}
        for ck in ("MD", "Q", "ALT"):
            v = counts.get(ck)
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                errors.append(f"{tag}: counts.{ck} must be a non-negative int (got {v!r})")

        sections = t.get("sections")
        if is_pending:
            # a pending tournament legitimately has no acceptance list yet;
            # it must carry NO players (never a fabricated MD 0 with rows).
            if sections:
                errors.append(f"{tag}: pending tournament must have empty sections")
            if counts.get("MD") or counts.get("Q") or counts.get("ALT"):
                errors.append(f"{tag}: pending tournament must have zero counts")
            continue
        if not isinstance(sections, list) or len(sections) == 0:
            errors.append(f"{tag}: sections must be a non-empty list")
            sections = []

        t_players = 0
        for si, s in enumerate(sections):
            stag = f"{tag} section[{si}]"
            title = s.get("title")
            if title not in VALID_SECTION_TITLES:
                errors.append(f"{stag}: title {title!r} not in {sorted(VALID_SECTION_TITLES)}")
            players = s.get("players")
            if not isinstance(players, list):
                errors.append(f"{stag}: players must be a list")
                players = []
            n_named = 0
            for pi, p in enumerate(players):
                if not isinstance(p, dict):
                    errors.append(f"{stag} player[{pi}]: not an object")
                    continue
                missing = PLAYER_KEYS - set(p.keys())
                if missing:
                    errors.append(f"{stag} player[{pi}]: missing keys {sorted(missing)}")
                if not p.get("name"):
                    errors.append(f"{stag} player[{pi}]: empty name")
                r = p.get("rank")
                if r is not None and (not isinstance(r, int) or isinstance(r, bool) or r <= 0):
                    errors.append(f"{stag} player[{pi}]: rank must be a positive int or null (got {r!r})")
                if p.get("name") and p.get("name") != "Bye":
                    n_named += 1
            t_players += len(players)
            if title == "Main Draw":
                total_md += len(players)
            elif title == "Qualifying":
                total_q += len(players)

        # each tournament must have >=1 section with >=1 player
        if t_players == 0:
            errors.append(f"{tag}: has no players in any section")
        total_players += t_players

    # a shard that scraped nothing real (all-pending / empty) must not publish.
    if n_active == 0:
        errors.append("no active tournaments with players (all pending/empty) "
                      "-- refusing to publish a contentless shard")

    ok = len(errors) == 0
    if ok:
        summary = (
            "QA GATE: PASS\n"
            f"  tournaments validated : {len(tours)} ({n_active} active, {n_pending} pending)\n"
            f"  main-draw players     : {total_md}\n"
            f"  qualifying players    : {total_q}\n"
            f"  total player rows     : {total_players}\n"
            f"  surfaces              : {sorted({t.get('surface') for t in tours})}"
        )
    else:
        summary = "QA GATE: FAIL\n" + "\n".join(f"  - {e}" for e in errors[:40])
        if len(errors) > 40:
            summary += f"\n  ... (+{len(errors) - 40} more)"
    return ok, summary


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    ok, summary = validate(path)
    print(summary)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
