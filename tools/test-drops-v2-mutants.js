// Dropping Odds v2 — every rule test-drops-v2.mjs locks must turn it red when the rule is bent. Each mutant is applied to
// a copy of drops-page.js (DROPSV2_SRC) or drops-page.css (DROPSV2_CSS); a mutant that leaves the suite green is a
// vacuous test and fails this runner. Anchors must occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { js: path.join(ROOT, 'drops-page.js'), css: path.join(ROOT, 'drops-page.css') };
const ENV = { js: 'DROPSV2_SRC', css: 'DROPSV2_CSS' };
const SRC = { js: fs.readFileSync(FILES.js, 'utf8'), css: fs.readFileSync(FILES.css, 'utf8') };
const MUTANTS = [
  ['js', 'drop % on the raw quotes, not the printed prices', "    n = r2(n);\n    if (o == null) return { kind: 'one', n: n };\n    o = r2(o);", "    if (o == null) return { kind: 'one', n: n };"],
  ['js', 'the soft figure fills the sharp slot', "      sharp: bk.Pinnacle ? rd(bk.Pinnacle.first, bk.Pinnacle.now) : { kind: 'none' },", "      sharp: bk.Pinnacle ? rd(bk.Pinnacle.first, bk.Pinnacle.now) : rd(4.0, 2.9),"],
  ['js', 'a stale book still quoting', "          if (isFinite(seen) && now != null && now - seen > QUOTING_MS) return;", ""],
  ['js', 'prices after the live start kept', "      .filter(function (p) { return isFinite(p.t) && p.v != null && p.v >= 1.01 && !(cut != null && p.t >= cut); })", "      .filter(function (p) { return isFinite(p.t) && p.v != null && p.v >= 1.01; })"],
  ['js', 'started matches listed', "    if (s.liveAt || s.cutAt || s.status === 'in_play' || s.status === 'finished') return false;", ""],
  ['js', 'no-sharp rows rank above the sharp drops', "    return c.sharp.d != null ? 1000 + c.sharp.d : (btype === 'all' ? dOf(c.soft.r) : -1);", "    return c.sharp.d != null ? c.sharp.d : (btype === 'all' ? 1000 + dOf(c.soft.r) : -1);"],
  ['js', 'the Bookmaker menu lets the last book go', "      case 'book': S.books = toggle(S.books, v, true); break;", "      case 'book': S.books = toggle(S.books, v, false); break;"],
  ['js', 'Updated = the clock', "    var upd = st.everLoaded && st.status && st.status.generatedAt ? clock(st.status.generatedAt) : '—';", "    var upd = clock(Date.now() + 60e3);"],
  ['js', 'the held-back claim shipped', "<span class=\"do2-tip-t\">Sharp is Pinnacle. Soft", "<span class=\"do2-tip-t\">Sharp is Pinnacle, which tends to move first. Soft"],
  ['js', 'the banner never shows', "      (fs === 'disconnected' && (st.everLoaded || !st.reachable) ? bannerHtml() : '') + listHtml(v, fs) +", "      listHtml(v, fs) +"],
  ['js', 'a diagonal between two prices', "      inW.forEach(function (p) { if (path.length) path.push({ t: p.t, v: path[path.length - 1].v }); path.push({ t: p.t, v: p.v }); });", "      inW.forEach(function (p) { path.push({ t: p.t, v: p.v }); });"],
  ['js', 'the axis under 1.00', "    if (lo < 1) lo = 1;", ""],
  ['js', 'Escape closes the box with the menu open', "{ id: 'drops-box-menu', z: 77,", "{ id: 'drops-box-menu', z: 75,"],
  ['js', 'feed strings unescaped', "<span class=\"do2-sel\">' + esc((s.dSide || s.side) + ' to win')", "<span class=\"do2-sel\">' + ((s.dSide || s.side) + ' to win')"],
  ['js', 'polling continues off the page', "    if (!st.active) return;\n    st.timer", "    st.timer"],
  ['js', 'a placeholder book on the roster', "['Superbet', 'soft'], ['Napoleon Sports BE', 'soft']];", "['Superbet', 'soft'], ['Napoleon Sports BE', 'soft'], ['Unibet', 'soft']];"],
  ['js', 'Match analysis offered without a board card', "      (s.card && s.card.id != null ? '<span", "      (true ? '<span"],
  ['js', 'Pinnacle not on the chart', "if (pinOn) lines.push({ role: 'pin', series: bk.Pinnacle.series }); ", ""],
  ['css', 'red on a non-drop figure', ".do2-wrap .do2-so-fig.drop { color: var(--do2-text); }", ".do2-wrap .do2-so-fig.drop { color: var(--do2-text); }\n.do2-wrap .do2-best { color: var(--do2-red); }"],
  ['css', 'an ellipsis on player names', "[data-page=\"drops\"] .do2-sel { font-size: 15.5px;", "[data-page=\"drops\"] .do2-sel { text-overflow: ellipsis; font-size: 15.5px;"],
  ['css', 'the list grid off the design', "grid-template-columns: 252px minmax(0, 1.3fr) minmax(204px, 0.8fr) 112px 104px 10px; gap: 18px;", "grid-template-columns: 240px minmax(0, 1.3fr) minmax(204px, 0.8fr) 112px 104px 10px; gap: 18px;"],
];
let killed = 0; const survived = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dropsv2-mut-'));
for (const [file, name, from, to] of MUTANTS) {
  const n = SRC[file].split(from).length - 1;
  if (n !== 1) { console.error(`anchor for "${name}" occurs ${n} times`); process.exit(1); }
  const out = path.join(tmp, path.basename(FILES[file]));
  fs.writeFileSync(out, SRC[file].replace(from, to));
  const r = spawnSync(process.execPath, ['--test', path.join(ROOT, 'test-drops-v2.mjs')], { env: { ...process.env, [ENV[file]]: out }, encoding: 'utf8' });
  if (r.status !== 0) killed++; else survived.push(name);
  fs.unlinkSync(out);
}
fs.rmdirSync(tmp);
console.log(`test-drops-v2 mutants: ${killed} of ${MUTANTS.length} killed`);
if (survived.length) { console.error('survived: ' + survived.join('; ')); process.exit(1); }
