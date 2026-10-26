// Brief 2026-10-26 item 5 — the card-state date join (ocsKeyNear): a board card finds its card-state row when the row's
// date key is a day off (a file published against an earlier board), never two rows, never a guess.
//   exact key wins                                          (mutant NEAR_FIRST: the ±1-day row checked before the exact key)
//   a row a day either side is found when the exact key misses (mutant EXACT_ONLY: the old join)
//   two rows a day either side = no row                      (mutant FIRST_NEAR: the first of two taken)
//   two days off = no row                                    (mutant WIDE: ±2 days)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.OKN_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
function slice(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
const make = byKey => new Function('OCS', `${['ocsNfd', 'ocsNameKey', 'ocsMatchKey', 'ocsKeyOf', 'ocsKeyNear'].map(slice).join('\n')}
  return { ocsKeyNear, ocsKeyOf };`)({ byKey });
const card = { date: '2026-10-26', p1: 'H. Rune', p2: 'Q. Halys' };

test('the card-state date join tolerates one day, never two rows, never a guess', () => {
  assert.equal(make({ '2026-10-26|halys|rune': {} }).ocsKeyNear(card), '2026-10-26|halys|rune', 'exact key');
  assert.equal(make({ '2026-10-27|halys|rune': {} }).ocsKeyNear(card), '2026-10-27|halys|rune', 'Rune v Halys: the 27 Oct row joins the 26 Oct card');
  assert.equal(make({ '2026-10-25|halys|rune': {} }).ocsKeyNear(card), '2026-10-25|halys|rune', 'and a day back (Altmaier v Cerundolo)');
  assert.equal(make({ '2026-10-26|halys|rune': {}, '2026-10-27|halys|rune': {} }).ocsKeyNear(card), '2026-10-26|halys|rune', 'the exact key wins over a neighbour');
  assert.equal(make({ '2026-10-25|halys|rune': {}, '2026-10-27|halys|rune': {} }).ocsKeyNear(card), null, 'two neighbours: no row');
  assert.equal(make({ '2026-10-28|halys|rune': {} }).ocsKeyNear(card), null, 'two days off: no row');
  assert.equal(make({ '2026-10-27|halys|zverev': {} }).ocsKeyNear(card), null, 'another pair: no row');
  assert.equal(make({}).ocsKeyNear({ date: '2026-10-26', p1: 'A. Smith', p2: 'B. Smith' }), null, 'a pair with one surname has no key');
});
