// tools/test-ten384-fx4.js — TEN-384 fix round 4 (fx4, 2026-10-07): the independent review of 6c67d2c0.
//
// Every check runs on PINNED inputs (the committed fixture, sliced page code, constructed rows), so it is identical
// in every checkout, CI included. Each one fails on 6c67d2c0 — the control: `FX4_BASE=6c67d2c0 node
// tools/test-ten384-fx4.js` runs the same checks against that commit's player-profile-v2.js,
// bsp-consult-dashboard.html and tournament-identity.js (read with `git show`).
//
//   1 · Swing Oct–Nov       a month in Oct / Nov holding ANY indoor match reads INDOORS (founder D13), whatever the
//                           outdoor count: Alcaraz's October + Tokyo 2026's 5 outdoor rows stays Indoors.
//   2 · header rank         the profile header's "No. N" = the Players card's "#N": live standings first, one source.
//   3 · same-event rows     "Olympic Games" + "Paris Olympics" (one 2024 edition) = one row, surface from the per-year
//                           map (2024 clay), never career-history's "grass"; Thompson's Melbourne pair = one row.
//   4 · loading             while the market-edge shard is in flight, no shard-reading surface claims anything
//                           (Calendar tiles / footer / footnote / drill, Court speed units, Matchup Backing, ledger
//                           H / A, Record per tournament tile), then each paints once.
//   5 · tourn tile          no event clears ten priced → the W–L over every event, never summed Backing units; one
//                           flag restores the summed path.
//   6 · minor               Court speed fallback reason, hyphen / dotted initials, Career hero mark under the rate.
//
// Run: node tools/test-ten384-fx4.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const L = require('./ten384-figures-lib.js');

