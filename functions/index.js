/**
 * Tennis Edge — Whop → Firebase membership sync (webhook backend)
 * TEN-8 · Whop integration Steps 2 & 3
 *
 * The Tennis Edge site is a STATIC GitHub Pages app with client-side Firebase.
 * A webhook needs a server, so this is the smallest server that does the job:
 * one HTTPS Cloud Function on the SAME Firebase project (tennis-edge-75cd9).
 *
 * It receives Whop webhooks, verifies them with the Whop webhook secret
 * (Standard Webhooks HMAC-SHA256), matches the member to a Firebase user by
 * email, and writes the `plan` field on users/{uid} — the exact field the
 * dashboard gating (Step 4) reads.
 *
 * Config (set before deploy — see functions/README.md):
 *   secret  WHOP_WEBHOOK_SECRET  – copied from the Whop dashboard webhook (whsec_…)
 *   string  WHOP_PLAN_BASIC      – the Whop plan_id OR product_id for the €49 Edge tier
 *   string  WHOP_PLAN_PRO        – the Whop plan_id OR product_id for the €99 Pro tier
 *
 * NOTE: the tier value written is 'edge' | 'pro' | 'free' — matching the values
 * dashboard/auth.js accepts (auth.js:361) and account.html renders (Free €0 /
 * Edge €49 / Pro €99). Naming reconciled to 'edge' per founder decision on TEN-8
 * (2026-07-21, interaction "naming" → name_edge_eur).
 */

const crypto = require('crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const WHOP_WEBHOOK_SECRET = defineSecret('WHOP_WEBHOOK_SECRET');
const WHOP_PLAN_BASIC = defineString('WHOP_PLAN_BASIC');
const WHOP_PLAN_PRO = defineString('WHOP_PLAN_PRO');

// Mid tier value written to users/{uid}.plan. 'edge' matches the dashboard
// gating (auth.js:361) and pricing (account.html). Env var stays WHOP_PLAN_BASIC.
const TIER_EDGE = 'edge';
const TIER_PRO = 'pro';
const TIER_FREE = 'free';

// ---------------------------------------------------------------------------
// Standard Webhooks signature verification (https://www.standardwebhooks.com)
// Whop sends: webhook-id, webhook-timestamp, webhook-signature ("v1,<b64hmac>")
// signed content = `${id}.${timestamp}.${rawBody}`
// ---------------------------------------------------------------------------
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function verifyWhopSignature(rawBody, headers, secret) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatureHeader = headers['webhook-signature'];
  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: 'missing signature headers' };
  }

  // Reject stale/future timestamps (replay protection).
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp outside tolerance' };
  }

  // The secret is base64, usually prefixed "whsec_".
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // Header may carry multiple space-separated "v1,<sig>" entries.
  const passed = signatureHeader.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    if (!sig) return false;
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (_) {
      return false;
    }
  });

  return passed ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

// ---------------------------------------------------------------------------
// Payload helpers — Whop payload shapes vary across API versions, so read
// defensively from the common locations rather than one fixed path.
// ---------------------------------------------------------------------------
function pick(obj, paths) {
  for (const path of paths) {
    let cur = obj;
    let ok = true;
    for (const key of path.split('.')) {
      if (cur && typeof cur === 'object' && key in cur) cur = cur[key];
      else { ok = false; break; }
    }
    if (ok && cur != null && cur !== '') return cur;
  }
  return null;
}

function extractEmail(data) {
  return pick(data, [
    'user.email', 'email', 'member.email',
    'user_email', 'customer.email', 'metadata.email',
  ]);
}

function extractPlanRefs(data) {
  // Return every id we might match a tier on (plan first, then product).
  const refs = [];
  for (const v of [
    pick(data, ['plan_id', 'plan.id', 'plan']),
    pick(data, ['product_id', 'product.id', 'product', 'access_pass_id', 'access_pass.id']),
  ]) {
    if (typeof v === 'string' && v) refs.push(v);
  }
  return refs;
}

