#!/usr/bin/env node
// Model value ledger (founder brief 2026-11-01): every model price shown before a match, saved for good with the market
// prices at that moment, settled for closing-line value and result, and grouped into value tiers at export.
//
//   node tools/value-ledger.mjs record [--dry-run]     (pipeline.yml, every data run; env SUPABASE_URL + SUPABASE_SECRET_KEY)
//   node tools/value-ledger.mjs export --out FILE.csv   (value-ledger.yml mode export; the same env)
//
// READ-ONLY toward everything it reads: model-output.json (this run's model), matches.json (the board), pinnacle-closes.json
// (this run's export of the Pinnacle close archive), the bet105 prices in line_prices_current and the Kibl worker's
// heartbeat. It changes none of them, nor the model, the anchor, the stream, the archive, Picks or the Bet Tracker.
//
// WRITES only the three ledger tables (supabase/migrations/20261101090000_model_value_ledger.sql), INSERT … ON CONFLICT DO
// NOTHING (`resolution=ignore-duplicates`). Never an UPDATE, DELETE or upsert-merge: tools/test-value-ledger.mjs fails if
// any tracked file does one. Per run:
//   1. snapshots — each upcoming match the model priced this run, each side: model price, Pinnacle anchor + latest read,
//      bet105 live price + its Kibl time, the two edges, layers active, full model / alt-anchor / Elo-only;
//   2. marks — 'first_edge' (the first snapshot with a positive edge vs bet105) as it appears; 'last_pre_start' (the last
//      snapshot taken before the VERIFIED start) once the match has started;
//   3. settlements — a finished match's marks: the Pinnacle close (this side + the other, its time), CLV, the result on
//      Pinnacle's rules (settlement.js), flat-1u profit at the snapshot's bet105 price. No close → CLV null; no bet105
//      price → profit null. Never estimated, never another book.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = require(path.join(ROOT, 'value-ledger-config.js'));
const SETTLE = require(path.join(ROOT, 'settlement.js'));
const PICKS = require(path.join(ROOT, 'picks-core.js'));
const { berlinWallMs } = require(path.join(ROOT, 'berlin-time.js'));

export const TABLES = { snap: 'value_ledger_snapshot', mark: 'value_ledger_mark', settle: 'value_ledger_settlement' };
const SIDES = ['p1', 'p2'];
const H = 3600e3;

