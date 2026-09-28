#!/usr/bin/env node
/*
 * tools/ten346-backfill-captured-pinnacle.js  (TEN-346 — one-time backfill, 3–22 Sep 2026)
 * ---------------------------------------------------------------------------
 * matches.json holds NO Pinnacle series for board matches dated 3–22 Sep: books.Pinnacle ends
 * 2 Sep, chart.books['Pinnacle +30s'] starts 23 Sep. Oddspapi still serves the pinnacle+30
 * history for those fixtures (/v4/historical-odds, free). Board ruling 2026-09-28 (TEN-316 card
 * 9f0e123c, Q3): backfill it once.
 *
 * Three steps, the network one in the middle:
 *   1. plan   — board cards dated in the window (every committed matches.json snapshot), joined
 *               to an Oddspapi fixture id and oriented to the card:
 *                 a. odds-fixture-map.json byKey[eventKey] (any committed version; the map's own
 *                    orient, re-checked against the card's names), else m.oddsMovement.fixtureId
 *                    with the map's orient;
 *                 b. else a UNIQUE name join (the card-state key, ±1 day) to an ATP / Davis Cup
 *                    fixture in .ten225-fixture-index.json.gz or bet365-history/ (oriented by
 *                    name; two fixtures for one card = no join).
 *               Also the card-state start as last committed for each card (odds-card-state.json
 *               history: the file only holds the current board).
 *   2. fetch  — tools/ten346-backfill-pinnacle-fetch.py: /v4/historical-odds pinnacle+30, market
 *               121, yielding the key to the metered loop (odds.md). Writes a local cache.
 *   3. build  — the cached series, in card orientation, go through build-captured-pinnacle.js
 *               itself: absorb -> actualStart (earlier of trueStart and the card-state start;
 *               none / not unique -> dropped) -> deriveRow (last tick at or before it, both sides)
 *               -> mergeRows (never deletes a held row; a stricter start wins). No network.
 *               Re-runnable: over a newer committed file it only merges again.
 *
 * Usage:
 *   node tools/ten346-backfill-captured-pinnacle.js plan  --targets <file> [--from 2026-09-03 --to 2026-09-22]
 *   python3 tools/ten346-backfill-pinnacle-fetch.py --targets <file> --cache <dir>
 *   node tools/ten346-backfill-captured-pinnacle.js build --targets <file> --cache <dir> [--out <file>] [--dry]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LABEL = 'Pinnacle +30s';
const JOIN_CATS = new Set(['ATP', 'Davis Cup']);
const CS_SOURCES = ['oddspapi', 'api-tennis-live'];

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const toMs = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return v > 1e12 ? v : v * 1000; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const shiftDay = (d, n) => dayOf(Date.parse(d) + n * 864e5);

function gitIn(root) {
  const g = (...a) => execFileSync('git', ['-C', root, ...a], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const log = (since, file) => { try { return g('log', '--format=%H', `--since=${since}`, 'HEAD', '--', file).trim().split('\n').filter(Boolean).reverse(); } catch (e) { return []; } };
  const show = (h, file) => { try { return JSON.parse(g('show', `${h}:${file}`)); } catch (e) { return null; } };
  return { log, show };
}

/** Oriented to the card: 'same' when the fixture's participant1 is the card's p1. By the ruled
 *  name key, both sides required; null when the names do not line up either way. */
function orientByName(nameKey, card, fp1, fp2) {
  const c1 = nameKey(card.p1), c2 = nameKey(card.p2), f1 = nameKey(fp1), f2 = nameKey(fp2);
  if (!c1 || !c2 || !f1 || !f2 || c1 === c2) return null;
  if (c1 === f1 && c2 === f2) return 'same';
  if (c1 === f2 && c2 === f1) return 'swap';
  return null;
}

/** The fixture map's orient is relative to the map's own p1/p2; re-read it against the card. */
function orientFromMap(rec, card) {
  const o = rec && rec.orient;
  if (o !== 'same' && o !== 'swap') return null;
  if (!rec.p1 || !rec.p2) return o;
  if (rec.p1 === card.p1 && rec.p2 === card.p2) return o;
  if (rec.p1 === card.p2 && rec.p2 === card.p1) return o === 'same' ? 'swap' : 'same';
  return null;
}

/** ATP / Davis Cup Oddspapi fixtures by card-state key (±1 day of the fixture's day). */
function fixtureIndex(root, matchKey) {
  const by = new Map();
  const add = (id, v, startMs) => {
    if (!v || !JOIN_CATS.has(v.cat) || startMs == null) return;
    for (const n of [-1, 0, 1]) {
      const k = matchKey(shiftDay(dayOf(startMs), n), v.p1, v.p2);
      if (!k) continue;
      const list = by.get(k) || by.set(k, []).get(k);
      if (!list.some((x) => x.id === id)) list.push({ id, p1: v.p1, p2: v.p2 });
    }
  };
  try {
    const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, '.ten225-fixture-index.json.gz'))).toString()).fixtures || {};
    for (const [id, v] of Object.entries(fx)) add(id, v, toMs(v.trueStart) ?? toMs(v.start) ?? toMs(v.startSched));
  } catch (e) { /* absent */ }
  const dir = path.join(root, 'bet365-history');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}\.json$/.test(n))) {
      const d = readJson(path.join(dir, f), null);
      for (const [id, v] of Object.entries((d && d.fixtures) || {})) add(id, v, toMs(v.trueStart) ?? toMs(v.startSched));
    }
  }
  return by;
}

