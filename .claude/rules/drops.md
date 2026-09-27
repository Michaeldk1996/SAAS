# Pre-match drops page and its endpoint (TEN-294)

Founder rulings of 2026-09-26: path B′ (TEN-293 doc `refresh-speed`), the design approval, and the
answers on card 37612d3d (TEN-294 doc `design`). Suite: `test-ten294-drops.mjs`.

- **The page's data comes from the separate `stennisfy-drops` Fly app.**
  **Test:** every host the drops page fetches data from is `stennisfy-drops.fly.dev`, which is not `*.github.io`, not `kibl-stream`, and not Supabase.
  `kibl-stream/fly.toml` has no `[http_service]` and no `[[services]]` block.
  *Exception:* none. A faster path for Challenger/ITF is the Kibl "Now" worker (point 8), not a second endpoint.

- **A row is an alert the live Telegram drop bot already wrote.**
  **Test:** every row id resolves to one `ten280_bot.alerts` (Bet105) or `ten287_bot.alerts` (Superbet) row with `mode = 'live'`.
  Nothing on the page re-detects a drop. The drop rules are therefore the bots' rules: ≥5% against the price 10 min earlier, no floor, a 30-min cooldown per match (per book), ML pre-match men's singles.
  *A new book* joins when its bot writes an `alerts` table of the same shape, as one more branch in `drops_api.snapshot()`.

- **"Dropped to" and "Latest" are two fields, each with its own clock.**
  "Dropped to" is the alert's price. "Latest" is the side's latest *pre-match* price, read with the bot loader's own filters and side mapping (per alert, on indexes; calling the loader itself full-scans the Kibl tables).
  **Test:** a row's "Latest" is never labelled as, or substituted for, "Dropped to", and a missing value renders "—".

