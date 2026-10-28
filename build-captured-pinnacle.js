#!/usr/bin/env node
/*
 * build-captured-pinnacle.js  (TEN-316 — refresh captured Pinnacle closes every pipeline run)
 * ---------------------------------------------------------------------------
 * captured-closes-pinnacle.json was a one-time extract (tools/ten263-extract-captured-pinnacle.mjs,
 * 2026-09-23), so captured Pinnacle stopped at 2026-09-02. This step runs every pipeline run,
 * BEFORE build-match-closes.js, and MERGES new captures into the committed file.
 *
 * SERIES (the board's own capture, in card orientation):
 *   - m.oddsMovement.books.Pinnacle             Oddspapi pinnacle, board matches to 2026-09-02
 *   - m.oddsMovement.chart.books['Pinnacle +30s'] Oddspapi pinnacle+30, from 2026-09-23 (TEN-295:
 *                                               the only Oddspapi book since 26 Sep; chart-only,
 *                                               never in `books`). Book-tick clock.
 *   Never 'Pinnacle (api-tennis)': api-tennis carries no vendor clock.
 *   Read from the COMMITTED matches.json (git HEAD + every commit since the last scan): the
 *   pipeline nulls m.oddsMovement in its working copy when it writes the odds/ shards.
 *
 * RULE (unchanged from the one-time extract): each side = its LAST tick at or before the
 * actual start; both sides required (one book, both sides); a match with no unique actual
 * start is dropped; no tick in the last week before the start = dropped.
 *
 * ACTUAL START, the .claude/rules/odds.md start ladder — never a scheduled time:
 *   1. Oddspapi trueStart (.ten225-fixture-index.json.gz, bet365-history/ v2 rows), unique per
 *      match; rejected when trueEnd - trueStart > 6 h or trueEnd < trueStart.
 *   2. odds-card-state.json startTs (startTsSource 'oddspapi' | 'api-tennis-live'). The live-flip
 *      value is last_not_live_seen_at — a moment the match was OBSERVED not live — so a tick at
 *      or before it cannot be in-play (board ruling 2026-09-28, TEN-316 card 9f0e123c).
 *   When both 1 and 2 exist, the EARLIER one is the cut.
 *   3. none -> dropped.
 *
 * MERGE: rows are keyed by eventKey. A held row is never deleted; it is replaced by a fresh
 * derivation with an EARLIER start (a stricter cut), or the same start and a later close tick.
 *
 * Usage: node build-captured-pinnacle.js [--since <ISO>] [--out <file>]
 * No network calls. Reads git (read-only).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'captured-closes-pinnacle.json');
const MR_OUT = path.join(ROOT, 'market-read-30d.json');   // Step 15: the Market read 30-day line (published, not committed)
const SERIES = [['Pinnacle', (om) => om.books && om.books.Pinnacle],
  ['Pinnacle +30s', (om) => om.chart && om.chart.books && om.chart.books['Pinnacle +30s']]];
// Founder ruling 2026-10-28 (close-rule corrections item 2): the 15-minute capture confirms the price on every read.
// A read is the chart meta's `checkedAt` (refresh-odds-history.py writes it per fixture read, never later than the
// card start, only forward). Each snapshot carries the latest one, so the git history holds every read we made.
const SIGHTED = { 'Pinnacle +30s': (om) => om.chart && om.chart.meta && om.chart.meta['Pinnacle +30s'] && om.chart.meta['Pinnacle +30s'].checkedAt };
// One-time back-fill (2026-10-28): the sightings of rows already held when the rule landed, measured over the full
// matches.json history (a CI clone holds 100 commits). eventKey -> seenAt. Applied to held rows that lack one.
const SEEN_BACKFILL = path.join(ROOT, 'captured-pinnacle-seen-backfill.json');
const START_CATS = new Set(['ATP', 'Davis Cup']);
const STALE_MS = 7 * 864e5;
const MAX_MATCH_MS = 6 * 3600e3;

function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } }
const toMs = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return v > 1e12 ? v : v * 1000; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const iso = (ms) => new Date(ms).toISOString();

// The card-state key, the ruled one (ten225_names.match_key / bsp-pipeline ocsMatchKey).
const { ocsMatchKey } = require('./bsp-pipeline.js');

/** One side's close: the last real tick (>= 1.01) at or before `cutMs`. [ms, price] | null. */
function lastAtOrBefore(ticks, cutMs) {
  let best = null;
  for (const t of ticks || []) {
    if (!Array.isArray(t)) continue;
    const ms = toMs(t[0]), p = Number(t[1]);
    if (ms == null || !(p >= 1.01) || ms > cutMs) continue;
    if (!best || ms >= best[0]) best = [ms, p];
  }
  return best;
}

