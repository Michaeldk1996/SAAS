# Telegram — what each chat carries (founder task "telegram-bot-scope", 2026-10-30)

## Drops chat ("Stennisfy Data Alerts") = ATP drops only
- **Test:** a live drop alert is posted only when its api-tennis fixture's `event_type_type` is `Atp Singles` — ATP main
  draw, and ATP qualifying (same type, `event_qualification` `"True"`; e.g. 12171713, Almaty 2026, round "ATP Almaty -
  Semi-finals", qualifying). Davis Cup singles carry the same type and post. Challenger (`Challenger Men Singles`) and ITF
  (`Itf Men Singles`) drops are recorded and stay on the Drops page; their `delivery` reads `held: not ATP (…)` and they
  are never sent. Never the tournament name, never the vendor's own tier.
- **How** (`tools/drops-scope.sql`, installed by `drops-scope.yml` mode `install`, rolled back by mode `rollback`): a
  BEFORE INSERT trigger on `ten280_bot.alerts` (Bet105) and `ten287_bot.alerts` (Superbet). The bots post only
  `delivery = 'unsent'` rows and their functions are unchanged, so a bot re-install keeps the scope. The fixture list is
  `drops_scope.fixture`: api-tennis `get_fixtures`, UTC, yesterday .. +4 days, written every pipeline run
  (`tools/drops-scope-fixtures.mjs`).
- **Join** = the Drops page's (`stennisfy-drops/status.mjs`): both surnames (accents, hyphens, Jr/Sr/II/III/IV ignored),
  initials agree, either order, start within 24 h of the vendor's (none: 12 h before to 4 days after the alert), exactly
  one event key. No fixture, two fixtures or a failed check = held, never posted. A row held for want of a fixture is
  re-checked each minute for 30 min and posted if its fixture arrives as ATP; after 30 min it stays held.
- Every verdict is in `drops_scope.verdict_log` (the field that decided, with the event key). **Test:**
  `tools/test-drops-scope-sql.py` (control: without the trigger a Challenger drop would post).

## Pipeline chat = every pipeline / health alert
- **Test:** every workflow that hands a chat id to an alert reads `secrets.TELEGRAM_PIPELINE_CHAT_ID || secrets.<its old
  chat>` (`TELEGRAM_CHAT_ID`, or `TELEGRAM_OPS_CHAT_ID` for the odds loop) — card job, line-summary, live-flip, data
  staleness, stall guard, post-deploy check, pipeline (archive gate, price alerts, fail alert, market-edge), TE import,
  Kibl sweep, odds loop, drops watchdog install, and the TE store's refresh templates. The pg_cron senders
  (`oddspapi-postmatch-pinger.sql`, `ten216-collector-watchdog.sql`) read Vault `pipeline_telegram_chat_id` first, copied
  from the repo secret by `ten270-stream-now.yml` action `schema` only when it exists.
- **Until the secret exists every alert keeps its current chat — never dropped.** **Test:** `tools/test-telegram-routing.mjs`
  (controls: the old chat alone, and the pipeline chat with no fallback, are both caught).
