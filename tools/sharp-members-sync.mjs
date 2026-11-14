// Sharp drop alerts — member sync (rules: .claude/rules/sharp-drops.md).
// Firestore users/{uid}.sharpDrops (written by the member on the Sharp drops page) → sharp_bot.members through
// public.sharp_members_upsert (service role), then the Telegram link state back to users/{uid}.sharpDrops.telegram.
// Beta (founder 2026-11-14): while SHARP_BETA is not '0', ONLY admin uids (admin-config.js ADMIN_UIDS) are written.
// Needs GOOGLE_APPLICATION_CREDENTIALS (Firebase Admin), SUPABASE_URL, SUPABASE_SECRET_KEY. Exit 0 on success, 1 on error.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../sharp-drops-core.js');

export function adminUids(src) {
  const m = /ADMIN_UIDS\s*:\s*\[([\s\S]*?)\]/.exec(src || '');
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
}
// One Firestore user → the RPC row, or null (no settings, no link code, or not allowed in the beta).
export function rowFor(uid, data, admins, beta) {
  const sd = data && data.sharpDrops;
  if (!sd || typeof sd !== 'object') return null;
  const admin = admins.includes(uid);
  if (beta && !admin) return null;
  const s = Core.normalize(sd.settings || sd);
  const code = typeof sd.linkCode === 'string' && /^SFY-[A-Z0-9]{6}$/.test(sd.linkCode) ? sd.linkCode : null;
  return { uid, name: (data.displayName || data.name || '').slice(0, 60), admin, enabled: s.enabled, linkCode: code,
           levels: s.levels, dropMin: s.dropMin, dropMax: s.dropMax, priceMin: s.priceMin, priceMax: s.priceMax,
           windowMin: s.windowMin, stepsOnly: s.stepsOnly, books: s.books, dailyCap: s.dailyCap,
           quietFrom: s.quietFrom, quietTo: s.quietTo, tz: typeof sd.tz === 'string' ? sd.tz.slice(0, 64) : 'Europe/Brussels' };
}

async function main() {
  const beta = process.env.SHARP_BETA !== '0';
  const admins = adminUids(fs.readFileSync(new URL('../admin-config.js', import.meta.url), 'utf8'));
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.FIREBASE_PROJECT || 'tennis-edge-75cd9' });
  const db = admin.firestore();
  const snap = await db.collection('users').where('sharpDrops.v', '==', 1).get();
  const rows = [];
  snap.forEach((d) => { const r = rowFor(d.id, d.data(), admins, beta); if (r) rows.push(r); });
  const url = process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/sharp_members_upsert';
  const key = process.env.SUPABASE_SECRET_KEY;
  const res = await fetch(url, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
                                 body: JSON.stringify({ p_rows: rows }), signal: AbortSignal.timeout(30000) });
  if (!res.ok) { console.log(`::error::sharp-members-sync: upsert HTTP ${res.status}`); return 1; }
  const out = await res.json();
  let back = 0;
  for (const m of out.members || []) {
    const ref = db.collection('users').doc(m.uid);
    const cur = (snap.docs.find((d) => d.id === m.uid)?.data()?.sharpDrops?.telegram) || {};
    const next = { linked: !!m.linked, paused: !!m.paused, linkedAt: m.linkedAt || null };
    if (cur.linked !== next.linked || cur.paused !== next.paused || (cur.linkedAt || null) !== next.linkedAt) {
      await ref.set({ sharpDrops: { telegram: next } }, { merge: true }); back++;
    }
  }
  console.log(`sharp-members-sync: ${snap.size} with settings, ${rows.length} written (beta ${beta ? 'on: admins only' : 'off'}), ${back} link states written back`);
  return 0;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((c) => process.exit(c), (e) => { console.log('::error::sharp-members-sync: ' + (e && e.message || e)); process.exit(1); });
}