function plan({ root = ROOT, from = '2026-09-03', to = '2026-09-22', since = '2026-09-02T00:00:00Z' } = {}) {
  const { ocsMatchKey, ocsNameKey } = require(path.join(root, 'bsp-pipeline.js'));
  const G = gitIn(root);
  const cards = {};
  for (const h of G.log(since, 'matches.json')) {
    const M0 = G.show(h, 'matches.json');
    const M = Array.isArray(M0) ? M0 : ((M0 && M0.matches) || []);
    for (const m of M) {
      if (!m || !m.date || m.date < from || m.date > to) continue;
      const ek = String(m.id || '').replace(/^[a-z]+-/, '');
      if (!/^\d+$/.test(ek)) continue;          // the builder's eventKey rule (absorb)
      const o = cards[ek] || {};
      const om = m.oddsMovement || {};
      cards[ek] = { eventKey: ek, date: m.date, p1: m.p1, p2: m.p2, p1Key: m.p1Key, p2Key: m.p2Key, tour: m.tour || o.tour || null,
        finished: !!o.finished || (String(m.id).startsWith('past-') && !!m.finalScore),
        omFixtureId: om.fixtureId || o.omFixtureId || null };
    }
  }
  const fmap = {};
  for (const h of G.log(since, 'odds-fixture-map.json')) {
    const F = G.show(h, 'odds-fixture-map.json');
    for (const [k, v] of Object.entries((F && F.byKey) || {})) if (cards[k] && v && v.fixtureId) fmap[k] = v;
  }
  const byName = fixtureIndex(root, ocsMatchKey);
  const keys = new Set(Object.values(cards).map((c) => ocsMatchKey(c.date, c.p1, c.p2)).filter(Boolean));
  const csBy = {};
  const takeCs = (S) => { for (const [k, v] of Object.entries((S && S.byKey) || {})) if (keys.has(k) && v && CS_SOURCES.includes(v.startTsSource) && v.startTs != null) csBy[k] = { startTs: v.startTs, startTsSource: v.startTsSource }; };
  for (const h of G.log(since, 'odds-card-state.json')) takeCs(G.show(h, 'odds-card-state.json'));
  takeCs(readJson(path.join(root, 'odds-card-state.json'), null));

  const out = [];
  const stats = { cards: 0, joined: 0, byJoin: {}, unjoined: {} };
  for (const c of Object.values(cards).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.eventKey - b.eventKey))) {
    stats.cards++;
    const rec = fmap[c.eventKey];
    let fixtureId = null, orient = null, join = null, why = null;
    if (rec) { fixtureId = rec.fixtureId; orient = orientFromMap(rec, c); join = 'fixture-map'; why = orient ? null : 'mapNamesDisagree'; }
    else {
      const k = ocsMatchKey(c.date, c.p1, c.p2);
      const cands = (k && byName.get(k)) || [];
      if (cands.length === 1) { fixtureId = cands[0].id; orient = orientByName(ocsNameKey, c, cands[0].p1, cands[0].p2); join = 'name'; why = orient ? null : 'nameOrient'; }
      else if (cands.length > 1) why = 'ambiguousFixture';
      else if (c.omFixtureId) why = 'omFixtureNoOrient';
      else why = 'noFixture';
    }
    if (c.omFixtureId && fixtureId && c.omFixtureId !== fixtureId) { why = 'fixtureConflict'; }
    if (why) { stats.unjoined[why] = (stats.unjoined[why] || 0) + 1; out.push({ ...c, fixtureId: null, orient: null, join: null, skip: why }); continue; }
    stats.joined++; stats.byJoin[join] = (stats.byJoin[join] || 0) + 1;
    out.push({ ...c, fixtureId, orient, join });
  }
  return { generatedAt: new Date().toISOString(), window: { from, to }, stats, cards: out, cardState: { byKey: csBy } };
}

/** Cached pinnacle+30 series (oddspapi orientation) -> synthetic board cards in CARD orientation,
 *  shaped like the chart field the pipeline writes, so the builder reads them unchanged. */
