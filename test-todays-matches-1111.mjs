// Today's Matches — CHANGES_2026-11-11 (design_handoff_todays_matches_v3). Locks the items the older suites do not:
// A1/C1 copy, A2 zone label, A3 header strip, A8 header weights, A9 no FAV on Upcoming, A10 preview cards, A11 chip row,
// B2 move-view grid, B3 prices-moved count, C3 whole-percent drop. Functions are cut from the shipped page and run.
// Control: TEST_HTML=<pre-change dashboard> must fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(process.env.TEST_HTML || new URL('./bsp-consult-dashboard.html', import.meta.url), 'utf8');
function slice(name){
  const at = html.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' present');
  let i = html.indexOf('{', at), d = 0;
  for (; i < html.length; i++){ if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) return html.slice(at, i + 1); }
  throw new Error('unbalanced ' + name);
}
const M = '[data-page="matches"]';
const rule = sel => { const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g'); let m, last = null; while ((m = re.exec(html))) last = m[1]; return last; };

test('A1 / C1: the two sentences, no tail, no "Settled ·" clause', () => {
  const c = slice('updateMatchesHeaderChrome');
  assert.match(c, /\? 'Every settled ATP match, with its odds from open to close\.'/);
  assert.match(c, /: 'Live odds across bookmakers for every listed ATP match\.'/);
  assert.match(html, /<span class="mx-subtitle">Live odds across bookmakers for every listed ATP match\.<\/span><\/p>/);
  assert.doesNotMatch(c, /Settled · \$\{settledDateLabel/);
});
test('A2 / C1: the zone label — short offset of the zone the cards are printed in, true minus, minutes only when non-zero', () => {
  const mxTzShort = new Function(`${slice('mxTzShort')} return mxTzShort;`)();
  const at = new Date('2026-11-11T06:00:00Z');
  assert.equal(mxTzShort('Asia/Makassar', at), 'GMT+8');
  assert.equal(mxTzShort('America/Sao_Paulo', at), 'GMT−3');
  assert.equal(mxTzShort('Asia/Kolkata', at), 'GMT+5:30');
  assert.equal(mxTzShort('America/St_Johns', at), 'GMT−3:30');
  assert.equal(mxTzShort('UTC', at), 'GMT+0');
  assert.equal(mxTzShort('Europe/Berlin', new Date('2026-07-01T12:00:00Z')), 'GMT+2', 'DST read at the moment');
  assert.match(slice('mxPaintTzLabel'), /el\.title = tz \|\| ''/, 'the full IANA name on hover');
  assert.match(rule(`${M} .mx-tzlabel`), /margin-left:6px; font-family:var\(--font-nums\); font-size:11px; font-weight:500; color:var\(--text-label\); white-space:nowrap; cursor:default;/);
  assert.match(html, /id="dayTabsRight"[^>]*>›<\/button>\s*<span class="mx-tzlabel" id="mxTzLabel"><\/span>/);
});
test('A3: Upcoming strip = live column · Matches · Tournaments, each value centred under its label', () => {
  assert.match(slice('mcRenderHeaderStats'), /: \[\['Matches', shown\.length\], \['Tournaments', tours\]\];/);
  assert.match(rule('.sfh__stats--c .sfh__stat'), /align-items:center;/);
});
test('A8: start time Plex 11.5 / 700 white; surface 400', () => {
  assert.match(rule(`${M} .match-card .mc-datetime`), /font-size:11\.5px; font-weight:700; color:var\(--text\);/);
  assert.match(rule(`${M} .match-card .mc-surface`), /font-weight:400;/);
});
test('A9: no FAV badge on any Upcoming card; Completed keeps its own', () => {
  const r = slice('renderMatches');
  const up = r.slice(r.indexOf('<div class="mc-players up'), r.indexOf('return `', r.indexOf('<div class="mc-players up')));
  const done = r.slice(r.indexOf('<div class="mc-players cmpl">'), r.indexOf('<div class="mc-players up'));
  assert.doesNotMatch(up, /mc-fav-tag/);
  assert.equal((done.match(/mc-fav-tag/g) || []).length, 2);
});
test('A10: a preview card below the day divider shows the time only and its tournament in full', () => {
  const r = slice('renderMatches');
  assert.match(r, /const mxPreview = !isCompleted && dividersOn && daySpecific && dayBucket !== state\.day;/);
  assert.match(r, /\(daySpecific && dayBucket !== state\.day && !mxPreview\)\);/);
  assert.match(rule(`${M} .match-card.mx-preview .mc-head > .mc-tourn`), /flex:none;/);
});
test('A11: Upcoming hides the chip row when at most one chip besides All would show (Qualifying counts)', () => {
  const run = (tours, view) => {
    const g = { hidden: null, innerHTML: '' };
    const doc = { getElementById: () => g };
    new Function('document', 'matches', 'state', `
      const isFinishedMatch = () => true, isUpcomingOrLive = () => true, matchDayBucket = () => 'today';
      const MX_QUAL_SUFFIX = ' · Qualifying'; const mxIsQual = m => !!m.q;
      const mxTourKey = m => m.tour + (m.q ? MX_QUAL_SUFFIX : ''); const mxTourKeyName = k => k;
      ${slice('buildTournamentFilters')} buildTournamentFilters();`)(doc, tours, { view, day: 'today', tournaments: new Set() });
    return g;
  };
  assert.equal(run([{ tour: 'Stockholm' }, { tour: 'Stockholm' }], 'upcoming').hidden, true);
  assert.equal(run([{ tour: 'Stockholm' }, { tour: 'Stockholm', q: true }], 'upcoming').hidden, false, 'a Qualifying chip is a second chip');
  assert.equal(run([{ tour: 'Stockholm' }, { tour: 'Basel' }], 'upcoming').hidden, false);
  assert.equal(run([{ tour: 'Stockholm' }], 'completed').hidden, false, 'Completed is unchanged');
  assert.match(rule(`${M} .mx-chips[hidden]`), /display:none;/);
});
test('B2: the move view drops a column before a header is squeezed (480px track); the tournament never cut; no start time', () => {
  assert.match(slice('renderMatches'), /list\.classList\.toggle\('mx-mv', mxDriftView\(\)\);/);
  assert.match(rule(`${M} #matchlist.mx-mv`), /grid-template-columns:repeat\(auto-fill, minmax\(480px, 1fr\)\);/);
  assert.match(rule(`${M} #matchlist`), /minmax\(360px, 1fr\)/, 'the standard view keeps 360px');
  assert.match(rule(`${M} .match-card:not(.cmpl) .mc-head:has(.mc-colhead-drift) > .mc-tourn`), /flex:none;/);
});
test('B3: "{n} of {N} prices moved" — N = cards with an open → now pair, n = shortening side down 2%+; no pair = a dash', () => {
  const body = slice('renderMatches');
  const a = body.indexOf('    let bmv = null, bmvPairs = 0, movedN = 0;'), b = body.indexOf('    const driftOn = state.sort === ');
  assert.ok(a > 0 && b > a);
  const run = slate => new Function('daySlate', `
    const MOVE_NONE = -1, MOVE_UNPRICED = -2, MX_MOVE_MIN = 2.0;
    const _ocsOf = () => null, _mcNowPair = () => null, _openAnchorOf = () => null, _mcNowOf = () => null;
    const _mcOpenNowPair = m => m.__pair || null, cardStartMs = m => m.__t || 0;
    const roundBadgeText = r => r || ''; ${slice('mxIsQual')} ${slice('mxRoundLabel')}
    ${slice('_mcHasAnyPrice')} ${slice('mxMovePct')} ${slice('moveNowScore')}
    ${body.slice(a, b)} return { movedN, bmvPairs };`)(slate);
  const slate = [
    { __pair: { o1: 2.0, o2: 1.8, n1: 2.2, n2: 1.76 } },   // p2 −2.2% → moved
    { __pair: { o1: 1.5, o2: 2.6, n1: 1.48, n2: 2.7 } },   // p1 −1.3% → not
    { __pair: { o1: 3.0, o2: 1.4, n1: 3.0, n2: 1.4 } },    // flat
    {},                                                    // no pair: not in N
  ];
  assert.deepEqual(run(slate), { movedN: 1, bmvPairs: 3 });
  assert.match(body, /\$\{bmvPairs \? `\$\{movedN\} of \$\{bmvPairs\}` : '—'\}<\/span> prices moved/);
  assert.match(body, /const movedHtml = driftOn/, 'shown only while the move view is on');
  assert.match(body, /title="Matches where one side's price shortened 2% or more since open, out of matches with an open price"/);
  assert.match(rule(`${M} .mc-story__moved`), /margin-left:auto; white-space:nowrap; font-family:var\(--font-words\); font-size:12\.5px; font-weight:400; color:var\(--text-label\);/);
  assert.match(rule(`${M} .mc-story__movedn`), /font-family:var\(--font-nums\); font-weight:700; color:var\(--text\);/);
});
test('C3: the Completed Biggest market move = the biggest drop, a whole percent with a true minus, the opponent by surname', () => {
  const mxWholeDrop = new Function(`${slice('mxWholeDrop')} return mxWholeDrop;`)();
  assert.equal(mxWholeDrop(1.66, 1.59), '−4%');
  assert.equal(mxWholeDrop(2.00, 1.77), '−12%', '11.5% rounds to 12');
  assert.equal(mxWholeDrop(1.662, 1.591), '−4%', 'on the printed two-decimal prices');
  const r = slice('renderMatches');
  assert.match(r, /<span class="mc-drift neg"[^>]*>\$\{mxWholeDrop\(bmv\.o, bmv\.c\)\}<\/span>/);
  assert.match(r, /<strong>\$\{psEsc\(bmv\.name\)\}<\/strong> shortened · v \$\{psEsc\(mxSurname\(bmv\.opp\)\)\}/);
  const mxSurname = new Function(`${slice('mxSurname')} return mxSurname;`)();
  assert.equal(mxSurname('A. de Minaur'), 'de Minaur', 'particles kept');
});
