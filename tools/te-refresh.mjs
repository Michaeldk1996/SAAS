#!/usr/bin/env node
// TEN-443 · keep the Tennis Explorer store current (founder ruling 2026-10-17, comment 49d2974c item 1). Runs on GitHub
// Actions (.github/workflows/te-refresh.yml), never on a laptop; reachability from an Actions runner was measured first
// (6/6 pages 200, parse, no challenge, 2026-10-17).
//
//   --mode weekly   every matched player: his profile page and his CURRENT season (also last season in January, for
//                   late-December ties), plus any past season whose TE table changed against the stored table (a TE
//                   correction), plus seasons TE lists that the store lacks.
//                   A roster player the store has never seen gets his FULL history on this first run.
//   --mode reread   the monthly full re-read, spread over the month: each run re-reads EVERY season of 1/28 of the
//                   players (by day of year), so each player is fully re-read every 28 days. One monthly job would be
//                   ~5,300 pages (~13 h) — past the 6 h Actions job limit.
// Every changed row is reported old -> new (te-refresh-report.json + the job summary).
//
// The rules, each a test (tools/test-te-refresh.mjs):
//   * one request at a time, 8–10 s apart (te-scrape.mjs page()); a non-200 or a challenge page stops the run;
//   * ALL OR NOTHING: the new store is built in a temp copy and passes the guard (te-history-guard.mjs, against the
//     COMMITTED index) before a single file in the repo is touched. A block, a refused player, a short store or a guard
//     failure leaves the last good store exactly as it was and exits non-zero — the workflow alerts; nothing writes an
//     empty or partial store;
//   * identity is the date of birth: api-tennis's player_bday (the licensed feed) for a new player; a player whose DOB
//     does not match is reported unmatched, never guessed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg('--root', path.join(path.dirname(new URL(import.meta.url).pathname), '..')));
const MODE = arg('--mode', 'weekly');
// `--part i/n`: this run refreshes only its 1/n of the roster (a stable split by key), so a roster too large for one
// Actions job runs as n sequential jobs (founder 2026-10-17, comment cd899856 item 3).
const [PART, PARTS] = String(arg('--part', '0/1')).split('/').map(Number);
if (!(PARTS >= 1 && PART >= 0 && PART < PARTS)) { console.error(`bad --part ${arg('--part')}`); process.exit(2); }
// TIME BUDGET. The job's own timeout (te-refresh.yml timeout-minutes 300) would kill a run mid-write; the tool stops
// first. Before fetching it estimates the run (pages × the measured 9.02 s per page, 2026-10-17, 1,748 requests) and
// refuses one that cannot fit; while running it stops at the budget. Either way it writes NOTHING (all or nothing)
// and exits 1, so the alert fires and says to split (--part).
const BUDGET_MIN = Number(process.env.TE_BUDGET_MIN || 270);
const SEC_PER_PAGE = Number(process.env.TE_SEC_PER_PAGE || 9.02);
const NEW_PLAYER_PAGES = 17;   // name search + profile + ~15 seasons (the roster's mean career, measured 2026-10-17)
const T0 = Date.now();
if (!['weekly', 'reread'].includes(MODE)) { console.error(`unknown --mode ${MODE}`); process.exit(2); }
process.env.TE_CACHE = process.env.TE_CACHE || fs.mkdtempSync(path.join(os.tmpdir(), 'te-refresh-cache-'));
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'te-refresh-out-'));
if (!process.argv.includes('--out')) process.argv.push('--out', ROOT);   // the builder reads the committed catalogue from the repo

const S = await import('./te-scrape.mjs');
const B = await import('./te-build-history.mjs');
const G = await import('./te-history-guard.mjs');

const NOW = new Date(process.env.TE_NOW || Date.now());
const YEAR = NOW.getUTCFullYear();
const DAY = Math.floor((NOW - Date.UTC(YEAR, 0, 1)) / 864e5);

async function apiTennisPlayer(key) {
  const k = process.env.API_TENNIS_KEY;
  if (!k) return null;
  const r = await fetch(`https://api.api-tennis.com/tennis/?method=get_players&APIkey=${k}&player_key=${key}`);
  const j = await r.json().catch(() => null);
  const p = j && Array.isArray(j.result) ? j.result[0] : null;
  if (!p || !p.player_bday) return null;
  const [d, m, y] = String(p.player_bday).split('.');
  const full = String(p.player_full_name || '').trim().split(/\s+/);
  return { dob: `${y}${m}${d}`, first: full.slice(0, -1).join(' '), last: full.slice(-1)[0] || null, country: p.player_country || null };
}

