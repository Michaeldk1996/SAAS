# Picks — design handoff (2026-10-27, night only) — LOCKED 2026-10-27

**Package contents (hand the whole folder to Claude Code):**
- `PROMPT_CLAUDE_CODE.md` — the build brief: inputs, scope, do-not-build list, hard rules, acceptance.
- `SPEC.md` — the full pixel spec read from the locked file (tokens, every component and state, every px / colour / weight / copy string, computations).
- `reference/Picks LOCKED 2026-10-27.dc.html` (+ `support.js`, `assets/`) — the design itself, opens in a browser; boards 1a–1k are the product, everything `void`-ed in the logic class is a rejected exploration.
- `demo-data.json` — Today, Sun 26 settled and the slate in `picks.json` shape.
- `tokens.json` / `tokens.css` — shared OFFICIAL VERSION 1 shell tokens.
- this README — data model + behaviour rulings.

Frozen copy: `Picks LOCKED 2026-10-27.dc.html` (project root; mirrored in `reference/`). Later notes in this file that contradict the lock summary in `CLAUDE.md` are superseded by it (one bets box, settled trail Open → Posted → Close, Today's Matches score block on settled cards, drawer = search + typed market / line / book / price (MANUAL) / stake, Outright mode, no Context block, note ≤ 2,000).

Reference: `Picks.dc.html` (project root). Shell and tokens = OFFICIAL VERSION 1 (`design_handoff_todays_matches_v2/tokens.json`). Boards: 1a Today with picks · 1b Today empty · 1c Settled day · 1d non-Pro · 1e Record view · 1f Post-a-pick drawer (new) · 1g drawer posted/editable · 1h drawer frozen · 1i card lifecycle · 1j mobile 390 card · 1k small things. Tweaks: screen (Mac 1512 / Review 1440), Pro member, Admin.

Principle: nothing a member sees is typed except the pick itself, the stake and the note. Every other figure is derived from prices the pipeline already records, or a dash.

## picks.json — one row per pick

| field | type | source | notes |
|---|---|---|---|
| id | string | server | stable key |
| kind | match · outright | Michael | outright rows (tournament winners, Race / year-end qualification and other long-term lines) have no `player_b`, no `round`, no `scheduled_at`; `event` + `settles_at` instead; CLV stays a dash (no Pinnacle close) until a closing-line rule is agreed |
| event | string \| null | Michael (select) | e.g. "Nitto ATP Finals · Turin", "ATP Race · year-end" |
| market_text | string \| null | Michael (select) | outright only: "To win the tournament", "To qualify for the Nitto ATP Finals" |
| settles_at | ISO date \| null | event calendar | footer "settles 16 Nov" |
| date | ISO date | server | match day (local, Europe/Brussels) |
| tournament | string | slate (canonical name) | as on Today's Matches |
| round | string | slate (`cardRound`) | R32 · R16 · QF … |
| scheduled_at | ISO datetime | slate | card time |
| surface | Hard · Clay · Grass | slate | header colour |
| player_a | { id, name, initials } | slate | card order = slate order |
| player_b | { id, name, initials } | slate | |
| selection | `a` \| `b` | Michael (click) | accent bar + name weight |
| market | Match winner · Games handicap · Total games | Michael (segment) | |
| line | string \| null | Kibl current line at post | `+2.5`, `Over 22.5`; null for Match winner; never typed |
| open_price | number \| null | bet105 first sighting | trail OPEN |
| posted_price | number | bet105 at post | trail POSTED; locked forever |
| posted_at | ISO datetime | server | chip "POSTED 09:41"; starts the 10-min edit window |
| now_price | number \| null | bet105 live | trail NOW; freezes at match start → label "Last" |
| opp_now_price | number \| null | bet105 live, other side | FAV badge |
| close_price | number \| null | Pinnacle close (bet365 where ruled) | trail CLOSE; null until live → dash |
| opp_close_price | number \| null | Pinnacle close, other side | needed for margin removal |
| stake | 0.5 · 1 · 1.5 · 2 · 3 (% of bankroll) | Michael (chip) | editable 10 min; the site speaks in %, never units |
| note | string ≤ 2,000 | Michael | editable 10 min; the drawer counter reads `n / 2,000`, amber past 1,900 |
| model_pct | number \| null | Stennisfy model, picked side | blurred for non-Pro; dash if no run |
| status | draft · posted · live · won · lost · void | server | draft = Michael only, never counted |
| void_reason | string \| null | Michael | required when voiding |
| result | { sets: [{a, b, tb?, tb_side?}], retired?: bool } \| null | results feed | set cells; void rule = retirement before set 1 completes |
| clv | number \| null | **computed** | `posted × fair(close, opp_close) − 1`, fair = (1/close)/((1/close)+(1/opp_close)) |
| pl_pct | number \| null | **computed** | profit in % of bankroll: won → stake × (posted − 1) · lost → −stake · void → 0 |
| edited_at / frozen_at | ISO datetime | server | frozen_at = posted_at + 10 min |

`clv` and `units` are stored for the ledger but must be recomputed from the price fields on write — never accepted from a client.

## Analysis (note)
The note is not shown on the card by default. The footer carries "Read the analysis ▾" beside "Open match →"; opening drops the full text (paragraphs, 13px) in above the footer. Notes are 6–10 sentences typically — limit is 2,000 chars (raised from 280 on 2026-10-27). Stennisfy on the card = fair odds (1 ÷ model chance), not a %.

## Bets box (above the cards, full width)
One box: the day's bets (Type · Bet with "posted hh:mm · tournament" under · Price · Stake; settled days add a caps head row and a WON / LOST / VOID chip). User ruling 2026-10-27: **no second box** — the four candidates (Record box · Market since posting · Model edge · Yesterday settled) were tried and dropped; the Market box below stays in the reference code switched off (`withMkt`), not to be built. Outright cards: meta line = "Settles 16 Nov · no open / now / close for outrights" and nothing more (no CLV wording).

For reference only — Market since posting (not built): one row per *match* bet — bet line, "tournament round · posted hh:mm", `posted_price → now_price` with a 2px segment coloured by the trail rule, signed move `now / posted − 1` in the last lane (same colour). Head meta = "{shortened} of {n} shortened" (shortened = now < posted; hover title gives the denominator). Outrights have no trail and are left out; if the day has only outrights the right box is not rendered and the bets box takes the full width. Non-Pro: line, prices and move blurred like the bets box; sub line readable.
On Completed days the same box is **Market at close**: caps heads Bet · Posted → Close · CLV, rows `posted → close_price` (Pinnacle, bet365 where ruled) and `clv`; head meta "{beat} of {with close} beat the close" (beat = clv > 0; rows without close / opp_close excluded from both counts, dash in the row); "No close yet" when none has one. Never %-of-field figures without the count.

## Trail colour rule
Settled cards (won · lost · void) show three stops only: OPEN → POSTED → CLOSE (no "Last"; Close carries the big weight, coloured posted → close). Posted / live cards show OPEN → POSTED → NOW (label "Last" once the match starts) → CLOSE.
OPEN → POSTED neutral (14% white). POSTED → NOW and NOW → CLOSE: green `#5CCB84` when the later price is lower (moved in the pick's favour), red `#E06266` when higher, 28% white when unchanged, 14% when either end is missing.

## Record strip / Record view
Settled rows only (won · lost · void). Record W–L, Profit Σ pl_pct, ROI = profit ÷ Σ stake, Avg CLV over rows with a close. Under 20 settled in the period → dashes + `n=N · thin` (amber). Periods 30 d · 90 d · Season. Ledger columns: date · match · pick · posted · close · CLV · result · P/L; sortable; export later.

## Gating
Non-Pro: today's `posted` / `live` cards blur the whole player block, trail, meta line and note (`filter: blur(5px); user-select: none`); header and state chip stay readable; footer shows PRO chip + "Unlock today's picks →". Settled cards from past days are never blurred. The Bets today tile rows use the same blurred span. Empty day: panel reads only "No bets posted yet today"; no upsell.

## Admin
Role `admin` only: "+ Pick" on every Upcoming match card footer and in the analysis modal header → right drawer (440px) pre-filled. Price read-only (bet105 live + stamp + refresh). Lines from Kibl. Context block read-only. Post pick / Save as draft. Edit ≤ 10 min (note, stake), void with reason; then frozen. Admin badge (shield) on the avatar; "new pick" dot on the Picks nav icon per member since last visit.

## Demo data
All players, prices, results and the 112-row ledger in the reference are demo (seeded). Headshots: the site rule is initials avatars; swap for ATP headshots only if the asset pipeline exists.

## Open / handoff
Bets settled tile (reuses the Record strip) · ledger export · picks nav position (Analyse group, after Matches) · drafts list for Michael.
