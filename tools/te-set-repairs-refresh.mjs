#!/usr/bin/env node
// TEN-449 · the weekly refresh's set-repair step (plan §4a, founder-approved 19 Oct). Runs in the PRIVATE store repo's
// Actions (template tools/te-store-repo/te-refresh.yml), after BOTH weekly parts of one Monday have completed. It adds
// set repairs for NEW short rows only — the rows set-repairs.json does not hold yet, as a repair or a flag (J. Sels's 6
// are the first). Every existing repair and flag is FROZEN: if the rebuild would change, drop or move any of them, it
// exits 1 and writes nothing.
//
//   node saas/tools/te-set-repairs-refresh.mjs --store . --sackmann <dir> [--site <url|dir>]
//   node saas/tools/te-set-repairs-refresh.mjs --store . --week-complete     (prints complete=true|false; exit 0)
//
// Inputs, every one required (a missing or unreadable input exits 1 and writes nothing — fail closed):
//   the store            te-history-index.json, te-history/, set-repairs.json (the store repo root, just refreshed)
//   the deployed site    career-history-index.json + career-history/<key>.json for every player it lists (the rows the
//                        site serves, set repairs already applied, so a repaired row is no longer short), and
//                        player-index.json (our names)
//   Sackmann             atp_players.csv + atp_matches*.csv at his pinned commit 5b6263dc48 (the workflow checks the
//                        commit out and verifies it)
// The Sackmann-id / name input tools/build-set-repairs.mjs takes (on the Mac, a hand-built file) is built here by
// buildIdentity(): a player's Sackmann id is the one atp_players.csv row with his date of birth (from the TE store,
// where he was joined on it) and his surname; anyone else is matched by name inside the builder, as before.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { build as buildRepairs, loadSackmann } from './build-set-repairs.mjs';
import { STORE_DIR, INDEX } from './te-history-guard.mjs';

export const REPAIRS = 'set-repairs.json';
export const REPAIRS_LOG = 'set-repairs-log.jsonl';
export const SITE = 'https://michaeldk1996.github.io/SAAS/';

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// ── the builder's identity input ────────────────────────────────────────────────────────────────────────────────
// roster: [{ key, name }] (player-index.json); storeIndex: te-history-index.json; playersCsv: Sackmann atp_players.csv
export function buildIdentity({ roster, storeIndex, playersCsv }) {
  const byDob = new Map();
  for (const l of String(playersCsv).split(/\r?\n/).slice(1)) {
    const c = l.split(','); if (!c[0] || !c[4]) continue;
    if (!byDob.has(c[4])) byDob.set(c[4], []); byDob.get(c[4]).push({ id: c[0], last: fold(c[2]) });
  }
  const sids = {}, names = {}; const stats = { players: 0, byDob: 0, ambiguous: 0, none: 0 };
  for (const p of roster) {
    const key = String(p.key); stats.players++;
    names[key] = { name: p.name || null };
    const dob = String(((storeIndex.players || {})[key] || {}).dob || '').replace(/\D/g, '');
    const toks = String(p.name || '').split(/[\s.]+/).map(fold).filter((t) => t.length > 1);
    const hit = dob.length === 8 ? (byDob.get(dob) || []).filter((c) => c.last && toks.some((t) => c.last === t || c.last.includes(t) || t.includes(c.last))) : [];
    if (hit.length === 1) { sids[key] = hit[0].id; stats.byDob++; } else if (hit.length > 1) stats.ambiguous++; else stats.none++;
  }
  return { sids, names, stats };
}

