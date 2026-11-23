# Match analysis → News tab (design LOCKED 2026-11-21; rebuilt 2026-11-23)

Applies to the modal's News tab: `maNewsV2` and the `ma2News*` handlers in `match-analysis-v2.js`, the loader in
`bsp-consult-dashboard.html` (`ensureNewsData` + `loadNewsTicker`, `buildNewsSection` → `maNewsV2`). Design =
`design_handoff_match_analysis_2026-11-23` → News tab (`analysis.isNews`, `newsFor`), locked by the founder 2026-11-21.
`modal-analysis.md` wins over this file where they conflict.

## Data
- **The News page's own items, scoped to the two players** (founder 2026-11-21: "updated based on our last news page"):
  `newsWireItems()` (outlet articles of `news-feed.json`, player-attributed only) + `newsTickerItems()` (our match reports
  and the quote cards), kept when a player key equals `m.p1Key` or `m.p2Key`. **Test:** an item keyed to another player
  never shows; a match report of the two players shows once, under both tiles' counts.
- **Rolling 5 days** (`A_NEWS_WINDOW_DAYS` = the builder's window): nothing older shows. **Tour News is not shown** (design:
  only Match Reports, Quotes, Withdrawals & Injuries). One story, one line: two outlet headlines whose first five words
  match are one story, the newest kept (`aNewsStoryKey`, TEN-380).
- **No time on an outlet article** (news.md "No time on an article": the feed's batch stamp is not the outlet's time): its
  time column is empty and its hover reads "Added to feed …"; our own reports and quotes show their real time ("3h ago").

## N9 — no sample, ever
- No sample articles; no feed and no item → "News feed unavailable." + "Last checked HH:MM:SS"; no item → "No recent news
  for {A} or {B}." (one player under a player filter, Q20) + "Only articles about the two players of this match are shown
  here."; an empty category → "No {category} articles for {who}." + "Pick another category."

## Display (the design)
- Two player tiles (36px avatar, name, "n articles · latest …", the red "Injury note" tag or grey "No injury news"); a
  tile click shows only that player, a second click both (22% edge on the picked tile). Category switch with counts
  (All · Match Reports · Quotes · Withdrawals & Injuries) | Reading · Compact; **Compact by default** on every open.
- Day label "21 Nov 2026" 12.5/700 + grey count + hairline. Compact row `170px 1fr 140px 54px 8px` (under a 640px feed:
  `42px 1fr auto 50px 8px`, the name hidden); one row open at a time (card tone + 12% inset ring); a match report opens with
  its stats box (fixed row order `NEWS_MS_ORDER`, leader white, lead bar blue, the difference chip). Reading cards = the
  News page's parts (quotes: topic over text, 3 shown; text: 18/800 headline + paragraphs, "Read more" after 5).
- Colours: tokens only; the injury tag `--ma2-red` on a 12% wash (the Lost serve tag), "Won" `--news-green`.
- **Test:** at 1440 the tiles are 71 tall, the track sits at 83, the first day label at 141, a Compact row is 55 tall.
