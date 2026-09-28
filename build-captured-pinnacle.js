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
const SERIES = [['Pinnacle', (om) => om.books && om.books.Pinnacle],
  ['Pinnacle +30s', (om) => om.chart && om.chart.books && om.chart.books['Pinnacle +30s']]];
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
      const t = o.series[label] || (o.series[label] = { p1: new Map(), p2: new Map() });
      for (const side of ['p1', 'p2']) for (const x of s[side] || []) if (Array.isArray(x) && x[0] != null) t[side].set(String(x[0]), Number(x[1]));
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
  return { row: { eventKey: Number(ek), date: o.date, p1Key: o.p1Key, p2Key: o.p2Key, p1Name: o.p1, p2Name: o.p2,
    p1: best.a[1], p2: best.b[1], at: iso(best.atMs), trueStart: iso(start.ms), startSource: start.source, book: best.label } };
}

/** Merge fresh rows into held ones (see header). Returns { rows, added, replaced }. */
function mergeRows(held, fresh) {
  const by = new Map((held || []).map((r) => [String(r.eventKey), r]));
  let added = 0, replaced = 0;
  for (const r of fresh) {
    const h = by.get(String(r.eventKey));
    if (!h) { by.set(String(r.eventKey), r); added++; continue; }
    // A STRICTER (earlier) start always wins, even with an earlier close: the held row may hold a
    // tick that the better start shows was in-play. Same start: a later pre-start tick wins.
    const rs = Date.parse(r.trueStart), hs = Date.parse(h.trueStart);
    const stricter = Number.isFinite(rs) && Number.isFinite(hs) && rs < hs;
    const later = rs === hs && Date.parse(r.at) > Date.parse(h.at);
    if ((stricter || later) && (r.p1 !== h.p1 || r.p2 !== h.p2 || r.at !== h.at || r.trueStart !== h.trueStart)) { by.set(String(r.eventKey), r); replaced++; }
  }
  const rows = [...by.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.eventKey - y.eventKey));
  return { rows, added, replaced };
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

function build({ root = ROOT, out = OUT, since = null, nowMs = Date.now() } = {}) {
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
  const { rows, added, replaced } = mergeRows(held.rows, fresh);
  const doc = {
    generatedAt: iso(nowMs),
    source: 'matches.json git history: oddsMovement.books.Pinnacle (Oddspapi pinnacle, to 2026-09-02) and oddsMovement.chart.books["Pinnacle +30s"] (Oddspapi pinnacle+30, from 2026-09-23)',
    rule: 'each side = last tick at or before the actual start (Oddspapi trueStart, else the card-state start: Oddspapi or the live-flip lower bound); both sides required; dropped when no unique actual start',
    scannedThrough: last || held.scannedThrough || null,
    commitsScanned: (held.commitsScanned || 0) + snap.commits.length,
    lastRun: { from, snapshots: scanned, added, replaced, ...stats },
    stats: held.stats,
    rows,
  };
  // Rewritten only when a row changes, so an idle run commits nothing back (the pipeline's
  // commit-back is only-if-changed). The next run then re-scans from the held scannedThrough,
  // which a depth-100 CI clone bounds.
  const wrote = added + replaced > 0 || !fs.existsSync(out);
  if (wrote) {
    fs.writeFileSync(out + '.tmp', JSON.stringify(doc, null, 1));
    fs.renameSync(out + '.tmp', out);
  }
  return { rows: rows.length, added, replaced, snapshots: scanned, stats, wrote };
}

module.exports = { build, lastAtOrBefore, absorb, actualStart, deriveRow, mergeRows, oddspapiStarts };
if (require.main === module) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const r = build({ since: arg('--since'), out: arg('--out') || OUT });
  console.log(`captured-pinnacle: ${r.rows} rows (+${r.added} new, ${r.replaced} replaced${r.wrote ? '' : ', file unchanged'}) from ${r.snapshots} snapshot(s); ` +
    `this run kept ${r.stats.kept} of ${r.stats.series} series ${JSON.stringify(r.stats.bySource)} ${JSON.stringify(r.stats.byBook)}; dropped ${JSON.stringify(r.stats.dropped)}`);
}
