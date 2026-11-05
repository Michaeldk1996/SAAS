#!/usr/bin/env node
// sfDbNoPriceWhy (founder ruling 2026-10-18 item 5): a played match with no price names why, from the master's unpriced
// rows ([date, winner, loser, code]). A start-dated career row (archive, before 2021) is dated at its event's START, so its
// master row sits 0…+16 days AFTER it; a feed row is ±1. The search runs [−1, +16] (fix 2026-11-05: it ran [−16, +1]).
// Real case: Djokovic v Lorenzi, US Open 2012 R128 — career row 2012-08-27, master row 2012-08-29 'one'.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
const grab = sig => { const i = src.indexOf(sig); assert(i >= 0, 'missing ' + sig); let d = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && !--d) break; } return src.slice(i, k + 1); };
const fnSrc = grab('function sfDbNoPriceWhy(');
const ctx = [grab('function fhDayNum('), grab('function fhIsInitial('), grab('function fhNameKey(')].join('\n');
const pick = n => { const i = src.indexOf('  function ' + n + '('); assert(i >= 0, n); return grab('function ' + n + '('); };
const H = new Function(ctx + '\n' + pick('h2hTdKey') + '\n' + pick('h2hTdSame') + '\nreturn { tdKey: h2hTdKey, tdSame: h2hTdSame };')();
const build = body => new Function('window', '_sfDbJoin', 'fhDayNum', ctx + '\n' + body + '\nreturn sfDbNoPriceWhy;');
const U = [[20120829, 'Djokovic N.', 'Lorenzi P.', 'one'], [20190530, 'Djokovic N.', 'Laaksonen H.', 'one'], [20210510, 'Fucsovics M.', 'Nishioka Y.', 'nobook']];
const day = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
const run = body => { const f = build(body)({ H2HPage: H }, { u: U }, day); return (full, v) => f(full, v); };
const why = run(fnSrc);
assert.strictEqual(why('N. Djokovic', { date: '2012-08-27', won: true, opp: 'P. Lorenzi' }), 'one', 'start-dated row finds its master row 2 days later');
assert.strictEqual(why('N. Djokovic', { date: '2019-05-27', won: true, opp: 'H. Laaksonen' }), 'one');
assert.strictEqual(why('M. Fucsovics', { date: '2021-05-10', won: true, opp: 'Y. Nishioka' }), 'nobook', 'a feed row on the day still finds it');
assert.strictEqual(why('Y. Nishioka', { date: '2021-05-10', won: false, opp: 'M. Fucsovics' }), 'nobook', 'the loser side');
assert.strictEqual(why('N. Djokovic', { date: '2012-08-31', won: true, opp: 'P. Lorenzi' }), 'none', 'a master row two days BEFORE is not this match');
assert.strictEqual(why('N. Djokovic', { date: '2012-08-27', won: false, opp: 'P. Lorenzi' }), 'none', 'the winner must agree');
// CONTROL: the pre-fix window misses the start-dated row
const old = run(fnSrc.replace(/for \(let dd = -1; dd <= 16; dd\+\+\)/, 'for (let dd = -16; dd <= 1; dd++)'));
assert.notStrictEqual(fnSrc, fnSrc.replace(/for \(let dd = -1; dd <= 16; dd\+\+\)/, 'x'), 'the window loop is where the test expects it');
assert.strictEqual(old('N. Djokovic', { date: '2012-08-27', won: true, opp: 'P. Lorenzi' }), 'none', 'control: the old window reads no source');
console.log('test-noprice-why: 7 checks + control OK');
