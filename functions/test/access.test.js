// node functions/test/access.test.js  (no deps; stubs firebase so index.js loads)
const assert = require('assert');
const Module = require('module');
const load = Module._load;
const params = {};   // function settings a test can switch on (KIT_API_KEY)
Module._load = function (req, ...rest) {
  if (req === 'firebase-admin') return { initializeApp() {}, firestore: () => ({}) };
  if (req === 'firebase-functions/v2/https') return { onRequest: (o, f) => f };
  if (req === 'firebase-functions/params') return { defineString: (name) => ({ value: () => params[name] || '' }) };
  if (req === 'firebase-functions/logger') return { info() {}, warn() {}, error() {} };
  return load.call(this, req, ...rest);
};
const { accessFor } = require('../index.js');
const now = Date.parse('2026-11-24T00:00:00Z');
const D = 86400000;

// Sharp quarterly, active, period end in Feb -> edge until end + 3 days
let a = accessFor({ id: 'mem_1', product_id: 'prod_yREkGisM3eFbI', status: 'active', billing_period_days: 90, current_period_end: '2027-02-22T00:00:00Z' }, now);
assert.deepStrictEqual([a.tier, a.active, a.billing, a.accessUntil.toISOString()], ['edge', true, 'quarterly', '2027-02-25T00:00:00.000Z']);

// Sharp+ yearly, legacy format (product.id, valid, unix seconds renewal end)
a = accessFor({ id: 'mem_2', product: { id: 'prod_qQRjZExf6kCed' }, valid: true, plan: { billing_period: 365 }, renewal_period_end: Math.floor(Date.parse('2027-11-24T00:00:00Z') / 1000) }, now);
assert.deepStrictEqual([a.tier, a.active, a.billing], ['pro', true, 'yearly']);

// No end date: counted from start + period
a = accessFor({ id: 'mem_3', product_id: 'prod_qQRjZExf6kCed', status: 'active', billing_period_days: 365, current_period_start: '2026-11-24T00:00:00Z' }, now);
assert.strictEqual(a.accessUntil.toISOString(), new Date(now + 368 * D).toISOString());

// Cancelled / expired -> no access
assert.strictEqual(accessFor({ product_id: 'prod_yREkGisM3eFbI', status: 'canceled', current_period_end: '2027-01-01' }, now).active, false);
assert.strictEqual(accessFor({ product_id: 'prod_yREkGisM3eFbI', status: 'expired' }, now).active, false);
// Status says active but the period ended more than 3 days ago -> no access
assert.strictEqual(accessFor({ product_id: 'prod_yREkGisM3eFbI', status: 'active', current_period_end: '2026-11-20T00:00:00Z' }, now).active, false);
// Inside the 3-day grace -> still access
assert.strictEqual(accessFor({ product_id: 'prod_yREkGisM3eFbI', status: 'past_due', current_period_end: '2026-11-22T00:00:00Z' }, now).active, true);
// Unknown product (e.g. the old hidden USD ones) -> never a paid tier
assert.strictEqual(accessFor({ product_id: 'prod_other', status: 'active' }, now).tier, null);
console.log('access.test.js: 8 checks passed');

// Signature: Whop's ws_ secret is the literal HMAC key
const crypto = require('crypto');
const { verifyWhopSignature } = require('../index.js');
const secret = 'ws_0123456789abcdef', body = '{"type":"membership.activated"}', ts = String(Math.floor(Date.now() / 1000));
const sig = crypto.createHmac('sha256', secret).update(`msg_1.${ts}.${body}`).digest('base64');
const h = { 'webhook-id': 'msg_1', 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` };
assert.ok(verifyWhopSignature(body, h, secret).ok);
assert.ok(!verifyWhopSignature(body + ' ', h, secret).ok);
assert.ok(!verifyWhopSignature(body, h, 'ws_other').ok);
console.log('signature: 3 checks passed');

// Kit member tag: no key -> Kit is left alone; paid -> subscriber + tag; ended -> tag removed; Kit down -> an error the caller logs
(async () => {
  const { syncKitMember } = require('../index.js');
  let calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, o) => { calls.push(`${o.method} ${url.replace('https://api.kit.com/v4', '')}`); return new Response(JSON.stringify({ subscriber: { id: 77 } }), { status: 200 }); };
  assert.strictEqual(await syncKitMember('a@b.test', true), 'skipped');
  assert.strictEqual(calls.length, 0);
  params.KIT_API_KEY = 'test';
  assert.strictEqual(await syncKitMember('a@b.test', true), 'tagged');
  assert.deepStrictEqual(calls, ['POST /subscribers', 'POST /tags/26520084/subscribers']);
  calls = [];
  assert.strictEqual(await syncKitMember('a@b.test', false), 'untagged');
  assert.deepStrictEqual(calls, ['POST /subscribers', 'DELETE /tags/26520084/subscribers/77']);
  global.fetch = async () => new Response('down', { status: 500 });
  await assert.rejects(syncKitMember('a@b.test', true), /Kit POST \/subscribers -> 500/);
  global.fetch = realFetch; delete params.KIT_API_KEY;
  console.log('kit member tag: 6 checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
