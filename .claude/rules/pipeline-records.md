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
  - **For a player joined to TE on his date of birth, the record counts the rows TE lists, plus our api-tennis rows
    dated on or after the day we read his TE current-season page (provisional)** (founder TEN-449, 2026-10-19;
    provisional counting amends ruling 2A, founder 2026-10-19). **Test:** with `PROVISIONAL` on, an api-tennis row TE
    does not list counts, flagged `provisional`, iff it is dated on or after his store record's `readAt` day (Berlin
    calendar day; `te-join.js` `isProvisional`) and at most 14 days after it (`PROVISIONAL_MAX_DAYS`: a stalled refresh
    cannot keep a row counted), it is not a junior, women's-event, walkover, exhibition, national
    championship or pro-series row, and — if dated on the read day itself — the store has no unpaired TE row for him
    within ±3 days, whatever its result; an exact duplicate (same day, opponent, result) counts once. Every other row of ours TE does not list (an earlier one, one more than 14 days after the read day, an excluded
    one, any row of a store record with no `readAt`, every row with `PROVISIONAL` off) stays in his season drill, marked "not in
    Tennis Explorer, not counted", and is in no cell. Once TE lists the match, the pairing makes it one TE-corrected
    row; if TE never lists it, the refresh moves `readAt` past it and it goes back to not counted. The flag lives only
    in `career-record/<key>.json`; the drill marks it "· provisional · api-tennis, not yet in Tennis Explorer (read
    <d Mon>)". `readAt` is written by `tools/te-build-history.mjs` (the later cache fetch time of his latest season page and his profile page; none if the profile shows a newer season) and
    `tools/te-refresh.mjs` (on each read), and never goes backwards, equals its index entry and is never in the future (`tools/te-history-guard.mjs`).
    *Exception:* a player joined without a DOB (only Z. Svajda, below; `te-join.js` `NO_DOB_EXCEPTION`, by key and TE page)
    keeps counting our rows TE lacks (never flagged provisional). The eight near-miss DOB joins (below, `NEAR_MISS_DOB`)
    are DOB-joined players: TE's rows count, plus provisional ones. A store record without a DOB, or with a DOB that is
    not a valid yyyymmdd date, for any other key stops the run.
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
  - **Three switches, each rolled back alone:** `TE_INGEST` (the record), `SET_REPAIR` (the dropped sets) and
    `PROVISIONAL` (provisional counting, above; acts only inside the TE merge, off = the record without it) are the
    repository variables `vars.TE_INGEST` / `vars.SET_REPAIR` / `vars.PROVISIONAL` (`.github/workflows/pipeline.yml`,
    passed through `env:`); the first two read
    from the private store repo `michaeldk1996/stennisfy-te-store` (`te-history/`, `set-repairs.json`), never from
    this public repo, and a run with a switch on and its input missing stops. A run with `TE_INGEST` off publishes
    no `career-record` file.
  - **Record by season's hover** (founder TEN-449, 2026-10-19), only on a player whose record is TE's: "Counted as
    Tennis Explorer counts, minus exhibitions, club matches, national championships and pro series." Until the
    weekly TE refresh first runs (`career-record-index.json` `meta.refreshedAt` null) it adds "Tennis Explorer data
    as of <asOf>" — the UTC date of the stalest current-season page in the store (17 Oct for the first store: 226 of 623
    players' pages were read on 17 Oct, 397 on 18 Oct); `tools/te-refresh.mjs` sets `refreshedAt` only when every part of one week's weekly run has completed (not on a re-read
    slice or one part alone), and the clause goes by itself. When he has N > 0 provisional rows it adds "Includes N
    matches since <d Mon> from api-tennis, provisional until Tennis Explorer lists them." H2H
    (ATP rules) and Form keep their own notes.
  - *Exceptions:* the Match analysis **Tournament tab** W–L stays **main draw only** (TEN-312 N7,
    2026-09-28). Provider-aggregate stats (career/surface win %) and Tennis-Abstract career splits are separate
    sources, not forced to this rule.
  - *Source (founder's call against TE's terms §2.2/§2.10/§2.11, risk reported; reworded founder TEN-449,
    2026-10-19):* TE pages are read only by `tools/te-scrape.mjs` (this Mac, one-off backfills) and
    `tools/te-refresh.mjs` (the private `stennisfy-te-store` repo's Actions, weekly and daily re-read). Both read one
    request at a time, ≥ 8 s apart, and stop on any non-200 or challenge page. Never from the public SAAS repo, its CI
    or the nightly pipeline. The refresh runs the tools from SAAS `main` (founder decision A, TEN-449, 2026-10-19). A
    player is joined to a TE page only on his date of birth (age ± 1 where no DOB is on record), never on a name alone.
    *Named exception (founder TEN-449, 2026-10-19):* Z. Svajda (key 2986, pinned to TE `svajda`: the key on any
    other page is refused) is joined with no DOB on TE, on 320 of 320 of our rows pairing with 0 result disagreements. It does not extend to any other player.
    *Named exception (founder TEN-449, 2026-10-19, report `bucket-d`):* eight players are joined on a near-miss DOB,
    each to one TE page with TE's DOB as the store records it (`te-join.js` `NEAR_MISS_DOB`), counted as DOB-joined
    players (TE's rows count, plus provisional rows, as for every DOB-joined player). Paired / our rows as measured for the report on 19 Oct 2026 (live files, build
    `ce98253e7`), 0 result disagreements each: 702 Z. Tkemaladze `tkemaladze`
    (TE 4 Jun 2000, ours 6 Apr: swapped) 216/217 — the one unpaired row, Lo Chien 27 Oct 2022, counts once as TE's
    copy; 12972 F. Rocha `rocha-a46b1` (TE 4 Oct 1999, ours 10 Apr: swapped) 172/172; 19461 E. Munoz `munoz-1a9fc`
    (TE 2005 only; both search pages read, no other E. Munoz) 32/32; 52682 F. Balshaw `balshaw` (TE 5 Jun 2006, ours
    15 Jun) 131/131 (a later live file adds his 19 Oct Lyon qualifying match, played after TE's page was read: 131/132
    until the TE refresh lists it; with `PROVISIONAL` on it counts provisionally meanwhile); 54221 G. Bennaton `bennaton` (TE 2005 only) 7/7; 70760 M. Ceban `ceban` (TE 2009 only) 18/34, the
    16 unpaired all junior Slam rows, which stay out; 78231 G. Al-Sulaiti `al-sulaiti-a86c2` (TE 2007 only) 5/5;
    78628 I. Snoussi `snoussi` (TE 2007 only) 15/15. It does not extend to any other player.
    **Test:** `tools/test-ten443-te-ingest.js` "Bucket D": each of the eight joins and counts only TE's rows, plus
    provisional ones with `PROVISIONAL` on ("Bucket D · provisional"). Refused,
    and the run stops: in the pipeline (`applyTeHistory`), a store record for any other key with no DOB or a DOB that
    is not a valid yyyymmdd date (year-only, short, `00000000`, month 13, 31 Feb), and a named key on another page or
    DOB; in the store build (`te-build-history.mjs`, exit 1 and nothing written), additionally any cache join whose TE
    DOB is not OUR DOB for the key (the scraper's `roster*.json` + `identity-verified.json`; a swapped or near DOB on
    an unnamed key), a key with no DOB of ours, and a near-miss or founder-exception join for an unnamed key. The
    pipeline holds no DOB of ours, so the equality is checked at build time only. Ceban's 16 junior rows stay out;
    Tkemaladze's Lo Chien match counts once.
  **Test — holds now:** no junior, women's-event, walkover or exhibition row is in any count (`tools/test-ten444-juniors.js`,
  `tools/test-ten446-womens.js`);
  ATP Stuttgart (June) is grass (`tools/test-ten445-stuttgart.js`); nothing in `.github/` or the pipeline
  requests tennisexplorer.com, and no workflow, action or script under this repo's `.github/` runs
  `te-scrape.mjs` or `te-refresh.mjs` (`tools/test-te-refresh.mjs`, "TEN-449 source rule", with a control).
  **Test — golden check (founder 2026-10-19), every CI run and every pipeline run:** turning the record on moves
  no H2H pair, Lines input or model output. CI: `tools/test-ten443-te-ingest.js` "GOLDEN" checks (the shared file
  byte-identical on and off; the h2h-core join, the Lines rows and `runModel` output identical; a mutant merge
  that touches a shared row is caught, a provisional-flag one included; with `PROVISIONAL` on as well). Pipeline: `writeCareerHistoryShards` stops the run if the merge changes
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