// The roster is EVERY player the site serves a profile for (player-index.json `hasProfile`, 727 on 2026-10-17), not
// the eager player-profiles.json subset (founder ruling 2026-10-17, gate d6814167 "all_profiles"). A test may pass
// either shape through TE_ROSTER (an index list, or a profiles store `{players:{key:{…}}}`).
async function loadRoster() {
  const src = process.env.TE_ROSTER || 'https://michaeldk1996.github.io/SAAS/player-index.json';
  const j = /^https?:/.test(src) ? await (await fetch(`${src}?cb=${Date.now()}`)).json() : JSON.parse(fs.readFileSync(src, 'utf8'));
  const list = Array.isArray(j) ? j : Array.isArray(j.players) ? j.players : null;
  if (list) return list.filter((p) => p && p.hasProfile).map((p) => ({ key: String(p.key), name: p.name, country: p.country, age: p.age }));
  return Object.entries(j.players || {}).filter(([, p]) => p && p.careerByYear).map(([key, p]) => ({ key, name: p.name, country: p.country, age: p.age }));
}

const rowKey = (r) => `${r.date}|${r.oppSlug || r.opp}|${r.event}|${r.round}`;
const FIELDS = ['season', 'won', 'score', 'surface', 'court', 'cat', 'wo', 'ret'];
function diffRows(oldRows, newRows) {
  const o = new Map(oldRows.map((r) => [rowKey(r), r])), n = new Map(newRows.map((r) => [rowKey(r), r]));
  const out = [];
  for (const [k, r] of n) {
    const p = o.get(k);
    if (!p) { out.push({ change: 'added', row: k, new: r }); continue; }
    const f = FIELDS.filter((x) => JSON.stringify(p[x] ?? null) !== JSON.stringify(r[x] ?? null));
    if (f.length) out.push({ change: 'changed', row: k, fields: Object.fromEntries(f.map((x) => [x, { old: p[x] ?? null, new: r[x] ?? null }])) });
  }
  for (const [k, r] of o) if (!n.has(k)) out.push({ change: 'removed', row: k, old: r });
  return out;
}

