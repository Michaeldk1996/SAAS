#!/usr/bin/env node
// Historical model backtest (Michael 2026-11-01: "keep it separate … see how the model does if we just bet on value,
// sharp value"). RECONSTRUCTED FROM RECORDS and never written into the forward ledger (.claude/rules/value-ledger.md).
//
//   node tools/value-backtest.mjs --out FILE.csv [--board-cache FILE.json] [--since 2026-07-20]
//
// Reads only what was recorded at the time — nothing is recomputed with today's model:
//   - admin-log.json `flags` (build-admin-log.js, every pipeline run since 23 Jul): per priced match the FROZEN
//     valueSnapshot — the model's first full-model (state 2) fair probabilities and its edge vs Pinnacle's no-vig price
//     (the "Sharp Value" number), taken once and never recomputed;
//   - the board's git history (matches.json): the result (winner, retirement, walkover, set scores, player keys) and the
//     board's Pinnacle close where it is a verified one (the archive's, or cut at the actual start);
//   - bet105 at the moment of the snapshot: the Kibl archive (price_history RPC, the price-history box's own read), the
//     last price per side at or before the snapshot time; both sides needed for the no-vig price.
// Per side: the edge is model probability × the no-vig entry price − 1, on bet105 where both sides were priced at that
// moment, else on Pinnacle's no-vig price from the snapshot (fair − edge vs Pinnacle). Profit (flat 1u, Pinnacle
// retirement rules via settlement.js) at bet105's price as quoted; a Pinnacle-source row is settled at Pinnacle's NO-VIG
// entry price (no margin: not a bettable price — summarised apart, labelled). Missing → a dash, never estimated.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = require(path.join(ROOT, 'value-ledger-config.js'));
const SETTLE = require(path.join(ROOT, 'settlement.js'));
const PICKS = require(path.join(ROOT, 'picks-core.js'));
const PHB = require(path.join(ROOT, 'price-history-box.js'));

export const SHARP_VALUE_MIN = 0.03;   // h2h-model/config.js value.sharpEdge, the Model page's "Sharp Value" (read below)
const num = x => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const px = x => { const n = num(x); return n != null && n >= 1.01 ? n : null; };
const r6 = x => (x == null ? null : Math.round(x * 1e6) / 1e6);

