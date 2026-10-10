// TEN-421 step 13 (Trading Report) — every check in test-ten421-trading.mjs must FAIL when its rule is reverted or bent.
// Each mutant is applied to a copy of trading-report.js (TEN421_SRC) or of bsp-consult-dashboard.html (TEN421_HTML) and
// the suite runs against it; a mutant that leaves it green is a vacuous test and fails this runner. Anchors occur
// exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { js: path.join(ROOT, 'trading-report.js'), html: path.join(ROOT, 'bsp-consult-dashboard.html') };
const SRC = { js: fs.readFileSync(FILES.js, 'utf8'), html: fs.readFileSync(FILES.html, 'utf8') };
const MUTANTS = [
  ['js', 'slate: the frozen m.day, not the board\'s day bucket', "return m && tmBucket(m) === day && !tmFinished(m); })", "return m && m.day === day && !tmFinished(m); })"],
  ['js', 'slate: not in the board\'s m.time order', "      .sort(function (a, b) { return String(a.time || '').localeCompare(String(b.time || '')); });\n  }", "      .slice();\n  }"],
  ['js', 'slate: finished matches kept', "return m && tmBucket(m) === day && !tmFinished(m); })", "return m && tmBucket(m) === day; })"],
  ['js', 'slate: a match the Live feed shows in play stays a pre-match row', "if (day === 'today' && isMatchLive(m)) return;", "if (false) return;"],
  ['js', 'R3: a close fallback back (column shows a price the card face does not)', "      return { price: Number(pair[who]), book: cardBookName(pair.book, pair), kind: 'now' };\n    }\n    return null;", "      return { price: Number(pair[who]), book: cardBookName(pair.book, pair), kind: 'now' };\n    }\n    try { var c = _mcCloseOf(m, who); if (c != null) return { price: Number(c), book: 'Bet105', kind: 'close' }; } catch (e) {}\n    return null;"],
  ['js', 'R3 review: another day\'s card lends its time and price', "      if (m.live && !flagged) flagged = m;", "      if (!flagged) flagged = m;"],
  ['js', 'R3: live row time from the feed, not the card', "      startClock: slate ? startClockOf(slate) : startClockOf({ date: f.event_date, time: f.event_time }),", "      startClock: startClockOf({ date: f.event_date, time: f.event_time }),"],
  ['js', 'R2: header Today back to the board count (overlaps Live)', "var slateCount = slateRows(S.day).length / 2;", "var slateCount = tmSlate(S.day).length;"],
  ['js', 'R2: field pooled over the view, not the whole day', "      fieldPool.forEach(function (r) {", "      pool.forEach(function (r) {"],
  ['js', 'R2 review: menu counts ignore the search', "        V.searched.forEach(function (r) { var t = V.tierOf(r, mk); if (t) counts[t]++; });", "        V.pool.forEach(function (r) { var t = V.tierOf(r, mk); if (t) counts[t]++; });"],
  ['js', 'R2 review: Surface-emptied view says the slate is empty', "      if (!V.rows.length) {", "      if (!V.pool.length) {"],
  ['js', 'R2: a greyed (n < 10) player still tiered', "      if (pn != null && pn < MIN_TIER_DEN) return null;\n", ""],
  ['js', 'row time: the raw api-tennis clock, not the member zone', "      startClock: startClockOf(m),", "      startClock: m.time || '',"],
  ['js', 'header: Live counts interrupted matches', "return _liveFixtures.filter(function (f) { return !isInterruptedFix(f); }).length;", "return _liveFixtures.length;"],
  ['js', 'live: Interrupted reads LIVE', "    if (row.interrupted) return '<span class=\"tr-pill int\">INT</span>';\n", ""],
  ['js', 'tomorrow: Live enabled', "segHtml('view', [['today', 'Pre-match'], ['live', 'Live']], S.live, S.day === 'tomorrow' ? 'live' : null)", "segHtml('view', [['today', 'Pre-match'], ['live', 'Live']], S.live, null)"],
  ['js', 'tomorrow: Live counts today\'s matches', "var live = S.day === 'tomorrow' ? 0 : inPlayCount();", "var live = inPlayCount();"],
  ['js', 'names: the card spelling, not the shared formatter', "      name: displayName(key, isFirst ? m.p1 : m.p2),", "      name: (isFirst ? m.p1 : m.p2),"],
  ['js', 'events: raw tournament label', "    var ev = eventLabel(m.tour);", "    var ev = m.tour;"],
  ['js', 'avatars: a photo back', "    return '<span class=\"tr-ava\">' + esc(playerInitials(row.name)) + '</span>';", "    return '<img class=\"tr-av\" src=\"x\" alt=\"\">';"],
  ['js', 'prices: the other player\'s price', "return { price: Number(pair[who]), book: cardBookName(pair.book, pair), kind: 'now' };", "return { price: Number(pair[who === 'p1' ? 'p2' : 'p1']), book: cardBookName(pair.book, pair), kind: 'now' };"],
  ['js', 'prices: the raw book key, not the card\'s name', "return { price: Number(pair[who]), book: cardBookName(pair.book, pair), kind: 'now' };", "return { price: Number(pair[who]), book: pair.book, kind: 'now' };"],
  ['js', 'Updated: the clock, not the split build', "var updated = (_indexOk && _builtAt != null) ? fmtZoneClock(_builtAt) : '—';", "var updated = fmtZoneClock(Date.now());"],
  ['js', 'Updated: shown when the splits did not load', "var updated = (_indexOk && _builtAt != null) ? fmtZoneClock(_builtAt) : '—';", "var updated = (_builtAt != null) ? fmtZoneClock(_builtAt) : '—';"],
  ['js', 'copy: hyphen in "Set Trading 2–0"', "label: 'Set Trading 2–0',", "label: 'Set Trading 2-0',"],
  ['js', 'columns: Lay Set Winner back to the TEN-192 order', "groups: [['lost', ['ls1ws2', 'ls1b1s2', 'ls1o1s2']], ['won', ['ws1w2', 'ws1wm', 'ws1b1s2']], ['all', ['bpw']]] },", "groups: [['lost', ['ls1ws2', 'ws1w2', 'ls1fb']], ['won', ['ls1bf', 'bpw', 'ws1wm']], ['all', ['bfs2aws1']]] },"],
  ['js', 'splits: the blended all-surfaces bucket', "    return t[tierKey][surf] || null;", "    return t[tierKey].all || null;"],
  ['js', 'R1: Broke 1st S2 back on the break-only denominator', "groups: [['lost', ['ls1ws2', 'ls1b1s2', 'ls1o1s2']]", "groups: [['lost', ['ls1ws2', 'ls1bf', 'ls1o1s2']]"],
  ['js', 'R1: Broken 1st S2 as the mirror of Broke 1st S2', "    var v = b[mk];\n", "    if (mk === 'ls1o1s2' && b.ls1bf) return [b.ls1bf[1] - b.ls1bf[0], b.ls1bf[1]];\n    var v = b[mk];\n"],
  ['js', 'card bafab40e: after-winning Broke 1st S2 back on the break-only denominator', "['won', ['ws1w2', 'ws1wm', 'ws1b1s2']]", "['won', ['ws1w2', 'ws1wm', 'bfs2aws1']]"],
  ['js', 'R1: tier from the raw gap, not the printed one', "var gap = Math.round((c[0] / c[1]) * 100) - Math.round(fa * 100);", "var gap = (c[0] / c[1] - fa) * 100;"],
  ['js', 'R1: the feed round back on line 2', "      event: ev,\n      surface: String(m.surface || '').toLowerCase(),", "      event: ev + ' · R1',\n      surface: String(m.surface || '').toLowerCase(),"],
  ['js', 'R1: window order 24 months · 52 weeks', "segHtml('win', [['52w', '52 weeks'], ['24m', '24 months']], S.win, null)", "segHtml('win', [['24m', '24 months'], ['52w', '52 weeks']], S.win, null)"],
  ['js', 'splits: 52 weeks read from the 24-month tree', "return S.win === '52w' ? (shard.tiers52w || null) : (shard.tiers || null);", "return shard.tiers || null;"],
  ['js', 'cells: total < 5 shows a %', "    if (tot < 5) {", "    if (tot < 4) {"],
  ['js', 'cells: total 8 gets a tier colour', "    if (tot < MIN_TIER_DEN) {\n      return '<span class=\"' + cls + '\">' +", "    if (tot < 8) {\n      return '<span class=\"' + cls + '\">' +"],
  ['js', 'field: a mean of player rates, not the pooled ratio', "if (c) { won += c[0]; tot += c[1]; }", "if (c && c[1]) { won += c[0] / c[1]; tot += 1; }"],
  ['js', 'tiers: above and below swapped', "return gap > TIER_PTS ? 'above' : (gap < -TIER_PTS ? 'below' : 'within');", "return gap > TIER_PTS ? 'below' : (gap < -TIER_PTS ? 'above' : 'within');"],
  ['js', 'ranked view: no "v Opponent"', "(row.oppName && row.oppName !== '—' ? 'v ' + row.oppName : '')", "row.event"],
  ['js', 'filters: an untiered cell passes an active filter', "return t !== null && tabFilters[mk].indexOf(t) === -1;", "return tabFilters[mk].indexOf(t) === -1;"],
  ['js', 'Surface: a dot in the trigger', "               '<span>' + esc(label) + '</span>' + CHEV +", "               '<span class=\"tr-dot6\"></span><span>' + esc(label) + '</span>' + CHEV +"],
  ['js', 'copy: the placeholder disclaimer back', "'Click a column to rank the slate on it.</div>';", "'Click a column to rank the slate on it. Placeholder data — a figure that isn’t wired shows a dash.</div>';"],
  ['js', 'colour: the funnel blue', "var funnelColor = hidden.length ? 'var(--text)' : 'var(--text-label)';", "var funnelColor = hidden.length ? 'var(--bar)' : 'var(--text-label)';"],
  ['js', 'splits: tier picked on all surfaces, not this one', "    if (tourS !== chalS) return tourS > chalS", "    if (false) return tourS > chalS"],
  ['js', 'live: no surface from the fixture tournament', "if (surf !== 'hard' && surf !== 'clay' && surf !== 'grass') surf = surfaceFromTournament(f.tournament_key);", "if (surf !== 'hard' && surf !== 'clay' && surf !== 'grass') surf = '';"],
  ['html', 'cards: the 1px edge back on the rows card', "[data-page=\"trading\"] .tr-rows{ background:var(--card); box-shadow:var(--top-light); border-radius:16px;", "[data-page=\"trading\"] .tr-rows{ background:var(--card); box-shadow:var(--top-light); border:1px solid var(--edge-6); border-radius:16px;"],
  ['html', 'colour: Interrupted grey', "[data-page=\"trading\"] .tr-pill.int{ color:var(--amber);", "[data-page=\"trading\"] .tr-pill.int{ color:var(--text-label);"],
];
const SUITES = ['test-ten421-trading.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 90000 });
// Control: the unmutated files must pass, or every "caught" below means nothing.
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated files — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated files pass');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten421-mut-'));
for (const [kind, name, from, to] of MUTANTS) {
  if (SRC[kind].split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, kind === 'js' ? 'm.js' : 'm.html');
  fs.writeFileSync(file, SRC[kind].replace(from, to));
  const env = kind === 'js' ? { TEN421_SRC: file } : { TEN421_HTML: file };
  if (run(env).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
