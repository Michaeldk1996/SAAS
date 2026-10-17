#!/usr/bin/env node
// TEN-443 · build set-repairs.json — the sets api-tennis dropped, repaired where Tennis Explorer AND Sackmann agree
// (founder ruling 2026-10-17, comment b5b5ef00 item 1: "Repair from Tennis Explorer or Sackmann where both agree on
// the full score, and flag every match where they don't or only one source has it. Check all … matches").
// The ONLY writer of set-repairs.json; the pipeline applies it (set-repairs.js) behind SET_REPAIR=1.
//
//   node tools/build-set-repairs.mjs --shards <career-history dir> --te <te-history dir> --sackmann <csv dir>
//        --sack-ids <json: our key -> Sackmann id> --names <json: our key -> {full, name}> --out set-repairs.json
//
// A short row: an api-tennis row whose decided result ("2 - 1") counts more sets than its set list holds.
// Per short row, from the row's player's side:
//   Tennis Explorer — his own TE row (te-join pairRows over his whole history), else the opponent's TE row for the
//                     same api-tennis event key, flipped; usable when its sets make up the result.
//   Sackmann        — atp + qual_chall + futures CSVs (his last commit 5b6263dc48): both players matched (Sackmann
//                     id where joined, else initial + surname), opponent by initial + surname, tourney_date within
//                     [match day − 20 d, + 10 d] (qualifying is dated by the main draw's start); several candidates
//                     resolve only if exactly one fits; usable when its sets make up the result.
//   A source's list is usable only if our short list is an in-order part of it.
// Both usable and the same games set by set -> a repair. Anything else -> a flag naming why.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const J = require('../te-join.js');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SHARDS = arg('--shards'), TE = arg('--te'), SACK = arg('--sackmann'), OUT = arg('--out');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const SIDS0 = readJson(arg('--sack-ids'), {}), NAMES0 = readJson(arg('--names'), {});

// ── our short rows ──────────────────────────────────────────────────────────────────────────────────────────────
const resultOf = (r) => { const m = String(r.result || '').match(/^(\d+)\s*-\s*(\d+)$/); return m ? [+m[1], +m[2]] : null; };
export function isShort(r) {
  if (!r || r.src !== 'fixtures' || !Array.isArray(r.sets) || r.walkover) return false;
  const x = resultOf(r); return !!x && x[0] !== x[1] && x[0] + x[1] > r.sets.length;
}
const g = (sets) => (sets || []).map((s) => `${s.p}-${s.o}`).join(' ');
// a full list fits a short row: it makes up the result and holds the short list in order
export function fits(full, r) {
  const x = resultOf(r); if (!full || !x) return false;
  const w = full.filter((s) => s.p > s.o).length, l = full.filter((s) => s.o > s.p).length;
  if (w !== x[0] || l !== x[1] || w + l !== full.length) return false;
  let j = 0; for (const s of full) if (j < r.sets.length && s.p === r.sets[j].p && s.o === r.sets[j].o) j++;
  return j === r.sets.length;
}

// ── Sackmann ────────────────────────────────────────────────────────────────────────────────────────────────────
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const nameKey = (n) => { const w = fold(String(n).replace(/\./g, '. ')).split(' ').filter(Boolean); return w.length ? { ini: w[0][0], sur: w[w.length - 1], all: w } : null; };
export const sameName = (ours, sack) => { const a = nameKey(ours), b = nameKey(sack); return !!(a && b && a.ini === b.ini && (a.sur === b.sur || b.all.includes(a.sur))); };
const parseCsv = (line) => { const o = []; let cur = '', q = false; for (const c of line) { if (c === '"') q = !q; else if (c === ',' && !q) { o.push(cur); cur = ''; } else cur += c; } o.push(cur); return o; };
export function sackSets(score) {   // winner's side; null unless a clean completed score
  if (!score || /W\/O|DEF|RET|ABD|ABN|unfinished|walkover/i.test(score)) return null;
  const out = [];
  for (const t of score.trim().split(/\s+/)) { const m = t.match(/^(\d+)-(\d+)(?:\(\d+\))?$/); if (!m) return null; out.push({ w: +m[1], l: +m[2] }); }
  return out;
}
const DAY = 864e5;
function loadSackmann(dir) {
  const byWeek = new Map(); let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^atp_matches_(qual_chall_|futures_)?\d{4}\.csv$/.test(x))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/); const h = parseCsv(t[0]); const ix = (k) => h.indexOf(k);
    for (const l of t.slice(1)) {
      if (!l) continue; const c = parseCsv(l); const d = c[ix('tourney_date')];
      const m = { file: f, tname: c[ix('tourney_name')], round: c[ix('round')], date: Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)),
        wid: c[ix('winner_id')], lid: c[ix('loser_id')], wn: c[ix('winner_name')], ln: c[ix('loser_name')], score: c[ix('score')] };
      const w = Math.floor(m.date / DAY / 7); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(m); n++;
    }
  }
  return { byWeek, n };
}
function sackmannFor(S, key, r, SIDS, NAMES) {
  const t = Date.parse(r.date); const w = Math.floor(t / DAY / 7);
  const cand = [w - 3, w - 2, w - 1, w, w + 1, w + 2].flatMap((x) => S.byWeek.get(x) || []).filter((m) => m.date >= t - 20 * DAY && m.date <= t + 10 * DAY);
  const sid = SIDS[key], nm = NAMES[key] || {};
  if (!sid && !nm.full && !nm.name) return { why: 'player not identified in Sackmann' };
  const me = (id, n) => (sid ? id === sid : !!((nm.full && sameName(nm.full, n)) || (nm.name && sameName(nm.name, n))));
  const hits = cand.filter((m) => (me(m.wid, m.wn) && sameName(r.opponent, m.ln)) || (me(m.lid, m.ln) && sameName(r.opponent, m.wn)));
  const sides = hits.map((m) => { const iWon = me(m.wid, m.wn); const s = sackSets(m.score);
    return { m, iWon, full: s && s.map((x) => (iWon ? { p: x.w, o: x.l } : { p: x.l, o: x.w })) }; });
  const ok = sides.filter((x) => x.iWon === !!r.won && fits(x.full, r));
  if (ok.length === 1) return { full: ok[0].full, ref: `${ok[0].m.file} ${ok[0].m.tname} ${ok[0].m.round} "${ok[0].m.score}"` };
  if (!hits.length) return { why: 'no Sackmann match' };
  if (ok.length > 1) return { why: `${ok.length} Sackmann matches fit` };
  const x = sides[0]; return { why: `Sackmann "${x.m.score}" does not fit`, ref: `${x.m.file} ${x.m.tname} ${x.m.round} "${x.m.score}"` };
}

