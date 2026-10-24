// Player photos (founder rulings 2026-10-22, .claude/rules/player-photos.md): ONE player, ONE photo, on every surface.
// A player ID resolves to the ATP headshot through player-atp-aliases.json, else the monogram. This suite holds:
//   1. the alias map: every code has a probed headshot (player-photo-manifest.json); no code serves a known placeholder
//      (ATP's grey silhouette, HTTP 200) and no two codes share one file; the ATP record's birth year agrees with the
//      api-tennis profile for that ID (the Damm Sr. photo on Damm Jr. was a 31-year gap);
//   2. the resolver: the dashboard's playerPhotoUrl / playerPhotoImg (ID in, ATP URL or nothing out);
//   3. every avatar surface asks that resolver and no retired source survives (Wikimedia, the api-tennis logo).
// Each check is also run against a manufactured bad state, so a pass is never a pass on an empty set.
// Run: node tools/test-player-photos.js
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${d}` : ''}`); } };

// ── 1. the alias map against the probe manifest ─────────────────────────────────────────────────────────────────
function aliasProblems(aliases, manifest, profiles, year) {
  const out = [];
  const ph = new Set((manifest.placeholders || []).map((p) => p.sha1_16));
  const bySha = {};
  const codes = Object.values(aliases);
  if (new Set(codes).size !== codes.length) out.push('two IDs share one ATP code');
  for (const [key, code] of Object.entries(aliases)) {
    if (!/^\d+$/.test(key)) out.push(`key ${key} is not a player ID`);
    const m = manifest.photos[code];
    if (!m) { out.push(`${key} -> ${code}: not in the manifest (run tools/atp-photo-probe.browser.js)`); continue; }
    if (m.status !== 200) out.push(`${key} -> ${code}: headshot status ${m.status}`);
    if (ph.has(m.sha1_16)) out.push(`${key} -> ${code}: serves a known placeholder (${m.sha1_16})`);
    (bySha[m.sha1_16] = bySha[m.sha1_16] || []).push(code);
    const p = profiles && profiles[key];
    const by = parseInt(String(m.atpBirth || '').slice(0, 4), 10);
    // api-tennis age is computed from player_bday on the pipeline's run day: the birth year is year-age or year-age-1
    // (one extra year of slack for a profile file regenerated across New Year).
    if (p && p.age != null && isFinite(by) && !(by >= year - p.age - 2 && by <= year - p.age)) {
      out.push(`${key} -> ${code}: ATP's ${m.atpName} was born ${by}; the api-tennis profile ${p.name} is ${p.age}`);
    }
  }
  for (const [sha, cs] of Object.entries(bySha)) if (cs.length > 1) out.push(`codes ${cs.join(', ')} share one file (${sha})`);
  return out;
}
const aliases = J('player-atp-aliases.json');
const manifest = J('player-photo-manifest.json');
const profiles = (() => { try { return J('player-profiles.json').players; } catch (e) { return null; } })();
const YEAR = new Date().getUTCFullYear();
console.log('Player photos — alias map, resolver, surfaces');
check(`player-atp-aliases.json: ${Object.keys(aliases).length} IDs, every code probed, no placeholder, no shared file, birth years agree`,
  aliasProblems(aliases, manifest, profiles, YEAR).length === 0, aliasProblems(aliases, manifest, profiles, YEAR).join('\n       '));
check('manifest carries no code the map no longer uses (regenerated with the map)',
  Object.keys(manifest.photos).every((c) => Object.values(aliases).includes(c)), Object.keys(manifest.photos).filter((c) => !Object.values(aliases).includes(c)).join(', '));
check('profiles present for the birth-year check (skip is reported, never a silent pass)', !!profiles, 'player-profiles.json missing: birth-year limb did not run');
check('ruling 3: the silhouette aliases are gone (1307 A. Hernandez, 2672 S. Travaglia)', !('1307' in aliases) && !('2672' in aliases));
check('ruling 4: 1317 M. Damm is Martin Damm b. 2003 (D0DT), not his father (D214)', aliases['1317'] === 'D0DT' && manifest.photos.D0DT && manifest.photos.D0DT.atpBirth.startsWith('2003'));