// ── frozen entries ──────────────────────────────────────────────────────────────────────────────────────────────
const entries = (o) => Object.entries(o || {}).flatMap(([k, m]) => Object.entries(m || {}).map(([ek, v]) => [k, ek, v]));
export const isKnown = (prev, key, ek) => !!(((prev.repairs || {})[key] || {})[ek] || ((prev.flags || {})[key] || {})[ek]);
export function merge(prev, fresh, at) {
  const next = { ...prev, builtAt: prev.builtAt, refreshedAt: at, repairs: {}, flags: {}, counts: { ...(prev.counts || {}) } };
  for (const kind of ['repairs', 'flags']) {
    for (const [k, m] of Object.entries(prev[kind] || {})) next[kind][k] = { ...m };
    for (const [k, ek, v] of entries(fresh[kind])) (next[kind][k] = next[kind][k] || {})[ek] = v;
  }
  for (const [c, n] of Object.entries(fresh.counts || {})) next.counts[c] = (next.counts[c] || 0) + n;
  next.shortRows = (prev.shortRows || 0) + (fresh.shortRows || 0);
  return next;
}
// every committed repair and flag is in `next` exactly as it was, and in the same list
export function checkFrozen(prev, next) {
  const why = [];
  for (const [kind, other] of [['repairs', 'flags'], ['flags', 'repairs']]) {
    for (const [k, ek, v] of entries(prev[kind])) {
      const now = ((next[kind] || {})[k] || {})[ek];
      if (now === undefined) why.push(`${kind} ${k}/${ek} dropped`);
      else if (!isDeepStrictEqual(now, v)) why.push(`${kind} ${k}/${ek} changed`);
      if (((next[other] || {})[k] || {})[ek] !== undefined) why.push(`${kind} ${k}/${ek} also in ${other}`);
    }
  }
  return why;
}

// ── the week ────────────────────────────────────────────────────────────────────────────────────────────────────
// complete = every part of one week's weekly run has finished and refreshedAt was set in that same week
export function weekComplete(idx) {
  const w = idx && idx.weeklyParts;
  if (!w || !(w.of >= 1) || !Array.isArray(w.done) || new Set(w.done).size !== w.of || !idx.refreshedAt) return false;
  const d = new Date(idx.refreshedAt); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10) === w.week;
}

// ── inputs ──────────────────────────────────────────────────────────────────────────────────────────────────────
const fail = (m) => { const e = new Error(m); e.closed = true; throw e; };
const readJson = (f, what) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fail(`${what} missing or unreadable (${f}: ${e.code || e.message})`); } };
async function siteJson(site, rel) {
  if (!/^https?:/.test(site)) return readJson(path.join(site, rel), `site ${rel}`);
  const u = new URL(rel, site.endsWith('/') ? site : site + '/'); u.searchParams.set('cb', String(Date.now()));
  // a transient Pages 5xx / network error is retried (3 tries, 2 s and 6 s apart); anything else, or a third failure,
  // fails closed
  let r = null, err = '';
  for (let t = 0; t < 3; t++) {
    if (t) await new Promise((ok) => setTimeout(ok, Number(process.env.SET_REPAIRS_RETRY_MS || 2000) * (t === 1 ? 1 : 3)));
    try { r = await fetch(u); err = ''; } catch (e) { r = null; err = e.message; continue; }
    if (r.status < 500) break;
  }
  if (!r) return fail(`site ${rel}: ${err}`);
  if (r.status !== 200) return fail(`site ${rel}: HTTP ${r.status}`);
  try { return await r.json(); } catch (e) { return fail(`site ${rel}: unreadable JSON`); }
}

