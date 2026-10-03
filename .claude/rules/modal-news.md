# Match analysis → News tab (TEN-333, TEN-312 tab ticket; founder rulings 2026-09-28)

Applies to the modal's News tab (`buildNewsSection` and the `aNews*` helpers in `bsp-consult-dashboard.html`), built on
`Match Analysis Progression v1.dc.html` `newsFor` (DF L2317–2400) + template (DF L2202–2248). `modal-analysis.md` wins
over this file where they conflict.

## Data
- **One source: `news-feed.json`**, built by `wt/build-news-feed.js` (api-tennis `get_news`, rolling 5-day window,
  best-effort step in `pipeline.yml`, overwritten every run, never committed, no archive). The tab reads the same
  `_newsData` as the News page. **Test:** `test-ten333-news-tab.mjs` "unavailable" / "groups".
- **Rolling 5 days on the page too** (`A_NEWS_WINDOW_DAYS = 5`, = the builder's `WINDOW_DAYS`): a stale feed never shows
  an article older than 5 days as "recent". **Test:** a 6-day-old row is hidden, a 4-day-old row shows.
- **Attribution is data:** `player_key` is the join. A row without a key falls back to the News page's fail-closed
  headline resolver (`newsPlayerFor`: exactly one roster surname in the first two words). A keyed row is never
  re-attributed by its headline. **Test:** a row keyed to another player whose headline leads with this player's surname
  stays out.
- The feed carries **no event key** (0 of 101 on 28 Sep), so there is no "this match" group — per-player groups only, as
  the file draws.

## N9 — no sample, ever
- `SAMPLE_NEWS` and the design's `window.STENNISFY_NEWS` fallback are **not ported**. No feed → "News feed unavailable."
  + "Last checked HH:MM:SS." (the file's drawn branch); no article → the file's empty copy
  **"No recent news for {A} or {B}."** + **"View all news →"** (design gap G7: the common case).
  **Test:** `test-ten314-modal-frame` (deployed allowlist has no `SAMPLE_NEWS`) and `test-ten333-news-tab` "no sample".
- **Design-file bug not ported:** under a one-player filter the file still prints "…for {A} or {B}." even when the other
  player has articles. The build names the filtered player only: **"No recent news for {A}."** (founder Q20, 2026-09-30,
  extends N9). **Test:** `test-ten333-news-tab.mjs` "N9 empty state".

## Display (the file wins over the README)
- Filter = the file's segmented control (DF L2204 = the Market edge `maSeg('me')` geometry): All / A / B. It stays in the
  **unavailable** state too (founder Q19, 2026-09-30). **Test:** `test-ten333-news-tab.mjs` "Q19" (mutation: the filter
  dropped when the feed is unavailable).
- Group header = name (13.5 / 700, primary text) + count (mono 10.5, label) + hairline. **Both names are primary text**
  (D4); the old p1 periwinkle label is gone. The count's tooltip states its denominator and population
  ("n of N articles in the ATP news feed, last 5 days").
- Row = the compact wire: "Sep 8 · 07:37" (en-US short month + numeric day, en-GB 24 h, member zone `newsTz`), headline
  (one line, ellipsis), ▾. **One article open at a time** (DF `maNewsOpen`): the open row's headline wraps (1.4), the
  caret turns, the body paragraphs sit under the headline column (8 16 4 116). A row with no body text opens to its
  headline only.
- The pane is 16px / line-height normal / "Hanken Grotesk", sans-serif, like the file's content column.
- **Loading** (undrawn, `// DESIGN GAP G8`): the empty block's secondary line "Loading news…".
- Colours are foundation tokens only (TEN-376); blue text only on the "View all news →" link (`--link`); the selected tile is lifted (`--edge-24` outline), never blue.

## Verification recipe
- Structure diff: `tools/ten312-design-capture.mjs <d> --only 04-news,04b-news-article-expanded,04c-news-filter-player-a,04d-news-filter-player-b,04e-news-empty,04f-news-unavailable`
  → `tools/ten333-news-capture.mjs <b> --ref <d> --palette source` → `tools/ten312-pixel-diff.py <d> <b> <out> --regions <b>/manifest.json`
  (read the `--content` rows). Fixture feed = the design's own sample, read from the design file at run time; it never
  reaches the page source.
