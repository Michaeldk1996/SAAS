// TEN-225 item C — the suspended-market guard.
//
// Founder 2026-09-19, verbatim: "overround > 20%. do NOT dash — fall through
// the ladder to the next book, and dash only if no book has a real price. Log
// every suppression. Apply it on every path that publishes a price, not just
// the card-state one."
//
// That instruction has FOUR separable limbs, and three of them are the kind a
// naive guard gets wrong while still looking correct on a live board:
//
//   1. it suppresses at all                 (easy)
//   2. it FALLS THROUGH rather than dashing (a `return null` passes limb 1 and
//                                            fails this one silently)
//   3. it still dashes when nothing is left (a fallback that invents a price
//                                            passes limb 2 and fails this one)
//   4. it covers EVERY publishing path      (the card path alone passes 1-3)
//
// So every case below manufactures the state. Standing rule N: "a check that
// passes on an empty set is not a check." A test that read today's board would
// go quiet on any day no book happened to be suspended — which is most days,
// which is exactly when the regression would ship.
//
// Functions are SLICED OUT OF THE SHIPPED HTML, not copied, so this file goes
// red if the page changes and it does not.
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
// A const whose value is a multi-line object literal. sliceConst's single-line
// regex cannot see one, and quietly failing to find it would make every
// assertion about that table unrunnable rather than red.
function sliceObj(name) {
  const at = SRC.indexOf(`const ${name} = {`);
  if (at < 0) throw new Error(`const ${name} (object) not found in the shipped HTML`);
  let i = SRC.indexOf('{', at), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (!depth) return SRC.slice(at, j + 1) + ';'; }
  }
  throw new Error(`unbalanced braces in const ${name}`);
}
function sliceConst(name) {
  const re = new RegExp(`^const ${name} = .*?;$`, 'm');
  const hit = SRC.match(re);
  if (!hit) throw new Error(`const ${name} not found in the shipped HTML`);
  return hit[0];
}

const FAILED = [];
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
  if (!cond) FAILED.push(name);
};

// mxJLevel / mxJClose are in the list because _mcCloseOf CALLS them (TEN-225
// item 4). Sliced, never stubbed: a stub would let this file keep passing while
// the shipped scope rule changed under it, and the scope rule is the ruling.
const FNS = ['_ocsSanePx', 'mxOverround', 'mxIsSuspendedPair', 'mxRealPair',
             '_ocsOf', 'ocsKeyOf', 'ocsMatchKey', 'ocsNameKey', 'ocsNfd',
             '_isBet365', '_mcBet365Now',
             '_mcBooksByCoverage', '_mcAnyBookPair', '_mcNowPair',
             '_mcNowSuppressed', 'mxJLevel', 'mxJClose', '_mcCloseOf',
             '_openAnchorOf'];

