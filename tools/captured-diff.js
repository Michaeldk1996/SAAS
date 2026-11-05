#!/usr/bin/env node
// tools/captured-diff.js — architecture program stage 4, phase A (2026-11-05). REPORT ONLY.
//
// The captured Pinnacle closes are built today from matches.json's git history (build-captured-pinnacle.js). Stage 4
// moves the captures into tables (capture-tables.sql, written by tools/capture-to-table.py after every capture tick).
// Before anything reads the tables, this report rebuilds the same rows from the tables alone — the builder's own
// actualStart / deriveRow, the same starts (fixture index, card state) — and compares them, match by match, with the
// git-built captured-closes-pinnacle.json. Every difference is listed: a different close is the methodology change the
// founder must see before the switch (the close rule is unchanged; only which ticks we hold can differ).
//
// Compared: matches dated on or after the tables' first record (the dual-write start), and only those.
//   same      both build the identical close (prices, tick time, start, start source, sighting)
//   differ    both build a close, and a field differs (listed with both values)
//   gitOnly   the git path has a close the tables cannot build (with the tables' drop reason)
//   tableOnly the tables build a close the git path does not hold
// Never fails the run: exit 0, a ::warning:: per difference class, the step summary and .captured-diff.json.
//
//   node tools/captured-diff.js [--root .] [--out .captured-diff.json]
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY.
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../build-captured-pinnacle.js');

