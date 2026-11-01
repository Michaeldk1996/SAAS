#!/usr/bin/env node
// Task E (founder 2026-11-01): Market edge on every level — ONE level filter (All · ATP main draw · ATP qualifying ·
// Challenger · ITF) on both tabs; below the ATP main draw records only, no ROI (founder: "Records only, no ROI");
// "No price · N · X% of total" beside the role cards; the ATP main-draw Match winner figures unchanged.
// Runs the shipped module on the pinned player fixture plus synthetic rows of every level. Each check names its mutant.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { execFileSync } = require('child_process');
const L = require('./ten384-figures-lib.js');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const H = L.harness();
const SRC = path.join(L.ROOT, 'player-profile-v2.js');
const row = (date, level, tournament, opp, won, extra) => Object.assign({ year: date.slice(0, 4), surface: 'hard', level, date, tournament, round: 'R32',
  opponent: opp, result: won ? '2 - 0' : '0 - 2', won, src: 'fixtures', sets: [{ p: won ? 6 : 3, o: won ? 3 : 6 }, { p: won ? 6 : 4, o: won ? 4 : 6 }] }, extra || {});
const EXTRA = [
  row('2026-03-02', 'chitf', 'M25 Monastir', 'I. One', true), row('2026-03-03', 'chitf', 'ITF M15 Antalya', 'I. Two', false),
  row('2026-04-07', 'chitf', 'Challenger Rome', 'C. One', true), row('2026-04-08', 'chitf', 'Challenger Rome', 'C. Two', true, { qualifying: true }),
  row('2026-05-18', 'atp', 'ATP Geneva', 'Q. One', true, { round: 'Qualification R1', qualifying: true }),
  row('2026-05-19', 'atp', 'ATP Geneva', 'Q. Two', false, { round: 'Q-R2' })
];
function load(src) {
  const p = JSON.parse(JSON.stringify(FX.profile)); p.tournamentHistory = FX.tournamentHistory;
  const byYear = {}; (p.careerByYear || []).forEach((y) => { byYear[String(y.year)] = y; });
  EXTRA.forEach((r) => { const y = byYear[r.year], k = r.won ? 'won' : 'lost'; if (!y) return; y.total[k]++; if (!y[r.level]) y[r.level] = { total: { won: 0, lost: 0 } }; y[r.level].total[k]++; });
  const m = L.loadPp2({ src: src || SRC, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: FX.careerHistory.concat(EXTRA) },
    marketEdge: { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History });
  return { I: m.I, p };
}
const { I, p } = load();
const withState = (st, fn) => { const saved = Object.assign({}, I.state); Object.assign(I.state, st); try { return fn(); } finally { Object.keys(I.state).forEach((k) => delete I.state[k]); Object.assign(I.state, saved); } };

