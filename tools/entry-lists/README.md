# Entry-Lists scraper (TEN-150, v1)

Staged, behind feature flag `FEATURE_ENTRY_LISTS`. **Nothing here is live yet.**
Scrapes per-tournament ATP acceptance lists (main-draw + qualifying singles)
from protennislive.com, parses them into a stable JSON schema, and publishes
`entry_lists.json` at the repo root — but only if a fail-closed QA gate passes.

## Run

```bash
python3 tools/entry-lists/build-entry-lists.py     # fetch + parse + gate + publish
python3 tools/entry-lists/qa-gate.py               # re-validate committed entry_lists.json (CI)
```

Requires `pymupdf` (`pip3 install pymupdf`; `import fitz`). No API key needed.

## Source / PDF mechanics

protennislive.com serves per-tournament PDFs at:

```
https://www.protennislive.com/posting/<YEAR>/<TOURNAMENT_ID>/<TYPE>.pdf
  mds.pdf  Main Draw Singles   (the main-draw acceptance list)
  qs.pdf   Qualifying Singles  (the qualifying acceptance list)
  ds.pdf   tournament INFO/fact sheet (surface, schedule, prize — NOT parsed here)
  mdd.pdf  doubles — IGNORED (singles only)
```

Cloudflare blocks the HTML pages but **not** the PDF assets: they return
`HTTP 200 application/pdf` to a plain browser User-Agent. We fetch with a Chrome
UA and parse text via `fitz` `page.get_text()`.

Header line (pipe-delimited, on both mds/qs):
`17 August — 22 August 2026 | EURO 97 640 | Clay | Challenger 75`
→ `week_label | prize | surface | tier`. **Masters** headers omit the tier
field (only 3 parts) — we fall back to the seed `tier` from `tournaments.json`.
Tournament name and `City, Country` are the two lines directly above it.

Player rows are position-anchored and multi-line: a position number, an optional
status/seed token (may be a bare seed `11`, a word `WC`/`Alt`/`Alt 2`/`Q`/`PR`/
`SE`/`NG`/`LL`, or glued to the name as `WC32 RICE, Keegan`), then
`SURNAME, First` (sometimes truncated with `…`, sometimes with the 3-letter IOC
code glued on), then an optional IOC country line. `Bye` rows appear in seeded
main draws. Ranks + fuller names are recovered from the `Seeded Players` section.

## Input: which tournaments to scrape

`tournaments.json` — a committed SEED map (`{tour, id, tier, note}` per entry).
This is the pluggable ID source. Full weekly auto-enumeration of tournament IDs
is a **separate task** (see TODOs).

## Output schema (`entry_lists.json`)

```jsonc
{
  "generatedAt": "2026-09-04T...Z",
  "source": "protennislive",
  "tournaments": [{
    "tour": "ATP",
    "tournamentId": "600",
    "name": "Sekyra Group Prague Open 2026 ...",
    "city": "Prague",
    "country": "Czech Republic",
    "week_label": "17 August — 22 August 2026",
    "tier": "Challenger 75",
    "surface": "Clay",            // one of Hard/Clay/Grass/Carpet or null
    "counts": { "MD": 32, "Q": 24, "ALT": 5 },
    "sections": [{
      "title": "Main Draw",       // or "Qualifying"
      "players": [{
        "name": "KRUTYKH, Oleksii",
        "rank": 526,              // ATP rank if known (from Seeded Players), else null
        "country": "UKR",         // IOC 3-letter, or null if the PDF omitted it
        "status": "SEED",         // DA|SEED|WC|Q|ALT|PR|LL|BYE (+ SE/NG seen in the wild)
        "playerKey": "1056"       // our internal key, or null if unmatched
      }]
    }]
  }]
}
```

`counts`: `MD` = main-draw section size (byes included), `Q` = qualifying
section size, `ALT` = number of alternates listed.

**Name → player key.** `player-profiles.json` stores `"<Initial>. <Surname>"` +
full country. We match on surname (case-insensitive) + first-initial, using a
small IOC-3 → country-name map to disambiguate collisions. Most challenger /
qualifying players won't match (they're outside our 428-player universe) — that
is expected. Current hit-rate across the 3 seed tournaments: ~66%.

## Fail-closed contract

`build-entry-lists.py` writes the scrape to a **temp file**, runs
`qa-gate.py::validate()` on it, and only `os.replace()`s the committed
`entry_lists.json` if the gate PASSes. On any gate failure it removes the temp
file, leaves the prior good `entry_lists.json` untouched, and exits non-zero.
A bad scrape can therefore never publish. The gate checks: required keys,
non-empty tournaments, ≥1 section with ≥1 player per tournament, non-negative
integer counts, surface ∈ {Hard,Clay,Grass,Carpet} or null, positive-int-or-null
ranks, no NaN/Infinity.

If a tournament's `mds.pdf` 404s we still emit its `qs.pdf`; if both 404 it is
skipped and recorded in the run report (printed to stdout).

## Known rough edges (v1)

- **Truncated names** (`…`) that are not in the Seeded Players section cannot be
  de-truncated (e.g. `MPETSHI PERRICARD, G…`, `VAN DE ZANDSCHULP, B…`). Seeded
  players are recovered; ~8 non-seeded truncations remain across the 3 seeds.
- **Missing country**: the PDF occasionally omits the IOC line even for top
  players (e.g. Medvedev, Khachanov) → `country: null`.
- Non-standard entry tokens `SE` (special exempt) and `NG` pass through as-is in
  `status` (not in the canonical 8-value set).
- Only ATP is wired; WTA/ITF IDs untested.

## TODO

- [ ] **Tournament-ID auto-enumeration** per week/tier/tour (separate task) to
      replace the hand-seeded `tournaments.json`.
- [ ] Wire into a **daily launchd cron** alongside the existing career-splits /
      playing-styles refresh jobs (`tools/refresh-*.sh`).
- [ ] Build the **Entry Lists frontend page** (static route) reading
      `entry_lists.json`.
- [ ] Gate the page + data behind **`FEATURE_ENTRY_LISTS`**.
- [ ] WTA / ITF coverage; doubles (currently ignored).
