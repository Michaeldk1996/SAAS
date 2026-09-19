// TEN-225 item 1 — the book ladder is a NAMED ORDER, not coverage.
//
// FOUNDER, 2026-09-19: "1. bet365  2. Superbet  3. Betano  4. Unibet
// 5. William Hill  6. Betfair  7. 1xBet  8. Pinnacle (sharp reference).
// bwin stays out. Kibl/Sports411 stays a source; Bet105 when it appears.
// SBOBET, Marathon, BetVictor only when nothing above has the fixture."
//
// The functions are sliced out of the shipped HTML, not copy-pasted.
//
// Run: node --test test-ten225-book-ladder.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  return html.slice(start, i + 1);
}

function sliceConst(name) {
  const at = html.indexOf(`const ${name} = `);
  assert.ok(at >= 0, `const ${name} not found`);
  let depth = 0;
  for (let i = at; i < html.length; i++) {
    const c = html[i];
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') depth--;
    else if (c === ';' && depth === 0) return html.slice(at, i + 1);
  }
  throw new Error(`const ${name} is not terminated`);
}

const api = new Function(`
  ${sliceConst('MX_BOOK_LADDER')}
  ${sliceConst('MX_BOOK_LAST')}
  ${sliceConst('MX_BOOK_ALIAS')}
  ${slice('mxBookIdent')}
  ${slice('mxBookRank')}
  return { MX_BOOK_LADDER, MX_BOOK_LAST, mxBookIdent, mxBookRank };
`)();

test('the ladder is the founder\'s list, in his order', () => {
  // Pinned as literals, so a reordered constant cannot pass by being read out of
  // the file it reordered.
  assert.deepEqual(api.MX_BOOK_LADDER,
    ['bet365', 'Superbet', 'Betano', 'Unibet', 'William Hill',
     'Betfair', '1xBet', 'Pinnacle']);
});

test('Superbet and Unibet are BACK — the correction of 2026-09-19', () => {
  // They were dropped on a measurement taken inside a feed-wide collapse; over
  // 08-12..09-08 Superbet quotes 96-100% of priced fixtures.
  assert.ok(api.mxBookRank('Superbet') < api.mxBookRank('Betano'));
  assert.ok(api.mxBookRank('Unibet') < api.mxBookRank('William Hill'));
});

test('bwin stays OUT of the ladder', () => {
  // Out of the LADDER, not banned: an unlisted book still beats one ruled last.
  assert.ok(!api.MX_BOOK_LADDER.some(b => api.mxBookIdent(b) === 'bwin'));
  assert.equal(api.mxBookRank('bwin'), 500);
});

test('SBOBET, Marathon and BetVictor rank BELOW every unlisted book', () => {
  // "only when nothing above has the fixture" — below the ladder is not enough,
  // they must also lose to a book nobody has ruled on.
  for (const b of ['SBOBET', 'Marathon', 'BetVictor'])
    assert.ok(api.mxBookRank(b) > api.mxBookRank('SomeBookNobodyRuledOn'), b);
});

test('the whole order, end to end', () => {
  const order = ['bet365', 'Superbet', 'Betano', 'Unibet', 'William Hill',
                 'Betfair', '1xBet', 'Pinnacle', 'bwin', 'SBOBET'];
  const ranks = order.map(api.mxBookRank);
  for (let i = 1; i < ranks.length; i++)
    assert.ok(ranks[i - 1] < ranks[i],
      `${order[i - 1]} (${ranks[i - 1]}) must outrank ${order[i]} (${ranks[i]})`);
});

// ── the identity fold, which is what makes the ladder reach the feed ──────
test('the feed\'s ABBREVIATIONS rank — Sbo is SBOBET, Pncl is Pinnacle', () => {
  // This is the defect the ladder would otherwise have shipped with. api-tennis
  // spells them `Sbo` and `Pncl`; a ladder keyed on the display spelling ranks
  // neither, so Pinnacle would sit in the unlisted middle band at 500 while
  // SBOBET — ruled last — would sit there too, ahead of nothing.
  assert.equal(api.mxBookRank('Pncl'), api.mxBookRank('Pinnacle'));
  assert.equal(api.mxBookRank('Sbo'), api.mxBookRank('SBOBET'));
  assert.equal(api.mxBookRank('Victor Chandler'), api.mxBookRank('BetVictor'));
});