// the dashboard's ocsNfd / ocsNameKey / ocsMatchKey (the card-state key the Kibl archive is keyed by), character for character
const nfd = s => String(s || '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/,/g, ' ').replace(/\./g, ' ')
  .replace(/[-‐-―'‘’ʼ]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
export function nameKey(name) {
  const raw = String(name || ''); const s = nfd(raw.includes(',') ? raw.split(',')[0] : raw);
  const t = s.split(' ').filter(x => x.length > 1 && /^\p{L}+$/u.test(x)); return t.length ? t[t.length - 1] : null;
}
export function cardKey(date, p1, p2) {
  const a = nameKey(p1), b = nameKey(p2);
  return !date || !a || !b || a === b ? null : `${String(date).slice(0, 10)}|${[a, b].sort().join('|')}`;
}
export function noVig(p, q) { const a = px(p), b = px(q); return a == null || b == null ? null : r6(1 / ((1 / a) / (1 / a + 1 / b))); }
export function edgeOf(prob, price) { const p = num(prob), o = num(price); return p == null || o == null || o <= 1 ? null : r6(p * o - 1); }
export const CAPPED = 'Capped (likely model error)';
export function tierOf(edge, tiers = CFG.tiers, cap = CFG.edgeCap) {
  if (edge == null || !Number.isFinite(edge)) return null;
  if (cap != null && edge >= cap) return CAPPED;
  for (const t of tiers) if (edge >= t.min && (t.max == null || edge < t.max)) return t.name;
  return null;
}
// the last bet105 price of a side at or before t (ms), from the price-history payload; null when none yet
export function b105At(payload, sideKey, t) {
  const rows = PHB.sideRows(payload, sideKey, nameKey).filter(r => r.at <= t);
  return rows.length ? rows[rows.length - 1] : null;
}
// bet105's opening price (its first recorded price) and closing price (its last recorded price before the start), each
// with its Kibl time. The start cuts the close only when it is a verified one; the archive's rows are pre-match only.
export function b105OpenClose(payload, sideKey, startMs) {
  const rows = PHB.sideRows(payload, sideKey, nameKey);
  const pre = startMs != null ? rows.filter(r => r.at < startMs) : rows;
  return { open: pre.length ? pre[0] : null, close: pre.length ? pre[pre.length - 1] : null };
}
// the admin log's score text ("6-3, 4-6, 6-2", p1 first) → winner side, or null
export function winnerFromText(s) {
  const sets = String(s || '').split(',').map(x => /^\s*(\d+)\s*-\s*(\d+)/.exec(x)).filter(Boolean).map(m => [+m[1], +m[2]]);
  if (!sets.length) return null;
  let a = 0, b = 0; for (const [x, y] of sets) { if (x > y) a++; else if (y > x) b++; }
  return a > b ? 'p1' : b > a ? 'p2' : null;
}
// one settled side: { result, betRule, why } on Pinnacle's rules, from the board card (preferred) or the log's score
export function resultFor(card, logRow, side) {
  if (card && card.walkover) return { result: 'void', betRule: 'void', why: 'walkover' };
  const fs_ = card && card.finalScore;
  if (fs_ && (fs_.winner === 'p1' || fs_.winner === 'p2')) {
    const sets = Array.isArray(fs_.sets) ? fs_.sets.map(x => [num(x.p1), num(x.p2)]) : null;
    const rule = SETTLE.settleBet({ retired: !!(card.retired || fs_.retired), sets });
    if (rule === 'void' || rule === 'no-sets') return { result: 'void', betRule: rule, why: 'retirement before the first set was completed' };
    return { result: fs_.winner === side ? 'won' : 'lost', betRule: rule, why: null, source: 'board' };
  }
  const w = logRow && logRow.status === 'finished' ? winnerFromText(logRow.finalScore) : null;
  if (!w) return null;
  return { result: w === side ? 'won' : 'lost', betRule: null, why: 'retirement not knowable from the log', source: 'admin log' };
}
// a verified Pinnacle close from the board card (the archive's, or cut at the actual start), oriented to `side`
export function closeFor(card, side) {
  const c = card && card.pinClose;
  if (!c || !(c.source === 'Pinnacle close (archive)' || c.startBasis === 'actual')) return null;
  const a = px(c.p1), b = px(c.p2); if (a == null || b == null) return null;
  return { price: side === 'p1' ? a : b, opp: side === 'p1' ? b : a, source: c.source, startBasis: c.startBasis || null };
}

// The backtest rows: one per side of every finished, full-model priced match in the log.
export function buildRows({ log, board, b105, since }) {
  const out = [];
  for (const r of Object.values((log && log.flags) || {})) {
    const vs = r.valueSnapshot; if (!vs || (since && r.date < since)) continue;
    const card = board.get(String(r.key)) || null;
    const ck = cardKey(r.date, r.p1, r.p2), pay = ck ? b105.get(ck) : null, t = Date.parse(vs.ts);
    for (const side of ['p1', 'p2']) {
      const o = side === 'p1' ? 'p2' : 'p1';
      const prob = num(vs['fair' + side.toUpperCase()]);
      const eP = num(vs['edgeVsPinnacle' + side.toUpperCase()]);
      const pinNvProb = prob != null && eP != null ? prob - eP : null;
      const a = pay ? b105At(pay, nameKey(r[side]), t) : null, b = pay ? b105At(pay, nameKey(r[o]), t) : null;
      const bNv = a && b ? noVig(a.price, b.price) : null;
      const source = bNv != null ? 'bet105' : pinNvProb != null && pinNvProb > 0 && pinNvProb < 1 ? 'pinnacle-novig' : null;
      const entryNv = source === 'bet105' ? bNv : source ? r6(1 / pinNvProb) : null;
      const betPrice = source === 'bet105' ? a.price : entryNv;
      const edge = edgeOf(prob, entryNv);
      const res = resultFor(card, r, side), close = closeFor(card, side);
      const profit = !res || betPrice == null ? null : res.result === 'void' ? 0 : res.result === 'won' ? r6(betPrice - 1) : -1;
      const pl = price => !res || price == null ? null : res.result === 'void' ? 0 : res.result === 'won' ? r6(price - 1) : -1;
      const vStart = card && card.pinClose && (card.pinClose.startBasis === 'actual' || card.pinClose.source === 'Pinnacle close (archive)') ? Date.parse(card.pinClose.startTs || '') : NaN;
      const startMs = Number.isFinite(vStart) ? vStart : null;
      const oc = pay ? b105OpenClose(pay, nameKey(r[side]), startMs) : { open: null, close: null };
      const ocOpp = pay ? b105OpenClose(pay, nameKey(r[o]), startMs) : { open: null, close: null };
      const b105CloseNv = oc.close && ocOpp.close ? noVig(oc.close.price, ocOpp.close.price) : null;
      out.push({
        event: r.key, date: r.date, month: String(r.date).slice(0, 7), tournament: r.tour || null, surface: r.surface || null,
        side, player: r[side], opponent: r[o], entry_ts: vs.ts, model_prob: prob,
        edge_vs_pinnacle_pp: eP, sharp_value: eP != null && eP >= SHARP_VALUE_MIN,
        pin_novig_price: pinNvProb != null && pinNvProb > 0 ? r6(1 / pinNvProb) : null,
        b105_price: a ? a.price : null, b105_opp_price: b ? b.price : null, b105_at: a ? new Date(a.at).toISOString() : null,
        source, entry_novig_price: entryNv, edge, tier: tierOf(edge) || (edge == null ? null : 'untagged'),
        bet_price: betPrice, result: res ? res.result : null, result_source: res ? res.source || null : null, bet_rule: res ? res.betRule : null,
        profit, close_price: close ? close.price : null, close_opp_price: close ? close.opp : null,
        clv: close && betPrice != null ? r6(PICKS.clv(betPrice, close.price, close.opp)) : null,
        b105_open: oc.open ? oc.open.price : null, b105_open_at: oc.open ? new Date(oc.open.at).toISOString() : null,
        b105_close: oc.close ? oc.close.price : null, b105_close_at: oc.close ? new Date(oc.close.at).toISOString() : null,
        b105_close_cut: startMs != null ? 'verified start' : 'last pre-match row',
        profit_at_open: source === 'bet105' ? pl(oc.open && oc.open.price) : null,
        profit_at_close: source === 'bet105' ? pl(oc.close && oc.close.price) : null,
        clv_b105: source === 'bet105' && b105CloseNv != null ? r6(betPrice / b105CloseNv - 1) : null,
        note: !source ? 'no entry price (no bet105 pair, no Pinnacle edge recorded)' : !res ? 'no result on record' : res.why || null,
      });
    }
  }
  return out;
}

// Summary groups: n bets (settled, priced, not void), won, win rate, profit, ROI, avg CLV (each with its n); under the
// config's minimum, the counts and a dash for the rates.
export function summary(rows, keyFn, cfg = CFG) {
  const g = new Map();
  for (const r of rows) { const k = keyFn(r); if (k == null) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  return [...g.entries()].map(([k, list]) => {
    const bets = list.filter(r => r.result && r.result !== 'void' && r.profit != null);
    const thin = bets.length < cfg.minSettledForRates, won = bets.filter(r => r.result === 'won').length;
    const pnl = bets.reduce((a, r) => a + r.profit, 0), clv = bets.filter(r => r.clv != null);
    return { key: k, sides: list.length, bets: bets.length, void: list.filter(r => r.result === 'void').length,
      no_result: list.filter(r => !r.result).length, won, win_rate: thin ? null : won / bets.length,
      avg_model_prob: bets.length ? bets.reduce((a, r) => a + r.model_prob, 0) / bets.length : null,
      profit: bets.length ? pnl : null, roi: thin ? null : pnl / bets.length,
      clv_n: clv.length, avg_clv: thin || !clv.length ? null : clv.reduce((a, r) => a + r.clv, 0) / clv.length, thin };
  });
}
const DASH = '—';
const cell = v => { if (v == null) return DASH; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const pct = (x, d = 1) => (x == null ? null : (x * 100).toFixed(d) + '%');
const sgnU = x => (x == null ? null : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + 'u');
const SRC = { bet105: 'bet105 (as quoted)', 'pinnacle-novig': 'Pinnacle no-vig (no margin, not bettable)' };
export function toCsv(rows, cfg = CFG, at = new Date().toISOString()) {
  const L = [], H = ['group', 'sides', 'bets (settled, priced, not void)', 'void', 'no result', 'won', 'win rate', 'avg model prob', 'profit (1u flat)', 'ROI', 'avg CLV', 'CLV n'];
  const block = (title, S, order) => {
    L.push(''); L.push(cell(title)); L.push(H.map(cell).join(','));
    const sorted = order ? S.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : S.sort((a, b) => String(a.key).localeCompare(String(b.key)));
    for (const s of sorted) L.push([s.key, s.sides, s.bets, s.void, s.no_result, s.won, pct(s.win_rate), pct(s.avg_model_prob), sgnU(s.profit), pct(s.roi), pct(s.avg_clv, 2), s.clv_n].map(cell).join(','));
  };
  const tierTxt = cfg.tiers.map(t => `${t.name} ${pct(t.min, 0)}${t.max == null ? '+' : '–' + pct(t.max, 0)}`).join(' · ');
  L.push(['Model backtest — RECONSTRUCTED FROM RECORDS (separate from the forward ledger)', at].map(cell).join(','));
  L.push(cell(`Population: every side of every match the model priced at full model (state 2) since 23 Jul 2026, frozen at its first full-model read (admin-log valueSnapshot), never recomputed. Edge = model probability × no-vig entry price − 1: bet105 where both sides were priced at that moment, else Pinnacle's no-vig price from the snapshot. Tiers: ${tierTxt}. Sharp Value = the Model page's flag (model − Pinnacle no-vig ≥ ${SHARP_VALUE_MIN * 100} pts). Profit flat 1u, retirements on Pinnacle rules; bet105 rows at the price as quoted, Pinnacle rows at the NO-VIG price (no margin: flatters them). Fewer than ${cfg.minSettledForRates} bets: counts only, rates a dash. CLV vs a verified Pinnacle close (board, from 27 Sep). Model versions changed over these months.`));
  const tiers = cfg.tiers.map(t => t.name).concat([CAPPED, 'untagged']);
  for (const src of ['bet105', 'pinnacle-novig']) {
    const R = rows.filter(r => r.source === src);
    block(`By value tier · ${SRC[src]}`, summary(R, r => r.tier), tiers);
    if (cfg.betRule) block(`Followed the bet rule (edge ${pct(cfg.betRule.min, 0)}–${pct(cfg.betRule.max, 0)}) · ${SRC[src]}`, summary(R.filter(r => r.edge != null && r.edge >= cfg.betRule.min && r.edge < cfg.betRule.max), () => 'bet rule'));
    block(`By Sharp Value flag · ${SRC[src]}`, summary(R, r => (r.sharp_value ? 'Sharp Value' : 'no Sharp Value')), ['Sharp Value', 'no Sharp Value']);
    block(`Sharp Value bets by month · ${SRC[src]}`, summary(R.filter(r => r.sharp_value), r => r.month));
    block(`Value tiers (2%+) by month · ${SRC[src]}`, summary(R.filter(r => r.edge != null && r.edge >= cfg.tiers[0].min), r => r.month));
  }
  // the same bets at three prices: bet105's opening price, the price at the flag, bet105's closing price
  const triple = (title, R) => {
    const A = R.filter(r => r.source === 'bet105' && r.result && r.result !== 'void' && r.profit != null && r.profit_at_open != null && r.profit_at_close != null);
    const s = k => A.reduce((x, r) => x + r[k], 0);
    const roi = k => A.length < cfg.minSettledForRates ? null : s(k) / A.length;
    const clv = A.filter(r => r.clv_b105 != null);
    L.push([title, A.length, sgnU(A.length ? s('profit_at_open') : null), pct(roi('profit_at_open')), sgnU(A.length ? s('profit') : null), pct(roi('profit')),
      sgnU(A.length ? s('profit_at_close') : null), pct(roi('profit_at_close')),
      pct(A.length < cfg.minSettledForRates || !clv.length ? null : clv.reduce((x, r) => x + r.clv_b105, 0) / clv.length, 2), clv.length].map(cell).join(','));
  };
  L.push(''); L.push(cell('Same bets at bet105 OPEN · at the FLAG · at bet105 CLOSE (bet105 rows with all three prices; flat 1u)'));
  L.push(['strategy', 'bets', 'P/L at open', 'ROI at open', 'P/L at flag', 'ROI at flag', 'P/L at close', 'ROI at close', 'avg CLV vs bet105 no-vig close', 'CLV n'].map(cell).join(','));
  triple('every side with an edge > 0', rows.filter(r => r.edge > 0));
  triple(`every edge ${pct(cfg.tiers[0].min, 0)}+ (below the cap)`, rows.filter(r => r.edge >= cfg.tiers[0].min && (cfg.edgeCap == null || r.edge < cfg.edgeCap)));
  if (cfg.betRule) triple(`bet rule ${pct(cfg.betRule.min, 0)}–${pct(cfg.betRule.max, 0)}`, rows.filter(r => r.edge >= cfg.betRule.min && r.edge < cfg.betRule.max));
  triple('Sharp Value', rows.filter(r => r.sharp_value));
  for (const t of cfg.tiers) triple(`tier ${t.name}`, rows.filter(r => r.tier === t.name));
  triple('every side (no filter)', rows);
  block('No entry price (not in any summary above)', summary(rows.filter(r => !r.source), () => 'no entry price'));
  L.push('');
  const cols = ['event', 'date', 'tournament', 'surface', 'side', 'player', 'opponent', 'entry_ts', 'model_prob', 'edge_vs_pinnacle_pp', 'sharp_value', 'pin_novig_price',
    'b105_price', 'b105_opp_price', 'b105_at', 'source', 'entry_novig_price', 'edge', 'tier', 'bet_price', 'result', 'result_source', 'bet_rule', 'profit',
    'close_price', 'close_opp_price', 'clv', 'b105_open', 'b105_open_at', 'b105_close', 'b105_close_at', 'b105_close_cut', 'profit_at_open', 'profit_at_close', 'clv_b105', 'note'];
  L.push(cols.map(cell).join(','));
  for (const r of rows) L.push(cols.map(c => cell(r[c])).join(','));
  return L.join('\n') + '\n';
}

// ── I/O ──
async function boardHistory(keys, since, cacheFile) {
  if (cacheFile && fs.existsSync(cacheFile)) return new Map(Object.entries(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))));
  const shas = execFileSync('git', ['-C', ROOT, 'log', '--format=%H', `--since=${since}`, 'origin/main', '--', 'matches.json'], { maxBuffer: 1 << 26 })
    .toString().trim().split('\n').reverse();
  const keep = new Map();
  const want = new Set(keys.map(String));
  const proc = spawn('git', ['-C', ROOT, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = Buffer.alloc(0), waiting = null;
  proc.stdout.on('data', d => { buf = Buffer.concat([buf, d]); if (waiting) waiting(); });
  const readObj = () => new Promise(res => {
    const tryRead = () => {
      const nl = buf.indexOf(10); if (nl < 0) return false;
      const head = buf.slice(0, nl).toString(); const size = +head.split(' ')[2];
      if (!Number.isFinite(size)) { buf = buf.slice(nl + 1); res(null); return true; }
      if (buf.length < nl + 1 + size + 1) return false;
      const body = buf.slice(nl + 1, nl + 1 + size); buf = buf.slice(nl + 1 + size + 1); res(body); return true;
    };
    if (!tryRead()) waiting = () => { if (tryRead()) waiting = null; };
  });
  let i = 0;
  for (const s of shas) {
    proc.stdin.write(`${s}:matches.json\n`);
    const body = await readObj(); i++;
    if (!body) continue;
    let list; try { list = JSON.parse(body.toString()); } catch (_) { continue; }
    for (const m of Array.isArray(list) ? list : []) {
      const k = String(m && m.id || '').replace(/^(upcoming|past|finished)-/, '');
      if (!want.has(k)) continue;
      const prev = keep.get(k) || {};
      keep.set(k, { p1: m.p1, p2: m.p2, p1Key: m.p1Key ?? prev.p1Key ?? null, p2Key: m.p2Key ?? prev.p2Key ?? null,
        finalScore: m.finalScore || prev.finalScore || null, retired: m.finalScore ? !!m.retired : !!prev.retired,
        walkover: !!(m.walkover || prev.walkover), pinClose: m.pinClose || prev.pinClose || null });
    }
    if (i % 250 === 0) console.error(`board history: ${i}/${shas.length} commits read`);
  }
  proc.stdin.end();
  if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(keep)));
  return keep;
}
async function b105Histories(keys) {
  const K = process.env.SUPABASE_PUBLISHABLE_KEY, U = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!K || !U) throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set (price_history is the page\'s own read)');
  const out = new Map(), q = [...new Set(keys.filter(Boolean))];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const k = q.shift();
      try {
        const r = await fetch(`${U}/rest/v1/rpc/price_history`, { method: 'POST', headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_card_key: k }) });
        if (r.ok) out.set(k, await r.json());
      } catch (_) { /* a failed read = no bet105 price for that match, said in its row */ }
    }
  }));
  return out;
}
async function main() {
  const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const out = arg('--out'); if (!out) { console.error('usage: value-backtest.mjs --out FILE.csv [--board-cache F] [--since YYYY-MM-DD]'); return 2; }
  const since = arg('--since') || '2026-07-20';
  const sharpCfg = require(path.join(ROOT, 'h2h-model/config.js')).value.sharpEdge;
  if (sharpCfg !== SHARP_VALUE_MIN) throw new Error(`Sharp Value threshold drifted: config ${sharpCfg} vs ${SHARP_VALUE_MIN}`);
  const log = JSON.parse(execFileSync('git', ['-C', ROOT, 'show', 'origin/main:admin-log.json'], { maxBuffer: 1 << 28 }).toString());
  const rowsIn = Object.values(log.flags).filter(r => r.valueSnapshot && r.date >= since);
  const board = await boardHistory(rowsIn.map(r => r.key), since, arg('--board-cache'));
  const b105 = await b105Histories(rowsIn.map(r => cardKey(r.date, r.p1, r.p2)));
  const rows = buildRows({ log, board, b105, since });
  fs.writeFileSync(out + '.tmp', toCsv(rows)); fs.renameSync(out + '.tmp', out);
  const n = s => rows.filter(r => r.source === s).length;
  console.log(`value-backtest: ${rowsIn.length} matches → ${rows.length} sides; bet105 ${n('bet105')}, Pinnacle no-vig ${n('pinnacle-novig')}, no price ${n(null)}; with a result ${rows.filter(r => r.result).length}; board cards found ${board.size} → ${out}`);
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(c => { process.exitCode = c; }, e => { console.error('value-backtest: ' + e.message); process.exitCode = 1; });
}
