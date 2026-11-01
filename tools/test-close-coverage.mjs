// tools/close-coverage.mjs (architecture program stage 1, 2026-11-01) — its own test. Runs the REAL report, in headless
// Chrome, over a tiny site built from this checkout's code (tools/site-code.sh) with four finished cards on one day:
//   A  the card state holds a close for both sides          → counted (X)
//   B  the card state holds the entry but no close          → "card state holds no close for bet105 …"
//   C  no card-state entry and no close in matches.json     → "no card-state entry and no close in matches.json"
//   D  the card state was last built before this match began → "card state last built …, before this match started"
// plus a card of ANOTHER day (never in the population) and an unfinished card (never in it).
// Checks: X = 1 of Y = 4, each dash with its reason, the file written atomically; controls: a site whose page cannot
// load writes NO file and exits 1 (a missing report, never 0 of 0); wiring: pipeline.yml runs it before the site-data
// upload and never with `|| true`.
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log('  PASS ', name); } else { fail++; console.log('  FAIL ', name, '\n       ', String(detail).slice(-900)); } };
const chrome = process.env.CHROME_BIN || ['/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);

const yml = readFileSync(join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
const step = yml.indexOf('node tools/close-coverage.mjs --site _site --out _site/close-coverage.json');
const up = yml.indexOf('- name: Upload the built site for publish.yml (site-data)');
const block = step < 0 ? '' : yml.slice(yml.lastIndexOf('- name:', step), yml.indexOf('- name:', step + 1));
check('pipeline.yml writes _site/close-coverage.json before the site-data upload', step > 0 && up > step, { step, up });
check('the step never swallows a failure with "|| true" and names the miss as an ::error::', step > 0 && !/\|\|\s*true/.test(block) && /::error title=Close coverage/.test(block), block);

if (!chrome) { console.log('  SKIP  the browser checks: no Chrome (set CHROME_BIN) — said out loud, not a pass'); }
else {
  const site = mkdtempSync(join(tmpdir(), 'cc-site-'));
  try {
    execFileSync('bash', [join(ROOT, 'tools/site-code.sh'), ROOT, site]);
    const DAY = '2026-10-31';
    const fin = { display: '6-4, 6-4', sets: [{ p1: 6, p2: 4 }, { p1: 6, p2: 4 }], p1Sets: 2, p2Sets: 0, winner: 'p1' };
    const card = (id, p1, p2, time, extra = {}) => Object.assign({ id, p1, p2, date: DAY, time, tour: 'ATP Vienna', surface: 'Hard',
      finalScore: fin, odds: { p1: null, p2: null, bookmaker: null }, bestOdds: { p1: null, p2: null } }, extra);
    const matches = [
      card('past-1', 'A. Alpha', 'B. Bravo', '12:00'),
      card('past-2', 'C. Charlie', 'D. Delta', '13:00'),
      card('past-3', 'E. Echo', 'F. Foxtrot', '14:00'),
      card('past-4', 'G. Golf', 'H. Hotel', '20:00'),
      card('past-7', 'M. Mike', 'N. November', '12:30'),
      card('past-8', 'O. Oscar', 'P. Papa', '11:00'),
      card('past-5', 'I. India', 'J. Juliet', '12:00', { date: '2026-10-30' }),
      { id: 'upcoming-6', p1: 'K. Kilo', p2: 'L. Lima', date: DAY, time: '22:00', tour: 'ATP Vienna', finalScore: null },
    ];
    const side = (open, close, ts) => ({ open, now: null, close, closeTs: close ? ts : null, openTs: DAY + 'T06:00:00Z' });
    const ver = (start) => ({ startTs: start, startTsSource: 'api-tennis-live' });
    const ocs = { generatedAt: DAY + 'T18:00:00Z', windowFrom: '2026-10-20', windowTo: '2026-11-07', matches: 6, market: 'match-winner', byKey: {
      // A: verified start 11:00Z, both sides seen 2 min before → REAL
      [DAY + '|alpha|bravo']: Object.assign({ book: 'bet105', source: 'kibl', sides: { alpha: side(1.5, 1.45, DAY + 'T10:58:00Z'), bravo: side(2.6, 2.7, DAY + 'T10:58:00Z') } }, ver(DAY + 'T11:00:00Z')),
      // B: verified start, no close → book quiet before start
      [DAY + '|charlie|delta']: Object.assign({ book: 'bet105', source: 'kibl', sides: { charlie: side(1.8, null), delta: side(2.0, null) } }, ver(DAY + 'T12:00:00Z')),
      // D: no verified start, card state built before the scheduled start → other
      [DAY + '|golf|hotel']: { book: 'bet105', source: 'kibl', startTsSource: 'none', sides: { golf: side(1.9, null), hotel: side(1.9, null) } },
      // E: no verified start → "no verified start"
      [DAY + '|mike|november']: { book: 'bet105', source: 'kibl', startTsSource: 'none', sides: { mike: side(1.8, null), november: side(2.0, null) } },
      // F: verified start, last sighting 10 min before → "last sighting 300 s–30 min" (shown on the card, not a real close)
      [DAY + '|oscar|papa']: Object.assign({ book: 'bet105', source: 'kibl', sides: { oscar: side(1.7, 1.75, DAY + 'T09:50:00Z'), papa: side(2.2, 2.1, DAY + 'T09:50:00Z') } }, ver(DAY + 'T10:00:00Z')),
    } };
    writeFileSync(join(site, 'matches.json'), JSON.stringify(matches));
    writeFileSync(join(site, 'odds-card-state.json'), JSON.stringify(ocs));
    const out = join(site, 'close-coverage.json');
    const run = () => spawnSync(process.execPath, [join(ROOT, 'tools/close-coverage.mjs'), '--site', site, '--out', out, '--day', DAY],
      { encoding: 'utf8', env: Object.assign({}, process.env, { CHROME_BIN: chrome }), timeout: 180000 });
    const r = run();
    const rep = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
    check('exit 0 and the report written', r.status === 0 && rep, r.stdout + r.stderr);
    if (rep) {
      check('1 of 6 REAL (both sides within 300 s of a verified start): only the card with a close on both sides counts; another day and an unfinished card are not in the population',
        rep.x === 1 && rep.y === 6 && rep.pct === 16.7, JSON.stringify(rep));
      const why = Object.fromEntries(rep.dashes.map(d => [d.id, d.reason]));
      const bk = Object.fromEntries(rep.dashes.map(d => [d.id, d.bucket]));
      check('B: verified start, no close → [book quiet before start]', bk['past-2'] === 'book quiet before start' && /no bet105 price seen before it/.test(why['past-2'] || ''), why['past-2']);
      check('F: a close seen 10 min before the start is shown on the card but is NOT real → [last sighting 300 s–30 min]', bk['past-8'] === 'last sighting 300 s–30 min' && /10 min before/.test(why['past-8'] || ''), why['past-8']);
      check('the buckets add up to the dashes (no merge with the real count)', Object.values(rep.buckets).reduce((a, b) => a + b, 0) === rep.y - rep.x, JSON.stringify(rep.buckets));
      check('approximate is not counted here (— until its tier exists) and recovered is 0 on a first report', rep.approx === null && rep.recovered === 0);
      check('C: no entry → [other] "no card-state entry and no close in matches.json"', bk['past-3'] === 'other' && why['past-3'] === 'no card-state entry and no close in matches.json', why['past-3']);
      check('D: card state built before the start → [other] "last built …, before this match started"', bk['past-4'] === 'other' && /last built 2026-10-31T18:00Z, before this match started/.test(why['past-4'] || ''), why['past-4']);
      check('E: no verified start → [no verified start]', bk['past-7'] === 'no verified start', why['past-7']);
      check('every dash names its match', rep.dashes.every(d => / v /.test(d.match)), JSON.stringify(rep.dashes));
      check('no temp file left behind (written atomically)', !existsSync(out + '.tmp'));
    }
    // recovered by re-verification: B gains a real close in a later card state; the second report, fed the first as --prev
    if (rep) {
      const first = join(site, 'first.json'); writeFileSync(first, JSON.stringify(rep));
      ocs.byKey[DAY + '|charlie|delta'].sides = { charlie: side(1.8, 1.82, DAY + 'T11:57:00Z'), delta: side(2.0, 1.98, DAY + 'T11:57:00Z') };
      writeFileSync(join(site, 'odds-card-state.json'), JSON.stringify(ocs));
      const r3 = spawnSync(process.execPath, [join(ROOT, 'tools/close-coverage.mjs'), '--site', site, '--out', out, '--day', DAY, '--prev', first],
        { encoding: 'utf8', env: Object.assign({}, process.env, { CHROME_BIN: chrome }), timeout: 180000 });
      const rep3 = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
      check('a dash of the first report that has a real close now counts as recovered by re-verification (2 of 6, 1 recovered)',
        r3.status === 0 && rep3 && rep3.x === 2 && rep3.recovered === 1 && rep3.days[0].first['past-2'] === false, rep3 && JSON.stringify({ x: rep3.x, rec: rep3.recovered }));
    }
    // control: a page that cannot load its matches writes NO report (never a 0 of 0)
    unlinkSync(out); writeFileSync(join(site, 'matches.json'), 'not json');
    const r2 = spawnSync(process.execPath, [join(ROOT, 'tools/close-coverage.mjs'), '--site', site, '--out', out, '--day', DAY],
      { encoding: 'utf8', env: Object.assign({}, process.env, { CHROME_BIN: chrome }), timeout: 200000 });
    check('CONTROL: unreadable matches.json → exit 1 and no file (the watch reports the missing report)', r2.status === 1 && !existsSync(out), r2.status + ' ' + r2.stderr.slice(-300));
  } finally { rmSync(site, { recursive: true, force: true }); }
}
console.log(`\ntest-close-coverage: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
