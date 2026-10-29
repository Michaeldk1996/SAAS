#!/usr/bin/env node
// tools/publish-site.mjs — lay the gated CODE over the newest DATA and stamp the result (publish.yml).
//
//   node tools/publish-site.mjs --code <checkout of the gated sha> --site <dir holding the pipeline's site-data>
//   env: CODE_SHA (40 hex, the gated commit), TIP (origin/main), DATA_RUN_ID, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
//
// 1. tools/site-code.sh copies every code file (the one list pipeline.yml uses too) from --code over --site;
// 2. the public Supabase config replaces the dashboard's placeholders (the step pipeline.yml runs on its copy);
// 3. every code file must be present and non-empty, or nothing is written and the run fails;
// 4. build-info.json + <meta name="build-sha"> carry the CODE commit (TEN-255: one sha, 40 hex, read back after
//    writing). build-info.json also names the data it was published with (`data`: the pipeline run, its commit and
//    build time), so the live site says which code and which data it serves.
// Exit 1 on any failure: publish.yml then deploys nothing and the live site stays as it is.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CODE_REQUIRED = ['index.html', 'bsp-consult-dashboard.html', 'auth.html', 'account.html', 'funnel.html', 'verify.html',
  'auth.js', 'analytics.js', 'house-ratings.js', 'live-tab.js', 'kibl-now-stream.js', 'price-history-box.js', 'line-prices.js', 'holdbreak-heatmap.js',
  'player-profile-v2.js', 'settlement.js', 'market-edge-core.js', 'tournament-identity.js', 'h2h-core.js', 'wue-sheet.js', 'draw-view.js', 'esc-nav.js', 'pbp-integrity.js', 'series.js', 'series.css', 'tokens.css', 'theme.js',
  'drops-page.js', 'drops-page.css', 'picks-core.js', 'picks-store.js', 'picks-page.js', 'picks-drawer.js', 'picks-shell.js', 'picks-page.css', 'bettracker-math.js', 'bettracker-store.js', 'bettracker-page.js', 'bettracker-page.css', 'bettracker-import.js', 'bettracker-seed.js',
  'assets/logo-dark-transparent.png', 'assets/ring-transparent.png'];
const DASH = ['index.html', 'bsp-consult-dashboard.html'];
const ANCHOR = '<meta charset="UTF-8">';

const fail = (msg) => { throw new Error(msg); };

export function publish({ code, site, env = process.env }) {
  const sha = env.CODE_SHA || '';
  if (!/^[0-9a-f]{40}$/.test(sha)) fail(`CODE_SHA is not a 40-char hex commit: ${JSON.stringify(sha)}`);
  const dataInfoFile = path.join(site, 'build-info.json');
  if (!fs.existsSync(path.join(site, 'matches.json'))) fail(`${site} holds no pipeline data (matches.json missing)`);
  const dataInfo = fs.existsSync(dataInfoFile) ? JSON.parse(fs.readFileSync(dataInfoFile, 'utf8')) : {};

  // 1. code over data — with the GATED checkout's own file list (founder 2026-10-21). The tip's list named draw-view.js
  // while the gated code (e3cc5f0dd) predated it: every publish failed "cp: cannot stat" until the gate caught up.
  execFileSync('bash', [path.join(code, 'tools', 'site-code.sh'), code, site], { stdio: 'inherit' });

  // 2. public Supabase config (placeholders stay when the secrets are absent, as pipeline.yml does)
  if (env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) {
    const url = env.SUPABASE_URL.replace(/\/+$/, '');
    for (const f of DASH) {
      const p = path.join(site, f);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split('__SUPABASE_URL__').join(url).split('__SUPABASE_ANON_KEY__').join(env.SUPABASE_PUBLISHABLE_KEY));
      if (/__SUPABASE_URL__|__SUPABASE_ANON_KEY__/.test(fs.readFileSync(p, 'utf8'))) fail(`Supabase placeholder left in ${f}`);
    }
  }

  // 3. completeness
  for (const f of CODE_REQUIRED) {
    const p = path.join(site, f);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) fail(`MISSING from the published site: ${f}`);
  }

  // 4. stamp (the code commit) — read back the way a probe reads it
  const info = {
    commit: sha,
    tip: env.TIP || null,
    behindTip: env.BEHIND != null && env.BEHIND !== '' ? Number(env.BEHIND) : -1,
    onMain: env.ON_MAIN === 'true',
    event: env.GITHUB_EVENT_NAME || null,
    runId: env.GITHUB_RUN_ID || null,
    runNumber: env.GITHUB_RUN_NUMBER ? Number(env.GITHUB_RUN_NUMBER) : null,
    builtAt: new Date().toISOString(),
    publishedBy: 'publish.yml',
    data: { runId: env.DATA_RUN_ID || dataInfo.runId || null, commit: dataInfo.commit || null, builtAt: dataInfo.builtAt || null },
  };
  fs.writeFileSync(dataInfoFile, JSON.stringify(info, null, 2) + '\n');
  const TAG = `<meta name="build-sha" content="${sha}">`;
  for (const f of DASH) {
    const p = path.join(site, f);
    const before = fs.readFileSync(p, 'utf8');
    if (!before.includes(ANCHOR)) fail(`${f} has no ${ANCHOR} to anchor the build-sha meta tag`);
    fs.writeFileSync(p, before.replace(ANCHOR, ANCHOR + '\n' + TAG));
    const found = [...fs.readFileSync(p, 'utf8').matchAll(/<meta name="build-sha" content="([0-9a-f]{40})">/g)].map((m) => m[1]);
    if (found.length !== 1 || found[0] !== sha) fail(`${f}: expected one build-sha tag carrying ${sha}, read back ${JSON.stringify(found)}`);
  }
  const back = JSON.parse(fs.readFileSync(dataInfoFile, 'utf8'));
  if (back.commit !== sha) fail('build-info.json read back a different commit');
  return info;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
  try {
    const info = publish({ code: path.resolve(arg('--code') || '.'), site: path.resolve(arg('--site') || '_site') });
    console.log('Published site stamped:\n' + JSON.stringify(info, null, 2));
  } catch (e) { console.error(`::error title=publish::${e.message}. Nothing is deployed.`); process.exit(1); }
}
