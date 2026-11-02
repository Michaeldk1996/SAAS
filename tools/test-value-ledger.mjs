#!/usr/bin/env node
// Model value ledger (founder brief 2026-11-01): tools/value-ledger.mjs on manufactured board / model states, worked by
// hand; then the append-only rule over every tracked file, with mutant controls (each must turn the scan red).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(path.join(ROOT, 'tools/value-ledger.mjs')).href);
const CFG = (await import(pathToFileURL(path.join(ROOT, 'value-ledger-config.js')).href)).default;
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS ', name); } else { fail++; console.log('  FAIL ', name, detail === undefined ? '' : '\n        ' + JSON.stringify(detail)); } };
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-6;

// ── tiers: one config, re-testable ────────────────────────────────────────────────────────────────────────────────────
console.log('tiers');
check('0.0199 untagged · 0.02 Value · 0.0499 Value · 0.05 Strong · 0.0999 Strong · 0.10 Max · 0.5 Max',
  [0.0199, 0.02, 0.0499, 0.05, 0.0999, 0.10, 0.5].map(e => L.tierOf(e)).join('|') === '|Value|Value|Strong value|Strong value|Max value (+++)|Max value (+++)');
check('no edge (null) is untagged, never a tier', L.tierOf(null) === null && L.tierOf(NaN) === null);
check('the thresholds are the config\'s', CFG.tiers.map(t => t.min).join() === '0.02,0.05,0.1' && CFG.tiers[2].max === null);
const alt = [{ name: 'A', min: 0.03, max: null }];
check('another config re-tiers the same edge (0.025: Value → untagged)', L.tierOf(0.025) === 'Value' && L.tierOf(0.025, alt) === null);
const src = fs.readFileSync(path.join(ROOT, 'tools/value-ledger.mjs'), 'utf8');
check('no tier threshold is written in the code (only the config holds them)', !/\b0\.(02|05|1|10)\b/.test(src.replace(/\/\/.*$/gm, '')));
check('the tier is never stored: no snapshot / settlement column carries it', !/value_tier|tier_name/.test(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261101090000_model_value_ledger.sql'), 'utf8')));
check('edge = probability × odds − 1', near(L.edgeOf(0.3606, 2.95), 0.06377) && L.edgeOf(0.5, null) === null && L.edgeOf(0.5, 1.005) === null);

// ── snapshots ─────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('snapshots');
const NOW = Date.parse('2026-11-01T04:30:00Z');
const entry = (state, p1, extra = {}) => Object.assign({ ok: true, preMatch: true, computedAt: '2026-11-01T04:13:22.154Z', match: { bestOf: 3 },
  stage1: { baseState: { state, anchorBook: state === 2 ? 'Pinnacle' : state === 1 ? 'bet365' : null, anchorPrice: state === 3 ? null : { p1: 1.42, p2: 2.96, ts: '2026-10-31T23:02:23Z' } } },
  stage2: { appliedCount: 8, adjustments: new Array(14).fill({}) },
  stage3: { fair: { p1: { prob: p1, odds: +(1 / p1).toFixed(2) }, p2: { prob: +(1 - p1).toFixed(4), odds: +(1 / (1 - p1)).toFixed(2) } },
    sharp: state === 3 ? null : { source: 'Pinnacle (api-tennis)', price: { p1: 1.42, p2: 2.96 } } } }, extra);
const card = (id, extra = {}) => Object.assign({ id, date: '2026-11-01', time: '11:00', tour: 'ATP Paris', tourBadge: 'ATP', surface: 'hard', qualifying: false,
  tournamentRound: 'ATP Paris - 1/32-finals', p1: 'A. One', p2: 'B. Two', p1Key: 11, p2Key: 22, bookNow: { Pncl: { p1: 1.42, p2: 2.96, seenAt: '2026-11-01T04:04:01Z' } } }, extra);
const matches = [card('upcoming-100'), card('upcoming-200', { qualifying: true }), card('past-300', { finalScore: { winner: 'p1', sets: [{ p1: 6, p2: 3 }] } }), card('upcoming-400')];
const modelOutput = { matches: { 'upcoming-100': entry(2, 0.6394), 'upcoming-200': entry(3, 0.55), 'past-300': entry(2, 0.6, { frozen: true }), 'upcoming-400': { ok: false, reason: 'no Elo' } } };
const lines = new Map([[100, [{ market: 'ml', side: '11', price: 1.41, status: 'ok', inserted_on: '2026-10-31T18:03:26Z' }, { market: 'ml', side: '22', price: 2.95, status: 'ok', inserted_on: '2026-10-31T18:03:26Z' }]]]);
const S = L.buildSnapshots({ modelOutput, matches, lines, hbAgeMs: 45e3, runId: 'r1', nowMs: NOW });
check('one row per side of each upcoming priced match (2 matches × 2); started / frozen / unpriced skipped', S.rows.length === 4 && S.skipped.frozenOrStarted === 1 && S.skipped.notPriced === 1, S.skipped);
const a = S.rows.find(r => r.event_key === 100 && r.side === 'p2');
check('the bet105 price, its Kibl time and the edge vs bet105', a.b105_price === 2.95 && a.b105_price_at === '2026-10-31T18:03:26Z' && near(a.edge_b105, 0.6394 * 0 + (1 - 0.6394) * 2.95 - 1) && a.b105_status === 'ok');
check('Pinnacle anchor + latest read, edge vs Pinnacle', a.pin_anchor_price === 2.96 && a.pin_now_price === 2.96 && a.pin_now_read_at === '2026-11-01T04:04:01Z' && near(a.edge_pin, 0.3606 * 2.96 - 1));
check('full model, layers active 8 of 14, tier main draw, shown on page (state 2, 6.5 h out)', a.price_kind === 'full' && a.layers_active === 8 && a.layers_total === 14 && a.tier === 'main draw' && a.shown_on_page === true);
const e = S.rows.find(r => r.event_key === 200 && r.side === 'p1');
check('Elo-only row: logged, marked elo-only, no Pinnacle anchor, not shown on page', e.price_kind === 'elo-only' && e.pin_anchor_price === null && e.edge_pin === null && e.shown_on_page === false && e.tier === 'qualifying');
check('no bet105 line → price null with its reason, never another book', e.b105_price === null && e.edge_b105 === null && /no bet105/.test(e.b105_status));
const St = L.buildSnapshots({ modelOutput, matches, lines, hbAgeMs: 181e3, runId: 'r1', nowMs: NOW });
check('stale stream (heartbeat 181 s) → no bet105 price', St.rows.every(r => r.b105_price === null) && /stale/.test(St.rows[0].b105_status));
check('alt-anchor (state 1) is its own kind, never "full"', L.priceKindOf(1) === 'alt-anchor' && L.priceKindOf(3) === 'elo-only');

// ── key marks ─────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('key marks');
const S0 = (id, side, ts, prob, b, o) => ({ id, event_key: 9, side, snapshot_ts: ts, model_prob: prob, b105_price: b, b105_opp_price: o, edge_b105: L.edgeOf(prob, b) });
// no-vig 2.0 | 1.9: implied .5 + .5263 → share .4872 → 2.0526. prob .49: quoted −2.0%, no-vig +0.6% (the basis decides)
const sn = [S0(1, 'p1', '2026-11-01T01:00:00Z', 0.45, 2.0, 1.9), S0(2, 'p1', '2026-11-01T02:00:00Z', 0.49, 2.0, 1.9),
  S0(3, 'p1', '2026-11-01T03:00:00Z', 0.55, 2.0, 1.9), S0(4, 'p2', '2026-11-01T03:00:00Z', 0.6, 1.9, null)];
check('no-vig price of one side of a pair; a missing side gives none', near(L.noVig(2.0, 1.9), 2.052632) && L.noVig(2.0, null) === null);
check('edge basis: no-vig (the config default) vs as quoted', CFG.edgeBasis === 'b105-novig' && near(L.edgeFor(sn[1]), 0.49 * 2.052632 - 1) && near(L.edgeFor(sn[1], 'b105'), -0.02));
const fe = L.firstEdgeMarks(sn, []);
check('first edge = the earliest positive no-vig edge (any size), one per side; no opposite price → no edge, no mark', fe.length === 1 && fe[0].snapshot_id === 2 && fe[0].kind === 'first_edge' && fe[0].detail.basis === 'b105-novig');
check('an existing first_edge mark is never replaced', L.firstEdgeMarks(sn, [{ event_key: 9, side: 'p1', kind: 'first_edge' }]).length === 0);
check('last before start = the newest snapshot strictly before the verified start', L.lastBefore(sn.filter(r => r.side === 'p1'), '2026-11-01T03:00:00Z').id === 2 && L.lastBefore(sn, '2026-11-01T00:00:00Z') === null);
const closes = new Map([['300', { eventKey: 300, p1Key: 22, p2Key: 11, p1: 2.5, p2: 1.6, startTs: '2026-11-01T11:05:00Z', startSource: 'live-flip (last poll not live)', closeTs: '2026-11-01T10:50:00Z', label: 'captured' }]]);
check('verified start = the archive export\'s start, else the card\'s actual start, never the schedule',
  L.verifiedStart(300, closes, matches[2]).ts === '2026-11-01T11:05:00.000Z' && L.verifiedStart(500, closes, card('x')) === null
  && L.verifiedStart(500, closes, card('x', { pinClose: { startBasis: 'actual', startTs: '2026-11-01T11:01:00Z' } })).source === 'card state actual start'
  && L.verifiedStart(500, closes, card('x', { pinClose: { startBasis: 'scheduled', startTs: '2026-11-01T11:01:00Z' } })) === null);
const flips = new Map([['500', { event_key: '500', last_not_live_seen_at: '2026-11-01T11:02:10Z' }], ['600', { event_key: '600', last_not_live_seen_at: null }]]);
check('our live-flip log is a verified start (last poll not live); a flip with no lower bound is none; the archive start still wins',
  L.verifiedStart(500, closes, card('x'), flips).ts === '2026-11-01T11:02:10.000Z' && L.verifiedStart(500, closes, card('x'), flips).source === 'live-flip (last poll not live)'
  && L.verifiedStart(600, closes, card('x'), flips) === null && L.verifiedStart(300, closes, matches[2], new Map([['300', { last_not_live_seen_at: '2026-11-01T09:00:00Z' }]])).ts === '2026-11-01T11:05:00.000Z');

// ── settlement ────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('settlement');
const fin = (fs, extra = {}) => card('past-300', Object.assign({ finalScore: fs }, extra));
const c = L.closeFor(closes.get('300'), matches[2], 'p1');
check('the close is oriented by player keys (archive p1 = our p2)', c.price === 1.6 && c.opp === 2.5 && c.gapS === 900);
check('a close whose keys are not this match\'s players is no close', L.closeFor(closes.get('300'), card('past-300', { p1Key: 11, p2Key: 99 }), 'p1') === null);
const mk = { event_key: 300, side: 'p1', kind: 'last_pre_start' };
const start = '2026-11-01T11:05:00Z', later = Date.parse(start) + 3600e3;
const w = L.settlementFor({ mark: mk, snap: { id: 7, b105_price: 1.7 }, m: fin({ winner: 'p1', sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }] }), close: c, startIso: start, nowMs: later });
check('a win: profit = price − 1 at the bet105 price; CLV = price × no-vig close − 1', w.result === 'won' && near(w.profit, 0.7) && near(w.clv, 1.7 * ((1 / 1.6) / (1 / 1.6 + 1 / 2.5)) - 1));
const l = L.settlementFor({ mark: mk, snap: { id: 7, b105_price: 1.7 }, m: fin({ winner: 'p2', sets: [{ p1: 3, p2: 6 }] }), close: c, startIso: start, nowMs: later });
check('a loss: −1', l.result === 'lost' && l.profit === -1);
const rs = L.settlementFor({ mark: mk, snap: { id: 7, b105_price: 1.7 }, m: fin({ winner: 'p2', sets: [{ p1: 6, p2: 4 }, { p1: 1, p2: 2 }] }, { retired: true }), close: c, startIso: start, nowMs: later });
check('retired after the first set was completed: the bet stands (a loss for p1)', rs.result === 'lost' && rs.bet_rule === 'stands' && rs.profit === -1);
const rv = L.settlementFor({ mark: mk, snap: { id: 7, b105_price: 1.7 }, m: fin({ winner: 'p1', sets: [{ p1: 3, p2: 2 }] }, { retired: true }), close: c, startIso: start, nowMs: later });
check('retired before the first set was completed: void, profit 0', rv.result === 'void' && rv.profit === 0 && rv.bet_rule === 'void');
const wo = L.settlementFor({ mark: mk, snap: { id: 7, b105_price: 1.7 }, m: card('past-300', { walkover: true }), close: null, startIso: start, nowMs: later + 30 * 3600e3 });
check('a walkover: void', wo && wo.result === 'void' && wo.profit === 0);
check('no close yet and inside the wait: nothing written (it may still come)', L.settlementFor({ mark: mk, snap: { id: 7, b105_price: 1.7 }, m: fin({ winner: 'p1', sets: [{ p1: 6, p2: 0 }] }), close: null, startIso: start, nowMs: later }) === null);
const nc = L.settlementFor({ mark: mk, snap: { id: 7, b105_price: 1.7 }, m: fin({ winner: 'p1', sets: [{ p1: 6, p2: 0 }] }), close: null, startIso: start, nowMs: Date.parse(start) + 25 * 3600e3 });
check('no close past the wait: CLV is a dash (null), never estimated; the result still settles', nc.clv === null && nc.close_price === null && nc.result === 'won');
const nb = L.settlementFor({ mark: mk, snap: { id: 7, b105_price: null }, m: fin({ winner: 'p1', sets: [{ p1: 6, p2: 0 }] }), close: c, startIso: start, nowMs: later });
check('no bet105 price: no profit and no CLV, with its reason — never a substitute price', nb.profit === null && nb.clv === null && /no bet105/.test(nb.no_profit_reason));
check('an unfinished match is not settled', L.settlementFor({ mark: mk, snap: { id: 7, b105_price: 1.7 }, m: card('upcoming-300'), close: c, startIso: start, nowMs: later }) === null);

