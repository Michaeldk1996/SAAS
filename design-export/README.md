# Stennisfy — design audit export

Eight self-contained HTML files. No build step, no external dependencies except
Google Fonts (Hanken Grotesk + IBM Plex Mono). Open any file directly in a browser.
`image-slot.js` must travel with the HTML files (photo drop zones);
`export-report.md` documents the export itself.

**Authority rule — README for intent, HTML for measurement.** The HTML is
authoritative for every measurable value: padding, margins, widths, font sizes and
weights, line heights, radii, gaps, fill alphas, gradient stops, glyphs. Read the
value out of the export source and use it exactly — no rounding, no interpreting a
README description of it, and no number quoted in a prompt (prompt numbers came off
screenshots and several were wrong). The README is authoritative for rules, scope
and reasoning: which token applies where, what green/red encodes, why blue never
touches a performance value, what was deliberately not built. If the two disagree on
a measurable value, that is a bug in one of them — flag it with both numbers rather
than picking one.

**What this export actually is — read this first.** It is ONE app file plus a few
standalone page bodies, not eight separate pages:

- **The app**: `matches-upcoming.html` contains almost everything — seven surfaces
  behind one sidebar. `account-settings.html` is the SAME app re-cut to open on
  Account Settings. Both open straight on their page — no login screen; the login
  flow lives only in `login.html`, which redirects into the app on verify.
- **Standalone page bodies**: `player-profile.html`, `playing-styles.html`,
  `stennisfy-model.html` are page bodies WITHOUT sidebar chrome — in the product the
  app supplies the sidebar around them. `news.html` is the exception: it carries the
  shared sidebar and works as a full standalone page.
- **`stennisfy-all-in-one.html`**: every page above packed into a single offline file
  with working cross-page navigation.

| File | Covers |
| --- | --- |
| `matches-upcoming.html` | **The app.** Today's Matches (Upcoming + Completed), Players, Tournaments (Overview + embedded Reports), Playing Styles, News and Player Profile as in-app pages, Account Settings, and the Match Analysis modal. Opens on Matches, no login gate. |
| `account-settings.html` | The same app, opened on Account Settings (Preferences fold-ins included), no login gate |
| `login.html` | Login / OTP flow standalone; Verify redirects to `matches-upcoming.html` |
| `news.html` | News page standalone, WITH the shared sidebar |
| `player-profile.html` | Player profile page body (no sidebar — the app supplies it) |
| `stennisfy-model.html` | Stennisfy Model page body — Match model + Player ratings (no sidebar) |
| `playing-styles.html` | Playing Styles page body (no sidebar) |
| `stennisfy-all-in-one.html` | All pages in one offline file, starts at login |

### Sizes (this cut)
App bundles ~2.7 MB each (`matches-upcoming.html`, `account-settings.html`);
`news.html` ~1 MB; other page bodies 0.4–0.6 MB; `stennisfy-all-in-one.html` ~11.4 MB
(consider gitignoring the all-in-one and rebuilding it from the page files).

All interactive states are live in these files — hover, active filters, selected match
rows, expanded accordions, tab switching. Nothing is stubbed and no placeholder data
was substituted.

## Design tokens

```
/* canvas & surfaces */
--page:            #06070a;
--card:            #0a0d14;
--sidebar:         #0a0d13;

/* borders */
--border-data:     rgba(255,255,255,0.09);   /* data content blocks, radius 12px */
--border-subtle:   rgba(255,255,255,0.07);   /* dividers, inactive rows */
--border-hover:    rgba(91,155,255,0.22);    /* hover / focus on cards & match rows */
--border-selected: rgba(91,155,255,0.35);    /* selected / expanded */

/* text — three levels, plus one prose level */
--text:            #e7e9ee;   /* primary + Player B */
--text-body:       #a8b0c0;   /* prose only — article body copy on News (~8.9:1 on --card); never labels, captions or meta rows */
--muted:           #5b6880;   /* secondary */
--muted-2:         #4b5672;   /* captions, micro-labels */

/* brand & identity */
--brand:           #5b9bff;
--player-a:        #6aaeff;
--player-b:        #e7e9ee;
--brand-wash:      rgba(91,155,255,0.08);
--brand-tint:      rgba(91,155,255,0.15);
--brand-deep:      #2f6bd8;   /* dark end of progress/form bar gradients only, never text */

/* semantic */
--pos:             #3dd68c;   /* good data, value, match winner indicator */
--warn:            #e8a84e;   /* medium data */
--neg:             #e0616f;   /* poor data, no value */
/* note: odds movement is non-semantic everywhere EXCEPT the Match Analysis Odds tab's
   numeric movement deltas, which use --pos / --neg by explicit decision — see
   "Odds journey (Completed)" and "Match Analysis modal" below.
   Second scoped exception, by explicit decision: the LOST SERVE and BP markers inside
   the match-detail block (shared component + Match Stats tab) render in the negative
   token product-wide — match events, not data quality, but red by decision. SP stays
   neutral. No other match event, direction or comparison may take --pos / --neg.
   Third scoped exception, by explicit decision (ruling B): on the Playing Styles page
   only, green/red (--pos/--neg) is permitted for MATCHUP EDGE and DOMINANCE — the hero
   matchup grid, the DOM VS / WEAK VS bars, and the expanded matchup gauge. Matchup
   strength is the subject of the page and it already speaks green/red. Colour is
   carried by the gauge's track fill alone (green/red by the sign of the average edge,
   neutral #4b5672 inside the even band); the verdict label and the handle stay neutral,
   position/magnitude uncoloured. No other Playing Styles value takes --pos/--neg.
     Two things the next person must NOT try to reconcile:
     - The ±2 EVEN VS band (matrix cells + DOM/WEAK VS bars go neutral within ±2 edge,
       win 48-52%) is READ verbatim from the export's own threshold.
     - The green/red/neutral colour ON the matchup gauge is a DECISION, not an export
       value: the export paints those verdict bands BLUE (#5b9bff), which is forbidden
       on a performance value, so the blue was deliberately NOT copied. Do not try to
       reconcile the gauge colour with the blue in the export markup — the numeric
       cutoffs are the export's, the colour is ours. */
--pos-bg:          rgba(61,214,140,0.15);   --pos-bd: rgba(61,214,140,0.3);
--neg-bg:          rgba(224,97,111,0.15);   --neg-bd: rgba(224,97,111,0.3);

/* surfaces (labels only, not data quality) */
--hard:            #4db8ff;
--clay:            #e8a84e;
--grass:           #2ab8a0;

/* type */
--font-ui:         'Hanken Grotesk', sans-serif;
--font-data:       'IBM Plex Mono', monospace;   /* all numbers, odds, records */

/* radii */
--r-card:          12px;   --r-control: 8px;   --r-pill: 6px;
--r-match-card:    14px;   /* outer match cards only; blocks inside stay 12px */
```

## Rules encoded in the markup

- Player A (first-named player) is always `#6aaeff`; Player B always `#e7e9ee`. Never both blue.
- All numeric values use IBM Plex Mono; all labels and prose use Hanken Grotesk.
- Upgrade to Pro and Generate-analysis buttons are outlined only, never solid fill.
  Approved exception: the primary auth action on Login / Sign up ("Continue with email")
  is a solid `--brand-deep` fill — the only solid button in the product.
- Value badges (SHARP VALUE / NO VALUE) are translucent pills, never solid fill.
- Data-quality bars use only `--pos` / `--warn` / `--neg` — no brand or surface colours.
- Cards and match rows at rest use `--border-data` (rgba(255,255,255,0.09)); hover/focus
  raises to rgba(91,155,255,0.22), selected/expanded to rgba(91,155,255,0.35) —
  border-colour only, ~120ms, no tint, shadow or lift. Exception: promotional rows inside
  a list keep rgba(91,155,255,0.22) at rest to distinguish them from content.
- No data content block is borderless. Outer match cards use radius 14px; every data
  block inside them stays at 12px.
- Type boundary: Hanken Grotesk for words — player names, tournament and venue names,
  surface labels, column headers, section titles, prose. IBM Plex Mono for figures and
  alphanumeric identifiers — odds, scores, percentages, records, dates and kick-off times,
  round codes (R16, QF), the live clock. The test: Mono is for values that came from the
  data — anything that varies record to record, whether it reads as a figure or a code;
  Hanken is for words the interface itself supplies — headers, section titles, category
  names, anything constant across records. A supplied label never uses Mono; a value from
  the data never uses Hanken.
- **Segmented controls** — the active pill is always a translucent tint with a border:
  `rgba(91,155,255,0.22)` fill on `rgba(91,155,255,0.45)`, weight 700; inactive is
  borderless `--muted` at 600. Never a solid brand fill — solid `#5b9bff` fills have
  reappeared repeatedly on new controls and are always wrong; the only approved solid
  fill in the product is the Login primary auth button, which is a button, not a
  control. (In-card sub-controls may drop the container box, but the pill treatment is
  identical everywhere.)
- **Player names are links** — a player name in any data context opens that player's
  profile. The resting state is deliberately unchanged (local identity colours, no link
  blue, no underline); the affordance is hover-only — underline + pointer cursor, colour
  unchanged — because colouring every name would flood pages with brand blue and break
  the Player A / B identity rule. The whole name is the hit target; no icons. The player
  whose profile is currently open is not a link. Do not "fix" this by adding a resting
  link colour.
- **Explainable labels** — any abbreviation or term a first-time reader can't parse
  (ELO on Players, every splits column header on Player Profile) gets a 1px dotted
  `--muted-2` underline and `cursor: help`, with a hover tooltip: `#0a0d13` on
  `rgba(255,255,255,0.15)`, radius 12px, padding 10px 12px, Hanken 13px `--text`,
  max-width 260px, 8px above the label, centred (right-aligned on edge columns so it
  never clips). Tooltips supplement visible legends, never replace them.

## Login / Sign up (rules specific to this page)

- **Primary button** — the solid `--brand-deep` fill on "Continue with email" is the
  approved exception to the outlined-button rule (recorded in Components above), scoped to
  the primary auth action only. The Verify button on the code step is the same treatment,
  being the same action one step on. No other solid-filled button exists in the product.
- **Secondary buttons** — "Use phone instead", the two OAuth tiles and the two store
  badges share one treatment: `rgba(255,255,255,0.04)` on `rgba(255,255,255,0.15)`,
  radius 8px, label `--text` at 600. Every secondary action in the column carries the
  same neutral border — a brand-blue border would imply an affordance these do not have.
  Brand blue on this page marks the primary action and Player A identity, nothing else.
- **Field states** — resting: `rgba(255,255,255,0.04)` fill on `rgba(91,155,255,0.22)`.
  Focus: border to `rgba(91,155,255,0.35)`, background unchanged, no glow, shadow or
  lift. Error: border `--neg`, with the message below the field in Hanken 13px `--neg`,
  left-aligned; the field keeps its value and the message clears on the next keystroke,
  never on blur. The same resting treatment carries the six code boxes on the sent step.
- **Button states** — loading: disabled, label becomes "Sending code…", fill at 60%
  opacity, no spinner anywhere in the product. Disabled (empty field): same fill at 40%
  opacity, not clickable. Both states keep the fill colour; opacity alone marks
  unavailability.
- **Left column** — the brand mark sits alone at the top as the identity anchor; no
  secondary call to action shares that row. The App Store and Google Play badges sit at
  the very foot of the column, below the legal line, left-aligned and side by side. A
  competing call to action never appears above the primary one.
- **Right preview panel** — the three preview blocks (match card, Market Signal, Line
  Movement) are ordinary data blocks: `--card` on `--border-subtle` at radius 12px, like
  every data block in the product. The panel reuses Matches components and does not
  redefine them: Player A / Player B identity colours and their leading markers, odds in
  Mono `--text`, and the odds-journey miniature with its non-semantic muted → brand track
  and `--muted-2` directional drift markers all follow the Completed Matches rules above.
- **Panel blue** — "Visualize the edge" is the only non-identity blue on the panel. Odds,
  book names and prices are never blue there; a blue figure would read as a link.

## Today's Matches — Upcoming (rules specific to this view)

- **Header** — page title, then a two-line muted subtitle, then the live status line on
  its own row directly under it: a 7px `--pos` dot with a `rgba(61,214,140,0.18)` ring,
  the words "Live · updated" in `--muted-2`, and the clock in Mono `--muted-2`. The
  status line is part of the subtitle stack, never a badge and never a separate card.
  Completed shows the same line with a `--muted-2` dot, no ring, and "Settled · <date>".
