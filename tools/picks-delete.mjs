#!/usr/bin/env node
// picks-delete.mjs — delete named test picks from Firestore (founder order 2026-10-30: "Delete the test picks Fils,
// Jodar and Michelsen (delete, not void). Leave Hanfmann."). Admin SDK only: firestore.rules let no client delete.
//
// Each target is `<pick id>:<surname>`. A pick is deleted only when its stored document exists AND one of its players
// carries that surname — an id typed wrong can never take another pick with it. Both `picks/{id}` and its teaser
// `picks_public/{id}` go, in one batch. Without --apply nothing is written (a dry run). The log names ids and verdicts
// only: no pick content is printed (the repository's Actions logs are public).
//
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json node tools/picks-delete.mjs <id>:<Surname> … [--apply]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// the guard: a stored pick matches its target when a player's surname (last word of the name) equals the expected one
export function surnameOf(name) { const w = String(name || '').trim().split(/\s+/); return w.length > 1 ? w.slice(1).join(' ') : w[0] || ''; }
export function matches(doc, surname) {
  if (!doc || !surname) return false;
  const want = String(surname).trim().toLowerCase();
  return [doc.player_a, doc.player_b].some(p => p && p.name && surnameOf(p.name).toLowerCase() === want);
}
export function parseTargets(args) {
  return args.filter(a => !a.startsWith('--')).map(a => { const i = a.indexOf(':'); return i > 0 ? { id: a.slice(0, i), surname: a.slice(i + 1) } : null; });
}

async function main(argv) {
  const apply = argv.includes('--apply'), targets = parseTargets(argv);
  if (!targets.length || targets.some(t => !t || !/^[A-Za-z0-9]{10,40}$/.test(t.id) || !t.surname)) { console.error('usage: picks-delete.mjs <id>:<Surname> … [--apply]'); return 2; }
  let admin; try { admin = require('firebase-admin'); } catch (e) { console.error('picks-delete: firebase-admin is not installed'); return 1; }
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.FIREBASE_PROJECT || 'tennis-edge-75cd9' });
  const db = admin.firestore();
  let refused = 0;
  for (const t of targets) {
    const snap = await db.collection('picks').doc(t.id).get();
    if (!snap.exists) { console.log(`picks-delete: ${t.id} — not found, nothing to delete`); continue; }
    if (!matches(snap.data(), t.surname)) { console.log(`picks-delete: ${t.id} — REFUSED, no player named ${t.surname}`); refused++; continue; }
    if (!apply) { console.log(`picks-delete: ${t.id} — matches ${t.surname}; dry run, not deleted`); continue; }
    const b = db.batch(); b.delete(db.collection('picks').doc(t.id)); b.delete(db.collection('picks_public').doc(t.id)); await b.commit();
    console.log(`picks-delete: ${t.id} — deleted (picks + picks_public)`);
  }
  return refused ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(c => process.exit(c), e => { console.error('picks-delete:', e.message); process.exit(1); });
