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
 * Config (set before deploy, see functions/DEPLOY.md):
 *   WHOP_WEBHOOK_SECRET  the whsec_ value of the Whop webhook
 *   WHOP_API_KEY         optional but recommended: a Whop API key that can read
 *                        memberships and member emails
 *
 * users/{uid} gets: plan ('edge' = Sharp, 'pro' = Sharp+, 'free'), accessUntil
 * (end of the paid 3-month or 1-year period + 3 days grace), billing
 * ('quarterly' | 'yearly'), whopMembershipId, whopStatus, paymentIssue.
 */

const crypto = require('crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// WHOP_WEBHOOK_SECRET is delivered as a deploy-time env param (written to
// functions/.env by the deploy workflow from the GitHub Actions secret of the
// same name), matching how the plan IDs below are supplied. It is never
// committed to git. This avoids a Secret Manager / Service Usage IAM grant on
// the CI deploy service account; harden to defineSecret() once that SA has
// roles/secretmanager.admin + roles/serviceusage.serviceUsageConsumer.
const WHOP_WEBHOOK_SECRET = defineString('WHOP_WEBHOOK_SECRET');
// Optional Whop API key (permissions: member:basic:read, member:email:read,
// plan:basic:read). With it, every event re-reads the membership from Whop, so
// the stored access always matches Whop's current state and the buyer's email
// is found even when the webhook payload leaves it out.
const WHOP_API_KEY = defineString('WHOP_API_KEY', { default: '' });

// Stennisfy products on Whop (business "stennisfy"). Both unlock everything for
// now; the app reads `plan` and decides what each tier sees.
const PRODUCT_TIER = {
  prod_yREkGisM3eFbI: 'edge', // Sharp:  EUR 147 / 3 months, EUR 397 / year
  prod_qQRjZExf6kCed: 'pro',  // Sharp+: EUR 249 / 3 months, EUR 697 / year
};
const TIER_FREE = 'free';
// Whop statuses that still give access (past_due = renewal retrying).
const ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due', 'canceling']);
// Days of access kept after the paid period ends, so a renewal that lands a
// few hours late never locks a paying member out.
const GRACE_DAYS = 3;
const DAY_MS = 86400000;

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
// Payload helpers: Whop has two webhook formats (v1: { type, data } without the
// email; legacy: { action, data } with data.user.email), so read defensively.
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

async function whopGet(path) {
  const key = (WHOP_API_KEY.value() || '').trim();
  if (!key) return null;
  const r = await fetch(`https://api.whop.com/api/v1/${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Whop API ${path} -> ${r.status}`);
  return r.json();
}

// ISO string, unix seconds or unix ms -> Date (or null).
function toDate(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : (/^\d+$/.test(String(v)) ? Number(v) : NaN);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  return isNaN(d) ? null : d;
}

// The membership an event is about: membership events carry it as `data`,
// payment events as `data.membership` (object) or `data.membership_id`.
function membershipFromEvent(data) {
  if (typeof data.id === 'string' && data.id.startsWith('mem_')) return data;
  const m = data.membership;
  if (m && typeof m === 'object') return m;
  const id = typeof m === 'string' ? m : data.membership_id;
  return id ? { id } : null;
}

// Pure: what users/{uid} should say for this membership. Exported for the test.
function accessFor(m, now = Date.now()) {
  const productId = pick(m, ['product_id', 'product.id', 'access_pass_id', 'access_pass.id', 'product']);
  const tier = PRODUCT_TIER[productId] || null;
  if (!tier) return { tier: null };
  const status = String(pick(m, ['status']) || '').toLowerCase();
  const valid = m.valid === true || ACCESS_STATUSES.has(status);
  const days = Number(pick(m, ['billing_period_days', 'plan.billing_period', 'billing_period'])) || null;
  let end = toDate(pick(m, ['current_period_end', 'renewal_period_end', 'expires_at']));
  // No end date in the payload: count the paid period from its start (or now).
  if (!end && days) end = new Date((toDate(pick(m, ['current_period_start', 'renewal_period_start'])) || new Date(now)).getTime() + days * DAY_MS);
  const accessUntil = end ? new Date(end.getTime() + GRACE_DAYS * DAY_MS) : null;
  const active = valid && (!accessUntil || accessUntil.getTime() > now);
  const billing = !days ? null : days >= 300 ? 'yearly' : days >= 80 ? 'quarterly' : `${days}d`;
  return { tier, active, accessUntil, billing, status };
}

async function emailFor(m, data) {
  const inline = pick(m, ['user.email', 'email']) || pick(data, ['user.email', 'email', 'member.email', 'customer.email']);
  if (inline) return String(inline).trim().toLowerCase();
  const memberId = pick(m, ['member_id', 'member.id']) || pick(data, ['member_id', 'member.id']);
  if (!memberId) return null;
  const member = await whopGet(`members/${memberId}`);
  const e = member && pick(member, ['email', 'user.email']);
  return e ? String(e).trim().toLowerCase() : null;
}

// The buyer may pay before they ever sign in: create the Auth user so the
// email-code sign-in (auth.stennisfy.com) finds this same uid later.
async function uidForEmail(email) {
  try {
    return (await admin.auth().getUserByEmail(email)).uid;
  } catch (e) {
    if (!e || e.code !== 'auth/user-not-found') throw e;
  }
  try {
    return (await admin.auth().createUser({ email })).uid;
  } catch (e) {
    if (e && e.code === 'auth/email-already-exists') return (await admin.auth().getUserByEmail(email)).uid;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Event routing: every membership/payment event re-derives access from the
// membership (fresh from the Whop API when a key is set), so order and
// duplicates don't matter.
// ---------------------------------------------------------------------------
async function handleEvent(action, data) {
  if (!/^(membership|payment)[._]/.test(action || '')) return { status: 'ignored', reason: `unhandled action ${action}` };
  let m = membershipFromEvent(data);
  if (!m) return { status: 'ignored', reason: 'no membership in event' };
  const fresh = m.id ? await whopGet(`memberships/${m.id}`) : null;
  if (fresh) m = fresh;
  else if (!m.status && m.valid == null) return { status: 'ignored', reason: 'membership state unknown (set WHOP_API_KEY)' };

  const a = accessFor(m);
  if (!a.tier) return { status: 'ignored', reason: 'product not mapped to a tier' };
  const email = await emailFor(m, data);
  if (!email) return { status: 'deferred', reason: 'no email for membership (set WHOP_API_KEY)' };
  const uid = await uidForEmail(email);

  const del = admin.firestore.FieldValue.delete();
  const doc = a.active
    ? { plan: a.tier, accessUntil: a.accessUntil ? admin.firestore.Timestamp.fromDate(a.accessUntil) : del, billing: a.billing || del }
    : { plan: TIER_FREE, accessUntil: del, billing: del };
  await db.collection('users').doc(uid).set({
    ...doc,
    whopMembershipId: m.id || del,
    whopStatus: a.status || del,
    paymentIssue: action === 'payment.failed' || a.status === 'past_due' ? true : del,
    planSource: 'whop',
    planUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { status: 'ok', uid, plan: doc.plan, accessUntil: a.active && a.accessUntil ? a.accessUntil.toISOString() : null };
}

exports.accessFor = accessFor;

exports.whopWebhook = onRequest(
  { region: 'us-central1', cors: false },
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
