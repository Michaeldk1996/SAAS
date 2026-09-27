# Match analysis → Weather tab, and weather data

Founder rulings from TEN-304 (2026-09-27). Rationale is in `BUILD-NOTES.md`.

## Source
- **Open-Meteo's free endpoint is the weather source.** The founder has accepted its licence, so there is no key, no account and no other provider. **Test:** every weather fetch goes to `api.open-meteo.com` / `archive-api.open-meteo.com`, and no weather key exists in the repo or its secrets.

## Match time
- **An api-tennis `event_date` + `event_time` is the Europe/Berlin wall clock**: CEST until 25 Oct 2026, CET after. Convert it to an instant with the tz database (`berlinWallMs` / `weatherStartIso` in `bsp-pipeline.js`), never by reading it as UTC and never with a fixed +2.
  - **Test:** 14:00 on 24 Oct is 12:00Z and 14:00 on 26 Oct is 13:00Z (`tools/test-ten304-weather-hour.js`).
  - **Exception:** only the weather path is fixed so far. Other readers of api-tennis times are reported on TEN-304 and are not changed without a founder ruling.
- **A fixture with no time gets no match-time weather.** **Test:** `weatherStartIso(date, null)` returns null, and nothing is read at a guessed noon or midnight.

## Model layer #12 (weather)
- **Layer #12 is OFF** (`gated: true`), and `weather()` honours the flag. It stays off until the match-time fix above **and** an indoor check are both in and the founder turns it back on. **Test:** with extreme weather inputs, `weather()` returns `applied:false, deltaP1:0`.

## Venues
- **Retractable roof = outdoor.**
- **Santiago (Chile Open) is outdoor clay**, by founder ruling. The odds archive's tennis-data `court` column says "Indoor" for 2023–26; that column is not our flag.
- **Brussels (European Open, Brussels Expo) is indoor hard.**
- **Laver Cup has no venue on purpose** (rotating arena). Its Weather tab shows the **indoor panel**.

## Tab display — ruled, NOT BUILT YET (TEN-304 Wave B)
Everything in this section is ruled but not yet in the code; Wave B builds it. Until Wave B ships, none of these texts or controls exist on the page, so don't treat them as delivered.
- **The modal header subtitle carries the start time** in the viewer's zone, like the rest of the dashboard: "ATP Chengdu · Quarter-finals · 18:00". This is the one allowed header change.
- **The Weather tab shows every time in venue-local time**, with one "Times shown in venue local time" note in the week-strip header.
- **The MATCH badge is the same instant as the header, converted to venue time.**
- **Severity cut-offs, which 7 days the strip shows, and the missing-time state stay on the TEN-304 brief's defaults**, behind one config object, until the founder rules. The "THRESHOLDS TBD — MICHAEL" chip stays visible until then.
