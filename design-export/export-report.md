# Stennisfy — Export report (development handoff)

Fresh export from the current design sources. Nothing in the build was changed,
corrected, renamed or normalised. The one raw "BSP" string match in the exported
sources is the variable `bSpark` (a false positive) — see (h).

## a) File manifest

| File | Bytes | Source |
| --- | --- | --- |
| matches-upcoming.html | 2,786,995 | Todays Matches - Sidebar.dc.html (full dashboard app) |
| login.html | 446,974 | Login.dc.html |
| player-profile.html | 555,743 | Player Profile.dc.html |
| stennisfy-model.html | 464,315 | Stennisfy Model.dc.html (Match model + Player ratings) |
| playing-styles.html | 405,950 | Playing Styles.dc.html |
| news.html | 409,853 | News.dc.html |
| account-settings.html | 358,041 | Account Settings.dc.html |
| README.md | 83,846 | verbatim, current (Known gaps + complete token-sweep set) |
| image-slot.js | 63,954 | runtime dependency for photo drop zones |
| export-report.md | this file | |

All HTML files verified non-empty and starting `<!DOCTYPE html>`; the dashboard
bundle loads with a clean console.

## b) Not found / not separate builds

These exist as STATES of a single build, not separate pages — no approximations
substituted:
- **Tournaments (Overview + Reports)** — an in-app page of the dashboard app,
  bundled inside `matches-upcoming.html`. The standalone `tournaments.html` was
  **deliberately removed and is not coming back**; do not re-flag its absence. Any
  Tournaments reference in this report points at `matches-upcoming.html`.
- **OTP / Verify** — the second state of `login.html`.
- **Completed Matches** — the second view of the Upcoming/Completed control inside
  the dashboard app.
- **Players** and **Player Profile (in-app)** — nav states of the dashboard app
  (`player-profile.html` is the same component bundled standalone).
- **Match Analysis modal** — opens from match rows inside the dashboard app; all
  TEN tabs present (Key factors · Playing style · Form · H2H · Match Stats ·
  Progression · Overview · Tournament · Weather · Odds; the former Extra stats tab
  no longer exists in the build and is absent from the bundle).

## c) Imports resolved

- The bundler resolved and embedded all `dc-import` references (40 manifest
  entries in the dashboard bundle), including the shared match-detail component
  `Match Detail.dc.html` and the `Form Match Row` / `Style Match Row` child DCs
  introduced by the component refactor. Embedded files are compressed blobs inside
  each HTML file — self-contained but not plain-text readable in the compiled
  output; text-level auditing should read the source `.dc.html` files.
- `x-import`: the only x-imported file is `image-slot.js`, shipped alongside the
  bundles (the bundler does not follow x-import; the file must travel with the
  HTML). No unresolved imports; the only external dependency is Google Fonts.

## d) Expanded duplicates

None created. Collapsed content in this build is conditionally rendered by the
runtime (not hidden via CSS), so a static "-expanded" copy is not producible
without freezing the interactive build into a different artifact. The full markup
for every panel exists in the bundled templates and renders on interaction.

## e) Segmented controls / tab rows / pill groups

Standard treatment (README "Segmented controls"): active `rgba(91,155,255,0.22)`
fill, `1px solid rgba(91,155,255,0.45)`, `#e7e9ee` weight 700; inactive
transparent/borderless `#5b6880` weight 600; container `#0a0d13` on
`rgba(255,255,255,0.09)`. On this standard:
- Upcoming / Completed (dashboard header) — matches-upcoming.html
- Match Analysis: Overview tier filter; the shared match-detail component's
  Summary · Stats · Point by point + Match/Set scope (7 mount points); the Match
  Stats tab's view + scope controls — matches-upcoming.html
- Player Profile: splits-table tabs ×2; match-panel Summary/Stats/Point-by-point +
  set scopes — player-profile.html
- Tournaments: View toggle, Compare-at-round chips, tournament chips —
  matches-upcoming.html (in-app page; standalone `tournaments.html` intentionally removed)
