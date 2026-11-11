# MTO (medical timeout) alerts + archive (founder brief 2026-11-11)

Applies to `tools/mto-bot.sql` (schemas `mto_rec` + `mto`), `tools/mto-levels.mjs` / `.sql`, `.github/workflows/mto-bot.yml`.
**Test:** `tools/test-mto-bot-sql.py` (a real throwaway Postgres fed the REAL payloads captured 11 Nov 2026 in
`tools/fixtures/mto/`; `--mutants`: each rule removed must turn it red).

## Source
- **Live Tennis API** (livetennisapi.com, PRO tier, key = repo secret `LIVETENNISAPI_KEY` → Vault `livetennisapi_key`):
  `GET /events?type=medical_timeout_start,medical_timeout_end`. No feed we already paid for states an MTO (api-tennis REST
  and websocket, Kibl, Oddspapi, Polymarket's sports socket: checked 11 Nov, no medical field).
- Measured 11 Nov on the four ATP MTOs of 7–9 Nov the Physio-Tennis channel posted (Paris SF, Stockholm ×3): 4 of 4
  present, right player, score and server, each recorded 3–5 s after the scorer's instant. Since 12 Sep: 165 ATP singles
  medical-timeout rows, 136 naming the player. Its misses and false alarms are not measured.
- **Never inferred.** **Test:** only a row of type `medical_timeout_start` whose `basis` is `observed` becomes an MTO. The
  feed's `pause_*` rows (its own inference from point clocks), a bare `stoppage_*`, a `trainer_called` and our own
  Interrupted status never do, and the detector never asks for them.

## What is posted and stored
- **Scope = ATP main draw + ATP qualifying singles, the drop bots' rule** (`telegram-alerts.md`): the feed says `tour` atp,
  not doubles, AND `drops_scope.verdict` finds exactly one api-tennis fixture of type `Atp Singles`. Any other tour is
  dropped at once: not posted, not archived. An ATP row with no api-tennis fixture is held (re-checked for 30 min).
- **One post per MTO.** **Test:** the feed's event id is unique in `mto.archive`; a second row for the same match, player
  and score within 15 min is `duplicate` and never posted; a later MTO in the same match (another score) is a new post.
- **The player is the source's or nobody.** **Test:** a row without `player` is posted with no MEDICAL tag and stored with
  `player` NULL. Never guessed.
- **The post = the founder's layout (2026-11-12).** Line 1 "🚨 LIVE · MTO · {player}" (no name when the source gives
  none), so a phone notification says it alone. Line 2 = the host country's flag, level, tournament, Qualifying, round as
  the site prints it (1/8-finals → R16). Then one line per player in feed order: flag, name, his games per set ("6 0";
  his points in brackets once a point is played in the game), "● serving", "🩺 MEDICAL". Last line = the call's UTC
  time. **No source is named in any post** (the source is private). **Test:** the post holds no "Source" and no "Live
  Tennis"; a score the source did not send is a dash.
- **A send Telegram did not answer is tried again** (founder 2026-11-12; Ruud's 17:53Z MTO on 11 Nov was archived and
  never posted: its one send timed out in the TLS handshake). **Test:** no answer, a 429 or a 5xx → sent again on the
  next tick (a send is given 5 s, so about every 10 s), at most 10 sends, only while the call is under 2 min old
  (`mto_rec.config.resend_max_age`, founder 2026-11-12); an HTTP 4xx is `failed` at once. A post still `failed` after that
  is a watch problem: one alert in the pipeline chat naming the match.
- **Late = archived, not posted.** An MTO first seen more than 10 min after the call (`mto_rec.config.post_max_age`) is
  stored with `delivery` "not sent: seen N min after the call".
- **The archive row** (`mto.archive`, one per MTO, kept for good): our api-tennis match id (`event_key`), tournament, level,
  round, qualifying, surface, the call's UTC instant, who called it, the opponent, sets / games / points and the server at
  the call, the source; then its end and duration, and after the match the final result, winner, outcome and `retired`.
  Level = the site's own tournament table (`tools/mto-levels.sql`, generated from `TOURNAMENT_CATALOG`; `--check` in
  `npm test`), else the feed's tier, else none. A missing value is NULL, never a default.
- **Site:** `public.mto_export()` (service role) = every in-scope MTO keyed by api-tennis match id; a match with none is
  absent. Not yet published or drawn on any page.

## Telegram
- **The MTO chat only** (repo secret `TELEGRAM_MTO_CHAT_ID` → Vault `mto_telegram_chat_id`), through the drop bot's token
  and its `sendMessage` call. **Test:** no MTO post and no failure alert ever carries the drops chat's id. With no MTO
  chat in Vault a row reads `unsent: no vault secret`.
- **Failure alert → the pipeline chat** (Vault `pipeline_telegram_chat_id`), from `mto.watch_tick()` every minute, **only
  while an ATP singles match is in play on our own live board**: no key, no successful read for 3 min, or the source's
  own data clock more than 5 min old. One message per incident, repeated every 3 h, then RECOVERED.

## Running it
- `mto-bot.yml` (main only): `install` (test → apply → Vault → pg_cron `mto-detector` every 10 s + `mto-watch` every
  minute → startup message → read-back), `report`, `rollback` (unschedules; the archive stays).
- Cadence: a read every tick while ATP singles is live on our board, else one a minute (the PRO tier allows 10,000 a day).
