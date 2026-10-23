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
const ctx = { playerAtpAliases: aliases };
vm.createContext(ctx);
vm.runInContext([oneLine('escapeHtml'), fn('atpPhotoFor'), oneLine('playerPhotoUrl'), fn('playerPhotoImg')].join('\n'), ctx);
const anyKey = Object.keys(aliases)[0];
check(`playerPhotoUrl(ID) = the ATP headshot for that ID's code (${anyKey} -> ${aliases[anyKey]})`,
  ctx.playerPhotoUrl(anyKey) === `https://www.atptour.com/-/media/alias/player-headshot/${aliases[anyKey]}` && ctx.playerPhotoUrl(Number(anyKey)) === ctx.playerPhotoUrl(anyKey));
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
  'p1PhotoUrl', 'p2PhotoUrl', 'logo-tennis', 'wikimedia', 'Special:FilePath'];
const hits = [];
for (const f of FRONT) { const s = fs.readFileSync(path.join(ROOT, f), 'utf8'); RETIRED.forEach((r) => { if (s.includes(r)) hits.push(`${f}: ${r}`); }); }
check('no retired photo source anywhere in the frontend (Wikimedia, player-photos.json, the api-tennis logo, the old chain)', hits.length === 0, hits.join('; '));
const USES = [
  ['Today\'s Matches cards', 'bsp-consult-dashboard.html', 'const img = playerPhotoImg(playerKey, name);'],
  ['legacy profile hero', 'bsp-consult-dashboard.html', 'const src = playerPhotoUrl(playerKey);'],
  ['Players page cards', 'bsp-consult-dashboard.html', 'const photo = playerPhotoImg(p.key, p.name);'],
  ['Match analysis header + Form/H2H rows', 'bsp-consult-dashboard.html', 'attrs = profileLinkAttrs(key, name), src = playerPhotoUrl(key);'],
  ['Ratings board', 'bsp-consult-dashboard.html', "playerPhotoImg(String(p.key), p.name)"],
  ['Stennisfy Model head', 'bsp-consult-dashboard.html', "playerPhotoImg(key, name) : ''}</span>`;"],
  ['H2H picked cards', 'bsp-consult-dashboard.html', 'playerPhotoImg(String(v.a.key), v.a.full)'],
  ['Live page', 'bsp-consult-dashboard.html', "playerPhotoImg(String(key),name):''}</span>"],
  ['Trading Report', 'trading-report.js', 'playerPhotoImg(String(row.key), row.name)'],
  ['Series cards', 'series.js', "playerPhotoImg(String(key), name)"],
  ['Draw view', 'draw-view.js', 'window.playerPhotoUrl(String(s.playerKey))'],
  ['Player Profile (V2)', 'player-profile-v2.js', 'window.playerPhotoUrl(p.key)'],
  ['Dropping Odds', 'drops-page.js', 'playerPhotoImg(r.photoKey, r.dSide || r.side)'],
  ['Tournament quotes', 'bsp-consult-dashboard.html', 'tourxQuoteSpeakerKey(qt, c.name)'],
];
const missing = USES.filter(([, f, t]) => !fs.readFileSync(path.join(ROOT, f), 'utf8').includes(t)).map(([l]) => l);
check(`every avatar surface reads the one resolver (${USES.length} surfaces)`, missing.length === 0, 'missing: ' + missing.join(', '));
const mutant = DASH.replace('function playerPhotoUrl(playerKey){ return atpPhotoFor(playerKey); }', 'function playerPhotoUrl(playerKey){ return atpPhotoFor(playerKey) || photoOverrideFor(playerKey); }');
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

// ── 5. Quotes: surname against that season's entrants; the initial only when it leaves exactly one ────────────────
const qctx = { tournamentProfiles: {
  Madrid: { allEditionMatches: [{ season: '2026', matches: [{ p1: 'F. Cerundolo', p1Key: 1104, p2: 'J. M. Cerundolo', p2Key: 388 }, { p1: 'C. Alcaraz', p1Key: 2382, p2: 'T. Daniel', p2Key: 2406 }] }] },
  'French Open': { allEditionMatches: [{ season: '2025', matches: [{ p1: 'J. Sinner', p1Key: 2072, p2: 'A. Zverev', p2Key: 1980 }] }] },
  'Roland Garros': null } };
