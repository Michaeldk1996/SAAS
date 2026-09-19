#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Every `node -e '…'` block in pipeline.yml must survive SHELL quoting.
//
// WHY THIS EXISTS — a regression I shipped on 2026-09-19.
// The match-stat jitter tolerance added this comment inside a node -e block:
//
//     // depth 0 here and would re-report axis 1's finding as a third,
//
// That apostrophe closes the shell's single-quoted string. The remaining JS was
// handed to the shell as words, node received a truncated program, and the
// deploy died at step 25 with:
//
//     [eval]:56
//     SyntaxError: Unexpected end of input
//
// It blocked every deploy from 01:45 until it was caught.
//
// THE REASON MY OWN CONTROLS MISSED IT is the part worth keeping. I verified
// that change with seven controls and all seven passed — because the harness
// extracted the block with Python and ran it through node directly, which
// bypasses the shell entirely. The controls tested the JS. The bug was in the
// quoting AROUND the JS, a layer the harness had removed before testing.
//
// So this file deliberately asserts the layer the other harness cannot see:
// the block as the SHELL will hand it to node.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'pipeline.yml');

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

// Pull every `node -e '<body>'` block out of the workflow.
function blocks(src) {
  const out = [];
  const re = /\n(\s*)node -e '\n([\s\S]*?)\n\s*'\n/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const startLine = src.slice(0, m.index).split('\n').length + 1;
    out.push({ body: m[2], startLine });
  }
  return out;
}

const SRC = fs.readFileSync(WORKFLOW, 'utf8');
const BLOCKS = blocks(SRC);

check('pipeline.yml still contains node -e blocks to check', () => {
  assert.ok(BLOCKS.length >= 5,
    `found only ${BLOCKS.length} node -e block(s) — the extractor has probably stopped matching, which would make every check below vacuous`);
  console.log(`        ${BLOCKS.length} node -e block(s) found`);
});

check('no block contains a bare apostrophe (it would close the shell string)', () => {
  const bad = [];
  BLOCKS.forEach((b, i) => {
    b.body.split('\n').forEach((line, n) => {
      if (line.includes("'")) {
        bad.push(`block ${i + 1}, workflow line ~${b.startLine + n}: ${line.trim().slice(0, 100)}`);
      }
    });
  });
  assert.strictEqual(bad.length, 0,
    `a bare ' inside node -e '…' closes the shell string and truncates the program:\n       ` + bad.join('\n       '));
});

check('every block is valid JavaScript on its own', () => {
  BLOCKS.forEach((b, i) => {
    const tmp = path.join(require('os').tmpdir(), `wfblock-${process.pid}-${i}.js`);
    fs.writeFileSync(tmp, b.body);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (e) {
      throw new Error(`block ${i + 1} (workflow line ~${b.startLine}) does not parse:\n       `
        + String(e.stderr || e.message).split('\n').slice(0, 4).join('\n       '));
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// The one that reproduces the real failure end to end: hand the block to a
// SHELL exactly as the workflow does, and require node to parse what arrives.
check('every block survives the shell and reaches node intact', () => {
  BLOCKS.forEach((b, i) => {
    const script = `node --check /dev/stdin <<'WFEOF'\n${b.body}\nWFEOF`;
    // Re-quote the body the way the workflow does, then let bash do the parsing.
    const shellForm = `true; node -e '\n${b.body}\n' --check-only-noop 2>/dev/null; echo "__ARGC=$#"`;
    void script; void shellForm;
    // Directly: build the exact command line and ask bash to word-split it.
    const probe = `printf '%s' '\n${b.body}\n' | wc -c`;
    let bytes;
    try {
      bytes = Number(execFileSync('/bin/bash', ['-c', probe], { stdio: 'pipe' }).toString().trim());
    } catch (e) {
      throw new Error(`block ${i + 1} (workflow line ~${b.startLine}) does not survive the shell: `
        + String(e.stderr || e.message).split('\n')[0]);
    }
    const expected = Buffer.byteLength('\n' + b.body + '\n');
    assert.strictEqual(bytes, expected,
      `block ${i + 1} (workflow line ~${b.startLine}) arrives at node TRUNCATED: `
      + `${bytes} bytes of ${expected}. A quote inside the block closed the shell string.`);
  });
});

console.log(`\nworkflow node blocks: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
