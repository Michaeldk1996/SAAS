// TEN-8 — maintained Winners/Unforced-Errors harvest, BOTH pools (Tour + Challenger).
// Founder directive 2026-08-10: this store must be MAINTAINED, not pulled once.
// Runs weekly in CI (wue-harvest.yml) and writes wue-store.json committed to main.
//
// Source: api-tennis get_fixtures per player, full 2024-03..present window,
//   statistics[] parsed at match period. W/UE box-score horizon starts 2024-03-06.
// Semantics (kept identical to the original harvest so the store is stable):
//   w = Winners.stat_value, ue = Unforced errors.stat_value, tp = Total Points Won.stat_total
//   literal-0 W&UE => absent data (dropped); singles + Finished only.
//   2026 feed lowercased stat names — match case-insensitively.
//
// Roster: wue-roster.json (committed; 383 players with player_key, pool, rank,
//   plus charted / sr counts carried through for the coverage report).
// API key: API_TENNIS_KEY env (CI secret) or repo .env fallback for local runs.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = f => path.join(ROOT, f);

function apiKey() {
  if (process.env.API_TENNIS_KEY) return process.env.API_TENNIS_KEY.trim();
  for (const p of [P('.env'), '/Users/Michael/bsp-consult-project/.env']) {
    try { const m = fs.readFileSync(p, 'utf8').match(/API_TENNIS_KEY=(.+)/); if (m) return m[1].trim(); } catch {}
  }
  return null;
}
const KEY = apiKey();
if (!KEY) { console.error('::error::no API_TENNIS_KEY'); process.exit(1); }

const BASE = 'https://api.api-tennis.com/tennis/';
const today = process.env.WUE_TODAY || new Date().toISOString().slice(0, 10); // WUE_TODAY overridable for determinism
const startYear = 2024, endYear = parseInt(today.slice(0, 4), 10);
const YEARS = {};
for (let y = startYear; y <= endYear; y++) {
  YEARS[y] = [y === 2024 ? '2024-03-01' : `${y}-01-01`, y === endYear ? today : `${y}-12-31`];
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : null; };

const roster = JSON.parse(fs.readFileSync(P('wue-roster.json'), 'utf8')).roster;
console.log(`roster: ${roster.length} players (${roster.filter(r => r.pool === 'Tour').length} Tour / ${roster.filter(r => r.pool !== 'Tour').length} Challenger); horizon 2024-03-06..${today}`);

async function getFixtures(key, year) {
  const [ds, de] = YEARS[year];
  const url = `${BASE}?method=get_fixtures&APIkey=${KEY}&player_key=${key}&date_start=${ds}&date_stop=${de}`;
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(url); const j = await r.json(); return Array.isArray(j.result) ? j.result : []; }
    catch { await sleep(1500); }
  }
  return [];
}

function aggregate(fixtures, key) {
  let w = 0, ue = 0, tp = 0, n_wue = 0, n_fin = 0, n_zero = 0, n_absent = 0;
  const perYear = {};
  for (const m of fixtures) {
    if (m.event_status !== 'Finished') continue;
    if (!/singles/i.test(m.event_type_type || '')) continue;
    n_fin++;
    const yr = (m.event_date || '').slice(0, 4);
    const stx = (m.statistics || []).filter(s => s.stat_period === 'match' && String(s.player_key) === String(key));
    const get = nm => stx.find(s => (s.stat_name || '').toLowerCase() === nm);
    const wr = get('winners'), uer = get('unforced errors'), tpr = get('total points won');
    if (!wr || !uer || !tpr) { n_absent++; continue; }
    const wv = num(wr.stat_value), uv = num(uer.stat_value), tv = num(tpr.stat_total);
    if (wv == null || uv == null || !tv) { n_absent++; continue; }
    if (wv === 0 && uv === 0) { n_zero++; continue; }
    w += wv; ue += uv; tp += tv; n_wue++;
    perYear[yr] = (perYear[yr] || 0) + 1;
  }
  return {
    winners: w, unforced: ue, totalPoints: tp, n_wue, n_finished: n_fin, n_zeroSkipped: n_zero, n_absent,
    winnerRate: tp ? +(100 * w / tp).toFixed(2) : null,
    unforcedRate: tp ? +(100 * ue / tp).toFixed(2) : null,
    ratio: ue ? +(w / ue).toFixed(3) : null,
    perYear,
  };
}

const out = {};
let done = 0;
for (const p of roster) {
  let all = [];
  for (const y of Object.keys(YEARS)) all = all.concat(await getFixtures(p.key, y));
  const a = aggregate(all, p.key);
  out[p.name] = { pool: p.pool, rank: p.rank, playerKey: p.key, charted: p.charted ?? null, sr: p.sr ?? null, ...a };
  await sleep(280);
  if (++done % 25 === 0) console.log(`[${done}/${roster.length}] ${p.name} fin=${a.n_finished} wue=${a.n_wue} zero=${a.n_zeroSkipped}`);
}

const withWue = Object.values(out).filter(o => o.n_wue > 0);
const meta = {
  generated: today, horizon: `2024-03-06..${today}`,
  source: 'api-tennis get_fixtures, statistics[] match-period; Winners/Unforced errors/Total Points Won',
  filter: 'literal-0 W&UE dropped as absent; singles + Finished only',
  players: roster.length, withAnyWue: withWue.length,
  tour_total: roster.filter(r => r.pool === 'Tour').length,
  chall_total: roster.filter(r => r.pool !== 'Tour').length,
};
fs.writeFileSync(P('wue-store.json'), JSON.stringify({ _meta: meta, players: out }, null, 2));
console.log('WROTE wue-store.json'); console.log(JSON.stringify(meta, null, 2));
