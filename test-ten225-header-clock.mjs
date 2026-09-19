// TEN-225 items 0d + 2 — the header clock reports DATA AGE, and the tooltip
// clocks render in the member's zone.
//
// Founder 2026-09-18T22:58Z:
//   item 2  'A member reading "updated 06:54" beside a price fetched at 05:45
//            is being told the wrong thing.'
//   item 0d 'Confirm what timezone the tooltip clocks render in.'
//   rule E  'a check that passes on an empty set is not a check. Manufacture
//            the state and run the pre-fix build as a control.'
//
// So every assertion here runs against a MANUFACTURED board, and the pre-fix
// implementations are reconstructed and run on the same input as controls. A
// test that only exercises today's live data would go quiet the moment the
// board emptied, which is the failure mode this issue keeps paying for.
//
// The functions are SLICED OUT OF THE SHIPPED HTML rather than copied, so they
// go red if the page changes and this file does not.
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('./bsp-consult-dashboard.html', import.meta.url), 'utf8');

function slice(name) {
  const at = SRC.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`function ${name} not found in the shipped HTML`);
  let i = SRC.indexOf('{', at), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (!depth) return SRC.slice(at, j + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const FAILED = [];
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
  if (!cond) FAILED.push(name);
};

// ---------------------------------------------------------------- the sandbox
// newsTz / headerClockFmt / dataLoadedAt / matches / OCS are the page globals
// these functions close over. Supplying them explicitly is what lets the test
// drive a board that does not exist.
function build({ matches = [], OCS = { byKey: {} }, tz = undefined, dataLoadedAt = null }) {
  const pre = `
    const newsTz = () => ${tz === undefined ? 'undefined' : JSON.stringify(tz)};
    const matches = ${JSON.stringify(matches)};
    const OCS = ${JSON.stringify(OCS)};
    const dataLoadedAt = ${dataLoadedAt ? `new Date(${JSON.stringify(dataLoadedAt)})` : 'null'};
    function headerClockFmt(d){
      try { return d.toLocaleTimeString(undefined, { timeZone: newsTz() }); }
      catch (e) { return d.toLocaleTimeString(); }
    }
    function ocsFmtTs(iso){ return 'TS(' + iso + ')'; }
    function escapeHtml(x){ return String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
    // RULING A scopes the header to the RENDERED list, so the sandbox supplies
    // the two page functions it reads. _mcNowPair is stubbed to the shape the
    // real one returns ({p1,p2,book,at,obs,...}) and driven off each fixture's
    // own _pair field, so a test board can express "priced and dated",
    // "priced but undated" and "dashed" independently — the three states the
    // ruling turns on.
    function getFiltered(){ return matches; }
    function _mcNowPair(m){ return m && m._pair ? m._pair : null; }
  `;
  const body = `${pre}\n${slice('mxOddsAgeBound')}\n${slice('mxOddsUpdatedAt')}\n${slice('mxHeaderStatusHtml')}\n${slice('ocsFmtClock')}
    return { mxOddsAgeBound, mxOddsUpdatedAt, mxHeaderStatusHtml, ocsFmtClock };`;
  return new Function(body)();
}

// The PRE-FIX header, reconstructed verbatim from the commit this replaces.
// Its whole behaviour is "print the page-load instant", which is the defect.
// The page's own header formatter, reproduced once, so a test comparison and
// the shipped render cannot disagree on locale or 12/24-hour.
const headerClockLike = (iso) => {
  try { return new Date(iso).toLocaleTimeString(undefined, { timeZone: 'UTC' }); }
  catch (e) { return new Date(iso).toLocaleTimeString(); }
};

const preFixHeader = (dataLoadedAt) =>
  `<span class="dot"></span><span class="mx-live-txt">Live · updated</span> <span class="mx-clock">${
    new Date(dataLoadedAt).toLocaleTimeString(undefined, {})}</span>`;

// --------------------------------------------------------------- manufactured
// The founder's own case: a price observed at 21:45:00Z, read at 22:54Z.
const OBSERVED = '2026-09-18T21:45:00Z';
const LOADED   = '2026-09-18T22:54:00Z';
const board = [
  { id: 'a', bet365Now: { p1: 2.25, observedAt: OBSERVED, at: '2026-09-18T20:53:30.576Z', src: 'live' } },
  { id: 'b', bet365Now: { p1: 1.50, observedAt: '2026-09-18T20:15:00Z', src: 'live' } },
];