// ── pure rules ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const num = x => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const px = x => { const n = num(x); return n != null && n >= 1.01 ? n : null; };
const r6 = x => (x == null ? null : Math.round(x * 1e6) / 1e6);
export function eventKeyOf(m) { const x = /(\d+)$/.exec(String((m && m.id) || '')); return x ? Number(x[1]) : null; }
// Edge = probability × decimal odds − 1 (the brief's definition). Null when either is missing.
export function edgeOf(prob, price) { const p = num(prob), o = px(price); return p == null || o == null ? null : r6(p * o - 1); }
// The no-vig decimal price of one side of a two-way pair (1 / its share of the summed implied), or null.
export function noVig(price, opp) { const a = px(price), b = px(opp); return a == null || b == null ? null : r6(1 / ((1 / a) / (1 / a + 1 / b))); }
// A snapshot's edge on the configured basis: vs the no-vig bet105 price (default) or vs the price as quoted.
export function edgeFor(s, basis = CFG.edgeBasis) {
  return basis === 'b105' ? num(s.edge_b105) : edgeOf(s.model_prob, noVig(s.b105_price, s.b105_opp_price));
}
// The tier of an edge under the config's thresholds, or null (untagged / no edge).
export const CAPPED = 'Capped (likely model error)';
export function tierOf(edge, tiers = CFG.tiers, cap = CFG.edgeCap) {
  if (edge == null || !Number.isFinite(edge)) return null;
  if (cap != null && edge >= cap) return CAPPED;
  for (const t of tiers) if (edge >= t.min && (t.max == null || edge < t.max)) return t.name;
  return null;
}
export function priceKindOf(state) { return state === 2 ? 'full' : state === 1 ? 'alt-anchor' : 'elo-only'; }
// The board's own started test (bsp-pipeline.js modelMatchStarted): finished, live, interrupted with a score, or past-.
export function startedOnBoard(m) {
  return !!(m && (m.finalScore || m.live || (Array.isArray(m.liveScore) && m.liveScore.length) || (m.interrupted && m.partialScore)
    || /^past-/.test(String(m.id || ''))));
}
export function tierOfMatch(m) {
  if (!m) return null;
  if (/challenger/i.test(String(m.tourBadge || '')) || /challenger/i.test(String(m.tour || ''))) return 'challenger';
  if (m.qualifying === true) return 'qualifying';
  if (m.qualifying === false) return 'main draw';
  return null;
}
export function scheduledStartMs(m) { const t = berlinWallMs(m && m.date, m && m.time); return Number.isFinite(t) ? t : null; }
// The page's display gate (renderEdgeModel / modelGate, founder 2026-07-25): state 2 and 0 < hours to the start ≤ 30.
// The start is the board's (startTs, else the scheduled Berlin wall clock): aOddsStartMs reads the same order.
export function shownOnPage(state, m, nowMs) {
  const s = num(Date.parse((m && m.startTs) || '')) ?? scheduledStartMs(m);
  if (s == null) return false;
  const h = (s - nowMs) / H;
  return state === 2 && h > 0 && h <= 30;
}
// The VERIFIED start of a match (CLAUDE.md "Close only at a verified start"): the archive export's start (live-flip or the
// earlier-of rule), else our live-flip log, else the board card's own close start when it is the actual start (card
// state, live-flip). Never the schedule.
export function verifiedStart(ek, closesByEk, m, flips) {
  const c = closesByEk && closesByEk.get(String(ek));
  if (c && c.startTs && Number.isFinite(Date.parse(c.startTs))) return { ts: new Date(Date.parse(c.startTs)).toISOString(), source: 'archive export: ' + (c.startSource || 'verified start') };
  // our live-flip (live_flip_log_current): the last poll where the match was NOT live — the house rule's verified start,
  // null on the table when play was not seen soon enough after the flag (founder 2026-10-26/27: no lower bound, no start)
  const f = flips && flips.get(String(ek));
  if (f && f.last_not_live_seen_at && Number.isFinite(Date.parse(f.last_not_live_seen_at))) return { ts: new Date(Date.parse(f.last_not_live_seen_at)).toISOString(), source: 'live-flip (last poll not live)' };
  const pc = m && m.pinClose;
  if (pc && pc.startBasis === 'actual' && pc.startTs && Number.isFinite(Date.parse(pc.startTs))) return { ts: new Date(Date.parse(pc.startTs)).toISOString(), source: 'card state actual start' };
  return null;
}
// bet105 match-winner prices of one event from line_prices_current rows, per side (player key). A side is priced only when
// its row is 'ok', ≥ 1.01, and the worker's heartbeat is fresh. Else the reason, never another book.
export function b105Of(rows, sideKey, oppKey, hbAgeMs, staleMin = CFG.b105StaleMin) {
  if (sideKey == null) return { price: null, opp: null, at: null, status: 'no player key' };
  const row = k => (rows || []).find(r => r.market === 'ml' && String(r.side) === String(k)) || null;
  const me = row(sideKey), op = row(oppKey);
  if (!me) return { price: null, opp: null, at: null, status: 'no bet105 price for this match' };
  if (hbAgeMs == null || !(hbAgeMs <= staleMin * 60e3)) return { price: null, opp: null, at: me.inserted_on || null, status: 'stale: bet105 stream heartbeat older than ' + staleMin + ' min' };
  if (me.status !== 'ok' || px(me.price) == null) return { price: null, opp: null, at: me.inserted_on || null, status: 'bet105 ' + (me.status || 'no price') };
  return { price: px(me.price), opp: op && op.status === 'ok' ? px(op.price) : null, at: me.inserted_on || null, status: 'ok' };
}

