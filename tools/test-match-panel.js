#!/usr/bin/env node
'use strict';
// §8.2 · MATCH PANEL + FULL-SCREEN MATCH PAGE, and §3's frac() denominators.
//
// What these lock, and why each one earns its place:
//
//  · NO DEAD AFFORDANCES. The founder's Phase A ruling is that a control which
//    does nothing is worse than no control. Coverage here is genuinely partial —
//    on the deployed indexes Zverev has a point log for 316 of his 399 keyed
//    career rows and a box score for 222 — so the tab row has to be built from
//    what THIS match holds, not from the spec's list of three.
//
//  · ABSENT vs NULL. window.pbpShards[k] absent means "not fetched"; null means
//    "fetched, nothing on file". Collapsing them puts "no point log on record"
//    (a claim about the match) on screen while the network is still in flight.
//    This is the same distinction careerHistory needed and got wrong once.
//
//  · ORIENTATION BY KEY. A shard whose two sides name neither player must refuse
//    rather than guess, or the reader gets the other man's points under this
//    man's name.
//
//  · §3 frac(). Every rate shows its record. The denominators come from
//    matchStats.{side}.raw, which carries {won,total} for twelve fields. `1st
//    serve %` has none anywhere and keeps a blank sub-line per the founder's
//    2026-09-18 ruling — a borrowed denominator is a fabricated one.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const DASH = '—';

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

// ── a match built by construction, so nothing can pass by luck ──────────────
const EK = 999001;
const SHEET_ID = '2026-05-01|B. Opponent';
const MATCH = {
  date: '2026-05-01', opponent: 'B. Opponent', tournament: 'Somewhere', round: 'Final',
  surface: 'hard', won: true, eventKey: EK, result: '2 - 1',
  sets: [{ p: 6, o: 4 }, { p: 3, o: 6 }, { p: 7, o: 5 }]
};
const SUBJECT = {
  key: 4242, name: 'A. Subject',
  recentForm: { pct: 0, matches: [MATCH] }
};

// A point log whose games spell out a 2-1 win, with p1 = the subject.
function game(g, server, winner, score, points) {
  return { g, server, winner, score, points };
}
const PBP = {
  p1Key: 4242, p2Key: 7777, p1: 'A. Subject', p2: 'B. Opponent',
  sets: [
    { set: 1, games: [
      game(1, 'p1', 'p1', '1 - 0', [{ n: 1, s: '15 - 0' }, { n: 2, s: '40 - 0' }]),
      game(2, 'p2', 'p1', '2 - 0', [{ n: 1, s: '0 - 15', bp: true }]),
      game(3, 'p1', 'p1', '6 - 4', [{ n: 1, s: '40 - 30', sp: true }]),
    ] },
    { set: 2, games: [
      game(1, 'p2', 'p2', '0 - 1', [{ n: 1, s: '0 - 40' }]),
      game(2, 'p1', 'p2', '3 - 6', [{ n: 1, s: '30 - 40', bp: true }]),
    ] },
  ],
};
const SIDE = (aces, raw) => Object.assign({
  'Service:Aces': aces,
  'Service:Double Faults': 2,
  'Service:1st serve percentage': 61.5,
  'Service:1st serve points won': 64.1,
  'Service:2nd serve points won': 53.8,
  'Service:Break Points Saved': 66.7,
  'Return:1st return points won': 41.5,
  'Return:2nd return points won': 63.3,
  'Return:Break Points Converted': 50,
  'Points:Winners': 24,
  'Points:Unforced errors': 18,
  'Points:Net points won': 75,
  raw: raw,
}, {});
const RAW_FULL = {
  'Service:1st serve points won': { won: 25, total: 39 },
  'Service:2nd serve points won': { won: 14, total: 26 },
  'Service:Break Points Saved': { won: 4, total: 6 },
  'Return:1st return points won': { won: 17, total: 41 },
  'Return:2nd return points won': { won: 19, total: 30 },
  'Return:Break Points Converted': { won: 5, total: 10 },
  'Points:Net points won': { won: 9, total: 12 },
  'Points:Service Points Won': { won: 39, total: 65 },
  'Points:Return Points Won': { won: 36, total: 71 },
};
const SETSTATS = {
  p1Key: 4242, p2Key: 7777,
  match: { p1: SIDE(11, RAW_FULL), p2: SIDE(6, RAW_FULL) },
  sets: { 1: { p1: SIDE(4, null), p2: SIDE(2, null) },
          2: { p1: SIDE(3, null), p2: SIDE(2, null) } },
};

