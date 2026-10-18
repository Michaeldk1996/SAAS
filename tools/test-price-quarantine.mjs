// Founder ruling 2026-10-18 ("one match problem must never stop the site from updating") — tools/price-guard-run.mjs, end
// to end, with the REAL builders (build-database-yield.js → build-market-edge.js) over a tiny archive and the REAL price
// check in headless Chrome over a site built from this checkout's code:
//   1. one unmatched match (Market edge prices A. Tester v "Pereira L."; the join cannot meet Tester's career row v
//      "G. Pereira"): the run publishes (exit 0), the match is quarantined, Market edge is rebuilt without it, the confirm
//      pass finds every page agreeing (a dash on every page), and ONE alert names the match, the page and the cause
//      (name spelling) — sent once through a fake Telegram;
//   2. a match the join holds that Market edge prices differently: quarantined by its Database row, a dash on every page;
//   3. MUTANT: the Market edge builder ignores the quarantine → the dashed match is still priced → this test goes red
//      (it must, and the alert says NOT CLEARED);
//   4. control: a site with no player to check still fails the run (a check that cannot run is not a pass);
//   5. wiring: pipeline.yml runs the orchestrator (not the bare guard), sends the alert after the upload, and the alert
//      step can never fail the run.
import { spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log('  PASS ', name); } else { fail++; console.log('  FAIL ', name, '\n       ', String(detail).slice(-1200)); } };
const chrome = process.env.CHROME_BIN || ['/opt/pw-browsers/chromium', '/usr/bin/google-chrome'].find(existsSync);

