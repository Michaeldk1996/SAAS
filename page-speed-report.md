# Page speed — how fast each Stennisfy page appears (7 Nov 2026)

Goal (founder): the fastest site possible with the best user experience, with nothing visible changed.

## How it was measured

- **Harness** (`~/.paperclip-pagespeed/`, outside the repo): a local stand-in for GitHub Pages. Code = a
  `tools/site-code.sh` build of the commit under test; data = one frozen copy of the deployed site's files (96 files,
  39 MB, read 7 Nov ~01:00Z), so before and after see the same bytes. gzip level 6 and `max-age=600` like Pages. The
  only page change is the sign-in redirect call, removed for every build alike (the live site is sign-in gated).
- **Browser**: headless Chrome, `--hide-scrollbars`, cold cache (cache disabled) every run, Europe/Brussels.
  - *Desktop*: 1512 × 1100, no throttling.
  - *Mobile 4G*: 412 × 915, Lighthouse's mobile profile — 150 ms RTT, 1.6 Mbps down, 750 kbps up, CPU 4× slower.
- **Readings**: first contentful paint (FCP), DOMContentLoaded (DCL), and **Matches usable** = the first match card on
  screen. For every other rail page: time from the rail click to the page's text settling with no "Loading".
- **Limits, said plainly**: the local server speaks HTTP/1.1 (Pages speaks HTTP/2, which can prioritise), and Google
  Fonts, Google Analytics and Firebase come from the internet over this Mac's link, which varies a lot (the fonts CSS
  took 0.03–4.5 s in the desktop runs). Supabase is not configured locally, so the Live page shows its empty state and
  Odds card state comes from `odds-card-state.json` instead of the database. Desktop runs share the Mac with other
  sessions, so desktop figures are noisy; before/after are therefore run **interleaved** (A, B, A, B …).

## Baseline (code `09aee1a6d`, the live code on 7 Nov)

`index.html` = 2,765,306 bytes raw, **853 KB gzipped**:

| Part | Raw | Gzipped | Share (raw) |
|---|---:|---:|---:|
| Inline JavaScript (12 blocks) | 2,344,358 | 754 KB | 85 % |
| — the main page script (one block) | 1,962,074 | | 71 % |
| — Database page script | 263,628 | | 10 % |
| — Live page renderer | 69,045 | | 2.5 % |
| — Entry lists | 38,043 | | 1.4 % |
| Inline CSS (11 blocks) | 374,540 | 80 KB | 14 % |
| HTML markup | 46,408 | | 2 % |

Besides the HTML, the page asks for 33 script files and 5 stylesheets before DOMContentLoaded (~460 KB gzipped, of
which `player-profile-v2.js` is 233 KB and loads synchronously).

| Default page (Matches) | Desktop (n=5), median (range) | Mobile 4G (n=3), median (range) |
|---|---:|---:|
| First contentful paint | 2,032 ms (1,080–5,136) | 1,264 ms (1,128–1,432) |
| HTML fully downloaded | 514 ms (98–1,560) | 7,745 ms (7,733–7,927) |
| DOMContentLoaded | 2,282 ms (1,149–5,195) | 20,888 ms (20,703–21,200) |
| **Matches usable** | **2,785 ms (1,358–5,542)** | **20,684 ms (20,502–20,932)** |
| Bytes downloaded before Matches usable | 4.5 MB | 4.7 MB |

Other pages, opened from the rail after the board is up (median ms; desktop n=5, mobile n=3): Trading Report 93 / 255,
Dropping Odds 2,388 / 436 (its feed is outside the harness), Series 111 / 94, Players 55 / 68, Head to Head 82 / 120,
Tournaments 103 / 154, Database 107 / 1,224, Stennisfy Model 77 / 166, Playing Styles 60 / 64, News 67 / 2,916,
Picks 56 / 64, Bet Tracker 61 / 73. Live: no reading (no feed in the harness). Once the page has loaded, every other
page opens in well under a second on desktop: **the cost is the first load**.

### What holds the board on mobile 4G (waterfall, last baseline run)