function load(opts) {
  const o = opts || {};
  const sandbox = {
    FEATURE_PP2: true,
    playerProfiles: { players: { 4242: SUBJECT } },
    matchStats: o.matchStats === undefined
      ? { [String(EK)]: { p1Key: 4242, p2Key: 7777, matchStats: SETSTATS.match } }
      : o.matchStats,
  };
  if ('pbpIndex' in o) sandbox.pbpIndex = o.pbpIndex;
  if ('setStatsIndex' in o) sandbox.setStatsIndex = o.setStatsIndex;
  if ('matchStatsIndex' in o) sandbox.matchStatsIndex = o.matchStatsIndex;
  if ('pbpShards' in o) sandbox.pbpShards = o.pbpShards;
  if ('setStatsShards' in o) sandbox.setStatsShards = o.setStatsShards;
  global.window = sandbox;
  // eslint-disable-next-line no-new-func
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sandbox);
  const I = sandbox.PlayerProfileV2._internals;
  I.state.key = 4242;
  return I;
}
const FULL = () => ({
  pbpIndex: new Set([String(EK)]),
  setStatsIndex: new Set([String(EK)]),
  matchStatsIndex: new Set([String(EK)]),
  pbpShards: { [String(EK)]: PBP },
  setStatsShards: { [String(EK)]: SETSTATS },
});

console.log('\n§8.2 match panel + §3 frac()\n');

// ── the control, first: the surfaces must exist at all ──────────────────────
check('the module exports both §8.2 surfaces and they are functions', () => {
  const I = load(FULL());
  assert.strictEqual(typeof I.renderMatchPanel, 'function', 'renderMatchPanel missing');
  assert.strictEqual(typeof I.renderMatchPage, 'function', 'renderMatchPage missing');
  assert.strictEqual(I.MP_TABS.length, 3, 'the spec is three tabs');
});

check('a fully-fed match offers all three tabs', () => {
  const I = load(FULL());
  const a = I.mpAvailable(MATCH);
  assert.deepStrictEqual(a, { summary: true, stats: true, points: true }, JSON.stringify(a));
  const html = I.renderMatchPanel(SUBJECT, I.build(SUBJECT), SHEET_ID);
  const tabs = (html.match(/data-pp2="mp-tab"/g) || []).length;
  assert.strictEqual(tabs, 3, `expected 3 tab buttons, got ${tabs}`);
});

// ── NO DEAD AFFORDANCES ─────────────────────────────────────────────────────
check('a match with no point log does NOT paint a Points tab', () => {
  const o = FULL(); o.pbpIndex = new Set(); o.pbpShards = { [String(EK)]: null };
  const I = load(o);
  assert.strictEqual(I.mpAvailable(MATCH).points, false, 'Points claimed available with no log');
  const html = I.renderMatchPanel(SUBJECT, I.build(SUBJECT), SHEET_ID);
  assert.ok(!/data-v="points"/.test(html), 'painted a Points tab with no point log behind it');
  assert.ok(/Points[^<]*not shown/.test(html.replace(/<[^>]*>/g, ' ')) ||
            /not shown/.test(html), 'the absence should be named, not silent');
});

check('a match with no feeds at all paints NO tab row', () => {
  const I = load({ pbpIndex: new Set(), setStatsIndex: new Set(), matchStatsIndex: new Set(),
                   pbpShards: { [String(EK)]: null }, setStatsShards: { [String(EK)]: null },
                   matchStats: null });
  const a = I.mpAvailable(MATCH);
  assert.strictEqual(a.points, false); assert.strictEqual(a.stats, false);
  const html = I.renderMatchPanel(SUBJECT, I.build(SUBJECT), SHEET_ID);
  assert.strictEqual((html.match(/data-pp2="mp-tab"/g) || []).length, 0,
    'one available tab must not paint a segmented control of one');
});