// ── Tennis Explorer ─────────────────────────────────────────────────────────────────────────────────────────────
const teFull = (t, mine) => (t.sets || []).filter((s) => s.w + s.l > 0)
  .map((s) => ((t.won ? mine : !mine) ? { p: s.w, o: s.l } : { p: s.l, o: s.w }));

export { loadSackmann };
export function build({ shards, teDir, sack, sids = SIDS0, names = NAMES0 }) {
  const rowsBy = {}; for (const f of fs.readdirSync(shards).filter((x) => x.endsWith('.json'))) {
    const j = readJson(path.join(shards, f), null); if (j && Array.isArray(j.matches)) rowsBy[String(j.key || f.replace(/\.json$/, ''))] = j.matches;
  }
  // TE row per (player key, event key), from the player's side, over EVERY paired row (the opponent's side is the mirror)
  const teBy = new Map(); let tePlayers = 0;
  for (const [key, rows] of Object.entries(rowsBy)) {
    const rec = readJson(path.join(teDir, `${key}.json`), null); if (!rec) continue; tePlayers++;
    for (const { te: t, ours: o } of J.pairRows(J.teRowsOf(rec), rows).pairs) if (o.eventKey != null && !t.wo) teBy.set(`${key}|${o.eventKey}`, { t, own: true });
  }
  const evOwners = new Map(); for (const [k, v] of teBy) { const ek = k.split('|')[1]; if (!evOwners.has(ek)) evOwners.set(ek, []); evOwners.get(ek).push([k.split('|')[0], v]); }
  const out = { v: 1, builtAt: new Date().toISOString(), sources: { te: `${tePlayers} players`, sackmann: `${sack.n} matches` }, counts: {}, repairs: {}, flags: {} };
  const tally = (k) => { out.counts[k] = (out.counts[k] || 0) + 1; };
  let short = 0;
  for (const [key, rows] of Object.entries(rowsBy)) for (const r of rows) {
    if (!isShort(r)) continue; short++;
    // TE: his own page, else an opponent's page for the same match (flipped: the opponent won when we lost)
    let te = teBy.get(`${key}|${r.eventKey}`), teSide = 'own';
    let teList = te && teFull(te.t, true);
    if (!te) { const o = (evOwners.get(String(r.eventKey)) || []).find(([k]) => k !== key); if (o) { te = o[1]; teSide = 'opponent'; teList = teFull(te.t, false); } }
    const teOk = !!te && fits(teList, r);
    const sk = sackmannFor(sack, key, r, sids, names); const skOk = !!sk.full;
    const base = { short: r.sets, date: r.date, opp: r.opponent, tour: r.tournament, result: r.result };
    let why = null;
    if (teOk && skOk && g(teList) === g(sk.full)) {
      (out.repairs[key] = out.repairs[key] || {})[r.eventKey] = { ...base, sets: teList, te: teSide, sackmann: sk.ref };
      tally(`repaired (TE ${teSide} page + Sackmann)`); continue;
    }
    if (teOk && skOk) why = `sources disagree: Tennis Explorer ${g(teList)} · Sackmann ${g(sk.full)}`;
    else if (teOk) why = `Tennis Explorer only (${sk.why})`;
    else if (skOk) why = te ? `Sackmann only (Tennis Explorer's ${g(teList)} does not fit)` : 'Sackmann only (no Tennis Explorer row)';
    else why = te ? `neither fits (Tennis Explorer ${g(teList)}; ${sk.why})` : `neither (no Tennis Explorer row; ${sk.why})`;
    (out.flags[key] = out.flags[key] || {})[r.eventKey] = { ...base, why, te: te ? g(teList) : null, sackmann: sk.ref || null };
    tally(why.replace(/\s*\(.*$/, '').replace(/:.*$/, ''));
  }
  out.shortRows = short;
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!SHARDS || !TE || !SACK || !OUT) { console.error('usage: --shards DIR --te DIR --sackmann DIR --sack-ids F --names F --out F'); process.exit(2); }
  const sack = loadSackmann(SACK);
  const out = build({ shards: SHARDS, teDir: TE, sack });
  const tmp = OUT + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(out)); fs.renameSync(tmp, OUT);
  console.log(`set repairs: ${out.shortRows} short rows ·`, out.counts);
}
