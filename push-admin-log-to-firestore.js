'use strict';

/**
 * push-admin-log-to-firestore.js — TEN-8 backend mirror.
 *
 * Mirrors the freshly-built admin-log.json into Firestore document `admin/log`
 * so the admin dashboard (admin.html) can read the ledger behind REAL Firebase
 * auth WITHOUT publishing it to public GitHub Pages. Firestore rules restrict
 * reads of `admin/*` to the founder's own token; this writer uses the Admin SDK
 * (service account) which bypasses those rules.
 *
 * Runs as a pipeline-end step AFTER build-admin-log.js, e.g.:
 *   node push-admin-log-to-firestore.js
 *
 * REQUIREMENTS (all founder-provided; the script no-ops cleanly without them so
 * it can never break the deploy):
 *   - `firebase-admin` available (installed in CI, e.g. `npm install
 *     firebase-admin --no-save`). Absent => skip.
 *   - GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key JSON with
 *     Firestore write rights on project tennis-edge-75cd9 (same
 *     FIREBASE_SERVICE_ACCOUNT secret already used by deploy-functions.yml).
 *     Absent => skip.
 *
 * Doc shape written:  admin/log = { payload: <full admin-log.json object>,
 *                                   updatedAt: <server timestamp>,
 *                                   updatedBy: 'pipeline', schema: 1 }
 * admin.html reads `.payload`.
 *
 * SIZE NOTE: a Firestore document is capped at ~1 MiB. admin-log.json is ~15 KB
 * today (runs[] bounded to 2000, one row per priced match) so there is ample
 * headroom, but if it ever approaches the cap the clean fix is to split `runs`
 * and `flags` into separate docs or a subcollection. Guarded below.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'admin-log.json');
const PROJECT = process.env.FIREBASE_PROJECT || 'tennis-edge-75cd9';
const MAX_BYTES = 1000000; // ~1 MiB Firestore doc ceiling (leave margin)

function skip(msg) { console.log('push-admin-log: ' + msg + ' — skipping (non-fatal).'); process.exit(0); }

let admin;
try { admin = require('firebase-admin'); }
catch (e) { skip('firebase-admin not installed'); }

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  skip('GOOGLE_APPLICATION_CREDENTIALS not set');
}

let raw;
try { raw = fs.readFileSync(FILE, 'utf8'); }
catch (e) { skip('admin-log.json unreadable (' + e.message + ')'); }

if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
  skip('admin-log.json exceeds Firestore doc size ceiling — split runs/flags into a subcollection');
}

let payload;
try { payload = JSON.parse(raw); }
catch (e) { skip('admin-log.json is not valid JSON (' + e.message + ')'); }

(async function main() {
  try {
    if (!admin.apps || !admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: PROJECT,
      });
    }
    const db = admin.firestore();
    await db.collection('admin').doc('log').set({
      payload: payload,
      schema: 1,
      updatedBy: 'pipeline',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('push-admin-log: mirrored admin-log.json to Firestore admin/log (' +
      (payload.flags ? Object.keys(payload.flags).length : 0) + ' rows).');
    process.exit(0);
  } catch (e) {
    // Never fail the deploy over a mirror hiccup.
    console.error('push-admin-log: write failed (non-fatal) — ' + (e && e.message || e));
    process.exit(0);
  }
})();
