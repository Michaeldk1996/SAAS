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
Stennisfy Model head.

## Map corrections (2026-10-22)

- Removed: `2672` S. Travaglia — `TA12` is him, but ATP serves only its silhouette (no real headshot exists today).
- Removed: `1307` A. Hernandez — `H346` is a different man (Alejandro Hernandez, b. 1977, MEX) and a silhouette. Our
  player (Venezuela, 21) has no ATP code in the 2,279-player ATP singles ranking, so no headshot could be found.
- `1317` M. Damm: `D214` (Martin Damm Sr., b. 1972) -> `D0DT` (Martin Damm, b. 2003, USA).

## Open — awaiting founder rulings (do not resolve alone)

- **Drops** and **Tournament quotes** photos: the ID joins are reported, not built (Drops: the drops service's fixture
  link; quotes: surname against that tournament's entrants). Until ruled, both stay initials-only (`drops.md`,
  `tournaments.md`).
