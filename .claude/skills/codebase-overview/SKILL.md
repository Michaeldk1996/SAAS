---
name: codebase-overview
description: Orientation for the Stennisfy codebase — where things live, what is generated, and what not to touch. Use at the start of any task in an unfamiliar area, instead of exploring the tree to work out the layout.
---

# Stennisfy — codebase orientation

Read this instead of exploring. If something here is wrong or missing, fix this file as part of the task.

## Entry points

| Thing | Where | Notes |
|---|---|---|
| Frontend | `bsp-consult-dashboard.html` + the scripts it loads (`player-profile-v2.js` = the player profile, `live-tab.js`, …) | `tools/site-code.sh` copies it to the site as `index.html`, so it IS the served app. The repo-root `index.html` is an unused redirect. Served live at `michaeldk1996.github.io/SAAS/` |
| Data pipeline | `bsp-pipeline.js` | Node. Runs every 15 min via GitHub Actions |
| Pipeline config | `.github/workflows/` | Cron `*/15 * * * *` |
| Design source | `design-export/` | Canonical. See the `design-handoff` skill |

## Generated — never edit by hand

These are pipeline output. Editing them directly is always wrong; fix the pipeline instead.

- `matches.json` — today's matches + odds
- `tournament-profiles.json`
- `tournament-progression.json`
- `player-profiles.json` — player stats cache

## Reference, not production

- `api-tennis-integration.js` — endpoint shapes for API-Tennis
- `backtest_elo.py`, `backtest_demo.py`, `demo_matches.csv` — internal Elo research

## Where the rules live

- `CLAUDE.md` — architecture rules, universal design tests, non-negotiables
- `.claude/rules/odds.md` — odds sources, book ladder, card and close rules
- `.claude/rules/` — surface-specific rulings, loaded when you touch matching files

## Conventions

- **Legacy `bsp-*` names** survive in the tree for historical reasons. Leave them unless a task says otherwise.
- **ATP only.** WTA is filtered at pipeline level (`tourBadge === 'ATP'`).
- **Atomic writes.** Pipeline output uses temp file + rename, never a direct write to live JSON.

## Things worth knowing before you start

- **The committed `player-profiles.json` is a fossil.** The pipeline publishes the store to Pages and never commits it back; measure against the deployed one (`tools/deployed-store.js`).
- **Tests run the page's real code in a sandbox.** Dashboard functions are sliced and executed (`tools/ten334-overview-vm.mjs` `closure`); the profile module loads into a window shim (`profileWindow`). New shared logic is exported on `PlayerProfileV2._internals`, not copied.
- **A dashboard script ships only if all three deploy lists name it:** `.github/workflows/pipeline.yml` (copy + site assert), `tools/site-code.sh`, `tools/publish-site.mjs` `CODE_REQUIRED`. `tools/test-pp2-reconcile.js` fails when the page loads one that isn't listed.
- **Code goes live as:** push to `main` → `Code gate` (`gate.yml`, every `npm test` command across 6 shards) → `Publish site` (`publish.yml`, runs on the gate's completion).
- **`npm test` is one `&&` chain — it stops at the first red,** so one failure can hide others behind it. The gate's shards run every command regardless.
- **Sliced page code runs without `window` in node suites.** Top-level dashboard code that registers anything uses `globalThis`, not `window` (`window.sfEscLayers` at top level broke a dozen suites).
- **Esc is one handler** (`esc-nav.js`). A surface registers a layer on `globalThis.sfEscLayers` (`{ id, z, isOpen, close }`) — never its own `keydown` listener; `tools/test-esc-nav.js` F1 fails if one appears. A sidebar click closes surfaces through `window.sfOverlayClosers`.
- **Player name matching:** `tools/name-canon.js` is the archetype name join (founder ruling 2026-09-19: never join on surname alone). Which module matches odds-feed names to fixtures: —
- **Schema-version guards** live in `bsp-pipeline.js` (`PROFILE_SCHEMA_VERSION`, `TOURNAMENT_HISTORY_SCHEMA_VERSION`, `CAREER_HISTORY_SCHEMA_VERSION`, …). A cached entry whose `v` differs is rejected and rebuilt, so a bump forces a rebuild of that cache on the next run. Which caches rebuild on their own and which need forcing: —
- **Looks broken but isn't:** the Postgres suites (`test-pinnacle-archive-sql`, `test-pinarch-roundtrip` DB part, `test-historical-archive-sql`, `test-archive-ledger`) print `SKIP … NOT A PASS` on a machine without Postgres binaries; the code gate runs them.
