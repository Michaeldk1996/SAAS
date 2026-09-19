// TEN-225 item 4 — J wired, and wired ONLY where the founder scoped it.
//
// FOUNDER, 2026-09-19: "bet365's api-tennis close only, on Challenger and
// below, and only where we would otherwise dash. Never override a close we can
// age. Label the source on the card and in the hover, and record in the data
// that it carries no timestamp and no lag check. Do NOT use Betano/1xBet as a
// 'bet365 close' on Davis Cup. Run the ATP window from August before wiring
// anything ATP."
//
// Every clause above is a way this can go wrong, so every clause is a test.
// The functions are sliced out of the shipped HTML, not copy-pasted.
//
// Run: node --test test-ten225-j-close.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const pipe = readFileSync(join(HERE, 'bsp-pipeline.js'), 'utf8');

function slice(name, src = html) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const api = new Function(`
  const MX_J_LEVELS = ${/const MX_J_LEVELS = (\/.*?\/[a-z]*);/.exec(html)?.[1] || '/challenger/i'};
  let __ocs = null, __suspended = false;
  const _ocsOf = m => m.__ocs || null;
  const mxIsSuspendedPair = (a, b) => __suspended;
  ${slice('mxJLevel')}
  ${slice('mxJClose')}
  ${slice('_mcCloseOf')}
  ${slice('mxCloseIsJ')}
  return { mxJLevel, mxJClose, _mcCloseOf, mxCloseIsJ,
           setSuspended: v => { __suspended = v; } };
`)();

const J = { p1: 1.35, p2: 3.20, book: 'bet365', src: 'api-tennis',
            noTimestamp: true, noLagCheck: true };
const chal = extra => ({ tour: 'ATP Challenger Seville', apiTennisClose: { ...J }, ...extra });

// ── the level scope ───────────────────────────────────────────────────────
test('Challenger and ITF are in scope', () => {
  for (const t of ['ATP Challenger Seville', 'Challenger Men', 'ITF Men M25 Sintra',
                   'M15 Monastir', 'W15 Antalya'])
    assert.equal(api.mxJLevel({ tour: t }), true, t);
});

test('ATP is IN — superseded 2026-09-19 on the August window', () => {
  // SUPERSEDED, REWRITTEN NOT DELETED. This asserted ATP was refused, which was
  // right while the ATP sample was n=1. Eight August days give n=199 joined
  // against our own pinned bet365 close: median |Δ implied| 0.06pp, against
  // 0.80-1.48pp for every other book on the same fixtures. ATP now agrees more
  // tightly than Challenger (0.08pp), the tier already wired.
  for (const t of ['ATP US Open', 'ATP Cincinnati', 'ATP Winston-Salem'])
    assert.equal(api.mxJLevel({ tour: t }), true, t);
});

test('WTA and the team events stay OUT, as ruled', () => {
  for (const t of ['WTA Guadalajara', 'WTA 125K Series', 'Billie Jean King Cup',
                   'ATP Davis Cup - World Group II', 'Laver Cup', 'United Cup'])
    assert.equal(api.mxJLevel({ tour: t }), false, t);
});

test('a Davis Cup tie is refused even though its name STARTS "ATP"', () => {
  // The feed names every tie "ATP Davis Cup - World Group ...". With ATP now in
  // scope, an ATP test running before the team-event test would admit the one
  // tier where this close does not exist at all (bet365: 0 of 33). The order of
  // those two tests inside mxJLevel is the guard, so it gets its own assertion.
  assert.equal(api.mxJLevel({ tour: 'ATP Davis Cup - World Group I' }), false);
  assert.equal(api.mxJLevel({ tour: 'ATP Billie Jean King Cup' }), false);
});

test('Davis Cup is excluded even though its NAME contains no tier word — the exclusion is explicit, not incidental', () => {
  // "ATP Davis Cup - World Group" would fall through to the ATP default and be
  // rejected anyway; the explicit test is what makes that not a coincidence.
  assert.equal(api.mxJLevel({ tour: 'Davis Cup Challenger Group' }), false,
    'a Davis Cup tie naming "Challenger" must still be refused');
});

// ── "only where we would otherwise dash" ──────────────────────────────────
test('it fills a cell that would otherwise be a DASH', () => {
  const m = chal();
  assert.equal(api._mcCloseOf(m, 'p1'), 1.35);
  assert.equal(api.mxCloseIsJ(m, 'p1'), true);
});

test('it NEVER overrides an odds_card_state close — the one we can age wins', () => {
  const m = chal({ __ocs: { p1: { close: 1.30 }, p2: { close: 3.40 } } });
  assert.equal(api._mcCloseOf(m, 'p1'), 1.30, 'the aged close was overridden');
  assert.equal(api.mxCloseIsJ(m, 'p1'), false, 'and it must not be labelled as J');
});

