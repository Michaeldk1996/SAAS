# Tournament logos — self-hosted ATP logos (founder 2026-11-16 / 2026-11-17)

Applies to `tournament-logos/` (the files + `index.json`), `tools/tournament-logos/` (`fetch-logos.mjs`, `logo-map.json`)
and the Database page's reader (`db2TLogosLoad` / `db2TLogoFile` / `db2Logo` in `bsp-consult-dashboard.html`,
`database.md` → Tournament). Founder: "link the tournament logo, find a way to do it" (2026-11-16); the ATP agreement
covers tournament logos as well as player photos (2026-11-17). **Test:** `tools/test-tournament-logos.js` (in `npm test`).

## The rule
- **One logo per Database tournament label, or the initials tile.** The key is the label the Database's Tournament search
  prints (`TOURN_SPLIT` / `TOURN_COMMON` over `database-yield.json` `meta.tournaments`: "Australian Open", "Shanghai",
  "Queen's Club", "Belgrade · Serbia Open"). `index.json` = `{ logos: { "<label>": "<file>?v=<sha1 prefix>" }, sources,
  missing }`; a label with no entry, a missing file or a failed load is the initials tile — never a broken image.
  **Test:** every map label is in `logos` or in `missing` with its reason; the map covers every Database label.
- **The logo is ATP's own, from that event's own page.** `logo-map.json` names, per label, the atptour.com tournament
  pages to try (in order) and the words the logo must carry; the logo is the page's `img.tournament_logo`, accepted only
  when its alt or file name holds one of those words. **Never another event's logo:** a licence that moved city keeps its
  ATP ID, so its page now shows the new event (Marseille's 496 shows Lyon's Grand Prix Auvergne-Rhône-Alpes; Chennai's 891
  Pune; San Jose / Memphis / New York's 424 Dallas; Nottingham's 741 Eastbourne) — refused and listed in `missing`.
  **Test:** a source whose alt / file name does not name the event fails.
- **No two events share a file or a source image**, except labels the map declares the same ATP tournament (`sameAs`:
  Adelaide 1 = Adelaide, ATP 8998). A shared generic placeholder would show up that way. **Test:** sharing, a stray file,
  a stale `?v=` hash, or a file that is not a real WebP fails (each with a mutant).
- **Hosting:** self-hosted, like the player photos. **No page requests atptour.com.** atptour.com answers every non-browser
  client with a Cloudflare 403, so `tools/tournament-logos/fetch-logos.mjs` drives a VISIBLE Chrome on the Mac (never a
  bypass) and writes each logo fitted inside 128 × 96 px (2× the 28–44 px slots), transparent, aspect kept, as WebP.
  `tools/site-code.sh` ships the folder with the code (`publish.yml`), so a logo change lands through the deploy lane like
  code. **Test:** `site-code.sh` copies `tournament-logos/`; no page names an atptour.com logo URL.
- **Refresh:** by hand (`node tools/tournament-logos/fetch-logos.mjs`, optionally `--only "<label>,…"`), then the normal
  lane. No scheduled job writes the folder, so `tools/deploy-lane.mjs` does not count it as bot data; a job that starts
  refreshing it must add it to `DATA_DIRS` first. A page that fails to load keeps the last good file.
- **Era:** one logo per event, today's on ATP's page (a sponsor rename shows the current brand on every season).
