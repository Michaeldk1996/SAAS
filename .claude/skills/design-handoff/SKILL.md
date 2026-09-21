---
name: design-handoff
description: Rebuild a page or tab pixel-perfect from a Claude Design handoff bundle. Use whenever a task references a design_handoff_* folder or zip, a .dc.html file, a design export, or asks to rebuild/match a page to the design. Also use when a task attaches design screenshots — the files are the source, not the images.
---

# Design handoff → pixel-perfect build

## The one rule that matters

**The `.dc.html` file and its README are the source of truth. Screenshots are not.**

A screenshot makes you infer spacing from pixels and guess a hex from a rendered colour. The handoff bundle *states* those values. Reading them is both cheaper and more accurate. If a task attaches screenshots, use them only to verify at the end — never as the input you build from.

## Read in this order, and stop when you have what you need

1. **The bundle README.** Covers colours, type, grid tracks, spacing, interactions, chart geometry, state keys, props and data requirements. Most values you need are here. Read it first and read it fully.
2. **The `.dc.html` for the surface you're building.** This is the structure. Build *this* structure — do not restyle your existing markup toward it.
3. **`design-export/specs/<tab>-spec.md`**, if one exists for this tab. A per-tab spec outranks everything below it inside its own scope.
4. **`design-export/computed-styles.json`** — only where the above are silent, and **only the page-state you are building.** The file carries 30 page-states; loading all of them is a large, avoidable cost. Extract the one state, don't read the whole file into context.
5. **`CHARTS.md`**, if the surface has plots.

Do not read `tokens-observed.json` or `tokens-design.json` unless a specific token is unresolved after the above.

## While building

- **Read values, never infer them.** No rounding. The half-pixel sizes (13.5, 12.5, 11.5, 10.5, 9.5) are real authored values, not artifacts.
- **No number quoted in the task brief is a source** — including the founder's. Treat every quoted value as a hypothesis and verify it against the bundle.
- **No generic-convention defaults.** Reaching for a sensible standard treatment is the signal to stop and read the export instead.
- **Rebuild rather than restyle.** If your structure differs from the bundle's, adjusting colours and spacing will not converge.
- The universal colour, weight and container rules in `CLAUDE.md` still apply. Surface-specific rulings are in `.claude/rules/`.

## Where to stop and ask

Three cases the bundle cannot settle:

1. **Fabricated or absent data** — no design mock justifies inventing a value. Em dash and report.
2. **Scope** — a section or binding with no counterpart in the data layer. Report before building it.
3. **Product decisions that post-date the export** — before deleting something *because the bundle lacks it*, ask.

On any other measurable conflict, the bundle wins and you proceed. Note the divergence in your report; do not wait on a ruling.

## Verifying

At the end, and only at the end, take **one** screenshot of what you built and compare it against **one** reference shot. Two images, at the point of checking.

Report with a deployed commit and a live read — "merged" is not "shipped".

## Cost notes

These are the habits that keep a handoff task cheap:

- Never load screenshots as build input.
- Extract one page-state from `computed-styles.json`; never read the whole file.
- Read the README once, fully, rather than re-reading fragments as questions come up.
- If the bundle is large, delegate the extraction to a subagent so the raw JSON stays out of the main conversation and only the values you need come back.