// One snapshot row per side of every upcoming match the model priced this run.
export function buildSnapshots({ modelOutput, matches, lines, hbAgeMs, runId, nowMs }) {
  const out = [], skipped = { notPriced: 0, frozenOrStarted: 0, noKey: 0 };
  const seen = new Set();
  for (const m of matches || []) {
    const ek = eventKeyOf(m); if (ek == null || seen.has(ek)) continue;
    const e = modelOutput && modelOutput.matches && modelOutput.matches[m.id];
    if (!e) continue;
    if (startedOnBoard(m) || e.frozen) { if (e.ok) skipped.frozenOrStarted++; continue; }
    if (!e.ok || e.preMatch !== true || !e.stage3 || !e.stage3.fair) { skipped.notPriced++; continue; }
    seen.add(ek);
    const bs = (e.stage1 && e.stage1.baseState) || {}, state = num(bs.state);
    const s2 = e.stage2 || {}, sharp = e.stage3.sharp || null;
    const pinRead = m.bookNow && m.bookNow.Pncl && m.bookNow.Pncl.seenAt ? m.bookNow.Pncl.seenAt : null;
    const keys = { p1: m.p1Key != null ? String(m.p1Key) : null, p2: m.p2Key != null ? String(m.p2Key) : null };
    const sched = scheduledStartMs(m);
    for (const s of SIDES) {
      const o = s === 'p1' ? 'p2' : 'p1';
      const prob = num(e.stage3.fair[s] && e.stage3.fair[s].prob);
      if (prob == null || !(prob > 0 && prob < 1)) { skipped.notPriced++; continue; }
      const b = b105Of(lines && lines.get(ek), keys[s], keys[o], hbAgeMs);
      const anchor = bs.anchorBook === 'Pinnacle' && bs.anchorPrice ? px(bs.anchorPrice[s]) : null;
      const pinNow = sharp && sharp.price ? px(sharp.price[s]) : null;
      out.push({
        run_id: runId, snapshot_ts: e.computedAt || new Date(nowMs).toISOString(), event_key: ek, side: s,
        player_key: keys[s], player: m[s] || null, opponent_key: keys[o], opponent: m[o] || null,
        tournament: m.tour || null, tier: tierOfMatch(m), surface: m.surface || null, round: m.tournamentRound || null,
        best_of: num(e.match && e.match.bestOf), scheduled_start: sched != null ? new Date(sched).toISOString() : null,
        model_prob: prob, model_fair_odds: num(e.stage3.fair[s].odds), base_state: state, price_kind: priceKindOf(state),
        shown_on_page: shownOnPage(state, m, nowMs),
        layers_active: num(s2.appliedCount), layers_total: Array.isArray(s2.adjustments) ? s2.adjustments.length : null,
        pin_anchor_price: anchor, pin_anchor_ts: anchor != null ? (bs.anchorPrice.ts || null) : null,
        pin_now_price: pinNow, pin_now_read_at: pinNow != null ? pinRead : null,
        b105_price: b.price, b105_opp_price: b.opp, b105_price_at: b.price != null ? b.at : null, b105_status: b.status,
        edge_b105: edgeOf(prob, b.price), edge_pin: edgeOf(prob, pinNow),
        detail: { anchorBook: bs.anchorBook || null, anchorPrice: state === 1 && bs.anchorPrice ? bs.anchorPrice : undefined,
          pinSource: sharp ? sharp.source || null : null, calibration: e.stage3.calibration || undefined, b105LastAt: b.price == null ? b.at : undefined, modelGeneratedAt: e.generatedAt || null },
      });
    }
  }
  return { rows: out, skipped };
}