// ── ABSENT vs NULL ──────────────────────────────────────────────────────────
check('an unfetched shard says "loading", a null shard says "nothing on record"', () => {
  const pending = load({ pbpIndex: new Set([String(EK)]), setStatsIndex: new Set(),
                         matchStatsIndex: new Set(), pbpShards: {}, setStatsShards: {},
                         matchStats: null });
  pending.state.mpTab = 'points';
  const hp = pending.renderMatchPanel(SUBJECT, pending.build(SUBJECT), SHEET_ID);
  assert.ok(/Loading/.test(hp), 'an in-flight fetch must not claim the match has no log');

  const answered = load({ pbpIndex: new Set([String(EK)]), setStatsIndex: new Set(),
                          matchStatsIndex: new Set(), pbpShards: { [String(EK)]: null },
                          setStatsShards: {}, matchStats: null });
  answered.state.mpTab = 'points';
  const ha = answered.renderMatchPanel(SUBJECT, answered.build(SUBJECT), SHEET_ID);
  assert.ok(/No point log on record/.test(ha), 'an answered-empty shard must say so');
  assert.ok(!/Loading/.test(ha), 'an answered shard must not still read as loading');
});

// ── ORIENTATION BY KEY ──────────────────────────────────────────────────────
check('a shard naming neither player REFUSES rather than guessing', () => {
  const o = FULL();
  o.pbpShards = { [String(EK)]: Object.assign({}, PBP, { p1Key: 111, p2Key: 222 }) };
  o.setStatsShards = { [String(EK)]: Object.assign({}, SETSTATS, { p1Key: 111, p2Key: 222 }) };
  o.matchStats = null;
  const I = load(o);
  I.state.mpTab = 'points';
  const html = I.renderMatchPanel(SUBJECT, I.build(SUBJECT), SHEET_ID);
  assert.ok(/cannot be oriented/.test(html),
    'an unorientable log was painted anyway — that is the other player’s match');
});

