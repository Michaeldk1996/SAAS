#!/usr/bin/env node
// Read-only measurement: write the full report (compose.mjs) for every finished match of the live news ticker in a
// scratch folder and print each text with its fact-check result. Publishes nothing. Needs ANTHROPIC_API_KEY.
// Usage: node tools/news-ticker/compose-probe.mjs [--base URL] [--only 1681]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, ''), only = arg('only', null);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-probe-'));
const get = async (p) => { const r = await fetch(`${BASE}/${p}`, { signal: AbortSignal.timeout(90000) }); if (!r.ok) return null; const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return f; };
for (const f of ['matches.json', 'draw-matches.json', 'mto-matches.json', 'surface-ratings.json', 'player-index.json', 'tournament-progression.json', 'news-ticker.json', 'playing-styles.json']) await get(f);
const ix = JSON.parse(fs.readFileSync(path.join(dir, 'news-ticker.json'), 'utf8'));
for (const t of ix.tournaments || []) await get(t.file);
const cards = [...Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'matches.json'), 'utf8'))), ...Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'draw-matches.json'), 'utf8')).matches || {}).map((x) => x.match)]
  .filter((m) => m && m.tourBadge === 'ATP' && (!only || String(m.tournamentKey) === only));
if (only) { const b = JSON.parse(fs.readFileSync(path.join(dir, 'matches.json'), 'utf8')); fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify(Object.fromEntries(Object.entries(b).filter(([, m]) => m && String(m.tournamentKey) === only)))); }
const keys = new Set(), eks = new Set();
for (const m of cards) { eks.add(String(m.id).split('-').slice(1).join('-')); keys.add(m.p1Key); keys.add(m.p2Key); }
for (const e of eks) await get(`pbp/${e}.json`);
for (const k of keys) if (k != null) await get(`career-history/${k}.json`);
fs.cpSync(path.join(ROOT, 'news-quotes'), path.join(dir, 'news-quotes'), { recursive: true });
if (fs.existsSync(path.join(ROOT, 'data'))) fs.cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
process.argv.push('--dir', dir);
const { build } = await import('./build-news-ticker.mjs');
const s = await build({ nowIso: new Date().toISOString(), times: null });
for (const f of fs.readdirSync(path.join(dir, 'news-ticker'))) {
  for (const x of JSON.parse(fs.readFileSync(path.join(dir, 'news-ticker', f), 'utf8')).items || []) {
    if (x.type !== 'report' || !x.composed) continue;
    console.log(`\n######## ${x.id} ${x.player} d. ${x.opponent} (${x.round}) — ${x.composed.status}, ${x.composed.tries} tr${x.composed.tries === 1 ? 'y' : 'ies'}${x.composed.failures ? ' — ' + x.composed.failures.join(' | ') : ''}`);
    console.log(x.text);
  }
}
console.log('\nCOMPOSE-PROBE ' + JSON.stringify({ composed: s.composed || 0, failed: s.composeFailed || 0, failures: s.composeFailures || [], reports: s.reports, errors: s.voice.errors, lastError: s.voice.lastError, tokens: s.voice.tokens, reportErrors: s.reportErrors }));
