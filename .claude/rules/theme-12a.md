# Layout 12a — layout reference, logo, brand (founder briefs TEN-285 2026-09-25, TEN-286 2026-09-26)

Colours are **not** here any more: theme 12a's palette is retired by the foundation (TEN-376) — see
`.claude/rules/foundation.md`. What 12a still owns is **layout**: sizes, spacing, structure, logo, brand pages.

## The source, in order

1. **`design/reference/portal-12a.html`** — the LOCKED 12a export, committed, never published. It renders
   only with JavaScript: open it in headless Chrome, wait for `aside`, and read **computed styles**
   relative to the portal frame (the `<aside>`'s parent, at page offset 48,94). **Computed values beat any
   label text in the file and any number in HANDOFF.md.** (Its label strip says "#10131F surfaces, 6% white
   hairlines"; it computes `#0E1019` and `rgba(255,255,255,0.043–0.045)` — computed wins.) Its logo `<img>`
   does not load (alt text only): the logo spec is HANDOFF §2 + `logo-dark-transparent.png`.
2. `HANDOFF.md` §1 (tokens), §2 (logo), §3 (per-component values), §4 (other screens) — where the design
   file is silent.

## Tests

- **Layout = the design file's computed values** (sidebar 252px + floating panel, header box, tab/date row,
  stat boxes, filter row, card rows with the 1px column rule, Market Signal open, promo). The component
  comparator (review A, frame-relative, same DPR) reports delta 0 or a listed data-driven exemption;
  `test-ten286-layout.mjs` locks ~100 values on the shipped source (each check re-run against mutants).
- **Line-height** is `normal` across the shell and the Matches board (the design's). Only the title (1.1) and
  subtitle (1.55) set their own.
- **Logo**: `assets/logo-dark-transparent.png`, first item in the sidebar panel (margin `0 8px 26px`), rendered
  26.0 × 138.8px, no box behind it. Icon-only slots use `assets/ring-transparent.png`.
- **Brand outside the dashboard** (founder rulings TEN-285, 2026-09-26): `verify.html` (`.brand-id`),
  `funnel.html` (`.brand`) and `auth.html` (`.brand`) show `logo-dark-transparent.png` at 26px, width auto, no
  tile, no old wordmark ("BSP CONSULT / Tennis edge", "STENNISFY / ANALYTICS"). The funnel footer shows the
  ring with no box and the line "© 2026 Stennisfy". Page titles and body copy are unchanged (founder: leave).
  **Favicon**: every page
  the pipeline publishes has exactly one `<link rel="icon" type="image/png" href="assets/ring-transparent.png">`
  in `<head>`. Locked by `test-ten285-brand.mjs`.

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