- **No stat box, no count readout** — Upcoming carries neither. The live status line is
  the only summary above the list; match and tournament counts are deliberately not
  printed. (Completed does carry a stat box — see below.)
- **Segmented control** — the view switch is labelled Upcoming / Completed, sits top right
  of the header, and is the only control there: active pill `rgba(91,155,255,0.22)` on
  `rgba(91,155,255,0.45)` at weight 700, inactive plain `--muted` at 600 with no border.
- **Account actions live in the sidebar** — the user chip at the foot of the sidebar opens
  the account menu (Account settings · Billing · Log out). The page header never carries
  avatar, plan or account controls.
- **Date strip** — five-day window (two past · today · two future) with the ‹ › arrows
  hugging the dates rather than the container edges. The strip and the filter row below it
  are both left-aligned to the content column, not spread full width.
- **Pro promo row** — one only, placed inside the list after the second match card, never
  in the header or sidebar. Standard card geometry with no fill and no gradient: `--card`
  on `rgba(91,155,255,0.22)` at rest (the documented exception to the border-at-rest
  rule), a Mono PRO pill, and a text-only brand-blue call to action.
- **Card header** — surface · tournament · round pill · timestamp, and it ends there. No
  relative day tag ("Today"), because the date strip above already states the selected
  day. A card whose date differs from the selected day shows the actual date in
  `--muted-2` Mono at the end of the header — never a relative word, never brand blue.
- **Recent Form bar** — a 76px track in `rgba(255,255,255,0.06)` filled with a
  `--brand-deep` → `--brand` gradient, value in Mono `--muted` to its right. Form is
  strength, not quality: never `--pos` / `--warn` / `--neg`.

## Market Signal (both views)

- **Row order** — Sharp Estimates keep their given order; Market Money rows sort by
  liquidity, deepest market first, on the underlying numeric value rather than the
  formatted string (£1.2M ranks above £664K). The deepest market is the most reliable
  signal, so it ranks top.
- **Label** — "Market Signal" on Upcoming; "Market Signal · final" on Completed, marking
  the market as closed. Everything inside the block is otherwise identical between views.

## Completed Matches (rules specific to this view)

Upcoming and Completed are deliberately divergent in the places listed below (plus the
header status line, card-header date and Market Signal label noted above). Each
divergence is intentional — do not "harmonise" them.

- **Stat box** — Completed carries a three-cell stat box (Matches settled · Favourites
  held · Upsets) directly under the header: single data block, cells split by
  `--border-subtle` verticals, caps label in `--muted-2` over a Mono 500 value in
  `--text`. Upcoming has NO stat box — it carries the live status line only, with no
  counts. Settled results are a fixed set worth summarising; a live slate is not.
- **No promo row** — the Pro promo row appears only in the Upcoming list (after the
  second card). Completed never carries one; settled results are a reference surface, not
  a conversion one.
- **Date strip** — while Completed is active the strip shows past days and today only,
  ending on Today. The forward arrow is not removed but disabled: `--muted-2`, no hover,
  no pointer events. It becomes active again once the user has paged backwards. The back
  arrow always pages further back. Upcoming keeps its full five-day window including two
  future days, both arrows active.
- **Sort options** — Upcoming offers Time · Odds; Completed offers Time · Biggest upset ·
  Largest drift · Closing value. The two sets are disjoint by design; if the active sort
  does not exist in the view being switched to, it falls back to Time rather than showing
  an option the view cannot honour.
**Known scope, not a defect:** the filter row on Completed (surface dropdown, tournament
chips, player search, sort) is rendered and fully styled but does not yet drive the list —
filtering logic is wired on Upcoming only. This is deliberate scope for build, not a
design bug: the controls are specified as-shown and are expected to be wired to the
settled set during development.

- **Winner indicator** — the match winner's row carries a 3px `--pos` bar inset on its
  left edge, and only that. No badge, no row tint, no background fill, and neither row is
  dimmed by opacity — the losing row is at full strength.