/** One side's open: the first real tick (>= 1.01) at or before `cutMs`. [ms, price] | null. */
function firstAtOrBefore(ticks, cutMs) {
  let best = null;
  for (const t of ticks || []) {
    if (!Array.isArray(t)) continue;
    const ms = toMs(t[0]), p = Number(t[1]);
    if (ms == null || ms > cutMs || !(p >= 1.01)) continue;
    if (!best || ms < best[0]) best = [ms, p];
  }
  return best;
}

/** Fold one matches.json snapshot into `ev` (eventKey -> identity + per-label tick maps). */
function absorb(ev, matches) {
  for (const m of matches || []) {
    const ek = String((m && m.id) || '').replace(/^[a-z]+-/, '');
    if (!/^\d+$/.test(ek)) continue;
    const om = m.oddsMovement || {};
    for (const [label, get] of SERIES) {
      const s = get(om);
      if (!s) continue;
      const o = ev[ek] || (ev[ek] = { p1: m.p1, p2: m.p2, p1Key: m.p1Key, p2Key: m.p2Key, date: m.date, series: {} });
      // founder ruling 2026-10-18 (phase 2): the round and api-tennis's qualifying flag ride on every captured row, so a
      // Challenger / qualifying close can join the master later by key, not a name-and-date guess (the newest snapshot wins)
      if (m.tournamentRound != null) o.round = m.tournamentRound;
      if (typeof m.qualifying === 'boolean') o.qualifying = m.qualifying;
      if (m.tour) o.event = m.tour;
      // Step 15 (founder 2026-10-27): the result rides on the row too, for the Market read 30-day line.
      const fs0 = m.finalScore;
      if (fs0 && (fs0.winner === 'p1' || fs0.winner === 'p2')) o.winner = fs0.winner;
      const t = o.series[label] || (o.series[label] = { p1: new Map(), p2: new Map() });
      for (const side of ['p1', 'p2']) for (const x of s[side] || []) if (Array.isArray(x) && x[0] != null) t[side].set(String(x[0]), Number(x[1]));
      const ck = SIGHTED[label] && toMs(SIGHTED[label](om));
      if (ck != null) (o.seen || (o.seen = {}))[label] = (o.seen[label] || new Set()).add(ck);
    }
  }
}

/** Oddspapi true starts by card-state key: key -> [{ trueStart, trueEnd, id }]. Dated by the
 *  trueStart's UTC day and the day either side (the card date is the api-tennis account day). */
function oddspapiStarts(root) {
  const by = new Map();
  const add = (id, v) => {
    if (!v || !START_CATS.has(v.cat)) return;
    const ts = toMs(v.trueStart);
    if (ts == null) return;
    const day0 = iso(ts).slice(0, 10);
    for (const n of [-1, 0, 1]) {
      const k = ocsMatchKey(iso(Date.parse(day0) + n * 864e5).slice(0, 10), v.p1, v.p2);
      if (!k) continue;
      const list = by.get(k) || by.set(k, []).get(k);
      if (!list.some((x) => x.id === id)) list.push({ id, trueStart: ts, trueEnd: toMs(v.trueEnd) });
    }
  };
  try {
    const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, '.ten225-fixture-index.json.gz'))).toString()).fixtures || {};
    for (const [id, v] of Object.entries(fx)) add(id, v);
  } catch (e) { /* absent -> the card-state rung only */ }
  const dir = path.join(root, 'bet365-history');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}\.json$/.test(n))) {
      const d = readJson(path.join(dir, f), null);
      for (const [id, v] of Object.entries((d && d.fixtures) || {})) if (v && v.trueStart != null) add(id, v);
    }
  }
  return by;
}

