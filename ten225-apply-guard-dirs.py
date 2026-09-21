#!/usr/bin/env python3
"""Widen the every-suite-is-wired guard to the directories that now hold suites.

⚠️ FOUND BY ADDING ONE. `tools/test-every-suite-is-wired.js` scans exactly two
directories, `.` and `tools`. TEN-225 item 2 added `kibl-stream/`, and the guard
cannot see it: `kibl-stream/test-consumer.mjs` IS wired into npm test, but if it
were not, the guard would have reported "all reachable" and meant nothing.

That is the same class as the finding this guard was written for — `npm test`
was running 1 of 10 TEN-225 mjs suites and a red harness looked identical to a
healthy one. A guard with a directory-shaped hole in it is a guard that will one
day certify a hole.

Discovered rather than listed: any directory in the repo that contains a file
matching the suite pattern is scanned, so the next new directory is covered on
the day it appears instead of on the day someone remembers this file. Bounded to
one level and skipping node_modules/.git, because walking the whole tree on
every CI run to find test files is a different cost.

Usage: python3 ten225-apply-guard-dirs.py <repo-root>
"""
import os
import sys

EDITS = []
G = 'tools/test-every-suite-is-wired.js'


def edit(path, name, old, new):
    EDITS.append((path, name, old, new))


edit(G, 'guard: discover suite directories instead of listing two',
     """const DIRS = ['.', 'tools'];
const SUITE = /^test-.*\\.(mjs|js|py)$/;

function suites() {
  const out = [];
  for (const d of DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!SUITE.test(f)) continue;
      out.push(d === '.' ? f : `${d}/${f}`);
    }
  }
  return out.sort();
}""",
     """const SUITE = /^test-.*\\.(mjs|js|py)$/;
// Directories that are never source. `_site` is the build output — scanning it
// would find copies of suites and report them as unwired duplicates.
const SKIP_DIRS = new Set(['node_modules', '.git', '_site', '.github', 'dist', 'coverage']);

// ⚠️ DISCOVERED, NOT LISTED. This was `['.', 'tools']`, and TEN-225 item 2 added
// kibl-stream/ — a directory the guard could not see. The suite in it happened
// to be wired, but had it not been, this file would have reported "all
// reachable" and meant nothing. That is the same class of defect the guard
// exists for (npm test was running 1 of 10 TEN-225 mjs suites, and a red
// harness looked identical to a healthy one); a guard with a directory-shaped
// hole will eventually certify the hole.
//
// One level deep, not a full walk: every suite in this repo lives at the root
// or one directory down, and walking the whole tree on each CI run buys nothing
// for the cost.
function suiteDirs() {
  const out = ['.'];
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const abs = path.join(ROOT, e.name);
    let names = [];
    try { names = fs.readdirSync(abs); } catch (err) { continue; }
    if (names.some(f => SUITE.test(f))) out.push(e.name);
  }
  return out;
}

function suites() {
  const out = [];
  for (const d of suiteDirs()) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!SUITE.test(f)) continue;
      out.push(d === '.' ? f : `${d}/${f}`);
    }
  }
  return out.sort();
}""")

edit(G, 'guard: prove the new directory is actually covered',
     """const sentinel = 'test-a-suite-that-is-definitely-not-wired.mjs';""",
     """// The directory-discovery half needs its own check, because "n suites, all
// reachable" reads identically whether a directory was scanned or skipped.
// Named explicitly: kibl-stream/ is the directory whose absence prompted this,
// so if it ever stops being scanned the guard says so instead of shrinking
// quietly by one.
const dirsScanned = suiteDirs();
check('suite directories are DISCOVERED, so a new one is covered on the day it '
      + 'appears', dirsScanned.length >= 2, dirsScanned.join(', '));
if (fs.existsSync(path.join(ROOT, 'kibl-stream'))) {
  check('...and kibl-stream/ — the directory that exposed the hole — is in the scan',
        all.some(f => f.startsWith('kibl-stream/')),
        all.filter(f => f.startsWith('kibl-stream/')).join(', ') || 'NOT SCANNED');
}

const sentinel = 'test-a-suite-that-is-definitely-not-wired.mjs';""")


def apply(root):
    changed = 0
    for path_, name, old, new in EDITS:
        full = os.path.join(root, path_)
        with open(full, encoding='utf-8') as fh:
            src = fh.read()
        if src.count(new) >= 1:
            print(f'  no-op   {name}')
            continue
        n = src.count(old)
        if n != 1:
            print(f'::error::  {name}: anchor matched {n} times, expected 1')
            return 1
        with open(full, 'w', encoding='utf-8') as fh:
            fh.write(src.replace(old, new, 1))
        print(f'  applied {name}')
        changed += 1
    print(f'{changed} edit(s) applied')
    return 0


if __name__ == '__main__':
    raise SystemExit(apply(sys.argv[1] if len(sys.argv) > 1 else '.'))
