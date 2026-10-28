#!/usr/bin/env node
// firestore.rules through the Firebase Rules REST API (no firebase.json, no firebase-tools), with the repo's
// FIREBASE_SERVICE_ACCOUNT (GOOGLE_APPLICATION_CREDENTIALS). Three modes:
//   diff    read the LIVE released ruleset and print it against the repo's firestore.rules (read-only)
//   test    evaluate the repo's rules on Google's servers against the Picks test cases below (projects:test — changes
//           nothing live: no ruleset is created, no release moves). Exit 1 on any case that does not hold.
//   deploy  create a ruleset from the repo's file and point the cloud.firestore release at it. Run only on the founder's
//           go-ahead (it replaces the live rules); `test` runs first and a red test blocks the deploy.
// usage: node tools/firestore-rules.mjs diff|test|deploy
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = process.env.FIREBASE_PROJECT || 'tennis-edge-75cd9';
const API = 'https://firebaserules.googleapis.com/v1';
const SOURCE = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const ADMIN = 'dqniZkontSPLBwseOTBzmfCBUQG3', MEMBER = 'member-uid-test', PRO = 'pro-uid-test';
const DOC = p => `/databases/(default)/documents/${p}`;

async function token() {
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase', 'https://www.googleapis.com/auth/cloud-platform'] });
  const c = await auth.getClient(); const t = await c.getAccessToken(); return t.token || t;
}
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url.replace(API, '')} → HTTP ${r.status} ${JSON.stringify(j).slice(0, 600)}`);
  return j;
}
const files = () => ({ files: [{ name: 'firestore.rules', content: SOURCE }] });

// the plan of a user, as the rules' get() of users/{uid} returns it
const planMock = (uid, plan) => ({ function: 'get', args: [{ exactValue: DOC(`users/${uid}`) }], result: { value: { data: { plan } } } });
const mocks = [planMock(MEMBER, 'free'), planMock(PRO, 'pro'), planMock(ADMIN, 'free')];
const auth = uid => ({ uid, token: { email: uid + '@example.test' } });
const NOW = '2026-10-28T10:00:00Z';
const pick = o => Object.assign({ kind: 'match', date: '2026-10-28', status: 'posted', posted_price: 2.1, stake: 1, note: 'n', created_by: ADMIN }, o || {});
function req(uid, method, p, data, existing) {
  const c = { request: { auth: uid ? auth(uid) : null, path: DOC(p), method, time: NOW }, functionMocks: mocks };
  if (data) c.request.resource = { data };
  if (existing) c.resource = { data: existing };
  return c;
}
const CASES = [
  ['a member reads a settled pick', 'ALLOW', req(MEMBER, 'get', 'picks/s1', null, pick({ status: 'won' }))],
  ['a member cannot read an open pick', 'DENY', req(MEMBER, 'get', 'picks/p1', null, pick())],
  ['a Pro member reads an open pick', 'ALLOW', req(PRO, 'get', 'picks/p1', null, pick({ status: 'live' }))],
  ['a Pro member cannot read a draft', 'DENY', req(PRO, 'get', 'picks/d1', null, pick({ status: 'draft' }))],
  ['the admin reads a draft', 'ALLOW', req(ADMIN, 'get', 'picks/d1', null, pick({ status: 'draft' }))],
  ['signed out reads nothing', 'DENY', req(null, 'get', 'picks/s1', null, pick({ status: 'won' }))],
  ['a member reads a teaser', 'ALLOW', req(MEMBER, 'get', 'picks_public/p1', null, { status: 'posted', stake: 1 })],
  ['the admin posts a draft', 'ALLOW', req(ADMIN, 'create', 'picks/n1', pick({ status: 'draft' }))],
  ['a Pro member cannot post', 'DENY', req(PRO, 'create', 'picks/n1', pick({ status: 'draft', created_by: PRO }))],
  ['the admin cannot write a computed field', 'DENY', req(ADMIN, 'create', 'picks/n1', pick({ status: 'draft', clv: 0.05 }))],
  ['a stake of 12 is refused', 'DENY', req(ADMIN, 'create', 'picks/n1', pick({ status: 'draft', stake: 12 }))],
  ['nobody deletes a pick', 'DENY', req(ADMIN, 'delete', 'picks/s1', null, pick({ status: 'won' }))],
  ['a member cannot write a teaser', 'DENY', req(MEMBER, 'create', 'picks_public/n1', { status: 'posted', stake: 1 })],
  ['a member cannot make themselves Pro', 'DENY', req(MEMBER, 'update', `users/${MEMBER}`, { plan: 'pro', fullName: 'x' }, { plan: 'free', fullName: 'x' })],
  ['a member still updates their own profile', 'ALLOW', req(MEMBER, 'update', `users/${MEMBER}`, { plan: 'free', fullName: 'y' }, { plan: 'free', fullName: 'x' })],
  ['sign-up creates a free profile', 'ALLOW', req(MEMBER, 'create', `users/${MEMBER}`, { plan: 'free', fullName: 'x' })],
  ['sign-up cannot create a Pro profile', 'DENY', req(MEMBER, 'create', `users/${MEMBER}`, { plan: 'pro', fullName: 'x' })],
  // unchanged from the live rules
  ['the admin writes the admin ledger', 'ALLOW', req(ADMIN, 'update', 'admin/log', { payload: 1 }, { payload: 0 })],
  ['a member cannot read the admin ledger', 'DENY', req(MEMBER, 'get', 'admin/log', null, { payload: 0 })],
  ['a member reads an intel note', 'ALLOW', req(MEMBER, 'get', 'intel_notes/n1', null, { text: 'x' })],
  ['a member cannot write an intel note', 'DENY', req(MEMBER, 'create', 'intel_notes/n2', { text: 'x' })],
  ['a member creates an affiliate click with their uid', 'ALLOW', req(MEMBER, 'create', 'affiliate_clicks/c1', { uid: MEMBER })],
];

async function test() {
  const body = { source: files(), testSuite: { testCases: CASES.map(([, expectation, c]) => Object.assign({ expectation }, c)) } };
  const r = await call('POST', `${API}/projects/${PROJECT}:test`, body);
  const res = r.testResults || [];
  let bad = 0;
  CASES.forEach(([name, want], i) => {
    const t = res[i] || {}, ok = t.state === 'SUCCESS';
    if (!ok) bad++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} (${want})${ok ? '' : ' — ' + JSON.stringify(t).slice(0, 400)}`);
  });
  (r.issues || []).forEach(x => console.log('  issue: ' + JSON.stringify(x).slice(0, 300)));
  console.log(`firestore-rules test: ${CASES.length - bad}/${CASES.length} hold on Google's evaluator`);
  return bad ? 1 : 0;
}
async function live() {
  const rel = await call('GET', `${API}/projects/${PROJECT}/releases/cloud.firestore`);
  const rs = await call('GET', `${API}/${rel.rulesetName}`);
  const f = (rs.source && rs.source.files || [])[0] || {};
  return { name: rel.rulesetName, updated: rel.updateTime, content: f.content || '' };
}
async function diff() {
  const L = await live();
  console.log(`live release: ${L.name} (updated ${L.updated})`);
  if (L.content.trim() === SOURCE.trim()) { console.log('live rules = repo firestore.rules'); return 0; }
  const a = L.content.split('\n'), b = SOURCE.split('\n');
  console.log('--- live\n+++ repo');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) { if (a[i] != null) console.log(`-${i + 1}: ${a[i]}`); if (b[i] != null) console.log(`+${i + 1}: ${b[i]}`); }
  return 0;
}
async function deploy() {
  if (await test()) { console.error('firestore-rules deploy: the test is red — nothing deployed'); return 1; }
  const before = await live();
  console.log(`replacing live ruleset ${before.name} (updated ${before.updated}); its source is printed for the record:\n${before.content}`);
  const rs = await call('POST', `${API}/projects/${PROJECT}/rulesets`, { source: files() });
  await call('PATCH', `${API}/projects/${PROJECT}/releases/cloud.firestore`, { release: { name: `projects/${PROJECT}/releases/cloud.firestore`, rulesetName: rs.name } });
  const after = await live();
  const ok = after.content.trim() === SOURCE.trim();
  console.log(`deployed ${rs.name}; live now = repo: ${ok}`);
  return ok ? 0 : 1;
}
const mode = process.argv[2];
const run = { diff, test, deploy }[mode];
if (!run) { console.error('usage: node tools/firestore-rules.mjs diff|test|deploy'); process.exit(2); }
run().then(c => process.exit(c), e => { console.error('firestore-rules: ' + e.message); process.exit(1); });