function syntheticMatches(targets, cacheDir) {
  const M = [];
  const miss = {};
  for (const c of targets.cards) {
    if (c.skip) continue;
    const e = readJson(path.join(cacheDir, `${c.fixtureId}.json`), null);
    if (!e) { miss.notFetched = (miss.notFetched || 0) + 1; continue; }
    if (e.status !== 200 || !e.series || (!e.series.p1 && !e.series.p2)) { const r = e.status === 200 ? 'noPinnacle' : `http${e.status}`; miss[r] = (miss[r] || 0) + 1; continue; }
    const [s1, s2] = c.orient === 'swap' ? [e.series.p2, e.series.p1] : [e.series.p1, e.series.p2];
    M.push({ id: `past-${c.eventKey}`, date: c.date, p1: c.p1, p2: c.p2, p1Key: c.p1Key, p2Key: c.p2Key,
      oddsMovement: { chart: { books: { [LABEL]: { p1: s1 || [], p2: s2 || [] } } } } });
  }
  return { M, miss };
}

function build({ root = ROOT, targets, cacheDir, out = path.join(root, 'captured-closes-pinnacle.json'), nowMs = Date.now(), dry = false,
  builder = path.join(root, 'build-captured-pinnacle.js') } = {}) {
  const B = require(builder);
  const held = readJson(out, null) || {};
  const { M, miss } = syntheticMatches(targets, cacheDir);
  const ev = {};
  B.absorb(ev, M);
  const trueStarts = B.oddspapiStarts(root);
  const fresh = [];
  const dropped = { ...miss };
  const reason = {};
  for (const [ek, o] of Object.entries(ev)) {
    const r = B.deriveRow(ek, o, B.actualStart(o, trueStarts, targets.cardState), nowMs);
    if (!r.row) { dropped[r.reason] = (dropped[r.reason] || 0) + 1; reason[ek] = r.reason; continue; }
    fresh.push(r.row);
  }
  const before = new Set((held.rows || []).map((r) => String(r.eventKey)));
  const { rows, added, replaced } = B.mergeRows(held.rows, fresh);
  // Per card day: board ATP finished, held before, held after, added.
  const byDay = {};
  const after = new Map(rows.map((r) => [String(r.eventKey), r]));
  for (const c of targets.cards) {
    const d = byDay[c.date] || (byDay[c.date] = { board: 0, finished: 0, heldBefore: 0, held: 0, heldFinished: 0, added: 0 });
    d.board++; if (c.finished) d.finished++;
    if (before.has(c.eventKey)) d.heldBefore++;
    if (after.has(c.eventKey)) { d.held++; if (c.finished) d.heldFinished++; if (!before.has(c.eventKey)) d.added++; }
  }
  const wrote = !dry && added + replaced > 0;
  if (wrote) {
    const doc = { ...held, rows };
    doc.backfills = (held.backfills || []).filter((b) => b.ticket !== 'TEN-346').concat([{ ticket: 'TEN-346', at: new Date(nowMs).toISOString(),
      source: 'Oddspapi /v4/historical-odds bookmakers=pinnacle+30, market 121 (free), board cards ' + targets.window.from + '..' + targets.window.to,
      fetched: M.length, kept: fresh.length, added, replaced, dropped }]);
    fs.writeFileSync(out + '.tmp', JSON.stringify(doc, null, 1));
    fs.renameSync(out + '.tmp', out);
  }
  return { rows: rows.length, added, replaced, fetched: M.length, kept: fresh.length, dropped, byDay, reason, fresh, wrote };
}

module.exports = { plan, build, orientByName, orientFromMap, syntheticMatches };
if (require.main === module) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const mode = process.argv[2];
  if (mode === 'plan') {
    const p = plan({ from: arg('--from', '2026-09-03'), to: arg('--to', '2026-09-22') });
    fs.writeFileSync(arg('--targets'), JSON.stringify(p, null, 1));
    console.log(`plan: ${p.stats.cards} board cards ${p.window.from}..${p.window.to}; joined ${p.stats.joined} ${JSON.stringify(p.stats.byJoin)}; ` +
      `unjoined ${JSON.stringify(p.stats.unjoined)}; card-state starts ${Object.keys(p.cardState.byKey).length}`);
  } else if (mode === 'build') {
    const r = build({ targets: readJson(arg('--targets'), null), cacheDir: arg('--cache'), out: arg('--out', path.join(ROOT, 'captured-closes-pinnacle.json')), dry: process.argv.includes('--dry') });
    console.log(`backfill: ${r.rows} rows (+${r.added} new, ${r.replaced} replaced${r.wrote ? '' : ', file unchanged'}); ` +
      `${r.kept} kept of ${r.fetched} fetched series; dropped ${JSON.stringify(r.dropped)}`);
    console.log('day        board finished heldBefore held heldFinished added');
    for (const [d, x] of Object.entries(r.byDay).sort()) console.log(`${d} ${String(x.board).padStart(5)} ${String(x.finished).padStart(8)} ${String(x.heldBefore).padStart(10)} ${String(x.held).padStart(4)} ${String(x.heldFinished).padStart(12)} ${String(x.added).padStart(5)}`);
  } else {
    console.error('usage: plan --targets <file> | build --targets <file> --cache <dir> [--out <file>] [--dry]');
    process.exit(2);
  }
}