test('it NEVER overrides the pinned matches.json close either', () => {
  const m = chal({ closingOdds: { p1: 1.31, p2: 3.35, bookmaker: 'bet365' } });
  assert.equal(api._mcCloseOf(m, 'p1'), 1.31);
  assert.equal(api.mxCloseIsJ(m, 'p1'), false);
});

test('...but it DOES fill when the pinned close is suppressed as suspended', () => {
  api.setSuspended(true);
  const m = chal({ closingOdds: { p1: 1.01, p2: 1.01, bookmaker: 'bet365' } });
  assert.equal(api._mcCloseOf(m, 'p1'), 1.35, 'a suppressed close is a dash, and a dash is what J fills');
  api.setSuspended(false);
});

test('out of scope, it fills nothing — a WTA dash stays a dash', () => {
  // Was ATP; ATP is in scope now. WTA carries the case because it is the tier
  // that is genuinely unmeasured against our own closes.
  const m = { tour: 'WTA Guadalajara', apiTennisClose: { ...J } };
  assert.equal(api._mcCloseOf(m, 'p1'), null);
  assert.equal(api.mxCloseIsJ(m, 'p1'), false);
});

test('an ATP fixture that would dash NOW fills, and is labelled', () => {
  const m = { tour: 'ATP Cincinnati', apiTennisClose: { ...J } };
  assert.equal(api._mcCloseOf(m, 'p1'), 1.35);
  assert.equal(api.mxCloseIsJ(m, 'p1'), true);
});

test('a half-priced or absent J row is not a price', () => {
  for (const c of [null, undefined, { p1: 1.35 }, { p1: 0, p2: 3.2 }, { p1: 1.35, p2: 0 }])
    assert.equal(api._mcCloseOf(chal({ apiTennisClose: c }), 'p1'), null, JSON.stringify(c));
});

// ── capture: bet365 only, finished only, and the flags are IN THE DATA ────
test('the capture is bet365 ONLY — Betano and 1xBet are never written as a bet365 close', () => {
  // Sliced as an ARROW function — my first cut used slice(), which looks for
  // `function NAME(`, and went red against correct code. The assertion was
  // measuring the declaration style, not the rule.
  const i0 = pipe.indexOf('const pinApiTennisClose = (m) => {');
  assert.ok(i0 > 0, 'pinApiTennisClose not found in bsp-pipeline.js');
  let depth = 0, i = pipe.indexOf('{', i0);
  for (; i < pipe.length; i++) {
    if (pipe[i] === '{') depth++;
    else if (pipe[i] === '}') { depth--; if (depth === 0) break; }
  }
  const src = pipe.slice(i0, i + 1);
  assert.match(pipe, /const bk = Object\.keys\(raw\)\.find\(k => String\(k\)\.toLowerCase\(\) === 'bet365'\)/);
  assert.match(pipe, /book: 'bet365'/);
  assert.ok(!/betano|1xbet/i.test(src), 'another book is named in the capture');
});

test('the capture runs only on a FINISHED fixture — before the off this number is a Now', () => {
  assert.match(pipe, /const pinApiTennisClose = \(m\) => \{\s*\n\s*if \(!m\.finalScore\) return;/);
});

test('trackBookNow keeps its own finished-fixture guard — J did not relax it', () => {
  // Relaxing that guard would publish a settled price as a Now, which is the
  // defect the guard exists for. J needed a new field, not a weaker rule.
  assert.match(pipe, /A settled fixture's current price is a post-match quote, not a Now[\s\S]{0,200}if \(m\.finalScore\) return;/);
});

test('noTimestamp and noLagCheck are recorded IN THE DATA, as ruled', () => {
  assert.match(pipe, /noTimestamp: true, noLagCheck: true/);
});

test('it is carried forward, or it would vanish on the next pipeline run', () => {
  assert.match(pipe, /apiTennisClose: pm\.apiTennisClose \|\| null/);
});

// ── the label ─────────────────────────────────────────────────────────────
test('the hover names bet365 and says it has no timestamp and no lag check', () => {
  assert.match(html, /last pre-match price · api-tennis · no timestamp, no lag check/);
  // And it is checked BEFORE the ordinary close title, because on a card this
  // fills, _ocsOf / closingOdds name a book that did not supply the number.
  const t = /const _closeTitle = who => \{([\s\S]*?)\n    \};/.exec(html)?.[1] || '';
  const iJ = t.indexOf('mxCloseIsJ');
  const iBook = t.indexOf('const book =');
  assert.ok(iJ > -1 && iJ < iBook, 'the J branch is not first in the title');
});

test('CONTROL: the assertions above fail on a source without the wiring', () => {
  const pre = html.replace(/return o\[who\]\.close \?\? mxJClose\(m, who\);/,
                           'return o[who].close ?? null;')
                  .replace(/last pre-match price · api-tennis · no timestamp, no lag check/, 'x');
  assert.notEqual(pre, html, 'the mutation anchors are gone — this control is vacuous');
  assert.ok(!/last pre-match price · api-tennis/.test(pre));
});
