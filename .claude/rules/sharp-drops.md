# Sharp drop alerts (founder 2026-11-14)

Applies to `tools/sharp-drops.sql` (schema `sharp_bot`), `tools/sharp-members-sync.mjs`, `.github/workflows/sharp-drops.yml`
and the Sharp drops page. Research behind every number: `vigshift-backtest-*-report.md` (repo root, not committed) and
`~/Stennisfy/vigshift-backtest/` on the Mac. Grading rule: `feedback-oddspapi-close-for-backtests` (memory).

## Founder rulings (2026-11-14) — each is a test
- **Personal bot DMs.** One Telegram bot; a member links it once and receives only the alerts that match HIS settings.
  **Test:** an alert reaches a member's chat only when every one of his filters passes; a member with no linked chat
  gets nothing; no alert is posted to a shared channel.
- **Beta: the founder only.** Until the founder opens it, only admin accounts (the `isBspAdmin` allow-list) are synced
  and receive alerts, and only they see the page. **Test:** the member sync writes no non-admin row; `deliver()` sends
  to no row with `admin = false` while `config.beta_only` is true.
- **Default rule = favourite under 1.80, drop 2–3% within 5 minutes**, levels ATP, ATP qualifying, Challenger,
  Challenger qualifying (the one rule that held on unseen months). **Test:** a new member's settings equal exactly that.
- **Look = the site tokens now, Claude Design later.** No raw colours (`lint-raw-colours.mjs`).

## Engine
- **Trigger = Bet105** (Kibl: poller archive `kibl_line_observations` + stream `kibl_now_history`, the Bet105 drop bot's
  own loader), all three levels (Kibl leagues 19 ATP, 537 Challenger, 962 ITF Men). odds-api.io carries no Pinnacle;
  Pinnacle (Oddspapi pinnacle+30) is 30 s late and pulled after the match, so it grades, it does not trigger.
- **A drop** = one player's Bet105 price (2 dp) at least `base_drop` % (2) below its own price `lookback_min` (5)
  minutes earlier, both sides quoted, overround ≤ 20%, a single api-tennis fixture joined (drops_scope join), the
  fixture not started (no live-flip row, start in the future), at most `max_window_min` (180) before the start. One
  alert row per drop, `cooldown_min` (5) per player per match. **Test:** a 1.9% drop, a drop measured over 6 minutes, a
  drop after the start and a second drop inside the cooldown record nothing.
- **"Bet at"** = the dropped player's no-vig fair price on the Bet105 pair at the alert. Never shown as a close.
- **Books at the alert:** Bet105 (the trigger's own price) and Kalshi (best ask + size, after the 0.07·p·(1−p) fee,
  ATP series only). A book with no price is left out of the message, never shown as zero.
- **Delivery:** a member gets at most one alert per player per match (the first drop that passes his filters), his
  daily cap and quiet hours (his time zone) apply, and nothing is sent while `config.live` is false.

## Grading — append-only
- Alerts and deliveries are only ever added; a grade is its own row (`sharp_bot.grades`, one per alert).
- **Close = the Oddspapi Pinnacle close** (`pinnacle_archive_close`, current non-superseded row of the event), no-vig;
  none → the grade says so, never another book. **Result** = api-tennis winner; walkover / cancelled → void; a
  retirement → "no units" until the Pinnacle first-set rule is wired (never guessed).
- **Edge vs close** = bet_at × closing no-vig probability − 1; P&L 1 u at the Bet105 price at the alert and at bet_at.

## Telegram
- Bot token: Vault `sharp_telegram_bot_token`, else the drop bots' `ten287_telegram_bot_token` (beta). Linking: the
  member sends `/start <code>` (the code from his page); `/stop` pauses, `/start` again resumes. Updates are read with
  `getUpdates` through pg_net — nothing else may consume that bot's updates (no webhook).
