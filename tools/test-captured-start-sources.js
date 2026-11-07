#!/usr/bin/env node
// tools/test-captured-start-sources.js — founder 2026-11-08 ("make sure this problem just don't come anymore").
//
// On 4 Nov the card-state writer gained two start sources ('bet105-switch', 'first-point'); the captured-close builder
// accepted only 'oddspapi' / 'api-tennis-live', so every capture from 4 Nov was dropped as noStart for four days and no
// test noticed. This test closes that gap: every start_ts_source the card-state schema allows must be listed by the
// builder as either a start (CARD_START_SOURCES) or explicitly not one (CARD_START_REJECTED), and every reader of
// captured rows must agree on which of them is a verified start (pinarch.py export, build-match-closes.js fallback).
// Adding a source to the schema without deciding it here turns npm test red.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const schema = fs.readFileSync(path.join(ROOT, 'ten225-card-state-schema.sql'), 'utf8');
const m = schema.match(/CHECK\s*\(\s*start_ts_source\s+IN\s*\(([^)]*)\)\s*\)/i);
check('the card-state schema names its start_ts_source values', !!m);
const schemaSrc = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];

const B = require(path.join(ROOT, 'build-captured-pinnacle.js'));
const decided = [...B.CARD_START_SOURCES, ...B.CARD_START_REJECTED];
for (const s of schemaSrc) check(`schema source '${s}' is decided by build-captured-pinnacle.js`, decided.includes(s),
  'add it to CARD_START_SOURCES (a start) or CARD_START_REJECTED (not one) — a founder price-source ruling');
check('the builder decides nothing the schema cannot hold', decided.every((s) => schemaSrc.includes(s)), JSON.stringify(decided));
check('no source is both a start and not one', !B.CARD_START_SOURCES.some((s) => B.CARD_START_REJECTED.includes(s)));

// The writer's own constants are in the schema (a writer emitting an unlisted value would fail the CHECK on insert).
const kcs = fs.readFileSync(path.join(ROOT, 'ten225-kibl-card-state.py'), 'utf8');
for (const k of ['INPLAY_SRC_SWITCH', 'INPLAY_SRC_POINT']) {
  const v = (kcs.match(new RegExp(`^${k}\\s*=\\s*'([^']+)'`, 'm')) || [])[1];
  check(`card-state writer ${k} = '${v}' is in the schema`, v && schemaSrc.includes(v));
}

// Verified (exportable as a close) = every builder start except Oddspapi trueStart alone (odds.md: never a close).
const verified = B.CARD_START_SOURCES.filter((s) => s !== 'oddspapi');
const pin = fs.readFileSync(path.join(ROOT, 'tools', 'pinarch.py'), 'utf8');
const pm = pin.match(/^CAPTURED_VERIFIED_SOURCES\s*=\s*\(([^)]*)\)/m);
const pinSrc = pm ? [...pm[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
check('pinarch.py CAPTURED_VERIFIED_SOURCES = the builder\'s starts minus trueStart alone', pinSrc && eq(pinSrc, verified), JSON.stringify(pinSrc));
const bmc = fs.readFileSync(path.join(ROOT, 'build-match-closes.js'), 'utf8');
const bm = bmc.match(/^const CAPTURED_VERIFIED\s*=\s*\[([^\]]*)\]/m);
const bmSrc = bm ? [...bm[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
check('build-match-closes.js CAPTURED_VERIFIED = the same list', bmSrc && eq(bmSrc, verified), JSON.stringify(bmSrc));
check('trueStart alone is never verified', !(pinSrc || []).includes('oddspapi') && !(bmSrc || []).includes('oddspapi'));

// CONTROL: the pre-fix builder list misses the 4 Nov sources — this test must have caught it.
const before = ['oddspapi', 'api-tennis-live', 'none'];
check('CONTROL: the pre-fix lists leave a schema source undecided', schemaSrc.some((s) => !before.includes(s)));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
