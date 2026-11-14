// Sharp drop alerts — the shared settings logic (sharp-drops-core.js) and the member sync's row rule
// (tools/sharp-members-sync.mjs). Rules: .claude/rules/sharp-drops.md. Each check names the mistake it catches.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../sharp-drops-core.js');
const { rowFor, adminUids } = await import('./sharp-members-sync.mjs');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log('  PASS ', name); } else { fail++; console.log('  FAIL ', name, detail); } };

// founder 2026-11-14: the default rule
const d = Core.normalize({});
check('default = favourite < 1.80, drop 2–3%, ATP + Challenger incl. qualifying, 3 h, any shape',
  JSON.stringify([d.levels, d.dropMin, d.dropMax, d.priceMin, d.priceMax, d.windowMin, d.stepsOnly]) ===
  JSON.stringify([['ATP', 'ATP Q', 'CH', 'CH Q'], 2, 3, 1.01, 1.8, 180, false]), JSON.stringify(d));
check('default books = the two the engine quotes today (Bet105, Kalshi)', JSON.stringify(d.books) === '["Bet105","Kalshi"]', d.books);
check('unknown level / book dropped, never stored', JSON.stringify(Core.normalize({ levels: ['ATP', 'WTA'], books: ['Bet105', 'Foo'] }).levels) === '["ATP"]'
  && JSON.stringify(Core.normalize({ books: ['Bet105', 'Foo'] }).books) === '["Bet105"]');
check('a drop under the engine floor (2%) is raised to 2', Core.normalize({ dropMin: 0.5 }).dropMin === 2);
check('an explicit "no maximum" stays null', Core.normalize({ dropMax: null, priceMax: null }).dropMax === null
  && Core.normalize({ priceMax: null }).priceMax === null);
check('a max at or below the min becomes no maximum', Core.normalize({ dropMin: 4, dropMax: 3 }).dropMax === null);
check('window must be one of 30/60/120/180', Core.normalize({ windowMin: 45 }).windowMin === 180 && Core.normalize({ windowMin: 60 }).windowMin === 60);
check('quiet hours must be HH:MM', Core.normalize({ quietFrom: '25:00', quietTo: '07:30' }).quietFrom === '' && Core.normalize({ quietTo: '07:30' }).quietTo === '07:30');
check('garbage never throws', (() => { try { Core.normalize('x'); Core.normalize(null); return true; } catch { return false; } })());

// passes() = the SQL filter (sharp_bot.passes): same boundaries
const a = { level: 'ATP', drop: 2.35, price: 1.66, mins: 92, steps: 1 };
check('the Halys alert passes the default', Core.passes(a, d));
check('drop band upper edge is exclusive (3.00 not in 2–3)', !Core.passes({ ...a, drop: 3 }, d) && Core.passes({ ...a, drop: 2.99 }, d));
check('price band upper edge is exclusive (1.80 not under 1.80)', !Core.passes({ ...a, price: 1.8 }, d));
check('a level outside the member’s list fails', !Core.passes({ ...a, level: 'ITF' }, d));
check('2+ steps only drops a single jump', !Core.passes(a, { ...d, stepsOnly: true }) && Core.passes({ ...a, steps: 2 }, { ...d, stepsOnly: true }));
check('window: 92 min fails a 60-min window', !Core.passes(a, { ...d, windowMin: 60 }));
const sql = fs.readFileSync(new URL('./sharp-drops.sql', import.meta.url), 'utf8');
check('the SQL filter uses the same exclusive upper edges', /a\.drop_pct < m\.drop_max/.test(sql) && /a\.price < m\.price_max/.test(sql)
  && /a\.drop_pct >= m\.drop_min/.test(sql) && /a\.price >= m\.price_min/.test(sql));
check('the SQL defaults equal the core defaults', /levels\s+text\[\]\s+not null default '\{ATP,ATP Q,CH,CH Q\}'/.test(sql)
  && /drop_max\s+numeric\s+default 3/.test(sql) && /price_max\s+numeric\s+default 1\.80/.test(sql));

// codes
const c = Core.newCode();
check('link code shape SFY- + 6, no 0/O/1/I', /^SFY-[A-HJ-NP-Z2-9]{6}$/.test(c), c);

// member sync: the beta rule
const admins = adminUids(fs.readFileSync(new URL('../admin-config.js', import.meta.url), 'utf8'));
check('admin uids read from admin-config.js', admins.length >= 1 && admins.includes('dqniZkontSPLBwseOTBzmfCBUQG3'), admins);
const doc = { displayName: 'X', sharpDrops: { v: 1, linkCode: 'SFY-ABC234', settings: { levels: ['ATP'] }, tz: 'UTC' } };
check('beta: a non-admin is never written', rowFor('someone', doc, admins, true) === null);
check('beta: the admin is written, settings normalized', rowFor(admins[0], doc, admins, true)?.levels?.join() === 'ATP');
check('beta off: a member is written', rowFor('someone', doc, admins, false)?.uid === 'someone');
check('a malformed link code is not sent', rowFor(admins[0], { sharpDrops: { v: 1, linkCode: 'hello' } }, admins, true).linkCode === null);
check('no sharpDrops → nothing', rowFor(admins[0], { displayName: 'X' }, admins, true) === null);
// CONTROL: the beta rule is what keeps the non-admin out
check('CONTROL: the same non-admin with beta off is written', rowFor('someone', doc, admins, false) !== null);

console.log(`test-sharp-drops-core: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