test('spelling is the vendor\'s business — WilliamHill is William Hill', () => {
  // The case that caused book_names.py: a coverage report announced William
  // Hill ABSENT while the feed returned `WilliamHill` on 244 fixtures.
  for (const [a, b] of [['WilliamHill', 'William Hill'],
                        ['WILLIAM HILL', 'William Hill'],
                        ['bet-365', 'bet365'],
                        ['1XBET', '1xBet']])
    assert.equal(api.mxBookRank(a), api.mxBookRank(b), `${a} vs ${b}`);
});

test('nothing is GUESSED — an unknown book is its own identity', () => {
  // Only the three vendor-CONFIRMED abbreviations fold. A new abbreviation must
  // surface as a new book rather than be silently merged into an existing one.
  assert.equal(api.mxBookIdent('Bet105'), 'bet105');
  assert.equal(api.mxBookRank('Bet105'), 500);
  assert.notEqual(api.mxBookIdent('Betf'), api.mxBookIdent('Betfair'));
});

test('an absent book name does not rank at all', () => {
  for (const v of [null, undefined, '', '   ', '!!!'])
    assert.equal(api.mxBookRank(v), 999, JSON.stringify(v));
});

// ── the sort that consumes it ─────────────────────────────────────────────
test('_mcAnyBookPair sorts by RANK first and coverage only inside a rank', () => {
  const src = slice('_mcAnyBookPair');
  assert.match(src, /mxBookRank\(a\.book\) - mxBookRank\(b\.book\)/);
  assert.match(src, /\(cov\[b\.book\] \|\| 0\) - \(cov\[a\.book\] \|\| 0\)/);
  // ...and coverage must not be the FIRST term any more.
  assert.ok(!/cands\.sort\(\(a, b\) => \(cov\[b\.book\]/.test(src),
    'coverage is still the primary sort key');
});

test('the sort, over manufactured candidates — SBOBET no longer wins on volume', () => {
  // The measured board that motivated the ruling: 2026-09-19, SBOBET on 45 of
  // 116 priced fixtures, bet365 on 4. Under the old pure-coverage sort SBOBET
  // won; it is the widest-margin book we have measured (11.61%).
  const { pick } = new Function(`
    ${sliceConst('MX_BOOK_LADDER')}
    ${sliceConst('MX_BOOK_LAST')}
    ${sliceConst('MX_BOOK_ALIAS')}
    ${slice('mxBookIdent')}
    ${slice('mxBookRank')}
    const cov = { Sbo: 45, bet365: 4, Betano: 25, '1xBet': 28, Pncl: 5, Marathon: 6 };
    return { pick: cands => cands.slice().sort((a, b) =>
      (mxBookRank(a.book) - mxBookRank(b.book))
      || ((cov[b.book] || 0) - (cov[a.book] || 0)))[0].book };
  `)();
  assert.equal(pick([{ book: 'Sbo' }, { book: 'bet365' }]), 'bet365',
    'bet365 must beat SBOBET despite 4 vs 45 coverage');
  assert.equal(pick([{ book: 'Sbo' }, { book: 'Betano' }]), 'Betano');
  assert.equal(pick([{ book: 'Sbo' }, { book: 'Pncl' }]), 'Pncl',
    'Pinnacle is on the ladder under its abbreviation and must beat SBOBET');
  assert.equal(pick([{ book: 'Sbo' }, { book: 'Marathon' }]), 'Sbo',
    'inside the ruled-last band, coverage still orders (45 vs 6)');
  assert.equal(pick([{ book: 'Sbo' }, { book: 'Bet105' }]), 'Bet105',
    'an unlisted book beats one ruled last, whatever the coverage');
  assert.equal(pick([{ book: 'Betano' }, { book: '1xBet' }]), 'Betano',
    'inside the ladder the ORDER wins: Betano is 3rd, 1xBet 7th, despite 25 vs 28');
});

test('CONTROL: these assertions fail on the pre-ruling source', () => {
  const pre = html.replace(
    /cands\.sort\(\(a, b\) => \(mxBookRank\(a\.book\) - mxBookRank\(b\.book\)\)[\s\S]*?\);/,
    'cands.sort((a, b) => (cov[b.book] || 0) - (cov[a.book] || 0));');
  assert.notEqual(pre, html, 'the mutation anchor is gone — this control is vacuous');
  assert.ok(!/mxBookRank\(a\.book\) - mxBookRank\(b\.book\)/.test(pre));
});