// controls: the same check against manufactured bad maps must FAIL
const SIL = manifest.placeholders[0].sha1_16;
const fakeManifest = JSON.parse(JSON.stringify(manifest));
fakeManifest.photos.TA12 = { status: 200, bytes: 4729, sha1_16: SIL, atpName: 'Stefano Travaglia', atpBirth: '1991-12-28', atpNat: 'ITA' };
fakeManifest.photos.H346 = { status: 200, bytes: 4729, sha1_16: SIL, atpName: 'Alejandro Hernandez', atpBirth: '1977-10-01', atpNat: 'MEX' };
fakeManifest.photos.D214 = { status: 200, bytes: 33096, sha1_16: '2e8a044f02ff00ac', atpName: 'Martin Damm', atpBirth: '1972-08-01', atpNat: 'CZE' };
const pre = Object.assign({}, aliases, { 2672: 'TA12', 1307: 'H346', 1317: 'D214' });
const preProblems = aliasProblems(pre, fakeManifest, profiles || { 1317: { name: 'M. Damm', age: 22 } }, YEAR);
check('control: the pre-fix map (silhouettes + Damm Sr.) is rejected — placeholder x2, shared file, birth year',
  preProblems.filter((p) => /placeholder/.test(p)).length === 2 && preProblems.some((p) => /share one file/.test(p)) && preProblems.some((p) => /^1317 .*1972/.test(p)),
  preProblems.join('\n       '));
check('control: an unprobed code is rejected', aliasProblems({ 1: 'ZZZZ' }, manifest, null, YEAR).some((p) => /not in the manifest/.test(p)));

// ── 2. the resolver (extracted from the dashboard, run as shipped) ──────────────────────────────────────────────────
const DASH = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const fn = (name) => { const i = DASH.indexOf(`function ${name}(`); if (i < 0) throw new Error('missing ' + name); const j = DASH.indexOf('\n}\n', i); return DASH.slice(i, j + 2); };
const oneLine = (name) => { const i = DASH.indexOf(`function ${name}(`); return DASH.slice(i, DASH.indexOf('\n', i)); };
const PI = JSON.parse(fs.readFileSync(path.join(ROOT, 'player-photos', 'index.json'), 'utf8'));
const ctx = { playerPhotoIndex: PI.players };
vm.createContext(ctx);
vm.runInContext([oneLine('escapeHtml'), fn('playerPhotoUrl'), fn('playerPhotoImg')].join('\n'), ctx);
const anyKey = Object.keys(PI.players)[0];
check(`playerPhotoUrl(ID) = OUR stored copy, small by default and large on request, cache-busted by its hash (${anyKey})`,
  ctx.playerPhotoUrl(anyKey) === `player-photos/s/${anyKey}.webp?v=${PI.players[anyKey].s}` && ctx.playerPhotoUrl(anyKey, 'l') === `player-photos/l/${anyKey}.webp?v=${PI.players[anyKey].l}`
  && ctx.playerPhotoUrl(Number(anyKey)) === ctx.playerPhotoUrl(anyKey));
check('playerPhotoUrl: an ID without an alias, null, empty, or a NAME = null (a monogram, never a guess)',
  [999999999, null, '', 'J. Sinner', 'Jannik Sinner', '1307', '2672'].every((k) => ctx.playerPhotoUrl(k) === null));
const img = ctx.playerPhotoImg(anyKey, `O'Brien <x>`);
check('playerPhotoImg: one shared layer — class sf-ph, lazy, decoding async, alt = the escaped name, failed load removes itself',
  /^<img class="sf-ph" /.test(img) && /loading="lazy"/.test(img) && /decoding="async"/.test(img) && /alt="O&#39;Brien &lt;x&gt;"/.test(img) && /onload="this\.classList\.add\('sf-on'\)"/.test(img) && /onerror="this\.remove\(\)"/.test(img));
check('playerPhotoImg: no photo = "" (the surface\'s own monogram stays)', ctx.playerPhotoImg('999999999', 'X') === '');
check('.sf-ph: one cover crop, centred; the circle\'s own fill behind the PNG only once loaded (the monogram shows until then)',
  /\.sf-ph\{[^}]*position:absolute;[^}]*border-radius:50%;[^}]*object-fit:cover;[^}]*object-position:50% 50%;[^}]*\}/.test(DASH) && !/\.sf-ph\{[^}]*background/.test(DASH) && /\.sf-ph\.sf-on\{ background:inherit; \}/.test(DASH));

