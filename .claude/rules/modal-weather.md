# Match analysis → Weather tab, and weather data

Founder rulings from TEN-304 (2026-09-27). Rationale is in `BUILD-NOTES.md`.

## Source
- **Open-Meteo's free endpoint is the weather source.** The founder has accepted its licence, so there is no key, no account and no other provider. **Test:** every weather fetch goes to `api.open-meteo.com` / `archive-api.open-meteo.com`, and no weather key exists in the repo or its secrets.

## Match time
- **An api-tennis `event_date` + `event_time` is the Europe/Berlin wall clock.** The weather hour is looked up at `weatherStartIso` (`bsp-pipeline.js`, through `berlin-time.js`). The rule for every reader is in `CLAUDE.md` → Data sources → *api-tennis times*.
  - **Test:** 14:00 on 24 Oct is 12:00Z and 14:00 on 26 Oct is 13:00Z (`tools/test-ten304-weather-hour.js`).
- **The api-tennis 02:00Z placeholder is no time** (founder ruling, 27 Sep): a card with no `startTs` whose start is exactly **02:00:00Z** (04:00 Berlin in CEST, 03:00 in CET) shows "MATCH · TBC", "{date} · time TBC", dashes, no header time, and is never archived at that hour (`apiStartMs` on the page, `defaultStartMs` in `build-weather.js`). Evidence: 34 of 236 cards on `origin/main` (771 `matches.json` revisions, 19–27 Sep) were first published at it, all Chengdu/Hangzhou, and 33 were later revised. **Test:** 04:00 CEST and 03:00 CET → TBC; 04:05 CEST and 04:00 CET → real times; an explicit `startTs` at 02:00Z is trusted.
  - **Known cost:** a real start at exactly 02:00Z (11:00 Tokyo, 10:00 China) also shows TBC until api-tennis sends another time.
  - **Unverified after 25 Oct:** all evidence is CEST. The rule assumes the placeholder stays at 02:00Z (03:00 Berlin CET); if api-tennis keeps the 04:00 wall clock instead, re-measure and re-rule.
- **A fixture with no time gets no match-time weather.** **Test:** `weatherStartIso(date, null)` returns null, and nothing is read at a guessed noon or midnight.

## Model layer #12 (weather)
- **Layer #12 is OFF** (`gated: true`), and `weather()` honours the flag. It stays off until a **backtest shows it improves predictions** (founder ruling, 27 Sep 06:54Z) and the founder turns it back on; the match-time fix and an indoor check are prerequisites, not the trigger. **Test:** with extreme weather inputs, `weather()` returns `applied:false, deltaP1:0`.

## Venues
- **Retractable roof = outdoor.**
- **Santiago (Chile Open) is outdoor clay**, by founder ruling. The odds archive's tennis-data `court` column says "Indoor" for 2023–26; that column is not our flag.
- **Brussels (European Open, Brussels Expo) is indoor hard.**
- **Laver Cup has no venue on purpose** (rotating arena). Its Weather tab shows the **indoor panel**.

