#!/usr/bin/env node
// Picks Task 2 — the server side of every figure a member sees on a pick (README: "Open / posted / now / close / CLV /
// P/L / model fair odds are computed server-side from recorded prices; clv and pl_pct are recomputed on write, never
// accepted from a client"). Runs in the pipeline (every ~15 min) with the Firebase Admin SDK, which bypasses
// firestore.rules; reads:
//   - the board (matches.json, this run's build): start / live / final score / retirement / the Pinnacle close
//     (m.pinClose — the page's own Completed close, used only when BOTH legs last moved within 60 min of the start, the
//     site's rule for a close that feeds a figure, TEN-253 ruling 2);
//   - bet105 line prices (Supabase line_prices_current, the Kibl worker's table): Open (first sighting) and Now, per
//     side and line, for Match winner · Games handicap · Total games.
// Writes, per open pick: open_price (once), now_price / opp_now_price (until the start, then frozen = "Last"), status
// posted → live → won / lost / void, result (set scores), close_price / opp_close_price, clv, pl_pct, frozen_at; and the
// teaser's status. Settled picks are re-read for 3 days to pick up a late close. Nothing is ever deleted.
//
// Not settled automatically (left as they are, counted in the log — a ruling is needed, never a guess):
//   - outrights (no event result feed here);
// (Rulings 2026-10-28: a push on a whole-number line is void; a games market on a retirement after set 1 is void unless
//  the line was already decided — see settle().)
//   - a typed ("Other") market.
// Line closes (Games handicap / Total games) stay a dash: oddspapi_line_summary's start-time cut is not yet confirmed to
// match the match-winner close (handoff list) — so their CLV is a dash, never an approximation.
//
// usage: node tools/picks-updater.mjs [--dry-run]   (env: GOOGLE_APPLICATION_CREDENTIALS, SUPABASE_URL, SUPABASE_SECRET_KEY)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = require(path.join(ROOT, 'picks-core.js'));
const SETTLE = require(path.join(ROOT, 'settlement.js'));
const MINUS = '−';
const W60 = 3600e3;

