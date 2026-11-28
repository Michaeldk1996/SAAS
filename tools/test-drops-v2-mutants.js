// Dropping Odds (final design on the v2 model) — every rule test-drops-v2.mjs locks must turn it red when the rule is bent. Each mutant is applied to
// a copy of drops-page.js (DROPSV2_SRC) or drops-page.css (DROPSV2_CSS); a mutant that leaves the suite green is a
// vacuous test and fails this runner. Anchors must occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { js: path.join(ROOT, 'drops-page.js'), css: path.join(ROOT, 'drops-page.css') };
const ENV = { js: 'DROPSV2_SRC', css: 'DROPSV2_CSS' };
const SRC = { js: fs.readFileSync(FILES.js, 'utf8'), css: fs.readFileSync(FILES.css, 'utf8') };
const MUTANTS = [
  ['js', 'drop % on the raw quotes, not the printed prices', "    n = r2(n);\n    if (o == null) return { kind: 'one', n: n };\n    o = r2(o);", "    if (o == null) return { kind: 'one', n: n };"],
  ['js', 'the soft figure fills the sharp slot', "    if (!k) return { kind: 'none' };", "    if (!k) return rd(4.0, 2.9);"],
  ['js', 'a stale book still quoting', "          if (isFinite(seen) && now != null && now - seen > QUOTING_MS) return;", ""],
  ['js', 'prices after the live start kept', "      .filter(function (p) { return isFinite(p.t) && p.v != null && p.v >= 1.01 && !(cut != null && p.t >= cut); })", "      .filter(function (p) { return isFinite(p.t) && p.v != null && p.v >= 1.01; })"],
  ['js', 'started matches listed', "    if (s.liveAt || s.cutAt || s.status === 'in_play' || s.status === 'finished') return false;", ""],
  ['js', 'Bet105 no-margin = the quoted price', "      var v = 1 + s / o, last = out[out.length - 1];", "      var v = s, last = out[out.length - 1];"],
  ['js', 'Bet105 no-margin over Pinnacle', "  function sharpKey(bk) { return bk.Pinnacle ? 'Pinnacle' : bk[B105_NM] ? B105_NM : null; }", "  function sharpKey(bk) { return bk[B105_NM] ? B105_NM : bk.Pinnacle ? 'Pinnacle' : null; }"],
  // the soft sort (founder 2026-11-27) and its filter
  ['js', 'the pre-fix soft sort: no soft line ranks above a soft rise', "var x = unit === 'pts' ? r.pts : r.d; return x != null ? x : -Infinity;", "var x = unit === 'pts' ? r.pts : r.d; return x != null ? x : -1;"],
  ['js', 'Biggest soft drop ranks the sharp reading', "if (btype === 'soft') return vOf(c.soft.r);", "if (btype === 'soft') return vOf(c.sharp);"],
  ['js', 'Min drop reads the sharp reading under the soft sort', "    return btype === 'sharp' ? a : btype === 'soft' ? b : Math.max(a, b);", "    return btype === 'sharp' ? a : Math.max(a, b);"],
  ['js', 'Drops in = pts ignored', "var x = unit === 'pts' ? r.pts : r.d; return x != null ? x : -Infinity;", "var x = r.d; return x != null ? x : -Infinity;"],
  ['js', 'Drops in does not reset the sort', "function () { setS({ unit: u[0], sort: 'drop' }); }", "function () { setS({ unit: u[0] }); }"],
  // Meaningful only (isMean, Bet105 counts: founder 2026-11-28)
  ['js', 'Meaningful only does not filter', "    if (S.mean && !isMean(c)) return false;", ""],
  ['js', 'isMean without the soft-follow condition', "(sh.pts >= 2 && c.soft.quotes > 0 && c.soft.down * 2 >= c.soft.quotes)", "(sh.pts >= 2)"],
  ['js', 'Bet105 no-margin moves never meaningful', "    var sh = c.sharp;\n    return sh.kind === 'drop'", "    var sh = c.sharp;\n    return sh.src === 'Pinnacle' && sh.kind === 'drop'"],
  // design copy and bindings
  ['js', 'the subtitle back to "since they opened"', "Prices that have shortened since we first recorded them.", "Prices that have shortened since they opened."],
  ['js', 'the sharp label always Pinnacle', "var shName = c.sharp.src === 'Bet105' ? 'Sharp · Bet105 (no margin)' : 'Sharp · Pinnacle';", "var shName = 'Sharp · Pinnacle';"],
  ['js', 'the archive link not drawn', "v.deskPad = '30px 40px 70px 24px'; v.hasArchive = true;", "v.deskPad = '30px 40px 70px 24px'; v.hasArchive = false;"],
  ['js', 'the archive calls a snapshot a close', "closePx: m.c != null ? f2(m.c) : '—', onOpen:", "closePx: f2(m.c != null ? m.c : m.n), onOpen:"],
  ['js', 'the archive lists rises', "      return m && m.drop > 0 && isFinite(t)", "      return m && isFinite(t)"],
  ['js', 'the archive yield under 5 moves', "val: priced.length >= 5 ?", "val: priced.length >= 1 ?"],
  ['js', 'the archive names Pinnacle for Bet105', "  var ARCH_SHARP = 'Bet105 (no margin)';", "  var ARCH_SHARP = 'Pinnacle';"],
  ['js', 'Match analysis offered without a board card', "maD: !mobile && card ? 'flex' : 'none',", "maD: !mobile ? 'flex' : 'none',"],
  ['js', 'feed strings unescaped', "  function E(x) { return x == null ? '' : x.__raw != null ? x.__raw : esc(x); }", "  function E(x) { return x == null ? '' : x.__raw != null ? x.__raw : String(x); }"],
  ['js', 'the card edge off the design at rest', 'title="Show the price history" style="display:flex; flex-direction:column; border-radius:16px; background:var(--do2-inner); border:1px solid var(--do3-edge-5);', 'title="Show the price history" style="display:flex; flex-direction:column; border-radius:16px; background:var(--do2-inner); border:1px solid var(--do2-hair);'],
  // chart (founder 2026-11-28: straight lines, two dots)
  ['js', 'a carried-in line gets an opening dot', "if (!carried && a.length > 1) out.push(", "if (a.length > 1) out.push("],
  ['js', 'the edge value not on the straight line', "      pts.unshift({ t: t0, v: r2(v0) }); carried = true;", "      pts.unshift({ t: t0, v: r2(before.v) }); carried = true;"],
  ['js', 'a hidden line rescales the axis', "    var vs = pS.pts.concat(pP.pts, pR.pts).map", "    var vs = vPts.concat(vPin, vPrd).map"],
  ['js', 'the axis under 1.00', "    if (lo < 1) lo = 1;                   // decimal odds never go under 1.00 (drops.md r2 fix 11)", ""],
  // runtime
  ['js', 'Escape closes the box with the menu open', "{ id: 'drops-box-menu', z: 77,", "{ id: 'drops-box-menu', z: 75,"],
  ['js', 'polling continues off the page', "    if (!st.active) return;\n    st.timer", "    st.timer"],
  ['js', 'a placeholder book on the roster', "['Superbet', 'soft'], ['Napoleon Sports BE', 'soft']];", "['Superbet', 'soft'], ['Napoleon Sports BE', 'soft'], ['Unibet', 'soft']];"],
  ['js', 'no phone layout', "  function isMobile() { try { return window.innerWidth <= MOBILE_MAX; } catch (e) { return false; } }", "  function isMobile() { return false; }"],
  ['css', 'the page drawn on border-box', "[data-page=\"drops\"] .do3-wrap *, .do3-ov, .do3-ov * { box-sizing: content-box; }", ""],
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
