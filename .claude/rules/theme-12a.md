# Theme 12a "Ink solid" — colours, layout, logo (founder briefs TEN-285 2026-09-25, TEN-286 2026-09-26)

## The source, in order

1. **`design/reference/portal-12a.html`** — the LOCKED 12a export, committed, never published. It renders
   only with JavaScript: open it in headless Chrome, wait for `aside`, and read **computed styles**
   relative to the portal frame (the `<aside>`'s parent, at page offset 48,94). **Computed values beat any
   label text in the file and any number in HANDOFF.md.** (Its label strip says "#10131F surfaces, 6% white
   hairlines"; it computes `#0E1019` and `rgba(255,255,255,0.043–0.045)` — computed wins.) Its logo `<img>`
   does not load (alt text only): the logo spec is HANDOFF §2 + `logo-dark-transparent.png`.
2. `HANDOFF.md` §1 (tokens), §2 (logo), §3 (per-component values), §4 (other screens) — where the design
   file is silent.

## Tokens (exact; the first `:root` block, byte-identical on `bsp-consult-dashboard.html` and `account.html`)

Surfaces: `page #0B0C13` · `nav-panel #0D0F18` · `surface #0E1019` · `surface-inner #0C0E16` ·
`input transparent` · `popup #131623` · `backdrop rgba(11,12,19,0.76)`.
Lines (all **0.33px**): `line rgba(255,255,255,0.045)` · `line-soft 0.03` · `line-panel 0.035` ·
`line-open 0.10` · `line-avatar 0.06`.
Text: `text #EBF1F2` · `text-soft #D9DBDF` · `text-sub #A3ABBA` · `label #6E7A93` · `nav-idle #9BB0DA` ·
`nav-icon-idle #7F93BD`.
Accent: `blue-ring #007AFF` · `periwinkle #6A9AF8` · `navy #07183D` · `royal #0B2878` · `lime #EAF928` ·
`bar-track #16234A` · `bar-dog #2A3556` · `seg-active #0B1C4E` / `seg-active-line #2E4FA8`.
Functional: Hard `#6A9AF8` · Clay `#F2B45F` · Grass `#45D6B0` · `positive #3ED68C` · `negative #DA6259`.
§3 nav: `nav-hover rgba(106,154,248,0.08)`, `nav-active rgba(0,122,255,0.16)`, `nav-active-line
rgba(106,154,248,0.18)` at 0.5px, active dot lime. Player avatar fill `avatar #0B0C14`.
Design-file values with no HANDOFF name (the promo icon tile): `promo-tile #172137`, `promo-glyph #5B9CFF`.

## Tests

- **Every rendered colour is a token.** The computed-style audit (every tab + modal / drawer / Market Signal /
  hover / selected-date / Completed states) reports only tokens, `transparent`, or the unmapped list below.
  Chrome stores alpha in 8 bits, so `0.045` reads back `0.043`: compare `round(a*255)`, not the string.
- **The 12a token block is one block, identical on both pages, and holds every colour the design renders**
  (31 computed values). Locked by `test-ten286-layout.mjs` (mutants: a drifted `--label`, the stale label-text
  `#10131F`, a dropped `--promo-tile`).
- **Layout = the design file's computed values** (sidebar 252px + floating panel, header box, tab/date row,
  stat boxes, filter row, card rows with the 1px column rule, Market Signal open, promo). The component
  comparator (review A, frame-relative, same DPR) reports delta 0 or a listed data-driven exemption;
  `test-ten286-layout.mjs` locks ~100 values on the shipped source (each check re-run against mutants).
- **Line-height** is `normal` across the shell and the Matches board (the design's). Only the title (1.1) and
  subtitle (1.55) set their own.
- **Same component, same colours on other tabs.** The Model tab's Market Signal block renders the design's
  Market Signal colours (venue `text-soft`, favourite % `periwinkle`, split bar `blue-ring` on `bar-dog`,
  liquidity `label`); other tabs otherwise follow HANDOFF §4 (colours/surfaces/outlines only).
- **Lime count = 2**: header live dot + active-nav dot (a `::after`).
- **Blue-ring roles**: probability bars, form bars, date underline, Today dot. Nothing else.
- **No chrome gradients / shadows / blur.** Remaining sites must be on the data-viz list below.
- **Logo**: `assets/logo-dark-transparent.png`, first item in the sidebar panel (margin `0 8px 26px`), rendered
  26.0 × 138.8px, no box behind it. Icon-only slots use `assets/ring-transparent.png`.
- **Brand outside the dashboard** (founder rulings TEN-285, 2026-09-26): `verify.html` (`.brand-id`),
  `funnel.html` (`.brand`) and `auth.html` (`.brand`) show `logo-dark-transparent.png` at 26px, width auto, no
  tile, no old wordmark ("BSP CONSULT / Tennis edge", "STENNISFY / ANALYTICS"). The funnel footer shows the
  ring with no box and the line "© 2026 Stennisfy". Page titles and body copy are unchanged (founder: leave).
  **Favicon**: every page
  the pipeline publishes has exactly one `<link rel="icon" type="image/png" href="assets/ring-transparent.png">`
  in `<head>`. Locked by `test-ten285-brand.mjs`.
- **Hairlines** are written `0.33px`. Compared with the design **in the same browser at the same DPR** they are
  identical (1px at DPR 1; 0.5px computed = 1 device px at DPR 2 — measure with
  `--force-device-scale-factor`, never CDP-emulated DPR). No pseudo-element workaround (TEN-286 item 19, closed).

## Pending founder rulings (do not change without one)

- **UI font fallback stack.** The design uses `"Hanken Grotesk", sans-serif`; the dashboard keeps
  `system-ui, -apple-system, 'Segoe UI'` before `sans-serif` per the founder's 2026-09-17 §5 ruling. Effect,
  measured: fallback glyphs (▾ ⇅ →) render 1–2px narrower than the design.
- **Card clipping.** Cards stay `overflow:visible` (founder ruling TEN-179 q1: no silent clipping); the header
  carries its own 14px top radius instead of the design's `overflow:hidden`.
- **Equal-height cards.** The grid keeps `align-items:stretch` with a flex-column card and a pinned footer
  (founder ruling TEN-270, `.claude/rules/odds.md`, locked by `test-ten270-price-history-box.mjs`). The design
  uses `align-items:start`: with one card's Market Signal open (424px) its closed neighbour stays 187.5px in the
  design and stretches to 424px here (≈237px of empty space above its footer).

## Unmapped (no token home) and data-viz effects — left unchanged, PENDING founder ruling

The list lives on TEN-285 (document `inventory`, sections b and c). None of b01–b62 has an equivalent
element in the design file (all sit on other tabs, drawers or modals): each is marked "no design reference —
waiting on Claude Design". Until he rules, those values are the only permitted non-token colours. When he
rules, replace this paragraph with the ruling.
