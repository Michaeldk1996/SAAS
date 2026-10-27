# PROMPT — build the Picks page (LOCKED 2026-10-27, night only)

You are implementing the **Picks** page of the Stennisfy site, pixel-perfect against a locked design. Nothing here is up for redesign.

## Inputs, in order of authority
1. `reference/Picks LOCKED 2026-10-27.dc.html` — the design itself. Open it in a browser (it needs `reference/support.js` and `reference/assets/` beside it). Every inline style on boards 1a–1k is the spec; the logic class at the bottom holds the exact copy strings, colour rules and computations. Tweaks: `screen` (Mac 1512 / Review 1440), `proUser`, `admin`.
2. `SPEC.md` — the same values written out section by section (tokens, shell, header/record strip, controls, bets box, card in every state, trail rule, drawer modes, record view, empty states, mobile card, small things, computations).
3. `README.md` — `picks.json` field table, behaviour rulings, gating, admin flow, open items.
4. `demo-data.json` — the five Today rows, the four Sun 26 settled rows and the seven-match slate, in the `picks.json` shape. Use them as fixtures.
5. `tokens.json` / `tokens.css` — OFFICIAL VERSION 1 shell tokens (shared with Today's Matches).

## Scope
- Route: Picks, in the Analyse nav group after Matches (nav position = open item; keep it configurable).
- Shell = the landed Today's Matches shell, untouched: same sidebar, same page glow, same header card recipe, same segments and date strip. Do not fork the shell.
- Views: Upcoming / Completed × date, Record view (ledger), Post-a-pick drawer (admin role only: new · posted-editable ≤ 10 min · frozen; live bet105 price, search + manual price (MANUAL tag), outright mode), mobile card at 390.
- Also: the **Bets today** insight tile on Today's Matches (blurred rows for non-Pro, count + "No bets posted yet today" when empty), the **+ Pick** button on Upcoming match-card footers + analysis modal header (admin), the new-pick dot on the Picks nav icon, the admin shield on the avatar.

## Do NOT build
Anything in the logic class marked `void …` (turn2 layouts, summary variants a–d, note variants a/c/d/e, result-mark options, result-placement options, second-box candidates, five trail treatments) and the `withMkt` Market box. The bets box is ONE box; the Record strip stays in the header; the card trail is the current rail; the analysis is hidden until "Read the analysis ▾" is clicked.

## Hard rules
- **% of bankroll everywhere, never units.** Stake `1.5%`, P/L `+1.02%`, Record `Profit +4.3%`.
- **Nothing a member sees is typed except the pick, the stake and the note.** Open / posted / now / close / CLV / P/L / model fair odds are computed server-side from recorded prices (formulas in SPEC §11); `clv` and `pl_pct` are recomputed on write, never accepted from a client.
- Missing value = dash `—`, never 0 and never a guess. Close is `—` until the match is live; outrights have no trail and a dashed CLV until a closing-line rule is agreed.
- Thin sample: fewer than 20 settled in the period → four dashes + `n=N · thin` in amber.
- Gating: non-Pro blurs the whole player block, right column and note of today's posted/live cards (`filter: blur(5px); user-select: none`); header, chips, footer readable; settled cards never blurred; empty day shows only "No bets posted yet today". Blur is visual only — no real picks reach the client until access control ships.
- Set cells on settled cards colour **per set**, not per match result.
- Review widths are 1512 (card 664) and 1440. 360 is a grid floor nobody sees.
- Times Europe/Brussels; en dash U+2013 in `W–L`, true minus U+2212 on negatives.

## Acceptance
Screenshot your build next to the reference at 1512 for: 1a Today with picks (Pro), 1d non-Pro, 1c Sun 26 settled, 1b empty, 1e Record view, 1f drawer new, 1f2 drawer search + manual, 1f3 drawer outright, 1g editable, 1h frozen, 1j mobile card. Overlay or diff them — fonts, sizes, spacing, radii, colours and copy must match. Report, don't resolve: CLV benchmark for outrights, ledger export format, picks nav position, drafts list, Bets settled tile.