const ROOT = L.ROOT;
const BASE = process.env.FX4_BASE || null;
function srcOf(rel) {
  if (!BASE) return path.join(ROOT, rel);
  const f = path.join(os.tmpdir(), 'fx4-control-' + BASE + '-' + rel.replace(/\//g, '_'));
  fs.writeFileSync(f, execFileSync('git', ['-C', ROOT, 'show', BASE + ':' + rel], { maxBuffer: 64 << 20 }));
  return f;
}
const PP2 = srcOf('player-profile-v2.js');
const DASH_SRC = fs.readFileSync(srcOf('bsp-consult-dashboard.html'), 'utf8');
// eslint-disable-next-line import/no-dynamic-require
const TI = require(srcOf('tournament-identity.js'));
const H = L.harness();
console.log('TEN-384 fx4 — ' + (BASE ? 'CONTROL against ' + BASE : 'working tree'));

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
function fxModule(opts) {
  opts = opts || {};
  const th = opts.th || FX.tournamentHistory;
  const p = Object.assign({}, FX.profile, opts.profile || {}, { tournamentHistory: TI.mergeHistory ? TI.mergeHistory(th) : th });
  const m = L.loadPp2({
    src: PP2, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: opts.ch || FX.careerHistory },
    marketEdge: opts.noShard ? {} : { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History,
    extra: Object.assign({ TournamentIdentity: TI }, opts.extra || {})
  });
  return { I: m.I, W: m.W, p };
}
function withState(I, patch, fn) {
  const saved = Object.assign({}, I.state);
  Object.assign(I.state, patch);
  try { return fn(); } finally { Object.keys(I.state).forEach(k => delete I.state[k]); Object.assign(I.state, saved); }
}
const T = L.text;

// ════════════════════════════════════════════════════════════════════════════
// 1 · Swing row: Oct–Nov = INDOORS
// ════════════════════════════════════════════════════════════════════════════
H.check('1 · Alcaraz October (13 indoor : 13 outdoor) + Tokyo 2026\'s 5 outdoor rows still reads INDOORS', () => {
  const { I } = fxModule();
  const R = (mon, surface, court) => ({ mon, surface, court });
  const oct = [];
  for (let k = 0; k < 13; k++) oct.push(R(9, 'hard', 'Indoor'), R(9, 'hard', 'Outdoor'));
  for (let k = 0; k < 5; k++) oct.push(R(9, 'hard', 'Outdoor'));   // Tokyo 2026
  const at = (sp, m) => { let i = 0; for (const s of sp) { if (m < i + s.len) return s.surface; i += s.len; } return null; };
  assert.strictEqual(at(I.calSurfaceSpans(oct), 9), 'indoors', '13 indoor : 18 outdoor October painted ' + at(I.calSurfaceSpans(oct), 9));
  // the rule is Oct–Nov only, and needs an indoor match
  assert.strictEqual(at(I.calSurfaceSpans([R(1, 'hard', 'Indoor'), R(1, 'hard', 'Outdoor'), R(1, 'hard', 'Outdoor')]), 1), 'hard');
  assert.strictEqual(at(I.calSurfaceSpans([R(10, 'hard', 'Outdoor'), R(10, 'hard', 'Outdoor')]), 10), 'hard');
  return 'Oct 13 indoor : 18 outdoor → indoors; Feb 1 : 2 → hard; Nov 0 indoor → hard';
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · header rank = Players card rank (one live source)
// ════════════════════════════════════════════════════════════════════════════
function sliceFn(name) {
  const start = DASH_SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) return '';
  let d = 0, i = DASH_SRC.indexOf('{', start);
  for (; i < DASH_SRC.length; i++) { if (DASH_SRC[i] === '{') d++; else if (DASH_SRC[i] === '}' && --d === 0) break; }
  return DASH_SRC.slice(start, i + 1);
}
function constLine(name) {
  const start = DASH_SRC.indexOf('\nconst ' + name + ' = ');
  return start < 0 ? '' : DASH_SRC.slice(start, DASH_SRC.indexOf('\n', start + 1));
}
H.check('2 · Ruud: the Players card reads #24 (live standings) and the profile header reads No. 24 — not the frozen No. 17', () => {
  const key = FX.key;
  const indexRows = [{ key: String(key), rank: 24 }];
  const profiles = { [key]: Object.assign({}, FX.profile, { rank: 17 }) };
  const els = { playerGroups: { innerHTML: '' }, pgHeaderStats: { innerHTML: '' } };
  const src = ['pesc', 'pgRankOf', 'pp2LiveRankOf', 'pgTierCode', 'pgInitials', 'pgRenderHeaderStats', 'getPlayersFromMatches', 'renderPlayers']
    .map(sliceFn).join('\n') + '\n' + constLine('TOURX_TIER_CODE') + '\n' + constLine('PG_EXT_SVG');
  const match = { p1: FX.profile.name, p1Key: key, p1Rank: 17, p2: 'X. Other', p2Key: 99999, p2Rank: 40, tour: 'ATP Tokyo',
    surface: 'hard', live: false, finalScore: null, venue: { category: 'ATP 500' }, bestOdds: { p1: null, p2: null } };
  // eslint-disable-next-line no-new-func
  const api = new Function('els', 'matches', 'playerProfiles', 'playerIndex', `
    const document = { getElementById: id => els[id] || null };
    const tournamentProgression = { tournaments: {} };
    let pgLookupsLoaded = true;
    const cardStartMs = () => NaN; const photoCandidatesFor = () => []; const pgArchetypeFor = () => null;
    const pgEloFor = () => null; const loadPlayerCardLookups = () => {}; const mxOddsUpdatedAt = () => null;
    ${src}
    renderPlayers('');
    return { live: typeof pp2LiveRankOf === 'function' ? pp2LiveRankOf : null };`)(els, [match], profiles, indexRows);
  const card = /class="pc-rank">#(\d+)</.exec(els.playerGroups.innerHTML);
  assert(card, 'no card rank rendered');
  // the bridge publishes the SAME function to the module
  assert(/window\.pp2LiveRank = pp2LiveRankOf/.test(sliceFn('pp2Bridge')), 'pp2Bridge does not publish the live rank');
  const { I, p } = fxModule({ profile: { rank: 17 }, extra: api.live ? { pp2LiveRank: api.live } : {} });
  const hdr = /No\. (\d+)/.exec(T(I.renderHeader(p, I.build(p))));
  assert(hdr, 'no header rank');
  assert.strictEqual(hdr[1], card[1], `card #${card[1]} vs header No. ${hdr[1]}`);
  // no live entry → both fall back to the frozen profile rank
  const { I: I2, p: p2 } = fxModule({ profile: { rank: 17 }, extra: { pp2LiveRank: () => null } });
  assert.strictEqual(/No\. (\d+)/.exec(T(I2.renderHeader(p2, I2.build(p2))))[1], '17');
  return `card #${card[1]} = header No. ${hdr[1]} (profile.rank 17 frozen)`;
});
H.check('2 · the landing repaints an open profile when the live standings land', () => {
  const f = sliceFn('loadPlayerIndex') || (() => { const i = DASH_SRC.indexOf('async function loadPlayerIndex(){'); return DASH_SRC.slice(i, DASH_SRC.indexOf('\n}\n', i)); })();
  assert(/pp2RepaintIfOpen\(ppState\.key\)/.test(f), 'loadPlayerIndex does not repaint the open profile');
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · same-event duplicates: the Olympics (per-year surface) and Melbourne
// ════════════════════════════════════════════════════════════════════════════
const ED = (year, results, finish) => ({ year, finish, matches: results.map((r, i) => ({ res: r[0], round: r[1], opp: r[2], oppKey: '', score: '2 - 0' })) });
const OLY24 = [['W', 'R64', 'H. Habib'], ['W', 'R32', 'T. Griekspoor'], ['W', 'R16', 'R. Safiullin'], ['W', 'QF', 'T. Paul'],
  ['W', 'SF', 'F. Auger-Aliassime'], ['L', 'F', 'N. Djokovic']];
const OLY_CH = OLY24.map((r, i) => ({ year: '2024', surface: 'grass', level: 'atp', date: '2024-07-' + String(27 + i).padStart(2, '0'),
  tournament: 'Olympic Games', round: r[1], opponent: r[2], result: r[0] === 'W' ? '2 - 0' : '0 - 2', won: r[0] === 'W' }));
H.check('3 · Alcaraz "Olympic Games" (Grass, 5–1) + "Paris Olympics" (—, 5–1) = ONE 5–1 row on CLAY', () => {
  const th = FX.tournamentHistory.concat([
    { name: 'Olympic Games', won: 5, lost: 1, titles: 0, bestResult: 'Final', bestYears: [2024], editions: [ED(2024, OLY24, 'Final')] },
    { name: 'Paris Olympics', won: 5, lost: 1, titles: 0, bestResult: 'Final', bestYears: [2024], editions: [ED(2024, OLY24, 'Final')] }]);
  const { I, p } = fxModule({ th, ch: FX.careerHistory.concat(OLY_CH) });
  const rows = I.tournViews(p).filter(t => /olymp/i.test(t.name));
  assert.strictEqual(rows.length, 1, 'rows: ' + rows.map(t => `${t.name} ${t.won}–${t.lost} ${t.surface}`).join(' + '));
  assert.deepStrictEqual([rows[0].won, rows[0].lost], [5, 1]);
  assert.strictEqual(rows[0].surface, 'Clay', `surface ${rows[0].surface} (career-history labels the 2024 Games grass)`);
  assert(rows[0].editions[0].matches.every(m => m.surface === 'clay'), 'an edition match kept the wrong surface');
  return `one row: ${rows[0].name} ${rows[0].won}–${rows[0].lost} · ${rows[0].surface}`;
});
H.check('3 · a multi-year Olympics row (2012 grass, 2016 hard, 2021 hard, 2024 clay) takes the existing multi-surface rule', () => {
  const W = (o) => ['W', 'R64', o], Lr = (o) => ['L', 'R32', o];
  const th = [
    { name: 'London Olympics', won: 1, lost: 1, editions: [ED(2012, [W('A1'), Lr('A2')], 'Round of 32')] },
    { name: 'Rio Olympics', won: 1, lost: 1, editions: [ED(2016, [W('B1'), Lr('B2')], 'Round of 32')] },
    { name: 'Olympic Games', won: 2, lost: 1, editions: [ED(2020, [W('C1'), Lr('C2')], 'Round of 32'), ED(2024, [Lr('D1')], 'Round of 64')] },
    { name: 'Tokyo Olympics', won: 1, lost: 1, editions: [ED(2021, [W('C1'), Lr('C2')], 'Round of 32')] }];
  const { I, p } = fxModule({ th, ch: [] });
  const rows = I.tournViews(p).filter(t => /olymp/i.test(t.name));
  assert.strictEqual(rows.length, 1, rows.map(t => t.name).join(' + '));
  assert.deepStrictEqual(rows[0].editions.map(e => e.year), [2024, 2021, 2016, 2012]);
  assert.deepStrictEqual([rows[0].won, rows[0].lost], [3, 4], 'the Tokyo edition counted twice');
  const bySurf = {}; rows[0].editions.forEach(e => e.matches.forEach(m => { bySurf[m.surface] = (bySurf[m.surface] || 0) + 1; }));
  assert.deepStrictEqual(bySurf, { clay: 1, hard: 4, grass: 2 });
  assert.strictEqual(rows[0].surface, 'Hard', 'the multi-surface row is not the surface holding most of its matches');
  return `Olympic Games 3–4 · eds 2024 clay / 2021 hard / 2016 hard / 2012 grass → Hard (4 of 7 matches)`;
});
H.check('3 · Thompson "Melbourne" + "Melbourne (Summer Set)" (one 2022 edition, 1–1 each) = ONE 1–1 row', () => {
  const r = [['W', 'R32', "C. O'Connell"], ['L', 'R16', 'E. Ruusuvuori']];
  const th = FX.tournamentHistory.concat([
    { name: 'Melbourne (Summer Set)', won: 1, lost: 1, editions: [ED(2022, r, 'Round of 16')] },
    { name: 'Melbourne', won: 1, lost: 1, editions: [ED(2022, r, 'Round of 16')] }]);
  const { I, p } = fxModule({ th });
  const rows = I.tournViews(p).filter(t => /melbourne/i.test(t.name));
  assert.strictEqual(rows.length, 1, rows.map(t => t.name).join(' + '));
  assert.deepStrictEqual([rows[0].won, rows[0].lost], [1, 1]);
});
H.check('3 · no wrong merge: London Olympics ≠ Queen\'s Club; Melbourne ≠ Australian Open / Great Ocean Road Open', () => {
  const id = n => TI.canonicalTournament(n).id;
  assert.notStrictEqual(id('London Olympics'), id("Queen's Club"));
  assert.strictEqual(id('London'), id("Queen's Club"));
  assert.notStrictEqual(id('Melbourne'), id('Australian Open'));
  assert.notStrictEqual(id('Melbourne'), id('Great Ocean Road Open'));
  assert.strictEqual(id('Paris Olympics'), id('Olympic Games'));
  assert.notStrictEqual(id('Paris'), id('Olympic Games'));
});

// ════════════════════════════════════════════════════════════════════════════
// 4 · the shard is loading: nothing that reads it claims anything
// ════════════════════════════════════════════════════════════════════════════
const PENDING = () => ({ marketEdgePending: { [FX.key]: true } });   // fresh per module: a landed shard deletes the mark
function cal(I, p) { return withState(I, { key: p.key, calTab: 'calendar', calSurface: 'all', calCell: null }, () => I.renderSeasonModal(p)); }
H.check('4 · Calendar while the shard loads: no "no priced matches", no "None of these N matches carries a closing price", no yields', () => {
  const { I, W, p } = fxModule({ noShard: true, extra: PENDING() });
  const t = T(cal(I, p));
  assert(!/no priced matches/i.test(t), 'Career yield tile claims "no priced matches"');
  assert(!/carries a closing price|carry no closing price|None of these/i.test(t), 'the footnote claims no closing price');
  assert(!/no month clears|of [\d,]+ matches · flat 1u/.test(t), 'a priced count or month claim while loading');
  assert(!/Career yield —/.test(t), 'Career yield prints a dash while loading');
  assert(!/SWING (HARD|CLAY|GRASS|INDOORS)/i.test(t), 'the Swing row names a surface off a partial court column');
  // the shard lands: the same tab paints its figures
  W.marketEdge[FX.key] = FX.marketEdge; delete W.marketEdgePending[FX.key];
  const t2 = T(cal(I, p));
  assert(/[\d,]+ priced matches/.test(t2) && /of [\d,]+ matches · flat 1u/.test(t2), 'the landed tab has no priced figures: ' + t2.slice(0, 200));
  return 'pending: no claim → landed: "' + (/Career yield \S+ [\d,]+ priced matches/.exec(t2) || [''])[0] + '"';
});
H.check('4 · the Calendar drill while the shard loads prints no "no priced match in this month" and no price dashes', () => {
  const { I, p } = fxModule({ noShard: true, extra: PENDING() });
  const spine = I.calSpine(p); const r = spine[spine.length - 1];
  const t = T(withState(I, { key: p.key, calTab: 'calendar', calSurface: 'all', calCell: r.year + '|' + r.mon }, () => I.renderSeasonModal(p)));
  assert(/data-pp2-cal-drill|P&L|P&amp;L/.test(t) || /RD/.test(t), 'the drill did not render');
  assert(!/no priced match in this month/.test(t), 'the drill claims no priced match');
});
H.check('4 · Court speed while the shard loads: no units and no H / A dashes', () => {
  const { I, W, p } = fxModule({ noShard: true, extra: PENDING() });
  const h = withState(I, { key: p.key, speedSurf: 'all', speedBand: null }, () => I.renderSpeedModal(p));
  const t = T(h);
  assert(!/[+−]\d+\.\du\b/.test(t), 'a units figure while loading');
  assert(!/on \d+ priced/.test(t), 'a priced count while loading');
  assert(!/matches · —/.test(t) && !/(Slow|Medium|Fast) —/.test(t), 'a units dash while loading: ' + t.slice(0, 300));
  assert(!/ — — /.test(t), 'an unpriced H / A pair dashes while loading');
  W.marketEdge[FX.key] = FX.marketEdge; delete W.marketEdgePending[FX.key];
  const t2 = T(withState(I, { key: p.key, speedSurf: 'all', speedBand: null }, () => I.renderSpeedModal(p)));
  assert(/[+−]\d+\.\du/.test(t2), 'the landed modal prints no units');
});
H.check('4 · Matchup Backing while the shard loads: no units, no "0 priced"', () => {
  const styles = { players: [] };
  const seen = {};
  FX.careerHistory.forEach((r) => { if (r.opponent && !seen[r.opponent]) { seen[r.opponent] = 1; styles.players.push({ name: r.opponent, archetype_label: 'Attacking Baseliner' }); } });
  const { I, W, p } = fxModule({ noShard: true, extra: Object.assign({ playingStyles: styles }, PENDING()) });
  const open = { key: p.key, styleRow: 'Attacking Baseliner' };
  const t = T(withState(I, open, () => I.renderStylesModal(p)));
  assert(/Attacking Baseliner/.test(t), 'no archetype row rendered — the check would be vacuous');
  assert(!/[+−]\d+\.\d\du\b/.test(t), 'a Backing figure while loading');
  assert(!/0 priced/.test(t), 'the drill claims 0 priced while loading');
  W.marketEdge[FX.key] = FX.marketEdge; delete W.marketEdgePending[FX.key];
  const t2 = T(withState(I, open, () => I.renderStylesModal(p)));
  assert(/[+−]\d+\.\d\du/.test(t2), 'the landed modal prints no Backing');
});
H.check('4 · the ledger while the shard loads: an unpriced H / A cell is blank, not a dash', () => {
  const { I, p } = fxModule({ noShard: true, extra: PENDING() });
  I.state.key = p.key;
  const x = { m: { date: '2026-01-05', opponent: 'B. Shelton', won: true, result: '2 - 0', tournament: 'Brisbane', round: 'R32' }, price: null, oppPrice: null };
  const h = I.ledgerRowHtml(x);
  I.state.key = null;
  const cells = h.split('<span').slice(-2).map(c => L.text('<span' + c).trim());
  assert.deepStrictEqual(cells, ['', ''], 'the ledger row\'s H / A cells read ' + JSON.stringify(cells) + ' while loading');
  // a settled shard (no pending mark) still dashes an unpriced cell
  const { I: I2, p: p2 } = fxModule({ noShard: true });
  I2.state.key = p2.key;
  const h2 = I2.ledgerRowHtml(x);
  I2.state.key = null;
  assert.deepStrictEqual(h2.split('<span').slice(-2).map(c => L.text('<span' + c).trim()), ['—', '—']);
});
H.check('4 · Record per tournament tile while the Backing join has not answered: pending, never "no event with 10+ priced matches"', () => {
  const { I, p } = fxModule({ extra: { trProfileBacking: () => null } });
  const v = I.buildBoxVals(p, { archetype: null });
  assert(v.tourn.pending === true, 'tile: ' + JSON.stringify(v.tourn));
  assert(!/no event with 10\+ priced/.test(String(v.tourn.support)), v.tourn.support);
});

// ════════════════════════════════════════════════════════════════════════════
// 5 · Record per tournament fallback: overall W–L, not summed Backing units
// ════════════════════════════════════════════════════════════════════════════
H.check('5 · no event clears ten priced → "all events · W–L" (rate headline), not a summed units figure; the flag restores it', () => {
  // every event priced on 4 matches at +1.0u: no event reaches ten, so the tile falls back
  const bk = () => ({ n: 4, units: 1, unitsTxt: '+1.0u', vm: null, vmTxt: null, nb: 0, rows: 4, small: false });
  const { I, p } = fxModule({ extra: { trProfileBacking: bk } });
  const v = I.buildBoxVals(p, { archetype: null }).tourn;
  const views = I.tournViews(p);
  const won = views.reduce((a, t) => a + t.won, 0), lost = views.reduce((a, t) => a + t.lost, 0);
  assert(!v.hlSuffix && !/u$/.test(String(v.headline)), 'headline is a units figure: ' + v.headline);
  assert(!/priced/.test(String(v.support)), 'support quotes a priced count: ' + v.support);
  assert.strictEqual(v.support, 'all events · ' + won + '–' + lost);
  assert.strictEqual(v.headline, Math.round(100 * won / (won + lost)) + '%');
  // one flag restores the fx3 summed path, unchanged
  assert('TOURN_TILE_SUMMED_UNITS' in I, 'no TOURN_TILE_SUMMED_UNITS switch');
  I.TOURN_TILE_SUMMED_UNITS = true;
  const v2 = I.buildBoxVals(p, { archetype: null }).tourn;
  I.TOURN_TILE_SUMMED_UNITS = false;
  assert.strictEqual(v2.hlSuffix, 'u');
  assert(/ priced$/.test(v2.support), v2.support);
  return `fallback: ${v.headline} · ${v.support}   (flag on: ${v2.headline}u · ${v2.support})`;
});

// ════════════════════════════════════════════════════════════════════════════
// 6 · minor
// ════════════════════════════════════════════════════════════════════════════
H.check('6 · Court speed fallback names the true reason: no band reaches ten → "none at 10+ matches"', () => {
  const { I, p } = fxModule();
  const bands = withState(I, { speedSurf: 'all' }, () => I.speedBands(p));
  const v = I.buildBoxVals(p, { archetype: null }).speed;
  const any10 = bands.some(b => b.won + b.lost >= 10);
  if (/all rated courts/.test(String(v.support))) {
    assert(any10 ? /no band above it/.test(v.support) : /none at 10\+ matches/.test(v.support), v.support);
  }
  // constructed: three bands of 4 matches each, no court-speed winner possible
  const src = fs.readFileSync(PP2, 'utf8');
  assert(/'none at 10\+ matches'/.test(src.slice(src.indexOf('v.speed = '), src.indexOf('v.speed = ') + 3000)), 'the speed fallback has no n < 10 wording');
});
H.check('6 · names: "J-L. Struff" → "Struff J-L." (ledger / ribbon); mkOppName "J.J. Wolf" → "J. J. Wolf"', () => {
  const { I } = fxModule();
  assert.strictEqual(I.surnameFirst('J-L. Struff'), 'Struff J-L.');
  assert.strictEqual(I.surnameFirst('J. M. Cerundolo'), 'Cerundolo J. M.');
  assert.strictEqual(I.surnameFirst('J.J. Wolf'), 'Wolf J. J.');
  assert.strictEqual(I.mkOppName('J.J. Wolf'), 'J. J. Wolf');
  assert.strictEqual(I.mkOppName('Wolf J.J.'), 'J. J. Wolf');
  assert.strictEqual(I.mkOppName('Struff J-L.'), 'J-L. Struff');
  assert.strictEqual(I.mkOppName('Cerundolo J.M.'), 'J. M. Cerundolo');
  assert.strictEqual(I.surnameOf('J-L. Struff'), 'Struff');
});
H.check('6 · Career hero with a 5–9 career: the small-sample mark sits UNDER the rate (one column), not beside it', () => {
  const src = fs.readFileSync(PP2, 'utf8');
  const i = src.indexOf('var heroRate = \'\';');
  const body = src.slice(i, src.indexOf('var scopeCaps', i));
  // execute the real hero branch with a 7-match career
  // eslint-disable-next-line no-new-func
  const f = new Function('gateFor', 'GATE', 'tn', 'allRate', 'smallSampleText', 'smallSampleHtml', body + '\nreturn heroRate;');
  const GATE = { FULL: 'full', SMALL: 'small', THIN: 'thin', NONE: 'none' };
  const html = f(() => GATE.SMALL, GATE, 7, 71.4, n => 'small sample · n=' + n, n => '<span data-pp2-small="' + n + '">small sample · n=' + n + '</span>');
  const col = /^<span data-pp2-ratemark="7" style="display:inline-flex;flex-direction:column;/.test(html);
  assert(col, 'the rate and the mark are siblings in the hero row: ' + html);
  assert(html.indexOf('71.4%') < html.indexOf('data-pp2-small'), 'the mark is not after (under) the rate');
});

H.done();