| ms from navigation | What |
|---|---|
| 0 → 7,731 | `index.html` (833 KB on the wire) |
| 186 → 1,337 | Google Fonts CSS (third party; blocks rendering **and** the page's inline scripts until it arrives) |
| 5,938 → 16,276 | `matches.json` (369 KB) — 10.3 s, because it shares the link with… |
| 5,952 → 23,795 | …11 "heavy" datasets started by an idle callback at the same moment: `player-profiles.json` 1,163 KB, `tournament-profiles.json` 403 KB, `surface-ratings.json` 268 KB, `holdbreak.json` 260 KB, Elo, styles, index files (~2.3 MB) |
| 6,901 → 20,646 | 25 page scripts for other pages (~460 KB, `player-profile-v2.js` 233 KB) |
| 16,420 → 20,302 | `model-output.json` → photo index → `odds-card-state.json`, one after the other (each waits for the previous) |
| 20,684 | first match card |

## Levers, ranked by expected gain on mobile (where the page is slowest)

1. **Start the heavy datasets after the first board paint** (≈ 2.3 MB off the critical path). The code's own comment
   says they must not compete with first paint, but `requestIdleCallback` fires while `matches.json` is still
   downloading because the main thread is idle during a fetch. — *Step A.*
2. **Start the board's own files at the top of the page** (`matches.json`, `model-output.json`, photo index), in
   parallel, instead of one after the other once the 2 MB inline script has run. — *Step B.*
3. **Load scripts for other pages after the board** (`player-profile-v2.js` 233 KB synchronous, plus ~230 KB of
   deferred page scripts that still run before DOMContentLoaded).
4. **Self-host the two fonts** (same OFL files, same `font-display: block`): removes two third-party connections and
   a render- and script-blocking third-party stylesheet.
5. **Move other pages' inline code out of `index.html`** (Database script 264 KB, Live 69 KB, Entry lists 38 KB, and
   the non-Matches parts of the 1.96 MB main script), loaded when the page or modal opens. Largest byte cut, largest
   risk: hundreds of tests read functions out of `bsp-consult-dashboard.html` by name, so this needs a build-time
   split that keeps the source file whole.
6. The 1.29 MB `player-profiles.json` itself — being removed by the profiles-split session (Stage 6 slice 3).

## Steps

### Step A — heavy datasets after the first board paint (`31c422a8e` on main)

Render probe (every rail page; Match analysis modal, all 12 tabs, on one upcoming and one completed match; two player
profiles; frozen clock, outside network blocked): **9,864 text nodes and tooltips, 10,855 digits, 0 differing**.
Controls: two runs of the same build differ in 0 nodes (determinism); a planted mutation (the Move % formula scaled)
is caught (`+16.9%` → `+18.6%`).

Timings, interleaved before (A) / after (B) on the same frozen data, medians (range):

| | Mobile 4G before (n=3) | Mobile 4G after (n=3) | Desktop before (n=5) | Desktop after (n=5) |
|---|---:|---:|---:|---:|
| First contentful paint | 2,136 (1,276–2,808) | 1,328 (988–1,944) | 1,216 (1,008–2,480) | 1,164 (936–2,520) |
| DOMContentLoaded | 21,912 (21,581–22,165) | 11,757 (11,717–12,044) | 1,260 (1,079–2,525) | 1,201 (984–2,547) |
| **Matches usable** | **21,227 (21,139–21,770)** | **13,759 (13,634–14,120)** | **1,668 (1,375–2,696)** | **1,407 (1,203–2,751)** |
| Bytes before Matches usable | 4.7 MB | 2.6 MB | 4.7 MB | 2.4 MB |

Mobile: the board is usable 7.5 s sooner (−35 %). FCP is unchanged within noise (paint of the rail does not wait for
data); the before FCP median here (2.1 s) differs from the baseline table's 1.3 s run-to-run, which is why only the
interleaved comparison is used for before/after.

### Step B — the board's three data files start at the top of the page

`matches.json`, `model-output.json` and the photo index are requested by a small inline script right after
`tokens.css`, in parallel, instead of one after the other once the 2 MB page script has run; each loader takes its early
answer once. Also a `preconnect` to `fonts.gstatic.com`.

Render probe against step A (same harness): **9,864 text nodes, 10,855 digits, 0 differing**.

Timings, interleaved step A (before) / step B (after), medians (range):

