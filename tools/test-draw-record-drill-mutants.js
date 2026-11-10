// tools/test-draw-record-drill-mutants.js — every check in tools/test-draw-record-drill.js must FAIL when the
// behaviour it locks is reverted. Each mutant edits a copy of player-profile-v2.js (DRAW_SRC) or of
// bsp-consult-dashboard.html (DRAW_HTML) and runs the suite against it; a mutant the suite survives is a vacuous check.
// Anchors occur exactly once. Run: node tools/test-draw-record-drill-mutants.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { src: path.join(ROOT, 'player-profile-v2.js'), html: path.join(ROOT, 'bsp-consult-dashboard.html') };
const MUTANTS = [
  // profile v2 (founder 2026-11-09): the Level & round cards and their drill boxes
  ['src', 'Early rounds swallows round-robin (the Draw predicate the A checks lock)', "return ['R16', 'R32', 'R64', 'R128'].indexOf(m.rd) >= 0;", "return ['R16', 'R32', 'R64', 'R128', 'RR'].indexOf(m.rd) >= 0;"],
  ['src', 'Last 52 lists the whole career', "var rows = all.rows.filter(function (r) { return scope !== 'last52' || String(r.m.d) >= String(cut); });", "var rows = all.rows;"],
  ['src', 'a walkover keeps a price', "if (r.sc.wo) { r.price = null; r.oppPrice = null; r.book = null; }", "if (false) { r.price = null; }"],
  ['src', 'a walkover counts in the W\u2013L', "      if (r.sc.wo) return;\n      s.n++; if (r.won) s.w++;", "      s.n++; if (r.won) s.w++;"],
  ['src', 'a loss keeps the winner\'s score', "p = won ? x : y, o = won ? y : x;", "p = x, o = y;"],
  ['src', 'oldest first', "return String(b.m.d).localeCompare(String(a.m.d)) || a.i - b.i;", "return String(a.m.d).localeCompare(String(b.m.d)) || a.i - b.i;"],
  ['src', 'pending prices print a dash', "{ html: r.price != null ? Number(r.price).toFixed(2) : pend ? '' : DASH,", "{ html: r.price != null ? Number(r.price).toFixed(2) : DASH,"],
  ['src', 'pending prices print a figure', "S.join === 'pending' ? { label: 'On the price'", "false ? { label: 'On the price'"],
  ['src', 'the P&L total without its priced count', "' flat 1u on ' + priced.length + ' of ' + counted.length + ' priced'", "' flat 1u'"],
  ['src', 'Esc closes the whole modal from the box', "    if (state.fb) { state.fb = null; repaint(); return; }", ""],
  ['src', 'an empty row opens a box', "var hook = empty ? '' : 'data-pp2=\"fb-open\" data-box=\"'", "var hook = 'data-pp2=\"fb-open\" data-box=\"'"],
  ['src', 'a walkover row keeps the sheet hook', "return { id: null, hook: r.sc.wo ? '' : 'data-pp2=\"draw-sheet\" data-v=\"' + r.i", "return { id: null, hook: 'data-pp2=\"draw-sheet\" data-v=\"' + r.i"],
  ['src', 'Team events left out of Level', "if (m.lv === 'D') return 'Team events';", "if (m.lv === 'D') return null;"],
  ['src', 'rounds numbered from his own first match (byes ignored)', "      var first = splDrawFirst(m), own = seen[String(m.t || '')];", "      var first = 9, own = seen[String(m.t || '')];"],
  ['src', 'every Masters treated as a 56 draw', "    if (m.lv === 'M') return /indian wells|miami/i.test(t) || (y >= 2023 && /madrid|rome|shanghai/i.test(t)) ? 0 : 1;", "    if (m.lv === 'M') return 1;"],
  ['src', 'Masters rows filed as Grand Slams', "if (m.lv === 'M') return 'Masters 1000';", "if (m.lv === 'M') return 'Grand Slams';"],
  ['src', 'the tiebreak box lists every set', "        if (!((x.p === 7 && x.o === 6) || (x.p === 6 && x.o === 7))) return;\n        tbs.push(", "        tbs.push("],
  ['src', 'the W\u2013L cell wraps', "return cell(v[0], M + 'text-align:right;white-space:nowrap;font-size:'", "return cell(v[0], M + 'text-align:right;font-size:'"],
  ['src', 'an opponent linked without a profile', "window.pp2HasProfile(k) && k !== String(state.key)", "true"],
  ['src', 'the sheet ignores the career match', "    if (c) {\n      var walkover = !!(c.walkover || c.wo);", "    if (false) {\n      var walkover = !!(c.walkover || c.wo);"],
  ['html', 'the join does not hand back the career match', "if (j != null && meet[j]) Object.defineProperty(r, 'careerMatch'", "if (false) Object.defineProperty(r, 'careerMatch'"],
  ['html', 'the bridge prices before the Database rows answer', "if (!(k in _careerHistoryShards) || _sfDbJoinSt !== 'ready' || !_sfDbJoin) return 'pending';", "if (!(k in _careerHistoryShards)) return 'pending';"],
];
const SUITE = path.join(__dirname, 'test-draw-record-drill.js');
const run = env => spawnSync(process.execPath, [SUITE], { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 300000 });
if (run({}).status !== 0) { console.error('✖ the suite is red unmutated — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated sources pass');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-mut-'));
let survived = 0;
try {
  for (const [which, name, from, to] of MUTANTS) {
    const src = fs.readFileSync(FILES[which], 'utf8');
    if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
    const f = path.join(dir, which === 'src' ? 'pp2.js' : 'page.html');
    fs.writeFileSync(f, src.replace(from, to));
    const r = run(which === 'src' ? { DRAW_SRC: f } : { DRAW_HTML: f });
    if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