vm.createContext(qctx);
vm.runInContext(fn('tourxQuoteSpeakerKey').replace(/^function/, "const TOURX_QUOTE_PROFILE_ALIAS = { 'Roland Garros': 'French Open' };\nfunction"), qctx);
const QK = (player, ev, year) => qctx.tourxQuoteSpeakerKey({ player, year }, ev);
check('Quotes: a unique surname among that season\'s entrants -> its ID (T. Daniel, Madrid 2026 -> 2406)', QK('T. Daniel', 'Madrid', 2026) === '2406');
check('Quotes: the initial separates same-surname entrants (F. Cerundolo -> Francisco 1104; J. M. Cerundolo -> 388)', QK('F. Cerundolo', 'Madrid', 2026) === '1104' && QK('J. M. Cerundolo', 'Madrid', 2026) === '388');
check('Quotes: no initial with two same-surname entrants, or an initial that fits neither = monogram (null)', QK('Cerundolo', 'Madrid', 2026) === null && QK('X. Cerundolo', 'Madrid', 2026) === null);
check('Quotes: no edition on record for that season, or no entrant of that surname = monogram (null)', QK('T. Daniel', 'Madrid', 2021) === null && QK('D. Rincon', 'Madrid', 2026) === null);
check('Quotes: Roland Garros reads the French Open profile (J. Sinner 2025 -> 2072)', QK('J. Sinner', 'Roland Garros', 2025) === '2072');
// round 3b: Sackmann main draw for a season the store lacks; qualifying entrants join the pool; a key-null match = monogram
qctx.tourxQuoteEntrants = {
  'Monte Carlo|2021': { main: [{ name: 'Daniel Evans', key: '2835' }, { name: 'Novak Djokovic', key: '1' }], qual: [{ name: 'Mackenzie Evans', key: null }] },
  'Madrid|2026': { qual: [{ name: 'Daniel Rincon', key: null }, { name: 'Felipe Daniel', key: null }] },
  'Madrid|2023': { qual: [{ name: 'Daniel Rincon', key: null }] } };
check('Quotes 3b: a pre-2022 season reads Sackmann\'s main draw; the initial separates a qualifier of the same surname (D. Evans -> 2835)', QK('D. Evans', 'Monte Carlo', 2021) === '2835');
check('Quotes 3b: no initial and a same-surname qualifier = ambiguous = monogram (Evans)', QK('Evans', 'Monte Carlo', 2021) === null);
check('Quotes 3b: a unique qualifier with no ID chain = monogram, never a guessed ID (D. Rincon, Madrid 2023)', QK('D. Rincon', 'Madrid', 2023) === null);
check('Quotes 3b: a qualifier sharing a store entrant\'s surname makes it ambiguous unless the initial separates (T. Daniel -> 2406 stays; Daniel alone null)',
  QK('T. Daniel', 'Madrid', 2026) === '2406' && QK('Daniel', 'Madrid', 2026) === null);
const QE = JSON.parse(fs.readFileSync(path.join(ROOT, 'quote-entrants.json'), 'utf8'));
const qeBad = [];
for (const [k, e] of Object.entries(QE.events || {})) {
  (e.main || []).forEach((x) => { if (x.key != null && !aliases[x.key]) qeBad.push(k + ' ' + x.name + ' key ' + x.key + ' has no alias (the ID chain is code -> alias)'); });
  (e.qual || []).forEach((x) => { if (x.key != null) qeBad.push(k + ' qualifier ' + x.name + ' carries a key (no ID chain exists for qualifiers)'); });
}
check('quote-entrants.json: every main-draw key came through the alias map; no qualifier carries a key', Object.keys(QE.events || {}).length > 0 && qeBad.length === 0, qeBad.slice(0, 5).join('; '));
check('quote-entrants.json is published (pipeline copy) — committed but not copied = a silent 404', PIPE_QE());
function PIPE_QE() { return fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8').includes('cp quote-entrants.json _site/'); }

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