const toMs = (v) => { if (v == null || v === '') return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const iso = (ms) => new Date(ms).toISOString();
const FIELDS = ['p1', 'p2', 'at', 'trueStart', 'startSource', 'book', 'seenAt'];

/** Table rows → the builder's `ev` shape (absorb()'s output): eventKey -> identity + per-label tick maps + reads. */
function eventsFromTables({ ticks = [], reads = [], cards = [] }) {
  const ev = {};
  const newest = new Map();
  for (const c of cards) { const k = String(c.event_key); const h = newest.get(k); if (!h || toMs(c.recorded_at) >= toMs(h.recorded_at)) newest.set(k, c); }
  const get = (k) => {
    if (ev[k]) return ev[k];
    const c = newest.get(k);
    if (!c) return null;
    return (ev[k] = { p1: c.p1, p2: c.p2, p1Key: c.p1_key == null ? c.p1_key : Number(c.p1_key), p2Key: c.p2_key == null ? c.p2_key : Number(c.p2_key), date: c.card_date, series: {},
      ...(c.round != null ? { round: c.round } : {}), ...(typeof c.qualifying === 'boolean' ? { qualifying: c.qualifying } : {}),
      ...(c.event ? { event: c.event } : {}), ...(c.winner ? { winner: c.winner } : {}) });
  };
  for (const t of ticks) {
    const o = get(String(t.event_key)); const ms = toMs(t.tick_ts);
    if (!o || ms == null) continue;
    const s = o.series[t.label] || (o.series[t.label] = { p1: new Map(), p2: new Map() });
    s[t.side].set(iso(ms), Number(t.price));
  }
  for (const r of reads) {
    const o = get(String(r.event_key)); const ms = toMs(r.checked_at);
    if (!o || ms == null || !o.series[r.label]) continue;
    (o.seen || (o.seen = {}))[r.label] = (o.seen[r.label] || new Set()).add(ms);
  }
  return ev;
}

const norm = (k, v) => (v == null ? null : ['at', 'trueStart', 'seenAt'].includes(k) ? iso(toMs(v)) : v);

/** Compare git-built rows with table-built rows for matches dated on/after `fromDate` (YYYY-MM-DD). */
function compare(gitRows, tableBuilt, fromDate) {
  const inWin = (d) => d && String(d).slice(0, 10) >= fromDate;
  const git = new Map((gitRows || []).filter((r) => inWin(r.date)).map((r) => [String(r.eventKey), r]));
  const out = { same: 0, differ: [], gitOnly: [], tableOnly: [] };
  for (const [ek, t] of tableBuilt) {
    if (!inWin(t.date)) continue;
    const g = git.get(ek);
    if (!t.row) { if (g) out.gitOnly.push({ eventKey: Number(ek), date: g.date, players: `${g.p1Name} v ${g.p2Name}`, tableReason: t.reason }); continue; }
    if (!g) { out.tableOnly.push({ eventKey: Number(ek), date: t.row.date, players: `${t.row.p1Name} v ${t.row.p2Name}`, close: [t.row.p1, t.row.p2] }); continue; }
    const d = FIELDS.filter((k) => norm(k, g[k]) !== norm(k, t.row[k]));
    if (d.length) out.differ.push({ eventKey: Number(ek), date: g.date, players: `${g.p1Name} v ${g.p2Name}`, fields: Object.fromEntries(d.map((k) => [k, { git: g[k] ?? null, table: t.row[k] ?? null }])) });
    else out.same++;
  }
  for (const [ek, g] of git) if (!tableBuilt.has(ek)) out.gitOnly.push({ eventKey: Number(ek), date: g.date, players: `${g.p1Name} v ${g.p2Name}`, tableReason: 'not in the tables' });
  return out;
}

async function fetchAll(base, key, table, select) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${base}/rest/v1/${table}?select=${select}&order=recorded_at.asc`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, range: `${from}-${from + 999}`, 'range-unit': 'items' },
      signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function report(root, out, tables, nowMs = Date.now()) {
  const first = [...tables.cards, ...tables.ticks].map((r) => toMs(r.recorded_at)).filter((x) => x != null).sort((a, b) => a - b)[0];
  if (first == null) return { skipped: 'the capture tables hold nothing yet' };
  // A match dated the day the dual-write began can hold ticks from before it: compare from the next day.
  const fromDate = iso(first + 864e5).slice(0, 10);
  const ev = eventsFromTables(tables);
  const trueStarts = B.oddspapiStarts(root);
  let cardState = {};
  try { cardState = JSON.parse(fs.readFileSync(path.join(root, 'odds-card-state.json'), 'utf8')); } catch (e) { /* none */ }
  const built = new Map();
  for (const [ek, o] of Object.entries(ev)) built.set(ek, { date: o.date, ...B.deriveRow(ek, o, B.actualStart(o, trueStarts, cardState), nowMs) });
  let gitDoc = {};
  try { gitDoc = JSON.parse(fs.readFileSync(path.join(root, 'captured-closes-pinnacle.json'), 'utf8')); } catch (e) { /* none */ }
  const c = compare(gitDoc.rows, built, fromDate);
  const doc = { generatedAt: iso(nowMs), tablesFrom: iso(first), comparedFrom: fromDate,
    counts: { same: c.same, differ: c.differ.length, gitOnly: c.gitOnly.length, tableOnly: c.tableOnly.length,
      tableEvents: Object.keys(ev).length, tableTicks: tables.ticks.length, tableReads: tables.reads.length }, ...c };
  fs.writeFileSync(out + '.tmp', JSON.stringify(doc, null, 1)); fs.renameSync(out + '.tmp', out);
  return doc;
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const root = arg('--root', '.'), out = arg('--out', '.captured-diff.json');
  const sum = (s) => { console.log(s); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + '\n'); };
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_SECRET_KEY || '';
  if (!base || !key) { sum('### Captured closes: git vs tables (stage 4)\n- SKIPPED: no Supabase credentials'); return; }
  const [ticks, reads, cards] = await Promise.all([
    fetchAll(base, key, 'capture_tick', 'event_key,label,side,tick_ts,price,recorded_at'),
    fetchAll(base, key, 'capture_read', 'event_key,label,checked_at,recorded_at'),
    fetchAll(base, key, 'capture_card', 'event_key,p1,p2,p1_key,p2_key,card_date,round,qualifying,event,winner,recorded_at')]);
  const d = report(root, out, { ticks, reads, cards });
  if (d.skipped) { sum(`### Captured closes: git vs tables (stage 4)\n- SKIPPED: ${d.skipped}`); return; }
  const n = d.counts;
  sum(`### Captured closes: git vs tables (stage 4, report only)\nMatches dated from ${d.comparedFrom} (tables from ${d.tablesFrom}): `
    + `**${n.same} same**, ${n.differ} differ, ${n.gitOnly} only in git, ${n.tableOnly} only in the tables `
    + `(tables: ${n.tableEvents} matches, ${n.tableTicks} ticks, ${n.tableReads} reads).`);
  for (const x of d.differ.slice(0, 20)) sum(`- differ ${x.eventKey} ${x.date} ${x.players}: ${Object.entries(x.fields).map(([k, v]) => `${k} git ${v.git} / table ${v.table}`).join('; ')}`);
  for (const x of d.gitOnly.slice(0, 20)) sum(`- only in git ${x.eventKey} ${x.date} ${x.players} (tables: ${x.tableReason})`);
  for (const x of d.tableOnly.slice(0, 20)) sum(`- only in the tables ${x.eventKey} ${x.date} ${x.players} ${x.close.join(' / ')}`);
  if (n.differ || n.gitOnly || n.tableOnly) console.log(`::warning title=Captured closes git vs tables::${n.differ} differ, ${n.gitOnly} only in git, ${n.tableOnly} only in the tables (report only; see the step summary)`);
}

if (require.main === module) main().catch((e) => { console.log(`::warning title=Captured closes git vs tables::did not run: ${e.message}`); process.exit(0); });

module.exports = { eventsFromTables, compare, report };
