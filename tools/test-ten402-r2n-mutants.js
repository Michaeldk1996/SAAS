// TEN-402 round 2, builder N (founder card 7bc622d5: "rename the Tournaments page too") — every check that locks the
// display rule in test-ten402-r2n.mjs must FAIL when the rule is reverted or bent. Each mutant is applied to a copy of
// bsp-consult-dashboard.html (TEN402_HTML) and the suite runs against it; a mutant that leaves it green is a vacuous test
// and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const TN = "typeof tourxEventName === 'function' ? tourxEventName(T.name) : T.name";
const MUTANTS = [
  // ---- the name itself
  ['the page ignores SF_EVENT_NAMES (city keys back)', "  return (typeof SF_EVENT_NAMES !== 'undefined' && SF_EVENT_NAMES[key]) || String(key == null ? '' : key);",
    "  return String(key == null ? '' : key);"],
  ['Montreal / Toronto print the same "Canadian Open"', '  return (tourxEventShared[off] || 0) > 1 && off !== key ? off + TOURX_EVENT_CITY_SUFFIX + key : off;', '  return off;'],
  ['every renamed event carries its city', '  return (tourxEventShared[off] || 0) > 1 && off !== key ? off + TOURX_EVENT_CITY_SUFFIX + key : off;',
    '  return off !== key ? off + TOURX_EVENT_CITY_SUFFIX + key : off;'],
  // ---- search (the rail and the hero / overlays moved to tournaments-overview.js and print the city key — founder ruling 1,
  //      2026-11-15; their mutants are retired with test-ten402-r2n.mjs r2.2 rail / r2.3)
  ['search forgets the city', "  return [tourxEventName(key), off, key].concat(also).join(' | ').toLowerCase();", "  return [tourxEventName(key), off].concat(also).join(' | ').toLowerCase();"],
  ['search forgets the other catalog spelling (French Open)', "  return [tourxEventName(key), off, key].concat(also).join(' | ').toLowerCase();", "  return [tourxEventName(key), off, key].join(' | ').toLowerCase();"],
  // ---- Reports: retired 2026-11-15 (founder ruling 1: the rebuilt Reports prints the city key; test-ten402-r2n.mjs r2.4)
  // ---- Entry list: retired 2026-11-15 (founder ruling 1: the rebuilt Entry list prints the city key; tools/test-tt-entry.mjs)
  // ---- H2H chips
  ['the H2H suggestion chip prints the board word', "event: pr[2] ? (typeof sfEventName === 'function' ? sfEventName(pr[2]) : pr[2]) : '',", "event: pr[2] || '',"],
  // ════ round 3 (one name site-wide) ════
  // ---- Match analysis
  ['r3: trName prints the city', "function trName(m){ const c = trClean(m); return c !== 'Tournament' && typeof sfEventName === 'function' ? sfEventName(c) : c; }",
    'function trName(m){ return trClean(m); }'],
  ['r3: the Tournament tab title prints the city', "  const clean = trName(m), cs = m.courtSpeed,", "  const clean = trClean(m), cs = m.courtSpeed,"],
  ['r3: "Record at" prints the city', '  const clean = trName(m);   // r3 fix 1: "Record at Shanghai Masters"', '  const clean = trClean(m);'],
  ['r3: the edition headers print the city', '  const S = _tr.S, clean = trName(m);', '  const S = _tr.S, clean = trClean(m);'],
  ['r3: the hold tip prints the city', '  const ev = trName(m);   // r3 fix 1: the printed name', '  const ev = trClean(m);'],
  ['r3: the hold lookup reads the printed name', ': _trHoldData.byName[trClean(m).toLowerCase()];', ': _trHoldData.byName[trName(m).toLowerCase()];'],   // the name fallback (a card with no tournamentKey)
  ['r3: the modal subtitle prints the feed name', "  return [ev, roundText, t].filter(Boolean).join(' · ');", "  return [m.tour, roundText, t].filter(Boolean).join(' · ');"],
  ['r3: Key factors\' card title prints the city', '${fhEsc(tier ? `${trName(m)} · ${tier}` : trName(m))}', '${fhEsc(tier ? `${clean} · ${tier}` : clean)}'],
  ['r3: Key factors\' catalog match reads the printed name', 'const catHit = TOURNAMENT_CATALOG.find(t => t.name.toLowerCase() === clean.toLowerCase());',
    'const catHit = TOURNAMENT_CATALOG.find(t => t.name.toLowerCase() === trName(m).toLowerCase());'],
  ['r3: the MA ROI chip prints the key', "initialTournamentLabel: typeof tourxEventName === 'function' ? tourxEventName(key) : key, side: E.S.roi });", 'initialTournamentLabel: key, side: E.S.roi });'],
  ['r3: the Progression header prints the city', "color:var(--text-label);\">${fhEsc(typeof sfEventName === 'function' ? sfEventName(P.tourn) : P.tourn)}</span>", 'color:var(--text-label);">${fhEsc(P.tourn)}</span>'],
  ['r3: the weather court-speed line prints the city', "  const tourName = (m && m.tour && typeof sfEventName === 'function' ? sfEventName(m.tour) : String((m && m.tour) || '').replace(/^ATP\\s+/, '')) || '—';",
    "  const tourName = String((m && m.tour) || '').replace(/^ATP\\s+/, '') || '—';"],
  // ---- Matches board
  ['r3: mxEventName prints the feed name', "function mxEventName(tour){ return tour && typeof sfEventName === 'function' ? sfEventName(tour) : (tour || ''); }", "function mxEventName(tour){ return tour || ''; }"],
  ['r3: the card head prints the feed name', '>${mxEventName(m.tour)}</span>\n        ${roundBadge ?', '>${m.tour}</span>\n        ${roundBadge ?'],
  ['TEN-407: the card head appends the level', '>${mxEventName(m.tour)}</span>\n        ${roundBadge ?', '>${mxEventName(m.tour)}${tierSuffix}</span>\n        ${roundBadge ?'],
  ['r3: the story strip prints the feed name', '<div class="mc-story__ctx">${[mxEventName(u0.m.tour), mxRoundLabel(u0.m)', "<div class=\"mc-story__ctx\">${[u0.m.tour || '', mxRoundLabel(u0.m)"],
  ['r3: the chip label prints the feed name', 'aria-pressed="${active}">${mxTourKeyName(t)}${active', 'aria-pressed="${active}">${t}${active'],
  ['r3: the chip filters on the printed name', 'data-tournament="${t.replace(/"/g,\'&quot;\')}"', 'data-tournament="${mxEventName(t).replace(/"/g,\'&quot;\')}"'],
  ['r3: the chips ordered by the feed name', ')].sort((a, b) => mxTourKeyName(a).localeCompare(mxTourKeyName(b)));', ')].sort();'],
  // ---- the one-name function
  ['r3: the row city never breaks a shared name', '  if (ck && ck !== hit && SF_EVENT_NAMES[hit] && SF_EVENT_NAMES[ck] === SF_EVENT_NAMES[hit]) return ck;', ''],
  ['r3: the row city moves any event', '  if (ck && ck !== hit && SF_EVENT_NAMES[hit] && SF_EVENT_NAMES[ck] === SF_EVENT_NAMES[hit]) return ck;', '  if (ck) return ck;'],
  ['r3: the ATP Cup prints "Cup"', "const SF_EVENT_LITERAL = { 'cup': 'ATP Cup' };", 'const SF_EVENT_LITERAL = {};'],
];
// The profile module (player-profile-v2.js, TEN402_PP2): Record per tournament.
const PP2_SRC = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
const PP2_MUTANTS = [
  ['r3: the profile row ignores the page\'s one name', "    var sf = typeof window.sfEventName === 'function' ? window.sfEventName : null;", '    var sf = null;'],
  ['r3: the tier back in the profile row\'s name', '    if (one) return one;', "    if (one) return level && level !== 'Grand Slam' ? one + ' ' + level : one;"],
  ['r3: the profile row drops its level meta', "(tournLevelMeta(t.level) ? '<span class=\"pp2-tlevel\"", "(false ? '<span class=\"pp2-tlevel\""],
  ['r3: the year-end finals carry a level meta', "return !level || level === 'Grand Slam' || level === 'Tour Finals' ? '' : String(level);", "return !level || level === 'Grand Slam' ? '' : String(level);"],
  // Profile v2: the search test sits inside the level/surface filter (renderTournModal) — same rule, new line.
  ['r3: search forgets the tier', " ||\n        tournLevelMeta(t.level).toLowerCase().indexOf(q) >= 0)) return false;", ')) return false;'],
];
const SUITES = ['test-ten402-r2n.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
// Control: the unmutated file must pass, or every "caught" below means nothing.
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated file — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated file passes');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten402r2n-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, src.replace(from, to));
  if (run({ TEN402_HTML: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
for (const [name, from, to] of PP2_MUTANTS) {
  if (PP2_SRC.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.js');
  fs.writeFileSync(file, PP2_SRC.replace(from, to));
  if (run({ TEN402_PP2: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length + PP2_MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