- Stennisfy Model: Match model / Player ratings; Scope; filter presets —
  stennisfy-model.html

Deliberate exceptions (documented in README): Player-ratings surface tabs take
their surface colour when active; News category pills and quick chips follow the
chip pattern; the modal's left tab rail uses `rgba(91,155,255,0.12)` borderless
fill with `#fff` text (recorded deviation).

## f) Colour census

206 distinct literal colour values (`#c98bde` removed from the build this cut; the full off-token audit lives in README "Token-sweep set") across the exported sources (counts are source
occurrences). Top values: `#5b6880` ×520 · `#e7e9ee` ×417 · `#4b5672` ×263 ·
`rgba(255,255,255,0.09)` ×219 · `#0a0d14` ×178 · `#5b9bff` ×159 · `#6aaeff` ×105 ·
`#e0616f` ×77 · `rgba(255,255,255,0.04)` ×58 · `rgba(91,155,255,0.22)` ×56 ·
`rgba(255,255,255,0.07)` ×54 · `rgba(91,155,255,0.35)` ×52 · `#0a0d13` ×51 ·
`rgba(255,255,255,0.06)` ×49 · `#3dd68c` ×48 · `rgba(255,255,255,0.15)` ×43 ·
`rgba(255,255,255,0.08)` ×39 · `#fff` ×36 · `rgba(255,255,255,0.05)` ×33 ·
`#06070a` ×32 · `#e8a84e` ×30 · `rgba(91,155,255,0.45)` ×28. Long tail of ~180
values each ≤18 occurrences, exported verbatim without correction — the off-token
members are gathered in README "Known gaps at handoff → Token-sweep set".

Runtime-composed colours (cannot be read as literals): the `hexA(hex, alpha)`
helpers in matches-upcoming (Tournaments included, as an in-app page) and `rgba(hex, a)` in stennisfy-model
build rgba() strings from literal hex inputs in the same files. Reported, not
altered.

## g) Authored constants displayed as data

Fully enumerated with locations in README "Known gaps at handoff". Highlights:
Playing Styles' entire matrix; Player Profile's SURFSTATS/records/thresholds;
the dashboard's TOURS/COURT registries and PROF map; the modal's Progression
`defs` + summary figures, `DIMS`/`MR` duplicate matrices, the 57%/3,100
style-edge figures, Key factors' soft-book price multipliers behind the no-vig
verdicts; Stennisfy Model's timestamps and thresholds. Additionally: every
point-by-point sequence and all MATCH TIME durations are seeded/deterministic
placeholders (TODO-marked) that must be REMOVED, not extended, when real data
lands.

## h) Remaining BSP references

Zero rendered occurrences in any exported file. The single raw string match is
the JavaScript variable `bSpark` in matches-upcoming.html (Odds tab sparkline) —
a false positive. BSP survives only outside the export scope: the source folder
name, archived backups, the mobile prototype, Login-options exploration, the
Funnel wordmark, handoff docs and `BSP Consult - Redesign.dc.html` — deliberately
kept, unrenamed.

## i) Not exportable as requested

1. **Region comments** (`<!-- TAB: … -->`) cannot be injected into the compiled
   files (compressed bundler output; hand-editing corrupts it), and editing build
   sources was out of bounds for an export-only pass. The modal's tab labels are
   enumerable in source (`const TABS`).
2. **Interactive states as static CSS**: this build styles active/expanded states
   from component logic (inline styles driven by state) by architecture. Real CSS
   rules that do exist: `.plink:hover`, `.nav:hover`, `.row:hover`, `.pcard:hover`,
   `.oddlink:hover`, `.sigtoggle:hover`, `.newsrow:hover .newscaret`,
   `.elotip:hover`, `.mcard:focus-visible`, plus per-element `style-hover`
   compilations. Every active-state literal is readable in the source files and
   itemised in (e).
3. **CSS custom properties**: the build intentionally uses literals at point of
   use rather than `var()` tokens; no `:root` block exists, so none was added.
   The README's token table maps names to the literal values.