function tierFor(planRefs) {
  const basic = (WHOP_PLAN_BASIC.value() || '').trim();
  const pro = (WHOP_PLAN_PRO.value() || '').trim();
  for (const ref of planRefs) {
    if (pro && ref === pro) return TIER_PRO;
    if (basic && ref === basic) return TIER_EDGE;
  }
  return null; // unknown product — do not guess a paid tier
}

async function findUidByEmail(email) {
  if (!email) return null;
  // Primary: Firebase Auth is the source of truth for email↔uid.
  try {
    const u = await admin.auth().getUserByEmail(email);
    return u.uid;
  } catch (e) {
    if (e && e.code !== 'auth/user-not-found') throw e;
  }
  // Fallback: a users doc that stored the email (case-insensitive best effort).
  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

async function setPlan(uid, plan, extra = {}) {
  await db.collection('users').doc(uid).set(
    { plan, planUpdatedAt: admin.firestore.FieldValue.serverTimestamp(), planSource: 'whop', ...extra },
    { merge: true }
  );
}

// ---------------------------------------------------------------------------
// Event routing
// ---------------------------------------------------------------------------
async function handleEvent(action, data) {
  const email = extractEmail(data);
  const uid = await findUidByEmail(email);

  // went_valid / activated → grant the tier they bought.
  if (action === 'membership.went_valid' || action === 'membership.activated') {
    const tier = tierFor(extractPlanRefs(data));
    if (!tier) return { status: 'ignored', reason: 'product not mapped to a tier' };
    if (!uid) return { status: 'deferred', reason: `no Firebase user for ${email}` };
    await setPlan(uid, tier, { paymentIssue: admin.firestore.FieldValue.delete() });
    return { status: 'ok', uid, plan: tier };
  }

  // went_invalid / deactivated → cancelled or expired, drop to free.
  if (action === 'membership.went_invalid' || action === 'membership.deactivated') {
    if (!uid) return { status: 'deferred', reason: `no Firebase user for ${email}` };
    await setPlan(uid, TIER_FREE);
    return { status: 'ok', uid, plan: TIER_FREE };
  }

  // updated / metadata_updated → recompute from the current membership's product.
  if (action === 'membership.updated' || action === 'membership.metadata_updated') {
    const tier = tierFor(extractPlanRefs(data));
    if (!uid) return { status: 'deferred', reason: `no Firebase user for ${email}` };
    // A valid membership maps to a tier; if it doesn't resolve, leave plan untouched.
    if (tier) { await setPlan(uid, tier); return { status: 'ok', uid, plan: tier }; }
    return { status: 'ignored', reason: 'updated event without a mappable product' };
  }

  // payment.failed → don't downgrade (grace period), just flag the account.
  if (action === 'payment.failed') {
    if (!uid) return { status: 'deferred', reason: `no Firebase user for ${email}` };
    await db.collection('users').doc(uid).set(
      { paymentIssue: true, paymentIssueAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { status: 'ok', uid, flagged: true };
  }

  return { status: 'ignored', reason: `unhandled action ${action}` };
}

exports.whopWebhook = onRequest(
  { secrets: [WHOP_WEBHOOK_SECRET], region: 'us-central1', cors: false },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const secret = WHOP_WEBHOOK_SECRET.value();
    if (!secret) { logger.error('WHOP_WEBHOOK_SECRET not configured'); res.status(500).send('not configured'); return; }

    // req.rawBody is the exact bytes Whop signed — do NOT use the parsed body.
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const check = verifyWhopSignature(rawBody, req.headers, secret);
    if (!check.ok) {
      logger.warn('Rejected unverified Whop webhook', { reason: check.reason });
      res.status(401).send('invalid signature');
      return;
    }

    let event;
    try { event = JSON.parse(rawBody); } catch (_) { res.status(400).send('bad json'); return; }

    // Whop wraps events as { action, data } (v2) or { event, data } (v5).
    const action = event.action || event.event || event.type;
    const data = event.data || event;

    try {
      const result = await handleEvent(action, data);
      logger.info('Whop webhook handled', { action, ...result });
      res.status(200).json(result);
    } catch (e) {
      logger.error('Whop webhook handler error', { action, error: e.message });
      // 500 so Whop retries — the handler is idempotent (set-by-email).
      res.status(500).send('handler error');
    }
  }
);
