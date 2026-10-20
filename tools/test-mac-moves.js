// Ruling 1 (founder 2026-10-20): Mac jobs off the Mac before the token expires (25 Oct 02:15Z).
//   entry lists: draw half RETIRED for draws.json · advance half MOVED to Actions (ticktocktennis answers a runner)
//   playing-styles: MOVED to Actions · career-splits: CAN'T move (Tennis Abstract 403s runners) → a visible freshness
//   failure + "Data paused" on screen wherever its data appears.
// Run: node tools/test-mac-moves.js
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path'); const vm = require('vm');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${d}` : ''}`); } };
console.log('Mac jobs moved / retired / paused');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const fnSrc = (src, name) => { const i = src.indexOf(`function ${name}(`); if (i < 0) return null; let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };

// ── the Mac halves log + exit 0 on the Mac (no fetch, no git), but still run in Actions ──
for (const [f, word] of [['refresh-entry-lists.sh', 'RETIRED'], ['refresh-entry-lists-advance.sh', 'MOVED'], ['refresh-playing-styles.sh', 'MOVED']]) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-'));
  const r = spawnSync('bash', [path.join(ROOT, 'tools', f)], { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8', timeout: 20000 });
  const logs = fs.existsSync(path.join(home, '.bsp-splits-cron')) ? fs.readdirSync(path.join(home, '.bsp-splits-cron')).map(x => fs.readFileSync(path.join(home, '.bsp-splits-cron', x), 'utf8')).join('') : '';
  check(`${f}: on the Mac → exit 0 + "${word}" logged, nothing else run`, r.status === 0 && logs.includes(word) && !/git|fetch|node /.test(r.stdout + r.stderr), `${r.status} ${logs} ${r.stderr}`);
  check(`${f}: in GitHub Actions the guard lets it run`, /if \[ "\$\{GITHUB_ACTIONS:-\}" != "true" \]; then/.test(fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8')));
}

// ── the Entry list tab's draw regime reads draws.json through the adapter ──
const conv = new Function(fnSrc(html, 'drawsToEntryShard') + '\nreturn drawsToEntryShard;')();
const draws = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wue-sheet', 'draws-2026-10-20.json'), 'utf8'));
const shard = conv(draws);
const by = c => shard.tournaments.find(t => t.city === c);
check('adapter: the 3 posted draws become draw-regime tournaments; Vienna/Basel (not posted) are left out', shard.tournaments.length === 3 && ['Almaty', 'Brussels', 'Lyon'].every(by));
const al = by('Almaty'), md = al.sections.find(s => s.title === 'Main Draw').players, qd = al.sections.find(s => s.title === 'Qualifying').players;
check('Almaty: week of Mon 19 Oct, 32 main-draw slots (4 Bye), 16 qualifying, status active', al.weekStart === '2026-10-19' && md.length === 32 && md.filter(p => p.status === 'BYE').length === 4 && qd.length === 16 && al.status === 'active');
check('statuses from the sheet only: entry code, else SEED, else DA (Medvedev SEED, Safiullin Q, Skatov WC)',
  md[0].status === 'SEED' && md[0].name.startsWith('MEDVEDEV') && md.find(p => p.name && p.name.startsWith('SAFIULLIN')).status === 'Q' && md.find(p => p.name && p.name.startsWith('SKATOV')).status === 'WC');
check('rank only where the sheet printed one (seeds); a missing country stays null (Medvedev)', md[0].rank === 6 && md[0].country === null && md[2].rank === null);
check('sourcePublished = when the draw content last changed (draws.json contentChangedAt)', al.sourcePublished === draws.tournaments['9410'].contentChangedAt);
check('the tab loads draws.json (adapter), not the retired entry_lists.json', html.includes("getJson('draws.json').then(drawsToEntryShard)") && !html.includes("getJson('entry_lists.json')"));
const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
check('the site no longer serves the retired entry_lists.json; it serves draws.json + the advance shard', !/^\s*cp entry_lists\.json _site/m.test(yml) && /cp draws\.json _site/.test(yml) && /cp entry_lists_advance\.json _site/.test(yml));

// ── "Data paused" — the page's rule (sfFeedPaused) ──
function paused(fetchedAt, nowIso) {
  const box = { careerSplitsTour: fetchedAt === undefined ? null : { fetchedAt }, window: {}, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [nowIso])); } static now() { return new Date(nowIso).getTime(); } } };
  vm.createContext(box);
  vm.runInContext('const SF_FEED_PAUSE_DAYS = 2;\n' + fnSrc(html, 'sfFeedPaused') + '\nthis.r = sfFeedPaused("careerSplits");', box);
  return box.r;
}
check('built yesterday → not paused', paused('20261019', '2026-10-20T15:00:00Z').paused === false);
const p = paused('20261024', '2026-10-27T09:00:00Z');
check('a daily build 3 days old → paused, "Data paused · last updated 24 Oct 2026"', p.paused === true && p.text === 'Data paused · last updated 24 Oct 2026', JSON.stringify(p));
check('no build date → no claim (null), never a guessed state', paused(undefined, '2026-10-27T09:00:00Z') === null && paused('2026-10', '2026-10-27T09:00:00Z') === null);
const v2 = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
check('Draw record tile: the support line carries the paused text', v2.includes("esc(b.key === 'splits' && splitsPaused() ? splitsPaused().text"));
check('Draw record modal: the header subtitle carries it', v2.includes("case 'splits': return 'Record and win rate by level, format, round and opponent' + splitsPausedSuffix();"));
check('legacy profile: Career + Last 52 weeks subtitles carry it', (html.match(/\$\{vsTier\}\$\{pausedNote\}/g) || []).length === 2);
check('the profile loads the tour file (the build date) with his splits', html.includes('loadCareerSplitsTour().then(t => { if (t) pp2RepaintIfOpen(k); });'));