check('the point score reads from the SUBJECT’s side, both orientations', () => {
  // Read the FIRST point of the FIRST game by position, not by searching the
  // whole panel: "0 - 15" also occurs in the raw log at game 2, so a bare match
  // anywhere is satisfied by an UNFLIPPED render and proves nothing. (A mutant
  // that dropped the flip entirely passed the first version of this check.)
  const firstPoint = (html) => {
    const m = html.match(/font-size:12px;color:#5b6880;">([^<]*)</);
    return m ? m[1].trim() : null;
  };
  const asP1 = load(FULL());
  asP1.state.mpTab = 'points'; asP1.state.mpPointSet = '1';
  const h1 = asP1.renderMatchPanel(SUBJECT, asP1.build(SUBJECT), SHEET_ID);
  assert.strictEqual(firstPoint(h1), '15 - 0',
    'p1-side subject should see the raw running score');

  const o = FULL();
  o.pbpShards = { [String(EK)]: Object.assign({}, PBP, { p1Key: 7777, p2Key: 4242 }) };
  o.setStatsShards = { [String(EK)]: Object.assign({}, SETSTATS, { p1Key: 7777, p2Key: 4242 }) };
  const asP2 = load(o);
  asP2.state.mpTab = 'points'; asP2.state.mpPointSet = '1';
  const h2 = asP2.renderMatchPanel(SUBJECT, asP2.build(SUBJECT), SHEET_ID);
  assert.strictEqual(firstPoint(h2), '0 - 15',
    'p2-side subject must see that same point flipped onto his side');
  assert.ok(h1 !== h2, 'the two orientations rendered identically — the flip is not wired');
});

// ── the Points tab's own content ────────────────────────────────────────────
check('BP / SP badges come from the feed’s flags, not from the score', () => {
  const I = load(FULL());
  I.state.mpTab = 'points'; I.state.mpPointSet = '1';
  const html = I.renderMatchPanel(SUBJECT, I.build(SUBJECT), SHEET_ID);
  assert.strictEqual((html.match(/>BP</g) || []).length, 1, 'set 1 carries exactly one bp flag');
  assert.strictEqual((html.match(/>SP</g) || []).length, 1, 'set 1 carries exactly one sp flag');
  assert.ok(/LOST SERVE/.test(html), 'game 2 of set 1 is a break and must carry the badge');
});

check('the Points set selector lists exactly the sets the log holds', () => {
  const I = load(FULL());
  I.state.mpTab = 'points';
  const html = I.renderMatchPanel(SUBJECT, I.build(SUBJECT), SHEET_ID);
  const segs = (html.match(/data-pp2="mp-point-set"/g) || []).length;
  assert.strictEqual(segs, 2, `the log has 2 sets, the selector offered ${segs}`);
});

// ── Summary ─────────────────────────────────────────────────────────────────
check('per-set games are read off the point log when it exists', () => {
  const I = load(FULL());
  const cells = I.mpSetGames(MATCH, PBP, true);
  assert.deepStrictEqual(cells.map((c) => [c.a, c.b]), [[6, 4], [3, 6]],
    'the last game of each set carries the set score: ' + JSON.stringify(cells));
});

check('per-set games fall back to the career row when there is no log', () => {
  const I = load(FULL());
  const cells = I.mpSetGames(MATCH, null, true);
  assert.deepStrictEqual(cells.map((c) => [c.a, c.b]), [[6, 4], [3, 6], [7, 5]]);
  assert.strictEqual(I.mpSetGames({ sets: [] }, null, true), null,
    'no source at all must return null, not an empty score');
});

check('Match time is DASHED, never zeroed, and the reason is stated', () => {
  const I = load(FULL());
  I.state.mpTab = 'summary';
  const html = I.renderMatchPanel(SUBJECT, I.build(SUBJECT), SHEET_ID);
  assert.ok(/Match time/.test(html), 'the spec’s Match time row is missing');
  assert.ok(/duration is not carried/i.test(html), 'the dash must name its reason');
  const text = html.replace(/<[^>]*>/g, ' ');
  assert.ok(!/\b0:00\b|\b0h\b|\b0m\b/.test(text), 'a duration was fabricated as a zero');
});

// ── Stats ───────────────────────────────────────────────────────────────────
check('the Stats set selector appears only when per-set scores exist', () => {
  const withSets = load(FULL());
  withSets.state.mpTab = 'stats';
  const a = withSets.renderMatchPanel(SUBJECT, withSets.build(SUBJECT), SHEET_ID);
  assert.strictEqual((a.match(/data-pp2="mp-set"/g) || []).length, 3,
    'Match + Set 1 + Set 2 = 3 buttons');

  const o = FULL();
  o.setStatsShards = { [String(EK)]: { p1Key: 4242, p2Key: 7777, match: SETSTATS.match } };
  o.setStatsIndex = new Set();
  const matchOnly = load(o);
  matchOnly.state.mpTab = 'stats';
  const b = matchOnly.renderMatchPanel(SUBJECT, matchOnly.build(SUBJECT), SHEET_ID);
  assert.strictEqual((b.match(/data-pp2="mp-set"/g) || []).length, 0,
    'a selector of one option is a dead control');
  assert.ok(/set selector is not shown/.test(b), 'its absence should be named');
});

// ── §3 · frac() ─────────────────────────────────────────────────────────────
check('every rate we hold a denominator for prints its record', () => {
  const I = load(FULL());
  const side = SETSTATS.match.p1;
  const want = [
    ['Service:1st serve points won', '25/39'],
    ['Service:2nd serve points won', '14/26'],
    ['Service:Break Points Saved', '4/6'],
    ['Return:1st return points won', '17/41'],
    ['Return:2nd return points won', '19/30'],
    ['Return:Break Points Converted', '5/10'],
    ['Points:Net points won', '9/12'],
  ];
  for (const [field, expect] of want) {
    assert.strictEqual(I.sheetFrac({ field, kind: 'pct' }, side), expect, field);
  }
  assert.strictEqual(I.sheetFrac({ derived: 'spw', kind: 'pct' }, side), '39/65',
    'service points won is derived and still has a raw denominator');
  assert.strictEqual(I.sheetFrac({ derived: 'rpw', kind: 'pct' }, side), '36/71');
});

check('1st serve % keeps a BLANK sub-line — we hold no denominator for it', () => {
  const I = load(FULL());
  assert.strictEqual(
    I.sheetFrac({ field: 'Service:1st serve percentage', kind: 'pct' }, SETSTATS.match.p1), '',
    'a borrowed denominator is a fabricated one — founder ruling 2026-09-18 item 4');
});

check('a COUNT row prints no fraction', () => {
  const I = load(FULL());
  assert.strictEqual(I.sheetFrac({ field: 'Service:Aces', kind: 'count' }, SETSTATS.match.p1), '',
    'the value IS the count; a fraction under it would invent a denominator');
});

check('a side with no raw block prints no fraction anywhere', () => {
  const I = load(FULL());
  assert.strictEqual(I.sheetFrac({ field: 'Service:Break Points Saved', kind: 'pct' },
    SIDE(4, null)), '');
  assert.strictEqual(I.sheetFrac({ field: 'Service:Break Points Saved', kind: 'pct' },
    SIDE(4, { 'Service:Break Points Saved': { won: 3, total: 0 } })), '',
    'a zero denominator is not a denominator');
});

check('the rendered sheet carries the fractions', () => {
  const I = load(FULL());
  I.state.sheet = SHEET_ID;
  const html = I.renderSheet(SUBJECT, I.build(SUBJECT));
  assert.ok(/25\/39/.test(html), 'the sheet rendered no frac sub-line');
  assert.ok(/4\/6/.test(html), 'break points saved lost its record');
});

// ── the opener ──────────────────────────────────────────────────────────────
check('the sheet offers "Full match" only where a panel has something to show', () => {
  const I = load(FULL());
  I.state.sheet = SHEET_ID;
  const html = I.renderSheet(SUBJECT, I.build(SUBJECT));
  assert.ok(/data-pp2="match-page"/.test(html), 'no opener on a fully-fed match');

  const bare = load({ pbpIndex: new Set(), setStatsIndex: new Set(), matchStatsIndex: new Set(),
                      pbpShards: { [String(EK)]: null }, setStatsShards: { [String(EK)]: null },
                      matchStats: null });
  const bareMatch = Object.assign({}, MATCH, { sets: [] });
  assert.strictEqual(bare.mpHasPanel(bareMatch), false,
    'a match with no feeds and no set scores would open a page with nothing on it');
});

check('the full-screen page carries the export’s own chrome', () => {
  const I = load(FULL());
  I.state.matchPage = SHEET_ID;
  const html = I.renderMatchPage(SUBJECT, I.build(SUBJECT));
  for (const needle of [
    'position:fixed;inset:0;z-index:80', 'background:#06070a', 'max-width:1000px',
    'padding:26px 34px 70px', 'Back to profile', 'font-size:26px;font-weight:800',
    'color:#3f4860', 'data-pp2="match-page-close"',
  ]) {
    assert.ok(html.includes(needle), `off the export: missing ${needle}`);
  }
  I.state.matchPage = null;
  assert.strictEqual(I.renderMatchPage(SUBJECT, I.build(SUBJECT)), '',
    'the page rendered while closed');
});

// ── item 6 · the Live trading support line ──────────────────────────────────
check('box 8 prints the TOUR GAP, not the sample count', () => {
  // A roster big enough to strike a pool: ten peers, each with one match lost
  // from a set down.
  const peers = { 4242: SUBJECT };
  const setDownMatch = (d, won) => ({ date: d, opponent: 'X. Y', won, eventKey: null,
    sets: [{ p: 3, o: 6 }, { p: 6, o: 4 }, { p: 6, o: 4 }], tournament: 'T', tier: 'atp' });
  for (let i = 0; i < 12; i++) {
    peers[9000 + i] = { key: 9000 + i, name: 'P' + i,
      recentForm: { pct: 0, matches: [setDownMatch('2026-01-0' + (i % 9 + 1), i % 3 === 0)] } };
  }
  // The subject for the tile assertion needs to CLEAR the sample gate — the gate
  // withholds the rate under five matches, and a gated tile legitimately prints
  // its count instead. Six matches, so the ruling is what is being measured.
  peers[9500] = { key: 9500, name: 'D. Downer', recentForm: { pct: 0, matches: [
    setDownMatch('2026-02-01', true), setDownMatch('2026-02-02', true),
    setDownMatch('2026-02-03', false), setDownMatch('2026-02-04', false),
    setDownMatch('2026-02-05', true), setDownMatch('2026-02-06', false),
  ] } };
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: peers }, matchStats: null };
  global.window = sandbox;
  // eslint-disable-next-line no-new-func
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sandbox);
  const I = sandbox.PlayerProfileV2._internals;
  const tour = I.tourFromASetDown();
  assert.ok(tour.pct != null, `a 13-player pool should strike a tour figure, got ${JSON.stringify(tour)}`);
  assert.ok(tour.players >= 10, `pool too small: ${tour.players}`);
  // Recompute the pool independently of the module's own accumulator.
  let w = 0, l = 0;
  Object.keys(peers).forEach((k) => {
    (peers[k].recentForm.matches || []).forEach((m) => {
      if (!m.sets || !m.sets.length) return;
      const s0 = m.sets[0];
      if (Number(s0.p) >= Number(s0.o)) return;
      if (m.won) w++; else l++;
    });
  });
  assert.strictEqual(Math.round(tour.pct * 10), Math.round((100 * w / (w + l)) * 10),
    `module says ${tour.pct}, independent recompute says ${100 * w / (w + l)}`);

  // The subject for THIS check must himself have been a set down — the fixture
  // SUBJECT won his opening set, so box 8 correctly says he never was. Using him
  // here would have read a true "no such match" as a failed ruling.
  const downer = peers[9500];
  const v = I.boxValues(downer, I.build(downer));
  assert.ok(/pp (below|above) tour/.test(v.profile.support),
    `the export's third clause is the tour gap, got: "${v.profile.support}"`);
  assert.ok(!/with set scores/.test(v.profile.support),
    `the sample count should have moved to the modal, got: "${v.profile.support}"`);
});

