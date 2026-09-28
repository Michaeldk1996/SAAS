# Match analysis — Overview tab: founder rulings

Applies to the Match analysis modal's **Overview** tab in `bsp-consult-dashboard.html`: the career card,
its surface bars and drill-downs, the `THIS SEASON · BY SURFACE` row, match lists, and the nested match
stats block inside the career drill (`.yr-drill` scope).
Restored from CLAUDE.md before 011e3e20 (2026-09-21 trim); TEN-312 N13, founder-approved 2026-09-28.
Where this file conflicts with `modal-analysis.md` (TEN-312, 2026-09-28), that file wins; the conflicts
found at restore time are marked inline.

- **Overview tab — identity vs outcome (founder ruling 2026-08-01).** Two distinct axes coexist on the
  Overview modal tab. **(1) Identity by name order:** the career-card surface bars, the
  `THIS SEASON · BY SURFACE` row left-accent, and the nested match-stats block's left name carry *whose
  column this is* — fixed by name order, **never** by clay/hard/grass and never by value. (Reverses the
  earlier "career bars all-neutral / accent surface-family-blue" calls.)
  *Superseded colours (TEN-312 D4, 2026-09-28):* the old values "left player (P1) blue `#6aaeff`, right (P2)
  neutral `#e7e9ee`" no longer apply — both players are neutral on every tab (player A white/primary,
  player B grey; blue is only links, TODAY and selection). See `modal-analysis.md` "Players and avatars".
  **(2) Outcome as a data fact:** the `W`/`L` result letter in the surface drill-down and match lists is
  coloured by outcome — canonical W / L green / red — and a `ret.` suffix carries the loss red (`w/o` stays
  neutral). A completed match's result is a data-fact verdict, not a two-player comparison, so it is a
  permitted green/red exception alongside LOST SERVE/BP markers (reverses the earlier "W/L neutral in modal"
  call). *Colour values (TEN-312 D1):* the old hex `#3dd68c` / `#e0616f` is retired; the modal takes these
  colours from its one token file (Night 24b / Day 26f). *Walkovers (TEN-312 N2):* a `w/o` row is excluded
  from every count on the page (`modal-analysis.md` "Walkovers and retirements").
  **Test:** surface bars/accents/left-name never change hue with the *value* (identity only); the W/L letter
  never stays neutral on a completed match.

- **Nested Match Stats block (Overview drill) is tertiary.** The shared `.aform-*` form panel, when it
  appears inside a match-row drill inside the Overview career card (`.yr-drill` scope), reads one step
  **smaller** than the Form tab / Player Profile (which are primary surfaces and keep full size). Its active
  view chip is **flat** — segmented-control standard fill + primary text, **never** a solid bright fill.
  *Colour values (TEN-312 D1):* the old values (`rgba(91,155,255,0.22)` fill + `#e7e9ee` text; solid
  `#3E7BFA` reserved product-wide to Login-primary / Verify) are pre-12a; inside the modal the chip takes
  its colours from the token file.
  **Test:** the Overview nested block is visibly smaller than the standalone Match Stats tab and its active
  chip carries no solid bright fill.

See also: CLAUDE.md "Match-detail view toggle" (Stats | Point by point, no Summary — covers the Overview
drill); `modal-analysis.md` "Overview career spine (N3)" (the Overview reads `careerByYear`).