// Each build gets its OWN sandbox, so MX_SUPPRESSED cannot leak between cases —
// _mcNowSuppressed reads that log, and a shared one would let an earlier case
// decide a later case's fall-through. That would be a test passing on the
// residue of another test, which is worse than no test.
function build({ matches = [], OCS = { byKey: {} } }) {
  const code = `
    ${sliceConst('MX_SUSPENDED_OVERROUND')}
    ${sliceConst('MX_MIN_REAL_PRICE')}
    ${sliceConst('MX_J_LEVELS')}
    const MX_SUPPRESSED = new Map();
    const matches = ${JSON.stringify(matches)};
    const OCS = ${JSON.stringify(OCS)};
    const WARNED = [];
    const console = { warn: (...a) => WARNED.push(a) };
    ${FNS.map(slice).join('\n')}
    return { ${FNS.join(', ')}, MX_SUPPRESSED, WARNED, matches, OCS,
             MX_SUSPENDED_OVERROUND, MX_MIN_REAL_PRICE };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(code)();
}

// A pair whose overround is exactly what the case needs, rather than numbers
// chosen by eye. 1.01/1.01 is the sentinel actually observed on bet365Now.
const SUSPENDED = { p1: 1.01, p2: 1.01 };   // 98.0% overround
const HONEST    = { p1: 2.10, p2: 1.80 };   //  3.2% overround
const WIDE      = { p1: 1.90, p2: 1.90 };   //  5.3% overround

console.log('TEN-225 item C — the suspended-market guard');
console.log('\n  — the arithmetic, and where the line sits');
{
  const api = build({});
  const ov = (a, b) => api.mxOverround(a, b);
  check('1.01/1.01 is a 98% overround, not a 50/50 market',
        Math.abs(ov(1.01, 1.01) - 0.9802) < 1e-3, (ov(1.01, 1.01) * 100).toFixed(1) + '%');
  check('the threshold is the ruled 20%, read from the shipped constant',
        api.MX_SUSPENDED_OVERROUND === 0.20, String(api.MX_SUSPENDED_OVERROUND));
  check('the SOFTEST book we actually carry (Sbo, median 11.6%) is NOT suppressed — '
      + 'this is a suspension detector, not a margin referee',
        !api.mxIsSuspendedPair(1.80, 1.80), (ov(1.80, 1.80) * 100).toFixed(1) + '%');
  check('the impossible-leg floor is the ruled 1.01, read from the shipped constant',
        api.MX_MIN_REAL_PRICE === 1.01, String(api.MX_MIN_REAL_PRICE));
  // SUPERSEDED, DELIBERATELY REWRITTEN RATHER THAN DELETED. This used to assert
  // that 1.01 against a 15.0 dog STAYS a price — my reading on 2026-09-18. The
  // founder reversed it on 2026-09-19 ("extend it to catch any leg at or below
  // 1.01"), after bet365's 1.004/17.00 on Dougaz v Murtaza rendered as "1.00"
  // with an overround of 5.5% — ordinary pair, impossible leg. The assertion
  // keeps its job: it still pins WHERE the line is, on the same numbers.
  check('an impossible LEG is now caught even inside an ordinary pair — 1.004/17.00 '
      + 'is a 5.5% overround and was the defect the pair rule could not see',
        api.mxIsSuspendedPair(1.004, 17.0), (ov(1.004, 17.0) * 100).toFixed(1) + '%');
  check('...and the boundary holds: 1.02 against 10.5 is untouched',
        !api.mxIsSuspendedPair(1.02, 10.5), (ov(1.02, 10.5) * 100).toFixed(1) + '%');
  check('a missing price is ABSENCE, not suspension — otherwise every unpriced '
      + 'fixture becomes a logged suppression',
        ov(null, 2.0) === null && !api.mxIsSuspendedPair(null, 2.0));
  check('zero is not a price either', ov(0, 2.0) === null);
  // The boundary, from both sides, because "> 20%" and ">= 20%" differ by
  // exactly the cases a threshold test exists to pin down.
  check('exactly 20.0% is NOT suppressed — the rule is "> 20"',
        !api.mxIsSuspendedPair(1 / 0.6, 1 / 0.6), (ov(1/0.6, 1/0.6) * 100).toFixed(2) + '%');
  check('20.1% IS suppressed', api.mxIsSuspendedPair(1 / 0.6005, 1 / 0.6005));
}

console.log('\n  — LIMB 2: it falls through the ladder, it does NOT dash');
{
  // bet365Now is suspended; another book (Sbo) prices the fixture normally.
  // The pre-guard board showed 1.01/1.01. A naive guard shows a dash. The
  // ruling says: show Sbo.
  const api = build({ matches: [{
    id: 'm1',
    bet365Now: { ...SUSPENDED, at: '2026-09-19T00:00:00Z', observedAt: '2026-09-19T00:05:00Z' },
    odds: { ...HONEST, bookmaker: 'Sbo', seenAt: '2026-09-19T00:05:00Z' },
  }] });
  const pair = api._mcNowPair(api.matches[0]);
  check('the card is still PRICED — a dash here would be the founder\'s stated defect',
        !!pair, pair ? `${pair.book} ${pair.p1}/${pair.p2}` : 'DASH');
  check('...and the price shown is the NEXT BOOK\'s, not the sentinel',
        pair && pair.book === 'Sbo' && pair.p1 === HONEST.p1);
  check('the suppression was LOGGED, naming fixture, book, path and overround',
        api.MX_SUPPRESSED.size === 1
        && [...api.MX_SUPPRESSED.values()][0].id === 'm1'
        && [...api.MX_SUPPRESSED.values()][0].book === 'bet365'
        && [...api.MX_SUPPRESSED.values()][0].overroundPct === 98.0,
        JSON.stringify([...api.MX_SUPPRESSED.values()][0]));
  check('...and it reached the console too, not only an in-memory map nobody reads',
        api.WARNED.length === 1, JSON.stringify(api.WARNED[0] && api.WARNED[0][0]));
}

console.log('\n  — the fall-through walks PAST a second suspended book, not just one');
{
  // Two suspended rungs then an honest one. A guard that only checked the
  // top-ranked candidate would stop on the second sentinel and dash.
  const api = build({ matches: [
    { id: 'm1',
      bestOdds: { p1: { price: SUSPENDED.p1, bookmaker: 'Marathon' },
                  p2: { price: SUSPENDED.p2, bookmaker: 'Marathon' } },
      odds: { ...HONEST, bookmaker: '1xBet' } },
    // Padding so coverage ranks Marathon above 1xBet and the suspended book is
    // genuinely FIRST in the ladder — otherwise the sort would do the work and
    // the assertion would prove nothing.
    { id: 'p1', bestOdds: { p1: { price: 2.0, bookmaker: 'Marathon' },
                            p2: { price: 1.9, bookmaker: 'Marathon' } } },
    { id: 'p2', bestOdds: { p1: { price: 2.0, bookmaker: 'Marathon' },
                            p2: { price: 1.9, bookmaker: 'Marathon' } } },
  ] });
  const cov = api._mcBooksByCoverage();
  check('fixture setup check: the SUSPENDED book outranks the honest one on coverage, '
      + 'so the ladder really is being walked and not merely sorted',
        (cov['Marathon'] || 0) > (cov['1xBet'] || 0), JSON.stringify(cov));
  const pair = api._mcAnyBookPair(api.matches[0]);
  check('the second rung is taken', pair && pair.book === '1xBet',
        pair ? pair.book : 'DASH');
}

console.log('\n  — the fall-through also runs WITHIN bet365\'s own three sources');
{
  // The gap a mutation run found in this file: every other case gives bet365 a
  // single suspended source, so "_mcBet365Now returns null" and "_mcBet365Now
  // tries its next source" are indistinguishable — the card gets priced either
  // way, by _mcAnyBookPair. They are NOT the same thing. bet365 is the top of
  // the ladder; if its own honest quote is skipped because a DIFFERENT bet365
  // source was suspended, the card silently drops to a lower-ranked book.
  //
  // So: bet365Now suspended, bet365's OWN bestOdds honest, and a rival book
  // present to make the wrong answer visible rather than a dash.
  //
  // ⚠️ THE RIVAL MUST OUTRANK BET365 ON COVERAGE, and this took two attempts to
  // get right. _mcAnyBookPair ALSO reads bestOdds and m.odds, so on a board
  // where bet365 ranks top it recovers the very same bet365 quote and the
  // correct build and the broken one return an identical answer — the
  // assertion passed while proving nothing. Padding Sbo to a higher coverage
  // rank is what makes the two builds diverge: correct -> bet365, broken -> Sbo.
  const pad = n => Array.from({ length: n }, (_, i) =>
    ({ id: 'pad' + i, odds: { ...WIDE, bookmaker: 'Sbo' } }));
  const api = build({ matches: [{
    id: 'm1',
    bet365Now: { ...SUSPENDED, at: null, observedAt: null },
    bestOdds: { p1: { price: HONEST.p1, bookmaker: 'bet365' },
                p2: { price: HONEST.p2, bookmaker: 'bet365' },
                seenAt: '2026-09-19T00:05:00Z' },
    odds: { ...WIDE, bookmaker: 'Sbo' },
  }, ...pad(4)] });
  const cov = api._mcBooksByCoverage();
  check('setup check: Sbo outranks bet365 on coverage, so a skipped bet365 would '
      + 'visibly fall to Sbo instead of quietly returning the same price',
        (cov['Sbo'] || 0) > (cov['bet365'] || 0), JSON.stringify(cov));
  const pair = api._mcNowPair(api.matches[0]);
  check('bet365 keeps the card on its OWN next source, rather than being skipped '
      + 'down the ladder because one of its sources was suspended',
        pair && pair.book === 'bet365' && pair.p1 === HONEST.p1,
        pair ? `${pair.book} ${pair.p1}/${pair.p2}` : 'DASH');
  check('...and the rival book was NOT used, which is what distinguishes this from '
      + 'a guard that merely returns null and lets the ladder paper over it',
        pair && pair.book !== 'Sbo');
  check('the suppressed source is still named exactly, as bet365Now',
        [...api.MX_SUPPRESSED.values()].map(r => r.path).join(',') === 'bet365Now',
        [...api.MX_SUPPRESSED.values()].map(r => r.path).join(','));
}

console.log('\n  — LIMB 3: when NO book has a real price, it DOES dash');
{
  const api = build({ matches: [{
    id: 'm1',
    bet365Now: { ...SUSPENDED, at: null, observedAt: null },
    odds: { ...SUSPENDED, bookmaker: 'Sbo' },
  }] });
  const pair = api._mcNowPair(api.matches[0]);
  check('every book suspended -> dash, which is the one case a dash is correct',
        pair === null, pair ? JSON.stringify(pair) : 'DASH');
  check('and BOTH suppressions are logged, not just the first',
        api.MX_SUPPRESSED.size === 2, String(api.MX_SUPPRESSED.size));
}

console.log('\n  — an honest board is left completely alone');
{
  // The control that matters most in production: the guard must be invisible on
  // every normal fixture. A guard that quietly costs prices is worse than the
  // sentinel it removes, because the loss is spread over the whole board.
  const api = build({ matches: [
    { id: 'a', bet365Now: { ...HONEST, at: null, observedAt: null } },
    { id: 'b', odds: { ...WIDE, bookmaker: 'Sbo' } },
    // Was 1.01/15.0 — a leg the founder's 2026-09-19 rule now suppresses, so it
    // is no longer an "honest board" fixture. Replaced by 1.02/10.5, which is a
    // real short-priced favourite measured on the deployed board and which the
    // floor deliberately leaves alone: the point of this block is that the guard
    // is INVISIBLE on normal pricing, and a short price is normal.
    { id: 'c', bet365Now: { p1: 1.02, p2: 10.5, at: null, observedAt: null } },
  ] });
  const got = api.matches.map(m => api._mcNowPair(m));
  check('all three honest fixtures still price', got.every(p => p && p.p1 > 0),
        got.map(p => p ? `${p.book} ${p.p1}/${p.p2}` : 'DASH').join(' | '));
  check('nothing was suppressed and nothing was logged',
        api.MX_SUPPRESSED.size === 0 && api.WARNED.length === 0);
}

console.log('\n  — LIMB 4: EVERY publishing path, not just the card-state one');
{
  // The founder named this limb specifically. Each path below reaches a rendered
  // cell by a different route, and the card-state guard sees none of them.
  // The fixture has to key the way the PAGE keys, so the key and the side names
  // are computed with the real sliced functions rather than guessed. A guessed
  // key would miss, _ocsOf would return null, and every assertion below would
  // pass vacuously on a fixture the guard never saw.
  const keyer = build({});
  const m = { id: 'm1', date: '2026-09-19', p1: 'Alice Smith', p2: 'Bob Jones' };
  const k = keyer.ocsKeyOf(m);
  const n1 = keyer.ocsNameKey(m.p1), n2 = keyer.ocsNameKey(m.p2);
  if (!k || !n1 || !n2) throw new Error('could not build an OCS key with the page functions');
  // gen MUST be set. _ocsOf caches on `m.__ocsGen === OCS.gen`, and with both
  // undefined that test is TRUE on the first call — the resolver returns its
  // empty cache and never looks at byKey at all. A fixture without gen makes
  // every OCS assertion below pass on a null, which is why the setup check
  // above exists and is what caught this.
  const ocs = { gen: 1, byKey: { [k]: { book: 'sports411', source: 'kibl', sides: {
    [n1]: { open: SUSPENDED.p1, now: SUSPENDED.p1, close: HONEST.p1 },
    [n2]: { open: SUSPENDED.p2, now: SUSPENDED.p2, close: HONEST.p2 },
  } } } };
  const api2 = build({ matches: [m], OCS: ocs });
  const o = api2._ocsOf(api2.matches[0]);
  check('setup check: the fixture actually RESOLVES through OCS — without this '
      + 'every assertion below would pass on a null and prove nothing',
        !!o, o ? `book=${o.book}` : 'OCS DID NOT RESOLVE');
  if (o) {
    check('ocs.open  — the suspended OPEN is withheld',  o.p1.open === null && o.p2.open === null);
    check('ocs.now   — the suspended NOW is withheld',   o.p1.now === null && o.p2.now === null);
    check('ocs.close — the HONEST close in the same entry SURVIVES: the guard is '
        + 'per slot, so one bad slot does not throw away two good prices',
          o.p1.close === HONEST.p1 && o.p2.close === HONEST.p2,
          `${o.p1.close}/${o.p2.close}`);
    check('both OCS suppressions are logged with their slot named in the path',
          [...api2.MX_SUPPRESSED.values()].map(r => r.path).sort().join(',') === 'ocs.now,ocs.open',
          [...api2.MX_SUPPRESSED.values()].map(r => r.path).join(','));
  }
}
{
  // The two matches.json fallbacks. These never pass through _ocsOf, so the
  // card-state guard cannot see them — this is the limb-4 gap in literal form.
  const api = build({ matches: [{ id: 'm1',
    openingOdds: { ...SUSPENDED, bookmaker: 'bet365' },
    closingOdds: { ...SUSPENDED, bookmaker: 'bet365' } }] });
  const m = api.matches[0];
  check('openingOdds — the suspended OPEN fallback is withheld, both legs together',
        api._openAnchorOf(m, 'p1') === null && api._openAnchorOf(m, 'p2') === null);
  check('closingOdds — the suspended CLOSE fallback is withheld; a bad close would '
      + 'propagate into every drift and settled-P&L figure, not just render once',
        api._mcCloseOf(m, 'p1') === null && api._mcCloseOf(m, 'p2') === null);
  check('both fallback paths are named distinctly in the log',
        [...api.MX_SUPPRESSED.values()].map(r => r.path).sort().join(',')
          === 'closingOdds,openingOdds',
        [...api.MX_SUPPRESSED.values()].map(r => r.path).join(','));
}
{
  const api = build({ matches: [{ id: 'm1',
    openingOdds: { ...HONEST, bookmaker: 'bet365' },
    closingOdds: { ...HONEST, bookmaker: 'bet365' } }] });
  const m = api.matches[0];
  check('CONTROL: honest open/close fallbacks pass through untouched, so the two '
      + 'assertions above are the guard firing and not the resolver returning null',
        api._openAnchorOf(m, 'p1') === HONEST.p1 && api._mcCloseOf(m, 'p2') === HONEST.p2,
        `${api._openAnchorOf(m, 'p1')} / ${api._mcCloseOf(m, 'p2')}`);
}

console.log('\n  — the log is a record, not a per-repaint stream');
{
  const api = build({ matches: [{ id: 'm1',
    bet365Now: { ...SUSPENDED, at: null, observedAt: null } }] });
  for (let i = 0; i < 25; i++) api._mcNowPair(api.matches[0]);
  check('25 repaints of the same suspended fixture log ONE entry, not 25 — the page '
      + 're-renders on every filter change and an unbounded log is a leak',
        api.MX_SUPPRESSED.size === 1 && api.WARNED.length === 1,
        `entries=${api.MX_SUPPRESSED.size} warns=${api.WARNED.length}`);
}

// ===========================================================================
// TEN-225 item G1 — VENDOR-CONFIRMED BOOK LABELS
// Founder 2026-09-19: "relabel Sbo -> SBOBET, Pncl -> Pinnacle, Victor Chandler
// -> BetVictor. Vendor-confirmed, stop inferring."
// ===========================================================================
console.log('\nTEN-225 item G1 — vendor-confirmed book labels');
{
  const api = (() => {
    const code = `
      ${sliceObj('MX_BOOK_LABELS')}
      ${slice('mxBookLabel')}
      return { mxBookLabel, MX_BOOK_LABELS };`;
    // eslint-disable-next-line no-new-func
    return new Function(code)();
  })();

  check('Sbo renders as SBOBET', api.mxBookLabel('Sbo') === 'SBOBET');
  check('Pncl renders as Pinnacle', api.mxBookLabel('Pncl') === 'Pinnacle');
  check('Victor Chandler renders as BetVictor',
        api.mxBookLabel('Victor Chandler') === 'BetVictor');
  // Casing and spacing are the vendor's to change, not ours to depend on. A
  // literal-match table would relabel one spelling and silently miss the others,
  // which is how "WilliamHill" was reported as an absent book earlier today.
  check('the mapping is casing- and spacing-insensitive, so a vendor respelling '
      + 'cannot silently un-relabel a book',
        ['victor chandler', 'VICTORCHANDLER', 'VictorChandler', 'victor-chandler']
          .every(v => api.mxBookLabel(v) === 'BetVictor'));
  check('SBO in any casing still resolves',
        api.mxBookLabel('SBO') === 'SBOBET' && api.mxBookLabel('sbo') === 'SBOBET');

  // The books that must pass through untouched. A relabel map that rewrote an
  // unrelated book would be a false label, which is the defect class this whole
  // issue keeps paying for.
  check('every other book is returned VERBATIM — the map relabels three books, '
      + 'not "book names in general"',
        ['bet365', '1xBet', 'Betano', 'Betfair', 'Marathon', 'WilliamHill',
         'sports411'].every(b => api.mxBookLabel(b) === b));
  check('exactly THREE entries in the map, so a fourth cannot be added without '
      + 'this assertion being revisited',
        Object.keys(api.MX_BOOK_LABELS).length === 3,
        JSON.stringify(Object.keys(api.MX_BOOK_LABELS)));
  check('null / empty is passed through rather than becoming a label',
        api.mxBookLabel(null) === null && api.mxBookLabel('') === '');

  // WHERE it is applied, and where it deliberately is NOT.
  check('the hover title relabels the book it names',
        SRC.includes("[mxBookLabel(pair.book), priceTxt]"));
  check('the Open provenance line relabels too',
        SRC.includes('const book = mxBookLabel(ocsBookOf(m)), ts ='));
  check('the Biggest-market-move tile relabels BEFORE the bet365 title-case, so '
      + 'the special case sees the expanded name',
        SRC.includes('const named = mxBookLabel(book);')
        && SRC.includes("named.toLowerCase() === 'bet365'"));

  // ⚠️ The ruling this test exists to protect: DISPLAY only.
  check('_isBet365 does NOT go through the label map — it is an identity test '
      + 'that gates cross-book blending, and routing it through a display '
      + 'relabel would let a rename change which prices may be paired',
        /function _isBet365\(name\)\{[^}]*toLowerCase\(\) === 'bet365'/.test(
          SRC.replace(/\s+/g, ' ').replace(/function _isBet365\(name\) \{/, 'function _isBet365(name){'))
        || SRC.includes("function _isBet365(name){ return String(name || '').toLowerCase() === 'bet365'; }"));
  check('the map is not applied at capture: the pipeline still stores the '
      + 'vendor\'s own string, so a stored row remains traceable to the feed',
        !fs.readFileSync(new URL('./bsp-pipeline.js', import.meta.url), 'utf8')
           .includes('mxBookLabel'));
}

console.log('');
if (FAILED.length) {
  console.log(`${FAILED.length} FAILED: ${JSON.stringify(FAILED)}`);
  process.exit(1);
}
console.log('all checks passed');