## Tab display (TEN-304 Wave B)
Spec: `design/handoff-weather/Weather Tab - Paperclip.md`. Code: `WX_CONFIG` / `WX_COPY` / `wxModel` / `buildWeatherSection` in `bsp-consult-dashboard.html`. Tests: `test-ten304-weather-tab.mjs` (executes the page's renderer) + `tools/test-ten304-mutants.js`.
- **The modal header subtitle carries the start time** in the viewer's zone, like the rest of the dashboard: "ATP Chengdu · Quarter-finals · 18:00". This is the one allowed header change. No usable start → no time appended.
- **The Weather tab shows every time in venue-local time**, with one "Times shown in venue local time" note in the week-strip header. The zone is the forecast file's IANA zone, else the venue's `tz` in `tournament-venues.json` (via `weather-index.json`), so a venue with **no forecast file still shows venue time**. "Times shown in your time zone" is a **fallback only**, for a tournament with no venue entry at all. **Test:** with no file, an entry with `tz` gives the venue-time note and badge 16:00 for a Chengdu 08:00Z start; an entry without `tz` gives the viewer note.
  - **Every venue in `tournament-venues.json` carries `tz`** (74 of 74 on 27 Sep 2026). The geocoding refresh (`geocodeCity`) keeps the zone Open-Meteo returns, so a refresh never drops it.
- **The MATCH badge is the same instant as the header, converted to venue time.** **Test:** a Chengdu match viewed with `TZ=Asia/Shanghai` and `TZ=UTC` shows header 16:00 / 08:00 and badge 16:00 in both.
- **Severity cut-offs, the playing window, the strip length and the staleness limits live in `WX_CONFIG` only** (placeholders: gusts watch ≥ 25 / concern ≥ 35 km/h, feels-like ≥ 30 / ≥ 35°, rain chance ≥ 30 / ≥ 60 %). The "THRESHOLDS TBD — MICHAEL" chip stays visible until the founder rules. **Test:** changing a config cut-off flips the rendered severity.
- **State comes from the data, never a switcher:** indoor flag → the indoor panel only; no forecast, or a fetch more than 24 h old → the unavailable state with the real last-update time; 6–24 h old → amber freshness line. `?wxForce=unavailable` is the only override (test-only).
- **Weather colours and border widths are the Weather spec's values verbatim (`WX_C`), not the 12a re-tone** (founder ruling via the TEN-303 follow-up, 2026-09-27: the whole Match analysis modal matches the design export). `WX_C` is a `DESIGN_ZONES` entry, so the 12a engine never re-tones it. **Test:** every `WX_C` value is a value the spec states, and the engine leaves `WX_C` unchanged (`test-ten304-weather-tab.mjs`).
- **A missing value is "—" and UNAVAILABLE, never 0, and never the lead factor.**
- **Day-card flags use the worst hourly value in the playing window (10:00–23:00 venue-local)**; an hour outside it never flags the card. Hi/lo are the daily values.
- **A completed (or started) match shows OUR archived pre-start forecast, labelled "forecast, not observed"** (founder ruling, 27 Sep 06:54Z). Started = the start instant has passed, the card is live, or it is a `past-` card.
  - The archive is `weather/archive/<venue>.json`, built by `build-weather.js`: per match, the hourly row holding its start from the **last fetch made before that start**; per venue-local day, the day's rows from the last fetch made **before its 10:00 window opened**. A fetch made after the start never enters it. Pruned to 14 days back.
  - **No archived row for that match → the unavailable state.** The current forecast file is **never** read for a started match, and no forecast is ever fetched for a past date and shown as what happened (no ERA5 archive, no historical-forecast API, no `past_days` values frozen after the start).
  - **Test:** a completed match with an archive shows "… · forecast, not observed", its archived values and "Archived forecast · fetched …"; one without an archive (with or without a current file) shows unavailable. `tools/test-ten304-build-weather.js`: a post-start fetch never creates or replaces an entry; an older fetch never replaces a newer one.
  - Matches completed before this shipped have no archive, so they show unavailable.
  - **The archive is committed** (founder ruling, 27 Sep): `pipeline.yml` commits `weather/archive/` back after each deploy (author `bsp-weather-bot`, `[skip ci]`, owned files: a conflict fails the step, never takes a side). `build-weather.js` merges the committed copy with the live one, newer entry per day / match wins, so a failed live read keeps history. `weather/archive/` is a deploy-lane data dir. **Test:** with the live read failing 3x, the committed history survives (`tools/test-ten304-build-weather.js`).
- **"Scheduled time — later matches often start later."** shows under the At-match-time header on every match that is not first on court. api-tennis has no order of play, so first on court = the earliest scheduled start that venue-local day at that tournament on the board (ties are all first). **Test:** the second match of the day gets the note, the first and a tie do not.
- **Partial read wording:** "No weather concern in the values we have. Missing: {factor list}." (e.g. "Missing: wind, rain"). All tab wording lives in `WX_COPY`.
- **The shared tooltip (TEN-303's `initAOddsTips`) closes on Escape**, whether open or still pending. Founder-approved as the one change to the Odds tab's tooltip code. **Test:** Escape hides an open tooltip and cancels a pending one; other keys do nothing.
- **Download report prints real values or dashes, never "Loading forecast…"**: it waits for the Weather load (capped at 8 s), and a section still not loaded prints as the unavailable state.
- **Forecast files are built by `build-weather.js` in every pipeline run and published, never committed.** A venue is re-fetched from Open-Meteo only when the published copy is 3 h old or more; a failed fetch carries the last good copy with its original `fetchedAt`. **Test:** `tools/test-ten304-build-weather.js`.
