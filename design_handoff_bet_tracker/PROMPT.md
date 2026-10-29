# Prompt for Claude Code

Paste this as the opening message in Claude Code, from the Stennisfy repo root, with the `design_handoff_bet_tracker/` folder dropped into the repo.

---

You are implementing the **Bet Tracker** page for Stennisfy (ATP tennis betting analytics, React, night theme). The design is locked and pixel-final.

Read, in this order:
1. `design_handoff_bet_tracker/README.md` — the full spec: tokens, anatomy, every formula, copy, state, data contract.
2. `design_handoff_bet_tracker/Bet Tracker Page.dc.html` — the pixel reference. Lines 19–417 are the markup with inline styles (treat every value as the truth); lines 419–760 are the logic class — the reference implementation of every computation, including the demo-data generator (`bets()`), `stats()`, `key()`, and `renderVals()`.
3. `design_handoff_bet_tracker/OFFICIAL VERSION 1.dc.html` — the site shell, to see where the page mounts (`Betting` nav group → Picks · Bet Tracker, `pgTracker` branch) and how the existing pages are embedded.

Then:
- Map the README tokens onto our existing design tokens first; add any that are missing (card `#0E1019`, tile `#0A0D14`, hairline 5%, menu `#0C0E16`, selected `#131623` / `#1B2031`, ink `#E7E9EE` / `#A3AABE`, ring blue `#007AFF`, pos `#5CCB84`, neg `#E06266`, warn `#E8A84E`). Fonts: Hanken Grotesk (UI) + IBM Plex Mono (every figure).
- Build the page as our normal page component in the Betting route group, with the sidebar entry (label "Bet Tracker", short "Tracker", icon path in the README). Night only — do not route it through the light recolour.
- Port the maths from the logic class 1:1 into pure, tested functions (P/L, ROI, CLV, drawdown, runs, period windows, cross-adjusted filter counts, segment eligibility with `minSample = 15`, the three discipline checks, the six staking plans, the heat alpha). Write unit tests against the demo seed `20261027`: with the "Tennis 2026" bankroll and Season period, your figures must match the prototype's hero tiles exactly.
- Reproduce the layout from the inline styles: same grid tracks, gaps, paddings, radii, font sizes and weights. Column: `width:100%; max-width:1340px; min-width:960px`. Charts are SVG with the same viewBoxes (`0 0 1292 240` curve, `0 0 1256 226` staking, `0 0 380 70` verdict sparkline, `0 0 200 110` dials) stretched to 100% width with `preserveAspectRatio="none"`; tick labels are HTML positioned absolutely as in the reference.
- Interactions to wire: bankroll select / archive / restore / delete / add; Log-a-bet with Single · Combination (exactly 2 legs) · Parlay (2+), validation and the "You post …" sentence; Period menu incl. custom dates; Filters menu with cross-adjusted counts and Reset; Results · Insights · Staking view segment; ledger filter + month chips; WON / LOST / VOID → undo → Lock (irreversible); heat hover pop-up + click-to-pin record; month row → month pop-up; breakdown cut menu; plan chips + Apply / Remove with the stake hint in the form.
- Copy is final — use the exact strings in the README (including "EARLY · n=x", never "thin"; every count with its denominator; "—" for anything missing; stakes in % of bankroll everywhere except the calendar's €).
- Rules that are *not* in the design and must be left as TODOs, not invented: Export CSV, CLV for outrights, bankroll rename, deposits / withdrawals, the live close feed.

Deliver: the page + sidebar entry, the pure-function module with tests, and a short note listing anything in the reference you could not reproduce exactly and why. Compare against the HTML at 1340px and 1180px before you call it done.
