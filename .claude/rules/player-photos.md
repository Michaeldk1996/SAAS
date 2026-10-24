# Player photos — one player, one photo, on every surface

Applies to any task that renders a player avatar, headshot or monogram. Rationale: `BUILD-NOTES.md` (2026-10-22).

## The rule (founder 2026-10-22)

- **One source.** A player ID resolves to the ATP headshot through `player-atp-aliases.json`:
  `player_key -> ATP code -> https://www.atptour.com/-/media/alias/player-headshot/<code>`, else the monogram.
  Wikimedia (`player-photos.json`) and the api-tennis logo URL are **removed**; nothing else may be added.
  **Test:** every avatar asks `playerPhotoUrl` / `playerPhotoImg` (the dashboard) and nothing else
  (`tools/test-player-photos.js`, retired-source scan + per-surface check).
- **By ID, never by name.** A surface whose rows carry no player ID shows the monogram until an ID exists. Resolving a
  name to an ID is a separate, ruled join — never a name-to-photo shortcut.
- **One look.** Photo over the surface's own monogram circle: `.sf-ph` (cover crop, centred, the circle's fill behind
  the transparent PNG), `loading="lazy"`, `alt` = the player's name, sizes from each surface's own tokens. A failed load
  removes the photo and the monogram shows — never a broken-image icon. The Player Profile hero keeps its own markup
  (the reference) on the same resolver.
- **Hosting:** hotlinked from ATP at runtime; nothing is mirrored. Self-hosting is parked until pre-launch.
- **A 200 is not a photo.** ATP serves its grey silhouette with HTTP 200 (4,729 bytes, sha1 `d027bd09f6529734…`).
  **Test:** no mapped code serves a known placeholder, no two codes share one file, and every code's ATP birth year
  agrees with the api-tennis profile for that ID (`player-photo-manifest.json`, checked by `tools/test-player-photos.js`).
- **Changing the map:** run `tools/atp-photo-probe.browser.js` in a browser on atptour.com (ATP answers 403 to the
  command line) and commit its output as `player-photo-manifest.json` with the map. The test fails until both agree.

## Surfaces on the resolver

Today's Matches cards, Players page cards, Player Profile (V2 and legacy), Match analysis header + Form/H2H rows,
Draw view, Trading Report, Series cards, Ratings board, H2H picked cards, Live page (cards, sheet, Break/Hold),
Stennisfy Model head, Dropping Odds rows, Tournament quotes.

## Name -> ID joins (founder 2026-10-23) — the only places a name becomes an ID

- **Dropping Odds** (`drops-page.js` `photoKeyFor`): the row joins its Today's Matches fixture by the Kibl rule — both
  players either order; the card's full surname is the tail of the feed name, its first initial any of the feed's given
  names; a trailing Jr / Sr / II / III / IV dropped first; card start within ±24 h of the row's; exactly one card. The ID
  is that card's key for the row's side. Challenger / ITF rows have no card: initials. **Test:**
  `tools/test-player-photos.js` §4 (Jr, middle names, compound surname, window, two cards, no card).
- **Tournament quotes** (ONE rule, `tools/quotes/quote-speaker.cjs`, run by the importer — founder 2026-10-24; the page
  only reads `playerKey`): the speaker's surname against that tournament's entrants for the
  quote's season (`tournament-profiles.json` `allEditionMatches`; Roland Garros = the French Open profile). Several
  same-surname entrants: the initial counts only when it leaves exactly one. No initial, still several, none, or no
  edition on record = initials, and the row is reported. **Test:** `tools/test-player-photos.js` §5.
- **Parked:** Challenger / ITF Drops IDs from the drops service's own api-tennis fixture link (follow-up ticket).

## Map corrections (2026-10-22)

- Removed: `2672` S. Travaglia — `TA12` is him, but ATP serves only its silhouette (no real headshot exists today).
- Removed: `1307` A. Hernandez — `H346` is a different man (Alejandro Hernandez, b. 1977, MEX) and a silhouette. Our
  player (Venezuela, 21) has no ATP code in the 2,279-player ATP singles ranking, so no headshot could be found.
- `1317` M. Damm: `D214` (Martin Damm Sr., b. 1972) -> `D0DT` (Martin Damm, b. 2003, USA).

## Removed (founder 2026-10-23)

- `player-photos.json` (the Wikimedia map), `enrich-player-photos.py` and `validate-player-photos.js` are deleted and
  the pipeline no longer publishes the map. **Test:** `tools/test-player-photos.js` §6.