// ── 3. every surface asks the resolver; no retired source survives ──────────────────────────────────────────────
const FRONT = ['bsp-consult-dashboard.html', 'trading-report.js', 'series.js', 'draw-view.js', 'player-profile-v2.js', 'live-tab.js', 'drops-page.js'];
const RETIRED = ['photoCandidatesFor', 'photoOverrideFor', 'player-photos.json', 'resolveProfilePhotoUrl', 'avatarChainNext(', '_player_logo',
  'p1PhotoUrl', 'p2PhotoUrl', 'logo-tennis', 'wikimedia', 'Special:FilePath',
  'player-headshot', 'atpPhotoFor', 'loadPlayerAtpAliases'];   // founder 2026-10-24: no page loads a photo from ATP's servers
const hits = [];
for (const f of FRONT) { const s = fs.readFileSync(path.join(ROOT, f), 'utf8'); RETIRED.forEach((r) => { if (s.includes(r)) hits.push(`${f}: ${r}`); }); }
check('no retired photo source anywhere in the frontend (Wikimedia, player-photos.json, the api-tennis logo, the old chain)', hits.length === 0, hits.join('; '));
const USES = [
  ['Today\'s Matches cards', 'bsp-consult-dashboard.html', 'const img = playerPhotoImg(playerKey, name);'],
  ['legacy profile hero', 'bsp-consult-dashboard.html', "const src = playerPhotoUrl(playerKey, 'l');"],
  ['Players page cards', 'bsp-consult-dashboard.html', 'const photo = playerPhotoImg(p.key, p.name);'],
  ['Match analysis header + Form/H2H rows', 'bsp-consult-dashboard.html', 'attrs = profileLinkAttrs(key, name), src = playerPhotoUrl(key);'],
  ['Ratings board', 'bsp-consult-dashboard.html', "playerPhotoImg(String(p.key), p.name)"],
  ['Stennisfy Model head', 'bsp-consult-dashboard.html', "playerPhotoImg(key, name) : ''}</span>`;"],
  ['H2H picked cards', 'bsp-consult-dashboard.html', 'playerPhotoImg(String(v.a.key), v.a.full)'],
  ['Live page', 'bsp-consult-dashboard.html', "playerPhotoImg(String(key),name):''}</span>"],
  ['Trading Report', 'trading-report.js', 'playerPhotoImg(String(row.key), row.name)'],
  ['Series cards', 'series.js', "playerPhotoImg(String(key), name)"],
  ['Draw view', 'draw-view.js', 'window.playerPhotoUrl(String(s.playerKey))'],
  ['Player Profile (V2)', 'player-profile-v2.js', "window.playerPhotoUrl(p.key, 'l')"],
  ['Dropping Odds', 'drops-page.js', 'playerPhotoImg(r.photoKey, r.dSide || r.side)'],
  ['Tournament quotes', 'bsp-consult-dashboard.html', 'playerPhotoImg(String(qt.playerKey), qt.player)'],
];
const missing = USES.filter(([, f, t]) => !fs.readFileSync(path.join(ROOT, f), 'utf8').includes(t)).map(([l]) => l);
check(`every avatar surface reads the one resolver (${USES.length} surfaces)`, missing.length === 0, 'missing: ' + missing.join(', '));
const mutant = DASH.replace('  const e = playerPhotoIndex[String(playerKey)];', "  const e = playerPhotoIndex[String(playerKey)]; if (!e) return 'https://www.atptour.com/-/media/alias/player-headshot/' + playerKey;");
check('control: the mutant applied (an ATP fallback inside the resolver)', mutant !== DASH);
check('control: a second source slipped into the resolver is caught by the retired-source scan', RETIRED.some((r) => mutant.includes(r)));

