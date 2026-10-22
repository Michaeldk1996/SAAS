# Player photos — one source, every avatar

Applies to any task that renders a player avatar, headshot or monogram.

## Source (founder 2026-10-22)

**The repo photo is the ATP headshot keyed by `player-atp-aliases.json`:**
`player_key → ATP code → https://www.atptour.com/-/media/alias/player-headshot/<code>`.
The images are hotlinked; nothing is mirrored into the repo.

- **Test:** an avatar's photo URL comes from `atpPhotoFor(key)` and nothing else. No alias = monogram.
- `player-atp-aliases.json` is the only photo map. Do not add a second mapping file or a parallel lookup.
- Keyed by player ID, never by display name. A surface whose rows carry no key shows a monogram until a key exists.
- Wikimedia (`player-photos.json`) is removed as a photo source.
- curl from a datacenter or this Mac gets a 403; a browser gets 200 (300×300 PNG, ~36 KB, n=10). Verify headshots in a browser, not with curl.

- **A 200 is not a photo.** Two aliases (`H346`, `TA12`) serve ATP's grey silhouette: 4,729 bytes, byte-identical. An image error never fires for them. **Test:** no alias may serve a known-placeholder hash or share bytes with another alias. Enforce this where the map is curated, not in the render path.

## Direction (founder 2026-10-22, applied at build — not yet live)

- The seven initials-only surfaces switch to photos through the one resolver, ID-only: Trading Report, Live, Series, Drops, Ratings, H2H, Tournaments quote avatars. Until that build lands, each surface's own "no photos" rule stands, and the build rewrites those rules files.
- **Ratings:** rows gain a player ID first. A row without an ID gets a monogram, never a name-matched guess.

## Open — awaiting founder rulings (do not resolve alone)

- **api-tennis logo URL** (`event_*_player_logo`, `resolveProfilePhotoUrl`): keep as a fallback or remove.
- **Drops and Tournament quotes:** no player ID exists upstream. Their keys would be name-derived.
- **The two silhouette aliases:** whether to remove them from the map.
- **Hosting:** hotlink vs self-host. **Post-deploy monitoring:** none exists today.