/** The actual start for one card: { ms, source } | { reason }. */
function actualStart(o, trueStarts, cardState) {
  const k = ocsMatchKey(o.date, o.p1, o.p2);
  if (!k) return { reason: 'noKey' };
  const cands = trueStarts.get(k) || [];
  // The one-time extract's rule: a match whose actual start is not unique is dropped.
  if (new Set(cands.map((c) => c.trueStart)).size > 1) return { reason: 'ambiguousStart' };
  const c = cands[0];
  const okTrue = c && !(c.trueEnd != null && (c.trueEnd - c.trueStart > MAX_MATCH_MS || c.trueEnd < c.trueStart));
  const cs = ((cardState && cardState.byKey) || {})[k];
  const csMs = cs && ['oddspapi', 'api-tennis-live'].includes(cs.startTsSource) ? toMs(cs.startTs) : null;
  // Both known: cut at the EARLIER (review 2026-09-28). The two clocks disagree by minutes either way
  // (5 of 25 on the 28 Sep card state had the flip after trueStart), and the later cut can take an
  // in-play tick; the earlier one can only lose a pre-start tick — missing, never in-play.
  if (okTrue && csMs != null && csMs < c.trueStart) return { ms: csMs, source: cs.startTsSource };
  if (okTrue) return { ms: c.trueStart, source: 'oddspapi' };
  if (csMs != null) return { ms: csMs, source: cs.startTsSource };
  return { reason: c ? 'rejectedStart' : 'noStart' };
}

/** The last confirmed sighting of a close: the latest capture read at or after the later close tick and strictly
 *  BEFORE the start (a read after the start is never a sighting — it would put every close at the start). The read
 *  returns the series' full change history, so a read with no newer tick confirms the price stood at that moment.
 *  ms | null (null = no read after the tick: the tick itself is the clock). */
function lastSighting(reads, tickMs, startMs) {
  let best = null;
  for (const ms of reads || []) if (ms >= tickMs && ms < startMs && (best == null || ms > best)) best = ms;
  return best;
}

/** Derive a row for one event, or a drop reason. The book whose close is latest wins; a
 *  match is never priced from two books. */
function deriveRow(ek, o, start, nowMs) {
  if (start.ms == null) return { reason: start.reason };
  if (start.ms > nowMs) return { reason: 'notStarted' };
  if (!o.p1Key || !o.p2Key) return { reason: 'noKeys' };
  let best = null, reason = 'oneSided';
  for (const [label, t] of Object.entries(o.series)) {
    const a = lastAtOrBefore([...t.p1], start.ms), b = lastAtOrBefore([...t.p2], start.ms);
    if (!a || !b) continue;
    if (start.ms - Math.min(a[0], b[0]) > STALE_MS) { reason = 'stale'; continue; }
    const at = Math.max(a[0], b[0]);
    if (!best || at > best.atMs) best = { label, a, b, atMs: at };
  }
  if (!best) return { reason };
  // Step 15: the same series' FIRST real tick per side (at or before the start) = the open, for the Market read
  // 30-day line (founder 2026-10-27: "Open = Pinnacle first price (Oddspapi)").
  const t = o.series[best.label];
  const fa = firstAtOrBefore([...t.p1], start.ms), fb = firstAtOrBefore([...t.p2], start.ms);
  const seen = lastSighting(o.seen && o.seen[best.label], best.atMs, start.ms);
  return { row: { eventKey: Number(ek), date: o.date, p1Key: o.p1Key, p2Key: o.p2Key, p1Name: o.p1, p2Name: o.p2,
    p1: best.a[1], p2: best.b[1], at: iso(best.atMs), trueStart: iso(start.ms), startSource: start.source, book: best.label,
    round: o.round != null ? o.round : null, qualifying: typeof o.qualifying === 'boolean' ? o.qualifying : null, event: o.event || null,
    o1: fa ? fa[1] : null, o2: fb ? fb[1] : null, oAt: fa && fb ? iso(Math.min(fa[0], fb[0])) : null, winner: o.winner || null,
    ...(seen != null ? { seenAt: iso(seen) } : {}) } };
}