- **Match status is api-tennis's, never a vendor's `pending`** (founder comment bef04c62 + card 518c56f0, 2026-09-26; supersedes the "Started" badge). Evidence: TEN-297 doc `status-feasibility` (Superbet: 21 of 27 alerts with a live time fired after the match went live).
  **Test:** every row carries `status` ∈ `not_started | in_play | finished | unknown`, from:
  - **`liveAt`** = our 10-second live poller's first live sighting (`live_flip_log`), joined on both players — the surname (accents, hyphens and a Jr/II suffix ignored) and a shared given-name initial whenever both names carry given names ("Adolfo Daniel Vallejo" = "D. Vallejo") — a start within 24 h, and exactly one candidate; a row refused on initials gets the match through its group;
  - **in play** = on the current live board (`live_snapshot`), or went live and api-tennis `get_fixtures` by `event_key` is not terminal;
  - **finished** = api-tennis `event_status` is `Finished`, `Retired` or `Walk Over` (the status word wins over `event_live`);
  - **not started** = no live sighting and the start has not passed, or api-tennis shows it not started; **unknown** = no single api-tennis fixture, or Cancelled/Postponed (labelled, never passed off as a status).
  - **One match, one status:** rows of the same two players with starts within 24 h share the best-evidenced status (a live sighting beats a schedule), so one match is never in two views.
  - api-tennis is asked in UTC (`timezone=UTC`; its default zone moves with daylight saving); by-day lists (the start's day, plus a neighbour within 6 h of midnight) are fetched one day per call in the background; a fixture joined from a list is re-asked by `event_key` until terminal; empty or failed answers are cached 10 min.
  - Repeat alerts of one selection × book share its latest pre-cut price.
- **Three views: Upcoming · In play · Completed** (card 518c56f0 Q1 = b). **Test:** a row is in exactly one view: Upcoming = `not_started` or `unknown` (badged "Status unknown"), In play = `in_play`, Completed = `finished`. A match leaves Upcoming the moment it goes live.
- **A row's prices stop at the live start** (Q2 = a). **Test:** "now" on an In-play or Completed row, every chart and every strip cell use only prices recorded before `liveAt`; "now" is labelled **"Last pre-match"**. With no `liveAt`, the cut is the scheduled start once it has passed: api-tennis's when a fixture is joined (the vendor's only when earlier by ≤ 3 h), else the vendor's; this includes **unknown** rows. The label says "cut at scheduled start". A row with no recorded price before the cut is not served. No in-play price is ever a pre-match figure; nothing is invented after the cut.
- **The endpoint holds 72 h** (Q4 = b): alerts and their lines from the last 72 h.
- **The Telegram drop bots stop at the live start too** (TEN-299, founder comment 8585095a, 2026-09-27; installed from `tools/ten299-live-cut.sql` by the drops workflow).
  **Test:** each bot's `load_ticks` removes every tick at or after its match's cut, and each bot's `scan` evaluates nothing at or after the cut. So no alert fires on a started or finished match, and every drop is measured against a pre-match price. A backtest of the last 24 h holds 0 alerts at or after a cut (`ten299_after_cut`).
  The cut is the live sighting, joined as the endpoint joins; when ambiguous, the vendor's scheduled start. A match with no sighting is not cut (the vendor start is not a live signal).
  ⚠️ The bots' branches (`ten280-probe`, `ten287-probe`) still carry the pre-TEN-299 `load_ticks`/`scan`: a re-install from them reverts this until the drops workflow runs again.

- **One database read per cadence, fanned out from memory.**
  **Test:** any number of requests on any route triggers zero database reads.
  Reads run every 30 s (the bots' tick), aligned to 3 s after the Bet105 bot's run: never less than 10 s apart and never more than 33 s.

- **Stale data is never presented as current.**
  **Test:** `generatedAt` advances only on a successful read. The page shows "Live · updated Xs ago" from `generatedAt` (data time, never the fetch time), its dot turns amber past 90 s (3× the read interval), and past 5 min — or when the endpoint cannot be reached — it switches to the disconnected state: rows dimmed, "Prices updated N min ago", and the export's banner as drawn: **FEED DISCONNECTED** · "Showing prices as of HH:MM UTC. New moves will not appear until the feed reconnects." · **Reconnect** (a refetch).
  Before the first good read, `/drops.json` answers 503, never an empty list.
  *Exception to CLAUDE.md's "no infrastructure warning" non-negotiable* (founder, card 79e9db02 Q3, 2026-09-26): this one banner, worded exactly as the export draws it. Nothing else on the page names a feed, bot or service. Source-by-source health lives in `/status.json` and the watchdog.

- **The database link is verified TLS or nothing.** The Fly app verifies the pooler against the bundled Supabase Root 2021 CA and refuses to start without it.
  **Test:** the connection URL carries no `ssl*` parameter (in node-postgres one overrides the CA silently). Failures are public only as a code, never the driver's text.

- **A stall reaches the founder by Telegram**, in the same chat as the drop alerts. The watchdog runs outside the Fly app, in pg_cron.
  **Test:** it alerts when the endpoint is unreachable 3 times in a row, when data is more than 5 min old, or when any source is past its limit. An alert counts as delivered only once confirmed *sent*.

- **Access is open while the product is in search and development** (founder, card 37612d3d).
  CORS allows exactly `https://michaeldk1996.github.io`. CORS is not access control.
  *Revisit before members:* the gate would verify the Firebase ID token on the Fly app, which needs no database read.

## The Dropping Odds page (export `design_handoff_dropping_odds`, LOCKED; founder card 79e9db02, 2026-09-26)

Mapping measured in TEN-297 doc `feed-mapping`. Page files: `drops-page.js`, `drops-page.css`; suite `test-ten294-drops.mjs`.

- **A row is one selection × bookmaker, and its drop is the export's: `(open − now) / open`.** "Open" is the feed's `open.price`, "now" its `latest.price`. Repeat alerts on the same selection at the same book collapse to one row (the newest alert). Only rows whose price has **shortened** since open are listed; a row with no `open` or no `latest` is not listed.
  **Test:** for every rendered row, the drop figure equals `(open − latest) / open × 100` to one decimal, and is > 0. The bot's `dropPct` is never the drop figure.
  The subtitle says the list is lines **flagged in the last N h** (N = the feed's `windowHours`), because only bot-alerted selections reach the feed.
- **WINDOW: "Since open" is the default and means everything the feed holds** (`windowHours`, 72 h since card 518c56f0 Q4). 12h / 24h / 48h filter on the alert's `detectedAt`; a window longer than the feed holds is shown disabled.
  **Test:** "Since open" returns every row the feed holds; a window > `windowHours` cannot be selected.
- **BOOKS Sharp/Soft comes from `odds.md`'s ruled table** (Bet105 Sharp, Superbet Soft), never guessed. A book absent from that table is listed under neither group and only under "All".
- **Markets: only Match winner is tracked.** The other four tabs show "No drops on this market" and their count is "—", never 0.
- **Missing is a dash, never a zero or a "no moves" claim.** Before the first good read the header and tab counts show "—" and the count line says "Loading moves…" while the request is in flight; with the endpoint unreachable and nothing read, the banner shows and the list is absent (never "No moves above your threshold"). On an untracked market the header and count line show "—".
- **"Starts within N" means an upcoming start within N hours**; a match past its scheduled start never passes it, and "Starting soonest" lists upcoming matches first, then passed starts.
  *Why:* Bet105 rows are never `started` (Kibl carries no live tennis on our account), so without this a match 15 h past its start read as "starting soonest" (review of 8c441ec4, measured on the live feed).
- **Surface and event are not in the feed**: the Surface control is disabled at "—", the detail line omits the event, and search matches player names only.
- **The price-move box is the LOCKED `handoff/Price Move Box/` design** (founder comment 8585095a, 2026-09-27; supersedes the 777a3192 pop-up, its strip and the bef04c62 house-blue chart). Built with the source values and the site's 12a mapping on neutrals; the colours the founder named are exact. Measured against `Dropping Odds LOCKED.dc.html` role by role (TEN-297).
  **Test (books):** the books come from, in order: a board-matched card's TEN-295 chart shard (every book on it, both sides), else the endpoint's `lines` (Bet105, Superbet, Betfair Exchange), else only the books with a drop row. Only books we record quoting the line are listed: no "No line" filler, never padded. The row's own book always reads exactly as its list row (open → now, Q1). An endpoint book not seen within 24 h (`lastSeen`) is left out.
  - **Header (price-led):** drop block "▼ x.x%" mono 30/700, `#FF7B88` at 10% or more and `#C26A75` below (the threshold reads the figure shown, one decimal), caption "DROP · moved Xm ago" (a cut row: "last pre-match HH:MM UTC"); eyebrow "MATCH WINNER · BOOK" + SHARP/SOFT chip; headline "[full name] to win"; players line "[full name] v [full name] · event · round". **No rank, no Elo, no margin, no "PRICE MOVE".** Right: open struck through → now, then the start line.
  - **Start line (data rule 28):** Upcoming "HH:MM (in Xh Ym)", In play "HH:MM (live)", Completed "HH:MM (finished)"; no start → no line.
  - **Players line (rule 29):** a segment that does not exist is left out; never "— · —". Event and round only from a board card matched as below.
  - **Chart (the Database type):** [Y labels 52px] [plot] [end label 84px], 260px; 5 Y labels; vertical ticks at 0/25/50/75/100%; line `#E0616F` 2.6px, straight segments, **no per-snapshot dots, no horizontal open line**; flat fill `rgba(224,97,111,0.10)`, no gradient. X axis: 5 evenly spaced UTC times from the first recorded price to the end of the line, the date on the first label and each day change. No caption row above the chart; "Back to [book]" right-aligned only when another book is selected.
  - **Open chip (rule 24):** "OPEN x.xx" only when our first price is the book's true opener (a Kibl opener row); otherwise "FIRST SEEN x.xx", same chip.
  - **End label (rule 25):** "Now" only when the book's price was confirmed within 15 min (`lastSeen`), the line carried to that confirmation; otherwise "Latest HH:MM", the line ending there; a row cut at the live start: "Last pre-match", the line ending at the start.
  - **Gaps (rule 26):** more than 3.6 h between recorded prices is a thin, lower-opacity dashed segment, never solid; nothing interpolated.
  - **One recorded price:** no line, area or open chip; the end dot and label only, with the note "One price recorded so far. The line appears once a second snapshot arrives."
  - **Book table:** grid 48px · 1fr · 64px · 84px · 76px, TYPE · BOOK · NOW · OPEN ("from x.xx") · DROP. Selected row red tint; clicking a row switches the chart. Name / suffix split at the first "(" or "+" ("Pinnacle" + "+30s", "Pinnacle" + "api-tennis"), the full name in the row's tooltip. Order: Sharp then Soft, in the dashboard's `AODDS_ORDER`, never re-sorted by drop. **No "this row", no per-book "moved Xh ago".**
  - **Drop cells (rule 27):** shortened `#FF7B88` / `#C26A75`; lengthened a muted "▲ x.x%" (`#4B5672`); unchanged "0.0%" muted; unknown "—". Never red for a price that did not shorten.
  - **Sharp/Soft** is odds.md's: Pinnacle +30s, Pinnacle (api-tennis) and Bet105 Sharp; every other book Soft.
  - **Summary:** "Down 10% or more at N of M books we record quoting this line (P of Q sharp)", real counts (10% as shown); with drop rows only, "books with a flagged move on this line".
  - **"Open match analysis →" (rule 30)** only for a row matched to exactly one board card (both players, card dated within 36 h of the row's start). The design's sample values never render.
  - **Container:** 1040px, radius 16, backdrop `rgba(3,4,7,0.62)`, shadow `0 30px 80px rgba(0,0,0,0.55)`; below a 1180px viewport a bottom sheet (top 64px, full width, radius 16 16 0 0).
  - **The endpoint's `lines`:** the same match across vendors means both surname keys equal, starts within 12 h, and exactly one candidate (else that book is left out). Pre-match is `pending` AND before the event's first non-pending sighting (TEN-295's rule); Kibl is `is_live false`.
- **Alerts is shown disabled with "Coming soon"** (Q5): no pop-over, no toggle, until a per-member alert backend exists.
- **No placeholder ever ships.** **Test:** the page files contain none of the export's sample names (Morita, Beleza, Brandt…), no "Book A"–"Book G", no `randomuser.me`, and no "ILLUSTRATIVE".
