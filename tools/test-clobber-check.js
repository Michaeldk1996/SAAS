// tools/test-clobber-check.js — the clobber check refuses a list that names nothing (ESC follow-ups brief, 2026-10-21).
//
// On 2026-10-21 tools/clobber-check.sh printed "Clear to land" for a list passed as one unquoted zsh variable: zsh
// does not word-split it, the script got ONE argument holding every path, matched nothing — while 932c587b3 had moved
// three of the files. A check that passes on an empty set is not a check. What this locks, on a real throwaway
// origin + clone (own mkdtemp dir, removed at the end):
//   A · bad input fails loudly (exit 2, never "clear"): no files · an empty argument · an unsplit list · a path that
//       is not in the repo — and the same with origin/main NOT moved (the early-exit path used to wave them through)
//   B · good input still works: an unmoved file is clear (0); a moved file is a CONFLICT (1); a new working-tree file
//       and a tracked path that really contains a space are accepted
//
// Run: node tools/test-clobber-check.js     (CLOBBER_SH points at another copy of the script — the control run)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = process.env.CLOBBER_SH || path.join(__dirname, 'clobber-check.sh');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : '\n        ' + detail}`); };
console.log('clobber check — no silent clear (ESC follow-ups brief 2026-10-21)');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clobber-check-'));
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const run = (cwd, args) => {
  const r = spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const said = (r, re) => re.test(r.out);

try {
  // origin (bare) ← seed; work = the clone a lander works in; other = a second lander who moves a.js on main.
  const origin = path.join(tmp, 'origin.git'), seed = path.join(tmp, 'seed'), work = path.join(tmp, 'work'), other = path.join(tmp, 'other');
  git(tmp, 'init', '-q', '--bare', origin);
  git(tmp, 'init', '-q', seed);
  for (const [f, v] of [['a.js', 'a1\n'], ['b.js', 'b1\n'], ['dir with space/Player Profile.html', 'p\n']]) {
    fs.mkdirSync(path.dirname(path.join(seed, f)), { recursive: true });
    fs.writeFileSync(path.join(seed, f), v);
  }
  git(seed, 'add', '-A'); git(seed, 'commit', '-qm', 'seed'); git(seed, 'remote', 'add', 'origin', origin); git(seed, 'push', '-q', 'origin', 'main');
  git(tmp, 'clone', '-q', origin, work);
  const base = git(work, 'rev-parse', 'HEAD');

  // ── A, with origin/main NOT moved: the early "has not moved → clear" exit must not wave bad input through ──────────
  let r = run(work, [base, '']);
  check('A1 an empty argument, origin unmoved → exit 2, never "clear"', r.code === 2 && !said(r, /Clear to land/), `exit ${r.code}: ${r.out}`);
  r = run(work, [base, 'a.js b.js']);
  check('A2 an unsplit list, origin unmoved → exit 2 naming it', r.code === 2 && said(r, /UNSPLIT/) && !said(r, /Clear to land/), `exit ${r.code}: ${r.out}`);

  // someone else moves a.js on main
  git(tmp, 'clone', '-q', origin, other);
  fs.writeFileSync(path.join(other, 'a.js'), 'a2\n'); git(other, 'commit', '-qam', 'other moves a.js'); git(other, 'push', '-q', 'origin', 'main');

  // ── A, with origin/main moved ─────────────────────────────────────────────────────────────────────────────────────
  r = run(work, [base]);
  check('A3 no files at all → exit 2', r.code === 2 && !said(r, /Clear to land/), `exit ${r.code}: ${r.out}`);
  r = run(work, [base, '']);
  check('A4 an empty argument (an empty $VAR) → exit 2', r.code === 2 && said(r, /empty file argument/) && !said(r, /Clear to land/), `exit ${r.code}: ${r.out}`);
  r = run(work, [base, 'a.js b.js']);
  check('A5 an unsplit list "a.js b.js" (the 2026-10-21 failure: a.js HAD moved) → exit 2, not "clear"', r.code === 2 && said(r, /UNSPLIT/) && !said(r, /Clear to land/), `exit ${r.code}: ${r.out}`);
  r = run(work, [base, 'b.js', 'nope.js']);
  check('A6 a path that is not in the repo → exit 2, even beside a good one', r.code === 2 && said(r, /'nope\.js' is not a path/), `exit ${r.code}: ${r.out}`);

  // ── B · good input still works ────────────────────────────────────────────────────────────────────────────────────
  r = run(work, [base, 'b.js']);
  check('B1 an unmoved file → exit 0, listed clear', r.code === 0 && said(r, /clear\s+b\.js/) && said(r, /Clear to land/), `exit ${r.code}: ${r.out}`);
  r = run(work, [base, 'a.js', 'b.js']);
  check('B2 a moved file → exit 1, CONFLICT naming the commit', r.code === 1 && said(r, /CONFLICT\s+a\.js/) && said(r, /other moves a\.js/), `exit ${r.code}: ${r.out}`);
  fs.writeFileSync(path.join(work, 'new.js'), 'n\n');
  r = run(work, [base, 'new.js', 'dir with space/Player Profile.html']);
  check('B3 a new working-tree file and a tracked path with a space are accepted', r.code === 0 && said(r, /clear\s+new\.js/) && said(r, /clear\s+dir with space\/Player Profile\.html/), `exit ${r.code}: ${r.out}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n  ${pass} passed, ${fail} failed, 0 skipped (a skip is never a pass)`);
process.exit(fail ? 1 : 0);