/** Merge fresh rows into held ones (see header). Returns { rows, added, replaced }. */
function mergeRows(held, fresh) {
  const by = new Map((held || []).map((r) => [String(r.eventKey), r]));
  let added = 0, replaced = 0, filled = 0;
  for (const r of fresh) {
    const h = by.get(String(r.eventKey));
    if (!h) { by.set(String(r.eventKey), r); added++; continue; }
    // Step 15: a held row gains the open / result fields it lacks (same book only — the open is that book's first tick).
    if (h.book === r.book) {
      let f = false;
      for (const k of ['o1', 'o2', 'oAt', 'winner']) if (h[k] == null && r[k] != null) { h[k] = r[k]; f = true; }
      // A later confirmed sighting of the SAME close (same tick, prices and start) moves the clock forward, never back.
      if (r.seenAt && h.at === r.at && h.p1 === r.p1 && h.p2 === r.p2 && h.trueStart === r.trueStart
          && (!h.seenAt || Date.parse(r.seenAt) > Date.parse(h.seenAt))) { h.seenAt = r.seenAt; f = true; }
      if (f) filled++;
    }
    // A STRICTER (earlier) start always wins, even with an earlier close: the held row may hold a
    // tick that the better start shows was in-play. Same start: a later pre-start tick wins.
    const rs = Date.parse(r.trueStart), hs = Date.parse(h.trueStart);
    const stricter = Number.isFinite(rs) && Number.isFinite(hs) && rs < hs;
    const later = rs === hs && Date.parse(r.at) > Date.parse(h.at);
    if ((stricter || later) && (r.p1 !== h.p1 || r.p2 !== h.p2 || r.at !== h.at || r.trueStart !== h.trueStart)) { by.set(String(r.eventKey), r); replaced++; }
  }
  const rows = [...by.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.eventKey - y.eventKey));
  return { rows, added, replaced, filled };
}

/** The back-fill: a held row without a sighting takes the measured one, only when it is a sighting of THIS row's close
 *  (at or after its tick, before its start). Returns how many rows it filled. */
function applySeenBackfill(rows, bf) {
  let n = 0;
  for (const r of rows || []) {
    const v = bf && bf[String(r.eventKey)];
    if (!v || r.seenAt) continue;
    const s = Date.parse(v.seenAt), at = Date.parse(r.at), st = Date.parse(r.trueStart);
    if (!(s >= at && s < st) || v.at !== r.at || v.p1 !== r.p1 || v.p2 !== r.p2) continue;
    r.seenAt = v.seenAt; n++;
  }
  return n;
}

/** The committed matches.json snapshots to scan: every commit since `since` that touched it,
 *  oldest first, then HEAD. Missing history (a shallow clone) just means fewer snapshots. */
function snapshots(root, since) {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  let commits = [];
  try { commits = git('log', '--format=%H %cI', `--since=${since}`, 'HEAD', '--', 'matches.json').trim().split('\n').filter(Boolean).reverse().map((l) => l.split(' ')); } catch (e) { /* not a repo */ }
  let head = null;
  try { head = git('rev-parse', 'HEAD').trim(); } catch (e) { /* not a repo */ }
  return { commits, head, show: (h) => { try { const M = JSON.parse(git('show', `${h}:matches.json`)); return Array.isArray(M) ? M : (M.matches || []); } catch (e) { return null; } } };
}

