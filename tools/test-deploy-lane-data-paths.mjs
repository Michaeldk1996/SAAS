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
  ['Points Bot: points-to-defend.json', { subject: 'chore(points): points-to-defend content changed [skip ci]', authorEmail: 'bot@bspconsult.local', files: ['points-to-defend.json'] }, true],
  ['Points Bot identity, builder file', { subject: 'chore(points): x [skip ci]', authorEmail: 'bot@bspconsult.local', files: ['points-to-defend.json', 'tools/points-to-defend/build-points-to-defend.js'] }, false],
  ['draws.json without [skip ci]', { subject: 'chore(draws): official draw content changed', authorEmail: 'bot@bspconsult.local', files: ['draws.json'] }, false],
  // 2026-10-25: line-prices.yml (bsp-bot, every 15 min) commits only line-prices/<date>.json; read as code it made every
  // `claim` during a 30-min suite run return 7 "not rebased". Real shape: 12221fbac (four date shards, nothing else).
  ['line-prices bot: date shards', { subject: 'chore(odds): bet105 line prices [skip ci]', authorEmail: 'bsp-bot@users.noreply.github.com', files: ['line-prices/2026-10-23.json', 'line-prices/2026-10-24.json', 'line-prices/2026-10-25.json', 'line-prices/2026-10-26.json'] }, true],
  ['line-prices bot identity, line-prices.js', { subject: 'chore(odds): bet105 line prices [skip ci]', authorEmail: 'bsp-bot@users.noreply.github.com', files: ['line-prices/2026-10-25.json', 'line-prices.js'] }, false],
  ['line-prices bot identity, non-json under line-prices/', { subject: 'chore(odds): bet105 line prices [skip ci]', authorEmail: 'bsp-bot@users.noreply.github.com', files: ['line-prices/2026-10-25.json', 'line-prices/README.md'] }, false],
  ['line-prices shards under an agent identity', { subject: 'chore(odds): bet105 line prices [skip ci]', authorEmail: 'bsp-ceo-bot@users.noreply.github.com', files: ['line-prices/2026-10-25.json'] }, false],
  // ten225-fixture-index.yml (bsp-bot, daily 05:50Z, [skip ci]) commits only .ten225-fixture-index.json.gz (coordinator 2026-10-25).
  ['fixture-index bot: index only', { subject: 'chore(odds): refresh the Oddspapi fixture index [skip ci]', authorEmail: 'bsp-bot@users.noreply.github.com', files: ['.ten225-fixture-index.json.gz'] }, true],
  ['fixture-index bot identity, index + code', { subject: 'chore(odds): refresh the Oddspapi fixture index [skip ci]', authorEmail: 'bsp-bot@users.noreply.github.com', files: ['.ten225-fixture-index.json.gz', 'ten225-fixture-index.py'] }, false],
];
let fail = 0;
for (const [name, c, want] of cases) {
  const got = isDataCommit(c);
  console.log(`  ${got === want ? 'ok  ' : 'FAIL'} ${name}: ${got ? 'data' : 'code'}`);
  if (got !== want) fail++;
}
assert.equal(fail, 0, `${fail} case(s) misclassified`);
