# Pipeline — win/loss records: counting, walkovers, retirements

Applies to every W/L record built from the api-tennis archive in `bsp-pipeline.js` (`buildAllTierYearly`,
`playerMatchHistory`, `seasonSurfaceByTier`, `seasonRowFromFixtures`, `courtSpeedRecordFromFixtures`,
`recentFormFromFixtures`, `fetchPlayerCareerHistory`) and the surfaces that render them.
Restored from CLAUDE.md before 011e3e20 (2026-09-21 trim); TEN-312 N13, founder-approved 2026-09-28.
Where this file conflicts with `modal-analysis.md` (TEN-312, 2026-09-28), that file wins.

- **Records match Tennis Explorer, minus exhibitions (founder ruling TEN-443, 2026-10-17, gate `91feaca9`;
  replaces "Records must match Flashscore", 2026-08-04).** The reference for every win/loss record is the
  player's Tennis Explorer (TE) page, table "Player's record W/L – singles" (Summary · Clay · Hard · Indoors ·
  Grass · Not set), all seasons, pre-2021 included. TE's counting rules, read off its pages (TEN-443 doc
  `report` §2), apply with ONE change: exhibitions and club matches are not counted.
  - **Counted:** every decided professional singles match at ATP, Challenger and ITF level, **any round
    including qualifying**; Davis Cup, ATP Cup, United Cup, Laver Cup, Hopman Cup, Olympics; retirements (rule
    below). No `event_qualification`/main-draw gate in any archive-record builder.
  - **Not counted:** walkovers (rule below); **junior events** (api-tennis `event_type_type` "Boys Singles" —
    decide on the event type, not the name: 1,084 of 1,464 such rows carry a plain Slam name, and a Slam name at
    `chitf` level is the tell); **exhibitions and club matches** (UTR Pro Tennis Series, Boodles, Hurlingham,
    Adria Tour, Ultimate Tennis Showdown, Diriyah, Six Kings, Bundesliga/interclub, national championships).
  - **Season = TE's edition year:** a tie played in late December of an event whose edition is the next
    year (United Cup, ATP Cup, Hopman Cup) counts in the next season.
  - **Indoors = TE's court class** for the event; Hard is outdoor hard.
  - **A pre-2021 figure may rise to the match count** (the provider aggregate undercounts Challenger-era
    players: N. Borges 2019 counted 3, 21 on record). Every moved cell is reported to the founder, old → new,
    before it goes live.
  - *Exceptions:* the Match analysis **Tournament tab** W–L stays **main draw only** (TEN-312 N7,
    2026-09-28). Provider-aggregate stats (career/surface win %) and Tennis-Abstract career splits are separate
    sources, not forced to this rule. The no-surface column (TE "Not set") is **pending a ruling** (TEN-443
    step 2): until then Option A of TEN-442 stands.
  - *Source (founder's call against TE's terms §2.2/§2.10/§2.11, risk reported):* TE pages come only from
    `tools/te-scrape.mjs` — one request at a time ≥ 8 s apart, every page cached in `~/.stennisfy/te-cache`,
    a past season never fetched twice, run on this Mac and never in CI or the nightly refresh; a player is
    joined to a TE page only on his date of birth (age ± 1 where no DOB is on record), never on a name alone.
  **Test:** for any profiled player, every Record-by-season cell (Total and each surface, every season and
  Career) equals TE's same cell minus TE's exhibition and club matches in it; no junior, walkover or
  exhibition row is in any count; a 29–31 Dec United Cup tie counts in the next season; nothing in
  `.github/` or the pipeline requests tennisexplorer.com.

- **Walkovers — current rule (TEN-312 N2, founder 2026-09-28): a walkover is neither a win nor a loss, for
  either player, on every surface, the player profile included.** It is not a match played and never enters
  a W–L, a set count, a rate, a hot line or a price population; it may appear as a row only where the design
  lists results, marked "w/o", excluded from every count on that page. Canonical text:
  `modal-analysis.md` "Walkovers and retirements — every tab". This **replaces** the 2026-08-04 ruling "a
  pre-match walkover a player GAVE is NOT a loss" and its "a walkover RECEIVED is still a win" clause (the
  TEN-8 / Flashscore convention); that clause is superseded and must not be implemented. Carried over from
  the 2026-08-04 ruling because it does not conflict: detect a walkover on the feed's
  `event_status === 'Walk Over'`, **never** on an empty scoreline (a retirement the provider stored with no
  partial score would else be misread). Note: the shared predicate `isWalkoverGiven(f, won)` covers only the
  given side; the current rule needs the received side excluded too.

- **Retirements count as matches (founder ruling 2026-08-04, restated TEN-312 N2 2026-09-28).** An
  **in-match `Retired`** (he quit mid-match) is still a **loss** for the retiree and a win for the opponent,
  marked "ret."; its unfinished set is excluded from set tallies, deciding sets and games/sets lines (H2H
  rule e, `modal-form-h2h.md`). In **price** figures a retirement settles at the listed price everywhere (ruling A, 2026-09-28; see `modal-analysis.md` "Retirements in price figures").md`).
  **Test:** a `Retired` loss still adds 1 to lost; a `Walk Over` fixture adds 0 to won and 0 to lost for
  both players, on every record surface.