async function main() {
  const idxF = path.join(ROOT, G.INDEX);
  if (!fs.existsSync(idxF)) { console.log(`::error::${G.INDEX} is missing — the refresh never builds a store from nothing`); process.exit(1); }
  const idx = JSON.parse(fs.readFileSync(idxF, 'utf8'));
  // the new store starts as an exact copy of the committed one
  fs.cpSync(path.join(ROOT, G.STORE_DIR), path.join(OUT_DIR, G.STORE_DIR), { recursive: true });
  const roster = await loadRoster();
  const report = { mode: MODE, at: NOW.toISOString(), players: 0, newPlayers: [], unmatched: [], refused: [], seasonsFetched: 0, changes: {} };
  const slice = (k) => [...String(k)].reduce((s, c) => s + c.charCodeAt(0), 0) % 28 === DAY % 28;
  const inPart = (k) => [...String(k)].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 1000003, 7) % PARTS === PART;
  const mine = roster.filter((p) => inPart(p.key));
  // pre-flight: what this run will fetch, at the measured pace
  const estPages = mine.reduce((s, p) => { const k = idx.players[p.key];
    if (!k) return s + NEW_PLAYER_PAGES;
    if (MODE === 'reread') return s + (slice(p.key) ? 1 + (k.seasons || 0) : 0);
    return s + 2 + (NOW.getUTCMonth() === 0 ? 1 : 0); }, 0);
  const estMin = estPages * SEC_PER_PAGE / 60;
  report.part = `${PART}/${PARTS}`; report.estimate = { players: mine.length, pages: estPages, minutes: Math.round(estMin), budgetMinutes: BUDGET_MIN };
  console.log(`te-refresh ${MODE} part ${PART}/${PARTS}: ${mine.length} players · est ${estPages} pages ≈ ${Math.round(estMin)} min of a ${BUDGET_MIN} min budget`);
  if (estMin > BUDGET_MIN) {
    fs.writeFileSync(path.join(ROOT, 'te-refresh-report.json'), JSON.stringify(report, null, 1));
    console.log(`::error::te-refresh would need ~${Math.round(estMin)} min (${estPages} pages × ${SEC_PER_PAGE} s) for ${mine.length} players, past the ${BUDGET_MIN} min budget — split the run (--part i/n); nothing fetched, the store is unchanged`);
    process.exit(1);
  }
  const nextIdx = { ...idx, players: { ...idx.players }, unmatched: { ...(idx.unmatched || {}) } };

  for (const p of mine) {
    if ((Date.now() - T0) / 60000 > BUDGET_MIN) {
      console.log(`::error::te-refresh hit its ${BUDGET_MIN} min budget after ${report.players} of ${mine.length} players — stopped before the job timeout; nothing written, the last good store is unchanged; split the run (--part i/n)`);
      process.exit(1);
    }
    const known = idx.players[p.key];
    // the daily re-read touches only its 1/28 slice (and any new player); everyone else keeps his file this run
    if (MODE === 'reread' && known && !slice(p.key)) continue;
    let slug = known && known.slug, dob = known && known.dob, isNew = false;
    if (!known) {
      const id = await apiTennisPlayer(p.key);   // the licensed feed's DOB is the identity test
      const r = await S.resolve({ ...p, ...(id || {}), dob: id && id.dob });
      if (!r.slug) { nextIdx.unmatched[p.key] = { why: r.unmatched, at: NOW.toISOString() }; report.unmatched.push({ key: p.key, name: p.name, why: r.unmatched }); continue; }
      slug = r.slug; dob = r.dob; isNew = true; delete nextIdx.unmatched[p.key];
    }
    const f = path.join(OUT_DIR, G.STORE_DIR, `${p.key}.json`);
    const old = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    const oldRows = old ? B.rowsOf(old) : [];
    const mainHtml = await S.page(`/player/${slug}/`);
    const facts = S.profileFacts(mainHtml);
    const fresh = B.parseBalance(mainHtml) || {};
    const want = new Set();
    if (isNew || (MODE === 'reread' && slice(p.key))) facts.years.forEach((y) => want.add(y));   // full history
    else {
      want.add(YEAR); if (NOW.getUTCMonth() === 0) want.add(YEAR - 1);
      for (const y of facts.years) {
        const stored = old && old.balance && old.balance[String(y)];
        if (!stored || JSON.stringify(stored) !== JSON.stringify(fresh[String(y)])) want.add(y);   // new season or a TE correction
      }
    }
    const seasonHtml = {};
    for (const y of facts.years.filter((y) => want.has(y))) { seasonHtml[y] = await S.page(`/player/${slug}/?annual=${y}`); report.seasonsFetched++; }
    const built = B.buildPlayerRecord({ key: p.key, slug, dob, name: (old && old.name) || p.name, mainHtml, seasonHtml,
      keepRows: oldRows.filter((r) => !(String(r.season) in seasonHtml)), builtAt: NOW.toISOString() });
    if (built.refuse) { report.refused.push({ key: p.key, name: p.name, why: built.refuse, bad: built.bad }); continue; }
    const changes = diffRows(oldRows, built.rec.rows);
    if (changes.length && !isNew) report.changes[p.key] = { name: p.name, changes };
    if (isNew) report.newPlayers.push({ key: p.key, name: p.name, slug, seasons: facts.years.length, rows: built.rec.rows.length });
    fs.writeFileSync(f, B.serialise(built.rec));
    nextIdx.players[p.key] = { slug, dob: dob || null, rows: built.rec.rows.length, seasons: facts.years.length };
    report.players++;
  }
  nextIdx.builtAt = NOW.toISOString();
  nextIdx.totalRows = Object.values(nextIdx.players).reduce((s, x) => s + x.rows, 0);
  const n = Object.keys(nextIdx.players).length;
  nextIdx.highWater = { totalRows: Math.max(idx.highWater?.totalRows || 0, nextIdx.totalRows), players: Math.max(idx.highWater?.players || 0, n) };
  fs.writeFileSync(path.join(OUT_DIR, G.INDEX), JSON.stringify(nextIdx, null, 1));
  fs.writeFileSync(path.join(ROOT, 'te-refresh-report.json'), JSON.stringify(report, null, 1));

  // a refused player keeps his previous file — but the run says so loudly and fails, so the alert fires
  const guard = G.checkStore(OUT_DIR, { prev: idx });
  if (!guard.ok || report.refused.length) {
    console.log(`::error::te-refresh refused to write: ${[...guard.why, ...report.refused.map((r) => `${r.key} ${r.name}: ${r.why}`)].join('; ')} — the last good store is unchanged`);
    process.exit(1);
  }
  // all checks passed: swap the new store in
  fs.rmSync(path.join(ROOT, G.STORE_DIR), { recursive: true, force: true });
  fs.cpSync(path.join(OUT_DIR, G.STORE_DIR), path.join(ROOT, G.STORE_DIR), { recursive: true });
  fs.copyFileSync(path.join(OUT_DIR, G.INDEX), path.join(ROOT, G.INDEX));
  // every changed row, old -> new, kept in the repo (an Actions artifact expires; this log does not)
  const logLines = Object.entries(report.changes).flatMap(([key, x]) => x.changes.map((c) => JSON.stringify({ at: report.at, mode: MODE, key, name: x.name, ...c })));
  for (const nw of report.newPlayers) logLines.push(JSON.stringify({ at: report.at, mode: MODE, key: nw.key, name: nw.name, change: 'new player', seasons: nw.seasons, rows: nw.rows }));
  if (logLines.length) fs.appendFileSync(path.join(ROOT, 'te-refresh-log.jsonl'), logLines.join('\n') + '\n');
  const nChanged = Object.values(report.changes).reduce((s, x) => s + x.changes.length, 0);
  console.log(`te-refresh ${MODE}: ${report.players} players · ${report.seasonsFetched} season pages · ${report.newPlayers.length} new · ${report.unmatched.length} unmatched · ${nChanged} rows changed · requests ${S.stats().requests}`);
}
main();