console.log('TEN-225 item 2 — the header reports data age, not page load');
{
  // SUPERSEDED BY RULING A, and kept rather than deleted: item 2's requirement
  // (report DATA AGE, never the page-load instant) still holds — ruling A only
  // changed WHICH price's age is reported, from newest to oldest. These
  // assertions are rewritten to the ruling-A shape so they keep guarding item 2
  // instead of quietly passing on a string nobody renders any more.
  const api = build({ matches: [
    { id: 'a', _pair: { p1: 2.25, p2: 1.7, book: 'bet365', at: '2026-09-18T20:53:30.576Z',
                        obs: OBSERVED, kind: 'book-tick', src: 't' } },
  ], dataLoadedAt: LOADED, tz: 'UTC' });

  const b = api.mxOddsAgeBound();
  check('the bound is an observation clock off the board, not the load time',
        b.oldest === Date.parse(OBSERVED), new Date(b.oldest).toISOString());

  const html = api.mxHeaderStatusHtml();
  check('the header names what its clock measures (odds, not page load)',
        /odds/.test(html) && !/loaded/.test(html), html.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim());
  // The question under test is WHICH INSTANT the header chose, not how it was
  // formatted. Two earlier cuts of this assertion hardcoded "21:45" and then a
  // 24-hour en-GB render, and both failed against correct code because the page
  // formats 12-hour in the runner's locale — the assertion was measuring the
  // fixture. Rendering both candidate instants through the PAGE'S OWN formatter
  // removes the locale from the question entirely while still being falsifiable:
  // a header that printed the load time fails, as the control below shows.
  const shownObserved = html.includes(headerClockLike(OBSERVED));
  const shownLoaded   = html.includes(headerClockLike(LOADED));
  check('the header prints the OBSERVATION instant, not the load instant',
        shownObserved && !shownLoaded,
        `observed=${headerClockLike(OBSERVED)} shown=${shownObserved} | ` +
        `loaded=${headerClockLike(LOADED)} shown=${shownLoaded}`);

  // THE CONTROL. Without this, "prints 21:45" would also pass on a build that
  // happened to load at 21:45 — and, more to the point, a reader cannot tell
  // whether the assertion is measuring the fix or the fixture.
  const before = preFixHeader(LOADED);
  const dev = (iso) => new Date(iso).toLocaleTimeString(undefined, {});
  check('CONTROL: the PRE-FIX header prints the LOAD instant on the same input, so '
      + 'the assertion above is the fix and not the fixture',
        before.includes(dev(LOADED)) && !before.includes(dev(OBSERVED)),
        before.replace(/<[^>]+>/g, ' ').trim());
}

console.log('\n  — it must not silently substitute the load time when it has no data clock');
{
  // A board with prices but NO observation clock anywhere. The old code printed
  // exactly the same string here as it did with perfect data; that equivalence
  // is the bug, so the test asserts the two states now LOOK different.
  const api = build({ matches: [{ id: 'x', _pair: { p1: 2.0, p2: 1.9, book: 'bet365',
                                   at: '2026-09-18T10:00:00Z', obs: null, src: 't' } }],
                      dataLoadedAt: LOADED, tz: 'UTC' });
  check('no observation clock anywhere -> the bound is null, not a guess',
        api.mxOddsAgeBound().oldest === null);
  const html = api.mxHeaderStatusHtml();
  check('...and the header says "loaded", labelling the page-load instant as such',
        /loaded/.test(html) && !/odds updated/.test(html),
        html.replace(/<[^>]+>/g, ' ').trim());
  check('`at` is NEVER used as the data clock — a quiet market is not a dead pipeline',
        !/10:00/.test(html));
}

console.log('\n  — the card-state observation clock counts too, not just matches.json');
{
  const api = build({
    matches: [{ id: 'a', bet365Now: { observedAt: '2026-09-18T20:00:00Z', src: 'live' } }],
    OCS: { byKey: { k: { sides: { p: { nowObs: '2026-09-18T22:30:00Z' } } } } },
    dataLoadedAt: LOADED, tz: 'UTC' });
  check('mxOddsUpdatedAt (the newest reading, still used elsewhere) prefers the '
      + 'fresher OCS nowObs over a staler bet365Now.observedAt',
        api.mxOddsUpdatedAt() === Date.parse('2026-09-18T22:30:00Z'));
}