// buildFn is the set-repair builder (tools/build-set-repairs.mjs build); a test may pass a mutant
export async function refresh({ store, sackmann, site = SITE, now = new Date().toISOString(), buildFn = buildRepairs, log = console.log }) {
  // the store
  const idx = readJson(path.join(store, INDEX), INDEX);
  const teDir = path.join(store, STORE_DIR);
  if (!fs.existsSync(teDir) || !fs.statSync(teDir).isDirectory()) fail(`${STORE_DIR}/ missing in ${store}`);
  const prev = readJson(path.join(store, REPAIRS), REPAIRS);
  if (!prev || typeof prev.repairs !== 'object' || !prev.repairs || typeof prev.flags !== 'object' || !prev.flags) fail(`${REPAIRS} holds no repairs/flags maps`);
  // Sackmann
  if (!sackmann || !fs.existsSync(path.join(sackmann, 'atp_players.csv'))) fail(`Sackmann atp_players.csv missing (--sackmann ${sackmann})`);
  if (!fs.readdirSync(sackmann).some((f) => /^atp_matches_(qual_chall_|futures_)?\d{4}\.csv$/.test(f))) fail(`Sackmann match CSVs missing in ${sackmann}`);
  const sack = loadSackmann(sackmann);
  if (!sack.n) fail('Sackmann match CSVs hold no match');
  // the deployed site: every player's served rows
  const chIdx = await siteJson(site, 'career-history-index.json');
  const keys = Object.keys((chIdx && chIdx.players) || {});
  if (!keys.length) fail('career-history-index.json lists no player');
  const pIdx = await siteJson(site, 'player-index.json');
  const plist = Array.isArray(pIdx) ? pIdx : Array.isArray(pIdx && pIdx.players) ? pIdx.players : null;
  if (!plist || !plist.length) fail('player-index.json holds no player');
  const shards = fs.mkdtempSync(path.join(os.tmpdir(), 'set-repairs-shards-'));
  for (let i = 0; i < keys.length; i += 4) {
    await Promise.all(keys.slice(i, i + 4).map(async (k) => {
      const j = await siteJson(site, `career-history/${k}.json`);
      if (!j || !Array.isArray(j.matches)) fail(`career-history/${k}.json holds no matches`);
      fs.writeFileSync(path.join(shards, `${k}.json`), JSON.stringify({ key: k, matches: j.matches }));
    }));
  }
  // identity, then the NEW short rows only
  const nameOf = new Map(plist.map((p) => [String(p.key), p.name]));
  const { sids, names, stats } = buildIdentity({ roster: keys.map((k) => ({ key: k, name: nameOf.get(k) || null })), storeIndex: idx,
    playersCsv: fs.readFileSync(path.join(sackmann, 'atp_players.csv'), 'utf8') });
  const fresh = buildFn({ shards, teDir, sack, sids, names, only: (key, r) => !isKnown(prev, String(key), String(r.eventKey)) });
  const next = merge(prev, fresh, now);
  const why = checkFrozen(prev, next);
  const added = entries(fresh.repairs).length, flagged = entries(fresh.flags).length;
  const summary = { players: keys.length, sackmannIds: stats.byDob, newShortRows: fresh.shortRows || 0, repaired: added, flagged,
    frozen: { repairs: entries(prev.repairs).length, flags: entries(prev.flags).length } };
  if (why.length) return { ok: false, why, summary };
  if (!added && !flagged) { log(`set repairs: no new short row · ${JSON.stringify(summary)}`); return { ok: true, why: [], summary, wrote: false }; }
  const tmp = path.join(store, `.${REPAIRS}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(next)); fs.renameSync(tmp, path.join(store, REPAIRS));
  const lines = [...entries(fresh.repairs).map(([k, ek, v]) => ({ kind: 'repaired', key: k, eventKey: ek, date: v.date, opp: v.opp, old: v.short, new: v.sets, te: v.te, sackmann: v.sackmann })),
    ...entries(fresh.flags).map(([k, ek, v]) => ({ kind: 'flagged', key: k, eventKey: ek, date: v.date, opp: v.opp, short: v.short, why: v.why }))];
  fs.appendFileSync(path.join(store, REPAIRS_LOG), lines.map((l) => JSON.stringify({ at: now, ...l })).join('\n') + '\n');
  log(`set repairs: ${JSON.stringify(summary)}`);
  return { ok: true, why: [], summary, wrote: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const store = path.resolve(arg('--store', '.'));
  if (process.argv.includes('--week-complete')) {
    let c = false; try { c = weekComplete(JSON.parse(fs.readFileSync(path.join(store, INDEX), 'utf8'))); } catch (e) { c = false; }
    console.log(`complete=${c}`); if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `complete=${c}\n`);
    if (!c) console.log('set repairs: skipped — this week\'s weekly parts have not all completed');
    process.exit(0);
  }
  try {
    const r = await refresh({ store, sackmann: arg('--sackmann'), site: arg('--site', SITE) });
    if (!r.ok) { console.log(`::error::set repairs refused to write — a frozen repair or flag would change: ${r.why.slice(0, 20).join('; ')}${r.why.length > 20 ? ` (+${r.why.length - 20} more)` : ''}; ${REPAIRS} is unchanged`); process.exit(1); }
  } catch (e) {
    console.log(`::error::set repairs: ${e.message} — nothing written`); process.exit(1);
  }
}
