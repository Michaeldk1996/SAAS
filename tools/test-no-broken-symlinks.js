#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// No tracked path may be a symlink that does not resolve inside the repo.
//
// WHY: commit 584a8045 added `.deployed-cache` as mode 120000 — a symlink to
// /Users/Michael/bsp-consult-project/.deployed-cache, which exists on the
// operator box and nowhere else. In CI it is a dangling link, so
// deployed-store.js's `fs.existsSync(CACHE_DIR)` read false, `mkdirSync` then
// threw ENOENT, and "Assemble site" died — blocking the deploy.
//
// It got in because `git add -A` ran in a worktree where I had linked that path
// to another checkout for convenience, and .gitignore carried `.deployed-cache/`
// WITH A TRAILING SLASH, which matches a directory and not a symlink. The
// ignore rule looked right and did nothing.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

// `git ls-files -s` prints the mode; 120000 is a symlink.
const entries = execFileSync('git', ['ls-files', '-s'], { cwd: ROOT }).toString()
  .split('\n').filter(Boolean).map(l => {
    const m = l.match(/^(\d{6})\s+\w+\s+\d+\s+(.*)$/);
    return m ? { mode: m[1], file: m[2] } : null;
  }).filter(Boolean);

check('the repo still has tracked files to scan', () => {
  assert.ok(entries.length > 50, `only ${entries.length} tracked entries — the scan would be vacuous`);
});

check('no tracked symlink escapes the repo or dangles', () => {
  const links = entries.filter(e => e.mode === '120000');
  const bad = [];
  for (const l of links) {
    const abs = path.join(ROOT, l.file);
    let target;
    try { target = fs.readlinkSync(abs); } catch { continue; }
    const resolved = path.resolve(path.dirname(abs), target);
    if (!resolved.startsWith(ROOT + path.sep)) {
      bad.push(`${l.file} -> ${target} (points OUTSIDE the repo; it cannot exist in CI)`);
    } else if (!fs.existsSync(resolved)) {
      bad.push(`${l.file} -> ${target} (dangling)`);
    }
  }
  assert.strictEqual(bad.length, 0,
    `tracked symlink(s) that will not resolve on a clean checkout:\n       ` + bad.join('\n       '));
  console.log(`        ${links.length} tracked symlink(s), all resolve inside the repo`);
});

check('.deployed-cache is ignored as a FILE as well as a directory', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map(s => s.trim());
  assert.ok(gi.includes('.deployed-cache'),
    '.gitignore carries only `.deployed-cache/` (directory form). A trailing slash does NOT match a symlink, which is exactly how one got committed.');
});

console.log(`\nsymlink hygiene: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
