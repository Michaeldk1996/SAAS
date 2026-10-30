#!/usr/bin/env node
// Picks Task 2 — firestore.rules for the picks store, checked as text (the rules language has no local runner without the
// Firebase emulator + Java; that run is NOT done here and is said out loud — a static check is not an emulator pass).
// Locks: `plan` is never client-written (Pro by plan means nothing otherwise); picks / picks_public read per role; only the
// admin writes; no computed field is client-writable; the admin edits / voids / deletes at any time (founder 2026-10-30, research and development), and no one else does; the note has no length cap. And the browser
// side agrees: every key picks-store.js writes is a key the rules accept. Each check is shown to bite on a mutant.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'picks-store.js'), 'utf8');
const AUTH = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');

const strip = s => s.replace(/\/\/[^\n]*/g, '');
const block = (src, head) => { const s = strip(src), i = s.indexOf(head); if (i < 0) return ''; let d = 0, j = s.indexOf('{', i + head.length);
  for (let k = j; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}' && --d === 0) return s.slice(i, k + 1); } return ''; };
const fnBody = (src, name) => { const s = strip(src), m = new RegExp('function ' + name + '\\(').exec(s); if (!m) return ''; const j = s.indexOf('{', m.index); let d = 0;
  for (let k = j; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}' && --d === 0) return s.slice(m.index, k + 1); } return ''; };
const listOf = (src, name) => { const b = fnBody(src, name); return (b.match(/'([a-z_]+)'/g) || []).map(x => x.slice(1, -1)); };
const COMPUTED = ['open_price', 'now_price', 'opp_now_price', 'close_price', 'opp_close_price', 'clv', 'pl_pct', 'result', 'frozen_at'];

function problems(rules, store, auth) {
  const p = [];
  const users = block(rules, 'match /users/{uid}');
  if (!users) p.push('no users block');
  if (/allow\s+(read,\s*)?write\s*:/.test(users)) p.push('users: a blanket write is back (plan becomes client-writable)');
  if (!/allow update:[^;]*!request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['plan'\]\)/.test(users)) p.push('users: update does not refuse a plan change');
  if (!/allow create:[^;]*request\.resource\.data\.plan == 'free'/.test(users)) p.push('users: create does not pin plan to free');
  if (/updates\.plan\s*=/.test(auth)) p.push('auth.js still writes plan from the browser');

  const picks = block(rules, 'match /picks/{id}');
  if (!picks) p.push('no picks block');
  const read = (/allow read:([^;]*);/.exec(picks) || [])[1] || '';
  if (!/isAdmin\(\)/.test(read)) p.push('picks read: admin branch missing');
  if (!/signedIn\(\) && resource\.data\.status in \['won', 'lost', 'void'\]/.test(read)) p.push('picks read: settled branch is not "signed in + won/lost/void"');
  if (!/resource\.data\.status in \['posted', 'live'\] && isPro\(\)/.test(read)) p.push('picks read: open picks are not Pro-only');
  if (/draft/.test(read)) p.push('picks read: a draft is readable by someone other than the admin');
  if (!/allow create: if isAdmin\(\) && newPickOk/.test(picks)) p.push('picks create: not admin-only');
  if (!/allow update: if isAdmin\(\) && editOk\(\)/.test(picks)) p.push('picks update: not admin-only');
  if (!/allow delete: if isAdmin\(\);/.test(picks)) p.push('picks: delete is not admin-only');
  if (!/get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)\.data\.plan == 'pro'/.test(fnBody(rules, 'isPro'))) p.push('isPro does not read users/{uid}.plan == pro');

  const client = listOf(rules, 'pickClientKeys');
  if (client.length < 20) p.push('pickClientKeys not found');
  COMPUTED.forEach(k => { if (client.includes(k)) p.push(`a computed field is client-writable: ${k}`); });
  if (/duration\.value\(/.test(strip(rules))) p.push('a time window is back on editing (founder 2026-10-30: any time)');
  const pp = listOf(rules, 'postedPick');
  if (['posted', 'live', 'won', 'lost', 'void'].some(k => !pp.includes(k))) p.push('the admin cannot edit every posted pick (posted / live / won / lost / void)');
  const e = fnBody(rules, 'editOk');
  if (!/ch\.hasOnly\(\['note', 'stake', 'edited_at'\]\)/.test(e)) p.push('an edit may change more than note + stake');
  if (!/void_reason\.size\(\) > 0/.test(e)) p.push('a void does not need a reason');
  if (!/posted_price is number && d\.posted_price > 1/.test(fnBody(rules, 'newPickOk'))) p.push('a pick can be posted without a price > 1');
  if (!/d\.stake >= 0\.1 && d\.stake <= 10/.test(fnBody(rules, 'stakeOk'))) p.push('stake is not bounded 0.1–10');
  if (/size\(\)/.test(fnBody(rules, 'noteOk')) || !/d\.note is string/.test(fnBody(rules, 'noteOk'))) p.push('the note is capped (founder 2026-10-30: no limit) or not a string');

  const pub = block(rules, 'match /picks_public/{id}');
  if (!/allow read: if signedIn\(\)/.test(pub) || !/allow create, update: if isAdmin\(\)/.test(pub) || !/allow delete: if isAdmin\(\);/.test(pub)) p.push('picks_public: read signed-in / write + delete admin not held');
  const teaser = listOf(rules, 'teaserKeys');
  ['player_a', 'player_b', 'selection', 'posted_price', 'note', 'line', 'model_pct'].forEach(k => { if (teaser.includes(k)) p.push(`the teaser exposes ${k}`); });

  // the browser agrees with the rules
  const sClient = (/var CLIENT = \[([^\]]*)\]/.exec(store) || [])[1] || '', sTeaser = (/var TEASER = \[([^\]]*)\]/.exec(store) || [])[1] || '';
  const keys = s => (s.match(/'([a-z_]+)'/g) || []).map(x => x.slice(1, -1));
  const extra = keys(sClient).concat(['status', 'created_by', 'posted_at', 'void_reason', 'edited_at']).filter(k => !client.includes(k));
  if (!keys(sClient).length) p.push('picks-store.js CLIENT list not found');
  if (extra.length) p.push('picks-store.js writes keys the rules refuse: ' + extra.join(','));
  const textra = keys(sTeaser).concat(['status', 'posted_at']).filter(k => !teaser.includes(k));
  if (textra.length) p.push('picks-store.js writes teaser keys the rules refuse: ' + textra.join(','));
  return p;
}

