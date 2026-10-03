# Foundation — colour, surfaces, type (founder TEN-376, OFFICIAL VERSION 1, locked 2026-10-03)

The whole site — every page, the Match analysis modal, pop-ups, sheets — is coloured from **one file, `tokens.css`**
(handoff `design_handoff_foundation/`, README §1–§9, plus the founder's TEN-376 rulings below). Theme 12a colours,
the modal's Night 24b / Day 26f and every older handoff palette are superseded; their layouts, sizes and behaviour
stay valid. Reference build: `OFFICIAL VERSION 1.dc.html` — when README and reference disagree, the reference's
**computed** value wins (measure it in a browser; its source files carry old hex the portal converts at runtime).

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
  --glow`); text, meaning colours, edges, shadows, type, radii are identical. The sidebar carries the Night · Day · Auto
  darker-track switch above the user row (README §5.14).
- **Layer rule:** page < card < inner < selected. No element's background is darker than its nearest painted
  ancestor. A card-tone element inside an inner box takes the inner tone.
- **Surfaces by role (README §1):** top-level card = `--card` + `--top-light` inset, **no outline**; open card =
  1px `--open-card` (the only coloured outline); nested card / panel / stat box = `--card` + 1px `--edge-6`; clickable
  tile = `--card` + 1px `--edge-7`, hover `--tile-hover` + `--edge-16`, selected `--card` + `--edge-24`; control
  (search, chip, dropdown trigger, input) = `--inner`, no edge, focus `--edge-16`; pop-up sheet / modal = `--card` +
  1px `--edge-10`. All edges 1px solid (no 0.33px, no 1.25px).
- **Text = three greys** (founder Q2.1): `--text` #FFF (titles, names, odds, key figures, selected tab, toggle words),
  `--text-soft` #DDE0EA (anything you *read*: header-card subtitles, article / card body, the second player's line
  value in pop-up headers, the losing player's name on Completed cards), `--text-label` #A3AABE (anything that
  *labels*: caps labels, column heads, meta, support lines, idle tabs, placeholders, mono meta). No other grey.
- **Blue `#007AFF` is a fill, never text.** Bars, the Live player-A series, the one primary-tier fill. Blue text is
  `--link` #6A9AF8 on real links only ("View all news →", "Compare all →", Back, ledger links, the "Most covered"
  label). **Names are white everywhere** (favourite, winner, player A — Q2.3). **Selection is lift (tone + edge),
  never blue**: tabs / segmented / chip rows are the darker track (track `--card` + `--edge-6`, selected `--inner` +
  `--edge-10`, white 700 text). Toggle words (Show… / Hide… / ↓ ▾) are white.
- **Green / red = signed values only** (+/−%, pp, profit/loss, W/L squares and result markers, winner pill, break
  outlines). Never a status, never a decoration, never a surface. *Exceptions (page variants, README §6):* Playing
  Styles matchup Strong `--pos` / Weak `--neg`; hold/break heatmap and form cells tinted `--viz-up` / `--viz-down`
  (green from +3 pts vs the pair's all-sets rate, red from −3, neutral within ±3 — U3); Lost = `--neg` text, Won =
  `--pos` only as a result marker; Completed-card loser is grey, not red.
- **Amber = two places only:** Stennisfy Model value-layer quality (medium) and Trading Report field tiers (within
  3 pts). Nowhere else — not Weather severity, not News stale, not entry lists (U2, U3).
- **Lime = one element:** the live serving dot (`--serve-ball`). Not the nav, not the header, not a LIVE badge.
- **Surfaces are neutral** (Q2.4): Hard / Clay / Grass / Indoor labels are `--text-soft`. *Exception:* the Swing band
  in the Calendar record modal keeps `--viz-hard / --viz-clay / --viz-grass / --viz-indoor`.
- **Badges** (U2): status / tier badges (Grand Slam, GS tier, Finals, NextGen, entry-list Pending / seed / PR / WC,
  specialist chips, stale) use the FAV-badge treatment — `--inner`, no edge, Hanken 10px caps 0.10em 700,
  `--text-label`. LIVE = no badge, white caps text, no dot. STEAM = `--selected` + `--edge-16`, white caps.
- **Charts** (U1, README §5.7–5.8): bars `--bar` lead / `--bar-2` second; tracks `--track`; guides dotted 12% white
  (`stroke-dasharray: 2 6`) horizontal only; no area fill; break-even rule `--viz-rule`. Three or more series = no
  new hue: series 1 `--viz-lead` 2.4px, 2 `--viz-white-lead`, 3 `--viz-tick`, 4 `--viz-white-lead` dashed `6 5`;
  at most 4 lines at once; identity from the legend / end plates. Icons are white; category colours do not exist.
- **Shadows** (U5): `--shadow-menu` (drop-downs, type-ahead, info popovers, slider marker), `--shadow-pop` (floating
  pop-ups anchored to an element), `--shadow-modal` (centred modals / sheets). Overlays dim with `--backdrop`
  rgba(9,11,18,0.65) + `backdrop-filter: blur(3px)`, night and day; `--shadow-modal` is `0 40px 120px rgba(9,11,18,0.54)` and
  `--open-card` `rgba(106,154,248,0.30)` (all three measured on OFFICIAL VERSION 1, which outranks the README). The only gradient is `--glow`.
- **Provider marks** (U4) are the providers' own files in `assets/brand/`, unmodified, shown as `<img>`; the buttons
  around them are site-style (`--inner`, no edge, 16% on hover, white label).
- **Type** (README §7): two families — Hanken Grotesk 400–800 for words, IBM Plex Mono 400–800 (tabular) for every
  aligned digit — loaded with `display=block` (no fallback flash). Caps labels are Hanken 10.5 / 700 / 0.10em /
  `--text-label`, never mono caps. True minus `−`, en dash in records, odds 2 decimals.
- **No native `<select>`.** Every dropdown is the custom menu (README §5.5).

## Where the values live

`tokens.css` (night `:root`, day `[data-theme="day"]`). The handoff's `tokens.json → legacyColourMap`, extended by the
founder-accepted 12a map (TEN-376 document `plan` §2, Q2), is how an old value found in a design source is read.
