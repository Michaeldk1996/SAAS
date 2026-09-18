# Message to Paperclip

Hi — here's the **Player Profile** page from Stennisfy, ready to build. It's the page a member lands on after picking a player from Players, and it's our most layout-heavy screen, so it's the right one to establish the patterns the rest of the app will reuse.

**What's in the folder**

| File | What it is |
|---|---|
| `README.md` | The spec. Every colour, type size, grid track, state and data rule, section by section. Read this first. |
| `Player Profile.dc.html` | The live prototype — page frame, header, recent-form ribbon, full ledger, key insights, tournament detail, match views. Open it in a browser. |
| `Player Stat Boxes.dc.html` | The eight stat boxes and all eight modals, including the hold/break heatmap. |
| `App Sidebar.dc.html` | The app shell sidebar, for page-frame context only. |
| `STENNISFY-DESIGN-INSTRUCTIONS.md` | Product-wide visual and data rules. Read §2, §3 and §6 before you start. |
| `support.js` | Runtime so the HTML files open locally. Not part of the design — do not port it. |

**How to treat the files**

They are design references written in HTML, not production code to lift. Recreate the design in your own environment using your existing patterns, component library and data layer. The authoring format (`.dc.html`, `<x-dc>`, `<sc-for>`, `renderVals()`, `{{ hole }}`) is a prototyping format — read the template as markup + styling (every style is inline, so every value you need is on the element) and the trailing script as the data model and behaviour.

**Fidelity: high.** Colours, type, spacing, radii, grid tracks and states are final and exact. Build it pixel-for-pixel. Where the README and the file disagree, the file wins.

**This is the locked version.** Layout 9e; the box set was re-locked on 2026-09-17. Page order — header → recent-form ribbon → eight stat boxes → key insights, with the full ledger opening from the ribbon — is fixed. Please don't reorder, merge or restyle the blocks; if something looks wrong, flag it rather than fixing it in the build.

**Five things that matter more than they look**

1. **All data is placeholder.** Player is P. Martinez, ATP 136. Records, ledgers, calendars and heatmaps come from constants and seeded generators, and the numbers deliberately don't reconcile across boxes. Wire real data; keep every display rule.
2. **Sample gating is a hard rule.** n ≥ 10 shows a rate at full size; 5–9 shows it smaller and greyed with a "small sample" mark; under 5 shows W–L only and a dash, and that row or band does not open. Zero reads "no matches on record". Never a `0` or `0%` standing in for a missing figure. README §9.
3. **Nothing unwired shows a number.** Anything not connected reads `—` in `#4b5672`.
4. **Every rate carries its record and its n** next to it, and every modal drill reconciles with the figure that opened it.
5. **Sign colour is reserved.** Green/red only on deltas, yields and P&L per the thresholds in §9. Direction elsewhere is carried by a word, not a colour.

**Typography and figures.** Hanken Grotesk for UI, IBM Plex Mono for every number, date, tag and eyebrow — no exceptions, and no second label style: eyebrows are 9.5–11px mono, 600, letter-spacing .12–.16em, uppercase, `#5b6880`. Minus is U+2212 `−`, ranges use an en dash `–`, separators are `·`.

**Open items** are listed at the end of the README — mostly unwired filters and generated prices. Anything ambiguous, ask before choosing; I'd rather answer than have it guessed.

Thanks —
Michael