- **Odds journey** — the open-to-close track is deliberately non-semantic: a `--muted`
  endpoint dot, a 2px gradient running `--muted` → brand blue, and a brand-blue closing
  dot, identical for shortening and drifting prices. Lengthening odds are bad for a backer
  and good for a layer, so no good/bad colour is correct here. Never colour the track with
  `--pos` / `--neg`. (Scoped exception, by explicit decision: the NUMERIC movement deltas
  on the Match Analysis Odds tab are directional green/red — see that section. This
  page's odds journey stays non-semantic.)
- **Drift markers** — the ▲ / ▼ glyph and its value beside the closing price are purely
  directional: both in `--muted-2`, IBM Plex Mono, on every row and in both directions.
  No amber, green or red. Direction is the only thing encoded.
- **Odds columns** — opening price is quiet (Mono 400, `--muted`); the closing price is
  the headline (Mono 700, `--text`). Column headers OPEN / CLOSE are `--muted-2` caps.
- **Set scores (completed matches)** — one tight cluster (~90px): the sets-won total sits
  on a faint tile (`rgba(255,255,255,0.06)` winner / 0.03 loser, radius 5px), then three
  fixed-width per-set slots, 8px from the total. All figures are IBM Plex Mono 700;
  per-set games are 2px smaller than the total. Colour separates result from detail, not
  winner from loser: every sets-won total is `--text`, every per-set games figure is
  `--muted`, on both rows. The outcome is carried by the green accent bar and the player
  name, never by dimming the row. Tiebreaks are superscripts on the games figure.

## Player Profile (rules specific to this page)

- **No identity blue on category labels** — this is a single-player page, so there is no
  Player B to contrast with and identity blue would read as identity where none exists.
  The archetype label under the player name is `--text` Hanken 700; the playing-style
  radar's dimension names are `--muted` Hanken and their values Mono `--text`. Only the
  radar polygon keeps a blue treatment.
- **Splits tables** — Career splits and Last 52 weeks sit side by side, equal width
  (`minmax(0,1fr)` columns so a wide tab scrolls inside its card instead of reflowing the
  row). Each table has its own Results · Sets & Games · Service tab control (Results
  default); the two operate independently. Row labels and group headings (Surface ·
  Level · Format · By round · Opponent) persist across tabs — only numeric columns swap.
- **Column order: headline last** — mirroring Results, where WIN% sits last, each tab
  ends on its most important metric(s): Results `W-L · M · WIN%`; Sets & Games
  `TB% · GM% · SET%`; Service `MS · A% · DF% · HLD% · BRK%`. The final column(s) carry
  the bold green/red treatment — WIN%, SET%, and both HLD% and BRK%. All other values
  are plain Mono `--text`; raw set/game/tiebreak W-L pairs live in a row-hover tooltip
  ("Sets 268-426 · Games 1588-2026 · Tiebreaks 9-18"), not in columns.
- **Threshold colouring** — one logic shape for every coloured column: green (`--pos`)
  above the baseline, red (`--neg`) more than 5pt below it, neutral `--text` between.
  WIN% and SET% baseline on the player's own career win rate for the active surface tab.
  HLD% and BRK% baseline on the metric's own norm (70.5 and 21 respectively) — a win-rate
  baseline would paint HLD% uniformly green and BRK% uniformly red. BRK% runs the same
  direction as HLD%: higher is better (more return games broken).
- **Em dash is not zero** — a split row with no matches in the period renders an em dash
  in every numeric cell, `--muted-2`, with a "No matches in this period" hover. `0`,
  `0-0` and `0.0%` are real results (played and lost) and are never substituted for
  absence. One extension: TB% shows an em dash on a played row whose sample contains no
  tiebreaks. Never "correct" a dash to a zero or vice versa.
- **Full row set always** — both tables render the identical 14 rows in the same order,
  even when Last 52 weeks has no data for some (Grass, Finals, Semi-finals), so the two
  cards stay the same height and rows align across the pair. Value cells are
  `white-space: nowrap`; overflow becomes horizontal scroll inside the card (row-label
  column sticky on `--card`), never wrapped values and never a taller row.
- **Comparison bars (match panel, Stats tab)** — the longer bar always means the better
  performance. For lower-is-better stats (Double faults; Unforced errors when present)
  the bar lengths invert while the printed numbers stay exactly as recorded, and the row
  label carries a Hanken 10px `--muted-2` "lower is better" caption. Names and bar fills
  use the identity pair — Player A `--player-a`, Player B `--player-b`.
- **Fixture rows (Record by tournament)** — each fixture is a W/L chip + round code +
  chevron line over the stacked two-row score cluster documented under "Set scores
  (completed matches)" — same geometry, tiles, Mono weights, superscript tiebreaks;
  three set slots always reserved so fixtures align; retirements append " ret." in
  `--muted-2` on the loser's row. Two deliberate divergences from the Completed card:
  names are identity-coloured (Martinez `--player-a`, opponent `--player-b`) rather than
  winner/loser, and the outcome is carried by the W/L chip and the sets-won tile
  brightness, not a green accent bar. "def. / lost to" phrasing is retired.
- **Identity vs outcome are separate systems** — name colour encodes who a player is
  (Player A blue / Player B white); score-value colour encodes who won (winner values
  `--text`, loser values `--muted`). The two never share a channel: a name is never
  dimmed for losing, a score is never blued for identity.
- **Match panel tabs** — Summary · Stats · Point by point, in that order; Summary is the
  default on every open. Sub-filters belong to one tab each: Match / Set 1 / Set 2 on
  Stats only, the per-set filter on Point by point only (Set 1 default, only existing
  sets rendered, deliberately no "All sets" option), Summary has none. All three
  controls use the standard segmented-control treatment.
- **Summary tab** — the quiet at-a-glance view: a centred meta line (date · tournament ·
  round · surface, Mono `--muted-2`), then a 560px centred column holding the SCORE block
  (fixture-row score cluster plus a 6px `--muted` first-server dot) and a MATCH TIME row
  (total in Mono `--text`, per-set splits in Mono `--muted`, aligned under their set
  columns). No charts, no bars, no insight text, no video row — Stats owns the
  comparison bars.
- **Point by point** — reuses the Match Analysis modal's Flashscore-style layout and
  generator verbatim (server dot, LOST SERVE pills, running game score, BP/SP pills,
  tiebreak rows); see the Matches documentation. Set scores, the fixture-row cluster and
  the Summary block all derive from one shared generator, so a match's score never
  disagrees between views.
- **Tooltip clearance** — the splits-table scrollers carry `padding-top` compensated by a
  negative `margin-top` so header tooltips can extend above the table without being
  clipped by `overflow-x: auto`. It looks redundant; it is load-bearing.

## Tournaments — Overview tab (rules specific to this view)

- **Court speed is a number, not a surface** — court speed values are plain Mono `--text`
  everywhere (list rows and hero); the 8px surface dot beside the name carries surface,
  the muted surface label names it. A speed figure never takes a surface colour — the
  number's colour must mean nothing so the dot's colour can mean surface.
- **Classification labels are data** — "Fast" beside the hero speed and the
  Reliable / Moderate / Upset-prone label beside Favourite reliability are `--text`,
  never brand blue. A classification is a data reading, not navigation or identity.
- **Two comparison bands, deliberately different** — do not harmonise these:
  - ROI backing favourites / underdogs: threshold-coloured value (`--pos` above,
    `--neg` below, `--muted` within) on a **±1.0pp** band vs the tour average — the same
    test its caption uses for "in line with tour average", so colour and caption can
    never disagree.
  - Favourite reliability: the percentage itself is plain Mono `--text` with NO
    threshold colouring; only its classification label and the explanatory paragraph
    derive from a **±3.0pp** band vs the tour average (≥ +3 Reliable / "clearly above",
    ≤ −3 Upset-prone / "below average", else Moderate / "broadly in line").
  The bands differ because each matches the switch points of its own caption text; a
  value, its label and its paragraph must always agree, and that constraint — not a
  shared constant — is the rule.
- **Rank line** — beneath the slow/medium/fast slider: ordinal rank, event count and
  tour median in Mono inside a `--muted` Hanken line, all computed live from the
  tournament dataset. Never hard-code the rank, the count or the median.
- **Empty report state** — a proper data block (`--card`, `rgba(255,255,255,0.09)`
  border, radius 12px, ~96px, centred): heading "Report not available yet" in `--muted`
  Hanken 14px over one `--muted-2` 13px explanation line. Never a bare text line.

## Tournaments — Reports tab (rules specific to this view)

- **No player identity colours** — Round comparison and Player progression assign each
  player a stable neutral-grey dot/marker from an 8-step grey ramp (`#e7e9ee` down to
  `#2f3947`), keyed to draw order so a player keeps their grey across every card, chip
  and view. No green/amber/purple/blue identities — semantic and surface colours keep
  their meanings.
- **Head-to-head is the exception** — as a two-player comparison it uses the product's
  Player A / Player B system (`--player-a` / `--player-b`) for pickers, lines and value
  pills. This is a deliberate divergence from the other two views, not an inconsistency.
- **Metric bars** — uniform `--muted` bars with the per-card leader in `--text`; no
  opacity ramp, no brand colour. Bar length is the only value encoding; the dashed
  round-average line is the comparison anchor.
- **Longer bar = better, always** — Unforced Errors (% of points) is the view's only
  lower-is-better metric: its bar scale (and its dashed average marker) inverts so
  fewer errors reads longer, with the standard Hanken 10px `--muted-2` "lower is
  better" caption under the card label (also on the H2H Unforced Errors card). The
  other five metrics are higher-is-better and unchanged.
- **Card order is thematic and identical across all three views** — serve metrics in
  the left column (1st Serve %, 1st Serve Points Won %, 2nd Serve Points Won %), rally
  metrics in the right (Winners, Unforced Errors, Winners/UE Ratio), under Hanken 11px
  caps `--muted-2` SERVE / RALLY column labels; the ratio card sits directly beneath
  the two cards it derives from.
- **Em dash for rounds not reached** — progression cells where the player exited
  earlier show an em dash in `--muted-2`, per the Player Profile splits convention
  (em dash = no data, never a middle dot, never a zero).
- **FIELD AVG row** — rendered only when two or more players are selected; with one
  player it would duplicate that player's row and reads as a rendering error.
- **Progression cell highlight** — marks the best value in that round among the
  selected players: column max for higher-is-better metrics, column MIN for
  lower-is-better ones (Unforced Errors — same inversion as the bars). The treatment is
  neutral: all values Mono 400 `--text` on a faint `rgba(255,255,255,0.03)` tile; the
  highlight lifts to weight 700 on `rgba(255,255,255,0.06)`. No colour ever marks it. A
  Hanken 12px `--muted-2` legend beneath the grid states the meaning.
- **Focus dimming** — clicking a progression chip or row name focuses that player and
  dims the other rows (0.26 cell / 0.5 name opacity); it is a toggle, not a stuck
  state. Row identity itself is carried by the grey marker only.
- **H2H field average** — the dashed line is computed per round from the tournament
  dataset: the mean of every player in the draw with ingested data at that round (the
  pool shrinks as rounds progress). The header note states the set plainly: "dashed
  line = per-round average of this draw's players with data". Never replace it with
  authored constants — a fabricated reference line is worse than none.
- **Update caveat** — "Data updates once first rounds are completed." sits beneath the
  COMPARE AT ROUND control (Hanken 12px `--muted-2`, no italic), because it is a caveat
  about round data, not about the tournament chips.

## Stennisfy Model (rules specific to this page)

- **Left match panel** — a self-contained rail: collapsed icon sidebar (links back to the
  dashboard's nav anchors), a native tournament `<select>` dressed as a standard field
  (`rgba(255,255,255,0.04)` on `rgba(255,255,255,0.15)`, brand-tint focus border), the
  match chip list, and a pinned back-to-dashboard footer link. It navigates; it never
  duplicates dashboard content.
- **Market context** — four boxes in fixed order (Soft book opening · Pinnacle opening ·
  Stennisfy base price · Pinnacle now) on `repeat(4, minmax(0,1fr))` — a desktop
  min-width assumption, not responsive. Annotation lines under a box are single-line
  Hanken 11px: a fixed 60px left-aligned name cell (identity-coloured, profile-linked)
  so the annotation text starts at the same x on both lines, 8px gap, never wrapping;
  ellipsis exists only as a last-resort guard at sub-design widths. Drift arrows keep
  their movement colours.
- **Value layers** — 17 bars (manual context + 16 model layers), three states only:
  `--pos` Good, `--warn` Medium, `--neg` Poor — no other colour is legal in the strip
  (the rose `#e0616f` reads pink at 6px; it is the Poor state, not an off-palette
  colour). Every bar carries a standard hover tooltip naming "Layer · State"; a Mono
  caps count line ("n OF 17 VALUE LAYERS ACTIVE") accompanies the strip.
- **Outbound bookmaker links** — the Soft-book odds values and the "Best soft book ·
  <name>" line link out: hover-only underline (same rule as player names), `target="_blank"`
  with `rel="noopener noreferrer"`. The hrefs are `example.com` placeholders flagged with
  code comments — wire real affiliate/bookmaker URLs during development.
- **Gated sections are readable** — Biggest movers and the Stennisfy Analysis text render
  fully (no blur anywhere); the premium gate is a non-occluding bottom gradient strip
  with a lock glyph and "Upgrade to Premium to unlock the full analysis". This is a
  review affordance, NOT access control — the real gate must be server-side. Never
  reintroduce blur or an overlay as a security measure.
- **Odds inputs** — the editable price fields are `type="text" inputmode="decimal"`,
  deliberately: `type="number"` localises the separator and renders "1,35" on comma-locale
  systems while every read-only odd shows "1.35". Do not "fix" them back to number inputs.
- **Player ratings sorting** — ELO, SERVE, RETURN and UNDER PRESSURE headers all sort:
  first click descending, second ascending; active header `--text` with ↓/↑ in brand
  blue, inactive headers `--muted-2` with a faint hover ↓ hint; ELO descending is the
  load default; ties break on ATP rank. The # column is assigned AFTER the sort, so rank
  always reflects the current ordering.
- **Filter presets** — one active at a time, standard active pill
  (`rgba(91,155,255,0.22)` / 0.45 border / `--text`). A preset both filters the pool and
  sets the controls it implies: surface specialists switch the Surface tab, "This
  surface · last 52w" sets Scope to Last 52 weeks, Best servers/returners/under-pressure
  set the sort column, Rising form sorts by form. Clicking the active preset — or the
  muted "Clear" link beneath the list — resets preset, surface, scope and sort to
  defaults. The result-count line under the subtitle (Mono number + muted word)
  recomputes with the filtered pool.
- **Surface tabs colour exception** — the active surface tab takes its own surface
  colour (hard/clay/grass tint) instead of the standard brand pill; surface identity
  outranks control convention here, deliberately. The Scope control beside it uses the
  standard treatment — do not harmonise the surface tabs to match it.
- **Ranked lists are not A/B comparisons** — in the ratings board the two players from
  the selected match are marked by the 2px left accent bar and a faint row tint only;
  their names stay neutral `--text` like every other row. The Player A / Player B colour
  system applies to two-player comparisons (match header, Fair price & value, Market
  context, H2H), never to a ranked list.

## Playing Styles (rules specific to this page)

- **Matchup grid convention** — read row beats column. The headline figure in each cell
  is the EDGE (win rate − 50, signed, Mono 19px 800); the raw win rate sits beneath in
  Mono 10px `--muted-2`. The diagonal renders an em dash in `#3a4150`. Never present the
  raw rate as the headline — the edge is the finding.
- **Cell colouring** — a ±2 neutral band: edge > +2 renders `--pos`, edge < −2 renders
  `--neg`, |edge| ≤ 2 renders `--muted-2` (the ~ Even state). A 1-point edge is noise,
  not a finding — never colour it. The legend swatches use the semantic tokens
  (`#3dd68c` / `#4b5672` / `#e0616f`) exactly; no off-token hues.
- **Hover-to-isolate** — hovering a cell keeps its row and column at full opacity and
  drops everything else to 0.2; the hovered row/column headers take a brand tint
  (`rgba(91,155,255,0.10)`), the intersection cell 0.15. Opacity here is an interaction
  state, never a data encoding.
- **Small-sample rule** — an archetype with fewer than 10 players is flagged twice:
  a Hanken 11px `--muted-2` caption on its card ("Small sample — treat these edges as
  indicative only.") and a computed footnote beneath the grid naming the affected
  styles with their counts ("All-Court Elite (3 players) is below the 10-player
  threshold — its edges are indicative only."). Both derive from the counts data —
  never hard-code the list. Flagged values stay fully legible: no dimming, no greying,
  the caveat sits alongside the numbers.
- **Archetype cards** — collapsed row: number, name + Mono player count, two-line
  description, four matchup bars (the two best and two worst matchups), chevron. Bar
  tags, bar fills and edge values in the Strong against / Weak against lists all derive
  from the same ±2 band as the grid — DOM VS `--pos`, EVEN VS `--muted-2`, WEAK VS
  `--neg` — so a card can honestly show "Weak vs" on its best matchup (Solid Defender
  loses all seven) or "Dom vs" on its worst (All-Court Elite wins all seven); the tag
  states the band, the position in the card states best/worst. Label and bar always
  match exactly. Bar fill length is the raw win rate. Expanded: a
  five-band verdict word, the −40/0/+40 matchup-summary slider (clamped, brand-blue
  fill, knob ringed in the verdict colour), the average-edge line (green/red/neutral by
  sign), Strong against / Weak against top-3 lists, and example-player chips ordered by
  Elo whose names follow the standard profile-link rule.
- **Description truncation** — collapsed cards show the FULL description under a
  two-line CSS clamp (`-webkit-line-clamp:2`), which wraps at word boundaries so the
  ellipsis always lands after a complete word; expanding shows the full copy. Never
  reintroduce hand-pre-truncated strings — a stored "…mid-wor…" string was the original
  bug and clamping the full copy is the fix.

## Match Analysis modal — all tabs reviewed and documented (shell + Odds, Weather, Tournament, Overview, Progression, H2H, Form, Playing style, Key factors, Match Stats)

- **Shell** — overlay `rgba(4,5,8,0.72)` with `backdrop-filter: blur(3px)` at z-index 80;
  card max-width 1500px × 88vh, `--card` on `rgba(255,255,255,0.09)`, radius 20px,
  shadow `0 40px 120px rgba(0,0,0,0.6)`. Header is a 1fr/auto/1fr grid (20px 24px
  padding, `rgba(255,255,255,0.07)` bottom divider): title Hanken 22px 800, subtitle
  Hanken 12.5px `--muted` with " · " separators. Player identity: first-named `--player-a`,
  second-named `--player-b`, 16px 700, `plink` profile links; 40px circle avatars with
  Mono initials. Header odds pills: Mono 15px 700, text in the identity colour, both on
  `rgba(255,255,255,0.04)` / `rgba(255,255,255,0.09)` — favouritism is never colour-coded.
  Close: 34px, radius 9px, `--muted` glyph on the 0.09 border; hover
  `rgba(255,255,255,0.06)` + `--text`.
- **Tab rail** — 238px column behind a `rgba(255,255,255,0.07)` divider; items 10px 12px
  padding, radius 10px, 13.5px weight 600 in both states. Active: `rgba(91,155,255,0.12)`
  fill, NO border, text `#fff`, icon `--brand`; inactive text `--muted`, icon `--muted-2`;
  hover `rgba(255,255,255,0.04)` + `--text`. Weather is the default tab on open.
  ⚠ Deviation, recorded not resolved: the active state (0.12 borderless fill, `#fff`
  text, weight unchanged) does not match the segmented-control rule (0.22 fill,
  0.45 border, `--text`, 700). "Download report" sits pinned at the rail foot above a
  top divider, `--brand` 13px 700.
- **Odds tab order** — Market dropdown ("Match Winner", static display: `--card` on
  0.09 border, radius 10px) + CHART LINES checkbox row → Per-book movement (STEAM
  inline) → Odds movement → Prediction Markets.
- **Chart-line checkboxes** — 15px boxes, radius 4px: checked `rgba(91,155,255,0.22)` on
  `rgba(91,155,255,0.45)` with `--text` tick; unchecked transparent on
  `rgba(255,255,255,0.15)`. Pinnacle alone is checked on load.
- **Per-book movement** — heading row is a wrapping space-between flex: BOOKS badge
  (outlined `--brand`) + 17px 800 heading left; the STEAM group right — solid `--brand`
  badge with `#06070a` text (a known solid-fill outlier, recorded as found) and the
  sentence in Hanken 12px `--text` at a 10px gap. The whole STEAM group is clickable
  (pointer, no hover styling, no icon): it checks exactly the books behind the stated
  count in the CHART LINES row and unchecks the rest. Table: Hanken 11px caps `--muted`
  column headers, identity-coloured player-name headers, rows 13px 18px on
  `rgba(255,255,255,0.05)` dividers; opening odds Mono 12px `--muted-2`; current odds
  Mono 15px 700 `--text`; sparklines in the identity colours. **Movement deltas are
  directional by explicit decision** (the scoped exception to the non-semantic rule):
  `delta >= 0 ? '#3dd68c' : '#e0616f'`, Mono 11.5px, explicit +/− sign on every value,
  zero takes green, no neutral state. Best price: value `--pos` on an
  `rgba(61,214,140,0.12)` tile.
- **Odds movement** — 17px 800 heading (no dot) + `--muted` caption. Summary cards:
  Player A on `rgba(91,155,255,0.08)` / `rgba(91,155,255,0.35)`; Player B on
  `rgba(123,145,180,0.08)` / `rgba(123,145,180,0.3)` (an off-token blue-grey family,
  recorded as found); label Mono 9px in the identity colour, value Mono 22px 800, delta
  Mono 12px 700 on the SAME directional hexes and logic as the table. The
  Opening / Now phase control uses `#5b9bff` text on `rgba(91,155,255,0.18)` /
  `rgba(91,155,255,0.35)` when active — ⚠ off the segmented-control rule, recorded not
  resolved. Chart: one series per checked book per player, identity-coloured polylines
  at strokeWidth 2.4 (first checked book full opacity, others 0.4); Mono 12px `--muted`
  scale values; Mono 12px 700 uppercase series name labels; endpoint pills (`--card` on
  the identity colour, Mono 12px 700); axis words "Open" and "Now" in Hanken 11px
  `--muted`; Mono caption beneath.
- **Prediction Markets** — caps `--muted` header + BETA badges (`--player-a` on
  `rgba(91,155,255,0.12)`); venue rows 13px 18px on 0.05 dividers, liquidity in Mono
  15px 700 `--text`; Total matched row on `rgba(255,255,255,0.1)` top divider with the
  value in Mono 16px 700 `--text` — a summed data value, never brand blue.

### The shared match-detail component (`Match Detail.dc.html`)

One implementation of the expanded match block, mounted via `dc-import` at seven
points: Tournament ×2 (year rows + "show more editions" rows, fed by the year-loop
decorator in `tournamentFor`), Overview ×2 (year cells + season rows, fed by
`genMatches`'s `ext` in `overviewFor`), H2H (`genDetail` in `h2hFor`), Form
(`Form Match Row.dc.html` fed by `formFor`'s `genDetail`) and Playing style
(`Style Match Row.dc.html` fed by its `genDetail`). Each call site owns its OWN
view/scope state keys (`maTM…`, `maOv…`, `maH2H…`, `maForm…`, `maPS…`) — the
component takes state and change handlers through its `d` prop and never owns state.

- **The `d` contract** — `viewTabs`/`statScopeTabs`/`pointScopeTabs` (segmented objects
  with onClick), `isSummary/isStats/isPoints`, `statsEmpty/statsPresent/pbpEmpty`,
  `aName/bName` (name order = identity), `sumA/sumB` ({ setsWon, cells:[{g}] }),
  `statGroups` (rows: label, aTxt/bTxt, aShare/bShare, aColor/bColor), `pointSets`
  ([{ games }] — each game: gA/gB, aColor/bColor, serverA/serverB, `aLost`/`bLost`
  broken-serve flags, points:[{txt, bp}]), `setScoreLine`. Missing views render the
  muted empty state — never fabricated content.
- **Controls** — Level 1 Summary · Stats · Point by point (Stats default) and Level 2
  scope (Match · Set n in Stats; Set n in Point by point; none in Summary; options from
  sets actually played) — both standard segmented values, both centred in a **720px
  max-width content container** that governs all three views; 20px gap from the last
  control row to content.
- **Summary** — one CSS grid (`1fr auto` + one `minmax(26px,auto)` column per set,
  centred cells) holding three rows: both score rows (name left in identity colour,
  sets-won tile, per-set games) and a MATCH TIME row — label at the names' edge, total
  (Mono 12.5px 700 `--text`) under the tile, per-set durations (Mono 10.5px 400) under
  their set columns. The component's small logic class derives the grid columns and
  PLACEHOLDER durations from the score cells (per-set minutes from game count, summing
  exactly to the total; em dash where unreadable) — marked TODO in source; no duration
  data exists in the build.
- **Stats** — rows grouped under Hanken 10px `--muted` caps bands on
  `rgba(255,255,255,0.03)`; a names row in identity colours above. Bars are
  FIXED-CENTRE, TOTAL-NORMALISED: two half-tracks (`rgba(255,255,255,0.09)`) meet at an
  immovable 50% centre with a 2px gap; each segment = (value / combined total) of its
  half — segments never fill their half unless the other value is zero; zero total
  draws no bar. Counts sum directly, percentages sum as independent rates, fractions
  compare converted values. Left segment `--player-a`, right `--player-b`; values Mono
  700 in identity colours.
- **Point by point** — per-game rows (600px cap, centred, 20px 4px padding on 0.07
  dividers): running score Mono 20px 700 — game-winner's number `--text`, trailing
  `#4b5672`, NO identity or brand colour on scores; a 13px neutral-stroke ball SVG marks
  the server; sequences Mono 12.5px `--text` at 5px gaps. Markers: LOST SERVE and BP in
  the NEGATIVE token (`#e0616f` on `rgba(224,97,111,0.15)` / 0.3 border — the scoped
  green/red exception, product-wide within this block); an SP branch does not exist here
  (no caller emits set-point flags).
- **Remaining non-parities with the Match Stats tab** — the per-set "POINT BY POINT ·
  SET N" label band (H2H/Form/Playing style feeders carry labels; Tournament/Overview's
  don't yet) and the tiebreak sub-table (no caller emits a tiebreak point log). Both are
  fold-in items, not design intent.

### Weather tab

Section order: Forecast at match time → How conditions affect play → Tournament week ·
Mon–Sun → narrative block.

- **Forecast at match time** — caps 11px `--muted` section label with the forecast
  timestamp right-aligned in Mono 12px `#6aaeff` (⚠ identity blue on a data value,
  recorded not resolved). Three cards: `--card` on `rgba(255,255,255,0.09)`, radius
  12px, 28px 20px padding, centred column; 30px icons stroked `--brand`. Values are
  Mono 38px 700 `--text` with the unit inline at FULL size on all three — one
  convention: `18.4°C`, `6.2 km/h`, `69%`. Mood word beneath in Hanken 13px `--muted`.
  Mood words are computed for these three headline values only; the day cards carry
  none and none are authored for them.
- **How conditions affect play** — three cards (caps 11px `--muted` label): the verdict
  word (Faster/Neutral/Slower · Elevated/Neutral/Reduced · Longer/Neutral/Shorter) is
  Hanken 21px 800 `--text`. **Rule: derived verdicts are `--text`** — never brand blue
  and never semantic colour, because they are not quality judgements (a slower court
  favours one player and disadvantages the other). Bars: `--muted` fill on
  `rgba(255,255,255,0.09)` track, 8px tall, radius 5px, full card width. **Rule:
  directional bars state their direction with endpoint labels, not colour** — Hanken
  9px `--muted-2` pairs 6px beneath each bar: Court pace "Faster … Slower" (fill
  measures slowness — fuller = slower), Serve advantage "Returner … Server" (fuller =
  more server advantage), Rally length "Shorter … Longer" (fuller = longer rallies).
  The verdict word and the fill direction always agree.
- **Tournament week** — caps 11px `--muted` label with the date range right-aligned in
  Mono 12px `--muted-2`. Seven day cards in a bordered container (radius 12px, 14px
  padding): grid `repeat(7,1fr)` at 11px gap — grid stretch equalises card heights, and
  a fixed 13px slot rendered on EVERY card between the temperature pair and the stat
  rows keeps the Rain/Wind/Hum block on one shared baseline (the slot is empty on six
  cards; never fill it with characters). Card: `--card` on `rgba(255,255,255,0.07)`,
  radius 14px, 15px 10px 13px padding; the match day takes `rgba(91,155,255,0.08)` /
  `rgba(91,155,255,0.45)`. MATCH badge: Mono 8.5px 700, `#fff` on `--brand-deep`
  (`#2f6bd8`), radius 5px, floating centred at top:-9px (⚠ `#fff` where `--text` is the
  token, recorded as found). Day name 13.5px 700; date Mono 10.5px `--muted-2`; 30px
  condition icon (rain `--brand`, sun `--warn`, cloud `--muted` — iconography, not data
  quality); condition word 12px `--muted`. "HIGH · LOW" label: Hanken 9px `--muted-2`,
  0.1em caps, once per card above the pair (Mono 18px 700 high / 12px `--muted-2` low).
  The MATCH card's slot renders "18:00 · 18.4°" in Mono 10px `--muted`, centred — the
  time is parsed from the same string the headline timestamp shows and the temperature
  is the same figure behind the headline card; neither is hardcoded, and the line only
  renders when the match record carries a time. Stat rows are Mono 10.5px, labels
  `--muted-2`; rain value: `--warn` at ≥ 40%, `--neg` at ≥ 65%, `--text` below 40;
  humidity follows the same shape at ≥ 65% / ≥ 78%; wind stays `--text`.
- **Narrative block** — `--card` on `rgba(255,255,255,0.09)`, radius 12px, 16px padding;
  an 18px `--brand`-stroked ⓘ icon beside Hanken 14px/1.55 `--text` prose. The
  paragraph is assembled from the same seeded values the cards read (conditions line,
  play-impact line, and a week line computed from the day cards' rain values).

### Tournament tab

Section order: venue header → two win-rate columns (one per player) → year-by-year
lists with expandable match rows → shared earlier-editions link row.

- **Venue header** — `#0b0f18` card on `rgba(255,255,255,0.09)`, radius 16px; a 56px
  initial tile and the surface pill both take the surface colour, surface-DRIVEN via
  `{ Hard: '#4db8ff', Clay: '#e8a84e', Grass: '#2ab8a0' }` with computed 0.15 background
  / 0.3 border — text, dot and chrome all from the mapping, never hardcoded. Four data
  cells (Category · Court speed · Altitude · Round): caps 11px `--muted` labels over
  16px 700 `--text` values; court speed ("0.98 · Medium") is neutral — no semantic
  colour anywhere on it. The venue paragraph (Hanken 13.5px `--muted`) is keyed to
  SURFACE, not venue — only the city name is interpolated; every hard-court event shows
  the same copy.
- **Win-rate cards** — per-player cards on an identity-tinted gradient (`hexA(identity,
  0.16)` → `--card`) with 0.32 identity border; the percentage is Mono 44px 800
  `--text`, "win rate" Hanken 14px `--text`; the bar fill is the player's identity
  colour BY NAME ORDER (A `--player-a` left, B `--player-b` right) on an
  `rgba(255,255,255,0.09)` track — never coloured by value. Record is Mono 14px 700;
  "N editions played" Hanken 12.5px `--muted`.
- **Year-by-year list** — rows on `#0b0f18` with a `rgba(255,255,255,0.09)` border that
  lifts to `rgba(91,155,255,0.35)` while expanded (the standard selected state; no left
  accent). Year chips: Mono 13px 600 `--text` on `rgba(255,255,255,0.04)` /
  `rgba(255,255,255,0.09)`, radius 6px. Withdrawal rows are italic `--muted-2` and show
  an em dash in the record column — a withdrawal is the absence of a result, and the
  dash is authored at that branch so a genuine 0-0 (computed from real matches) could
  never render as one. Earlier-editions links sit in one shared `1fr/1fr` row beneath
  both columns, centred per column, same baseline regardless of column lengths, empty
  cell held when a column hides nothing: "Show 5 earlier editions · 2018–2022 ›" —
  count and words Hanken, the year range Mono, en dash, bare year when one; collapse
  label "Hide earlier editions ›" with no range; `--brand` 13px 600, hover `#6aaeff`.
- **Match rows** — date Mono 11.5px `--muted`, opponent line Hanken 13px `--text`
  ("def. / Lost to" carries the outcome — no green/red anywhere on it), round 11px
  `--muted-2`, score Mono 12.5px `--text`, `--brand` → chevron. The opponent name is a
  standard profile link: no resting colour or underline, hover underline only. While a
  row's block is open the → becomes ▾ and the row's muted text (date, round) lifts to
  `--text` — no background, border or accent marks the open row; the row itself is the
  toggle (click again to collapse).
- **Expanded Match Stats block** — a mount point of the shared match-detail component
  (`Match Detail.dc.html` — see "The shared match-detail component" above for the block's
  full anatomy: controls, Summary grid, bars, point-by-point and markers). Tab-specific:
  parented to its row by a 24px indent with a full-height 1px `rgba(255,255,255,0.09)`
  rule (no background, border or radius — a full border would make it a peer card);
  header is caps `--muted` "Match stats · <round>" with the set scores in Mono `--text`
  right; its stat set has SERVICE (Aces, Double faults, 1st serve in, 1st serve won,
  2nd serve won), RETURN (Break points — the fraction compares CONVERTED counts) and
  POINTS (Winners, Unforced errors, Total points) bands; per-set stats don't exist, so
  Set scopes show the component's empty state.

**Rules this tab establishes** — two-player comparison bars are centre-split, one
proportional segment per player, never a single fill encoding one side; segments take
identity colour by name order, never by who leads or won; a result attached to a name
carries no colour (wording + score state the outcome, names keep the no-resting-colour
link treatment); a withdrawal shows an em dash, never 0-0; an expanded detail block is
parented to its row by indent + left rule, not a full border.

### Overview tab

Section order: tier filter (top right of the "Career records by tier" label row) → two
per-player columns, each holding a career card → "This season · by surface" rows →
year-by-year table → a centred footnote explaining the ATP badge.

- **Tier filter** — All · ATP · Challenger & ITF (All default), standard segmented
  values (active `rgba(91,155,255,0.22)` / `rgba(91,155,255,0.45)` / `--text` 700;
  inactive borderless `--muted` 600) on an `#0a0d13` container. It is the SINGLE tier
  control for the whole tab — career cards, season rows and year tables in BOTH columns
  read the same state, so the two players can never show different tiers.
- **Career cards** — identity-tinted gradient cards (as on Tournament); the record is
  Mono 31px 800, the win rate Hanken 14px 700 `--text` (a Hanken figure — recorded as
  found). Three surface rows: Hanken 12.5px `--text` label, a 7px single-fill bar in
  the COLUMN'S identity colour (A `--player-a` / B `--player-b`, by name order) on an
  `rgba(255,255,255,0.09)` track, record · percentage in Mono 12px `--muted`. The bars
  stay single-fill because the card describes one player — it is not a comparison. The
  caption "Bar length = win rate on that surface" (10px `--muted-2`) is load-bearing.
- **This season · by surface** — three rows (`#0b0f18`, 0.09 border, 3px blue-family
  left accent — see conflicts): surface label, Mono 14px 700 record, Mono 12px 700
  percentage (green ≥ 60 / red ≤ 40 / `--text` between, `--muted` when empty). Rows
  with matches are clickable: the › chevron becomes ▾ while open (no background,
  border or accent change) and the row expands beneath itself with a "MATCHES · 2026 ·
  <SURFACE>" caps header, the standard match-row anatomy (W/L marker, opponent,
  tournament · round · date, score with `--neg` "ret." where retired, per-match
  chevron), and a muted centred "+ N more" footer when the list truncates at 14.
  Rows with no matches carry no chevron and do not respond to clicks.
- **Year-by-year table** — YEAR · TOTAL · CLAY · HARD · GRASS under caps 11px `--muted`
  headers on `#11161f`; records in Mono 12.5px with hyphen notation; an em dash in
  `#3a4250` marks a year with no matches on that surface (absence, not zero) and is
  not clickable. Every populated cell (including TOTAL) is a toggle carrying its own
  ▸/▾ chevron in `--brand` 8px; opening a cell expands that year's match list for that
  surface (TOTAL = all surfaces) beneath the row; hover is a faint
  `rgba(255,255,255,0.05)` tile, never an underline. Older seasons show a Mono 8px ATP
  badge (`--player-a` on `rgba(91,155,255,0.12)`), explained by the centred footnote
  beneath the table. The Total row sums under the active tier on an
  `rgba(255,255,255,0.1)` divider.
- **Expanded match-stats block** — a mount point of the shared match-detail component
  (`Match Detail.dc.html` — see "The shared match-detail component" above for the block's
  full anatomy: controls, Summary grid, bars, point-by-point and markers). Tab-specific: same
  24px-indent + left-rule parenting and caps date — tournament — round header; this
  feeder has no Break points row, so no RETURN band renders; per-set stats don't exist
  (empty state); point-by-point is generated by the shared `tourPbp` engine.

**Rules this tab establishes** — one filter governs a tab: where one taxonomy applies
to several blocks, a single control drives all of them, and the two columns of a
comparison can never sit on different filter states; per-player cards use single-fill
bars in that player's identity colour while two-player comparisons use centre-split
bars — the bar form follows whether the block describes or compares; an expanded state
is marked by chevron rotation (›/▸ → ▾) and text lift only — no underline, no
background, no border, no accent.

### Progression tab

Section order: header row (title + legend) → matrix table → Summary paragraph.

- **Header** — "Player Tournament Progression" Hanken 20px 800 in the inherited text
  colour; "— <tournament>" beside it at 20px 600 `--text` (the value reads brighter
  than nothing — same size, the label carries the weight); a 15px `#4d5666`-stroke ⓘ.
  The FIELD methodology sentence renders as VISIBLE text beneath the legend row, above
  the table header — Hanken 12px `--muted`, line-height 1.5, full content width: "Mean of
  every player in the <tournament> draw at each round — the benchmark for
  above/below-tour form. Shows form built BEFORE this match; the match on this card is
  excluded. A player is charted once they have survived two rounds." Legend: two
  identity swatches (22×3px bars in `--player-a` / `--player-b`, Hanken 12.5px 600
  `--text` names), a 1px divider, then ↗ up ↘ down "vs prev round" — arrows and all
  three words in `--text`, Mono 11.5px (words Hanken 11px). The legend arrows carry NO
  semantic colour: up and down are not good and bad, and the legend must not teach a
  rule the table doesn't follow.
- **Matrix table** — grid `minmax(170px,1.2fr) 112px repeat(5,1fr) 78px` under caps
  11px `--muted` headers (METRIC · TREND · R1–R4 in Mono 9.5px · AVG in Mono `--text`
  800 · FIELD right-aligned). Round NAMES do not exist in the data — the columns are a
  hardcoded R1–R4 array with no mapping to actual rounds or to the current match — so
  no round labels are shown and none are to be inferred. METRIC: Hanken 13px 600
  `--muted` name over a Hanken 9px `#4b5672` caption driven by per-row data flags —
  `ratio: true` renders "ratio", `lowerBetter: true` renders "lower is better", both
  join with " · "; the defaults (percentage, higher-is-better) render nothing. A new
  metric declares itself through the same flags, never a hardcoded exception. Unforced
  errors is the only lowerBetter row; Winners / UE the only ratio row. TREND
  sparklines: 1.75-stroke polylines in the identity colours with 4px endpoint dots,
  normalised PER ROW — min/max over that row's a + b + field values, padded by
  `pad = max((hi−lo)×0.4, ratio ? 0.12 : 3)`. Per-round cells stack A over B: Mono 11px
  values in identity colour (A 800, B 600), each preceded by a 9px ↗/↘/· arrow in the
  SAME identity colour — movement is directional, the glyph carries it; R1 has no
  previous round and carries no arrow. AVG: stacked Mono 11.5px 800 badges, text
  `--player-a` upper / `--player-b` lower by name order (never by which value is
  higher), both on identical `rgba(255,255,255,0.04)` / `rgba(255,255,255,0.09)`
  translucent chrome, radius 6px. FIELD: Mono 11.5px 700 `--text` — a single reference
  value with no badge or box — behind a full-height 1px `rgba(255,255,255,0.07)` left
  divider.
- **Summary paragraph** — 0.09-bordered block on `rgba(255,255,255,0.012)`, radius
  12px, 16px 20px padding; caps `--muted` "Summary" label over Hanken 15px/1.75
  `--text` prose with `text-wrap: pretty`. The prose is an authored sentence template —
  player and tournament names interpolate, but its figures (72% / 67% / "near 69%") are
  authored constants, not derived from the table.

**Rules this tab establishes** — comparative shading is not semantic: where two
players' values sit side by side, colour distinguishes WHO, never who is higher —
green/red on a comparison repurposes the quality tokens and is not permitted;
round-over-round movement is directional, not qualitative — arrows carry direction by
glyph in identity or neutral colour, never green/red; a metric declares its own unit
and direction as data properties rendered as a caption beneath its label (non-defaults
render, defaults render nothing); a legend must not teach a colour rule the table does
not follow.

### H2H tab

Section order: lede sentence → three headline cards → H2H trend chart card → full
match history → muted coverage footnote.

- **Lede** — Hanken 15.5px/1.55 `--text`; the player names (700) and the record clause
  carry NO colour beyond `--text` — prose takes no identity colour — and the names are
  plain text, not links. Wording: "<A> and <B> have met N times on record, with <leader>
  leading X-Y." (or "the series level at X-X").
- **Headline cards** — three across on `#0a0d14`, radius 16px, 20px 24px padding, NO
  left accent (an accent identical on every card distinguishes nothing); ⚠ the border
  is `rgba(91,155,255,0.22)` — a resting-state blue border, recorded as a deviation.
  Caps 11px `--muted` label, Mono 40px 800 figure, 12.5px `#4b5672` subtitle. The
  surface card names today's surface in its label ("On clay (today's surface)") and is
  the only card whose subtitle states a meeting count ("N meetings on record", singular
  handled); Overall and Sets records carry name-pair subtitles ("A — B").
- **Trend chart** — 132-unit-high SVG (`preserveAspectRatio: none`): a
  `rgba(255,255,255,0.15)` baseline at midY 60; one 2.5-wide rounded tick per meeting
  in the WINNER'S identity colour — A's wins point up from the baseline, B's down —
  with height `6 + margin/3 × 40` encoding the sets margin; Mono 8.5px `#4b5672` set
  scores at each tick's far end. Axis labels are month + year ("Oct '25") in Mono 9.5px
  `--muted` with 0.04em letter-spacing; "<A> win ▲" / "<B> win ▼" sit as absolute Mono
  10px `--muted` labels at the plot's left/right edges; the Mono 10px `#4b5672` caption
  "tick height = sets margin" sits centred 20px below. The sentence beneath
  (`trendNote`) is DERIVED — leader, record and meeting count computed from the
  history ("X has pulled ahead 5-2 over 7 meetings.").
- **Match history** — grid rows on `rgba(255,255,255,0.05)` dividers: Mono 12.5px
  `#4b5672` date, "<winner> def. <loser>" with the winner's name 700 in their identity
  colour, 12.5px `#4b5672` tournament · round, Mono 14px 700 score, surface label in
  its surface token, `--brand` › chevron on rows with per-match coverage (▾ while
  open; older rows carry no chevron and a footnote explains the coverage boundary).
- **Expanded match block** — a mount point of the shared match-detail component
  (`Match Detail.dc.html` — see "The shared match-detail component" above for the block's
  full anatomy: controls, Summary grid, bars, point-by-point and markers). Tab-specific: the
  full-width header row (caps `--muted` "<winner> def. <loser> · tournament · round" +
  Mono set scores) sits OUTSIDE the component's cap; its feeder carries per-set stats
  (Match · Set n all populate) and has no Break points row — SERVICE and POINTS bands
  only.

**Rules this tab establishes** — a detail block nested inside a wide container caps
its content width and centres it: full-width rows in a narrow block stretch label from
value and make proportional bars unreadable; prose carries no identity colour —
identity is for columns and rows in a comparison, and a sentence with
differently-coloured names reads as decoration, not structure; a repeated accent
identical across every item in a set distinguishes nothing and is removed, not
recoloured.

### Form tab

Section order: two player-card columns (card + tournament-grouped recent-match list per
player), side by side.

- **Player cards** — identity-tinted gradient (`hexA(colour, 0.16)` → `#0a0d14 70%`) on
  a 0.34 identity border, radius 16px, 20px 22px padding; the name is a 15px 700
  `plink` profile link. ⚠ Deviation: the card identity colours come from
  `AN.aOddsColor || '#5b9bff'` / `AN.bOddsColor || '#6aaeff'` — the old blue pair, not
  the `--player-a` / `--player-b` system (Player B tints blue here). The figure is Mono
  40px 800; its label reads **"Last 10 win rate"** — accurate, because the figure IS
  `Math.round(w / 10 * 100)`, an unweighted win percentage of the last ten with no
  recency, opponent, surface or margin weighting (the former "BSP form score" label
  implied a model that does not exist). Record Mono 22px 700 with a "last 10 · W-L"
  caption. Form strip: ten flex-1 segments, 7px tall, radius 4px, 4px gaps — wins
  exactly `#3dd68c`, losses exactly `#e0616f`, EVERY segment at full opacity: one shade
  per outcome (a prior `opacity: 0.6` on "tight" matches encoded an undocumented third
  state and was removed). Direction label beneath, left-aligned Hanken 9px `#4b5672`
  lowercase: "← most recent" — the newest match is LEFTMOST (dates decrement down the
  generated list and pill i maps to match i).
- **Recent matches list** — tournament group headers on `#11161f`: 12.5px 700 name,
  surface label in its surface token, per-group Mono record right. Match rows (child DC
  `Form Match Row.dc.html`): Mono 11px date, 13px opponent, Mono 12.5px score, a 22px
  W/L pill (`--pos`/`--neg` glyph on a 0.14-alpha tint — the token colours), `--brand`
  ›/▾ chevron. "Show N more matches / Show fewer" toggle in `--brand` 13px 600 pinned
  at the column foot.
- **Expanded match block** — a mount point of the shared match-detail component
  (`Match Detail.dc.html` — see "The shared match-detail component" above for the block's
  full anatomy: controls, Summary grid, bars, point-by-point and markers). Tab-specific: header is
  WINNER-FIRST in all cases — `won ? name + ' def. ' + opp : opp + ' def. ' + name`; the
  verb never flips, so the profiled player appears second when they lost. Rows live in
  the child DC `Form Match Row.dc.html`, which mounts the component; per-set stats
  populate; SERVICE and POINTS bands only.

**Rules this tab establishes** — a metric's label must describe its computation: an
unweighted win percentage is not a "score", and a name implying weighting requires that
weighting to exist; one shade per outcome — opacity, tint or a second shade must not
encode a further dimension on top of a categorical colour, because a viewer sees a
third state with nothing to explain it; a sequence whose direction is not self-evident
states its direction.

### Playing style tab (the modal tab — distinct from the standalone Playing Styles page)

Section order: two equal-height cards (radar · Style vs style edge, with Historical by
surface inside the edge card) → Dimension edge → "How each has fared vs this style ·
last 40 matches" (two cards).

- **Radar card** — `#0a0d14` on 0.09 border, radius 12px; the two top cards stretch to
  equal height (`align-items: stretch`) with the radar vertically centred via flex, not
  scaled. Four rings (25/50/75/100) with Mono 9px `#4b5672` value labels on the
  vertical axis only; the scale is 0–100 percentile vs the charted field (stated in the
  chart caption). Player A plots as a solid `--player-a` polygon with an
  `rgba(91,155,255,0.18)` fill; Player B as a dashed (`5 4`) `--player-b` outline, no
  fill; a swatch legend beneath names both.
- **Style vs style edge** — caps `--muted` label; the heading is winner-first prose
  ("Attacking Baseliners beat Counter Punchers") over player-ordered columns. The two
  Mono 34px 800 percentages take the identity colour of the player HOLDING each
  archetype (A left `--player-a`, B right `--player-b` — never `#5b9bff`), each with a
  Hanken 10px player attribution beneath in the same identity colour, so the
  archetype→player mapping is stated, not inferred. Slider: a two-segment identity
  track (`--player-a` left of the split, `--player-b` right) in one
  `position:relative` element; the split marker is a 2px square-ended `--text` TICK
  extending 4px beyond the track — a static marker, not a draggable-looking knob — and
  a 1px hairline marks 50%. The axis-label row is a separate normal-flow sibling 16px
  below (12px clear of the tick's extent), so no label can overlap the track at any
  split position: "Counter Puncher" left, "50%" absolutely centred under the midline,
  "Attacking Baseliner" right, Mono 10px `--muted`. The centre label is "50%" — the
  former "50% coin-flip" wording was removed because 50% denotes an even historical
  split across the sample, not a per-match toss-up; an axis label names what the axis
  measures, it does not characterise the value. Beneath: the "leans +7 pts" note in a
  brand-tinted pill (⚠ `rgba(62,123,250,0.1)` — an off-token blue family, recorded as
  found).
- **Historical by surface** — grid rows (surface · CTR · ATB): column values and header
  tags take the archetype-holder's identity colour (CTR `--player-a`, ATB `--player-b`);
  Mono 12.5px. Each row carries a 10px `#4b5672` `n=` disclosure. The current match's
  surface row carries a 2px `#4db8ff` left accent (driven by `row.surface ===
  AN.surface`) plus a Hanken 9px `#4b5672` "today's surface" label — the mark is
  explained in place. Verbatim disclosure beneath: "Placeholder data — wired from the
  surface-split matchup matrix."
- **Dimension edge** — six rows (Serve, Return, Baseline, Net play, Defence, Clutch):
  centred caps label over a centre-split bar — left segment `--player-a` grows
  leftward, right `--player-b` rightward on `rgba(255,255,255,0.09)` half-tracks,
  normalised so the larger value fills its half, no minimum stub; Mono 13px 700 values
  in identity colours at each end. The six value pairs are a fixed authored matrix
  (`DIMS`), identical for every match — not per-match data.
- **How each has fared** — two cards, one per player: title "<player> vs <archetype>"
  with the name in identity colour, an "<opponent>'s archetype" sub-label, and a Mono
  record + rate + `n=` line. No sample-size threshold annotation exists — percentages
  render at normal weight regardless of n, deliberately: sample size is disclosed, but
  judgement about it is not asserted. Match rows are `Style Match Row.dc.html` children
  (W/L pill, opponent, surface · venue, score, chevron); the expanded block is a mount
  point of the shared match-detail component (`Match Detail.dc.html`) — see that
  component's rules; this tab adds nothing to it. "Show N more matches / Show fewer"
  (the Form tab's convention) expands the remaining rows in place — `--muted` 12px 600,
  hover lifts to `--text`, no underline; the control renders only when hidden rows
  exist.

**Rules this tab establishes** — where a block compares categories rather than players,
identity colour follows the player who holds each category, and the mapping is stated
in the interface (attributions, column tags), not left to be inferred; a static marker
is not a control — a value that cannot be dragged renders as a tick, not a handle; an
axis label names what the axis measures and does not characterise the value; sample
size is disclosed, judgement about sample size is not asserted.

### Key factors tab

A SUMMARY surface: a `repeat(3, minmax(0,1fr))` grid of six clickable cards (`#0a0d14`
on 0.09 border, radius 12px, hover lifts the border to `rgba(91,155,255,0.35)`), each
condensing one tab and navigating to it via its `›` header link (Playing style · Recent
form/Form · Head to head/H2H · Dimension edge/Playing style · Tournament · Odds),
followed by a single-row weather strip (→ Weather) and the Stennisfy Model block.
Cards are deliberately sparse — they condense and link onward, never duplicating the
detail tab.

- **Playing style card** — identity-coloured names over Mono 9.5px archetype labels
  read from the real `PROF` map (format "<CODE> · <Full name>", e.g. "AGB · Aggressive
  Baseliner"; codes from a small map with initials fallback) — no longer hardcoded.
  Mono 26px style-edge percentages in identity colours over a two-segment split bar;
  verdict sentence beneath, with a same-archetype guard ("Both are Xs — no archetype
  edge either way"). ⚠ The rate and meeting count in the sentence (57%, 3,100) are
  AUTHORED — the matchup matrix lives in the standalone Playing Styles page DC and is
  not reachable from this builder.
- **Recent form card** — per-player 22px W/L pills (`--pos`/`--neg` on 0.14 tints),
  then "Last 10" and "<surface> 2026" rows behind a 0.07 border-top (the divider
  precedent the Tournament/Odds cards now match). No opponent-tier rows exist,
  deliberately: no ranking data of any kind exists in the build — not at match time,
  not current; `PROF` carries archetype + Elo only (neither an ATP ranking nor
  time-stamped) and the form generator draws opponents from a bare name list.
- **Head to head card** — Mono 32px record, then a centred LAST MEETING line (caps
  Hanken 9px `#4b5672` label; value = Mono month-year · Hanken tournament · Mono score
  in the WINNER'S identity colour, rest `--muted`), rendered only when date, tournament
  and score all exist; "N career meetings" beneath. The former 100%/0% percentage bar
  was removed — it restated the record in a second form and read 0% as "never wins".
- **Dimension edge card** — mini radar + the top-3 gap rows; both derive from the same
  authored `MR` constant (the same six pairs as the Playing style tab's `DIMS`) — not
  per-match data.
- **Tournament card** — title · caps round header · two identity-coloured player rows
  (record / "first appearance"), then a 1px `rgba(255,255,255,0.07)` divider at 14px
  above / 16px below, three Mono 17px stat figures (court speed · altitude · hold rate)
  with 10px captions, an 18px gap, and the descriptive paragraph. One break only — the
  records read as one group, figures + paragraph as the other.
- **Odds card** — Mono prices, an identity-split vig bar over Mono implied
  probabilities with a centred "vig removed" disclosure, then a 1px 0.07 divider at
  16px above / 14px below "ODDS MOVEMENT" (asymmetric: a divider belonging to what
  follows sits nearer to it), the movement sparkline with Mono "Opening odd"/now
  endpoint labels. pp deltas and ↓↑ movement arrows are NEUTRAL `--muted` here — the
  directional green/red override is scoped to the Odds tab and does not extend to this
  surface.
- **Weather strip** — one flex row: "WEATHER · MATCH DAY ›" caps label, then Mono 18px
  800 figures with 11px `#4b5672` captions (temp/mood, wind — unit rendered once as a
  smaller suffix on the figure — humidity, rain).
- **Stennisfy Model block** — two columns, one per player: Mono 48px "adjusted fair
  odd", the value badge, and per-book tiles (Pinnacle opened→now journey with a neutral
  movement arrow; best soft book with its gap). Fair prices are NO-VIG: `fair = odds ×
  (impA + impB)` — the overround stripped by the SAME method in both columns. The badge
  derives from the same `ppGap = (1/fair − 1/price) × 100` computation displayed beside
  it: SHARP VALUE only on the column with the larger, genuinely positive best-price
  margin — at most one column ever shows it, and both showing NO VALUE is the expected
  default in an overround market, not an empty state. Badges keep semantic green/red
  (value verdicts); all pp figures render Mono `--muted` with explicit signs.

**Rules this tab establishes** — a verdict badge derives from the number displayed
beside it: if the two can disagree on screen, one of them is decoration; in a
two-outcome market a value verdict is mutually exclusive between sides, and neither
side having value is the expected default — not an empty state to be filled; a summary
card condenses and links onward, never duplicating the detail tab it points to; a
semantic override granted to one surface does not propagate to other surfaces showing
the same measure.

### Match Stats tab

A separate full-tab surface (its own `matchStatsFor` builder), deliberately NOT a mount
point of the shared component — it carries capabilities the shared block lacks:

- **Not-played gate** — upcoming matches show a centred "Match not played yet" state;
  the views render only for completed matches.
- **Score header** — Mono 38px sets line over a 17px games line and a caps "STAT
  COMPARISON" caption, above the Stats view.
- **Structure** — Summary · Stats · Point by point (Stats default) + reduced-scale
  scope row, both standard segmented, centred in a 720px cap; 20px gap to content; the
  player legend (identity dots + names) renders in Stats/Point by point only, never in
  Summary. Summary is the same one-grid score+MATCH TIME layout as the shared component
  (deterministic placeholder durations, TODO-marked).
- **Stats extras** — fraction sublabels beneath values ("(31/62)", Mono 10.5px
  `--muted`); rows with no data render em dashes with the bar SUPPRESSED (no zero-length
  stub, no empty track). Bars are the same fixed-centre, total-normalised geometry as
  the shared component.
- **Point by point extras** — a per-set "POINT BY POINT · SET N" label band; SP
  (set-point) markers inline beside their point (`--text` on `rgba(255,255,255,0.04)` /
  0.09 — deliberately NOT red; a set point is not a break point); a full tiebreak
  sub-table (per-point rows, score → server dot → SP → LOST SERVE reading outward).
  Game-score colours and LOST SERVE / BP markers match the shared component exactly
  (winner `--text` / trailing `#4b5672`; markers in the negative token).
- ⚠ Deviation: the Stats legend dots still read `aColor/bColor` from the deprecated
  `#5b9bff`/`#6aaeff` pair — token-sweep item.

## News page (signed off — full spec)

Assume no other context: this section plus the export is the contract.

### Layout and structure
- **Global sidebar** (the shared `App Sidebar` component), News active. Content sits at
  the standard page inset (main padding 30px 40px 70px, max-width 1360px).
- **Left-aligned, never centred** — the reading column caps at **820px anchored to the
  left inset**. Every element on the page shares that left edge: filter row, date group
  headers, reading cards, the compact wire's time column, the empty state. Centring was
  tried and removed: it made the left edge shift between views (decision 3 below).
- **Header order** — H1 `Tennis News` (29px 800) → subtitle `Latest market and tour
  information` (13.5px `--muted`) → status line. **No ATP MEN'S badge** — removed
  deliberately: the product is ATP-only, the badge stated the obvious and competed with
  the H1. Do not restore it.
- **Status line** — 7px `--pos` dot with `rgba(61,214,140,0.18)` ring, `Live feed ·
  updated` in `--muted-2` 12px, clock `HH:MM:SS` in Mono 12px `--muted`. **One instance
  only**, in the header; a second copy above the feed was built and removed (the date
  group headers already anchor you once scrolled).
- **Filter row** — `All tournaments ▾` FIRST, then the four category pills:
  `Match Reports · Withdrawals & Injuries · Tour News · Draws & Schedules`. Tournament
  leads because it is the broader cut (pick the event, then the story type).
- **Search row** — 360px search field (placeholder "Search headlines, players,
  tournaments"; search matches all three) · `Post intel N/5` · `Reading / Compact`
  segmented control · `Last 7 days ▾`.
- **Footer** — provenance line ("Reporting via ATP Tour, Reuters, Tennis Majors,
  Ubitennis and other cited outlets") beside `For informational purposes only`, both
  13px `--muted-2`. The disclaimer lives here, not in the subtitle.

### Reading view (default)
- Cards: `--card #0a0d14`, 0.09 border, radius 12px, padding 16px 20px, 10px apart.
- **Meta row at two brightness levels** — player and tournament are the actionable
  entities: `#e7e9ee`, linked (player → profile via `player_key`; tournament → the
  Tournaments page via tournament key). Category chip and source are provenance:
  `--muted-2`. Links carry **no resting link colour**; hover adds underline only.
- Headline 16px 700 `--text`; time `HH:MM` Mono 11.5px `--muted-2` right-aligned,
  full timestamp on hover via `title`.
- **Body: `--text-body`, capped at `max-width: 68ch`** regardless of container width.
- Articles beyond 5 paragraphs truncate at 4 with `Read more` / `Show less` —
  `--brand` text, no underline at rest. Dormant at current article lengths.
- No disclosure caret in reading view: the body is fully shown (up to the 5-paragraph
  rule), so a caret would reveal nothing.

### Compact view (wire)
- One row per article on a **fixed column grid**: `time (42px) · player (104px) ·
  headline (flexible, ellipsis) · caret (16px)`, 12px gaps, full container width.
  Every player name and every headline starts at the same x.
- **No category chip column, in any state** — removed deliberately (decision 1 below).
  The 12px colour-coded dot in a fixed cell before the time is the documented one-step
  fallback if mixed categories prove hard to scan; it is NOT built.
- Rows separated by 1px `--border-subtle`, none after the last; hover raises the row
  background faintly and the border toward the hover blue.
- Headlines: one treatment (13.5px 600 `--text`) — no read/unread or category
  brightness encoding exists.
- Player cell holds players only; a tournament never substitutes. Player names link as
  in reading view; unresolvable names (free-typed intel) render plain.
- View choice persists across reloads (same mechanism as other persisted preferences).

### Expansion (compact)
- The open row stays **one line**: the headline moves to the player column's x with
  `· Player Name` riding after it — small (11.5px), `--muted`, still linked. The body
  opens beneath at that same x (68ch cap, `--text-body`), leaving only the 42px time
  column as a left gutter. The caret rotates 180° in place at the right edge.
- Collapsed rows keep the single-line layout — a permanent two-line row would halve
  rows-per-screen and defeat the view. Hide-the-player-on-open was considered and
  rejected: it removes attribution at the exact moment reading starts.

### Data rules
- **Player-attributed articles only.** Attribution comes from the `player_key`
  resolver, never from string-matching the headline. This REVERSES an earlier ruling
  that kept tournament-only articles with an empty player cell (decision 2 below).
- **Date group headers show the date alone** — `30 JUL 2026` in Mono 11px caps
  letterspaced `--muted-2` with a `--border-subtle` rule to the column's right edge.
  No `TODAY`, no `YESTERDAY`: relative words go stale past midnight; the times carry
  recency. Day boundaries resolve in the user's timezone.
- **Times are absolute** `HH:MM`, 24-hour, Plex Mono, bound to the user's timezone
  preference — a normal cross-page dependency: the control lives in **Account
  Settings → Preferences, row 3 ("Timezone")** and persists `stennisfy.tz` (IANA
  name); News reads that key and falls back to the browser timezone when unset
  ("Auto"). Missing timestamp → em dash, never a fabricated time. Rationale:
  decision 5 below.
- **Tournament dropdown options derive from the in-window feed**, resolved by
  tournament key — never a hardcoded list, never an option with no articles. The
  closed label resolves the selected tournament even when it has nothing in the
  current window. An article whose tournament can't be resolved stays in the
  unfiltered feed but appears under no specific tournament.
- Category taxonomy: exactly four pills (former Rankings / Coaching Changes / Player
  Features / Historical remap to Tour News); operator posts carry STENNISFY INTEL.
  Taxonomy is not colour-coded.

### The `--text-body` token
`--text-body: #a8b0c0` (~8.9:1 on `--card`) — the fourth text level, **scoped to
article body copy only**. It exists because News is the only page in the product with
real paragraphs, and the three existing levels have no body-copy level: `--text` at
~16:1 is harsh for sustained prose, `--muted` at ~3.5:1 fails WCAG's 4.5:1 for body
text. Never labels, captions, meta rows, or other pages.

### Empty states
Rendered where the first date group header would sit, same left inset, both views.
No card, no border, no icon — a quiet two-line state:
- Line 1: `No articles match these filters.` (15px `--text`).
- Line 2 (13px `--muted`) names the constraint responsible:
  - Search active → `No results for "term".` + `Clear search` link.
  - Tournament with zero articles anywhere → `No articles for X.` — no widening offer.
  - Tournament with articles outside the window → `No articles for X in the last
    24 hours.` + `Try a wider date range.` link.
  - Category (+ tournament) → `No Match Reports articles for X in the last 24 hours.`
    + widen link.
  - Window only → the widen link alone, or `No articles in the last 6 hours.` when
    widening wouldn't help.
- **The rule: never offer an action that wouldn't change the result.** The widen link
  renders only after checking the same filters against the un-windowed feed, and steps
  the range out one level (24h → 48h → 7 days).
- Feed genuinely empty with no filters → `No articles available.` + `Last updated
  HH:MM:SS.` (a data problem, not a filter problem — say so).
- Loading → a short `Loading…` in `--muted` if the fetch is slow enough to see; the
  mockup's feed is synchronous so this state exists only as this rule.

### Controls
- `Reading / Compact` on the one segmented standard: active `rgba(91,155,255,0.22)`
  fill on `rgba(91,155,255,0.45)` border, `#e7e9ee` at 700; inactive transparent,
  borderless, `--muted` at 600.
- `Post intel N/5` — outlined button: `--brand` text at 700 on transparent,
  `rgba(91,155,255,0.35)` border (0.5 while open), Mono count in `--muted`.
  **Founder-only**; collapsed by default, expands the composer in place above the
  feed; publishing or re-clicking collapses it. The count stays visible collapsed.
- Both dropdowns (`All tournaments`, `Last 7 days`) — translucent
  `rgba(255,255,255,0.04)` fill, 0.09 border, radius 10px; dark `#0a0d13` panel on
  0.15 border radius 12px, `--brand` checkmark right-aligned on the active row,
  translucent hover. **No solid fills anywhere on this page.**
- Composer internals unchanged from the product standard: `--card` block, 0.09
  border, radius 12px; textarea + optional player field on `rgba(255,255,255,0.04)`;
  outlined Publish; published posts are real feed entries with plain-text Edit /
  Delete (`--muted`, hover `--text`).

### Decisions of record (do not re-litigate without a ruling)
1. **Category chip removed from compact** — category is a filter dimension, not
   per-row data; the chip cost the headline column ~180px and repeated identically
   whenever a category filter was active. Fallback if needed: 12px colour dot, never
   the label.
2. **Player-only filtering** — reverses the earlier keep-with-empty-cell ruling.
   Intentional; do not restore tournament-only articles as a bug fix. The articles
   remain in the source data; the filter is one line.
3. **Reading column left-aligned, not centred** — every element anchors to one left
   inset; centring made the left edge shift between views and disagree with the
   header. Empty space falls entirely to the right by design.
4. **Body capped at 68ch at any container width** — widening the container must never
   widen the prose. The cap is the readability fix; the container width is layout.
5. **Absolute time over relative** — a withdrawal posted 20:26 against a 21:00 start
   is the entire decision; `2h ago` hides it. `HH:MM` to the minute, always.

### Blue-scope rule (supersedes the earlier News list)
**Blue on News marks navigation and interactive text: the sidebar's active item, the
segmented toggle's active fill, outlined-button text, dropdown checkmarks, and inline
action links. Blue never appears on a performance value, a category, a source, or a
timestamp.**

Current instances, as illustration (non-exhaustive): `Post intel` and `Publish`
outlined buttons; `Read more` / `Show less`; `Clear search`; `Try a wider date
range`; the ✓ in both dropdowns. **Entity links (player, tournament) carry no resting
blue** — their colour is identity (`--text`), not affordance; hover adds underline
only. A blue entity link at rest is the rule being broken, not an addition to it.

## Account Settings — Preferences fold-ins

The Preferences card (in-app Account Settings, reached from the sidebar user chip)
carries three rows, each label + sublabel left, control right, split by
`rgba(255,255,255,0.06)` rules:

1. **Odds format** — segmented control (Decimal · Fractional · American), the one
   segmented standard.
2. **Favourite bookmakers** — Mono dropdown, multi-select with `--brand` checkmarks.
3. **Timezone** — label `Timezone`, sublabel `Sets the time on every match card, alert and report.`,
   dropdown matching the bookmakers row. Options: `Auto (browser)` plus named
   zones; the choice persists as `stennisfy.tz` (IANA name), `Auto` clears it.
   Folded in from a live capability the design phase hadn't seen; News (and any
   future timestamped surface) reads the key. `export/account-settings.html` is
   re-cut from the current dashboard source and opens directly on this page (the
   earlier standalone exploration that shipped under that name is deleted).

## Match Analysis modal — News tab (signed off)

Assume no other context: this section plus the export is the contract.

### Rail position and count
- Second in the rail: after `Key factors`, before `Playing style` — news is
  context you want before the numbers.
- **This takes the modal from ten tabs to eleven** (ten was the count after Extra
  Stats was removed). News earned a tab rather than a Key-factors section because
  a withdrawal or injury report is a different kind of thing from a stat, and
  folding it into another tab means it gets missed.
- Tab label reads `News`, no count badge — the rail has no badge pattern, and an
  unread-style badge would imply state the modal doesn't track.

### Structure
- Toggle at the top: `All / [Player A] / [Player B]` on the one segmented standard —
  active `rgba(91,155,255,0.22)` fill, `rgba(91,155,255,0.45)` border, `#e7e9ee` at
  700; inactive transparent, borderless, `#5b6880` at 600. Never a solid fill.
  Labels carry `white-space:nowrap` (names like `C. Alcaraz` otherwise wrap at the
  initial in a shrinking flex row).
- Two groups: `[PLAYER A]` then `[PLAYER B]`, chronological within each. Group
  headers: Plex Mono 11px, uppercase, 0.12em letterspaced, rule to the right
  edge — **in identity colour**: Player A `#6aaeff`, Player B `#e7e9ee`, fixed by
  name order.
- `View all news →` in `--brand` at the bottom, linking to the News page. (Spec
  says pre-filtered to both players — see the conflict note below.)

### Row treatment
- Row is `date · time · headline · caret`: `Jul 31 · 08:40` in a 104px Plex Mono
  cell, headline 13.5px 600 with ellipsis, caret 11px `--muted` at the right
  edge. **No player column** — the group header supplies it.
- Expansion follows the News page's compact wire exactly: click opens the body
  beneath the headline at the headline's x (the date cell stays as the left
  gutter), columns hold, caret rotates 180° in place. Body: `--text-body`, 68ch
  cap, 1.7 line-height.
- **This reuses the News page's compact wire — it does not define its own.**
  `--text-body`, 68ch cap, dividers (`--border-subtle`, none after the last row),
  hover treatment, and timezone binding (`stennisfy.tz`, browser fallback) all
  inherit from the News section of this README. Anyone changing one surface must
  check the other. Both read the same shared feed (`news-feed.js` →
  `window.STENNISFY_NEWS`), so the data cannot drift either.

### Empty states
- A group with no articles does not render at all — no header, no placeholder.
- Neither player has articles → `No recent news for [Player A] or [Player B].` at
  15px `--text`, with `View all news →` beneath. No card, no icon.
- Feed unavailable → `News feed unavailable.` + `Last checked HH:MM:SS.` — a data
  problem stated plainly, never a false empty state.

### Data rules
- Attribution through the `player_key` resolver, never string-matched from the
  headline. Only player-attributed articles appear.
- Missing timestamp → em dash, never a fabricated time.

### Decisions of record (do not re-litigate without a ruling)
1. **Two groups, not three.** A `THIS MATCH` relevance group was specced, built and
   rejected — the `All / A / B` toggle already does that filtering, and a third
   group added structure without adding reach.
2. **Both-player articles appear under both players.** Deliberate duplication,
   not a bug. An article mentioning both is genuinely relevant to each, and the
   toggle means you'll usually be viewing one player at a time.
3. **Date in the row, not in a sub-header.** Day sub-headers inside player groups
   were built and rejected: with one article per day they degraded to a header
   per row, fragmenting the list worse than the repetition it removes.
4. **Chronological within group, not relevance-ranked.** The groups carry the
   relevance; within a group, time order is the only order a reader can predict.
5. **Mini reading cards were built and rejected** (too little density — ~2
   articles per screen in a constrained modal). The wire is the ruling; do not
   restore cards as an "upgrade".

### Conflict, flagged not resolved
- **`View all news →` pre-filtering.** The spec says the link opens the News page
  pre-filtered to both players; the build opens it unfiltered, because the News
  page's filters (category pills, tournament dropdown, search) don't expose a
  player filter to deep-link into. The two rules disagree; either the News page
  grows player-filter plumbing or the spec line relaxes. Tracked in Known gaps.
## Known gaps at handoff

None of the items below is design intent. They exist so nothing here is mistaken for it.

**Authored constants presented as computed**
- Playing Styles page: the entire win-rate matrix (`WR`), player counts and example
  Elos ("design mock" in source).
- Player Profile: `SURFSTATS`, year-by-year records, market-performance deltas, and the
  HLD% (70.5) / BRK% (21) threshold baselines.
- Dashboard: tournament conditions (`TOURS`/`COURT`), the completed-matches slate,
  the player archetype/Elo map (`PROF`).
- Match Analysis modal: Progression's `defs` matrix and its summary-paragraph figures
  (72% / 67% / "near 69%" — TODO-marked); Playing style tab's `DIMS` and the Key
  factors card's duplicate `MR` copy of it; the style-edge rate and meeting count
  (57%, 3,100) in both tabs' sentences; Key factors' soft-book prices (odds × authored
  multipliers) behind the no-vig value verdicts.
- Stennisfy Model: market open timestamps, soft-book names, confidence thresholds.

**Generated content that must be REMOVED, not extended, when real data lands**
- The seeded point-by-point generators (`tourPbp` + the per-tab `genDetail` engines and
  Match Stats' `buildSet`/`genPointSeq`): every point sequence, tiebreak and LOST
  SERVE/BP/SP flag is derived from set scores, not from a point log. Real point data
  replaces these wholesale.
- Match durations: no duration data exists anywhere; all MATCH TIME values are
  deterministic placeholders derived from game counts (TODO-marked in the shared
  component and the Match Stats tab).

**Missing data the interface already anticipates**
- No opponent ranking data exists — not at match time, not current. Opponent-tier form
  rows ("vs top 100/50") require ranking-at-match-time recorded per match row.
- The news feed is authored placeholder data (shared `news-feed.js` → `window.STENNISFY_NEWS`, read by both the News page and the Match Analysis News tab — replace with news-feed.json).
- The Match Analysis News tab's `View all news →` opens the News page unfiltered; pre-filtering it to the match's two players needs filter plumbing the News page doesn't expose yet.
- ~~Timezone binding (News)~~ — RESOLVED: the Timezone control exists in Account
  Settings → Preferences row 3 and writes `stennisfy.tz`; News reads it. See
  "Account Settings — Preferences fold-ins".
- **News loading state**: the mockup feed is synchronous; the `Loading…` state exists
  as a rule in the News section but has no rendered implementation to copy.

**Token-sweep set (off-token values recorded as deviations — the complete audited
list; a developer can work it top to bottom without cross-referencing subsections)**

> **DECISION (TEN-8, 2026-07-31, founder ruling) — two blue systems, migration DEFERRED.**
> The build runs **two parallel blue systems** and this is a settled decision, not a bug
> to fix piecemeal:
> - `--brand #5b9bff` (in the build: `--mc-brand #5b9bff` + `--player-a #6aaeff`) is the
>   **design-canonical brand. It is canonical for anything NEW** — all new work uses it.
> - The legacy product accent `#3e7bfa` (`--accent` / `--mx-brand-blue`, ~124 uses = 55
>   `#3e7bfa` hex + 69 `rgba(62,123,250,…)` across charts, bars, active tabs, CTAs, focus
>   rings) is a **known, DEFERRED migration**. It stays untouched until the founder says
>   otherwise. **Do not** migrate it, **do not** repoint the token definitions, **do not**
>   convert it page-by-page while doing other work. Nobody "fixes" these piecemeal.
> - **Hover-affordance blues** — the build uses **four values**: `#a9c4ff`, `#7ba4ff`,
>   `#6aaeff`, `#82b4ff` (the audit list below has been corrected to these — `#8fbcff`,
>   previously listed for playing-styles/news, is **not in the build at all**; the real
>   anchor hover there is the global `a:hover #6aaeff`). `--brand` should govern all of
>   these eventually; **change nothing now.**
>
> The near-miss list below is a factual census only — it is NOT a work queue. No item in it
> is actioned without an explicit founder go-ahead.

Audit basis: every literal hex in the design sources that is not a documented token.
63 design-authored values qualify; bundler chrome (the build tool's error overlay —
`#ff8a80` / `#2a1215` / `#5c2b2e` etc., injected into every compiled file) is
excluded as not authored.

*Brand-blue near-misses (\u2248 `--brand` #5b9bff / `--player-a` #6aaeff)*
- `#3a5bd0` — logo gradient dark stop (dashboard, Login, Stennisfy Model)
- `#3e7bfa` (`--mx-brand-blue` / `--accent`) — Matches-page active/focus chrome:
  day-pill, surface-toggle and filter-chip active states, search focus rings, the
  tournament-profile header border; same family as the Playing style tab's
  `rgba(62,123,250,0.1)` "leans" pill. **NOT** Account Settings — the shipped
  `account.html` has zero instances (earlier attribution corrected).
- `#dbe6ff` — Tournament Reports light-blue text
- `#2a3f66` / `#1a2338` — dashboard speed-slider gradient stops
- `#6f7ba0` — Account Settings
- The old blue pair `#5b9bff`/`#6aaeff` used AS IDENTITY: Form tab player cards
  (`AN.aOddsColor` fallbacks) and the Match Stats Stats-view legend dots
- `rgba(123,145,180,…)` chrome on the Odds tab's summary card B

*Semantic near-misses*
- `#e24b4a` — Player Profile ×8 (\u2248 `--neg` #e0616f)
- `#1d9e75` — Player Profile ×3 (\u2248 `--pos` #3dd68c)
- `#e0b64d` — Player Profile, Stennisfy Model (`WT.HIGHEST`) (\u2248 `--warn` #e8a84e)
- `#e8934b` — Tournament Reports ×2 (\u2248 `--warn`)
- `#f5c451` — Login (\u2248 `--warn`)
- `#6faf8f` / `#8fe4bd` — dashboard, Account Settings (\u2248 `--pos`)
- `#c77` — dashboard shorthand (\u2248 `--neg`)

*Link-hover divergence — four hover blues for ONE affordance; one should govern*
- `a:hover #7ba4ff` — tournaments, account-settings
- `a:hover #82b4ff` — matches-upcoming (dashboard), stennisfy-model
- `a:hover #6aaeff` — playing-styles, news (the global `a:hover`)
- `a:hover #a9c4ff` — Login funnel, verify
  (`#8fbcff` was previously listed here in error — it is not in the build at all.)

*`#fff` / `#ffffff` where `--text` #e7e9ee is the token*
- Modal shell: tab-rail active text, two large odds figures, H2H strong names,
  slider knob; scattered instances across pages (36 occurrences in the census)

*Light-text / grey near-misses (\u2248 `--text`/`--muted`/`--muted-2`)*
- `#cfd6e6` ×10, `#c3ccdb`, `#9aa6ba`, `#8b97ab`, `#77839b`, `#6b7484`, `#47536a`,
  `#3a4557`, `#2f3947` — Tournament Reports grey ramp
- `#e7ebf1`, `#cfd4de`, `#8b93a3`, `#7a8496`, `#aeb4c0`, `#5b6472`, `#4a515f`,
  `#6b7280` — Account Settings greys
- `#dfe3ea` — Login, Form/Style Match Row opponent text
- `#dbe0e8`, `#7a8494`, `#7b8494` (Progression field line), `#4b5361`, `#4a5261`,
  `#4d5666`, `#3a4250`, `#d4dae4`, `#3a4150` — dashboard/profile/model/styles greys

*Surface near-misses (\u2248 `--bg` #06070a / `--card` #0a0d14 / #0a0d13)*
- `#0b0f18`, `#11161f` (table header band), `#090d15`, `#080b11`, `#080b12`,
  `#0d111a` — dashboard/profile/child DCs
- `#0e1015`, `#0b1017`, `#0d1420`, `#0a0e16`, `#12161d`, `#1b2234` — Tournament
  Reports
- `#0b0d12`, `#0b0c10`, `#08090c`, `#141824`, `#1a1f2b` — Account Settings

*Resolved since first recorded (kept for the audit trail — no longer in the build)*
- `#c2c9d4` (Progression FIELD value — fixed to `--text`), `#c8cfda` (old Form Match
  Row copy — superseded by the shared component), `#c98bde` (dashboard avatar-tint
  rotation — replaced with `--player-a`)

*Resting-state blue borders (blue should be state, not rest)*
- H2H headline cards, dashboard match cards, Account Settings section cards
  (`rgba(91,155,255,0.22)`)

**Shared-component fold-in items**
- The per-set "POINT BY POINT · SET N" label band (Tournament/Overview feeders need to
  emit labels — one line each).
- The tiebreak sub-table (requires a caller-emitted tiebreak point log; contract:
  per-set `tiebreak` flag + `tb.pts[]` with a/b, serverA/B, aLost/bLost, spA/spB).
- Folding `matchStatsFor` itself into the component (superset branches for sublabels,
  suppressed bars, SP, tiebreak) — assessed feasible; six implementations would become
  one.

## Note for handoff

These files are the rendered design, not the production source: styles are authored
inline per element (which is what makes every value directly readable next to the
element it affects) and behaviour is driven by a small runtime bundled into each file.
Read them for colour, border, type and spacing values; rebuild structure in your own
component framework.

Stale branding: no rendered "BSP" occurrence remains in the dashboard build (the last
— the Form tab's "BSP form score" label — was renamed "Last 10 win rate"). BSP
survives only in the source folder name, archived backups, the mobile prototype, the
Login-options exploration, the Funnel wordmark, handoff docs and
`BSP Consult - Redesign.dc.html` — all deliberately kept as archives/product marks.