// The first_edge marks to add: per (event, side) with no mark yet, the earliest snapshot (of those given) whose edge vs
// bet105 is positive.
export function firstEdgeMarks(snaps, existing) {
  const have = new Set((existing || []).filter(x => x.kind === 'first_edge').map(x => x.event_key + '|' + x.side));
  const best = new Map();
  for (const r of snaps || []) {
    if (!(edgeFor(r) > 0) || r.id == null) continue;
    const k = r.event_key + '|' + r.side; if (have.has(k)) continue;
    const b = best.get(k); if (!b || Date.parse(r.snapshot_ts) < Date.parse(b.snapshot_ts) || (r.snapshot_ts === b.snapshot_ts && r.id < b.id)) best.set(k, r);
  }
  return [...best.values()].map(r => ({ event_key: r.event_key, side: r.side, kind: 'first_edge', snapshot_id: r.id, detail: { edge_b105: r.edge_b105, edge: edgeFor(r), basis: CFG.edgeBasis } }));
}
// The last snapshot strictly before the verified start (null when none).
export function lastBefore(snaps, startIso) {
  const t = Date.parse(startIso); let best = null;
  for (const r of snaps || []) {
    const s = Date.parse(r.snapshot_ts);
    if (!(s < t)) continue;
    if (!best || s > Date.parse(best.snapshot_ts) || (s === Date.parse(best.snapshot_ts) && r.id > best.id)) best = r;
  }
  return best;
}
// The board's result for one side, on Pinnacle's rules: { result, betRule, winner } or null when not finished.
export function resultOf(m, side) {
  if (!m) return null;
  const fs = m.finalScore;
  if (m.walkover) return { result: 'void', betRule: 'void', winner: null, why: 'walkover' };
  if (!fs || (fs.winner !== 'p1' && fs.winner !== 'p2')) return null;
  const sets = Array.isArray(fs.sets) ? fs.sets.map(x => [num(x.p1), num(x.p2)]) : null;
  const rule = SETTLE.settleBet({ retired: !!(m.retired || fs.retired), sets });
  if (rule === 'void' || rule === 'no-sets') return { result: 'void', betRule: rule, winner: fs.winner, why: rule === 'void' ? 'retired before the first set was completed' : 'retired, first set not on record' };
  return { result: fs.winner === side ? 'won' : 'lost', betRule: rule, winner: fs.winner };
}
// The Pinnacle close of one side from the archive export row, oriented by player keys (never names).
export function closeFor(c, m, side) {
  if (!c || !m) return null;
  const k1 = String(m.p1Key), k2 = String(m.p2Key), r1 = String(c.p1Key), r2 = String(c.p2Key);
  const same = r1 === k1 && r2 === k2, swap = r1 === k2 && r2 === k1;
  if (!same && !swap) return null;
  const a = px(same ? c.p1 : c.p2), b = px(same ? c.p2 : c.p1);
  if (a == null || b == null) return null;
  const me = side === 'p1' ? a : b, op = side === 'p1' ? b : a;
  const st = Date.parse(c.startTs || ''), ct = Date.parse(c.closeTs || '');
  return { price: me, opp: op, ts: c.closeTs || null, label: c.label || null, startTs: c.startTs || null,
    gapS: Number.isFinite(st) && Number.isFinite(ct) ? Math.round((st - ct) / 1000) : num(c.gapToStartS) };
}
// One settlement row for a mark, or null to wait (the close may still come).
export function settlementFor({ mark, snap, m, close, startIso, nowMs, waitHours = CFG.closeWaitHours }) {
  const res = resultOf(m, mark.side); if (!res) return null;
  if (!close) { const st = Date.parse(startIso || ''); if (!Number.isFinite(st) || nowMs - st < waitHours * H) return null; }
  const b105 = px(snap.b105_price);
  const profit = b105 == null ? null : res.result === 'void' ? 0 : res.result === 'won' ? r6(b105 - 1) : -1;
  return {
    event_key: mark.event_key, side: mark.side, mark_kind: mark.kind, snapshot_id: snap.id, b105_price: b105,
    close_price: close ? close.price : null, close_opp_price: close ? close.opp : null, close_ts: close ? close.ts : null,
    close_label: close ? close.label : null, close_start_ts: close ? close.startTs : null, close_gap_s: close ? close.gapS : null,
    clv: close && b105 != null ? r6(PICKS.clv(b105, close.price, close.opp)) : null,
    result: res.result, bet_rule: res.betRule, profit,
    no_profit_reason: b105 == null ? 'no bet105 price at this snapshot' : null,
    detail: { winner: res.winner, why: res.why || null, score: (m.finalScore && m.finalScore.display) || null, noClose: close ? undefined : 'no Pinnacle close in the archive ' + waitHours + ' h after the start' },
  };
}

