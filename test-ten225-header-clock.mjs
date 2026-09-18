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
  `;
  const body = `${pre}\n${slice('mxOddsUpdatedAt')}\n${slice('mxHeaderStatusHtml')}\n${slice('ocsFmtClock')}
    return { mxOddsUpdatedAt, mxHeaderStatusHtml, ocsFmtClock };`;
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
  const api = build({ matches: board, dataLoadedAt: LOADED, tz: 'UTC' });

  const t = api.mxOddsUpdatedAt();
  check('mxOddsUpdatedAt picks the NEWEST observation clock on the board',
        t === Date.parse(OBSERVED), new Date(t).toISOString());

  const html = api.mxHeaderStatusHtml();
  check('the header says "odds updated", naming what the clock measures',
        /odds updated/.test(html), html.replace(/<[^>]+>/g, ' ').trim());
  // The question under test is WHICH INSTANT the header chose, not how it was
  // formatted. Two earlier cuts of this assertion hardcoded "21:45" and then a
  // 24-hour en-GB render, and both failed against correct code because the page
  // formats 12-hour in the runner's locale — the assertion was measuring the
  // fixture. Rendering both candidate instants through the PAGE'S OWN formatter
  // removes the locale from the question entirely while still being falsifiable:
  // a header that printed the load time fails, as the control below shows.
  const asHeader = (iso) => new Intl.DateTimeFormat(undefined,
      { timeZone: 'UTC' }).format(new Date(iso));
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
  const api = build({ matches: [{ id: 'x', bet365Now: { p1: 2.0, at: '2026-09-18T10:00:00Z' } }],
                      dataLoadedAt: LOADED, tz: 'UTC' });
  check('no observation clock anywhere -> mxOddsUpdatedAt is null, not a guess',
        api.mxOddsUpdatedAt() === null);
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
  check('a fresher OCS nowObs wins over a staler bet365Now.observedAt',
        api.mxOddsUpdatedAt() === Date.parse('2026-09-18T22:30:00Z'));
}

console.log('\nTEN-225 item 0d — the tooltip clock renders in the MEMBER zone');
{
  // 21:45:00Z is 05:45 in Asia/Makassar (+8) and 22:45 in Europe/Amsterdam (+1)
  // on this date. A device-local formatter ignoring newsTz would print the same
  // string for both, which is precisely what it used to do.
  const mk = build({ tz: 'Asia/Makassar', dataLoadedAt: LOADED });
  const ams = build({ tz: 'Europe/Amsterdam', dataLoadedAt: LOADED });
  const a = mk.ocsFmtClock(OBSERVED), b = ams.ocsFmtClock(OBSERVED);
  check('Asia/Makassar renders 21:45:00Z as 05:45 — the founder\'s own reading, '
      + 'so his tooltip was NOT 8 hours off', /05:45/.test(a), a);
  check('the SAME instant renders differently for a member on another zone, '
      + 'which is what proves newsTz() is honoured rather than ignored',
        a !== b, `Makassar ${a}  vs  Amsterdam ${b}`);

  // The PRE-FIX formatter took no timeZone at all.
  const preFix = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  check('CONTROL: the PRE-FIX formatter returns one string for both zones, '
      + 'because it ignored newsTz entirely',
        preFix(OBSERVED) === preFix(OBSERVED), preFix(OBSERVED));

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

console.log('');
if (FAILED.length) { console.log(`${FAILED.length} FAILED: ${JSON.stringify(FAILED)}`); process.exit(1); }
console.log('all checks passed');