// ── 4. Drops: a row's ID only through its one Today's Matches fixture (founder 2026-10-23, Kibl rule) ──────────────
const DROPS = require(path.join(ROOT, 'drops-page.js'));
const T0 = Date.parse('2026-10-22T18:00:00Z');
const at = (h) => new Date(T0 + h * 3600e3).toISOString();
const card = (p1, p1Key, p2, p2Key, h) => ({ p1, p1Key, p2, p2Key, _start: T0 + h * 3600e3 });
const startOf = (m) => m._start;
const BOARD = [card('D. Altmaier', 1099, 'T. Fritz', 1500, 0), card('M. Damm', 1317, 'F. Cerundolo', 1104, 2), card('C. Ugo Carabelli', 11, 'D. Vallejo', 12, 1)];
const row = (a, b, side, h) => ({ playerA: a, playerB: b, side, start: at(h) });
const K = (r, board) => DROPS.photoKeyFor(r, board || BOARD, startOf);
check('Drops: both names, either order, the side\'s own card key (Altmaier v Fritz -> 1099; Fritz side -> 1500)',
  K(row('Daniel Altmaier', 'Taylor Fritz', 'Daniel Altmaier', 0.5)) === '1099' && K(row('Taylor Fritz', 'Daniel Altmaier', 'Taylor Fritz', 0)) === '1500');
check('Drops: a trailing Jr / Sr is dropped (Martin Damm Jr -> 1317)', K(row('Martin Damm Jr', 'Francisco Cerundolo', 'Martin Damm Jr', 2)) === '1317');
check('Drops: extra given names never block (Adolfo Daniel Vallejo = D. Vallejo)', K(row('Camilo Ugo Carabelli', 'Adolfo Daniel Vallejo', 'Adolfo Daniel Vallejo', 1)) === '12');
check('Drops: compound surnames whole — Carlos Carabelli is not C. Ugo Carabelli (no ID)', K(row('Carlos Carabelli', 'Adolfo Daniel Vallejo', 'Carlos Carabelli', 1)) === null);
check('Drops: a start more than 24 h from the card = no candidate; an unmeasurable start = no candidate', K(row('Daniel Altmaier', 'Taylor Fritz', 'Daniel Altmaier', 25)) === null && K({ playerA: 'Daniel Altmaier', playerB: 'Taylor Fritz', side: 'Daniel Altmaier', start: null }) === null);
check('Drops: two qualifying cards = no ID, never a pick', K(row('Daniel Altmaier', 'Taylor Fritz', 'Daniel Altmaier', 0), BOARD.concat([card('D. Altmaier', 9, 'T. Fritz', 10, 3)])) === null);
check('Drops: a Challenger / ITF row (no Today\'s Matches card) = no ID, the monogram', K(row('Diego Dedura', 'Felipe Meligeni Alves', 'Diego Dedura', 0)) === null);

// ── 5. Quotes: the speaker rule lives in the importer (tools/test-quote-speaker.js); the page only reads its ID ───────
check('Quotes: the page carries no copy of the speaker rule and does not load quote-entrants.json (one rule: the importer)',
  !DASH.includes('function tourxQuoteSpeakerKey') && !DASH.includes("fetch('./quote-entrants.json'"));
const QE = JSON.parse(fs.readFileSync(path.join(ROOT, 'quote-entrants.json'), 'utf8'));
const qeBad = [];
for (const [k, e] of Object.entries(QE.events || {})) {
  (e.main || []).forEach((x) => { if (x.key != null && !aliases[x.key]) qeBad.push(k + ' ' + x.name + ' key ' + x.key + ' has no alias (the ID chain is code -> alias)'); });
  (e.qual || []).forEach((x) => { if (x.key != null) qeBad.push(k + ' qualifier ' + x.name + ' carries a key (no ID chain exists for qualifiers)'); });
}
check('quote-entrants.json: every main-draw key came through the alias map; no qualifier carries a key', Object.keys(QE.events || {}).length > 0 && qeBad.length === 0, qeBad.slice(0, 5).join('; '));

