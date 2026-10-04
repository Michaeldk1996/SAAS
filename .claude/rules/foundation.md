# Foundation — colour, surfaces, type (founder TEN-376, OFFICIAL VERSION 1, locked 2026-10-03)

The whole site — every page, the Match analysis modal, pop-ups, sheets — is coloured from **one file, `tokens.css`**
(handoff `design_handoff_foundation/`, README §1–§9, plus the founder's TEN-376 rulings below). Theme 12a colours,
the modal's Night 24b / Day 26f and every older handoff palette are superseded; their layouts, sizes and behaviour
stay valid. Reference build: `OFFICIAL VERSION 1.html` — **the reference wins every conflict** with the README or a
written ruling (founder R1); measure its **computed** value in a browser (its source carries old hex the portal converts
at runtime). *Known exception (R3):* the reference draws a dot before the Today's Matches header "Live · updated 11:41";
ours has none.
- **Status lines are text only (S3), site-wide:** "Live · updated …", the News feed line, the Dropping Odds header — no
  dot, no colour. `--text-label`; a stale / aging state may step up to `--text-soft` so the age stands out (News "Feed
  not live", Drops past its amber tier). The age is carried by the words ("updated 12 min ago"). The only *status* dot on
  the site is the lime serve dot (data marks — chart end dots, the date strip's Today marker — are not status).

## Tests

- **One colour file.** `tools/lint-raw-colours.mjs` (first step of `npm test`) finds **zero** raw colours (hex,
  rgb/rgba, hsl/hsla — comments included) in every page, stylesheet and script `pipeline.yml` publishes. Colours are
  `var(--token)` or `color-mix(in srgb, var(--token) N%, transparent)`; JS reads a token with `getComputedStyle`.
  *Exceptions:* `tokens.css` itself; `assets/` (provider marks, logos — files, not UI code); `funnel.html`,
  `admin.html`, `admin-config.js` until their own packages (founder Q3). A colour that is not a token + opacity
  becomes a **named token only after the founder has seen it** (Q4.5) — there is no exemption list.
- **Theme = one attribute.** `theme.js` (loaded first in `<head>`) sets `data-theme="night" | "day"` on `<html>` before
  first paint from the one key `stennisfy-theme` (`night` | `day` | `auto`); Auto follows `prefers-color-scheme` live.
  Night is the default. **Only surfaces change** between themes (`--page --card --inner --selected --tile-hover
  --sidebar --glow`); text, meaning colours, edges, shadows, type, radii are identical. The sidebar carries the Night · Day · Auto
  darker-track switch above the user row (README §5.14).
- **Layer rule:** page < card < inner < selected. No element's background is darker than its nearest painted
  ancestor. A card-tone element inside an inner box takes the inner tone.
- **Surfaces by role (README §1):** top-level card = `--card` + `--top-light` inset, **no outline**; open card =
  1px `--open-card` (the only coloured outline); nested card / panel / stat box = `--card` + 1px `--edge-6`; clickable
  tile = `--card` + 1px `--edge-7`, hover `--tile-hover` + `--edge-16`, selected `--card` + `--edge-24`; control
  (search, chip, dropdown trigger, input) = `--inner`, no edge, focus `--edge-16`; pop-up sheet / modal = `--card` +
  1px `--edge-10`. All edges 1px solid (no 0.33px, no 1.25px). The floating sidebar panel is `--sidebar` (#121520 night /
  #1A1D28 day, R2), no edge, no top-light.
- **Sidebar (R1, measured on the reference):** idle nav item = `--text-soft` words, `--text-label` icon; hover
  `--tile-hover`; active = `--selected` + 1px `--edge-6`, white words + white icon. Night · Day · Auto: track `--card` +
  `--edge-6`; idle option `--text-soft`; selected `--inner` + `--edge-10`, white.
- **Text = three greys** (founder Q2.1): `--text` #FFF (titles, names, odds, key figures, selected tab, toggle words),
  `--text-soft` #DDE0EA (anything you *read*: header-card subtitles, article / card body, the second player's line
  value in pop-up headers, the losing player's name on Completed cards), `--text-label` #A3AABE (anything that
  *labels*: caps labels, column heads, meta, support lines, idle tabs inside pages, placeholders, mono meta, the header
  "Live · updated" line). No other grey. (Sidebar nav is the one place idle items are `--text-soft` — R1.)
  `#F2F3F7` measured for text or an icon on the reference is a 15a leftover → `--text` (S5); `--pro-text` is only the
  text on a `--pro` button (Upgrade, auth / verify primary).
- **Blue `#007AFF` is a fill, never text.** Bars, the Live player-A series, the one primary-tier fill. Blue text is
  `--link` #6A9AF8 on real links only ("View all news →", "Compare all →", Back, ledger links, the "Most covered"
  label). **Names are white everywhere** (favourite, winner, player A — Q2.3). **Selection is lift (tone + edge),
  never blue**: tabs / segmented / chip rows are the darker track (track `--card` + `--edge-6`, selected `--inner` +
  `--edge-10`, white 700 text). Toggle words (Show… / Hide… / ↓ ▾) are white.
- **Green / red = signed values only** (+/−%, pp, profit/loss, W/L squares and result markers, winner pill, break
  outlines). Never a status, never a decoration, never a surface — so the Odds **best price is neutral** (white bold
  mono, no fill, no outline; only the clicked Per-book row is marked: `--inner` + `--edge-10`), and **Weather severity
  has no colour** (bars and words: calm `--text-label` < WATCH `--text-soft` < CONCERN `--text`, no status dots — TEN-380 review; values: CONCERN
  `--text`, otherwise `--text-soft`; lead factor box `--card` + `--edge-6`) (R4). *Kept by ruling (R4):* Database Lines ≥65% green; SHARP VALUE green / NO VALUE red; Drops FEED DISCONNECTED =
  `--neg` caps text on a white 4% banner, no red fill. *Exceptions (page variants, README §6):* Playing
  Styles matchup Strong `--pos` / Weak `--neg`; hold/break heatmap and form cells tinted `--viz-up` / `--viz-down`
  (green from +3 pts vs the pair's all-sets rate, red from −3, neutral within ±3 — U3); Lost = `--neg` text, Won =
  `--pos` only as a result marker; Completed-card loser is grey, not red.
- **Amber = two places only:** Stennisfy Model value-layer quality (medium) and Trading Report field tiers (within
  3 pts). Nowhere else — not Weather severity, not News stale, not entry lists (U2, U3).
- **Lime = one element:** the live serving dot (`--serve-ball`). Not the nav, not the header, not a LIVE badge.
- **Surfaces are neutral** (Q2.4): Hard / Clay / Grass / Indoor labels are `--text-soft`. *Exception:* the Swing band
  in the Calendar record modal (locked design, bundle `Stennisfy Website.html`, Player Stat Boxes — S4): `--viz-hard`
  #4DB8FF, `--viz-clay` #E8A84E, `--viz-grass` #5CCB84, `--viz-indoor` #DDE0EA; bars 4px, radius 2px, opacity 0.75. These
  four tokens are used there and nowhere else.
- **Market edge (R5):** the top-level Market edge tab cards = `--card`, no outline, `--top-light` only; figure panels /
  stat boxes inside them = 1px `--edge-6`; the Market edge tile inside Key factors = clickable tile (7% / hover 16% /
  selected 24%).
- **Badges** (U2): status / tier badges (Grand Slam, GS tier, Finals, NextGen, entry-list Pending / seed / PR / WC,
  specialist chips, stale, Odds PRE-MATCH / BOOKS) use the FAV-badge treatment — `--inner`, no edge, Hanken 10px caps
  0.10em 700, `--text-label`. **Tier chips** are caps labels too (GS, FNL → Hanken); only a pure figure ("500", a
  count) stays IBM Plex Mono (R5). LIVE = no badge, white caps text, no dot. STEAM = `--selected` + `--edge-16`, white caps.
- **Charts** (U1, README §5.7–5.8, R6.3 "Dotted guides"): bars `--bar` lead / `--bar-2` second; tracks `--track`.
  **Locked exception — white bars on Match analysis** (founder TEN-383, 2026-10-04, "keep white, as the README draws it"):
  the Market edge band and line win-rate bars, Profit at 1u flat, the H2H record and tug bars (H2H tab and Key factors), and the Key
  factors court-speed and Fav wins bars are `--white-bar` lead (#E7E9EE solid) / `--white-bar-2` (white at 45%). Every other data
  bar is `--bar` #007AFF / `--bar-2`. **Test:** `test-ten336-market-edge.mjs` "Q3" + "TEN-380 profit chart",
  `test-ten331-h2h.mjs` tug (`--white-bar`), `test-ten314-gate.mjs` (`var(--white-bar)`); the rest of this rule:
  guides `--viz-guide` dotted (`stroke-dasharray: 2 6`), horizontal only — no vertical gridlines; **no area fill under
  a line** (Database, Market edge, both profile equity charts, Drops price-move box, Odds sparklines and movement chart;
  the reference draws none) and no loss wash; break-even rule `--viz-rule` (32%), solid. The no-fill rule is for LINE
  charts only (S2): a bar-type mark keeps its fill under the bar rules — the Live momentum ribbon (band thickness = the
  data) is player A `--viz-lead`, player B `--viz-second`, both from the centre line, break markers `--neg`, names white.
  Three or more series = no
  new hue: series 1 `--viz-lead` 2.4px, 2 `--viz-white-lead`, 3 `--viz-tick`, 4 `--viz-white-lead` dashed `6 5`;
  at most 4 lines at once; identity from the legend / end plates. Icons are white; category colours do not exist.
- **Shadows** (U5): `--shadow-menu` (drop-downs, type-ahead, info popovers, slider marker), `--shadow-pop` (floating
  pop-ups anchored to an element), `--shadow-modal` (centred modals / sheets). Overlays dim with `--backdrop`
  rgba(9,11,18,0.65) + `backdrop-filter: blur(3px)`, night and day; `--shadow-modal` is `0 40px 120px rgba(9,11,18,0.54)` and
  `--open-card` `rgba(106,154,248,0.30)` (all three measured on OFFICIAL VERSION 1, which outranks the README).
  **The only colour gradient is the page glow** `--page-bg` (S6) — the rule is about colour gradients used as
  decoration (T2). *Allowed:* functional masks (an overflow fade to transparent, e.g. profile chips) and greyscale
  patterns that mark small-sample / missing data (white ≤ 12% on the surface, no hue, e.g. the Playing Styles hatch).
  *Pending their page packages:* the court-speed scales (Tournament tab + Tournaments page → flat; Key factors' bar is
  already flat white). The price-journey bar on match cards is removed (TEN-377). The glow: on `<html>` only — behind sidebar + content, scrolling with
  the page, same geometry at every width — never on a card, modal or the sidebar panel (`body` is transparent). Geometry
  is the reference's (1500×640 at 720px −120px; pixel-identical night + day).
  **The backdrop covers the content area only (R6.5):** every scrim starts at `--sf-side` (the sidebar's 252px) and is
  `clip-path: inset(0)` (not in print) so a sheet's shadow cannot reach the sidebar; the sidebar is never dimmed and stays
  clickable. A fixed layer opened *inside* a blurred scrim takes `--sf-side: 0`, and a tooltip positioned from viewport
  coordinates subtracts its containing block's origin (the scrim is its containing block). At ≤900px the sidebar is
  static and `--sf-side` is 0.
  **A modal belongs to the page it was opened from (S1):** a user's click on a sidebar page closes every open modal /
  sheet / pop-up (same as its ✕) and then navigates. Each overlay registers its closer on `window.sfOverlayClosers`; the
  `#mainNav` handler runs them for trusted clicks only (the app's own programmatic nav clicks don't). The Night · Day ·
  Auto switch is the exception: it changes the theme and leaves the modal open.
- **Provider marks** (U4) are the providers' own files in `assets/brand/`, unmodified, shown as `<img>`; the buttons
  around them are site-style (`--inner`, no edge, 16% on hover, white label).
- **Type** (README §7): two families — Hanken Grotesk 400–800 for words, IBM Plex Mono 400–800 (tabular) for every
  aligned digit — loaded with `display=block` (no fallback flash). Caps labels are Hanken 10.5 / 700 / 0.10em /
  `--text-label`, never mono caps. True minus `−`, en dash in records, odds 2 decimals.
- **No native `<select>`.** Every dropdown is the custom menu (README §5.5).

## Where the values live

`tokens.css` (night `:root`, day `[data-theme="day"]`). The handoff's `tokens.json → legacyColourMap`, extended by the
founder-accepted 12a map (TEN-376 document `plan` §2, Q2), is how an old value found in a design source is read.
