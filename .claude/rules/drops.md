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
- **TEN-299 split** (Q3 = a): this page and endpoint apply the live cut; the Telegram drop bots' own in-play filter stays with TEN-299, on the same `liveAt` signal.

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
- **The price-move pop-up is the export's layout (LOCKED), showing that selection at every book we record quoting it** (founder comment 777a3192, 2026-09-26; supersedes the Q4 "books with a row only" strip). Feasibility measured in TEN-297 doc `popup-feasibility`.
  **Test:** the books come from, in order: a board-matched card's TEN-295 chart shard (Pinnacle +30s, Bet105, Superbet, Betfair Exchange; both sides), else the endpoint's `lines` (`drops_api.lines()`: Bet105, Superbet, Betfair Exchange), else only the books with a drop row. The strip is never padded. The row's own book always reads exactly as its list row (open → now, Q1).
  - **Summary:** "Down 10% or more at N of M books we record quoting this line (P of Q sharp)", with M the real strip. With drop rows only, the wording is "books with a flagged move on this line".
  - **Sharp/Soft** is odds.md's table (Pinnacle +30s and Bet105 Sharp; Superbet and Betfair Exchange Soft).
  - **Per-book %** is that book's own first recorded → current price. A lengthened book shows a muted ▲ and an unchanged one "0.0%", never red. Every other book's cell shows its own age ("moved 3h ago"). An endpoint book not seen (re-stamps included, `lastSeen`) within 24 h has stopped quoting: it is left out of the strip and out of M.
  - **Margin** (`1/pA + 1/pB − 1`, one source's two latest recorded sides) sits in the eyebrow for the row's book, and only when that source's latest price IS the price shown. Betfair Exchange has none ("—").
  - **Rank, Elo** (`elo-ratings.json` via the dashboard's `psEloFor`), **event, surface, round and "Open match analysis →"** only for a row matched to exactly one board card (both players, card dated within 36 h of the row's start). Otherwise "—" and no link. The export's sample values never render.
  - **Chart (founder comment bef04c62, 2026-09-26; supersedes the last-24h axis):** the house style, not red. **Test:** the line, area and gridlines use the Database cumulative-profit chart's own values (`COL_FAV` #6a9af8 at 2.6 px, `FILL_FAV` rgba(91,155,255,0.11)); no red in the chart; direction is carried by ▼/▲ and the red/green %s only.
    The x-axis runs from the book's **first recorded price** ("first seen", since no source gives a true open) to its **latest recorded price** (labelled "latest", since it is the last recorded price, not the clock), ticked at real UTC times with round intermediates, dated on each new UTC day; labels never overprint. It never shows "−24h/−12h". Recorded snapshots only; a stretch over 3.6 h between points is dashed (the previous rule's 15% of a 24 h axis); nothing interpolated. With only the row's own flagged prices loaded, the note says so instead of calling the dashes "no snapshots". The endpoint's `lines` send each series' whole recorded life (newest 1000 points per side if longer, flagged `truncated`, which the page names instead of drawing a gap).
  - **The endpoint's `lines`:** the same match across vendors means both surname keys equal, starts within 12 h, and exactly one candidate (else that book is left out). Pre-match is `pending` AND before the event's first non-pending sighting (TEN-295's rule); Kibl is `is_live false`.
- **Alerts is shown disabled with "Coming soon"** (Q5): no pop-over, no toggle, until a per-member alert backend exists.
- **No placeholder ever ships.** **Test:** the page files contain none of the export's sample names (Morita, Beleza, Brandt…), no "Book A"–"Book G", no `randomuser.me`, and no "ILLUSTRATIVE".
