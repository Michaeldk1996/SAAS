#!/usr/bin/env node
// The full Market edge vs Database report (report only): every shard row is compared, a difference is named, a
// stale shard (28 Oct 2026: Bet365 prices on matches the Database dashes) is caught, nothing is a vacuous pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

// Database: [date, …, round(3), tourn(4), favPrice(5), dogPrice(6), favWon(7), book(8)]
const db = { rows: [
  [20260209, 0, 0, 'R32', 'Argentina Open', 1.80, 2.11, 1, 2],     // Martinez P. (fav) d. Feldbausch
  [20260210, 0, 0, 'R32', 'Argentina Open', 1.50, 2.60, 0, 0],     // dog won: Wu Y. d. Smith
  [20260210, 0, 0, 'R32', 'Argentina Open', 1.40, 3.00, 1, 1],     // same day, same loser spelling: Bu Y. d. Smith
], retRows: [], tieRows: [[20260211, 0, 0, 'R16', 'Argentina Open', 1.90, 1.90, 1, 0]] };
const names = { names: [['Martinez P.', 'Feldbausch J.'], ['Wu Y.', 'Smith J.'], ['Bu Y.', 'Smith J.']], retNames: [], tieNames: [['Struff J-L.', 'Ruud C.']] };
// founder 2026-10-30: an ATP main-draw match with no Pinnacle rides the era shard behind flag 'b' (a Database dash)
const era = { xRows: [[20080505, 0, 0, 'R1', 'Davis Cup', 1.20, 4.50, 1, 3, 'p'], [20260213, 0, 0, 'R32', 'Argentina Open', 1.70, 2.20, 1, 1, 'b']],
  xNames: [['Gasquet R.', 'Wawrinka S.'], ['Bergs Z.', 'Moe M.']] };
const shard = (playerKey, name, matches) => ({ playerKey, name, matches });
const good = () => [
  shard('1', 'J. Feldbausch', [{ date: '2026-02-09', opp: 'Martinez P.', won: false, price: 2.11, oppPrice: 1.8, book: 'pinnacle-approx' }]),
  shard('2', 'Y. Wu', [{ date: '2026-02-10', opp: 'Smith J.', won: true, price: 2.6, oppPrice: 1.5, book: 'pinnacle' }]),
  shard('3', 'Y. Bu', [{ date: '2026-02-10', opp: 'Smith J.', won: true, price: 1.4, oppPrice: 3.0, book: 'bet365-archive' }]),
  shard('4', 'J-L. Struff', [{ date: '2026-02-11', opp: 'Ruud C.', won: true, price: 1.9, oppPrice: 1.9, book: 'pinnacle' },
    { date: '2026-02-12', opp: 'Nobody X.', won: true, price: null, oppPrice: null, book: null }]),
  shard('5', 'R. Gasquet', [{ date: '2008-05-05', opp: 'Wawrinka S.', won: true, price: 1.2, oppPrice: 4.5, book: 'pinnacle-history' }]),
  shard('6', 'Z. Bergs', [{ date: '2026-02-13', opp: 'Moe M.', won: true, price: 1.7, oppPrice: 2.2, book: 'bet365-archive' }]),
];

async function run(src) {
  const M = await import(pathToFileURL(src).href + '?' + Math.random());
  const idx = M.databaseIndex(db, names, era);
  return { M, idx, S: s => M.compare(s, idx) };
}
const tool = path.join(here, 'me-db-report.mjs');
const { M, idx, S } = await run(tool);

const a = S(good());
ok(idx.n === 6, 'the index holds rows, ties and the era shard (6 rows the join reads)');
ok(a.rows === 6 && a.same === 5 && a.allowed === 1 && a.status === 'ok', 'every priced shard row equals its Database row (5 of 6), the 6th is the one allowed case (a Database dash, "B" in Market edge)');
const ab = good(); ab[5].matches[0].book = 'pinnacle';
ok(S(ab).differ === 1, 'a flag-b row Market edge prices on another book is a difference, not the allowed case');
const ap = good(); ap[5].matches[0].price = 1.75;
ok(S(ap).differ === 1, 'a flag-b row priced differently is a difference');
ok(/1 the allowed case/.test(M.lines(a, idx.n)[0]) && /0 unexpected/.test(M.lines(a, idx.n)[0]), 'the report line names the allowed case and the unexpected count');
ok(a.ambiguous === 0, 'two rows on one day v the same opponent spelling are told apart by the player (Wu / Bu, two-letter surnames)');

