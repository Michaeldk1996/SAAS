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
    including qualifying**; Davis Cup, ATP Cup, United Cup, Laver Cup, Hopman Cup (Laver and Hopman in the ATP
    tier, as TE's table counts them — founder TEN-449, 2026-10-19), Olympics; retirements (rule below); and two
    classes of TE "Other" event, by exact TE event name (`te-join.js` `OTHER_COUNTED`, founder TEN-449,
    2026-10-19): the **multi-sport games** (Pan American, African, World University, Mediterranean,
    Commonwealth) and the **wildcard and pre-qualifying play-offs** (Rome pre-qualification, AO Wildcard Playoff,
    AO WC Playoff Asia-Pacific), in the Challenger/ITF tier. No `event_qualification`/main-draw gate in any
    archive-record builder.
  - **Not counted:** walkovers (rule below); **junior events** (api-tennis `event_type_type` "Boys Singles" /
    "Girls Singles", `isCountedSinglesFixture` — decide on the event type, never the name: of the 1,464
    junior rows at a Slam, 943 carry a plain Slam name, and 31 more are "Pardubicka juniorka"; TEN-444);
    **women's events** ("Itf Women Singles", "Challenger Women Singles", "Wta Singles") that a name collision
    files under a men's key — again by event type: "ITF W15 Monastir … Men" is "Itf Men Singles" and counts
    (TEN-446, 2026-10-17);
    **exhibitions and club matches**, identified by the EVENT (TE's own exhibition/club events and api-tennis
    "Exhibition …" types), never a name substring: UTR Pro Tennis Series, Boodles, the Hurlingham Club
    exhibition (not ITF "M25 Hurlingham", which counts), Adria Tour, Ultimate Tennis Showdown, Diriyah, Six
    Kings, Bundesliga/interclub, national championships and national tours (German Championships, Israel
    National Tennis Tour, National Tennis Tour Switzerland);
    **TE "Other" pro series and invitationals** (UK Pro Series, European Pro Tennis Series, East Coast Pro
    Series and the rest — mostly 2020 lockdown events; founder TEN-449, 2026-10-19); and **any TE "Other"
    event not named in `OTHER_COUNTED`**, until the founder rules on it. A TE "Other" row that pairs with an
    api-tennis or archive row counts (the official source proves the event).
  - **Season = TE's edition year:** a tie played in late December of an event whose edition is the next
    year (United Cup, ATP Cup, Hopman Cup) counts in the next season.
  - **Indoors = TE's court class** for the event; Hard is outdoor hard.
  - **Every season, pre-2021 included, equals the match count TE lists — up or down** (founder TEN-449,
    2026-10-19; replaces "a pre-2021 figure may rise to the match count"). Up: the provider aggregate
    undercounts Challenger-era players (N. Borges 2019 counted 3, 21 on record). Down: a pre-2021 season where
    the aggregate held more than TE lists. Every moved cell is reported to the founder, old → new, before it goes
    live (TEN-449 doc `moved-cells`).
  - **For a player joined to TE on his date of birth, the record counts only the rows TE lists** (founder
    TEN-449, 2026-10-19). A row of ours TE does not list stays in his season drill, marked "not in Tennis
    Explorer, not counted", and is in no cell. *Exception:* a player joined without a DOB (only Z. Svajda, below;
    `te-join.js` `NO_DOB_EXCEPTION`, by key) keeps counting our rows TE lacks. A store record without a DOB for any
    other key stops the run.
  - **"Surface not known" column** (founder TEN-449, 2026-10-19, option C of the `set-repair-notset` report;
    replaces Option A of TEN-442): the Record-by-season table carries a sixth column = the season's Total less
    Clay, Hard, Indoors and Grass as shown, so every season (and Career) sums to its total; its drill lists the
    season's rows with no clay, hard or grass surface outside Indoors (TE "Not set", mostly Davis Cup; an outdoor
    carpet row too). No existing cell moves; a row with a surface of ours that TE leaves "Not set" keeps ours.
  - **The career record is its own population, in its own file (payload B, founder TEN-449, 2026-10-19).** The TE
    merge never changes the career-history files H2H, Lines, the model and every other reader take — not a byte.
    The record is an overlay on them (`te-join.js` `recordLayer`) in `career-record/<key>.json` (+
    `career-record-index.json`), fetched by the player profile only, which settles a player's store only when both
    files have answered: the season table's drills, the Last 52 window, and the undated-match notes, which compare
    the season table with the record's counted rows. The Calendar tile still paints the feed rows and names the
    record's Tennis-Explorer-only rows it does not paint.
  - **Two switches, each rolled back alone:** `TE_INGEST` (the record) and `SET_REPAIR` (the dropped sets) are the
    repository variables `vars.TE_INGEST` / `vars.SET_REPAIR` (`.github/workflows/pipeline.yml`); either reads
    from the private store repo `michaeldk1996/stennisfy-te-store` (`te-history/`, `set-repairs.json`), never from
    this public repo, and a run with a switch on and its input missing stops. A run with `TE_INGEST` off publishes
    no `career-record` file.
  - **Record by season's hover** (founder TEN-449, 2026-10-19), only on a player whose record is TE's: "Counted as
    Tennis Explorer counts, minus exhibitions, club matches, national championships and pro series." Until the
    weekly TE refresh first runs (`career-record-index.json` `meta.refreshedAt` null) it adds "Tennis Explorer data
    as of <asOf>" (18 Oct for the first store); the refresh sets `refreshedAt` and the clause goes by itself. H2H
    (ATP rules) and Form keep their own notes.
  - *Exceptions:* the Match analysis **Tournament tab** W–L stays **main draw only** (TEN-312 N7,
    2026-09-28). Provider-aggregate stats (career/surface win %) and Tennis-Abstract career splits are separate
    sources, not forced to this rule.
  - *Source (founder's call against TE's terms §2.2/§2.10/§2.11, risk reported):* TE pages come only from
    `tools/te-scrape.mjs` — one request at a time ≥ 8 s apart, every page cached in `~/.stennisfy/te-cache`,
    a past season never fetched twice, run on this Mac and never in CI or the nightly refresh; a player is
    joined to a TE page only on his date of birth (age ± 1 where no DOB is on record), never on a name alone.
    *Named exception (founder TEN-449, 2026-10-19):* Z. Svajda (key 2986) is joined to TE `svajda` with no DOB on
    TE, on 320 of 320 of our rows pairing with 0 result disagreements. It does not extend to any other player.
  **Test — holds now:** no junior, women's-event, walkover or exhibition row is in any count (`tools/test-ten444-juniors.js`,
  `tools/test-ten446-womens.js`);
  ATP Stuttgart (June) is grass (`tools/test-ten445-stuttgart.js`); nothing in `.github/` or the pipeline
  requests tennisexplorer.com.
  **Test — golden check (founder 2026-10-19), every CI run and every pipeline run:** turning the record on moves
  no H2H pair, Lines input or model output. CI: `tools/test-ten443-te-ingest.js` "GOLDEN" checks (the shared file
  byte-identical on and off; the h2h-core join, the Lines rows and `runModel` output identical; a mutant merge
  that touches a shared row is caught). Pipeline: `writeCareerHistoryShards` stops the run if the merge changes
  a byte of any player's shared rows. Measured 2026-10-19 on the real store: 724 of 724 shards byte-identical,
  H2H 0 of 38,662 pairs moved; the record rebuilt from `matches` + its overlay equals `careerByYear` for every
  TE-joined player (623 of 623).
  **Test — the target TEN-443 step 2 is building to (fails until it lands; builders still bucket by
  `event_date` year and count pre-2021 from the provider aggregate):** for any player the site serves a profile
  for (`player-index.json` `hasProfile`: 725 on 2026-10-18, not only the eager `player-profiles.json` set —
  founder ruling 2026-10-17, gate d6814167) who is joined to TE on his DOB, every
  Record-by-season cell (Total and each surface, every season and Career) equals TE's same cell minus the
  rows not counted above (exhibitions, club matches, national championships and tours, pro series and
  invitationals, unnamed "Other" events, walkovers); a 29–31 Dec United Cup tie counts in the next season.
  *Convergence:* a builder change reaches a player's cells and shard on his next profile rebuild (14-day
  TTL, `OPPONENT_PROFILE_MAX_AGE_MS`), not on deploy; re-measure after the TTL, not before.

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