| | Mobile 4G before (n=3) | Mobile 4G after (n=3) | Desktop before (n=5) | Desktop after (n=5) |
|---|---:|---:|---:|---:|
| First contentful paint | 1,228 (1,188–1,244) | 1,268 (1,244–1,292) | 1,168 (1,100–1,192) | 1,164 (1,116–1,196) |
| **Matches usable** | **13,516 (13,426–13,522)** | **10,761 (10,728–11,011)** | **1,394 (1,334–1,414)** | **1,416 (1,309–1,474)** |
| Bytes before Matches usable | 2.6 MB | 2.2 MB | 2.6 MB | 2.6 MB |

Mobile: the board is usable 2.8 s sooner (−20 %). Desktop: no change beyond noise (on a fast link the files arrive
before the page script needs them either way).

## Overall, code `09aee1a6d` → step A + B

| Matches usable | Before | After |
|---|---:|---:|
| Mobile 4G | 21,227 ms (n=3) | 10,761 ms (n=3) — **about half** |
| Desktop | 1,668 ms (n=5) | 1,416 ms (n=5) |

First contentful paint was already early (the rail paints before any data) and is unchanged within noise.
Levers 3–5 (other pages' scripts after the board, self-hosted fonts, moving other pages' inline code out of
`index.html`) are not built yet; they cut the 853 KB HTML and ~460 KB of scripts that now bound the mobile board.

# Part 2 — levers 3–5, re-ranked after steps A and B (7 Nov 2026)

### After step B: what held the mobile board (waterfall, code after A + B)

| ms | What |
|---|---|
| 0 → 9,450 | `index.html` (836 KB gzipped): the 1.9 MB page script runs only once all of it has arrived |
| 590 → 6,640 | `matches.json` (369 KB), sharing the link with the page, Google Analytics' tag (160 KB), Firebase (150 KB), fonts |
| 8,220 → 10,690 | the card state (112 KB), requested only after the page script ran, competing with 20 page scripts and boot data |
| 11,030 | first match card |

Levers re-ranked by measured gain (each built and timed before landing, interleaved, frozen data):

| Step | What | Mobile 4G board (n=3) | Desktop (n=5) |
|---|---|---:|---:|
| D | `index.html` ships its inline JavaScript without comments and indentation | 10.8 → 9.7 s | no change beyond noise |
| C | the card state starts at the top of the page | 9.9 → 7.8 s | 595 → 512 ms |
| G | Google Analytics' tag loads after the page's load event | 7.6 → 6.8 s | no change beyond noise |
| F | the two fonts served from our own site | board unchanged; first paint 1.49 → 1.03 s | first paint 1.20 → 0.15 s, board 1.36 → 0.33 s |
| (3) | other pages' scripts after the board | **not built**: after C they already start after the first card | — |
| (5) | moving other pages' code out of the 1.9 MB page script | **not built**: see below | — |

### Step D — `index.html` without comments and indentation (`157c1672b`, live)