// ── export ────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('export');
const snaps = [], marks = [], settles = [];
for (let i = 1; i <= 40; i++) {
  // prob .5 at bet105 2.0 | 1.9 → no-vig edge +2.6% (Value); as quoted 0.0% (untagged)
  snaps.push({ id: i, event_key: 1000 + i, side: 'p1', snapshot_ts: '2026-11-01T00:00:00Z', price_kind: i <= 35 ? 'full' : 'elo-only', model_prob: 0.5, b105_price: 2, b105_opp_price: 1.9, edge_b105: 0 });
  marks.push({ id: i, event_key: 1000 + i, side: 'p1', kind: 'last_pre_start', snapshot_id: i });
  settles.push({ id: i, event_key: 1000 + i, side: 'p1', mark_kind: 'last_pre_start', result: i % 2 ? 'won' : 'lost', close_price: 2.1, close_opp_price: 1.8, close_gap_s: i === 1 ? 7200 : 600 });
}
snaps.push({ id: 99, event_key: 2000, side: 'p2', snapshot_ts: '2026-11-01T00:00:00Z', price_kind: 'full', model_prob: 0.3, b105_price: 2, b105_opp_price: 1.9, edge_b105: -0.4 });
const X = L.exportRows(snaps, marks, settles);
const sum = L.summarise(X.keyRows);
const full = sum.find(s => s.key_snapshot === 'last_pre_start' && s.price_kind === 'full' && s.tier === 'Value');
const elo = sum.find(s => s.key_snapshot === 'last_pre_start' && s.price_kind === 'elo-only' && s.tier === 'Value');
check('35 full-model Value bets: rates shown, each with its count; profit at the price as quoted (2.0 → +1 / −1)', full.bets === 35 && near(full.win_rate, 18 / 35) && near(full.roi, 1 / 35) && full.clv_n === 34);
const clvX = 2 * ((1 / 2.1) / (1 / 2.1 + 1 / 1.8)) - 1;
check('CLV only from a close seen ≤ 60 min before the start (the 2-hour-old one is left out, counted); CLV = quoted × no-vig close − 1', full.clv_n === 34 && near(full.avg_clv, clvX));
check('Elo-only rows never mixed in: their own row; 5 bets < 30 → count shown, rates a dash', elo.bets === 5 && elo.win_rate === null && elo.roi === null && elo.avg_clv === null && elo.profit != null);
check('each side lists its first-edge and last-pre-start rows (here the same snapshot); an unmarked snapshot is listed but not in the summary', X.keyRows.length === 80 && X.rows.length === 81 && X.rows[80].snapshot_id === 99);
const csv = L.toCsv(X.keyRows, X.rows, CFG, '2026-11-01T05:00:00Z');
const first = csv.split('\n');
check('the CSV opens with the tier summary, then every row', /^Model value ledger — tier summary/.test(first[0]) && first[2].startsWith('key snapshot,') && csv.includes('\n\nsnapshot_id,'));
check('thin tier rows print a dash for the rates, never 0', first.some(x => x.startsWith('last_pre_start,elo-only,Value,5,5,5,') && x.split(',')[8] === '—' && x.split(',')[11] === '—'));
check('the same rows re-tier on the quoted basis (0.0% → untagged)', L.summarise(L.exportRows(snaps, marks, settles, Object.assign({}, CFG, { edgeBasis: 'b105' })).keyRows, Object.assign({}, CFG, { edgeBasis: 'b105' })).find(s => s.key_snapshot === 'last_pre_start' && s.price_kind === 'full' && s.tier === 'untagged').bets === 35);
check('first edge derived at export: the earliest positive edge at or before the last-pre-start snapshot', (() => {
  const a = [{ id: 1, event_key: 7, side: 'p1', snapshot_ts: '2026-11-01T01:00:00Z', price_kind: 'full', model_prob: 0.3, b105_price: 2, b105_opp_price: 1.9 },
    { id: 2, event_key: 7, side: 'p1', snapshot_ts: '2026-11-01T02:00:00Z', price_kind: 'full', model_prob: 0.6, b105_price: 2, b105_opp_price: 1.9 },
    { id: 3, event_key: 7, side: 'p1', snapshot_ts: '2026-11-01T03:00:00Z', price_kind: 'full', model_prob: 0.6, b105_price: 2.2, b105_opp_price: 1.7 }];
  const r = L.exportRows(a, [{ event_key: 7, side: 'p1', kind: 'last_pre_start', snapshot_id: 3 }], [{ id: 9, event_key: 7, side: 'p1', mark_kind: 'last_pre_start', result: 'won' }]).keyRows;
  const f = r.find(x => x.mark_kind === 'first_edge'), l = r.find(x => x.mark_kind === 'last_pre_start');
  return f.snapshot_id === 2 && near(f.profit, 1) && l.snapshot_id === 3 && near(l.profit, 1.2);
})());
check('a correction supersedes: the newest settlement is the one read', (() => {
  const s2 = settles.concat([{ id: 500, event_key: 1001, side: 'p1', mark_kind: 'last_pre_start', result: 'void', profit: 0, clv: null, supersedes: 1 }]);
  return L.exportRows(snaps, marks, s2).keyRows.find(r => r.event_key === 1001).result === 'void';
})());

