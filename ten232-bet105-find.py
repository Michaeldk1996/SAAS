#!/usr/bin/env python3
"""TEN-225 / TEN-232 — FIND BET105, and measure what it has already touched.

Founder directive 2026-09-18T22:01Z. Two corrections arrived with it:

  * The book we have been pulling through Kibl is called **Sports411** and it is
    NOT Bet105. `ten225-kibl-card-state.py:75` already recorded that
    (`BOOK = 'sports411'  # NOT Bet105 (measured)`), so the code and the founder
    now agree.
  * Bet105 has just been activated as a SEPARATE feed source on the account.

This script answers item 1 (find the id) and, in the same read, the question
item 1 does not ask but item 7 depends on:

    HAS BET105 ALREADY REACHED SOMETHING?

It can have. `archive-kibl.py:run_window()` does not hard-code a book — it reads
`/reference/sportsbooks` every sweep and sends EVERY entitled `feed_source_id`,
comma-joined, deliberately, "so a change in entitlement shows up as more data
rather than as a silent miss". That is the right design and it means the sweep
began capturing Bet105 the moment the account was changed, with no deploy.

The hazard is one level up. `kibl_line_observations` stores `feed_source_id` per
row, so the ARCHIVE can tell the two books apart. `ten225-kibl-card-state.py`
does not read that column at all and stamps the constant `sports411` on every
row it projects. If Bet105 rows are in the table, the card path cannot see that
they are not Sports411 — which breaks item 7 (no Bet105 price on a card until
the side-mapping gate passes) and item 2 (nothing may read as the wrong book) at
once, silently, on a green run.

So this refuses to report a clean answer it did not earn:

  * NO GUESSED ID. If Bet105 is absent from /reference/sportsbooks this says so
    and exits non-zero. An id we inferred is an id we would archive under.
  * It fails if it assessed nothing. A probe that reads zero rows and prints
    "0 Bet105 rows" is indistinguishable from one that read the table and found
    none, and this repo has already shipped that exact false clean once.
  * Every count is an exact PostgREST count, not a page length.

Read-only. No Kibl write, no Supabase write, no card, no publish.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def supabase_creds():
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = (os.environ.get("SUPABASE_SECRET_KEY") or "").strip()
    if not url or not key:
        print("::error::SUPABASE_URL / SUPABASE_SECRET_KEY are not both set.")
        sys.exit(1)
    return url, key


def sb_count(url, key, table, query=""):
    """(err, exact_count). PostgREST returns the count in Content-Range only."""
    h = {"Authorization": f"Bearer {key}", "apikey": key,
         "User-Agent": "BSP-Consult-Dashboard/1.0",
         "Prefer": "count=exact", "Range": "0-0"}
    req = urllib.request.Request(
        f"{url}/rest/v1/{table}?select=*{query}", headers=h, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            cr = r.headers.get("Content-Range") or ""
            r.read()
    except urllib.error.HTTPError as e:
        return (e.code, e.read()[:200].decode("utf-8", "replace")), None
    except Exception as e:  # noqa: BLE001
        return (None, str(e)), None
    total = cr.rsplit("/", 1)[-1] if "/" in cr else ""
    return None, (int(total) if total.isdigit() else None)

# ---------------------------------------------------------------- the id we own
# Sports411 is the book this account has been served since 2026-09-17 and every
# price captured under it keeps that label forever (founder item 2). Its id is
# NOT hard-coded as a filter anywhere — it is read from the API — but it is
# pinned here so a SWAP (Bet105 arriving on the id we already archived under)
# is a loud failure rather than a relabel of history.
KNOWN_SPORTS411_NAME_RE = re.compile(r"sports\s*411|sports411", re.I)
BET105_NAME_RE = re.compile(r"bet\s*105|bet105", re.I)


def out(k, v):
    print(f"{k}={v}")


def main():
    from kibl_client import KiblClient

    print("## TEN-232 — Bet105 discovery\n")

    # ------------------------------------------------- item 1: the book list
    c = KiblClient()
    payload, meta = c.get("/reference/sportsbooks")
    if meta["status"] != 200:
        print(f"::error::/reference/sportsbooks HTTP {meta['status']}")
        return 1
    books = [b for b in c.rows(payload) if isinstance(b, dict)]

    # A probe that assessed nothing must not read as a clean negative.
    if not books:
        print("::error::/reference/sportsbooks returned ZERO rows. That is not "
              "'Bet105 is absent' — it is 'we did not read the entitlement'. "
              "Refusing to report either way.")
        return 1

    print(f"### `/reference/sportsbooks` — {len(books)} book(s)\n")
    print("| feed_source_id | name | other fields |")
    print("|---|---|---|")
    for b in sorted(books, key=lambda r: (r.get("feed_source_id") or 0)):
        fsid = b.get("feed_source_id")
        name = b.get("name") or b.get("sportsbook_name") or "?"
        rest = {k: v for k, v in sorted(b.items())
                if k not in ("feed_source_id", "name")}
        print(f"| {fsid} | {name} | `{json.dumps(rest)}` |")
    print()

    by_name = {}
    for b in books:
        nm = str(b.get("name") or b.get("sportsbook_name") or "")
        by_name[nm] = b.get("feed_source_id")

    bet105 = [b for b in books
              if BET105_NAME_RE.search(str(b.get("name") or
                                            b.get("sportsbook_name") or ""))]
    s411 = [b for b in books
            if KNOWN_SPORTS411_NAME_RE.search(str(b.get("name") or
                                                  b.get("sportsbook_name") or ""))]

    out("books_total", len(books))
    out("book_names", "|".join(sorted(by_name)))

    if not bet105:
        print("### ❌ BET105 DOES NOT APPEAR\n")
        print("Saying it plainly, as instructed. `/reference/sportsbooks` is the "
              "entitlement — a restricted account returns 200 with fewer rows, "
              "never a 403 — so this IS the answer, not a failed call. "
              "**No id guessed. Stopping.**\n")
        out("bet105_found", "no")
        return 2

    if len(bet105) > 1:
        print(f"::error::{len(bet105)} rows match Bet105 — ambiguous, not "
              "guessing which. Rows: "
              f"{json.dumps([b.get('feed_source_id') for b in bet105])}")
        return 1

    b105_id = bet105[0].get("feed_source_id")
    s411_id = s411[0].get("feed_source_id") if s411 else None
    out("bet105_found", "yes")
    out("bet105_feed_source_id", b105_id)
    out("sports411_feed_source_id", s411_id)

    if s411_id is not None and b105_id == s411_id:
        print("::error::Bet105 and Sports411 report the SAME feed_source_id "
              f"({b105_id}). Every row already archived under it would be "
              "relabelled by any rule keyed on the id. Stopping.")
        return 1

    print(f"### ✅ Bet105 = `feed_source_id {b105_id}`"
          f" · Sports411 = `feed_source_id {s411_id}`\n")

    # ------------------------------- has it already landed, and under what label
    url, key = supabase_creds()

    print("### What the archive already holds, per feed_source_id\n")
    print("| feed_source_id | book | rows in kibl_line_observations |")
    print("|---|---|---|")
    total_seen = 0
    per_book = {}
    for b in sorted(books, key=lambda r: (r.get("feed_source_id") or 0)):
        fsid = b.get("feed_source_id")
        nm = b.get("name") or b.get("sportsbook_name") or "?"
        err, n = sb_count(url, key, "kibl_line_observations",
                          f"&feed_source_id=eq.{fsid}")
        if err:
            print(f"::error::count for feed_source_id {fsid} failed: {err}")
            return 1
        per_book[fsid] = n or 0
        total_seen += (n or 0)
        print(f"| {fsid} | {nm} | {n} |")

    err, grand = sb_count(url, key, "kibl_line_observations")
    if err:
        print(f"::error::total count failed: {err}")
        return 1
    err, nullfs = sb_count(url, key, "kibl_line_observations",
                           "&feed_source_id=is.null")
    if err:
        print(f"::error::null feed_source_id count failed: {err}")
        return 1
    print(f"| (null) | — | {nullfs} |")
    print(f"\n**Total rows: {grand}.**\n")

    # The check that makes the zero above mean something.
    if grand in (None, 0):
        print("::error::kibl_line_observations is EMPTY. Every per-book zero "
              "above is therefore 'we read nothing', not 'Bet105 has not "
              "landed'. Refusing to report a clean negative.")
        return 1

    out("bet105_rows_archived", per_book.get(b105_id, 0))
    out("sports411_rows_archived", per_book.get(s411_id, 0))
    out("rows_total", grand)

    # ------------------------------------------- the labelling blast radius
    print("### Item 2 — is anything already reading as the wrong book?\n")
    b105_rows = per_book.get(b105_id, 0)
    if b105_rows:
        print(f"⚠️ **{b105_rows} Bet105 rows are already in the archive.** The "
              "sweep captured them without a deploy, because it sends every "
              "entitled feed_source_id. That is item 3 satisfied for those "
              "rows — and it is also the item 7 exposure, because "
              "`ten225-kibl-card-state.py` reads the observation table WITHOUT "
              "`feed_source_id` and stamps the constant `sports411`.\n")
    else:
        print("No Bet105 rows in the archive yet (the table is non-empty, so "
              "this is a real zero, not an unread one). The next sweep after "
              "activation is the one that changes it.\n")

    err, ocs_total = sb_count(url, key, "odds_card_state", "&book=eq.sports411")
    if err:
        print(f"::warning::odds_card_state count failed: {err}")
    else:
        print(f"`odds_card_state` rows labelled **sports411**: **{ocs_total}**. "
              "Every one of them was projected by a filler that cannot "
              "distinguish the two books, so that label is only trustworthy for "
              "rows written while Bet105 had zero rows in the archive.\n")
        out("ocs_sports411_rows", ocs_total)

    return 0


if __name__ == "__main__":
    sys.exit(main())
