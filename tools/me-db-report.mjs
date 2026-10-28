#!/usr/bin/env node
// One price per match (founder 2026-10-17, standing) — the FULL Market edge check, report only.
// tools/price-consistency.mjs checks Market edge on 2026 matches plus a 1-in-10 player sample, so a stale shard of a
// player outside the sample can ship unseen (28 Oct 2026: 14 matches on 7 players). This report compares EVERY priced
// row of every market-edge/{key}.json shard on the site with the Database rows the page's price join reads
// (database-yield.json rows + retRows + tieRows, and the era shard database-yield-x.json): same day, the opponent's
// Tennis-Data spelling and the result pick the row; its winner / loser prices and book must equal the shard's.
// It never fails the run and changes no threshold: counts go to the step summary, a difference is a ::warning::.
// Usage: node tools/me-db-report.mjs --site _site [--out .me-db-report.json]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { DB_BOOK } = require('../build-market-edge.js');

const iso = d => { const s = String(d); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s; };
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-']/g, ' ');
const words = t => norm(t).split(/[\s.]+/).filter(w => w.length >= 2);
const bookOf = code => (DB_BOOK[code] || ['code ' + code])[0];

// The Database rows the join reads, by day. Row: [date, …, favPrice(5), dogPrice(6), favWon(7), book(8)].
export function databaseIndex(db, names, era) {
  const byDay = new Map(); let n = 0;
  const add = (r, nm, kind) => {
    if (!r || !nm) return; n++;
    const k = iso(r[0]); if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push({ w: nm[0], l: nm[1], pw: r[7] ? r[5] : r[6], pl: r[7] ? r[6] : r[5], book: bookOf(r[8]), kind });
  };
  (db.rows || []).forEach((r, i) => add(r, (names.names || [])[i], 'rows'));
  (db.retRows || []).forEach((r, i) => add(r, (names.retNames || [])[i], 'retRows'));
  (db.tieRows || []).forEach((r, i) => add(r, (names.tieNames || [])[i], 'tieRows'));
  if (era) (era.xRows || []).forEach((r, i) => add(r, (era.xNames || [])[i], 'era'));
  return { byDay, n };
}

// Every priced shard row against its Database row.
export function compare(shards, idx, exMax = 20) {
  const S = { players: 0, rows: 0, same: 0, differ: 0, noDbRow: 0, ambiguous: 0, ex: { differ: [], noDbRow: [], ambiguous: [] } };
  for (const s of shards) {
    S.players++;
    const mine = words(s.name);
    for (const m of s.matches || []) {
      if (m.price == null) continue;
      S.rows++;
      const tag = { key: s.playerKey, name: s.name, date: m.date, opp: m.opp, won: !!m.won, me: [m.price, m.oppPrice, m.book] };
      let c = (idx.byDay.get(m.date) || []).filter(o => (m.won ? o.l : o.w) === m.opp);
      if (c.length > 1) c = c.filter(o => { const w = words(m.won ? o.w : o.l); return mine.some(t => w.includes(t)); });
      if (!c.length) { S.noDbRow++; if (S.ex.noDbRow.length < exMax) S.ex.noDbRow.push(tag); continue; }
      if (c.length > 1) { S.ambiguous++; if (S.ex.ambiguous.length < exMax) S.ex.ambiguous.push(tag); continue; }
      const o = c[0], p = m.won ? o.pw : o.pl, q = m.won ? o.pl : o.pw;
      if (p === m.price && q === m.oppPrice && o.book === m.book) S.same++;
      else { S.differ++; if (S.ex.differ.length < exMax) S.ex.differ.push(Object.assign(tag, { db: [p, q, o.book, o.kind] })); }
    }
  }
  S.status = S.rows === 0 ? 'skipped' : (S.differ + S.noDbRow + S.ambiguous ? 'differences' : 'ok');
  return S;
}

export function lines(S, dbN) {
  if (S.status === 'skipped') return [`Market edge vs Database: SKIPPED — no priced Market edge row on the site (${S.players} shards), nothing was compared.`];
  const out = [`Market edge vs Database (every shard row, report only): ${S.same} of ${S.rows} priced rows in ${S.players} player shards equal their Database row (${dbN} Database rows); ${S.differ} differ, ${S.noDbRow} have no Database row, ${S.ambiguous} match two.`];
  const f = t => `${t.name} v ${t.opp}, ${t.date} (${t.won ? 'won' : 'lost'}): Market edge ${t.me.join(' / ')}` + (t.db ? `, Database ${t.db.slice(0, 3).join(' / ')}` : '');
  for (const k of ['differ', 'noDbRow', 'ambiguous']) for (const t of S.ex[k]) out.push(`  ${k}: ${f(t)}`);
  return out;
}

function main(argv) {
  const arg = k => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1]; };
  const site = arg('--site') || '_site', out = arg('--out');
  const J = f => JSON.parse(fs.readFileSync(path.join(site, f), 'utf8'));
  const eraPath = path.join(site, 'database-yield-x.json');
  const idx = databaseIndex(J('database-yield.json'), J('database-yield-players.json'), fs.existsSync(eraPath) ? J('database-yield-x.json') : null);
  const dir = path.join(site, 'market-edge');
  const shards = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
  const S = compare(shards, idx);
  const L = lines(S, idx.n);
  console.log(L.join('\n'));
  if (S.status !== 'ok') console.log(`::warning title=Market edge vs Database::${L[0]}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Market edge vs Database\n\n' + L.map(l => '    ' + l).join('\n') + '\n\n');
  if (out) fs.writeFileSync(out, JSON.stringify(Object.assign({ databaseRows: idx.n }, S), null, 1));
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