// ── append-only: no code path updates or deletes a ledger row ─────────────────────────────────────────────────────────
console.log('append-only');
const ALLOW = new Set(['supabase/migrations/20261101090000_model_value_ledger.sql', 'tools/value-ledger.mjs', 'tools/test-value-ledger.mjs',
  'tools/test-value-ledger-sql.py', '.github/workflows/value-ledger.yml', '.claude/rules/value-ledger.md']);
const BAD = [
  [/\bupdate\s+(public\.)?value_ledger_/i, 'UPDATE'], [/\bdelete\s+from\s+(public\.)?value_ledger_/i, 'DELETE'],
  [/\btruncate\s+(table\s+)?(public\.)?value_ledger_/i, 'TRUNCATE'], [/\bdrop\s+(table|trigger)\b/i, 'DROP TABLE/TRIGGER'],
  [/\bdisable\s+trigger\b/i, 'DISABLE TRIGGER'], [/merge-duplicates/, 'upsert merge'], [/\bdo\s+update\b/i, 'ON CONFLICT DO UPDATE'],
  [/method:\s*['"](PATCH|PUT|DELETE)['"]/, 'PATCH/PUT/DELETE request'], [/-X\s*(PATCH|PUT|DELETE)\b/, 'curl PATCH/PUT/DELETE'],
  [/\bgrant\s+[^;]*\b(update|delete|truncate)\b[^;]*value_ledger/i, 'write GRANT'], [/\balter\s+table\s+[^;]*value_ledger_[^;]*\b(disable|drop)\b/i, 'ALTER … DISABLE/DROP'],
];
// the migration's own trigger DDL ("drop trigger if exists … create trigger …") is the protection, not a bypass
const strip = (f, s) => f.endsWith('.sql') ? s.replace(/execute format\('drop trigger if exists[^;]*;/g, '') : s;
export function scan(f, s) { const t = strip(f, s.replace(/^\s*(--|\/\/|#).*$/gm, '')); return BAD.filter(([re]) => re.test(t)).map(([, w]) => w); }
const tracked = execSync('git ls-files', { cwd: ROOT, maxBuffer: 1 << 26 }).toString().split('\n').filter(Boolean);
const naming = [], faults = [];
for (const f of tracked) {
  let s; try { if (fs.statSync(path.join(ROOT, f)).size > 4e6) continue; s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; }
  if (!/value_ledger_(snapshot|mark|settlement)/.test(s)) continue;
  naming.push(f);
  if (!ALLOW.has(f)) { faults.push(f + ': names a ledger table outside the allow-list'); continue; }
  if (f === 'tools/test-value-ledger.mjs' || f.endsWith('.md') || f === 'tools/test-value-ledger-sql.py') continue;
  scan(f, s).forEach(w => faults.push(f + ': ' + w));
}
check('only the allow-listed files name a ledger table, and none updates, deletes, truncates, upserts or drops', faults.length === 0 && naming.length >= 3, faults);
check('the writer only POSTs with resolution=ignore-duplicates (INSERT … ON CONFLICT DO NOTHING)', /method: 'POST'/.test(src) && /Prefer: 'resolution=ignore-duplicates/.test(src) && (src.match(/method:/g) || []).length === 1);
const mig = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261101090000_model_value_ledger.sql'), 'utf8');
check('the migration grants service_role SELECT + INSERT only, and every table gets the no-change + no-truncate triggers',
  /grant select, insert on public\.%I to service_role/.test(mig) && /before update or delete on public\.%I/.test(mig) && /before truncate on public\.%I/.test(mig)
  && /array\['value_ledger_snapshot', 'value_ledger_mark', 'value_ledger_settlement'\]/.test(mig) && !/grant[^;]*(update|delete)[^;]*service_role/i.test(mig));
// mutant controls: each bypass, written into the writer, must be caught
const MUT = [
  ["method: 'POST'", "method: 'PATCH'"], ["method: 'POST'", "method: 'DELETE'"], ['resolution=ignore-duplicates', 'resolution=merge-duplicates'],
];
for (const [from, to] of MUT) check(`mutant caught: ${to}`, scan('tools/value-ledger.mjs', src.replaceAll(from, to)).length > 0);
for (const extra of ["await q('delete from public.value_ledger_mark where id = 1')", "sql('update public.value_ledger_snapshot set b105_price = 2')",
  "x('truncate table public.value_ledger_settlement')", "y('alter table public.value_ledger_mark disable trigger all')", "z('insert into value_ledger_mark values (1) on conflict do update set kind = 1')"])
  check(`mutant caught: ${extra.slice(0, 40)}…`, scan('tools/value-ledger.mjs', src + '\n' + extra).length > 0);
check('mutant caught: a grant of UPDATE in the migration', scan('x.sql', mig + "\ngrant update on public.value_ledger_mark to service_role;").length > 0);
check('control: the shipped files scan clean', scan('tools/value-ledger.mjs', src).length === 0 && scan('supabase/migrations/20261101090000_model_value_ledger.sql', mig).length === 0);

console.log(`\ntest-value-ledger: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