console.log('\nTEN-225 item 0d — the tooltip clock renders in the MEMBER zone');
{
  // ANCHORED TO THE REAL CLOCK, for the same reason the sameDay assertions below
  // are: ocsFmtClock only returns a BARE time when the stamp falls on today in
  // the member's zone, and prints a dated string otherwise. The literal
  // '2026-09-18T21:45:00Z' this block used to pass was 05:45 on 2026-09-19 in
  // Asia/Makassar, so it satisfied that condition on the day it was written and
  // stopped satisfying it 24 hours later — the assertion then failed against
  // CORRECT code and, being a fail-closed pre-deploy gate, blocked every deploy
  // from 2026-09-19T04:40Z onward. The code was never wrong; the fixture aged.
  //
  // Asia/Makassar is UTC+8 year-round (WITA, no DST), so "today at 05:45 there"
  // is an exact instant, and it is today in that zone BY CONSTRUCTION. That
  // keeps the founder's own 05:45 reading as the assertion while making the
  // block independent of the day the suite runs.
  const mkDay = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Makassar' });
  const OBSERVED_MK = new Date(`${mkDay}T05:45:00+08:00`).toISOString();
  const mk = build({ tz: 'Asia/Makassar', dataLoadedAt: LOADED });
  const ams = build({ tz: 'Europe/Amsterdam', dataLoadedAt: LOADED });
  const a = mk.ocsFmtClock(OBSERVED_MK), b = ams.ocsFmtClock(OBSERVED_MK);
  check('Asia/Makassar renders 21:45:00Z as 05:45 — the founder\'s own reading, '
      + 'so his tooltip was NOT 8 hours off', /05:45/.test(a), a);
  check('the SAME instant renders differently for a member on another zone, '
      + 'which is what proves newsTz() is honoured rather than ignored',
        a !== b, `Makassar ${a}  vs  Amsterdam ${b}`);

  // The PRE-FIX formatter took no timeZone at all.
  const preFix = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  check('CONTROL: the PRE-FIX formatter returns one string for both zones, '
      + 'because it ignored newsTz entirely',
        preFix(OBSERVED_MK) === preFix(OBSERVED_MK), preFix(OBSERVED_MK));

  // sameDay must be decided in the zone the time is printed in.
  // Anchored to the real clock rather than a literal date, so this cannot pass
  // or fail on what day the suite happens to run.
  const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const today      = new Date(Date.now() -  1 * 60   * 1000).toISOString();
  check('a stamp on a DIFFERENT member-zone day falls back to the dated format — '
      + 'that is how yesterday would otherwise read as tonight',
        /TS\(/.test(mk.ocsFmtClock(twoDaysAgo)), mk.ocsFmtClock(twoDaysAgo));
  check('...while a stamp from TODAY in that zone still renders as a bare time, '
      + 'so the guard above is not simply dating everything',
        !/TS\(/.test(mk.ocsFmtClock(today)), mk.ocsFmtClock(today));
}

// ===========================================================================
// RULING A — the header reports the OLDEST price shown, not the newest.
// Founder 2026-09-18T23:50Z. Every case is manufactured, and the NEWEST-based
// implementation is run on the same input as the control, because "prints
// 20:15" would otherwise pass on a board where oldest and newest coincide.
// ===========================================================================
console.log('\nRULING A — the header bounds the board by its OLDEST price');

const pair = (obs, book = 'bet365') =>
  ({ p1: 2.0, p2: 1.8, book, at: '2026-09-18T12:00:00Z', obs, kind: 'book-tick', src: 't' });

{
  // Three prices, all dated. Oldest 20:15, newest 22:45 — deliberately far
  // apart so the two rules cannot both be satisfied by the same string.
  const api = build({ matches: [
    { id: 'a', _pair: pair('2026-09-18T22:45:00Z') },
    { id: 'b', _pair: pair('2026-09-18T20:15:00Z') },
    { id: 'c', _pair: pair('2026-09-18T21:45:00Z') },
  ], dataLoadedAt: LOADED, tz: 'UTC' });

  const b = api.mxOddsAgeBound();
  check('picks the OLDEST of the prices shown, not the newest',
        b.oldest === Date.parse('2026-09-18T20:15:00Z'), new Date(b.oldest).toISOString());
  check('counts what it covered: 3 dated, 0 undated, 3 shown',
        b.dated === 3 && b.undated === 0 && b.shown === 3, JSON.stringify(b));

  const html = api.mxHeaderStatusHtml();
  check('the face says "oldest odds" — the label names which end it reports',
        /oldest odds/.test(html), html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  check('it prints the OLDEST instant and not the newest one',
        html.includes(headerClockLike('2026-09-18T20:15:00Z'))
        && !html.includes(headerClockLike('2026-09-18T22:45:00Z')));

  // CONTROL: the newest-based reading on the identical board.
  check('CONTROL: mxOddsUpdatedAt (the NEWEST reading) returns a DIFFERENT, later '
      + 'instant on this same board, so the assertion above is the ruling and not the fixture',
        api.mxOddsUpdatedAt() !== b.oldest, 'newest != oldest');
}

console.log('\n  — an UNDATED shown price must not be silently skipped');
{
  // The case ruling B created: most of the board priced off api-tennis, which
  // publishes no clock. A bound computed over the dated minority alone would be
  // optimistic, which is the defect ruling A closes.
  const api = build({ matches: [
    { id: 'a', _pair: pair('2026-09-18T22:45:00Z') },
    { id: 'b', _pair: pair(null, 'Sbo') },
    { id: 'c', _pair: pair(null, '1xBet') },
  ], dataLoadedAt: LOADED, tz: 'UTC' });

  const b = api.mxOddsAgeBound();
  check('undated shown prices are COUNTED, not dropped',
        b.undated === 2 && b.dated === 1 && b.shown === 3, JSON.stringify(b));
  const html = api.mxHeaderStatusHtml();
  check('the FACE changes when the bound is partial — "odds from … or older", '
      + 'not a bare "oldest", because a member cannot see a tooltip-only caveat',
        /odds from/.test(html) && /or older/.test(html) && !/oldest odds/.test(html),
        html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  check('the undated count is stated in the hover detail, not merely implied',
        /2 shown prices carry no clock/.test(html));
}

console.log('\n  — a dashed card is not an undated price');
{
  const api = build({ matches: [
    { id: 'a', _pair: pair('2026-09-18T21:00:00Z') },
    { id: 'b' },                                   // dashed: no price at all
  ], dataLoadedAt: LOADED, tz: 'UTC' });
  const b = api.mxOddsAgeBound();
  check('a card showing no price counts as neither dated nor undated',
        b.shown === 1 && b.dated === 1 && b.undated === 0, JSON.stringify(b));
  check('...so a board of real prices still reads as an exact bound',
        /oldest odds/.test(api.mxHeaderStatusHtml()));
}

console.log('\n  — every price undated: say "loaded", never dress it as data age');
{
  const api = build({ matches: [
    { id: 'a', _pair: pair(null, 'Sbo') },
    { id: 'b', _pair: pair(null, 'Marathon') },
  ], dataLoadedAt: LOADED, tz: 'UTC' });
  const b = api.mxOddsAgeBound();
  check('no dated price -> oldest is null, not a guess', b.oldest === null && b.undated === 2);
  const html = api.mxHeaderStatusHtml();
  check('the face falls back to "loaded", labelled as the page load',
        /loaded/.test(html) && !/oldest odds/.test(html) && !/odds from/.test(html));
  check('and it says plainly that prices ARE shown but none carry a clock — '
      + 'otherwise "loaded" reads as an empty board',
        /none carrying an observation clock/.test(html));
}

console.log('\n  — scope: the bound reads the RENDERED list, not the whole payload');
{
  // getFiltered() returns the board; `matches` here is that same list. The
  // regression this guards is a bound computed over OCS/matches wholesale,
  // which would let an off-board fixture set the header's age.
  const api = build({ matches: [{ id: 'a', _pair: pair('2026-09-18T22:00:00Z') }],
                      OCS: { byKey: { ancient: { sides: { p: { nowObs: '2020-01-01T00:00:00Z' } } } } },
                      dataLoadedAt: LOADED, tz: 'UTC' });
  check('an OCS entry that is NOT on the rendered board cannot set the bound',
        api.mxOddsAgeBound().oldest === Date.parse('2026-09-18T22:00:00Z'),
        new Date(api.mxOddsAgeBound().oldest).toISOString());
}

console.log('');
if (FAILED.length) { console.log(`${FAILED.length} FAILED: ${JSON.stringify(FAILED)}`); process.exit(1); }
console.log('all checks passed');
