# Today's Matches (Upcoming + Completed) — founder TEN-377, 2026-10-03

Package: `design_handoff_todays_matches/README.md` on TEN-377 + `OFFICIAL VERSION 1.html` → Matches. The reference wins
except where a ruling below says otherwise. Colours are foundation tokens (`foundation.md`). Tests: `test-ten377-todays-matches.mjs`.

- **Header card:** four stats right — Upcoming `Matches · Tournaments · Books · Updated`, Completed `Settled · Tournaments ·
  Upsets · Updated`; labels Hanken 10.5 caps (override of the reference's mono 9.5), values Plex Mono 17/700. Matches/Settled =
  cards rendered; Books = distinct bookmakers priced on them (card book + Now + Open books, one per `mxBookLabel`); Upsets =
  the Upsets-tile rule (`mcUpsetRows`); Updated = newest odds observation, HH:MM. The status line keeps ruling A and the
  `Times in …` line stays.
- **Upcoming card:** both names `--text` (FAV badge carries the favourite); both form bars `--viz-lead`; surfaces neutral;
  head/foot hairlines and the column divider are white 3.5% (founder Q1, reference). Market Signal drawer = `--card` on a
  `--edge-6` rule, fav % white, bars `--viz-lead` + `--viz-second`.
- **Completed card:** inset tiles (winner white 3.5% + 3px `--pos` 90% pill; loser name `--text-label` 600, never red).
  Surface `--text-soft`; round chip `--inner` + 10% inset edge, white (Q1). Score = sets-won tile (winner white 9% + 10% inset
  edge, white; loser white 4.5%, grey, no edge — Q1, README 7a) · 1px divider · one 24px cell per played set (won white 8% /
  lost 2.5%, one style always), each side's own tie-break points in the corner. Prices = `Open → Close · Move` on a
  38/14/42/44 grid; no journey bar; no Move for an older close (TEN-253), a vendor-pinned open or a missing leg; missing leg
  = "—"; a 0% move reads `0%`. Footer and drawer rules 6% (Q1); drawer = one flat list, book names `--text-soft`, no
  liquidity; "See full analysis" 600. The "Showing … settled" context bar is removed.
- **Card grid:** `align-items:stretch` stays (TEN-270 equal-height ruling) — README §1 says `start`; raised to the founder.
