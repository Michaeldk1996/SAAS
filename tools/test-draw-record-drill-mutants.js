// tools/test-draw-record-drill-mutants.js — every check in tools/test-draw-record-drill.js must FAIL when the
// behaviour it locks is reverted. Each mutant edits a copy of player-profile-v2.js (DRAW_SRC) or of
// bsp-consult-dashboard.html (DRAW_HTML) and runs the suite against it; a mutant the suite survives is a vacuous check.
// Anchors occur exactly once. Run: node tools/test-draw-record-drill-mutants.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { src: path.join(ROOT, 'player-profile-v2.js'), html: path.join(ROOT, 'bsp-consult-dashboard.html') };
const MUTANTS = [
  ['src', 'Early rounds swallows round-robin', "return ['R16', 'R32', 'R64', 'R128'].indexOf(m.rd) >= 0;", "return ['R16', 'R32', 'R64', 'R128', 'RR'].indexOf(m.rd) >= 0;"],
  ['src', 'Last 52 lists the whole career', "return pred(r.m) && (scope !== 'last52' || String(r.m.d) >= String(cut));", "return pred(r.m);"],
  ['src', 'a walkover keeps a price', "if (r.sc.wo) { r.price = null; r.oppPrice = null; r.book = null; }", "if (false) { r.price = null; }"],
  ['src', 'the P&L total without its priced count', "' over ' + M.priced + ' of ' + listN + ' priced matches'", "''"],
  ['src', 'a loss keeps the winner\'s score', "p = won ? x : y, o = won ? y : x;", "p = x, o = y;"],
  ['src', 'oldest first', "return a.m.d < b.m.d ? 1 : a.m.d > b.m.d ? -1 : a.i - b.i;", "return a.m.d < b.m.d ? -1 : a.m.d > b.m.d ? 1 : a.i - b.i;"],
  ['src', 'one page holds everything', 'var DRAW_PAGE = 100;', 'var DRAW_PAGE = 1000;'],
  ['src', 'pending prices print a zero total', "var pl = pend ? '<span data-pp2-pending=\"draw-pl\">&nbsp;</span>'", "var pl = pend ? 'P&amp;L +0.00u over 0 of ' + listN + ' priced matches'"],
  ['src', 'Esc closes the whole modal from the drill', "if (state.modal === 'splits' && state.drawDrill) {", "if (false) {"],
  ['src', 'Sets & Games / Service rows clickable too', "if (tab.id !== 'results') return line;", "if (false) return line;"],
  ['src', 'the chips do not filter', "return filt === 'all' || (!r.sc.wo && (filt === 'W') === r.won);", "return true;"],
  ['src', 'an opponent linked without a profile', "window.pp2HasProfile(k) && k !== String(state.key)", "true"],
  ['src', 'a disagreeing list is not stated', "var mismatch = listN !== n", "var mismatch = false"],
  ['src', 'the breadcrumb names the group, not the row', "data-pp2-draw-crumb=\"1\" style=\"color:var(--text);font-weight:700;white-space:nowrap;\">' + esc(M.label)", "data-pp2-draw-crumb=\"1\" style=\"color:var(--text);font-weight:700;white-space:nowrap;\">' + esc('Draw')"],
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