H.check('levels: ITF by its own event name, Challenger (main draw + qualifying), ATP qualifying by its mark, the rest ATP main draw', () => {
  const lv = (t, tour, extra) => I.lcLevelOfRow(Object.assign({ tier: t, tournament: tour }, extra || {}));
  assert.strictEqual(lv('chitf', 'M25 Monastir'), 'itf'); assert.strictEqual(lv('chitf', 'ITF M15 Antalya'), 'itf');
  assert.strictEqual(lv('chitf', 'Challenger Rome'), 'ch'); assert.strictEqual(lv('chitf', 'Challenger Rome', { qual: true }), 'ch');
  assert.strictEqual(lv('atp', 'ATP Geneva', { qual: true }), 'atpq'); assert.strictEqual(lv('atp', 'ATP Geneva', { round: 'Q2' }), 'atpq');
  assert.strictEqual(lv('atp', 'ATP Geneva'), 'main'); assert.strictEqual(I.lcLevelOfRow({ tier: null, tournament: 'X' }), null);
  return 'itf · ch · atpq · main · none';
});
H.check('the four levels partition All on Match winner: every match once (a row with no tier counts under All only)', () => {
  const all = I.levelRecords(p, 'all'), parts = ['main', 'atpq', 'ch', 'itf'].map((l) => I.levelRecords(p, l));
  const k = (r) => [r.date, r.opp, r.won, r.event].join('|');
  const inLevel = new Set(); parts.forEach((d) => d.rows.forEach((r) => { assert(!inLevel.has(k(r)), 'a match in two levels: ' + k(r)); inLevel.add(k(r)); }));
  const sum = parts.reduce((a, d) => a + d.all.n, 0), allOnly = all.rows.filter((r) => !inLevel.has(k(r)));
  // the rest: no tier, or a season the Career record holds with no tier split (before 2021) — under All only, as the record rules
  assert(allOnly.every((r) => !I.lcLevelOfRow(r) || Number(r.year) < 2021), 'a 2021+ match with a level is missing from every level');
  assert.strictEqual(sum + allOnly.length, all.all.n, `levels ${sum} + all-only ${allOnly.length} vs all ${all.all.n}`);
  const noTier = allOnly.length;
  assert(parts[1].all.n >= 2 && parts[2].all.n >= 2 && parts[3].all.n >= 2, 'each synthetic level reaches its filter');
  return `main ${parts[0].all.n} · atpq ${parts[1].all.n} · ch ${parts[2].all.n} · itf ${parts[3].all.n} · no tier ${noTier} = all ${all.all.n}`;
});
H.check('every level: All = favourite + underdog + no price, and the W–L of each adds up', () => {
  for (const l of ['all', 'main', 'atpq', 'ch', 'itf']) {
    const d = I.levelRecords(p, l);
    assert.strictEqual(d.fav.n + d.dog.n + d.none.n, d.all.n, l + ': cards do not sum');
    assert.strictEqual(d.fav.w + d.dog.w + d.none.w, d.all.w, l + ': wins do not sum');
    assert(d.b365 <= d.priced && d.priced === d.fav.n + d.dog.n, l + ': the Bet365 count is not inside the priced count');
  }
  return 'five levels reconcile';
});
H.check('below the ATP main draw Match winner shows records only: no yield, no ROI, no units; it says why', () => {
  for (const l of ['atpq', 'ch', 'itf', 'all']) {
    const h = withState({ key: p.key, marketTab: 'winner', mkLevel: l }, () => I.renderMarketModal(p));
    assert(new RegExp('data-mk-level="' + l + '"').test(h), l + ': no records panel');
    assert(!/data-pp2-mk="bands"|data-role="favourite"/.test(h) && !/[+−-]\d+\.\d\du/.test(h), l + ': a yield / unit figure shows below the main draw');
    assert(/Records only/.test(h) && /data-mk-level-card="none"/.test(h), l + ': no "Records only" note or No price card');
  }
  return 'atpq · ch · itf · all';
});
H.check('ATP main draw (the default) keeps every Match winner figure: the role cards and bands equal the module before Task E', () => {
  // the byte comparison needs the module before Task E: TASKE_BASE=<file> (run once at the land, 2 Nov 2026, against main
  // d63d9747e: 0 changes). Without it the structural checks below still run.
  const now0 = withState({ key: p.key, marketTab: 'winner' }, () => I.renderMarketModal(p));
  assert(/data-pp2="mk-level" data-v="main" aria-pressed="true"/.test(now0), 'ATP main draw is not the default level');
  assert(/data-pp2="market-role"/.test(now0) && /data-pp2-mk="bands"/.test(now0), 'the main-draw role cards / bands are gone');
  assert(/data-mk-level-card="none"/.test(now0) && /% of total/.test(now0), 'no "No price · N · X% of total" beside the role cards');
  if (!process.env.TASKE_BASE) return 'structure checked (byte comparison: set TASKE_BASE)';
  const base = fs.readFileSync(process.env.TASKE_BASE, 'utf8');
  const tmp = path.join(require('os').tmpdir(), 'pp2-pre-taskE-' + process.pid + '.js'); fs.writeFileSync(tmp, base);
  try {
    const O = load(tmp);
    const now = withState({ key: p.key, marketTab: 'winner' }, () => I.renderMarketModal(p));
    // the three additions, removed exactly: the level row, the No price card, the role grid's fourth column
    const strip = (h) => h.replace(/<div style="display:flex;justify-content:flex-end;margin:-6px 0 14px;"><span data-pp2-seg="mk-level"[\s\S]*?<\/span><\/div>/, '')
      .replace(/<span data-mk-level-card="none"[\s\S]*?ATP main-draw matches<\/span><\/span>/, '').replace('grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;">', 'grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">');
    const was = (() => { const s = Object.assign({}, O.I.state); Object.assign(O.I.state, { key: p.key, marketTab: 'winner' }); try { return O.I.renderMarketModal(O.p); } finally { Object.assign(O.I.state, s); } })();
    const a = strip(now), b = was;
    if (a !== b) { let i = 0; while (i < a.length && a[i] === b[i]) i++; assert.fail('the ATP main-draw view changed at ' + i + ': ' + JSON.stringify(a.slice(i - 40, i + 80)) + ' vs ' + JSON.stringify(b.slice(i - 40, i + 80))); }
    assert(/data-pp2="mk-level" data-v="main" aria-pressed="true"/.test(now), 'ATP main draw is not the default level');
    assert(/data-mk-level-card="none"/.test(now) && /% of total/.test(now), 'no "No price · N · X% of total" beside the role cards');
    return '0 changes to the cards, bands and everything below; + the level control and No price';
  } finally { fs.unlinkSync(tmp); }
});
H.check('Derived lines carries the same five levels and the No price card', () => {
  const h = withState({ key: p.key, marketTab: 'lines', lcTier: 'itf' }, () => I.renderLinesTab(p));
  const v = (h.match(/data-pp2="lc-tier" data-v="(\w+)"/g) || []).map((x) => /data-v="(\w+)"/.exec(x)[1]);
  assert.deepStrictEqual(v, ['all', 'main', 'atpq', 'ch', 'itf']);
  assert(/data-lc="noprice"/.test(h) && /data-lc="b365"/.test(h), 'no No price card / Bet365 count');
  return v.join(' · ');
});
H.mustFail('a level filter that lets Challenger rows into ITF is caught', () => {
  const src = fs.readFileSync(SRC, 'utf8').replace("return LC_ITF_NAME.test(String(r.raw || '') + ' ' + String(r.event || '') + ' ' + String(r.tournament || '')) ? 'itf' : 'ch';", "return 'itf';");
  const tmp = path.join(require('os').tmpdir(), 'pp2-lvl-mut-' + process.pid + '.js'); fs.writeFileSync(tmp, src);
  try { const M = load(tmp); assert.strictEqual(M.I.levelRecords(M.p, 'ch').all.n > 0, true, 'no Challenger rows'); } finally { fs.unlinkSync(tmp); }
});
H.done();