check('a pool too thin to strike a tour figure falls back to the count, never a fake gap', () => {
  // The subject must HAVE from-a-set-down matches and clear the sample gate, or
  // the tile says "he never was" and this check measures nothing — which is
  // exactly what let a hardcoded "6.4pp below tour" survive the first version.
  const lone = { key: 5555, name: 'L. Lone', recentForm: { pct: 0, matches: [1,2,3,4,5,6].map((i) => ({
    date: '2026-03-0' + i, opponent: 'X. Y', won: i % 2 === 0, eventKey: null,
    sets: [{ p: 2, o: 6 }, { p: 6, o: 3 }, { p: 6, o: 4 }], tournament: 'T', tier: 'atp' })) } };
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: { 5555: lone } }, matchStats: null };
  global.window = sandbox;
  // eslint-disable-next-line no-new-func
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sandbox);
  const I = sandbox.PlayerProfileV2._internals;
  I.state.key = 5555;
  const tour = I.tourFromASetDown();
  assert.strictEqual(tour.pct, null, 'a one-player pool must not claim a tour rate');
  const v = I.boxValues(lone, I.build(lone));
  // The control that makes the next line mean something: the tile must be in the
  // branch that WOULD print a gap if one could be struck.
  assert.ok(/from a set down/.test(v.profile.support) && /%/.test(v.profile.support),
    `the subject must have a real from-a-set-down rate for this to test anything: "${v.profile.support}"`);
  assert.ok(!/pp (below|above) tour/.test(v.profile.support),
    `invented a tour gap from a one-player pool: "${v.profile.support}"`);
  assert.ok(/with set scores/.test(v.profile.support),
    `the fallback must state its own sample instead: "${v.profile.support}"`);
});

check('the Live trading modal states the window AND the tour population', () => {
  const I = load(FULL());
  const note = I.setDownNote(SUBJECT);
  assert.ok(/ordered set scores/.test(note), 'the modal must state the window the box rests on');
  assert.ok(/not the career figure/.test(note), 'and that it is not the career figure');
  assert.ok(/fewer than ten players|not the ATP field/.test(note),
    'the tour caveat must be carried where the tile has no room for it');
});

console.log(`\n§8.2 match panel: ${pass} pass, ${fail} fail`);
if (fail) { console.error(`FAILED: ${fail} check(s)`); process.exit(1); }
