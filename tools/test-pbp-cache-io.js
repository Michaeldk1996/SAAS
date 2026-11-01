#!/usr/bin/env node
// Task D (founder 2026-11-01, "Invalid string length"): the point-by-point store is written and read one match at a time, so
// no string the size of the whole store is ever made; the older single-object file still reads (nothing held is lost on the
// switch); a broken line stops the read (never a silently smaller store). CONTROL: the old writer (one JSON.stringify of
// the whole store) makes a string the size of the store, which is what passed V8's limit at 71,035 logs on 31 Oct.
const fs = require('fs'), os = require('os'), path = require('path');
const IO = require('../pbp-cache-io.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbp-cache-io-'));
const f = path.join(dir, 'point-by-point-cache.json');
const entry = i => ({ p1: 'A. One', p2: 'B. Two', sets: [{ set: 1, games: Array.from({ length: 12 }, (_, g) => ({ g, pts: ['15-0', '30-0', '40-0'] })) }], i });
const store = {}; for (let i = 0; i < 20000; i++) store[String(12000000 + i)] = entry(i);
// the largest single string the writer builds, measured by watching every JSON.stringify call
const big = (fn) => { const orig = JSON.stringify; let max = 0; JSON.stringify = function (...a) { const s = orig.apply(this, a); if (s && s.length > max) max = s.length; return s; }; try { fn(); } finally { JSON.stringify = orig; } return max; };
const wholeLen = JSON.stringify(store).length;
const maxNew = big(() => IO.writeCache(f, store));
ok(maxNew < 10000 && maxNew * 1000 < wholeLen, `the writer never builds a string the size of the store (largest ${maxNew} chars; the whole store is ${wholeLen})`);
const maxOld = big(() => JSON.stringify(store));
ok(maxOld === wholeLen, 'CONTROL: the old writer builds one string the size of the whole store (what passed V8\'s limit)');
const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
ok(lines[0] === IO.HEADER && lines.length === 20001, 'one header line, then one line per match');
const back = IO.readCache(f);
ok(Object.keys(back).length === 20000 && JSON.stringify(back['12000123']) === JSON.stringify(store['12000123']), 'every match reads back exactly');
fs.writeFileSync(f, JSON.stringify({ 1: entry(1), 2: entry(2) }));
ok(Object.keys(IO.readCache(f)).length === 2, 'the older single-object file still reads (the seed and the last good cache before the switch)');
ok(JSON.stringify(IO.readCache(path.join(dir, 'none.json'))) === '{}', 'a missing file is an empty store');
fs.writeFileSync(f, IO.HEADER + '\n["1",{"p1":"A"}]\n{broken\n');
let threw = false; try { IO.readCache(f); } catch (e) { threw = /line 3/.test(e.message); }
ok(threw, 'a broken line stops the read and names its line (never a silently smaller store)');
IO.writeCache(f, {}); ok(JSON.stringify(IO.readCache(f)) === '{}' && !fs.existsSync(f + '.tmp'), 'an empty store round-trips; no tmp file left');
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\ntest-pbp-cache-io: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
