# App shell — sidebar rulings

Applies to the `.sf-sidebar` shell shared by `bsp-consult-dashboard.html` and
`account.html`. The design source is `App Sidebar.dc.html` in the Database handoff zip.

## Sidebar width is 250px (founder ruling TEN-262 #2, 2026-09-23)

**The rule.** `.sf-sidebar` is `width:250px`, border included (`box-sizing:border-box`,
as the export's `<aside>`). The page's `body` `padding-left` equals it. Both pages
that carry the shell use the same number.

**The test.** At a 1680px viewport, the sidebar's computed `width` is `250px` on both pages
and `body` `padding-left` is `250px`. Locked on the published files by `test-ten262.mjs`
(mutants: 236px sidebar, 236px body offset).

**The measurement behind it.** In the founder's DESIGN 1–4 screenshots (3024×1964, a
1680-CSS-px viewport captured at 1.8 device px per CSS px), the sidebar's right border
is device column x=449 in all four, so the sidebar is 450 device px = **250 CSS px**,
border included. That agrees with the export's `width:250px`. It replaces the earlier
236px, which was kept deliberately and reported in TEN-260.

## Stennisfy Model icon is the design's star (founder ruling TEN-262 #3, 2026-09-23)

**The rule.** The Stennisfy Model nav item uses the `App Sidebar.dc.html` path
`M10 3l1.9 3.9 4.3.6-3.1 3 .7 4.3L10 16.8 6.3 18.8l.7-4.3-3.1-3 4.3-.6z` on every page
that carries the shell.

**The test.** The Stennisfy Model nav item's `<path d>` equals that string on both pages.
No `M4 4v12h12` line-chart path appears in either sidebar. Locked by `test-ten262.mjs`
(mutant: the line-chart path).

**This SUPERSEDES** the earlier "Review item 2" choice of a line-chart glyph
(`M4 4v12h12` + `M6.5 12.5l3-3.5 2.5 2 4-5.5`, logged in `BUILD-NOTES.md`). Do not
revert to it.
