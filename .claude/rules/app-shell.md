# App shell — sidebar rulings

Applies to the `.sf-sidebar` shell shared by `bsp-consult-dashboard.html` and
`account.html`. The design source is `design/reference/portal-12a.html` (the LOCKED 12a
export, founder ruling TEN-286 2026-09-26). Measure its computed styles in headless Chrome,
relative to the portal frame (the `<aside>`'s parent), never its label text.

## Sidebar is 252px with a floating panel (founder ruling TEN-286, 2026-09-26)

**The rule.** `.sf-sidebar` is `width:252px`, `box-sizing:border-box`, padding `18px 0 18px 18px`;
inside it `.sf-panel` is the floating `nav-panel` box (0.33px `line-panel`, radius 22px, padding
`20px 12px 14px`). The page's `body` `padding-left` equals the sidebar width. Both pages that carry
the shell use the same numbers.

**The test.** On both pages the `.sf-sidebar{position:fixed…}` rule says `width:252px` and `body`
`padding-left:252px`. Locked on the published files by `test-ten262.mjs` (mutants: 236px sidebar,
the superseded 250px sidebar, a 250px body offset).

**This SUPERSEDES** TEN-262 #2's 250px (measured from the DESIGN 1–4 screenshots). Do not revert
to it: the 12a design's aside computes 252px.

## The user row is a plain link — no chevron (founder ruling TEN-286 item 6, 2026-09-26)

**The rule.** `.sf-userchip` is an `<a href="account.html">` holding the avatar, name and plan only.
There is no `.sf-chev` element and no menu behind the row.

**The test.** Neither page contains `sf-chev`, and the user row's `href` is `account.html`. Locked
by `test-ten286-layout.mjs`.

## Nav glyphs are the 12a design's paths (TEN-286 check C)

**The rule.** Every sidebar icon is the design file's SVG, element for element (viewBox `0 0 20 20`,
stroke 1.6 via CSS). This includes the Stennisfy Model star (founder ruling TEN-262 #3,
`M10 3l1.9 3.9 4.3.6-3.1 3 .7 4.3L10 16.8 6.3 18.8l.7-4.3-3.1-3 4.3-.6z`); the old line-chart
glyph `M4 4v12h12` stays retired.

**The test.** For each nav item, the list of `<path|circle|ellipse|line|rect>` elements and their
geometry attributes equals the design's for the same label. The Model star is locked by
`test-ten262.mjs`; the full glyph set by `test-ten286-layout.mjs` (mutants: an extra `<circle>` in
Live; the retired Live arcs).
