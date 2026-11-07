#!/usr/bin/env node
// Task C (founder 2026-11-01): the daily digest's schedule maths, its red rule and its message split. Each check names its mutant.
import { cronGapMin, pgGapMin, allowedMin, line, messages, watchedWorkflows, capturedLine } from './daily-digest.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
ok(cronGapMin('*/15 * * * *') === 15 && cronGapMin('0 */3 * * *') === 180 && cronGapMin('17 5 * * *') === 1440, 'cron gaps: every 15 min, every 3 h, daily');
ok(cronGapMin(['40 6 * * *', '40 18 * * *']) === 720 && cronGapMin('0 23 * * 1') === 10080, 'two daily times = 12 h; weekly = 7 d');
ok(cronGapMin('20 6,18 * * *') === 720 && cronGapMin('45 */6 * * *') === 360, 'a list of hours and a step of hours');
ok(pgGapMin('10 seconds') === 1 && pgGapMin('*/5 * * * *') === 5, 'pg_cron: "10 seconds" reads as 1 min; a cron reads as usual');
ok(allowedMin(15) === 60 && allowedMin(null) === null, 'late = older than twice its gap + 30 min');
const now = Date.parse('2026-11-01T07:00:00Z');
const l1 = line('BSP data pipeline', '2026-11-01T06:50:00Z', 15, now), l2 = line('BSP data pipeline', '2026-11-01T05:40:00Z', 15, now);
ok(!l1.red && /✅ BSP data pipeline · last success 10 min ago \(runs every 15 min\)/.test(l1.text), 'on time = green with its age and cadence');
ok(l2.red && /^🔴/.test(l2.text) && /80 min ago/.test(l2.text), 'late = red (80 min > 60 allowed) — MUTANT: comparing to the gap alone would also go red at 16 min');
ok(line('X', null, 15, now).red, 'no success on record is red, never green');
const many = Array.from({ length: 120 }, (_, i) => ({ red: i % 7 === 0, text: (i % 7 === 0 ? '🔴' : '✅') + ' job ' + i + ' · last success 5 min ago (runs every 15 min)' }));
const ms = messages('Digest', many);
ok(ms.length > 1 && ms.every((m) => m.length <= 4096), 'a long digest splits under Telegram\'s 4,096-character cap');
ok(/🔴 18 late of 120/.test(ms[0]) && ms[0].split('\n')[1].startsWith('🔴'), 'the header counts the late lines and red lines come first');
const w = watchedWorkflows();
ok(w.some((x) => x.file === 'pipeline.yml' && x.gap === 15) && w.some((x) => x.file === 'publish.yml') && w.some((x) => x.file === 'oddspapi-postmatch.yml'),
  'every scheduled workflow is read from its own cron; publish and the pg_cron-dispatched ones are listed');
// Founder 2026-11-08: captured closes stopped 4-8 Nov with a green pipeline. The digest must turn red.
const atp = (d) => ({ id: 'past-1', date: d, finalScore: { winner: 'p1' }, tourBadge: 'ATP' });
const capd = (d) => ({ rows: [{ date: '2026-10-30' }, { date: d }] });
ok(capturedLine(capd('2026-11-03'), [atp('2026-11-07')]).red, 'captured closes 4 days behind the finished ATP matches = red (the 4-8 Nov outage)');
ok(!capturedLine(capd('2026-11-06'), [atp('2026-11-07')]).red, 'one day behind = green (a day can lack a Pinnacle series) — MUTANT: lag >= 1 would go red');
ok(!capturedLine(capd('2026-11-07'), [atp('2026-11-07'), { id: 'upcoming-2', date: '2026-11-09', tourBadge: 'ATP' }]).red, 'upcoming cards are not finished matches');
ok(!capturedLine(capd('2026-11-20'), [{ id: 'past-3', date: '2026-11-25', finalScore: { winner: 'p1' }, tourBadge: 'Challenger' }]).red, 'Challenger results never count (the builder captures ATP only)');
ok(capturedLine(null, []).red && capturedLine({ rows: [] }, [atp('2026-11-07')]).red, 'unreadable or empty = red, never green');
console.log(`\ntest-daily-digest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