const stale = good(); stale[0].matches[0] = { date: '2026-02-09', opp: 'Martinez P.', won: false, price: 2.2, oppPrice: 1.71, book: 'bet365-archive' };
const b = S(stale);
ok(b.differ === 1 && b.status === 'differences' && b.ex.differ[0].name === 'J. Feldbausch', 'a stale shard (Bet365 where the Database has another price) is a difference, named');
const bk = good(); bk[1].matches[0].book = 'bet365-archive';
ok(S(bk).differ === 1, 'the same prices under another book are a difference');
const op = good(); op[1].matches[0].oppPrice = 1.51;
ok(S(op).differ === 1, 'the other player\'s price is compared too');
const nd = good(); nd[0].matches.push({ date: '2026-03-01', opp: 'Martinez P.', won: true, price: 1.5, oppPrice: 2.5, book: 'pinnacle' });
ok(S(nd).noDbRow === 1, 'a priced shard row the Database does not hold is counted (the join prices it a dash)');
ok(M.lines(b, idx.n)[0].includes('4 of 6 priced rows in 6 player shards') && M.lines(b, idx.n).some(l => /differ: J. Feldbausch v Martinez P./.test(l)), 'the report line carries its denominator and names the match');

// A check that passes on an empty set is not a check: no priced row = SKIPPED, said out loud.
const e = S([shard('9', 'X. Y', [{ date: '2026-01-01', price: null }])]);
ok(e.status === 'skipped' && /SKIPPED/.test(M.lines(e, idx.n)[0]), 'no priced row → SKIPPED, never "ok"');

// MUTANTS: the tool with a check removed must fail the stale case.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'medb-'));
const srcTxt = fs.readFileSync(tool, 'utf8');
const mutants = [
  ['book not compared', ' && o.book === m.book', ''],
  ['other price not compared', ' && q === m.oppPrice', ''],
  ['no player tie-break', 'if (c.length > 1) c = c.filter', 'if (false) c = c.filter'],
  ['the allowed branch dropped', "if (eq && o.kind === 'bet365-join') S.allowed++;", "if (false) S.allowed++;"],
];
for (const [label, from, to] of mutants) {
  if (!srcTxt.includes(from)) { ok(false, `mutant "${label}": anchor gone`); continue; }
  const f = path.join(here, `.me-db-report.mutant.${process.pid}.mjs`);
  fs.writeFileSync(f, srcTxt.replace(from, to));
  try {
    const R = (await run(f)).S;
    const caught = R(bk).differ === 1 && R(op).differ === 1 && R(good()).ambiguous === 0 && R(ab).differ === 1 && R(good()).same === 5 && R(good()).allowed === 1;
    ok(!caught, `mutant "${label}" is caught`);
  } finally { fs.rmSync(f, { force: true }); }
}

// The CLI on a real directory: exit 0 (report only), a ::warning:: on a difference, the summary written.
const site = path.join(tmp, 'site'); fs.mkdirSync(path.join(site, 'market-edge'), { recursive: true });
fs.writeFileSync(path.join(site, 'database-yield.json'), JSON.stringify(db));
fs.writeFileSync(path.join(site, 'database-yield-players.json'), JSON.stringify(names));
fs.writeFileSync(path.join(site, 'database-yield-x.json'), JSON.stringify(era));
stale.forEach(s => fs.writeFileSync(path.join(site, 'market-edge', s.playerKey + '.json'), JSON.stringify(s)));
const sum = path.join(tmp, 'summary.md'), out = path.join(tmp, 'r.json');
const so = execFileSync('node', [tool, '--site', site, '--out', out], { env: Object.assign({}, process.env, { GITHUB_STEP_SUMMARY: sum }), encoding: 'utf8' });
ok(/::warning title=Market edge vs Database::/.test(so) && JSON.parse(fs.readFileSync(out)).differ === 1 && /Market edge vs Database/.test(fs.readFileSync(sum, 'utf8')), 'CLI: exit 0, a ::warning::, the report file and the step summary');

// Wiring: the pipeline runs it after the price guard, on the site that will publish, and it can never turn the run red.
const yml = fs.readFileSync(path.join(here, '..', '.github', 'workflows', 'pipeline.yml'), 'utf8');
const g = yml.indexOf('tools/price-guard-run.mjs --site _site'), r = yml.indexOf('node tools/me-db-report.mjs --site _site');
const line = yml.slice(r, yml.indexOf('\n', r));
ok(g > 0 && r > g, 'pipeline.yml runs the report after the price guard');
ok(/\|\| echo "::error/.test(line) && !/\|\| true/.test(line), 'the report step ends in || echo "::error…" (never red, never silent)');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-me-db-report: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
