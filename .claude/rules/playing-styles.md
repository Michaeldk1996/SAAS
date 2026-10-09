# Playing Styles page — header, grid, archetype cards, data (founder step 9, TEN-408, 2026-10-09)

Applies to the Playing Styles page (`data-page="styles"`: the TEN-408 block `psStylesModel` / `psRenderPage` in
`bsp-consult-dashboard.html`). Reference = `OFFICIAL VERSION 1.html` → Playing Styles (the 2026-10-08 shell export),
night, 1512px; the reference wins except where a rule says *(override)*. **Night only**: no day work, checks or
screenshots. The reference's surfaces are not ours: the founder kept `tokens.css` (TEN-403, card 783f355e), so its
`#171A24` night card reads `--card` here. The shell (rail, `.sfh` header) is not this page's code.

## Page
- **Order:** the shared 35b header (`.sfh ps-head`: "Matchup grid", the reference's full line "Row beats column: the
  figure is the edge vs an even 50% split, the raw win rate sits beneath. Hover to isolate a row and column." — 128
  characters, the founder's exception to the 120 cap, TEN-408 fix 4; stats Styles · Players · Matchups) · the
  matchup grid card (grid + note line) · "Eight archetypes" caps line + "Click a style for its matchups and players" ·
  the eight archetype cards. The page owns no header rule. **Test:** `test-ten403-header.mjs` (styles in `STATIC`),
  `test-ten408-styles.mjs` "look".
- **Cards** (grid card, every archetype card) = `--card` + `--top-light`, 1px transparent border (no outline), radius 12.
  An open archetype card = the same + 1px `--edge-10` *(override: the file's 28% blue ring)*. No blue selected state.
- **No truncation at 1512** (founder TEN-408 fix 1): the row-label column is 212px (fits "Big Server + Complete Baseliner"
  13/600 on one line), a column-head name wraps to 2 lines (10, centred; the code stays one line), the tug-bar name
  column is 190px (card bars column 338). **Test:** "round 3".
- **Grid:** column heads code Plex 12/700 white over name 10 `--text-label`; row labels name 13/600 white over code Plex
  10.5 grey; head on a 10% rule (`--edge-10`), every row on a 5% hairline. Cell = edge mono 15/700 over win rate mono 10
  grey. Edge colour: `--pos` above +2, `--neg` below −2, `--text-label` within ±2. Diagonal and an under-30 cell = `—`
  at `--text-label` 55%. **Hover:** the crossed cell `--selected` + inset 1px `--edge-10` (fix 3: night `--selected` is
  only 4 levels over `--inner`; selection = tone + edge), the rest of its row / column (heads included)
  `--inner`, every other cell 25% opacity; a head lights its own line.
- **Note line** 11.5 / 18.4 `--text-label` on a 6% hairline; sentences end in full stops, never "—" between them.
- **Archetype card:** index Plex 12 grey · name 18/800 · "CODE · N players" Plex 11 grey · "small sample" caps when
  N < 10 · description 13/1.55 grey (max 620) · four tug bars · chevron 16 grey, 180° when open. One card open at a time.
- **Tug bars** (the Playing-styles signed-bar exception: green / red, never Ring blue): 6px track `--track`, radius 3, the
  fill runs from the 50% tick (1px, white 40%) — `--pos` wins, `--neg` losses, white 35% within ±2; half the track =
  50 edge points. Caps tag over the opponent: "Strong vs" (> +2) / "Weak vs" (< −2) / "Even vs". Edge mono 12.5/700
  sign-coloured.
- **Open detail:** left = "Style matchup summary": average edge mono 26/700 (`--pos` / `--neg`, white within ±2) +
  verdict 14/700 white; the tug on ±40 (tick white 18%, axis −40 / 0 / +40 mono 10 grey); "Average edge across its
  N style matchups."; a small-sample style adds one line under it, 11.5 grey: "3 players, below the 10-player threshold.
  Edges are indicative only." (fix 5); "Example players · by Elo" chips (`--inner` + 1px `--line`, radius 8; name 12.5/700 white,
  underline on hover; Elo mono 11.5 grey). Right = "Vs style · best → worst": caps heads on a 10% rule, rows on 5%
  hairlines, Win % mono 12 grey, Edge mono 13/700 on the same ±2 band as the grid (grey within ±2, fix 2). **Test:**
  `test-ten408-styles.mjs` "render" + "look" + "round 3".
- **Order and ties (fix 8):** best → worst on the UNROUNDED edge (the cell's row wins `w` / n), a tie to the larger match
  count; the weakest picks read the same rule from the bottom and never repeat a strongest pick. All Court Elite: Big Server + First Strike (+38.44, 130
  of 147) ranks before Solid Baseliner (+38.03, 125 of 142). **Test:** "round 3".

## Data
- **One classification, one style per player on every page:** `playing-styles.json` `archetype_label` — the store
  Match analysis → Playing style, Head to Head, the Player Profile and the Players cards read. **Labels = the
  classifier's eight, verbatim** (founder, card 369e281c, 2026-10-09: Big Server, Big Server + First Strike, Big Server +
  Complete Baseliner, Attacking Baseliner, Solid Baseliner, Counterpuncher, Solid Defender, All Court Elite), not the
  reference's eight ("Big Server + Baseliner", "All-Court Player", "Counter Puncher", "All-Court Elite"). Descriptions =
  the reference's texts; Big Server + First Strike has no reference text and keeps its own (founder, 2026-10-09: keep it as
  it is).
