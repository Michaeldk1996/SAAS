# Head to Head page — the design build (founder 2026-11-16, design_handoff_head_to_head)

Applies to `window.H2HPage` in `bsp-consult-dashboard.html` (the block after "H2H REBUILD (design_handoff_head_to_head)")
and `h2h-page.css`. **Design source (round 7, founder 2026-11-26):** `design_handoff_stennisfy_final/` (repo root, never
published; the whole site's final lock, it replaces `design_handoff_head_to_head_2026-11-20/`): `HEAD_TO_HEAD.md`,
`decisions/head-to-head.md` and `site/Head to Head.dc.html` — the design file wins over the docs for every pixel; `reference_options/` are option studies (not built), `history/` the
older change notes. Night only. **This file
replaces the TEN-402 look** (white bars, caps section heads, the darker-track rows, the 35b header card): founder brief
2026-11-16, "the live Head to Head page matches the design … pixel for pixel". A display rebuild: every figure keeps its
live calculation (Data below).

## Page
## Round 7 — the final design (founder 2026-11-26) — each line is a test
- **No page-level filters.** The sticky bar holds the pickers and the section nav only; each box is filtered by its own
  chips and a pick in one box never changes another. **Test:** the sticky card has no Surface / Format switch;
  `test-h2h-r7.mjs` "no page filters".
- **Section nav marks where you are:** the section in view is a picked choice (`--h2h-raised` + inset 14% edge, white 700,
  `data-navon="1"`), the others grey 600, white on hover; it follows the scroll (the last section whose top passed the bar
  + 60px) on the DOM, never a re-render per scroll event, and switches at once on a click; the click scrolls to the
  section offset by the bar's height + 26px.
- **Box head = title + its "?" directly after it + the box's chips at the right** (`xBoxHead` + `xChips`); no grey subtitle
  under a box title (Latest news keeps "Both players · newest first"). **Dropdown chip** (`[data-frchip]`): 28px, padding
  0/10, r8, 1px 10% edge, no fill, 12/600 white, the value only + a 5px caret; hover edge 24%; open = `--h2h-raised` +
  14% edge; the menu (`[data-frmenu]`) under it, right-aligned, 6px below, `--h2h-raised`, 14% edge, r10, pad 6, min 170,
  `--h2h-shadow-chip`, 120ms fade with a 4px rise; caps head 10.5/700 0.06em grey; options 12.5, picked white 700 on a 6%
  wash. One menu open at a time; a pick, an outside click and Escape close it. A **fixed chip** (Tournament record with a
  tournament picked) is grey on a 6% edge, no caret, not clickable, titled "… · set by the tournament".
  **Test:** `test-h2h-r7.mjs` "chips" (+ mutants: two menus open, a fixed chip clickable).
- **Model and playing style = ONE card** (`#h2h-model`, the playing style block `#h2h-dna` inside it under a 6% hairline,
  padding-top 18, no head of its own). Chips Surface (**All surfaces** default · Hard · Clay · Grass) · Format (Best of 3
  default · 5) · Window (Last 52 weeks default · Career). "All surfaces" = no surface adjustment: the pair estimate's
  `A3` / `A5` cell (`build-pair-prices.js` runs the engine with surface `All`: its surface Elo key is null, so the base is
  overall Elo) and the DNA file's `All` node.
- **The likely opening price is a RANGE, low – high, from the Elo-only price to the full model price** (founder fix 1,
  2026-11-26, his pick "Elo only → full model" of three sourced options; the design's "3.40 – 3.90" is mock-up). Both ends
  carry the same margin; equal ends print one price; no Elo-only price → the model price alone. The "?" names both ends.
  **Test:** Zverev v Sinner, hard, Bo3: Zverev 4.11 – 6.45, Sinner 1.14 – 1.26 from cells 1500 / 2353.
- **A price end that prints below 1.01 is a dash** (founder 2026-11-27, "Show a dash"; the site's price floor): the range
  reads "— – 1.02" (Sinner v Marozsan, best of 5), both ends under 1.01 = "—"; 1.01 itself prints. **Test:** `test-h2h-r7.mjs`
  "below 1.01" (+ mutant "no price floor on the range").
- **No blue flash on a filter pick** (founder fix 2, 2026-11-26): the prices are white at all times. The design file still
  draws the 520 ms blue (`priceCol`); the founder's word wins over it. **Test:** no `--h2h-blue` on a price after a pick.
- **Best of 5 is converted by sets** (founder 2026-11-26): every 5-set cell (A5 / H5 / C5 / G5), both ends of the
  range, is the engine's best-of-3 figure converted (p3 = s²(3 − 2s) → p5 = s³(10 − 15s + 6s²), `stennisfy-model.md`);
  Zverev v Sinner, hard, best of 5 moves from 17.8% to 12.4% for Zverev. **Test:** `tools/test-pair-prices.js` "best
  of 5" (the 5-set cells equal the converted figures; the base is further from 50% than in best of 3).
- **Playing style under the 10-match floor in the last 52 weeks reads the same file's since-March-2024 window** (founder
  fix 4, 2026-11-26: Sinner had 7 grass matches in 52 weeks, every row "—"): the DNA file's `sinceBase` node (same box
  scores and formulas); the "?" says so with both counts; Under pressure stays "—" there (no since-2024 figure). Still
  under the floor → dashes with the reason. **Test:** a 7-match last-52 node with a 24-match sinceBase node prints figures.
- **Head to head record chips:** Surface (All · Hard · Clay · Grass · **Indoor**, each with its meeting count; none = grey
  `--h2h-dead`, not clickable) · Window (Career default) · Format · Court speed. **Indoor is carved out of the surface**
  (founder fix 5): a meeting is indoor by career-history's `indoor` flag (api-tennis court type), else its
  `TOURNAMENT_CATALOG` entry's `indoor`, else unknown (counted under its surface; Cologne 2 2020 has no catalog entry).
  Paris Masters and Vienna read Indoor, never Hard. A surface with no meeting: "No meetings on grass · n meetings on
  other surfaces". **Test:** Zverev v Sinner: Indoor holds Paris 2025, Vienna 2025, ATP Finals 2025; Hard no longer does.
- **Hot lines:** one track Last 5 · All (All default); every count has its label under it (`[data-hotbasis]`: "Bo3 only",
  "Bo5 only", "all n meetings", "last 5 meetings"); two Bo5 lines Over 3.5 sets / Over 4.5 sets (the latter shown once a
  meeting covered it); Covered column 112px; a line's meeting rows show the event over "Clay · speed −0.24".
- **Record box tiles = four, in this order:** Total points won · Went to a deciding set · Sets and tiebreaks · Favourite
  won ("On <surface>" is gone). Sets and tiebreaks = finished sets only, from player A's side ("Sets 4–11", "Tiebreaks
  2–3 · Zverev first"). **The two head avatars are the players' photos** (founder fix 6, `xAv` 52px with the side ring); the
  price-column minis keep their initials. "Meetings" has its "?" directly after it; the event cell is two lines.
- **Record against each style:** chips Surface · Window (**Last 52 weeks default**, the design's; was Career) · Format
  (a Grand Slam main draw = Bo5, `xBoOf`) · Court speed; the Filters panel is gone; "against <style>" wraps; each
  tournament group header ends in the speed chip.
- **Speed chip** (`xSpeedChip`, the design's site rule): "Speed +0.13" = the event's Tennis Abstract surface speed that
  season (`COURT_CONDITIONS` `as<year>`) − 1, two decimals, true minus, `--h2h-raised` + 14% edge, r6, pad 2/8, mono 10.5;
  no reading that season → no chip. Directly after the header text, never at the right end. Speed CLASS (the Court speed
  filters) stays the site's one scheme (`courtSpeedCategory` 43 / 68, N4).
- **Tournament record:** no Window (every year on record); head = title · search (28px) · "Clear tournament" · Surface /
  Court speed chips fixed by the picked event. "Clear tournament" = group mode across every event either player has on
  record that fits the chips; "Back to <tournament> ›" returns. Year headers carry the speed chip.
- **Market edge:** chips Surface · Window · Format · Court speed filter the real priced matches (the band rows, tiles and
  the chart); the window tabs are gone from the head and the chart; "?" directly after each title.
- **Latest news:** the category track (every choice visible) at the right of the title line; an empty category reads
  "Nothing under <category> for either player."

- **Colours = the export's own values**, page-scoped tokens `--h2h-*` in `tokens.css` (`--h2h-card` #0E1019,
  `--h2h-layer` #121521, `--h2h-inner` #0C0E16, `--h2h-raised` #121521 (lifted, with a 14% edge), `--h2h-hover` #171B28
  (every hover fill, never a white or blue wash), `--h2h-track` #0A0C13 (every switch track, 10% edge) — 20 Nov §8, `--h2h-text` #E7E9EE, `--h2h-soft` #C6CCDB, `--h2h-grey` #8B96B5,
  `--h2h-blue` #5B9BFF, `--h2h-up` / `--h2h-down`; white alphas = `color-mix` of `--h2h-white`). Nothing else reads them.
  **Test:** `tools/lint-raw-colours.mjs` (0 raw colours) and the H2H suites (each role's token).
- **One colour for every box (design change 2026-11-18 §3):** every box inside a section or pop-up AND every caps column
  strip inside it is card tone (`--h2h-card`) with its edge (9%; 6% where the reference keeps it); structure comes from
  hairlines (6%) only. `--h2h-layer` only where the reference keeps it: the opened news item, the edge chip on a line, the
  sheet's price chips, the style record figure box, the Suggested matchups chips. `--h2h-inner` is a WELL only (switch
  tracks, inputs). **Test:** is any caps strip or tile `--h2h-layer`, or any box `--h2h-inner`? Then it is wrong. The match
  sheet is the Match analysis sheet (founder 2026-11-24), not this page's tones.
- **Page ground = the website's background, always** (founder ruling 4, 2026-11-18, replacing "only with no pair"; the
  design's 18 Nov §1 ground): the tab and the page are transparent, so the shell's `--page-bg` (page tone + glow) shows
  whether or not players are picked; the sticky band behind the picker fades from `--page` to transparent **and paints the
  same page glow, placed where `<html>` draws it** (founder 2026-11-19: the band cut the glow into a black step under the
  title; `X_STICK_BG` + `xGlowSync`, which moves the glow's centre into the band's box on scroll / resize). Cards keep
  their tones. `--h2h-page` is no fill on this page (only the dark text of the blue Filters badge / Done button).
  **Test:** with a pair AND with none, `.tabpage[data-page="h2h"]` and `.x-wrap` compute transparent and the sticky band
  reads `--page` under the page glow (`--glow`, the `--page-bg` geometry).
- **Page title = the header card** (design change 2026-11-18 §2, as on Database / Tournaments / Stennisfy Model): card
  tone, 1px 6% edge, r12, 18/26; "Head to Head" 24/800, the sub 13 grey, the "?" (coverage) at the right; it scrolls,
  only the picker is sticky.
- **Switches, one size everywhere** (design change 2026-11-18 §8; 20 Nov §8): track `--h2h-track` + 10% edge, r10, pad 3,
  gap 3; tabs 6/14, r7, 13px, on = raised + 14% (`xSw` 'lg' / 'fill' as an inset ring; 'lgb' as a 1px border — Playing style window, Latest news
  kind); the match sheet is the Match analysis sheet and keeps its own switches (founder 2026-11-24). **Test:** no switch on the
  page has a 2px pad or 11–12px tabs.
- **Section cards:** padding 24, inner gap 16, 1px 6% edge, r16 — all seven (20 Nov §8). Every card edge and divider is 1px
  at 6% white. **No uppercase label anywhere** (20 Nov §8): every small label (column heads, group heads, tile labels, "vs",
  "Change", country chips) is Hanken 11.5 / 600 `--h2h-grey`, normal case, no letter-spacing (`X_CAP`, `.x-cap`). Small grey
  notes are 11.5px. **Test:** no `text-transform:uppercase` in the page block.
- **Returns read in %, never u** (2026-11-17 §4): "Return at a flat 1% stake" (1% of bankroll a match), its band rows,
  totals, chart axis and line ends, and the Tournament Backing ("flat 1% stake · N bets").
- **Player one is blue, player two white, wherever two players' stats meet** (README): avatar rings, the radar polygons, the
  face-to-face lean, the bullets, the return chart, the sheet's figures and split bars. Green / red only on signed figures
  and results. *Exception (founder 2026-11-16, CLAUDE.md non-negotiables):* the Playing style face-to-face rows print the
  better figure white 800 and the other grey 500, as the export draws it (`H2H_FTF_LEAD_EMPHASIS`).
- **Order** (HEAD_TO_HEAD.md "Page layout"): title card (the "?" directly after "Head to Head") · sticky picker (pickers,
  VS + swap, section nav — no filters) · empty state with Suggested matchups / loading skeleton · thin-data caveat ·
  Model and playing style · Head to head record (Overall box, Hot lines) · Record against each style · Tournament
  record · Market edge · Latest news. The head to head box (z 80) and the match sheet open over it.
- **Avatars (design change 2026-11-18 §4; founder rulings 6 and 10, 2026-11-18; founder 2026-11-19):** initials (Plex
  Mono 700) in a circle; the photo (the one resolver, `playerPhotoImg`) covers them (`xAv`). **The blue / white ring only
  where the two players' stats are compared** (founder 2026-11-19): Playing style (40 / 12), the overall box (46 / 12), the
  style record cards (38 / 11.5) and the head to head pop-up head. **No ring** (`xAv(…, { noRing: true })`): the picker
  (44 / 13), the Career matches card heads (38 / 13, with the photo — replaces ruling 10 there), the Market edge cards and
  its pop-up, and Latest news (34 / 10.5). **The picker's photo is loaded eagerly** and a render made before the photo index landed repaints
  once it lands (ruling 6: the header pickers never stay on initials when a photo exists). **Every avatar beside the picker
  shows the stored photo too** (founder ruling 6 follow-up, 2026-11-18, overriding the design's initials-only circles): the
  Stennisfy Model boxes (34) and the player search rows (28) layer the photo over their initials (`xPhotoOver`, eager);
  initials only for a player with no stored photo. Suggested matchups draw no avatar (the design's text chips). Initials only (`xIni`, card
  fill, ringed): the head to head pop-up head (52 / 16) and the Tournament card heads (38 / 13). **The column-head avatars over a price** (Meetings 26 / 10, career and tournament lists 24 / 9.5) are
  initials, 1px 16% edge, no ring, never a photo (`xMini`; ruling 10). **Test:** the picker's `<img>` carries
  `loading="eager"`; no `<img>` in the Meetings head, the tournament list heads or any `xIni`; no `box-shadow:0 0 0 2px` on
  a picker, Career matches head, Market edge or news avatar (`test-ten402-a.mjs`, `test-ten402-c.mjs`, `test-h2h-1117.mjs`).
- **One component each:** the "?" `xHelp` (16px circle, 22% edge, Plex Mono 10/700 — 20 Nov §8; its explanation is the hover title — **no footnotes**; every
  definition lives in a "?" or a label's title), the pill switch `xSw`, the section head `xHead`. Hovers are classes in
  `h2h-page.css` (the reference's style-hover): every hover fill is `--h2h-hover` (rows, bands, lines, the Overall box,
  lifted buttons); a ✕ / swap ring brightens to 22%. Lifted buttons (Filters, Reset filters, Done) = raised + 14% edge,
  white 600 (Reset / Done 34px high) — no blue button fill or edge (20 Nov §6).
- **Narrow (< 900px; the reference breaks there):** the pickers stack around the VS row, a picked name wraps instead of
  being cut, the radar takes its own row, the hot-lines table scrolls sideways inside its card.
- **Hand-over:** `?a=&b=` (player keys, or a name that resolves to exactly one player), else sessionStorage
  `stn_h2h_pair` ([a, b], read once and removed), read when the page script runs; it opens Head to Head on the pair. While
  the page shows a pair the URL carries `?a=<key>&b=<key>`; leaving the page drops them. **Test:** the H2H suites.
- **Jump links** scroll the window to the section with its top under the sticky picker (never `scrollIntoView`).

## Sections (what the design build shows, on which live data)
- **Model and playing style (the model part):** the pair estimate (Data → Model) in two inner cards, each the likely
  opening price RANGE only (Round 7 above); the "?" names the range's two ends. **The explanation lives in the card head's "?"**
  (founder ruling 7, 2026-11-18): "Win chance A x% · B y% · <surface>, best of N" / "Elo base x% for A, moved by k of 10
  model layers · plus Pinnacle's typical opening margin, m% (n=…) · model run HH:MM". **Test:** the card body holds no
  "Win chance" or "Elo base" text; the "?" title holds both lines.
- **Playing style (20 Nov §1–4, design 1a radar + 3d layout):** a round radar — outer ring r105 (1.5% fill, 10% stroke),
  three dotted inner rings (r 78.75 / 52.5 / 26.25, 6%, dash 2 4), 6% spokes, viewBox `55 0 310 270`; B's shape (text 7%
  fill, stroke 1.5) under A's (blue 16%, stroke 2), a dot r3.5 on every value (B hollow, A solid, drawn last); Return and
  Surface Elo labels in the top corners of the box, Serve above, Under pressure / Dominance ratio beside the lower spokes;
  the row `align-items:center`, gap 18/32, radar column `flex:1 1 340px` max 500, list `flex:1.05 1 330px`; nothing under
  the radar. Ten rows in a fixed order: **Ratings** Elo, Dominance ratio, Serve rating, Return rating, Under pressure ·
  **Serve** 1st serve in, 1st serve points won, 2nd serve points won, Service games held · **Return** Return games won. No
  break point row.
  **Windows Last 52 weeks · Career** (founder ruling 8, 2026-11-18, re-ruled the same day: "skip Last 24 months" — no
  file holds that window, so the option is gone; "Since Mar 2024" is gone too). What each reads:
  - Last 52 weeks = the DNA file's `last52` (ratings, percentiles, `serve.firstInPct` / `firstWonPct` / `secondWonPct` /
    `holdPct`, `return.returnGamesWonPct`); Elo = the current weekly Elo on the surface.
  - Career = `surface-ratings.json` `career` (2010–now, the Database → Ratings figures): Serve, Return, Under pressure
    ratings, the shape their pool-percentile `index`; **Dominance ratio** = the node's `dominance` (founder 2026-11-19:
    return points won % ÷ (100 − service points won %), tour-level counts, built by `surface-ratings.js` with its pool
    `index`); **Elo = the peak** (`elo-ratings.json` `peak`, all surfaces, labelled "Elo peak"), its shape point = its
    percentile among every peak in that file; the rows read the same node (return games won = `breakPct`). **Test:** on
    Career both axes carry a shape point whenever the value exists (`test-h2h-1117.mjs` "career radar").
  Under the 10-match floor (that window's own sample): no shape, "—" on every row except the Elo peak, the reason in the
  "?". The lean and its chip read the printed figures. **Test:** the switch reads exactly Last 52 weeks · Career; Career
  prints the surface-ratings career rating and the Elo peak.
- **Head to head record:** surface tabs with counts (a surface with no meeting is inert, `--h2h-dead`); the Overall box
  (score all white, one bullet per meeting oldest → newest, blue = A won, white = B; "X won the last n meetings";
  "All n meetings ›" opens the box). Never met (founder 2026-11-19, plain words): "<A> and <B> have never played each
  other. We checked both players' matches back to <year>." — no dash, no "compares them indirectly".
- **Hot lines (founder ruling 3, 2026-11-18, "show the lines from 2 meetings on"; replaces the design's 3):** ranked once
  the scope has `H2H_HOT_MIN_MEETINGS` = 2 meetings (0–1 → "Not enough meetings to rank lines (n=…)"); a line shows with `H2H_HOT_MIN_LINE` = 1 eligible meeting; no rate
  floor (`H2H_HOT_MIN_RATE` null); best line per family, "Show all lines (N)". The Rate keeps the page's thin rule (under
  5 eligible no %, 5–9 grey). The lines are `fhH2hLineDefs` (12; the design's 13th, "B +3.5 games", is not added).
  A line opens its panel: Covered, Last five, the average behind the line, every eligible meeting newest first with its
  figure on the line and Covered / Missed. Match analysis keeps its own model (rule a0) and table.
- **Hot-line panel, Covered tile** (founder 2026-11-17): under the rate floor (n < 5) the figure is the count ("1 of 3"),
  never a dash, and the sub names the covered meetings ("At Barcelona Open 2026, …" / "Not covered yet"); from 5 the rate.
  "Most covered" is a white pill (11/700 on white 7%, r999), the dots stay blue (design change 2026-11-17 §6).
- **Head to head box:** four tiles, each value with **ONE short sentence under it, on one line, never more** (founder
  ruling 9, 2026-11-18; founder 2026-11-20 "on one line": the subs never wrap, the tiles grow to fit, `x-boxtiles`) —
  Total points won (the meetings' own box scores, `setstats/`, summed; the sub is the OTHER player's share only, "Zverev
  48.7%" — founder 2026-11-20; the leader and the meetings counted are the tile's hover; none → "—"), Went to a
  deciding set (one: "<Winner> won it 2–1 at <event> <year>"; more: "A won x, B won y"), Sets and tiebreaks (Round 7), Favourite won (the shorter
  closing price; "<last underdog winner> won as underdog at <event> <year>", or "The favourite won every one"; the
  count of underdog wins, level-priced and unpriced meetings move to the tile's hover). **Test:** no tile sub holds a
  " · " join of two facts. Then the meetings by year, prices under each player's mini avatar, "X leads a–b".
- **Record against each style:** each player's record against the other's archetype, filtered for real by Window (Last 52
  weeks · Last 24 months · Career — **Last 52 weeks by default**, the final design 2026-11-26, replacing the founder's
  Career default of 2026-11-16), Surface, Format and Court speed (the profile's one
  speed rule, `speedRowOf` → `speedBandForRow`; a venue with no rating leaves a picked speed and the card says how many).
  Win rate from `H2H_STYLE_FLOOR` = 5 matches (= the profile's Match-up record floor), **white at every n it prints, as the
  design draws it** (founder 2026-11-19; the 5–9 "Small sample · n=" is its hover). Three separate tiles (inner tone, 6%
  edge, r11, gap 8; 20 Nov §6): Record and Win rate white, **Vs other styles** green / red. **Vs other styles = his win rate
  against THIS style minus HIS OWN win rate against every other playing style** (20 Nov §6, replacing the matchup-matrix
  "Vs style average"): the other styles' rows are the rest of his style-meetings shard, under the same Window / Surface /
  Court speed filters, walkovers out, each side from `H2H_STYLE_FLOOR` matches; the bar's centre tick is that rate and the
  caption reads "He wins x% against all other styles". It keeps its sign colour at 5–9 (founder 2026-11-17). Career match cards: 6 rows,
  "Show n more", opponents by surname, every row opens the sheet. A grey "0 pts" = the two rates print level at whole points.
- **Tournament record (design change 2026-11-17 §3):** Under each player's record, "x% of n won" is 12.5 / 700 `--h2h-text` (20 Nov §7). Every year on record (no Window since Round 7). "Clear tournament" = **group mode**: the record over every event
  either player has on record whose surface (catalog) and speed class fit; the class is the event's ONE rating
  (`COURT_CONDITIONS` speed → `courtSpeedCategory`, Slow ≤ 43 · Medium ≤ 68 · Fast) — the figure the tournament row prints,
  so the two never disagree; an event with no rating is in no speed class (the row's hover counts them). Picking a
  tournament returns to it; "Back to <tournament> ›" returns. Single event: opens on an event of this week whose posted
  main draw lists both players (`EntryListsTab.currentWeekRows`, by key), else the most recent event both have played,
  else the first listed. Tiles Best result, Sets won, Last played, Backing (flat 1% stake on the one join, Data below)
  over the window (`xTrAgg`); groups per year, or per tournament and year in group mode. **In group mode the Best result
  names its event** ("Won" over "Stuttgart 2026", "F" over "Washington Open 2026"; founder 2026-11-19), and the band names
  the condition with its count once, the events as chips that open that tournament, Surface and Court speed beside it. The search caps at 320px and
  each filter group keeps its own width (2026-11-18 §5). **A long list shows its newest `H2H_TOUR_SHOWN` = 6 rows, then
  "Show N more matches" / "Show fewer"** (founder ruling 5, 2026-11-18; the career-matches pattern); a filter or pick
  folds it again. **Test:** a 40-row group renders 6 rows and "Show 34 more matches".
- **Market edge** (design change 2026-11-18 §6): windows Last 52 weeks · Last 24 months · Career; bands =
  `MarketEdgeCore.BANDS`, named as the profile names them. One card per player: head (initials, "n priced matches",
  total return 26px), **four tiles** As favourite · As underdog · Best band · Worst band, then As favourite / As underdog
  rows: the odds as three elements (low · grey dash · high; "6.00 +" open), the band name under, the **edge line** (a 4px
  track, a green segment right / red left from the centre, 14–46% wide by |edge|/30, a chip on the centre with the
  signed edge, one decimal, no unit), Record, Return (%), a blue ›. **Edge = his win rate in the band − 100 / the band's
  average closing price** (MarketEdgeCore `needs`), in points; a group tile = the same over the group's priced matches.
  The page's thin gate holds (under 5 no edge); **a signed edge or return is green / red at every n it prints, never grey**
  (founder 2026-11-19: "Worst band −11.5" read grey at 5–9; the small sample is the hover). Best / Worst band = the bands
  that print an edge. **A band row or a tile opens his matches there** (founder 2026-11-19, `meBoxHTML`): head (photo, no
  ring, "<player> · <band>"), four tiles — Record, Win rate (break even under it), Edge, Return at a flat 1% stake — then
  every priced match newest first (date, result, opponent, event, round, score, both closing prices, return); a row opens
  the match statistics. A band click also filters the chart (the design), "Clear" in the chart clears it. **The band "?" and the chart "?" are the founder's own help text** (ruling 13, re-ruled 2026-11-18): "Win rate =
  his win rate at closing odds in the band (Pinnacle, else Bet365); break even = … Edge = the gap between them …" and
  "Cumulative units, flat 1u … each line spans that player's own matches …"; only the words naming the removed bar / tick
  changed, and the units say they read in % (1u = 1% of bankroll). **Test:** no band row prints "1.01–1.20" as one string;
  no Won / Needs column; neither "?" names a bar or a tick.
- **Return chart = the design's style, a named page exception** (founder ruling 2, 2026-11-18, "follow the design"):
  the smoothed line, the faint loss shading under break even and the vertical month / year lines stay
  (`H2H_CHART_SMOOTH`), against `foundation.md` Charts (no area fill / no vertical gridlines) — this chart only. x = each
  player's own priced matches; its "?" carries the chart note, `RET_SETTLE_NOTE` and the window. **Test:** the chart draws
  the loss rect and the tick lines with the flag on, neither with it off.
- **A Stennisfy match report shows its stats box when opened** (founder 2026-11-20): the news ticker item's `ms` rows drawn
  by the News page's own `newsMsBoxHtml` (one stats box on both pages; `.x-newsms` gives it the News tab's edge variables).
  **Test:** an opened report with `ms` holds the box rows; without `ms`, no box.
- **Latest news:** pills All · Match reports · Quotes · Injuries · Articles from the site's own fields — an ASAP item is a
  Quote; a feed article takes the News page's `newsClassify` (Match Reports → Match reports, Withdrawals & Injuries →
  Injuries, the rest → Articles); sources print the outlet names (`newsSourceNames`). **Our own match reports and the
  players' quotes come from the news ticker** (item 12, founder 2026-11-18: `newsTickerItems()`, news-ticker.json and its
  tournament files — a report counts for both players by key, quotes one card per player per match; its kind = the
  item's own category). **A medical time-out is an Injury item** (founder 2026-11-19: Jodar v Fils): `mto-matches.json`
  (the MTO bot's file, the one the profile's MTO badge reads), joined on the player's surname + first initial, "<X> took a
  medical time-out against <Y>" with the score from his side, how long it took and the final score. No item → the design's sentence. An open item (2026-11-18 §7): layer tone + 12% ring, headline
  700, the body under a hairline aligned with the headline (60px), then the kind pill, "source · time" and "Close".
- **Match sheet = the Match analysis sheet** (founder 2026-11-24, replacing the page's own sheet tone of 2026-11-16/18): a row
  opens the ONE locked Match Stats sheet, exactly as inside Match analysis (`fhOpenSheet`: `ma2` frame and tone wherever it
  mounts; only the profile's hand-off keeps its own design). **Test:** `test-ten402-b.mjs` "the H2H page sheet is the Match
  analysis sheet" + rule 4's frame.
- **One short name per player (founder, TEN-408 card 78054b1c):** `shortOf` keeps a given name that is already
  abbreviated ("C. Alcaraz", "Dar. Blanch", "J-L. Struff"), so the picker, the Tournament card, the DNA line and every
  sentence print the same name; re-cutting "Dar." to "D." printed Darwin under his brother Dali's spelling.
  **Test:** `test-ten408-styles.mjs` "founder R2".

## Data
- **Meetings** = `H2HCore.joinMeetings` (`h2h-core.js`) over both players' career-history shards — the ONE site-wide H2H
  list, the Match analysis tab's and Key factors' too, ATP's official H2H population (founder TEN-437, 2026-10-14; replaces
  TEN-402 Data 1's "including exhibitions"): Laver Cup counted, exhibitions and Hopman Cup not; walkovers out; a
  retirement counts (Cincinnati 2025 F, founder 2026-10-08, card 01102d24). Sinner–Alcaraz = 17, Alcaraz 10–7;
  Medvedev–Tsitsipas = 15, Medvedev 10–5 (ATP, 14 Oct 2026). Rules and constants: `modal-form-h2h.md` "One H2H record".
  A history that did not load shows "Head-to-head could not load" + Retry, never "No meetings on record", and is not
  cached (`h2hRetryPair`; a visit drops failed pairs). **Test:** `test-ten402-b.mjs`, `test-ten437-h2h.mjs`.
- **Prices — ONE join across the site (founder ruling 2026-10-08, card 01102d24).** Ledger Home / Away = the Database
  join, Pinnacle closing else Bet365 closing, per match: `DatabaseTab.priceRows()` = `database-yield.json` rows PLUS the
  retirements the store keeps behind its flag (`retRows` / `retNames`, `dbPriceJoinRows`; same book rule, ties,
  overround > 1.15 and pre-2010 out). **A retirement is priced, never `—`, and settled on Pinnacle rules** (founder 2026-10-22: first set
  completed → a win at the winner's close, a loss at the retiree's; not completed → `void`; no set scores → no units): Sinner–Alcaraz Cincinnati 2025 F = Alcaraz 2.71 / Sinner 1.53, all
  17 meetings priced. **An exact price tie is priced** at the tie for both players (founder ruling 2026-10-16: "keep tied
  prices, exclude them only from favourite/underdog figures" — the store's `tieRows` / `tieNames`, behind a flag like the
  retirements; no Database figure reads them). Favourite = shorter price; yield = flat
  1u. No price → `—`. ONE join on the page (`h2hPriceJoin`, exported as `H2HPage.priceJoin` and shared with the player
  profile): the Head-to-head ledger, the Playing styles ledger and the Tournament ledger (each row's own opponent) —
  never the style-meetings shard's `oddsSelf` / `oddsOpp` nor the closes shard. **Test:** `test-ten402-b.mjs` "Data 2
  on the real stores" + "the store keeps retirements BEHIND A FLAG" (each with the Database-rows-only control),
  `test-ten402-c.mjs` fix 2 (Cincinnati in the Playing styles ledger). **A ledger row never takes a neighbouring match's
  price** (review 2, 8 Oct):
  1. every Database row of player P goes to ONE of P's career-history matches (the loaded `career-history/{key}.json`,
     `h2hCareerOf`) — same opponent + winner, rounds that do not contradict, globally **nearest first** (`h2hNearest`;
     a tie at the same distance = a dash). A Database row nearer another career match never prices this one (Sinner,
     Monte Carlo 2023 R32 v Schwartzman, retired → `—`, not Barcelona's 1.09 / 9.13).
  2. distance: a career row with an eventKey (feed, 2021 on) is match day to match day, ±1 (`H2H_PAGE_MATCH_WINDOW`); one
     without is dated at the event START, so start to start (the archive event's first date, `h2hTdEvent`) within
     `H2H_PAGE_START_WINDOW` and the match date within `H2H_PAGE_PRICE_WINDOW` (−3…+16) — the match date alone swapped
     Djokovic's Madrid / Rome 2011 finals.
  3. rounds compare whenever both sides have one, R128…R16 too: the archive's "Nth Round" counts back from that event's
     last numbered round (`h2hTdRound`: a 128 / 96 draw 1st = R128, a 56 / 48 draw 1st = R64, a 32 / 28 draw 1st = R32).
     Qualifying (`Q`) never takes a price. The ATP Cup 2021 row (R128) never takes the AO 2021 QF's.
  4. each ledger row finds its career match (same opponent + winner, rounds agree, career date up to 24 days after the
     row's: `H2H_PAGE_ROW_WINDOW` — a style-meetings row is dated at the edition start; Djokovic v Vacherot, Shanghai
     2025 SF: shard 24.09, archive 11.10 → 1.14 / 6.68) and shows THAT match's row. A row with no career match takes
     only a Database row no career match holds. The result never depends on row order.
  - **A team-event row joins match day to match day** (founder 2026-11-08, "look deeper"): an era row with flag `t` (Davis
    Cup, Laver / United / ATP Cup, Olympics …) carries one event name for every tie of the year ("Davis Cup"), so its run's
    "start" is not its tie's; a keyless archive career row meets it on |match day − career date| within the price window,
    never start to start (`dbPriceJoinRows` `tIx`). Gojo v Rublev, Davis Cup Finals 2021 F = 5.92 / 1.17. **Test:**
    `test-ten402-b.mjs` "a team-event row joins" (control: the pre-fix join dashes it).
    **It prices a team-event career match only** (founder 2026-11-11): a career row whose event is not a team event (Davis /
    Laver / ATP / United / Hopman Cup, Olympics, Next Gen Finals, World Team Cup) never takes it. Goffin,
    Indian Wells 2016 QF v Cilic (archive row dated 7 Mar) had taken the Davis Cup tie's 2.24 / 1.71 (6 Mar); it reads its
    own Pinnacle close 2.32 / 1.70, and the tie its Tennis Explorer price. Measured over 741 players' histories: that one
    match was the only one to move. **Test:** `test-ten402-b.mjs` "a team-event row prices a team-event career match only"
    (control: without the rule Indian Wells shows the Davis Cup price).
  - **Names** (`h2hTdSame`): surname + initial; the surname-tail rule both ways — the archive's shorter name is the first
    or last word(s) of ours ("Mpetshi G." = G. Mpetshi Perricard, "Bautista R.", "Del Potro J.M."), a longer one must
    START with ours ("Ramos-Vinolas A." = A. Ramos; "Lopez San Martin A." is NOT A. Martin). The initial keeps brothers
    apart (A. / M. Zverev, F. / J.M. Cerundolo, S. / P. Tsitsipas). **The archive name table applies first** (founder
    brief 2026-10-15 item 2): `build-odds-performance.js` `ARCHIVE_NAME_ALIASES` (hand-checked, the table Market edge and
    the closes shards already use) rides in `database-yield-players.json` as `aliases` (archive name → our spelling, the
    profile's else `ARCHIVE_ALIAS_NAMES`: "Barrios M." / "Barrios Vera M.T." = T. Barrios Vera, "Miguel L." = G. Miguel).
    `ARCHIVE_NAME_BLOCK` is NOT carried: the Database feed's own rows spell Zhizhen Zhang "Zhang Z.", the archive's Ze
    Zhang spelling, so a name block would drop his 2026 prices (3 matches, measured 15 Oct). **Test:** `test-ten402-b.mjs`
    "archive name table". Residual: "Silva J." (1 row, US Open 2010, Júlio Silva) would
    pass the rule for J. Reis Da Silva but has no career match to join.
  - **Backing tile (Tournament) = flat 1u over the Tournament ledger's priced rows, on the one join, retirements settled
    on Pinnacle rules** (founder 2026-10-22; join from ruling 2026-10-08, card 01102d24 — the same rule as Market edge on this page
    and its footnote). One model draws both: `trProfileModel` prices every row on the Database join (`trDbJoinPx` →
    `H2HPage.priceJoin`) and the panel prints `P.all`'s prices and `P.priced` / `P.units` — so the tile's "N priced" IS the
    ledger's priced-row count, and the tile = Player Profile → Record per tournament for the event (`trProfileBacking`
    reads the same model). There is no second Backing source (`H2H_BACKING_SOURCE` is deleted). The Match analysis
    Tournament tab prices on the same join too (founder 2026-10-09, card 7bc622d5; `trModelFor` passes `trDbJoinPx`), so
    for an event whose match lists agree the three surfaces print one figure (`modal-analysis.md` "Tournament tab → Prices"). Measured 8 Oct 2026:
    Alcaraz, US Open +7.1u / 32 priced (+7.13u; the three retirements in: 2021 QF v Auger-Aliassime −1, 2022 R128 v Baez
    +0.02, 2023 R128 v Koepfer +0.02); Zverev, Roland Garros +5.3u / 30 (the 2023 SF v Ruud, an exact tie at 1.95, was `—` then and is priced 1.95 / 1.95 since the 2026-10-16 tie ruling;
    the 2016–2021 editions resolve to no career-history row → `—`). Apply: sum flat 1u (win = price − 1, loss = −1) over
    the panel's rows that show a price; it must equal the tile and the profile's "Backing him here".
    **Test:** `test-ten402-c.mjs` "ruling 2026-10-08: the Tournament panel draws ONE model", `test-ten332-tournament.mjs`
    "ruling 2026-10-08", `tools/test-ten402-fix-mutants.js`, `tools/test-ten332-mutants.js` (TEN-402 mutants).
  - **Market edge** (this page) reads each player's `market-edge/{key}.json` rows (`meWinnerRows`): Pinnacle closing, else
    Bet365, retirements settled on Pinnacle rules — its footnote prints `MarketEdgeCore.RET_SETTLE_NOTE`
    ("Retirements settle on Pinnacle rules for all rows."). The shard is built from the master (`database-yield-master.json`, founder 2026-10-17
    "one source of truth"), so its prices equal the Database join (team events stay out of Market edge).
  **Test:** `test-ten402-b.mjs` "review 2 …" (real `database-yield.json` + synthetic career fixtures), `test-ten402-c.mjs`
  (the ledgers' own path), `tools/test-ten402-fix-mutants.js`. Tests never read a bot-rewritten store
  (`style-meetings/*.json` is rewritten daily by the Styles bot): use an in-test fixture.
- **A start-dated row meets its match on or after its date** (style / draw ledgers carry the edition start): a career
  match before the row's date only wins when nothing on or after it fits (`H2H_PAGE_BEFORE_RANK`; Alcaraz v Lajovic
  2023: Rio = 1.15 / 6.61, never Buenos Aires' 1.17 / 6.20). Names are indexed by surname words AND the words joined
  (`h2hTdIx`: the archive's "O Connell C." = C. O'Connell). **Test:** `test-ten402-c.mjs` "review 3",
  `tools/test-ten402-fix-mutants.js`.
- **RD column:** a blank round at the season finals (ATP / Next Gen Finals) is the round robin → `RR`; a blank round
  anywhere else (Davis Cup, Laver Cup, ATP / United Cup) stays `—` (`h2hRoundOf`).
- **Set scores are never cut** (founder r4 fix 2, 2026-10-09; reverses R1's one-line ellipsis): in the Meetings,
  Playing styles and Tournament ledgers the score cell wraps between sets (each set is one nowrap piece in
  `maMatchRowsHtml`) and the row grows; no ellipsis, no clipping (`#h2hRoot .h2hc-led .ma-row-score` = `white-space:normal`).
  **Apply:** Alcaraz v Sinner → Tournament US Open: Shelton 2026 QF reads "7-6(5), 1-6, 3-6, / 6-1, 6-7(7)" on two lines.
  **Test:** `test-ten402-r4n.mjs` fix 2, `test-ten402-c.mjs` "r4 fix 2".
- **Sets column = `pS–oS`** (founder r4 fix 3): en dash U+2013, no spaces, nowrap ("0–2") in the Meetings, Playing styles
  and Tournament ledgers; a retirement reads `—` in Meetings / Playing styles, a walkover `—`. The Tournament rows are the
  shared `trRowData`, so Match analysis → Tournament prints the same (intended). `ps2Meeting` keeps " - " for its other
  hosts, and Match analysis Form / H2H (`fhFormRowData`, `fhH2hRowData`) still print "2 - 0" — outside this round.
  **Apply:** every Sets cell on this page matches `^\d+–\d+$` or is `—`. **Test:** `test-ten402-r4n.mjs` fix 3.
- **Model = the pair's likely opening price, for ANY two players** (founder 2026-11-16, replacing "the Model page's
  board price, else one empty line"): "the head to head is to compare two players, to have a likely opening price based
  on our database, Elo ratings etc." `build-pair-prices.js` (every pipeline run) runs the Stennisfy Model engine itself
  (`runModel(m, { pairOnly, bestOf })`) on every pair of this week's ATP top 200 (`player-index.json`), per surface
  (Hard / Clay / Grass) × format (3 / 5): base state 3 (Elo + surface Elo, no market), the 10 layers that need only the
  two players (`PAIR_SKIP_LAYERS` = manual note, fatigue, weather, market movement never run), H2H = the screens' list.
  Price = 1 / (p × (1 + 3.39%)), 3.39% = Pinnacle's median first two-sided price on the board (n = 442, 27 Sep – 16 Nov
  2026). The card follows the page's Surface / Format toggles; under the boxes: each player's win chance (whole %), the
  context, the Elo base, "N of 10 model layers", the margin with its n, the model run time. Not in the file (outside the
  top 200 / no weekly Elo) → "No estimate for this pair … X is not among them"; a failed load → "couldn't load", asked
  again after 60 s; never a price of the page's own. **Test:** `test-ten402-a.mjs` "Model:" (+ mutants),
  `tools/test-pair-prices.js` (the real engine). **Elo** = the weekly Elo of Database → Ratings.
- **Playing styles / DNA** = the Playing Styles page's archetypes and ratings. **Tournament** rows = Player Profile →
  Draw record for the event. **News** = the News page feed, items it attributes to A or B; none → the card's one sentence.
- **Suggested matchups** = ATP main-draw pairs on this week's board (Mon–Sun), both on the roster, best combined rank
  first, max 3; none → no chips.
- An unsourced metric is grey `—`, never 0.

## Behaviour
- **The Database join is the ONE shared session state (R3 fix 1, 2026-10-09).** `h2hEnsureDb` mirrors
  `_sfDbJoin` / `_sfDbJoinSt` (`sfDbJoinLoad`) on every read and keeps no state of its own: a join any surface loaded
  (profile, Tournament tile, Database) prices every ledger here at once, and a failed load is asked again by the next
  visit (`ensureInit(true)` from the nav clears the throttle) or a render ≥ `H2H_DB_RETRY_MS` (15 s) after this page's
  last ask — never in a loop. Apply: block `database-yield*`, open Alcaraz v Sinner (ledger `—`), unblock, open the
  Alcaraz profile, come back: all 17 meetings priced; without the profile, the next visit alone prices them.
  **Test:** `test-ten402-r2l.mjs` "R3 fix 1", `tools/test-ten402-r2l-mutants.js`.
- **The page never re-enters its own loaders:** `triggerLoads` runs at most once per `H2H_RELOAD_MS` (60 s).
  `loadMatches` ends by calling `H2HPage.ensureInit()`, which used to restart the loaders and repaint the pair ~17×/s.
  **Test:** `test-ten402-lead.mjs` (runs the page's own `triggerLoads`; its control removes the guard and goes red).
- **Match sheet** from any row on this page: the Match analysis sheet (above); Esc, ✕ and an outside click close it; on
  `window.sfOverlayClosers`. The profile's hand-off never takes a sheet state this page left (its pseudo match carries
  `h2hPage`). **Test:** `test-ten402-b.mjs` "review 2 item 2".
- **Hot lines "Show all lines (N)"**: N = the lines with an eligible meeting in the CURRENT scope (Sections → Hot lines).
  No line prices on this page (it is tied to no match).

## Founder round 1 (2026-10-09) — fixes 1, 2, 5, 6 (builder X)
- **Tournament "Last played" = the player's OWN last row in that event's ledger** (`trLastPlayed`): the newest edition
  that has a row, by its year (never its list position), and that edition's top row — year and row from the SAME edition.
  The Match analysis Tournament tab's tile reads it too. **Test:** `test-ten402-r1x.mjs` fix 1.
- **One tournament name per event, site-wide** (`sfEventName` / `sfEventKey`, next to `fhTournClean`): any feed / archive /
  shard / TournamentIdentity spelling → the Tournaments registry entry (`TOURNAMENT_CATALOG`) → its event name
  (`SF_EVENT_NAMES`: ATP Finals, Cincinnati Open, China Open, Roland Garros, Monte-Carlo Masters …; every Slam, Masters
  1000 and ATP 500; an ATP 250 keeps the registry's name; a name outside the registry keeps its own). Printed by the shared
  normalised rows (`fhRowFromForm`, `meRowFromCareer`, the Match analysis H2H rows, Market edge rows → ledgers, hot-line
  tips and the match-stats sheet header), `psGroupMeetings` (Playing style group headers) and this page's Tournament picker
  + info box and the Suggested matchups chips ("… · Shanghai Masters", never "Shanghai"). *Exception (founder
  2026-11-15, "Design wins"):* the Tournaments tab prints the design's city keys (`tournaments.md` "Event names on this
  tab"). Display only — joins read the raw name; the chip's pair keeps the
  board's word. `psTourMeta` / `fhTournCode` read a printed name through its registry key. **Apply:** an event name
  anywhere on the site equals `sfEventName` of any of its spellings. **Test:** `test-ten402-r1x.mjs` fix 2,
  `test-ten402-r2n.mjs` r2.6.
- **Round 3 (TEN-402 follow-up review, 2026-10-09) — the rest of the site prints it too.** Match analysis: the modal
  subtitle (`aContextLine`: "Shanghai Masters · R64 · 12:00", was "ATP Shanghai"), the Tournament tab (`trName`: title +
  tile letter, "Record at Shanghai Masters", the edition headers "Shanghai Masters 2025", the empty line, the hold-rate
  tip, the ROI overlay title and chip), Key factors' Tournament card ("Shanghai Masters · ATP 1000" + its record tip),
  Progression (header, first-round lines, draw-average tip) and Weather's "Court speed · {event}" line. The location line
  stays the venue ("Shanghai, CN"); Weather's city stays a city. The Matches board (`mxEventName`): card head, story strip
  and the tournament chips (ordered by the printed name; `data-tournament` / `state.tournaments` keep `m.tour`). Player
  Profile → Record per tournament (`tournDisplayName` → `window.sfEventName`): the row, the detail header, "best event";
  **the tier is the row's meta** (`tournLevelMeta`: "Cincinnati Open  Masters 1000"; none on a Slam or the ATP Finals),
  never part of the name. **ATP Cup:** the cleaner strips "ATP " from every feed name, so the ATP Cup (2020–22) read
  "Cup" — `SF_EVENT_LITERAL` prints "ATP Cup" (display only). **Shared official name + a city:** `sfEventKey(name, city)`
  — every shared spelling ("Canadian Open", "National Bank Open", "Rogers Cup", "Canada Masters") reads back to Montreal;
  with the row's city the city's own registry event wins when it carries the same official name (the Entry list's Toronto
  year prints "Canadian Open · Toronto"); a city never moves a row onto a different event. **Data never moves:** `trClean`
  (hold-rate `byName`, the catalog match, the career join names), `m.tour` (filters, counts, weather index, edge rail),
  the profile row's `t.name` (`data-t`, `state.tournOpen`, every join). Measured 9 Oct before → after: Zverev / Alcaraz
  every per-event W–L, Backing units and priced n identical (Zverev Shanghai +0.6u, 20 priced, on both the profile and the
  MA tab), the Matches board 16 cards / 1 chip either way. **Not yet renamed (outside this round):** the Players landing
  group headers ("ATP Tokyo") and the profile's per-match event labels (`eventName`: Recent form, last match, ledger
  meta). **Apply:** open any surface listed here; every event reads `sfEventName` of its data name, no tier inside a
  name, and every figure equals the same surface before the rename. **Test:** `test-ten402-r2n.mjs` r3.1–r3.5 (+
  `tools/test-ten402-r2n-mutants.js`), `test-ten332-tournament.mjs`, `test-ten341-key-factors.mjs`,
  `test-ten304-weather-tab.mjs`, `tools/test-pp2-reconcile.js` "TEN-402 r3".
- **Match-stats sheet BP rows / Return rating** come from the match-stats store row (`fhSheetInit` → the setstats shard),
  the same row Match analysis' Match Stats tab reads. A 2026-spring row at Indian Wells / Miami / Monte Carlo / Rome /
  Barcelona / Munich / Houston … holds `null` there (api-tennis sends those two stats only as `stat_value` "X/Y"; the
  store's extractor drops it — TEN-154 / TEN-165), so the sheet keeps `—` (Monte Carlo 2026 F). Not sourced client-side.
- **Suggested matchups = this week's events**: the date window AND the match's event in `tourxThisWeekEvents()` (the
  Entry list's rule, called — the shard row's `city` matches the board's "ATP {city}"); not live yet → no chips, one
  `EntryListsTab.load()`. **Test:** `test-ten402-a.mjs` "fix 6".
