# Match analysis → Weather tab, and weather data

Founder rulings from TEN-304 (2026-09-27). Rationale is in `BUILD-NOTES.md`.

## Source
- **Open-Meteo's free endpoint is the weather source.** The founder has accepted its licence, so there is no key, no account and no other provider. **Test:** every weather fetch goes to `api.open-meteo.com` / `archive-api.open-meteo.com`, and no weather key exists in the repo or its secrets.

## Match time
- **An api-tennis `event_date` + `event_time` is the Europe/Berlin wall clock.** The weather hour is looked up at `weatherStartIso` (`bsp-pipeline.js`, through `berlin-time.js`). The rule for every reader is in `CLAUDE.md` → Data sources → *api-tennis times*.
  - **Test:** 14:00 on 24 Oct is 12:00Z and 14:00 on 26 Oct is 13:00Z (`tools/test-ten304-weather-hour.js`).
- **A fixture with no time gets no match-time weather.** **Test:** `weatherStartIso(date, null)` returns null, and nothing is read at a guessed noon or midnight.

## Model layer #12 (weather)
- **Layer #12 is OFF** (`gated: true`), and `weather()` honours the flag. It stays off until the match-time fix above **and** an indoor check are both in and the founder turns it back on. **Test:** with extreme weather inputs, `weather()` returns `applied:false, deltaP1:0`.

## Venues
- **Retractable roof = outdoor.**
- **Santiago (Chile Open) is outdoor clay**, by founder ruling. The odds archive's tennis-data `court` column says "Indoor" for 2023–26; that column is not our flag.
- **Brussels (European Open, Brussels Expo) is indoor hard.**
- **Laver Cup has no venue on purpose** (rotating arena). Its Weather tab shows the **indoor panel**.

## Tab display (TEN-304 Wave B)
Spec: `design/handoff-weather/Weather Tab - Paperclip.md`. Code: `WX_CONFIG` / `WX_COPY` / `wxModel` / `buildWeatherSection` in `bsp-consult-dashboard.html`. Tests: `test-ten304-weather-tab.mjs` (executes the page's renderer) + `tools/test-ten304-mutants.js`.
- **The modal header subtitle carries the start time** in the viewer's zone, like the rest of the dashboard: "ATP Chengdu · Quarter-finals · 18:00". This is the one allowed header change. No usable start → no time appended.
- **The Weather tab shows every time in venue-local time** (the forecast file's IANA zone), with one "Times shown in venue local time" note in the week-strip header. With no forecast file the zone is unknown: the note says "Times shown in your time zone".
- **The MATCH badge is the same instant as the header, converted to venue time.** **Test:** a Chengdu match viewed with `TZ=Asia/Shanghai` and `TZ=UTC` shows header 16:00 / 08:00 and badge 16:00 in both.
- **Severity cut-offs, the playing window, the strip length and the staleness limits live in `WX_CONFIG` only** (placeholders: gusts watch ≥ 25 / concern ≥ 35 km/h, feels-like ≥ 30 / ≥ 35°, rain chance ≥ 30 / ≥ 60 %). The "THRESHOLDS TBD — MICHAEL" chip stays visible until the founder rules. **Test:** changing a config cut-off flips the rendered severity.
- **State comes from the data, never a switcher:** indoor flag → the indoor panel only; no forecast, or a fetch more than 24 h old → the unavailable state with the real last-update time; 6–24 h old → amber freshness line. `?wxForce=unavailable` is the only override (test-only).
- **A missing value is "—" and UNAVAILABLE, never 0, and never the lead factor.**
- **Day-card flags use the worst hourly value in the playing window (10:00–23:00 venue-local)**; an hour outside it never flags the card. Hi/lo are the daily values.
- **Forecast files are built by `build-weather.js` in every pipeline run and published, never committed.** A venue is re-fetched from Open-Meteo only when the published copy is 3 h old or more; a failed fetch carries the last good copy with its original `fetchedAt`. **Test:** `tools/test-ten304-build-weather.js`.