let fail = 0;
const real = problems(RULES, STORE, AUTH);
if (real.length) { fail++; console.log('  FAIL  firestore.rules / picks-store.js:\n        ' + real.join('\n        ')); }
else console.log('  PASS  firestore.rules: plan locked, picks read per role, admin-only writes, no computed field client-writable, admin edits + deletes any time, note uncapped; picks-store.js writes only allowed keys');

const MUTANTS = [
  ['blanket users write', r => r.replace(/allow create: if request\.auth != null && request\.auth\.uid == uid/, 'allow write: if request.auth != null && request.auth.uid == uid; allow create: if false')],
  ['plan lock dropped', r => r.replace("!request.resource.data.diff(resource.data).affectedKeys().hasAny(['plan'])", 'true')],
  ['open picks readable by any member', r => r.replace("(resource.data.status in ['posted', 'live'] && isPro())", "(resource.data.status in ['posted', 'live'] && signedIn())")],
  ['drafts readable', r => r.replace("resource.data.status in ['won', 'lost', 'void'])", "resource.data.status in ['won', 'lost', 'void', 'draft'])")],
  ['any member writes picks', r => r.replace('allow create: if isAdmin() && newPickOk', 'allow create: if signedIn() && newPickOk')],
  ['clv client-writable', r => r.replace("'created_by', 'edited_at'];", "'created_by', 'edited_at', 'clv'];")],
  ['10-minute window back', r => r.replace("function postedPick() { return resource.data.status in ['posted', 'live', 'won', 'lost', 'void']; }", "function postedPick() { return resource.data.status == 'posted' && request.time < resource.data.posted_at + duration.value(10, 'm'); }")],
  ['note capped again', r => r.replace('function noteOk(d) { return d.note is string; }', 'function noteOk(d) { return d.note is string && d.note.size() <= 2000; }')],
  ['a member deletes a teaser', r => r.replace(/(match \/picks_public\/\{id\} \{[\s\S]*?)allow delete: if isAdmin\(\);/, '$1allow delete: if signedIn();')],
  ['price editable in window', r => r.replace("ch.hasOnly(['note', 'stake', 'edited_at'])", "ch.hasOnly(['note', 'stake', 'edited_at', 'posted_price'])")],
  ['void without reason', r => r.replace('void_reason.size() > 0', 'void_reason.size() >= 0')],
  ['any member deletes a pick', r => r.replace(/match \/picks\/\{id\} \{([\s\S]*?)allow delete: if isAdmin\(\);/, (m, a) => 'match /picks/{id} {' + a + 'allow delete: if signedIn();')],
  ['teaser leaks the selection', r => r.replace("'posted_at', 'stake', 'status'];", "'posted_at', 'stake', 'status', 'selection'];")],
];
let caught = 0;
for (const [name, f] of MUTANTS) {
  const m = f(RULES);
  if (m === RULES) { console.log(`  FAIL  mutant did not apply: ${name}`); fail++; continue; }
  if (problems(m, STORE, AUTH).length) caught++; else { console.log(`  FAIL  mutant survived: ${name}`); fail++; }
}
const sm = STORE.replace("'stake', 'note', 'model_pct'];", "'stake', 'note', 'model_pct', 'now_price'];");
if (sm !== STORE && problems(RULES, sm, AUTH).length) caught++; else { console.log('  FAIL  mutant survived: store writes now_price'); fail++; }
const am = AUTH.replace('// `plan` is never written from the browser', "if (patch.plan) updates.plan = patch.plan; // `plan` is never written from the browser");
if (am !== AUTH && problems(RULES, STORE, am).length) caught++; else { console.log('  FAIL  mutant survived: auth.js writes plan'); fail++; }
console.log(`  mutants: ${caught}/${MUTANTS.length + 2} caught`);
console.log('  SKIP  evaluating these rules (Google\'s evaluator: node tools/firestore-rules.mjs test, run by firestore-rules.yml with the service account) — not run here, said out loud, not a pass');
console.log(`EXIT=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