- **A board label belongs to ONE player:** `tools/apply-board-archetypes.js` matches a board name to a styles row only
  when their full given names do not clash (the same `givenClash` test; initials and "J-L." never clash). Measured 9 Oct:
  the only change is "Dali Blanch" losing the board label written for "Dar. Blanch" (Darwin) — Dali's row is the frozen
  challenger pool's, Darwin is not admitted by the classifier, so his label is held (TEN-12 hold rule) like 13 others.
  16 matches left the cells (Darwin's own tour matches, counted as First Strike through Dali's row). **Test:** "board labels".
- **A shared surname|initial key is not a shared player** (founder, card 369e281c): every name → style lookup drops a
  styles row whose full given name clashes with the name's (`psGivenClash`: "Dali" vs "Darwin" / "Dar." clash; "Alex" vs
  "Alexander" and any initial do not), **or with the name of the player key the caller holds** (`psIndexNameOf` = this
  week's standings, else the profile name until they load; `psKeyNameClash` = the row's given name matches no word of
  that name, so a scrambled standings name — "Daniel Vallejo Adolfo" — never drops the player's own style): an
  initial-only "D. Blanch" on Darwin's key 17463 is refused, on Dali's key 1314 it keeps Dali's style — `ppStyleFor(name, key)` (Match
  analysis, Head to Head, legacy profile; every caller passes its key), `pgArchetypeFor(name, key)` (Players cards) and
  this page's join. **Test:** `test-ten408-styles.mjs` "one style per player" (Darwin Blanch, ranked
  159, never takes his brother Dali's Big Server + First Strike; Dali keeps it; initials and profile spellings still
  join; numeric keys, the standings reload and the pre-load profile stand-in; mutants for each). Measured 9 Oct over all
  2,462 ranked players and 2,007 profile opponent rows: only Darwin Blanch's rows moved (Big Server + First Strike →
  none on Match analysis / Head to Head and the Players card), and all 200 then read the same style on every page.
- **Window** (founder, card 78054b1c): 2000 – now, every match counted under both players' CURRENT labels (a 2006
  Djokovic match is All Court Elite). The 2024 – now alternative was measured and declined (7,978 matches, 2 cells under
  30). **Held labels stay held** (same card): a board label waits until the classifier admits the player (Darwin
  Blanch, T. Samuel, D. Dedura). **Names:** chips print the Player Profile spelling as built; one site-wide ATP-spelling
  name source is a separate ticket (card 78054b1c).
- **Win rates** = `matchup-matrix.json` cells (the cells the modal reads): every completed ATP main-draw match between two
  classified players in the classification window (TML 2000 → + the api-tennis season), walkovers out, **Laver Cup and
  exhibitions out (the Form rule, applied in `tools/build-matchup-matrix.js` to every cell; Davis Cup and United Cup
  stay; the personal records and style-meetings shards keep every match)**. The note states the count and the window
  ("2000 to <last match>", the store's `through`). **Test:** "builder" (Laver Cup + exhibition out, Davis Cup in,
  records keep all) + the three Form lists (builder, pipeline, dashboard) asserted identical.
- **Minimum sample:** a cell under 30 matches is `—` and the note names it with its n (the Database rule). The Match
  analysis tab keeps the matrix's own floor (20). **Test:** "Data 3".
- **Counts:** "N players" = classified players in this week's ATP top 200 (`player-index.json`, api-tennis standings).
  Join = `styleKey` (as `ppStyleFor`), refused when both sides carry a full given name that differs ("Darwin Blanch" is
  not "Dali Blanch"); a row the key misses because api-tennis scrambled a multi-part name ("Martin Etcheverry Tomas" =
  T. M. Etcheverry) joins on surname tokens + first initial **only when unique both ways**. Header Players = the sum;
  Styles = 8; Matchups = 28. A failed standings load = `—`, never 0. **Test:** "Data 4" (173 on the frozen 9 Oct
  fixtures), "Data 7 + 9".
- **Small sample:** a style with fewer than 10 ranked players carries the tag, is left out of every strongest / weakest
  pick (the card's two best + two worst; the Vs list still shows all seven) and is named in the note. **Test:** "Data 5 + 6".
- **Average edge** = the mean of its rated matchup edges (seven unless a cell is `—`), rounded; verdict bands Strong
  advantage ≥ +25 · Slight edge ≥ +6 · Even matchups ≥ −5 · Slight disadvantage ≥ −15 · Struggles broadly.
- **Example players** = the top 5 ranked players in the style by the weekly Elo Database → Ratings shows; a chip prints
  the Player Profile display name exactly ("R. Jodar", "A. Zverev": the profile spelling `playing-styles.json` carries;
  fix 7). The ATP entry lists (`entry_lists_advance.json`) spell "Jódar" / "Mérida"; whether those accents replace the
  profile spelling is pending the founder (TEN-408). Elo = `elo-ratings.json`,
  `psEloFor` = `elo[k].all.rating`; an unrated player is not shown. A chip opens the Player
  Profile when the standings say one exists (`psOpenProfile` → `ensurePlayerProfile`).
- **Note line** (founder copy, TEN-408 fix 6 + card 78054b1c): "Win rates from N completed ATP main-draw matches between
  classified players, 2000 – 8 Oct 2026. Styles are each player's current label. Laver Cup and exhibitions out. A cell under 30 matches shows —: X vs Y (14 matches). X and Y
  (3 players each) are below the 10-player threshold. Their edges are indicative only and left out of every strongest /
  weakest pick." En dash in the range; plural forms when several cells / mixed counts. **No residual-bucket sentence:**
  the founder asked for it only if the classifier still drops players who fit no other style into Solid Baseliner, and
  it does not — every shown label is a hand-finalized board label (`tools/board-archetypes.json`), an unlisted player
  stays unclassified. **Test:** "Data 2", "Data 3", "one style per player" (the sentence absent).
- No "Sample data." anywhere; an unsourced metric is `—`.