const MKT = { 'Match winner': 'ml', 'Games handicap': 'gh', 'Total games': 'tg' };
export function eventKeyOf(m) { const x = /-(\d+)$/.exec(String(m && m.id || '')); return x ? Number(x[1]) : null; }
// "+2.5" → 2.5 · "−3.5" → −3.5 · "Over 22.5" → { side: 'over', line: 22.5 }
export function parseLine(market, line) {
  const s = String(line || '').replace(MINUS, '-').trim();
  if (market === 'Total games') { const m = /^(over|under)\s+([\d.]+)$/i.exec(s); return m ? { side: m[1].toLowerCase(), line: +m[2] } : null; }
  if (market === 'Games handicap') { const n = parseFloat(s); return isFinite(n) ? { line: n } : null; }
  return { line: null };
}
// the board match → which board side is the pick's player a (by api-tennis player id; never by surname)
function orient(p, m) {
  const a = p.player_a && p.player_a.id, b = p.player_b && p.player_b.id;
  if (a == null || b == null) return null;
  if (String(m.p1Key) === String(a) && String(m.p2Key) === String(b)) return 'p1';
  if (String(m.p2Key) === String(a) && String(m.p1Key) === String(b)) return 'p2';
  return null;
}
// the bet105 row of one side of one line
function row(lines, code, side, line) {
  return (lines || []).find(r => r.market === code && String(r.side) === String(side)
    && (line == null ? r.line == null : r.line != null && Math.abs(+r.line - line) < 1e-9)) || null;
}
function okPrice(r) { return r && r.status === 'ok' && +r.price >= 1.01 ? +r.price : null; }
// the two sides' (side, line) keys for a pick: [picked, other]
export function sidesOf(p) {
  const code = MKT[p.market]; if (!code) return null;
  const a = p.player_a && p.player_a.id, b = p.player_b && p.player_b.id;
  const mine = p.selection === 'b' ? b : a, theirs = p.selection === 'b' ? a : b;
  if (code === 'ml') return mine == null || theirs == null ? null : { code, me: [mine, null], opp: [theirs, null] };
  const L = parseLine(p.market, p.line); if (!L) return null;
  if (code === 'gh') return mine == null || theirs == null ? null : { code, me: [mine, L.line], opp: [theirs, -L.line] };
  return { code, me: [L.side, L.line], opp: [L.side === 'over' ? 'under' : 'over', L.line] };
}
// the board's final score → the pick's result shape { sets: [{ a, b, tb?, tb_side? }], retired }
export function resultOf(m, aIs) {
  const fs = m && m.finalScore; if (!fs || !Array.isArray(fs.sets) || !fs.sets.length) return null;
  const tbs = String(fs.display || '').split(',').map(x => { const t = /\((\d+)\)/.exec(x); return t ? t[1] : null; });
  const sets = fs.sets.map((s, i) => {
    const pa = aIs === 'p1' ? s.p1 : s.p2, pb = aIs === 'p1' ? s.p2 : s.p1, o = { a: String(pa), b: String(pb) };
    if (tbs[i] != null && ((pa === 7 && pb === 6) || (pa === 6 && pb === 7))) { o.tb = tbs[i]; o.tb_side = pa > pb ? 'a' : 'b'; }
    return o;
  });
  return { sets, retired: !!(fs.retired || m.retired) };
}
// won / lost / void for a settled match, or { hold: reason } when no rule settles it
export function settle(p, m, aIs) {
  const fs = m.finalScore, res = resultOf(m, aIs);
  if (!fs || !res) return { hold: 'no final score' };
  const winA = fs.winner === aIs ? true : fs.winner === (aIs === 'p1' ? 'p2' : 'p1') ? false : null;
  const ret = SETTLE.settleBet({ retired: res.retired, walkover: !!m.walkover, sets: res.sets.map(s => [s.a, s.b]) });
  if (ret === 'void' || ret === 'no-sets') return { status: 'void', result: res };
  const code = MKT[p.market];
  if (code === 'ml') { if (winA == null) return { hold: 'no winner' }; return { status: (winA === (p.selection !== 'b')) ? 'won' : 'lost', result: res }; }
  const ga = res.sets.reduce((t, s) => t + (+s.a), 0), gb = res.sets.reduce((t, s) => t + (+s.b), 0);
  const L = parseLine(p.market, p.line); if (!L) return { hold: 'unreadable line' };
  // founder ruling 2026-10-28 (2): a retirement after set 1 on a handicap / totals line is VOID, unless the line was
  // already decided before the retirement — then it settles on that result. A total is decided once the games played
  // pass the line (Over 22.5 with 23 played: Over won, Under lost); short of it, more games could still come → void.
  // A games handicap is never decided while games remain to be played (either side can still win games) → void.
  if (ret === 'stands') {
    if (code === 'tg' && ga + gb > L.line) return { status: L.side === 'over' ? 'won' : 'lost', result: res };
    return { status: 'void', result: res };
  }
  // founder ruling 2026-10-28 (1): a push on a whole-number line is VOID (P/L 0%, out of W–L and of the ROI denominator,
  // like any void — picks-core.js record()).
  if (code === 'gh') { const mine = p.selection === 'b' ? gb : ga, theirs = p.selection === 'b' ? ga : gb, x = mine + L.line - theirs;
    return x === 0 ? { status: 'void', result: res } : { status: x > 0 ? 'won' : 'lost', result: res }; }
  if (code === 'tg') { const tot = ga + gb; if (tot === L.line) return { status: 'void', result: res };
    return { status: (L.side === 'over') === (tot > L.line) ? 'won' : 'lost', result: res }; }
  return { hold: 'typed market' };
}
// the Pinnacle match-winner close, a / b, only when both legs last moved within 60 min of the start
export function pinCloseOf(m, aIs) {
  const c = m && m.pinClose; if (!c || !(c.p1 >= 1.01) || !(c.p2 >= 1.01)) return null;
  const ref = Date.parse(c.ageRefTs || c.startTs || ''), t1 = Date.parse(c.p1At || ''), t2 = Date.parse(c.p2At || '');
  if (![ref, t1, t2].every(Number.isFinite) || ref - t1 > W60 || ref - t2 > W60 || t1 > ref || t2 > ref) return null;
  return aIs === 'p1' ? { a: c.p1, b: c.p2 } : { a: c.p2, b: c.p1 };
}