// ── export: every row, the tier summary first ──────────────────────────────────────────────────────────────────────────
export function summarise(rows, cfg = CFG) {
  const groups = new Map();
  const keyOf = r => [r.mark_kind, r.price_kind, r.tier || 'untagged'].join('|');
  for (const r of rows) {
    const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r);
  }
  const order = cfg.tiers.map(t => t.name).concat([CAPPED, 'untagged']);
  const out = [];
  for (const mk of ['first_edge', 'last_pre_start']) for (const pk of ['full', 'alt-anchor', 'elo-only']) for (const tn of order) {
    const g = groups.get([mk, pk, tn].join('|')) || [];
    const settled = g.filter(r => r.result != null);
    const bets = settled.filter(r => r.profit != null && r.result !== 'void');
    const gapOk = r => r.clv != null && (cfg.clvCloseMaxGapMin == null || (r.close_gap_s != null && r.close_gap_s <= cfg.clvCloseMaxGapMin * 60));
    const withClv = settled.filter(gapOk);
    const thin = bets.length < cfg.minSettledForRates;
    const profit = bets.reduce((a, r) => a + r.profit, 0);
    const won = bets.filter(r => r.result === 'won').length;
    out.push({ key_snapshot: mk, price_kind: pk, tier: tn, rows: g.length, settled: settled.length, bets: bets.length,
      void: settled.filter(r => r.result === 'void').length, no_bet105: settled.filter(r => r.profit == null).length,
      clv_n: withClv.length, avg_clv: thin || !withClv.length ? null : withClv.reduce((a, r) => a + r.clv, 0) / withClv.length,
      won, win_rate: thin ? null : won / bets.length, profit: bets.length ? profit : null, roi: thin ? null : profit / bets.length,
      thin });
  }
  return out;
}
const DASH = '—';
const cell = v => { if (v == null) return DASH; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const pct = (x, d = 1) => (x == null ? null : (x * 100).toFixed(d) + '%');
const sgnU = x => (x == null ? null : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + 'u');
// The CSV opens with the tier summary (key snapshots only), then every row (keyRows + the other snapshots).
export function toCsv(keyRows, allRows, cfg = CFG, generatedAt = new Date().toISOString()) {
  const S = summarise(keyRows, cfg), L = [];
  const tierTxt = cfg.tiers.map(t => `${t.name} ${pct(t.min, 0)}${t.max == null ? '+' : '–' + pct(t.max, 0)}`).join(' · ');
  L.push(['Model value ledger — tier summary', generatedAt].map(cell).join(','));
  L.push(cell(`Edge = model probability × bet105 ${cfg.edgeBasis === 'b105' ? 'price as quoted' : 'no-vig price (both sides of the pair)'} − 1; profit at the price as quoted. Tiers: ${tierTxt}; below ${pct(cfg.tiers[0].min, 0)} untagged. Rates need ${cfg.minSettledForRates} settled bets (else a dash, with the count). CLV only from a Pinnacle close seen ≤ ${cfg.clvCloseMaxGapMin == null ? 'any' : cfg.clvCloseMaxGapMin} min before the start. Population: every snapshot that is a key snapshot of its match-side.`));
  L.push(['key snapshot', 'price kind', 'tier', 'key snapshots', 'settled', 'bets (priced, not void)', 'void', 'no bet105 price', 'avg CLV', 'CLV n', 'won', 'win rate', 'win rate n', 'profit (1u flat)', 'ROI', 'ROI n'].map(cell).join(','));
  for (const s of S) {
    if (!s.rows) continue;
    L.push([s.key_snapshot, s.price_kind, s.tier, s.rows, s.settled, s.bets, s.void, s.no_bet105, pct(s.avg_clv, 2), s.clv_n, s.won,
      pct(s.win_rate), s.bets, sgnU(s.profit), pct(s.roi), s.bets].map(cell).join(','));
  }
  L.push('');
  const cols = ['snapshot_id', 'snapshot_ts', 'event_key', 'side', 'player', 'opponent', 'tournament', 'tier_of_event', 'surface', 'round', 'scheduled_start',
    'price_kind', 'base_state', 'shown_on_page', 'layers_active', 'layers_total', 'model_prob', 'model_fair_odds', 'pin_anchor_price', 'pin_anchor_ts',
    'pin_now_price', 'pin_now_read_at', 'b105_price', 'b105_opp_price', 'b105_price_at', 'b105_status', 'edge_b105', 'edge', 'edge_pin', 'value_tier', 'key_snapshot',
    'close_price', 'close_opp_price', 'close_ts', 'close_label', 'close_gap_s', 'clv', 'result', 'bet_rule', 'profit', 'no_profit_reason'];
  L.push(cols.map(cell).join(','));
  for (const r of allRows) L.push(cols.map(c => cell(c === 'value_tier' ? r.tier : c === 'tier_of_event' ? r.event_tier : c === 'key_snapshot' ? r.mark_kind : r[c])).join(','));
  return L.join('\n') + '\n';
}
// Joins the three tables into export rows. The tier and the first-edge snapshot are derived HERE from the stored prices on
// the configured basis (so a basis or threshold change re-tests the same rows); the stored first_edge marks stay in the
// database as the record of what each run saw. last_pre_start = the stored mark (cut at the verified start). A match-side's
// close and result come from its newest settlement row (any key snapshot: they are the match's); CLV and profit are
// worked from each key snapshot's own bet105 price.
export function exportRows(snaps, marks, settles, cfg = CFG) {
  const byId = new Map(snaps.map(s => [s.id, s]));
  const superseded = new Set(settles.map(x => x.supersedes).filter(x => x != null));
  const settleOf = new Map();
  for (const x of settles) if (!superseded.has(x.id)) { const k = x.event_key + '|' + x.side; const p = settleOf.get(k); if (!p || x.id > p.id) settleOf.set(k, x); }
  const edge = s => edgeFor(s, cfg.edgeBasis);
  const base = s => Object.assign({}, s, { snapshot_id: s.id, event_tier: s.tier, edge: edge(s), tier: tierOf(edge(s), cfg.tiers, cfg.edgeCap) || 'untagged' });
  const settled = (s, kind) => {
    const st = settleOf.get(s.event_key + '|' + s.side) || {};
    const b = px(s.b105_price), res = st.result ?? null, close = px(st.close_price), opp = px(st.close_opp_price);
    return Object.assign(base(s), { mark_kind: kind, close_price: close, close_opp_price: opp, close_ts: st.close_ts ?? null,
      close_label: st.close_label ?? null, close_gap_s: num(st.close_gap_s),
      clv: b != null && close != null && opp != null ? r6(PICKS.clv(b, close, opp)) : null,
      result: res, bet_rule: st.bet_rule ?? null,
      profit: res == null || b == null ? null : res === 'void' ? 0 : res === 'won' ? r6(b - 1) : -1,
      no_profit_reason: res != null && b == null ? 'no bet105 price at this snapshot' : null });
  };
  const lps = new Map(marks.filter(m => m.kind === 'last_pre_start').map(m => [m.event_key + '|' + m.side, m]));
  const bySide = new Map();
  for (const s of snaps) { const k = s.event_key + '|' + s.side; if (!bySide.has(k)) bySide.set(k, []); bySide.get(k).push(s); }
  const rows = [], keyed = new Set();
  for (const [k, list] of bySide) {
    const lm = lps.get(k), last = lm ? byId.get(lm.snapshot_id) : null;
    const cut = last ? Date.parse(last.snapshot_ts) : Infinity;
    const first = list.filter(s => edge(s) > 0 && Date.parse(s.snapshot_ts) <= cut)
      .sort((a, b) => Date.parse(a.snapshot_ts) - Date.parse(b.snapshot_ts) || a.id - b.id)[0];
    if (first) { rows.push(settled(first, 'first_edge')); keyed.add(first.id); }
    if (last) { rows.push(settled(last, 'last_pre_start')); keyed.add(last.id); }
  }
  const keyRows = rows.slice();
  for (const s of snaps) if (!keyed.has(s.id)) rows.push(Object.assign(base(s), { mark_kind: null }));
  return { rows, keyRows };
}

// ── Supabase I/O (service key; the ledger tables are not readable with the publishable key) ───────────────────────────
function sbConf() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_SECRET_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY not set');
  return { url, key };
}
async function sbGet(pathQ) {
  const { url, key } = sbConf(); const out = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${url}/rest/v1/${pathQ}${pathQ.includes('?') ? '&' : '?'}limit=1000&offset=${off}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`GET ${pathQ.split('?')[0]} HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json(); out.push(...j); if (j.length < 1000) return out;
  }
}
// INSERT … ON CONFLICT DO NOTHING; returns the rows actually inserted (an existing row is skipped, never changed).
async function sbInsert(table, rows, onConflict) {
  if (!rows.length) return [];
  const { url, key } = sbConf(); const got = [];
  for (let i = 0; i < rows.length; i += 200) {
    const r = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, { method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(rows.slice(i, i + 200)) });
    if (!r.ok) throw new Error(`INSERT ${table} HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`);
    got.push(...await r.json());
  }
  return got;
}
const inList = ks => `in.(${[...new Set(ks)].join(',')})`;

async function record(dry) {
  const read = f => JSON.parse(fs.readFileSync(path.join(process.env.VALUE_LEDGER_DIR || ROOT, f), 'utf8'));
  const modelOutput = read('model-output.json'), matches = read('matches.json');
  let closes = [];
  try { closes = read('pinnacle-closes.json'); } catch (e) { console.log('value-ledger: no pinnacle-closes.json this run — settlements wait (said out loud)'); }
  const closesByEk = new Map((Array.isArray(closes) ? closes : closes.rows || []).map(c => [String(c.eventKey), c]));
  const nowMs = Date.now();
  const runId = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || 1}` : 'local-' + new Date(nowMs).toISOString();
  const { url, key } = sbConf(), H_ = { apikey: key, Authorization: `Bearer ${key}` };

  // 1. snapshots
  const upEks = [...new Set(matches.filter(m => !startedOnBoard(m)).map(eventKeyOf).filter(k => k != null))];
  const lines = new Map();
  if (upEks.length) {
    const lr = await sbGet(`line_prices_current?select=event_key,market,side,line,price,status,inserted_on,seen_at&book=eq.bet105&market=eq.ml&event_key=${inList(upEks)}`);
    for (const x of lr) { const k = Number(x.event_key); if (!lines.has(k)) lines.set(k, []); lines.get(k).push(x); }
  }
  const hb = await (await fetch(`${url}/rest/v1/kibl_now_price?select=written_at&kind=eq.heartbeat`, { headers: H_ })).json().catch(() => []);
  const hbAt = Array.isArray(hb) && hb[0] ? Date.parse(hb[0].written_at) : NaN;
  const hbAgeMs = Number.isFinite(hbAt) ? nowMs - hbAt : null;
  const { rows: snaps, skipped } = buildSnapshots({ modelOutput, matches, lines, hbAgeMs, runId, nowMs });
  const priced = snaps.filter(r => r.b105_price != null).length;
  console.log(`value-ledger: ${snaps.length} snapshot rows (${snaps.length / 2} matches × 2 sides), bet105 priced ${priced} of ${snaps.length}; heartbeat age ${hbAgeMs == null ? '—' : Math.round(hbAgeMs / 1000) + ' s'}; skipped: ${JSON.stringify(skipped)}`);
  if (dry) { console.log(JSON.stringify(snaps.slice(0, 2), null, 1)); return 0; }
  const ins = await sbInsert(TABLES.snap, snaps, 'run_id,event_key,side');

  // 2a. first_edge marks
  const insEks = [...new Set(ins.map(r => r.event_key))];
  const have = insEks.length ? await sbGet(`${TABLES.mark}?select=event_key,side,kind&event_key=${inList(insEks)}`) : [];
  const fe = await sbInsert(TABLES.mark, firstEdgeMarks(ins, have), 'event_key,side,kind');

  // 2b. last_pre_start marks + 3. settlements, for board matches that have started
  const started = new Map();
  for (const m of matches) { const ek = eventKeyOf(m); if (ek != null && startedOnBoard(m)) { const p = started.get(ek); if (!p || m.finalScore || m.walkover) started.set(ek, m); } }
  const stEks = [...started.keys()];
  let lps = 0, settledN = 0, waiting = 0, noStart = 0;
  if (stEks.length) {
    const snapEks = new Set((await sbGet(`${TABLES.snap}?select=event_key&event_key=${inList(stEks)}`)).map(x => Number(x.event_key)));
    const eks = stEks.filter(k => snapEks.has(k));
    if (eks.length) {
      const flips = new Map((await sbGet(`live_flip_log_current?select=event_key,last_not_live_seen_at&event_key=${inList(eks.map(String))}`)).map(x => [String(x.event_key), x]));
      const marks = await sbGet(`${TABLES.mark}?select=id,event_key,side,kind,snapshot_id&event_key=${inList(eks)}`);
      const newMarks = [];
      for (const ek of eks) {
        const m = started.get(ek), vs = verifiedStart(ek, closesByEk, m, flips);
        const need = SIDES.filter(s => !marks.some(x => Number(x.event_key) === ek && x.side === s && x.kind === 'last_pre_start'));
        if (!need.length) continue;
        if (!vs) { noStart++; continue; }
        const ss = await sbGet(`${TABLES.snap}?select=id,event_key,side,snapshot_ts&event_key=eq.${ek}&snapshot_ts=lt.${encodeURIComponent(vs.ts)}&order=snapshot_ts.desc`);
        for (const s of need) { const b = lastBefore(ss.filter(x => x.side === s), vs.ts); if (b) newMarks.push({ event_key: ek, side: s, kind: 'last_pre_start', snapshot_id: b.id, start_ts: vs.ts, start_source: vs.source }); }
      }
      lps = (await sbInsert(TABLES.mark, newMarks, 'event_key,side,kind')).length;
      const allMarks = marks.concat(newMarks.length ? await sbGet(`${TABLES.mark}?select=id,event_key,side,kind,snapshot_id,start_ts&event_key=${inList(eks)}`) : []);
      const doneS = await sbGet(`${TABLES.settle}?select=event_key,side,mark_kind&event_key=${inList(eks)}`);
      const done = new Set(doneS.map(x => x.event_key + '|' + x.side + '|' + x.mark_kind));
      const todo = [...new Map(allMarks.map(x => [x.event_key + '|' + x.side + '|' + x.kind, x])).values()].filter(x => !done.has(x.event_key + '|' + x.side + '|' + x.kind));
      if (todo.length) {
        const sn = await sbGet(`${TABLES.snap}?select=id,b105_price&id=${inList(todo.map(x => x.snapshot_id))}`);
        const snapById = new Map(sn.map(x => [x.id, x]));
        const rows = [];
        for (const mk of todo) {
          const ek = Number(mk.event_key), m = started.get(ek), snap = snapById.get(mk.snapshot_id); if (!snap) continue;
          const vs = verifiedStart(ek, closesByEk, m, flips);
          const close = closeFor(closesByEk.get(String(ek)), m, mk.side);
          const row = settlementFor({ mark: { event_key: ek, side: mk.side, kind: mk.kind }, snap, m, close, startIso: vs ? vs.ts : null, nowMs });
          if (row) rows.push(row); else waiting++;
        }
        settledN = (await sbInsert(TABLES.settle, rows, 'event_key,side,mark_kind,supersedes')).length;
      }
    }
  }
  console.log(`value-ledger: inserted ${ins.length} snapshots, ${fe.length} first-edge marks, ${lps} last-pre-start marks, ${settledN} settlements; waiting: ${waiting} (result or close), ${noStart} started match(es) with no verified start yet`);
  return 0;
}

async function exportCsv(out) {
  const snaps = await sbGet(`${TABLES.snap}?select=*&order=id.asc`);
  const marks = await sbGet(`${TABLES.mark}?select=*&order=id.asc`);
  const settles = await sbGet(`${TABLES.settle}?select=*&order=id.asc`);
  const { rows, keyRows } = exportRows(snaps, marks, settles);
  const csv = toCsv(keyRows, rows, CFG);
  fs.writeFileSync(out + '.tmp', csv); fs.renameSync(out + '.tmp', out);
  console.log(`value-ledger export: ${snaps.length} snapshots, ${marks.length} marks, ${settles.length} settlements → ${out}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd] = process.argv.slice(2), oi = process.argv.indexOf('--out');
  const run = cmd === 'record' ? record(process.argv.includes('--dry-run'))
    : cmd === 'export' && oi > 0 ? exportCsv(process.argv[oi + 1])
    : Promise.resolve((console.error('usage: value-ledger.mjs record [--dry-run] | export --out FILE.csv'), 2));
  run.then(c => { process.exitCode = c; }, e => { console.error('value-ledger: ' + e.message); process.exitCode = 1; });
}
