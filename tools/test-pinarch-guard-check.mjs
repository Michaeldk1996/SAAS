// The publish guard's verdict (tools/pinarch-guard.mjs) on synthetic guard answers: a healthy archive passes; a shrunken
// table, a dropped trigger, a write privilege, RLS off or a missing table blocks; no answer is a SKIP, never a pass.
import { verdict } from './pinarch-guard.mjs';
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + '  ' + JSON.stringify(d)); } };
const T = (rows) => ({ rows, triggers: true, rls: true, privilegeFaults: [] });
const ok = () => ({ ok: true, oddspapi_archive_raw: T(6137), pinnacle_archive_close: T(682), pinnacle_archive_count: T(3), maxRecorded: { raw: 6137, close: 682 } });
check('healthy archive → deploy proceeds', !verdict(ok()).block && !verdict(ok()).skip, verdict(ok()));
let g = ok(); g.oddspapi_archive_raw.rows = 6136; check('raw count below the recorded max → blocks', verdict(g).block, verdict(g));
g = ok(); g.pinnacle_archive_close.rows = 0; check('close count below the recorded max → blocks', verdict(g).block, verdict(g));
g = ok(); g.pinnacle_archive_close.triggers = false; g.ok = false; check('a dropped trigger → blocks', verdict(g).block, verdict(g));
g = ok(); g.oddspapi_archive_raw.privilegeFaults = ['service_role DELETE']; g.ok = false; check('a write privilege → blocks', verdict(g).block, verdict(g));
g = ok(); g.pinnacle_archive_count.rls = false; check('RLS off → blocks', verdict(g).block, verdict(g));
g = ok(); delete g.pinnacle_archive_count; check('a missing table → blocks', verdict(g).block, verdict(g));
g = ok(); g.oddspapi_archive_raw.rows = 7000; check('more rows than recorded → proceeds (rows are only ever added)', !verdict(g).block, verdict(g));
check('no answer (database unreachable) → SKIP, not a pass and not a block', verdict(null).skip && !verdict(null).block);
console.log(`\ntest-pinarch-guard-check: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
