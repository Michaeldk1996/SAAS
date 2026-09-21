---
name: codebase-overview
description: Orientation for the Stennisfy codebase — where things live, what is generated, and what not to touch. Use at the start of any task in an unfamiliar area, instead of exploring the tree to work out the layout.
---

# Stennisfy — codebase orientation

Read this instead of exploring. If something here is wrong or missing, fix this file as part of the task.

## Entry points

| Thing | Where | Notes |
|---|---|---|
| Frontend | **`<FILL IN>`** | The old single-file `bsp-consult-dashboard.html` is no longer the frontend. Served live at `michaeldk1996.github.io/SAAS/` |
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

**<FILL IN — a few lines that would have saved you an hour the first time.>**

Candidates: which module owns player name matching; where the schema-version guards live and what bumping one triggers; which caches rebuild on their own and which need forcing; anything that looks broken but isn't.
