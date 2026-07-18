# BSP pipeline automation

Two layers keep the data fresh. The **cloud** layer is the reliable one; the
**local** layer is a hardened fallback for running on this Mac.

---

## Why this exists

The pipeline used to run only via `launchd` on this laptop every 30 min. When
the machine slept or lost network overnight, runs failed silently
(`getaddrinfo ENOTFOUND`, connection resets) and the dashboard served stale
data with no warning — e.g. finished first-round matches showed no score and
were missing from Tournament Reports. A laptop **cannot** guarantee scheduled
runs while it is asleep/off, so the durable fix is to run the scheduler off the
laptop.

---

## Layer 1 — Cloud (primary): GitHub Actions + Pages

`.github/workflows/pipeline.yml` runs the pipeline every 15 min in GitHub's
cloud and publishes the dashboard to GitHub Pages. This is independent of the
laptop being awake or online.

### One-time setup (you must do these — they need your account/credentials)

1. **Create a GitHub repo and push** this project:
   ```
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
2. **Add the two API keys as repo secrets** (Settings → Secrets and variables →
   Actions → New repository secret):
   - `ODDS_API_KEY`
   - `API_TENNIS_KEY`
   (These come from your local `.env`. `.env` itself is git-ignored — never
   commit it.)
3. **Enable Pages**: Settings → Pages → Source → **GitHub Actions**.
4. (Recommended) **Seed the caches** so the first cloud run is fast and doesn't
   hammer the APIs rebuilding everything from scratch. Commit the current
   derived caches once:
   ```
   git add -f player-profiles-cache.json player-profiles.json \
     player-tournament-history.json historical-match-stats.json \
     tournament-profiles.json tml-cache
   git commit -m "Seed pipeline caches for CI"
   git push
   ```
   After the first run, Actions cache keeps them warm; you can remove them from
   git tracking again if you prefer (`git rm --cached ...`).

### How it behaves

- Runs every 15 min (UTC) and on manual **Run workflow**.
- Uses `run-pipeline.js` (retry + backoff + health tracking) so a transient
  provider hiccup self-heals within the run.
- Publishes `index.html` (the dashboard) plus the 4 JSON files it fetches to
  Pages. The 44 MB `player-profiles.json` is served as an **ephemeral Pages
  artifact**, so it does not bloat git history.
- The final step **fails the job** if the run didn't produce a fresh success —
  GitHub then notifies you, and the published `pipeline-health.json` drives the
  in-dashboard banner (below).

> Note: GitHub's scheduled triggers can be delayed a few minutes under load and
> may skip during major incidents — far more reliable than a sleeping laptop,
> but not a hard real-time guarantee. For second-level freshness you'd move to
> an always-on VPS with cron; the same `run-pipeline.js` works there unchanged.

---

## Layer 2 — Local (fallback): hardened launchd

For when you also want the data current on this Mac itself.

### What changed

- **`run-pipeline.js`** now wraps `bsp-pipeline.js`:
  - waits for the network to actually be reachable before starting (handles
    wake-from-sleep where Wi-Fi isn't up yet),
  - retries the whole run up to 5× with exponential backoff on failure,
  - writes **`pipeline-health.json`** (`lastSuccess`, `consecutiveFailures`,
    `lastError`, run history) after every run.
- **`com.bspconsult.pipeline.plist`** now calls `run-pipeline.js` instead of
  `bsp-pipeline.js` directly. Reload after editing:
  ```
  launchctl unload ~/Library/LaunchAgents/com.bspconsult.pipeline.plist
  launchctl load  ~/Library/LaunchAgents/com.bspconsult.pipeline.plist
  ```
- **Dashboard banner**: the dashboard reads `pipeline-health.json` and shows a
  full-width banner when data is behind:
  - amber if the last success is > 90 min old,
  - red if ≥ 2 runs in a row have failed (with the last error).
  It stays hidden when everything is current. This makes a missed/failed run
  immediately obvious instead of silent.

### Scheduled wake (reduce overnight gaps)

`launchd` interval jobs don't run while the Mac is asleep, but you can have the
Mac wake itself to run them. Requires admin + being on power:
```
sudo pmset repeat wakeorpoweron MTWRFSU 07:00:00
```
This wakes daily at 07:00; adjust/add times to match when you want a refresh.
It does **not** cover the machine being fully shut down — that's what Layer 1
is for.

---

## How to tell when a run was missed or failed

1. **Dashboard banner** (amber/red) — driven by `pipeline-health.json`.
2. **`pipeline-health.json`** — check `lastSuccess` / `consecutiveFailures` /
   `lastError` directly.
3. **Cloud**: the Actions run shows red and GitHub emails you; the freshness
   assertion step fails on stale data.
4. **Logs**: `pipeline.log` / `pipeline.error.log` (local), timestamped
   `[runner]` lines from the wrapper.

---

## Odds archive (market performance)

The profile "Market performance" block is built from historical **closing** prices that
our own feed does not carry. They live in `odds-archive/*.csv` — one file per season,
2004 to present, mirrored from tennis-data.co.uk and **committed to this repo on
purpose**: the origin was TCP-refused on 2026-07-18, and a build must not depend on it
being up.

- **Refresh the archive** (network, run locally): `python3 mirror-odds-archive.py`
  refreshes the current and previous season; `--all` rebuilds every season. It tries the
  origin first and falls back to a GitHub mirror. Pre-2013 seasons are legacy `.xls` and
  need `pip3 install --user xlrd`; 2013+ are parsed with the stdlib alone.
- **Rebuild the shards** (no network): `node build-odds-performance.js` reads the archive
  plus `player-profiles.json` and writes `odds-performance/{key}.json` +
  `odds-performance-index.json`. The pipeline runs this on every run, so shards always
  match the current profile roster.

Two limits worth knowing before reading the numbers:

1. **The source is tour-level only** — no Challengers, no qualifying. Coverage runs ~92%
   of the top 50 but ~13% below rank 250. Players under 30 priced matches get no shard
   and the block does not render for them at all.
2. **There are no opening prices**, one price per book per match. So this measures
   performance against the *closing* market — it is not closing line value, and nothing
   in the UI may call it that.

Coverage by rank band is printed on every builder run; that report is the fastest way to
see whether a coverage change is real.

---

## Misc

- The `◇ injected env … tip:` line in logs is just **dotenv v17**'s promotional
  banner — harmless. Silence it with `DOTENV_CONFIG_QUIET=true` (already set in
  the workflow) or `require('dotenv').config({ quiet: true })`.
