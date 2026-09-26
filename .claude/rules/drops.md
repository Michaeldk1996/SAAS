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

- **The page shows the last 24 h of drops. A match that has started stays on the page, badged "Started" and sorted last.**
  **Test:** "Started" is shown only on live evidence (a Kibl `is_live` row, or a Superbet status of live/settled/finished/ended; cancelled or postponed is *not* started).
  A passed scheduled time alone is `pastScheduledStart`, never "Started". Kibl matches start a median 11 min early (n=17).

- **One database read per cadence, fanned out from memory.**
  **Test:** any number of requests on any route triggers zero database reads.
  Reads run every 30 s (the bots' tick), aligned to 3 s after the Bet105 bot's run: never less than 10 s apart and never more than 33 s.

- **Stale data is never presented as current.**
  **Test:** `generatedAt` advances only on a successful read. The page shows "Updated Xs ago", turns amber past 90 s (3× the read interval), and past 5 min dims its rows and labels them "as of HH:MM UTC".
  Before the first good read, `/drops.json` answers 503, never an empty list.
  *User-facing wording names data time only, never a feed, bot or service* (non-negotiable: no infrastructure warnings to end users). Source-by-source health lives in `/status.json` and the watchdog.

- **The database link is verified TLS or nothing.** The Fly app verifies the pooler against the bundled Supabase Root 2021 CA and refuses to start without it.
  **Test:** the connection URL carries no `ssl*` parameter (in node-postgres one overrides the CA silently). Failures are public only as a code, never the driver's text.

- **A stall reaches the founder by Telegram**, in the same chat as the drop alerts. The watchdog runs outside the Fly app, in pg_cron.
  **Test:** it alerts when the endpoint is unreachable 3 times in a row, when data is more than 5 min old, or when any source is past its limit. An alert counts as delivered only once confirmed *sent*.

- **Access is open while the product is in search and development** (founder, card 37612d3d).
  CORS allows exactly `https://michaeldk1996.github.io`. CORS is not access control.
  *Revisit before members:* the gate would verify the Firebase ID token on the Fly app, which needs no database read.
