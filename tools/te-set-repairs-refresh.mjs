#!/usr/bin/env node
// TEN-449 · the weekly refresh's set-repair step (plan §4a, founder-approved 19 Oct). Runs in the PRIVATE store repo's
// Actions (template tools/te-store-repo/te-refresh.yml), after BOTH weekly parts of one Monday have completed. It adds
// set repairs for NEW short rows only — the rows set-repairs.json does not hold yet, as a repair or a flag (J. Sels's 6
// are the first). Two classes of entry (coordinator ruling for the founder, TEN-449, 20 Oct):
//   FROZEN    every entry of the 17 Oct build (3,217 repairs, 341 flags) — no `by` field. Never changes, drops or moves.
//   REFRESH   every entry this step writes — `by: 'refresh'` + `at`. A repair never changes. A flag whose reason is that
//             Tennis Explorer lacks the row ("… no Tennis Explorer row …", e.g. the player was not in the store yet) is
//             re-checked each run and UPGRADED to a repair once TE and Sackmann agree; any other outcome keeps it as is.
// If a rebuild would break either rule it exits 1 and writes nothing. The frozen set is pinned in code (FROZEN_PIN: counts
// + sha256): a committed file whose unmarked entries do not hash to it stops the step before anything is built.
//
//   node saas/tools/te-set-repairs-refresh.mjs --store . --sackmann <dir> [--site <url|dir>]
//   node saas/tools/te-set-repairs-refresh.mjs --store . --week-complete     (prints complete=true|false; exit 0)
//
// Inputs, every one required (a missing or unreadable input exits 1 and writes nothing — fail closed):
//   the store            te-history-index.json, te-history/, set-repairs.json (the store repo root, just refreshed)
//   the deployed site    career-history-index.json + career-history/<key>.json for every player it lists (the rows the
//                        site serves, set repairs already applied, so a repaired row is no longer short), and
//                        player-index.json (our names)
//   Sackmann             the store repo's sackmann/: atp_players.csv + atp_matches*.csv, each verified against the
//                        committed sackmann/SHA256SUMS before use (JeffSackmann/tennis_atp is no longer public, 404 on
//                        19 Oct; sackmann/PROVENANCE.md shows these files reproduce the 17 Oct set-repairs.json)
// The Sackmann-id / name input tools/build-set-repairs.mjs takes (on the Mac, a hand-built file) is built here by
// buildIdentity(): a player's Sackmann id is the one atp_players.csv row with his date of birth (from the TE store,
// where he was joined on it) and his surname; anyone else is matched by name inside the builder, as before.
import crypto from 'node:crypto';
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
const get = (o, kind, k, ek) => (((o || {})[kind] || {})[k] || {})[ek];
// a refresh-written flag that may still become a repair: Tennis Explorer lacked the row when it was written
export const upgradable = (f) => !!f && f.by === 'refresh' && /no Tennis Explorer row/.test(String(f.why || ''));
export const isKnown = (prev, key, ek) => !!(get(prev, 'repairs', key, ek) || get(prev, 'flags', key, ek));
// the rows this run (re)builds: new short rows, and refresh-written flags that may upgrade
export const wanted = (prev, key, ek) => !isKnown(prev, key, ek) || upgradable(get(prev, 'flags', key, ek));
const tallyOf = (why) => String(why).replace(/\s*\(.*$/, '').replace(/:.*$/, '');
export function merge(prev, fresh, at) {
  const next = { ...prev, builtAt: prev.builtAt, refreshedAt: at, repairs: {}, flags: {}, counts: { ...(prev.counts || {}) }, shortRows: prev.shortRows || 0 };
  for (const kind of ['repairs', 'flags']) for (const [k, m] of Object.entries(prev[kind] || {})) next[kind][k] = { ...m };
  const added = { repaired: [], flagged: [], upgraded: [] };
  const tally = (c, n) => { next.counts[c] = (next.counts[c] || 0) + n; if (!next.counts[c]) delete next.counts[c]; };
  // The merge applies what the builder returned as it is; checkFrozen (below) is the one judge. The builder is asked only
  // for new rows and upgradable flags (wanted), so a fresh entry landing on any other existing entry is a fault the
  // check refuses — never something the merge quietly skips.
  for (const [k, ek, v] of entries(fresh.repairs)) {
    const old = get(prev, 'flags', k, ek), oldRep = get(prev, 'repairs', k, ek);
    const e = { ...v, by: 'refresh', at, ...(old ? { upgradedFrom: old.why } : {}) };
    (next.repairs[k] = next.repairs[k] || {})[ek] = e;
    if (oldRep) continue;
    tally(`repaired (TE ${v.te} page + Sackmann)`, 1);
    if (old) { delete next.flags[k][ek]; if (!Object.keys(next.flags[k]).length) delete next.flags[k]; tally(tallyOf(old.why), -1); added.upgraded.push([k, ek, e, old]); }
    else { next.shortRows++; added.repaired.push([k, ek, e]); }
  }
  for (const [k, ek, v] of entries(fresh.flags)) {
    if (upgradable(get(prev, 'flags', k, ek))) continue;   // re-checked and still not a repair: kept exactly as it was
    const e = { ...v, by: 'refresh', at }; const known = isKnown(prev, k, ek);
    (next.flags[k] = next.flags[k] || {})[ek] = e;
    if (!known) { tally(tallyOf(v.why), 1); next.shortRows++; added.flagged.push([k, ek, e]); }
  }
  return { next, added };
}
// The 17 Oct entries, pinned in code (TEN-449 review): the committed file's unmarked entries must hash to exactly this,
// so neither a hand edit of the store nor a refresh bug can change the frozen set without this file changing too.
// Digest: sha256 over the sorted lines `kind \t key \t eventKey \t canonical JSON (keys sorted)`, one per entry.
export const FROZEN_PIN = { repairs: 3217, flags: 341, sha256: '04d56a0d32df13066e3bb55f7b2e8293368b3e82f2c87fb954ed62fa90ac7a2b' };
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
export function frozenDigest(file) {
  const lines = []; const n = { repairs: 0, flags: 0 };
  for (const kind of ['repairs', 'flags']) for (const [k, ek, v] of entries(file[kind])) if (v.by !== 'refresh') { n[kind]++; lines.push(`${kind}\t${k}\t${ek}\t${canon(v)}`); }
  return { ...n, sha256: crypto.createHash('sha256').update(lines.sort().join('\n')).digest('hex') };
}
export function checkPin(file, pin = FROZEN_PIN) {
  const d = frozenDigest(file);
  return d.repairs === pin.repairs && d.flags === pin.flags && d.sha256 === pin.sha256 ? []
    : [`the frozen 17 Oct entries do not match the pin (file: ${d.repairs} repairs, ${d.flags} flags, ${d.sha256.slice(0, 12)}; pin: ${pin.repairs}, ${pin.flags}, ${pin.sha256.slice(0, 12)})`];
}

// FROZEN entries and every repair: in `next` exactly as they were, in the same list. A refresh-written flag: as it was,
// or — only if upgradable — gone from the flags and present as a refresh repair.
export function checkFrozen(prev, next) {
  const why = [];
  for (const [kind, other] of [['repairs', 'flags'], ['flags', 'repairs']]) {
    for (const [k, ek, v] of entries(prev[kind])) {
      const now = get(next, kind, k, ek), there = get(next, other, k, ek);
      const cls = v.by === 'refresh' ? 'refresh' : 'frozen';
      if (kind === 'flags' && upgradable(v) && now === undefined && there && there.by === 'refresh' && there.upgradedFrom === v.why) continue;
      if (now === undefined) why.push(`${cls} ${kind} ${k}/${ek} dropped`);
      else if (!isDeepStrictEqual(now, v)) why.push(`${cls} ${kind} ${k}/${ek} changed`);
      if (there !== undefined) why.push(`${cls} ${kind} ${k}/${ek} also in ${other}`);
    }
  }
  return why;
}

// ── Sackmann: the store's pinned copy, checked file by file against SHA256SUMS ─────────────────────────────────────
export const SACK_FILE = /^(atp_players|atp_matches_(qual_chall_|futures_)?\d{4})\.csv$/;
export function verifySackmann(dir) {
  const sums = path.join(dir || '', 'SHA256SUMS');
  if (!dir || !fs.existsSync(sums)) fail(`Sackmann SHA256SUMS missing (${sums})`);
  const listed = new Map();
  for (const l of fs.readFileSync(sums, 'utf8').split('\n').filter((x) => x.trim())) {
    const m = /^([0-9a-f]{64}) [ *]?(\S+)$/.exec(l.trim()); if (!m) fail(`Sackmann SHA256SUMS: unreadable line "${l}"`);
    listed.set(m[2], m[1]);
  }
  if (!listed.has('atp_players.csv')) fail('Sackmann SHA256SUMS does not list atp_players.csv');
  if (![...listed.keys()].some((f) => f !== 'atp_players.csv' && SACK_FILE.test(f))) fail('Sackmann SHA256SUMS lists no match CSV');
  for (const [f, h] of listed) {
    const p = path.join(dir, f); if (!fs.existsSync(p)) fail(`Sackmann ${f} missing (listed in SHA256SUMS)`);
    const got = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if (got !== h) fail(`Sackmann ${f} does not match SHA256SUMS (${got.slice(0, 12)} ≠ ${h.slice(0, 12)})`);
  }
  // the loader reads every matching file in the directory: an unlisted one would be read unverified
  const extra = fs.readdirSync(dir).filter((f) => SACK_FILE.test(f) && !listed.has(f));
  if (extra.length) fail(`Sackmann file(s) not in SHA256SUMS: ${extra.join(', ')}`);
  return listed.size;
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
export async function refresh({ store, sackmann, site = SITE, now = new Date().toISOString(), buildFn = buildRepairs, log = console.log, frozenPin = FROZEN_PIN }) {
  // the store
  const idx = readJson(path.join(store, INDEX), INDEX);
  const teDir = path.join(store, STORE_DIR);
  if (!fs.existsSync(teDir) || !fs.statSync(teDir).isDirectory()) fail(`${STORE_DIR}/ missing in ${store}`);
  const prev = readJson(path.join(store, REPAIRS), REPAIRS);
  if (!prev || typeof prev.repairs !== 'object' || !prev.repairs || typeof prev.flags !== 'object' || !prev.flags) fail(`${REPAIRS} holds no repairs/flags maps`);
  { const p = checkPin(prev, frozenPin); if (p.length) fail(p[0]); }
  // Sackmann: every file verified before a byte is used
  verifySackmann(sackmann);
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
  const fresh = buildFn({ shards, teDir, sack, sids, names, only: (key, r) => wanted(prev, String(key), String(r.eventKey)) });
  const { next, added } = merge(prev, fresh, now);
  const why = [...checkFrozen(prev, next), ...checkPin(next, frozenPin)];
  const frozen = (kind) => entries(prev[kind]).filter(([, , v]) => v.by !== 'refresh').length;
  const summary = { players: keys.length, sackmannIds: stats.byDob, rowsChecked: fresh.shortRows || 0, repaired: added.repaired.length,
    flagged: added.flagged.length, upgraded: added.upgraded.length, frozen: { repairs: frozen('repairs'), flags: frozen('flags') } };
  if (why.length) return { ok: false, why, summary };
  if (!added.repaired.length && !added.flagged.length && !added.upgraded.length) { log(`set repairs: nothing new · ${JSON.stringify(summary)}`); return { ok: true, why: [], summary, wrote: false }; }
  const tmp = path.join(store, `.${REPAIRS}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(next)); fs.renameSync(tmp, path.join(store, REPAIRS));
  const lines = [...added.repaired.map(([k, ek, v]) => ({ kind: 'repaired', key: k, eventKey: ek, date: v.date, opp: v.opp, old: v.short, new: v.sets, te: v.te, sackmann: v.sackmann })),
    ...added.upgraded.map(([k, ek, v, old]) => ({ kind: 'upgraded', key: k, eventKey: ek, date: v.date, opp: v.opp, old: v.short, new: v.sets, was: old.why, te: v.te, sackmann: v.sackmann })),
    ...added.flagged.map(([k, ek, v]) => ({ kind: 'flagged', key: k, eventKey: ek, date: v.date, opp: v.opp, short: v.short, why: v.why }))];
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
    if (!r.ok) { console.log(`::error::set repairs refused to write — a frozen entry or a repair would change: ${r.why.slice(0, 20).join('; ')}${r.why.length > 20 ? ` (+${r.why.length - 20} more)` : ''}; ${REPAIRS} is unchanged`); process.exit(1); }
  } catch (e) {
    console.log(`::error::set repairs: ${e.message} — nothing written`); process.exit(1);
  }
}
