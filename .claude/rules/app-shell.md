# App shell — navigation rail + avatar menu

Applies to the `.sf-sidebar` shell shared by `bsp-consult-dashboard.html` and `account.html`. The design source is the
founder's shell package (`design_handoff_shell_refresh/`, PROMPT_SHELL.md part 2, 2026-10-08) and its reference export
`OFFICIAL VERSION 1 (2026-10-08).html`, artboard **40a** (the 38a rail + 40a avatar menu), measured as **computed** styles
at 1512px relative to the artboard frame (the `<aside>`'s parent). The reference wins over the prompt's numbers.
**This SUPERSEDES** the TEN-286 rulings "Sidebar is 252px with a floating panel" and "The user row is a plain link — no
chevron" (and TEN-262 #2's 250px before them). Do not revert to either.

## The rail: 92px closed, opens on hover to 248px and pushes the page (TEN-403)

**The rule.** One CSS block (`/* sf-rail:start */ … /* sf-rail:end */`), byte-identical on both pages.
- Closed: `.sf-sidebar` is `width:92px`, padding `30px 0 30px 16px`; inside it `.sf-panel` is a floating pill 76px wide,
  `--sidebar` tone, radius 38, padding `16px 12px 14px`, shadow `var(--top-light), var(--shadow-rail)`. Logo = the ring
  (`assets/ring-transparent.png`) 34×34, margin `0 0 14px 9px`.
- Open (desktop, `:hover` or keyboard `:focus-visible` inside the rail): aside 248, pill 232, radius 26; width and radius
  transition .18s ease. The page moves right with it — no overlay: `--sf-side` is 92 closed / 248 open (set on `<html>`
  by `html:has(.sf-sidebar:hover)`), `body` `padding-left:var(--sf-side)` (transition .18s), and every scrim / drawer that
  starts at `--sf-side` follows it (Dropping Odds' `.do-ov` included — it reads `--sf-side`, not a measured width).
- The main column keeps `max-width:1360px`; it gains the width the old sidebar used.
- Mobile (≤900px): the rail is a static block above the page laid out open; `--sf-side` is 0.

**The test.** `test-ten262.mjs` "TEN-403 app shell": on both pages the block exists and is identical, closed width 92,
`:root{ --sf-side:92px; }`, body offset = `var(--sf-side)` (never a fixed px), the open rule pushes to 248 and widens the
aside to 248. Mutants: the 252px sidebar back, `--sf-side` 252, the push removed, a pinned body offset, an account.html
drift, the line-chart Model icon. `test-ten286-layout.mjs` locks every closed value and the open block (rows 42, groups
10 apart, radius 26, labels shown; mutants rows48 / noLabels).

## Groups, rows, the selected glow, badges (TEN-403)

**The rule.**
- Three groups, spacing only (no hairline): **Analyse** = Matches · Live · Trading Report · Dropping Odds · Series;
  **Research** = Players · Head to Head · Tournaments · Database; **Insights** = Stennisfy Model · Playing Styles · News.
  Group gap 14px closed / 10px open; rows 4px apart. When open a caps name sits above each group (Hanken 10.5 / 700 /
  0.10em, `--text-label`, padding `0 14px 2px`). account.html carries the same groups with the items it links to.
- Rows: height 48 closed / 42 open, padding `0 13px` inside a 1.5px transparent border, radius 14, gap 13. Icon 20px,
  stroke 1.6: active `--text`, idle `--text-label`, Pro-locked `--nav-locked`. Open adds the label (13.5/600): active
  white, idle `--text-label`. Hover (not the active row) = `--inner`.
- Selected page = a white glow only, no tile and no outline: `radial-gradient(ellipse 76px 40px at 26px 50%, white 13% →
  0)`, on a `::before` that fades in .25s when the selection changes.
- Live count badge: 18px pill, `--bar` (#007AFF — the ONLY blue on the navigation), white Plex Mono 10/700, a 2px
  `--sidebar` ring, top-right of the icon. The count is the Live page header's **In play** (founder TEN-417 R1:
  LiveFeed payload `inPlay` = ATP singles underway minus interrupted, the same `isInterrupted` as the page; the one-shot
  `LiveFeed.liveCount()` off the Live page counts the same); no feed or 0 in play = no badge.
- Pro lock (founder R1 item 3, 2026-10-09; SUPERSEDES "no page is Pro-locked today"): on the Free plan (`plan` free or
  missing) or signed out, **Trading Report** (`data-tab="trading"`) and **Stennisfy Model** (`data-tab="edge"`) show the
  locked state: icon `--nav-locked` (#5B6880) + a 16px `--inner` circle with a grey (`--text-label`) 9px lock (stroke 2) at
  the icon's top-right (left 12, top −8, 2px `--sidebar` ring) — the reference's computed badge. An Edge or Pro plan unlocks
  both. `window.sfPlanLocks(u)` (shared sf-menu block, both pages) is called by the auth paint path (`paintAcct` on the
  board, `paintChip` on account.html), so it follows sign-in / sign-out live; `window.sfNavLock(tab, on)` paints one row
  (account.html's rail has no Trading Report, so only its Model row locks). **Navigation is NOT gated**: a locked row
  still opens its page on click; only the visual state changes.
- Every nav button keeps its `data-tab` and id (`#liveTabBtn`, `#tradingTabBtn`, `#dropsTabBtn`, `#seriesTabBtn`,
  `#databaseTabBtn`) and its flag-hidden `display:none` until its module reveals it.

**The test.** `test-ten286-layout.mjs`: the SPEC values (rows, glow, badges, colours; mutants: a selected tile back, a blue
glow, the 252 sidebar), "Pro lock" (the real sfPlanLocks on each page's nav rows: signed out / free / no plan → locked,
edge / pro → open, wired from paintAcct + paintChip, no click gate; mutants: Pro-only unlock, Model left open, signed out
open, either paint path unwired, account lookup lost, a click gate), "rulings" (the three groups in order with their names; mutant: a group name lost), "C · nav
glyphs" (the design's paths, element for element, viewBox `0 0 20 20`; the Model star — founder TEN-262 #3 — and no
retired line-chart glyph); `test-ten242-rulings.mjs` item 1.1 (the 12 items in order).

## The foot is the avatar; it opens the avatar menu (TEN-403, SUPERSEDES "no chevron, no menu")

**The rule.** Only the avatar sits at the foot: a 36px `--inner` circle with white Plex Mono 10.5/700 initials (open:
also name 12.5/600 white · plan 10.5 `--text-label` · ›). The row is `<a class="sf-userchip" id="acctMain"
href="account.html" aria-haspopup="menu">`. Clicking it opens `#sfMenu` beside the rail (left `calc(100% + 14px)`,
bottom-aligned with the foot): 232px, `--card` + 1px `--edge-10`, radius 14, `--shadow-avatar`, padding 14, gap 12 —
name · plan row; caps "Theme" over the Night / Day / Auto darker track (theme.js's one switch, `data-sf-theme-switch`,
mounted once, here); Upgrade to Pro (`--pro`, 36px, radius 10, → account.html; hidden on a Pro plan); then on an 8%
white hairline Account settings (white, → account.html) and Sign out (`--text-label`, white on hover; `#acctSignout` →
`BSP.signOut()` → auth.html), rows `--inner` on hover. A click outside or Escape closes it; the theme switch keeps it open.
The plan line is the account's own plan (`free | edge | pro` → "Free plan" / "Edge plan" / "Pro plan").
**Signed out there is no account** (founder TEN-380 review, 2026-10-04): no initials and no plan (`paintAcct` hides both;
signing in restores them), a person glyph in the circle, the open row reads "Sign in", the row links to
`auth.html?mode=signin` and opens no menu.

**The test.** `test-ten286-layout.mjs` "rulings": the row → account.html with `aria-haspopup="menu"`; the menu holds the
theme switch, Upgrade → account.html, Account settings → account.html, Sign out `#acctSignout`; the switch / Upgrade are
not back at the foot (mutants: switchBackAtFoot, rowToAuth, noSignout, noMenu). Signed-out painting:
`test-ten314-modal-frame.mjs` "review item 5".

## Page header (35b, TEN-403)

Founder shell refresh, 2026-10-08 (`design_handoff_shell_refresh/PROMPT_SHELL.md` part 1), measured as COMPUTED values on
the 35b header of the 2026-10-08 reference export at 1512 night. Supersedes every 29px header card (title 29/800, padding
22×26, sub 13.5/1.55, stats gap 34, mono 17) and every caps line above a page title.

- **One component, `.sfh`, on every page header card:** Today's Matches / Results, Live, Trading Report, Dropping Odds,
  Series, Players, Head to Head (`.sfh--ctl`, below), Tournaments, Database (page + both overlay mounts), News, Playing Styles
  (TEN-408), Live (TEN-417), Stennisfy Model (TEN-418). Pages
  keep their root class as a hook (`mx-titlerow`, `pgh-card`, `h2h-head`, `tourx-head`, `db-headcard`, `tr-hdr`,
  `sr-head`, `do-head`, `news-head`, `ps-head`, `em-head-card`) but own **no rule that restyles the header** (H2H owns only its sticky shadow).
  Player Profile has a player hero, not a page header.
- **Card:** `--card`, `--top-light`, no outline, radius 12, padding 18×26, one row `align-items:center;
  justify-content:space-between; gap:28px`.
- **Left** (`.sfh__text`, column, gap 5): title `.sfh__title` Hanken 24/800, −0.015em, line-height 1.1, `--text`; under it
  ONE line `.sfh__sub` 13px `--text-soft`, `nowrap` + ellipsis, optionally ending in a `--text-label` tail
  (`.sfh__tail`, e.g. "· Settled · 8 Oct 2026", the Drops / News status line). Header copy is one line: at most 120
  characters (a longer sentence is trimmed, never reworded; *exception:* Playing Styles keeps the reference's full
  128-character line, founder TEN-408). **No caps label line above the title.**
- **Right** (`.sfh__stats`, gap 30, `align-items:flex-end`): columns `.sfh__stat` (gap 4, right-aligned) of a caps label
  `.sfh__l` (Hanken 10.5/700/0.10em `--text-label`) over a value `.sfh__v` (Plex Mono 15/700 `--text`; clocks
  `.sfh__v--soft` = `--text-soft`; an unsourced value is a grey `—`, `.sfh__v--none`). A page with no stats draws none.
- **Today's Matches live column** (first, Upcoming only): label over `.sfh__live` = 7px `--pos` dot `.sfh__dot` + the
  clock in mono 15/700 `--text-soft` (`mxHeaderStatusHtml`, ruling A words). The only status dot besides the serve ball.
- **Controls under the row** (Head to Head pickers): `.sfh.sfh--ctl` (block, padding 18×26×22) wrapping `.sfh__row`
  (the row above, margin-bottom 16) then the controls (pickers, swap, Surface / Format strip); H2H stays sticky with its
  shadow and its line ends in the grey coverage tail.
- **Mobile (<900px):** the row and the stats wrap.
- **Test:** `test-ten403-header.mjs` (component values, every page on `.sfh`, no caps line, no page-owned header rule,
  one line ≤ 120 chars, the live column executed from the shipped `mxHeaderStatusHtml`; each check red on its mutant).