function build({ root = ROOT, out = OUT, since = null, nowMs = Date.now(), mrOut } = {}) {
  if (mrOut === undefined) mrOut = out === OUT ? MR_OUT : null;   // a test's own --out never writes the site file
  const held = readJson(out, null) || {};
  const from = since || (held.scannedThrough && held.scannedThrough.at) || '2026-09-01T00:00:00Z';
  const snap = snapshots(root, from);
  const ev = {};
  let scanned = 0, last = null;
  for (const [h, at] of snap.commits) { const M = snap.show(h); if (M) { absorb(ev, M); scanned++; last = { commit: h, at }; } }
  if (snap.head && (!last || last.commit !== snap.head)) { const M = snap.show(snap.head); if (M) { absorb(ev, M); scanned++; } }
  // A local run outside git (fixtures) reads the working file.
  if (!scanned) { const M = readJson(path.join(root, 'matches.json'), null); if (M) { absorb(ev, Array.isArray(M) ? M : (M.matches || [])); scanned++; } }
  const trueStarts = oddspapiStarts(root);
  const cardState = readJson(path.join(root, 'odds-card-state.json'), {});
  const stats = { series: 0, kept: 0, bySource: {}, byBook: {}, dropped: {} };
  const fresh = [];
  for (const [ek, o] of Object.entries(ev)) {
    stats.series++;
    const r = deriveRow(ek, o, actualStart(o, trueStarts, cardState), nowMs);
    if (!r.row) { stats.dropped[r.reason] = (stats.dropped[r.reason] || 0) + 1; continue; }
    fresh.push(r.row); stats.kept++;
    stats.bySource[r.row.startSource] = (stats.bySource[r.row.startSource] || 0) + 1;
    stats.byBook[r.row.book] = (stats.byBook[r.row.book] || 0) + 1;
  }
  const merged = mergeRows(held.rows, fresh);
  const { rows, added, replaced } = merged;
  const bfFilled = applySeenBackfill(rows, (readJson(path.join(root, path.basename(SEEN_BACKFILL)), null) || {}).rows);
  const filled = merged.filled + bfFilled;
  const doc = {
    generatedAt: iso(nowMs),
    source: 'matches.json git history: oddsMovement.books.Pinnacle (Oddspapi pinnacle, to 2026-09-02) and oddsMovement.chart.books["Pinnacle +30s"] (Oddspapi pinnacle+30, from 2026-09-23)',
    rule: 'each side = last tick at or before the actual start (the earlier of Oddspapi trueStart and the card-state start: Oddspapi or the live-flip lower bound); both sides required; dropped when no unique actual start. seenAt = our last capture read before the start that confirmed the close (founder 2026-10-28); age = start - (seenAt or at)',
    scannedThrough: last || held.scannedThrough || null,
    commitsScanned: (held.commitsScanned || 0) + snap.commits.length,
    lastRun: { from, snapshots: scanned, added, replaced, seenBackfilled: bfFilled, ...stats },
    stats: held.stats,
    // One-time backfills (TEN-346: 3–22 Sep from Oddspapi pinnacle+30 history) — their record survives every run.
    ...(held.backfills ? { backfills: held.backfills } : {}),
    rows,
  };
  // Rewritten only when a row changes, so an idle run commits nothing back (the pipeline's
  // commit-back is only-if-changed). The next run then re-scans from the held scannedThrough,
  // which a depth-100 CI clone bounds.
  const wrote = added + replaced + filled > 0 || !fs.existsSync(out);
  if (wrote) {
    fs.writeFileSync(out + '.tmp', JSON.stringify(doc, null, 1));
    fs.renameSync(out + '.tmp', out);
  }
  // The Market read 30-day line (site only, never committed): written every run, atomically.
  const mr = marketRead30(rows, nowMs);
  if (mrOut) {
    fs.writeFileSync(mrOut + '.tmp', JSON.stringify(mr, null, 1));
    fs.renameSync(mrOut + '.tmp', mrOut);
  }
  return { rows: rows.length, added, replaced, filled, snapshots: scanned, stats, wrote, marketRead: mr };
}

