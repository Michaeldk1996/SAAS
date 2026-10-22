// The deploy lane's data-commit rule (tools/deploy-lane.mjs isDataCommit) against the shapes the data bots really commit.
// 2026-10-22: a BSP Draws Bot commit (66cbec83, draws.json only, [skip ci]) was read as a code commit and refused a land
// that had already passed both suites. Each case below is a real commit shape; the code cases must stay code.
import assert from 'node:assert/strict';
import { isDataCommit } from './deploy-lane.mjs';

const cases = [
  ['Draws Bot: draws.json', { subject: 'chore(draws): official draw content changed [skip ci]', authorEmail: 'bot@bspconsult.local', files: ['draws.json'] }, true],
  ['odds bot: matches.json', { subject: 'chore(odds): capture tick 9 (free+metered) [skip ci]', authorEmail: 'bsp-odds-bot@users.noreply.github.com', files: ['matches.json'] }, true],
  ['Draws Bot identity, code file', { subject: 'chore(draws): x [skip ci]', authorEmail: 'bot@bspconsult.local', files: ['draws.json', 'tools/draws/build-draws.py'] }, false],
  ['draws.json under an agent identity', { subject: 'draws [skip ci]', authorEmail: 'bsp-ceo-bot@users.noreply.github.com', files: ['draws.json'] }, false],
  ['draws.json without [skip ci]', { subject: 'chore(draws): official draw content changed', authorEmail: 'bot@bspconsult.local', files: ['draws.json'] }, false],
];
let fail = 0;
for (const [name, c, want] of cases) {
  const got = isDataCommit(c);
  console.log(`  ${got === want ? 'ok  ' : 'FAIL'} ${name}: ${got ? 'data' : 'code'}`);
  if (got !== want) fail++;
}
assert.equal(fail, 0, `${fail} case(s) misclassified`);