// 5 · wiring (no browser)
const yml = readFileSync(join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
const gi = yml.indexOf('node tools/price-guard-run.mjs --site _site'), up = yml.indexOf('- name: Upload the built site for publish.yml (site-data)');
const al = yml.indexOf('- name: Alert — matches dashed by the price check (Telegram)');
check('5 · pipeline.yml runs the orchestrator on the built site before the upload', gi > 0 && up > gi, { gi, up });
check('5 · the bare guard no longer gates the publish (no step runs price-consistency.mjs directly)', !/run: [^\n]*node tools\/price-consistency\.mjs --site _site/.test(yml));
const alStep = al > 0 ? yml.slice(al, yml.indexOf('\n      - name:', al + 1)) : '';
check('5 · the alert goes out AFTER the upload, on every outcome, from the run\'s one message', al > up && /if: always\(\) && hashFiles\('\.price-alert\.txt'\) != ''/.test(alStep) && /price-alert-send\.mjs \.price-alert\.txt/.test(alStep), alStep);
const sender = readFileSync(join(ROOT, 'tools/price-alert-send.mjs'), 'utf8');
check('5 · the sender never fails the step (an unsent alert is an ::error::, not a red run)', !/process\.exit\(1\)/.test(sender) && /::error title=Alert not sent::/.test(sender));

if (!chrome) console.log('  SKIP  the end-to-end checks: no Chrome (set CHROME_BIN) — said out loud, not a pass');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'pq-'));
  try {
    // the archive: two Test Open matches for A. Tester; the second's loser is "Pereira L." (our L. A. Pereira), while
    // Tester's career row (the feed's older spelling) reads "G. Pereira" — the 17 Oct Gaubas v Miguel shape
    const HEAD = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
    const ROWS = ['2025-03-01,Test Open,ATP250,Outdoor,Hard,1st Round,3,Tester A.,Alpha B.,10,20,Completed,1.4,3,1.4,3.1,1.4,3.1,1.38,3,file',
      '2025-03-03,Test Open,ATP250,Outdoor,Hard,2nd Round,3,Tester A.,Pereira L.,10,30,Completed,1.5,2.6,1.5,2.7,1.5,2.7,1.48,2.6,file'];
    const mkRoot = (dir, builderSrc) => {
      mkdirSync(dir, { recursive: true });
      for (const f of ['build-odds-performance.js', 'market-edge-core.js', 'build-database-yield.js', 'td-identity.js']) copyFileSync(join(ROOT, f), join(dir, f));
      writeFileSync(join(dir, 'build-market-edge.js'), builderSrc);
      mkdirSync(join(dir, 'odds-archive'), { recursive: true });
      writeFileSync(join(dir, 'odds-archive', '2025.csv'), [HEAD].concat(ROWS).join('\n') + '\n');
      writeFileSync(join(dir, 'player-profiles.json'), JSON.stringify({ players: { 9001: { name: 'A. Tester' }, 9002: { name: 'B. Alpha' }, 9003: { name: 'L. A. Pereira' } } }));
      for (const s of ['build-database-yield.js', 'build-market-edge.js']) {
        const r = spawnSync(process.execPath, [join(dir, s), '--quiet'], { cwd: dir, encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`${s} exited ${r.status}: ${(r.stderr || '').slice(0, 600)}`);
      }
    };
    const mkSite = (root, site) => {
      execFileSync('bash', [join(ROOT, 'tools/site-code.sh'), ROOT, site]);
      for (const f of ['database-yield.json', 'database-yield-players.json', 'market-edge-index.json']) copyFileSync(join(root, f), join(site, f));
      cpSync(join(root, 'market-edge'), join(site, 'market-edge'), { recursive: true });
      writeFileSync(join(site, 'career-history-index.json'), JSON.stringify({ players: { 9001: { name: 'A. Tester' } } }));
      writeFileSync(join(site, 'player-profiles.json'), JSON.stringify({ players: { 9001: { name: 'A. Tester' } } }));
      mkdirSync(join(site, 'career-history')); mkdirSync(join(site, 'match-closes'));
      writeFileSync(join(site, 'career-history', '9001.json'), JSON.stringify({ matches: [
        { date: '2025-03-01', year: 2025, tournament: 'Test Open', level: 'atp', surface: 'hard', opponent: 'B. Alpha', oppKey: '9002', won: true, result: '2-0', eventKey: 9101, sets: [[6, 3], [6, 2]] },
        { date: '2025-03-03', year: 2025, tournament: 'Test Open', level: 'atp', surface: 'hard', opponent: 'G. Pereira', oppKey: '9003', won: true, result: '2-0', eventKey: 9102, sets: [[6, 4], [6, 4]] }] }));
      writeFileSync(join(site, 'match-closes', '9001.json'), JSON.stringify({ rows: [], cap: [] }));
    };
    const runGuard = (root, site, extra = []) => spawnSync(process.execPath, [join(ROOT, 'tools/price-guard-run.mjs'), '--site', site, '--root', root,
      '--alert-out', join(root, '.price-alert.txt'), '--run-label', 'test run', '--builder', join(root, 'build-market-edge.js'), '--guard-args', '--sample 1', ...extra],
      { encoding: 'utf8', env: Object.assign({}, process.env, { CHROME_BIN: chrome }), timeout: 600000 });
    const shardRows = (site, k) => { const p = join(site, 'market-edge', k + '.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).matches.filter(m => m.price != null) : []; };
    const BUILDER = readFileSync(join(ROOT, 'build-market-edge.js'), 'utf8');

    // 1 · one unmatched match
    const r1 = join(tmp, 'r1'), s1 = join(tmp, 's1');
    mkRoot(r1, BUILDER);
    check('1 · setup: Market edge prices Tester v Pereira from the master (the shape that blocked 17 Oct)', shardRows(r1, '9001').some(m => m.date === '2025-03-03'));
    mkSite(r1, s1);
    let r = runGuard(r1, s1);
    const out = (r.stdout || '') + (r.stderr || '');
    check('1 · the run publishes: exit 0', r.status === 0, out);
    const q = existsSync(join(s1, 'price-quarantine.json')) ? JSON.parse(readFileSync(join(s1, 'price-quarantine.json'), 'utf8')) : { entries: [] };
    check('1 · the match is quarantined, once, with the page that tripped', q.entries.length === 1 && q.entries[0].date === '2025-03-03' && q.entries[0].pages.includes('Market edge') && q.entries[0].kind === 'not held', JSON.stringify(q.entries));
    check('1 · Market edge is rebuilt without it: no shard prices the match (Tester\'s, and Pereira\'s too)',
      !shardRows(s1, '9001').some(m => m.date === '2025-03-03') && !shardRows(s1, '9003').some(m => m.date === '2025-03-03') && shardRows(s1, '9001').some(m => m.date === '2025-03-01'), JSON.stringify(shardRows(s1, '9001')));
    check('1 · the confirm pass finds every page agreeing (a dash everywhere): nothing NOT CLEARED', /"notCleared":0/.test(out) && !/NOT CLEARED/.test(out), out);
    const alert = existsSync(join(r1, '.price-alert.txt')) ? readFileSync(join(r1, '.price-alert.txt'), 'utf8') : '';
    check('1 · ONE alert in plain words: the match, the page, the likely cause', alert.split('\n').filter(l => l.startsWith('• ')).length === 1
      && /Tester v Pereira, Test Open 2025: Market edge priced it, the master didn't\. Likely cause: name spelling \('Pereira L\.' in the Database vs 'G\. Pereira'\)\./.test(alert), alert);
    // the alert is sent once (a fake Telegram counts the calls)
    let calls = 0, body = '';
    const noSecret = Object.assign({}, process.env); delete noSecret.TELEGRAM_BOT_TOKEN; delete noSecret.TELEGRAM_CHAT_ID;
    const send = spawnSync(process.execPath, [join(ROOT, 'tools/price-alert-send.mjs'), join(r1, '.price-alert.txt')], { encoding: 'utf8', env: noSecret });
    const tg2 = createServer((req, res) => { calls++; let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { body = b; res.writeHead(200); res.end('{"ok":true}'); }); });
    await new Promise(res => tg2.listen(0, '127.0.0.1', res));
    const { sendTelegram } = await import(join(ROOT, 'tools/price-alert-send.mjs'));
    const sent = await sendTelegram(alert, { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c', TELEGRAM_API_URL: `http://127.0.0.1:${tg2.address().port}` });
    tg2.close();
    check('1 · the alert is sent as ONE Telegram message for the run', sent.ok && calls === 1 && JSON.parse(body).text.includes('Tester v Pereira'), JSON.stringify({ sent, calls }));
    check('1 · an unsent alert (no secret) never fails the step, and says so', send.status === 0 && /::error title=Alert not sent::/.test(send.stdout), (send.stdout || '') + (send.stderr || ''));
    const empty = spawnSync(process.execPath, [join(ROOT, 'tools/price-alert-send.mjs'), join(tmp, 'none.txt')], { encoding: 'utf8' });
    check('1 · nothing quarantined → nothing sent', empty.status === 0 && /nothing to send/.test(empty.stdout), empty.stdout);

    // 2 · a match the join holds that Market edge prices differently
    const s2 = join(tmp, 's2'), r2 = join(tmp, 'r2');
    mkRoot(r2, BUILDER); mkSite(r2, s2);
    const sh = JSON.parse(readFileSync(join(s2, 'market-edge', '9001.json'), 'utf8'));
    sh.matches.forEach(m => { if (m.date === '2025-03-01') m.price = 1.45; });
    writeFileSync(join(s2, 'market-edge', '9001.json'), JSON.stringify(sh));
    r = runGuard(r2, s2);
    const out2 = (r.stdout || '') + (r.stderr || '');
    const q2 = existsSync(join(s2, 'price-quarantine.json')) ? JSON.parse(readFileSync(join(s2, 'price-quarantine.json'), 'utf8')) : { entries: [] };
    const alpha = q2.entries.find(e => e.date === '2025-03-01');
    check('2 · a different Market edge price: exit 0, quarantined by its Database row', r.status === 0 && alpha && alpha.kind === 'different' && alpha.db === '20250301|Tester A.|Alpha B.', JSON.stringify(q2.entries) + out2);
    check('2 · after the dash every page agrees (the join prices nothing for it, Market edge leaves it out)', /"notCleared":0/.test(out2) && !shardRows(s2, '9001').some(m => m.date === '2025-03-01'), out2);

    // 3 · MUTANT: the builder ignores the quarantine → Market edge still prices the dashed match → red
    const anchor = '      if (quarantined) { stats.quarantined += 1; if (!perPlayer.has(hit.key)) perPlayer.set(hit.key, { name: hit.name, sides: [] }); return; }';
    check('3 · the mutant anchor is found once', BUILDER.split(anchor).length === 2);
    const r3 = join(tmp, 'r3'), s3 = join(tmp, 's3');
    mkRoot(r3, BUILDER.replace(anchor, '')); mkSite(r3, s3);
    r = runGuard(r3, s3);
    const out3 = (r.stdout || '') + (r.stderr || '');
    const dashed = !shardRows(s3, '9001').some(m => m.date === '2025-03-03') && /"notCleared":0/.test(out3);
    check('3 · MUTANT (Market edge still pricing the dashed match) is caught: the dash check goes red and the alert says NOT CLEARED',
      !dashed && /NOT CLEARED/.test(readFileSync(join(r3, '.price-alert.txt'), 'utf8')), out3);

    // 4 · control: nothing to check is still a failure
    writeFileSync(join(s1, 'career-history', '9001.json'), JSON.stringify({ matches: [] }));
    r = runGuard(r1, s1);
    check('4 · control: a check that cannot run (no match to check) still fails the run', r.status !== 0, (r.stdout || '') + (r.stderr || ''));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`\ntest-price-quarantine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