/** One pick → the patch to write (only changed keys), or null. Pure: board by event key, bet105 rows by event key. */
export function patchFor(p, ctx) {
  const now = ctx.now || Date.now(), out = {};
  const put = (k, v) => { if (v === undefined) return; if (JSON.stringify(p[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = v; };
  if (p.posted_at && !p.frozen_at) put('frozen_at', new Date(Date.parse(p.posted_at) + 600000).toISOString());
  if (p.kind === 'outright' || p.status === 'draft') return Object.keys(out).length ? out : null;
  const m = p.match_id != null ? ctx.board.get(Number(p.match_id)) : null;
  const aIs = m ? orient(p, m) : null;
  const S = sidesOf(p), lines = p.match_id != null ? ctx.lines.get(Number(p.match_id)) : null;
  const started = !!(m && (m.live || m.finalScore));
  if (S && lines) {
    const me = row(lines, S.code, S.me[0], S.me[1]), opp = row(lines, S.code, S.opp[0], S.opp[1]);
    if (p.open_price == null && me && +me.open_price >= 1.01) put('open_price', +me.open_price);
    if (!started && p.status === 'posted') { const a = okPrice(me), b = okPrice(opp); if (a != null) put('now_price', a); if (b != null) put('opp_now_price', b); }
  }
  let status = p.status;
  if (status === 'posted' && started) status = 'live';
  if (m && aIs && S && S.code === 'ml') { const pc = pinCloseOf(m, aIs); if (pc) { const mine = p.selection === 'b' ? pc.b : pc.a, theirs = p.selection === 'b' ? pc.a : pc.b; put('close_price', mine); put('opp_close_price', theirs); } }
  if ((status === 'live' || status === 'posted') && m && aIs && m.finalScore) {
    const st = settle(p, m, aIs);
    if (st.status) { status = st.status; put('result', st.result); }
    else if (ctx.log) ctx.log.push(`${p.id}: held — ${st.hold}`);
  }
  if (status !== p.status) put('status', status);
  const next = Object.assign({}, p, out);
  put('clv', round6(C.clvOf(next))); put('pl_pct', round6(C.plOf(next)));
  return Object.keys(out).length ? out : null;
}
const round6 = x => x == null ? null : Math.round(x * 1e6) / 1e6;

// ── the run ──
async function sbRows(eventKeys) {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_SECRET_KEY || '';
  const out = new Map(); if (!url || !key || !eventKeys.length) return out;
  const q = `${url}/rest/v1/line_prices_current?select=event_key,market,side,line,price,status,open_price&book=eq.bet105&event_key=in.(${eventKeys.join(',')})`;
  const r = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`line_prices_current HTTP ${r.status}`);
  for (const x of await r.json()) { const k = Number(x.event_key); if (!out.has(k)) out.set(k, []); out.get(k).push(x); }
  return out;
}
function toRow(doc) {
  const d = doc.data(), iso = v => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v ?? null;
  return Object.assign({}, d, { id: doc.id, posted_at: iso(d.posted_at), frozen_at: iso(d.frozen_at), edited_at: iso(d.edited_at) });
}
async function main() {
  const dry = process.argv.includes('--dry-run');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) { console.log('picks-updater: SKIP — no service account (GOOGLE_APPLICATION_CREDENTIALS) — said out loud, not a pass'); return 0; }
  let admin; try { admin = require('firebase-admin'); } catch (e) { console.error('picks-updater: firebase-admin is not installed'); return 1; }
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.FIREBASE_PROJECT || 'tennis-edge-75cd9' });
  const db = admin.firestore();
  const boardList = JSON.parse(fs.readFileSync(path.join(ROOT, 'matches.json'), 'utf8'));
  const board = new Map(); (Array.isArray(boardList) ? boardList : []).forEach(m => { const k = eventKeyOf(m); if (k != null) board.set(k, m); });
  const open = await db.collection('picks').where('status', 'in', ['posted', 'live']).get();
  const settled = await db.collection('picks').where('status', 'in', ['won', 'lost', 'void']).get();
  const cutoff = C.addDays(C.brusselsDay(new Date().toISOString()), -3);
  const picks = open.docs.map(toRow).concat(settled.docs.map(toRow).filter(p => p.date >= cutoff && p.close_price == null));
  const keys = [...new Set(picks.map(p => p.match_id).filter(k => k != null).map(Number))];
  const lines = await sbRows(keys);
  const log = [], ctx = { board, lines, log, now: Date.now() };
  let n = 0;
  for (const p of picks) {
    const patch = patchFor(p, ctx); if (!patch) continue;
    n++; console.log(`picks-updater: ${p.id} ${JSON.stringify(patch)}`);
    if (dry) continue;
    const w = Object.assign({}, patch); if (w.frozen_at) w.frozen_at = admin.firestore.Timestamp.fromDate(new Date(w.frozen_at));
    const b = db.batch(); b.update(db.collection('picks').doc(p.id), w);
    if (patch.status) b.set(db.collection('picks_public').doc(p.id), { status: patch.status }, { merge: true });
    await b.commit();
  }
  log.forEach(l => console.log('picks-updater: ' + l));
  console.log(`picks-updater: ${picks.length} picks read (${open.size} open), ${n} ${dry ? 'would change' : 'changed'}, ${log.length} held`);
  return 0;
}
if (import.meta.url === `file://${process.argv[1]}`) main().then(c => process.exit(c), e => { console.error('picks-updater: ' + (e && e.message || e)); process.exit(1); });