// ── 7. Ratings: the published store carries the row's player ID (the whitelist, not the push) ───────────────────────
// 2026-10-23: rows.push carried key, the serialisation whitelist did not, and a real rebuild shipped 0 of 237 IDs.
const SR = fs.readFileSync(path.join(ROOT, 'surface-ratings.js'), 'utf8');
const serial = (src) => { const m = src.match(/\n\s*players: rows\.map\(r => \(\{([^}]*)\}\)\)/); return m ? m[1] : null; };
const names = (fields) => (fields || '').split(',').map((s) => s.split(':')[0].trim()).filter(Boolean);
check('Ratings: the published store names key (the row\'s player ID) — the field the board resolves its photo by',
  names(serial(SR)).includes('key') && /rows\.push\(\{ key: meta\.key,/.test(SR), serial(SR));
check('control: the pre-fix whitelist (no key) is caught',
  !names(serial("\n    players: rows.map(r => ({ name: r.name, rank: r.rank, challResolved: r.challResolved, surfaces: r.surfaces })),")).includes('key'));

// ── 6. The Wikimedia map is out of the pipeline (founder 2026-10-23) ───────────────────────────────────────────────
const PIPE = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
check('player-photos.json: not published, and the map, its generator and its validator are gone',
  !PIPE.includes('player-photos.json') && !['player-photos.json', 'enrich-player-photos.py', 'validate-player-photos.js'].some((f) => fs.existsSync(path.join(ROOT, f))));

// ── 8. self-hosted headshots (founder 2026-10-24): the stored files, the index, the update rule, the alert ─────────
const webpDims = (buf) => { // VP8X: canvas width/height minus one, 24-bit LE at bytes 24..29
  if (buf.slice(0, 4).toString() !== 'RIFF' || buf.slice(8, 12).toString() !== 'WEBP') return null;
  if (buf.slice(12, 16).toString() === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (buf.slice(12, 16).toString() === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (buf.slice(12, 16).toString() === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  return null; };
const crypto = require('crypto');
const bad8 = [];
for (const [id, e] of Object.entries(PI.players)) {
  if (aliases[id] !== e.code) bad8.push(`${id}: index code ${e.code} is not the alias ${aliases[id]}`);
  if ((manifest.placeholders || []).some((p) => p.sha1_16 === e.srcSha1)) bad8.push(`${id}: a known placeholder`);
  for (const [s, px] of [['s', 96], ['l', 256]]) {
    const f = path.join(ROOT, 'player-photos', s, id + '.webp');
    if (!fs.existsSync(f)) { bad8.push(`${id}: missing ${s}`); continue; }
    const buf = fs.readFileSync(f); const d = webpDims(buf);
    if (!d || d[0] !== px || d[1] !== px) bad8.push(`${id} ${s}: ${d ? d.join('x') : 'not WebP'} (expected ${px}x${px})`);
    if (crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10) !== e[s]) bad8.push(`${id} ${s}: hash differs from the index (stale cache-buster)`);
  }
}
check(`stored photos: ${Object.keys(PI.players).length} IDs, each a 96 px and a 256 px WebP whose hash is the index's, under the alias's own code, no placeholder`,
  Object.keys(PI.players).length > 0 && bad8.length === 0, bad8.slice(0, 6).join('; '));
check('index coverage is what it lists (stored = entries; aliases = the alias map)',
  PI.coverage.stored === Object.keys(PI.players).length && PI.coverage.aliases === Object.keys(aliases).length);
const stray = []; for (const s of ['s', 'l']) for (const f of fs.readdirSync(path.join(ROOT, 'player-photos', s))) if (!PI.players[f.replace(/\.webp$/, '')]) stray.push(s + '/' + f);
check('no stored photo outside the index (a removed alias leaves no file the page could still reach)', stray.length === 0, stray.slice(0, 6).join(', '));
// the update rule, through the module the fetcher uses (no browser needed)
const { execFileSync: xf } = require('child_process');
const rule = JSON.parse(xf(process.execPath, ['--input-type=module', '-e', `
  import { nextIndex, coverageDropped } from ${JSON.stringify(require('url').pathToFileURL(path.join(ROOT, 'tools', 'photos', 'photo-index.mjs')).href)};
  const prev = { 1: { code: 'A1', s: 'old1' }, 2: { code: 'B2', s: 'old2' }, 3: { code: 'C3', s: 'old3' }, 4: { code: 'D4', s: 'old4' } };
  const aliases = { 1: 'A1', 2: 'B2', 4: 'D9', 5: 'E5' };            // 3 removed from the map; 4 re-pointed to another code
  const full = nextIndex({ aliases, prev, results: { 1: { ok: false, why: 403 }, 2: { ok: true, entry: { code: 'B2', s: 'new2' } }, 4: { ok: false, why: 403 }, 5: { ok: true, entry: { code: 'E5', s: 'new5' } } } });
  const part = nextIndex({ aliases, prev, results: { 5: { ok: true, entry: { code: 'E5', s: 'new5' } } }, only: new Set(['5']) });
  console.log(JSON.stringify({ full, part, drop: coverageDropped({ aliases: 182, stored: 182 }, { aliases: 182, stored: 170 }), same: coverageDropped({ aliases: 182, stored: 182 }, { aliases: 183, stored: 183 }) }));`], { encoding: 'utf8' }));
check('update rule: a failed fetch keeps the last good photo (with lastError) — never a deletion',
  rule.full.players[1] && rule.full.players[1].s === 'old1' && rule.full.players[1].lastError === '403' && rule.full.kept.includes('1'));
check('update rule: a fetched photo replaces; a new alias is added; an alias removed from the map is dropped; a re-pointed alias keeps nothing of the old code',
  rule.full.players[2].s === 'new2' && rule.full.players[5].s === 'new5' && !rule.full.players[3] && rule.full.removed.includes('3') && !rule.full.players[4] && rule.full.removed.includes('4'));
check('update rule: a partial run carries every unfetched photo over', rule.part.players[1].s === 'old1' && rule.part.players[2].s === 'old2' && rule.part.players[5].s === 'new5');
check('coverage alert: a share drop (182/182 -> 170/182) is flagged; a same share on a grown map is not', rule.drop === true && rule.same === false);
const tmpI = path.join(require('os').tmpdir(), 'pp-cov-' + process.pid + '.json');
fs.writeFileSync(tmpI, JSON.stringify({ coverage: { aliases: 182, stored: 182 } }));
const covOut = xf(process.execPath, [path.join(ROOT, 'tools', 'photos', 'coverage-check.mjs'), '--index', tmpI, '--prev', tmpI], { encoding: 'utf8' });
fs.writeFileSync(tmpI + '2', JSON.stringify({ coverage: { aliases: 182, stored: 150 } }));
const covDrop = xf(process.execPath, [path.join(ROOT, 'tools', 'photos', 'coverage-check.mjs'), '--index', tmpI + '2', '--prev', tmpI], { encoding: 'utf8' });
check('coverage-check: an unchanged share prints no warning; a drop prints a ::warning:: and still exits 0 (never blocks the publish)',
  !/::warning::/.test(covOut) && /::warning::player photos: STORED-PHOTO COVERAGE DROPPED 182\/182 -> 150\/182/.test(covDrop));
fs.rmSync(tmpI, { force: true }); fs.rmSync(tmpI + '2', { force: true });
// the lane: the photo job's commits are data, and only the photo files are
const lane = JSON.parse(xf(process.execPath, ['--input-type=module', '-e', `
  import { isDataPath, isDataCommit } from ${JSON.stringify(require('url').pathToFileURL(path.join(ROOT, 'tools', 'deploy-lane.mjs')).href)};
  console.log(JSON.stringify([isDataPath('player-photos/s/1764.webp'), isDataPath('player-photos/l/1764.webp'), isDataPath('player-photos/index.json'),
    isDataPath('player-photos/s/x.webp'), isDataPath('player-photos/s/1.png'), isDataPath('player-photos/run.js'), isDataPath('player-photos/s/1.webp.js'),
    isDataCommit({ subject: 'chore(photos): weekly headshot refresh [skip ci]', authorEmail: 'bot@bspconsult.local', files: ['player-photos/s/1.webp', 'player-photos/index.json'] }),
    isDataCommit({ subject: 'chore(photos): refresh [skip ci]', authorEmail: 'bot@bspconsult.local', files: ['player-photos/s/1.webp', 'bsp-consult-dashboard.html'] })]));`], { encoding: 'utf8' }));
check('lane: the photo job\'s files are data (s/l <id>.webp + index.json); anything else there, or a commit mixing code in, is not',
  JSON.stringify(lane) === JSON.stringify([true, true, true, false, false, false, false, true, false]), JSON.stringify(lane));
const PIPE8 = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
check('pipeline publishes player-photos/ and runs the coverage alert without blocking', /cp -r player-photos _site\//.test(PIPE8) && /^\s+node tools\/photos\/coverage-check\.mjs\s*$/m.test(PIPE8));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