// ── the visible failure for the feed that cannot move ──
const chk = (now) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'check-feed-freshness.mjs'), '--now', now, '--root', ROOT], { encoding: 'utf8' });
const tour = JSON.parse(fs.readFileSync(path.join(ROOT, 'career-splits-tour.json'), 'utf8'));
const at = Date.UTC(+tour.fetchedAt.slice(0, 4), +tour.fetchedAt.slice(4, 6) - 1, +tour.fetchedAt.slice(6, 8));
check('freshness check: green the day after a build', chk(new Date(at + 86400000 + 3600000).toISOString()).status === 0);
const red = chk(new Date(at + 3 * 86400000).toISOString());
check('freshness check: red (::error) 3 days after the last build', red.status === 1 && /::error title=Feed freshness::career-splits stopped updating/.test(red.stdout), red.stdout);

// ── the cloud workflows ──
const wf = n => fs.readFileSync(path.join(ROOT, '.github', 'workflows', n), 'utf8');
check('entry-lists-advance.yml: daily, commits on a content change only, red when the fetch failed', /cron: '0 23 \* \* \*'/.test(wf('entry-lists-advance.yml')) && /content-hash\.py entry_lists_advance\.json/.test(wf('entry-lists-advance.yml')) && /fetchStatus !== "ok"/.test(wf('entry-lists-advance.yml')));
check('playing-styles.yml: daily, API_TENNIS_KEY from secrets, runs the gated script', /cron: '30 22 \* \* \*'/.test(wf('playing-styles.yml')) && /secrets\.API_TENNIS_KEY/.test(wf('playing-styles.yml')) && /bash tools\/refresh-playing-styles\.sh/.test(wf('playing-styles.yml')));
check('feed-freshness.yml: scheduled, read-only, runs the check', /schedule:/.test(wf('feed-freshness.yml')) && /contents: read/.test(wf('feed-freshness.yml')) && /check-feed-freshness\.mjs/.test(wf('feed-freshness.yml')));
check('content hash ignores the advance shard\'s run stamps (generatedAt, fetchedAt)', /VOLATILE = \("generatedAt", "fetchedAt"\)/.test(fs.readFileSync(path.join(ROOT, 'tools', 'entry-lists', 'content-hash.py'), 'utf8')));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