// ── Step 15 (founder 2026-10-27) — Today's Matches "Market read" 30-day line ────────────────────────────────────
// Of the captured ATP matches dated in the last 30 days with a Pinnacle open (the series' first tick), a Pinnacle close
// within 60 min of the actual start (aged from our last sighting) and a result: how many moved open → close — the
// shortening side fell by MOVE_MIN or more on the printed two-decimal prices, as the page's mxMovePct (founder
// 2026-10-28) — and in how many of those the player the price shortened on won. Counts only. Davis Cup is out (a team tie, not the board's singles).
const MOVE_MIN = 2.0;   // founder 2026-10-27: 2%
const CLOSE_W60_MS = 60 * 60e3;
function movePct(o, c) {
  const o2 = Math.round(Number(Number(o).toFixed(2)) * 100), c2 = Math.round(Number(Number(c).toFixed(2)) * 100);
  if (!(o2 > 0) || !(c2 > 0)) return null;
  const r = (c2 - o2) * 1000 / o2;
  return Math.sign(r) * Math.round(Math.abs(r)) / 10;
}
// Founder ruling 2026-10-28 (close-rule corrections item 3): "moved" is measured on the SHORTENING side only. The side
// whose price fell (the larger fall when both did) must have fallen by MOVE_MIN or more; a drift on the other side never
// qualifies a match. 'p1' | 'p2' | null. The page's mxJourneyOf applies the same rule.
function shorteningSide(d1, d2) {
  if (d1 == null || d2 == null || d1 === d2) return null;
  const side = d1 < d2 ? 'p1' : 'p2', d = Math.min(d1, d2);
  return d < 0 && -d >= MOVE_MIN ? side : null;
}
function marketRead30(rows, nowMs) {
  const to = iso(nowMs).slice(0, 10), from = iso(nowMs - 29 * 864e5).slice(0, 10);
  const ex = { noOpen: 0, noClose60: 0, noResult: 0 };
  let n = 0, moved = 0, won = 0, inWindow = 0;
  for (const r of rows || []) {
    if (!r || !r.date || r.date < from || r.date > to) continue;
    if (/davis cup/i.test(String(r.event || ''))) continue;
    inWindow++;
    if (!(r.o1 >= 1.01 && r.o2 >= 1.01)) { ex.noOpen++; continue; }
    const at = Date.parse(r.seenAt || r.at), st = Date.parse(r.trueStart);   // founder 2026-10-28: aged from the last sighting
    if (!Number.isFinite(at) || !Number.isFinite(st) || st - at > CLOSE_W60_MS) { ex.noClose60++; continue; }
    if (r.winner !== 'p1' && r.winner !== 'p2') { ex.noResult++; continue; }
    n++;
    const d1 = movePct(r.o1, r.p1), d2 = movePct(r.o2, r.p2);
    const toward = shorteningSide(d1, d2);
    if (!toward) continue;
    moved++;
    if (toward === r.winner) won++;
  }
  return { generatedAt: iso(nowMs), from, to, rows: inWindow, n, moved, won, excluded: ex, minMovePct: MOVE_MIN,
    rule: 'Pinnacle open (first Oddspapi tick) → Pinnacle close (last tick at or before the actual start, within 60 min); close aged from our last capture read before the start; moved = the shortening side fell >= 2% on two-decimal prices (a drift never counts); right = the shortened side won' };
}

module.exports = { build, lastAtOrBefore, firstAtOrBefore, absorb, actualStart, deriveRow, mergeRows, oddspapiStarts, marketRead30, movePct,
  lastSighting, applySeenBackfill, shorteningSide };
if (require.main === module) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const r = build({ since: arg('--since'), out: arg('--out') || OUT, mrOut: arg('--mr-out') || MR_OUT });
  const mr = r.marketRead;
  console.log(`market-read-30d: ${mr.won} of ${mr.moved} moved (${mr.n} of ${mr.rows} rows usable ${mr.from}..${mr.to}; excluded ${JSON.stringify(mr.excluded)})`);
  console.log(`captured-pinnacle: ${r.rows} rows (+${r.added} new, ${r.replaced} replaced, ${r.filled} filled${r.wrote ? '' : ', file unchanged'}) from ${r.snapshots} snapshot(s); ` +
    `this run kept ${r.stats.kept} of ${r.stats.series} series ${JSON.stringify(r.stats.bySource)} ${JSON.stringify(r.stats.byBook)}; dropped ${JSON.stringify(r.stats.dropped)}`);
}