`tools/slim-code.mjs`, run by `tools/publish-site.mjs` on the published `index.html` only: every comment goes and every
run of whitespace between two tokens becomes one newline (if it held a line break, so automatic semicolon insertion
reads the code exactly as before) or one space. Tokens are copied byte for byte. **Proof per script, fail-closed**: the
slimmed script must parse to the same syntax tree as the source (Node's own acorn), or the source ships.
`bsp-consult-dashboard.html` stays the full source copy on the site; the repo file is untouched (every test reads it).
Test: `tools/test-slim-code.mjs` (real dashboard 13 of 13 scripts proven; mutants: a slimmer that drops line breaks is
stopped by the proof, and without the proof it would ship a different program).

- Size: 2,760,063 → 1,890,422 bytes, **835 KB → 497 KB gzipped**. Live read-back: `index.html` 507 KB gzipped (with the
  injected config), 0 comment lines; the 13 live inline scripts parse to the same trees as the live full copy.
- Render probe: 0 of 9,864 text nodes differing; control (Move % formula changed) caught (`+16.9%` → `+14.4%`).
- Timings (before = code after A + B): mobile board 10,797 (10,706–12,118) → **9,741 (9,733–9,993)** ms; desktop
  1,265 → 1,286 ms (noise). Mobile FCP moved with the Google Fonts stylesheet's latency, not with this step.

### Step C — the card state starts at the top of the page (`aea3ada98`, live)

The `<head>` early-fetch block (step B) also starts the card-state read: the database doc where the publish injected
the public config (the exact request `ocsFetchDb` makes), else `odds-card-state.json`. `ocsFetchDb` / `ocsFetchFile`
take that answer once through `sfEarlyFetch`; the 30-minute freshness rule that decides whether the file is read too is
unchanged. The harness has no database, so it measures the file path; on the live site the same change starts the
database read.

- Render probe vs D: 0 of 9,864 differing. Control: +1 on every card-state price is caught on every card and its hover
  (`bet105 · 1.48 since …` → `2.48`). (Removing the card state outright changes no text here: the board falls back to
  `matches.json`, which carries the same prices on this data — so the control changes the prices instead.)
- Timings (before = D): mobile board 9,927 (9,766–10,636) → **7,783 (7,614–9,298)** ms; desktop 595 → 512 ms.

### Step F — the fonts served from our own site (`b46e62969`)

`assets/fonts/`: the 24 woff2 files exactly as Google Fonts serves them (Hanken Grotesk 400–800, IBM Plex Mono 400–700 —
Plex Mono has no 800, the browser synthesises it as before; subsets latin, latin-ext, vietnamese, cyrillic,
cyrillic-ext) + both OFL licences. Google's own `@font-face` rules inline in `<head>` (same unicode-ranges,
`font-display: block`), the Hanken latin file preloaded; the Google preconnects and stylesheet are gone. Test:
`tools/test-self-hosted-fonts.js` (controls: a missing file, a `swap` face, a Google link put back).

- The Google stylesheet blocked both first paint and every inline script until it arrived; from this Mac it took
  0.03–4.5 s. Desktop (before = G): FCP 1,196 → **148** ms, LCP 1,692 → **204** ms, board 1,363 → **333** ms.
  Mobile: FCP 1,492 → 1,032 ms, board unchanged (6,813 → 6,758 ms).
- Render probe: 0 of 9,864 differing. Font check: the same 8 faces load, 0 requests to Google, all 222 text elements of
  the board, rail and header keep the same family, weight and width (control: an empty Hanken latin file → 4 faces,
  62 elements differ).

### Step G — Google Analytics after the load event

`analytics.js` appends the 160 KB `gtag.js` tag after the page's load event (at once if the page has already loaded).
The `dataLayer` shim, `config` and every `teTrack` call are queued as before and replayed by `gtag.js`, so no event is
lost; a visitor who leaves before the load event is not counted. Test: `tools/test-analytics-after-load.js` (the
pre-change loader fails it).

- Render probe: 0 of 9,864 differing. Timings (before = C): mobile board 7,616 (7,524–8,106) → **6,781
  (6,763–6,817)** ms; desktop no change beyond noise.

## Overall: live code after A + B → after D, C, F, G (interleaved, n=3 mobile / n=5 desktop)

| | Before | After |
|---|---:|---:|
| Mobile 4G — Matches usable | 10,739 ms | **6,732 ms** |
| Mobile 4G — FCP | 924 ms | 1,032 ms |
| Desktop — Matches usable | 389 ms | **312 ms** |
| Desktop — LCP | 996 ms | **180 ms** |
| `index.html` gzipped | 835 KB | 499 KB |

Since the start of the day (code `09aee1a6d`): mobile board **21.2 s → 6.7 s**. The desktop "before" here had a fast
Google Fonts answer (FCP 200 ms); on a slow one (step F's batch) the gain is ~1 s. Mobile FCP: this batch's Google
answer was fast, so the self-hosted preload sharing the local HTTP/1.1 link costs ~0.1 s; Pages speaks HTTP/2.

## Not built, with reasons

- **Lever 3 (other pages' scripts after the board):** after step C those scripts start downloading after the first card
  is already on screen, so delaying them buys nothing on the board.
- **Lever 5 (other pages' code out of the page script):** the slimmed page script is still most of `index.html`, and
  the board's code is spread through it; a safe split needs a dependency map of which functions the board reaches —
  a build step of its own, with its own proof. The remaining mobile time is now the page itself (~500 KB) and
  `matches.json` (369 KB) arriving together; Firebase (150 KB, needed for sign-in) shares the link.
