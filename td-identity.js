'use strict';
// One identity gate for every Tennis-Data name join (founder ruling 2026-10-18, the Martín mix-up).
//
// A Tennis-Data row names a player only by surname + initials ("Martin A."). The name join (each builder's own
// resolver over its roster) gives a candidate key; this gate then decides whether that key may take the row:
//   1. never before his career began: a row dated more than CAREER_SLACK_DAYS before the key's first match in our
//      career-history store is someone else's (Alberto Martín 2004–10 and Andrej Martin 2010–20 are not key 1056,
//      whose career begins in 2021);
//   2. exactly one player active on that date: any OTHER person in the store whose name fits the Tennis-Data name and
//      who has a match within CAREER_SLACK_DAYS of the row's date makes the row a dash — never a guess between two;
//   3. one person, two keys, is recognised from the data only: two keys sharing a Tennis Abstract id, or a key seen
//      only as an opponent whose every match is the same match a profiled key's own shard holds (same opponent, ±1 day);
//   4. an AMBIGUOUS name (founder 2026-10-22, containment): when any other person we can tell apart ever fit the
//      Tennis-Data name — in our store, or in ambiguous-archive-names.json.gz (two or more Tennis Abstract players share
//      that surname + first initial: tools/build-ambiguous-archive-names.js) — the row is the key's only if his OWN shard holds that match — a played row within
//      OWN_MATCH_DAYS of the row's date against the row's opponent (his surname inside our opponent name). Anything
//      else is a dash ("identity unverified"), counted per key: a wrong number is worse than a missing one. And Tennis
//      Abstract can veto: when its match that week against that opponent was played by a namesake whose first name is
//      spelled out and differs from ours, the row is refused even if our store holds it (the store misfiled Ze Zhang's
//      2015 Shenzhen matches under Zhizhen Zhang). An abbreviated name ("A. Hernandez") is never vetoed. Applies when
//      the caller passes the row's opponent (every Tennis-Data builder does).
// The store: career-history/{key}.json — each player's own rows (`date`), his Tennis Abstract `id`, and opponent rows
// carrying `oppKey` (api-tennis) or `oppId` (Tennis Abstract). Without the store the gate is absent and the builder
// says so out loud (callers keep their resolver unchanged).
const fs = require('fs');
const path = require('path');
const { keyFromArchiveName, ourCandidateKeys, archiveOverride } = require('./build-odds-performance.js');

const CAREER_SLACK_DAYS = 30;
const OWN_MATCH_DAYS = 3;
const letters = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const day = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; };

function fits(ck, k) {
  return ck.surname === k.surname && ck.initials && k.initials && (ck.initials.startsWith(k.initials) || k.initials.startsWith(ck.initials));
}

// rosterNames: Map key -> name (or Set of names) the builder already knows (profiles); added as name evidence.
function buildIdentityGate(root, rosterNames) {
  const dir = path.join(root, 'career-history');
  if (!fs.existsSync(dir)) return null;
  const shards = new Map();
  for (const f of fs.readdirSync(dir)) {
    const m = /^(\d+)\.json$/.exec(f); if (!m) continue;
    let d = null; try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { d = null; }
    if (d && Array.isArray(d.matches)) shards.set(m[1], d);
  }
  if (!shards.size) return null;
  // person id: own key; keys sharing a Tennis Abstract id are one person (the first key seen owns it)
  const tmlOwner = new Map(), personOf = new Map();
  for (const [k, d] of shards) {
    const t = d.id != null && d.id !== '' ? String(d.id) : null;
    if (t && tmlOwner.has(t)) personOf.set(k, tmlOwner.get(t));
    else { if (t) tmlOwner.set(t, k); personOf.set(k, k); }
  }
  const P = new Map();      // person -> { lo, hi, names:Set, keys:Set, own:bool }
  const person = (id) => { if (!P.has(id)) P.set(id, { id, lo: Infinity, hi: -Infinity, names: new Set(), nameN: new Map(), keys: new Set(), own: false, tml: String(id).startsWith('tml:') }); return P.get(id); };
  const seeName = (e, n) => { if (!n) return; e.names.add(n); e.nameN.set(n, (e.nameN.get(n) || 0) + 1); };
  const seeDate = (e, d) => { if (d == null) return; if (d < e.lo) e.lo = d; if (d > e.hi) e.hi = d; };
  // a listed walkover row is not a match played: no date evidence, no opponent observation (founder 2026-10-22)
  const played = (d) => (d.matches || []).filter((r) => !r.walkover && !r.unconfirmed);
  for (const [k, d] of shards) { const e = person(personOf.get(k)); e.own = true; e.keys.add(k); played(d).forEach((r) => seeDate(e, day(r.date))); }
  // opponent observations: api-tennis key (oppKey) or Tennis Abstract id (oppId)
  const oppOnly = new Map(); // api-tennis key with no shard -> [{ date, observer }]
  for (const [k, d] of shards) for (const r of played(d)) {
    const dd = day(r.date);
    if (r.oppKey != null && r.oppKey !== '') {
      const ok = String(r.oppKey);
      if (personOf.has(ok)) { const e = person(personOf.get(ok)); seeDate(e, dd); seeName(e, r.opponent); }
      else { if (!oppOnly.has(ok)) oppOnly.set(ok, []); oppOnly.get(ok).push({ d: dd, obs: k, name: r.opponent }); }
    } else if (r.oppId != null && r.oppId !== '') {
      const t = String(r.oppId);
      const pid = tmlOwner.has(t) ? personOf.get(tmlOwner.get(t)) : `tml:${t}`;
      const e = person(pid); seeDate(e, dd); seeName(e, r.opponent);
    }
  }
  // a key seen only as an opponent: the same person as a shard key when each of its matches is a row of that key's
  // own shard against the same observer (±1 day) — the same match filed under two api-tennis keys
  const ownRowsOn = new Map(); // `${person}|${opp observer key}|${day}` from the shard's own rows
  for (const [k, d] of shards) for (const r of played(d)) {
    const pid = personOf.get(k), dd = day(r.date);
    if (r.oppKey != null && r.oppKey !== '') for (const o of [-1, 0, 1]) ownRowsOn.set(`${pid}|${r.oppKey}|${dd + o}`, true);
  }
  const merged = {};
  for (const [ok, list] of oppOnly) {
    // candidate owners: persons whose own shard has, for EVERY observation, a row against that observer on that day
    let owners = null;
    for (const o of list) {
      const here = new Set();
      for (const [pid, e] of P) if (e.own && ownRowsOn.has(`${pid}|${o.obs}|${o.d}`)) here.add(pid);
      owners = owners == null ? here : new Set([...owners].filter((x) => here.has(x)));
      if (!owners.size) break;
    }
    if (owners && owners.size === 1) {
      const pid = [...owners][0]; personOf.set(ok, pid); merged[ok] = pid;
      const e = person(pid); e.keys.add(ok); list.forEach((o) => { seeDate(e, o.d); seeName(e, o.name); });
    } else {
      personOf.set(ok, ok); const e = person(ok); e.keys.add(ok); e.oppOnly = true; list.forEach((o) => { seeDate(e, o.d); seeName(e, o.name); });
    }
  }
  if (rosterNames) rosterNames.forEach((v, k) => { const pid = personOf.get(String(k)); if (!pid) return; [].concat(v instanceof Set ? [...v] : v).forEach((n) => { if (n) { P.get(pid).names.add(n); P.get(pid).profileName = n; } }); });
  // name index. A rival must be a person we can tell apart: his own shard, or a Tennis Abstract identity — an api-tennis
  // key seen only as an opponent, with neither, cannot be told from a duplicate key of the same player (measured 18 Oct:
  // D. E. Galan 34000 / 1735, B. N. Nakashima 1249 / 2838, A. Blockx 26614 / 39913), so it is never a rival. And a name is
  // a person's own only when it is his profile's, or at least a quarter of the times others name him (one Tennis
  // Abstract id that a few rows give to another player — "M. Huesler" under J. Millman's id — names nobody).
  const bySurname = new Map();
  for (const [pid, e] of P) {
    if (e.oppOnly) continue;
    const tot = [...e.nameN.values()].reduce((a, b) => a + b, 0);
    e.names.forEach((n) => {
      if (n !== e.profileName && tot && (e.nameN.get(n) || 0) < 0.25 * tot && e.nameN.size > 1) return;
      ourCandidateKeys(n).forEach((ck) => { if (!ck.surname) return; if (!bySurname.has(ck.surname)) bySurname.set(ck.surname, []); bySurname.get(ck.surname).push({ pid, ck }); });
    });
  }
  // rule 4: names more than one real player fits (Tennis Abstract), keyed surname|first-initial
  let amb = { names: {}, players: [], matches: {} };
  try { amb = JSON.parse(require('zlib').gunzipSync(fs.readFileSync(path.join(root, 'ambiguous-archive-names.json.gz'))).toString()); } catch (e) { /* absent: the store alone decides */ }
  const tmlAmbiguous = new Set(Object.keys(amb.names || {}));
  const ymd = (n) => { const s = String(n); return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 864e5; };
  // full names (player-index.json, written earlier in the run): the roster/profile names are often abbreviated ("Z. Zhang")
  const fullName = new Map();
  try { for (const p of JSON.parse(fs.readFileSync(path.join(root, 'player-index.json'), 'utf8')).players || []) if (p && p.key != null && p.name) fullName.set(String(p.key), p.name); } catch (e) { /* absent: profile names only */ }
  const firstName = (n) => { const w = String(n || '').trim().split(/\s+/); return w.length > 1 && !/\.$/.test(w[0]) && w[0].length > 1 ? letters(w[0]) : null; };
  // rule 4's evidence: each person's own played rows — day + the opponent's name reduced to letters
  const ownRows = new Map();
  for (const [k, d] of shards) { const pid = personOf.get(k); if (!ownRows.has(pid)) ownRows.set(pid, []); for (const r of played(d)) { const dd = day(r.date); if (dd != null) ownRows.get(pid).push({ d: dd, opp: letters(r.opponent) }); } }
  const stats = { checked: 0, beforeCareer: 0, otherActive: 0, unverified: 0, byKey: {} };
  const hiddenRows = new Map();   // key -> Set of rows rule 4 dashed (unique: a builder may ask twice about one row)
  const note = (key, why, name, date) => {
    const b = stats.byKey[key] || (stats.byKey[key] = { beforeCareer: 0, otherActive: 0, unverified: 0, names: {} });
    b[why]++; b.names[name] = (b.names[name] || 0) + 1; stats[why]++;
  };
  // may `key` (the resolver's answer) take the Tennis-Data row naming `name` on `date` (against `opp`)? -> true | false
  function allow(key, name, date, opp) {
    stats.checked++;
    const d = day(date); const pid = personOf.get(String(key));
    if (d == null || !pid) return true;               // a key the store does not hold: nothing to check against
    const me = P.get(pid);
    if (me.own && isFinite(me.lo) && d < me.lo - CAREER_SLACK_DAYS) { note(key, 'beforeCareer', name, date); return false; }
    if (archiveOverride(name)) return true;           // the hand-checked key table: identity, not a name guess
    const k = keyFromArchiveName(name); if (!k) return true;
    // Tennis-Data writes a longer given-name abbreviation exactly when two players share the initial ("Zhang Zh." /
    // "Zhang Ze.", "Blanch Dar."): such a name never fits a rival known by the bare initial alone
    const explicit = /\b[A-Za-z]{2,}\.(\s|$)/.test(String(name).trim().split(/\s+/).slice(1).join(' ') + ' ');
    const others = new Set();
    for (const c of bySurname.get(k.surname) || []) {
      if (c.pid === pid || !fits(c.ck, k)) continue;
      if (explicit && c.ck.initials.length < 2) continue;
      const e = P.get(c.pid);
      if (isFinite(e.lo) && d >= e.lo - CAREER_SLACK_DAYS && d <= e.hi + CAREER_SLACK_DAYS) others.add(c.pid);
    }
    if (others.size) { note(key, 'otherActive', name, date); return false; }
    // rule 4: an ambiguous name — any other person we can tell apart EVER fit it — takes the row only on his own match
    if (opp) {
      const ambiguous = tmlAmbiguous.has(`${k.surname}|${String(k.initials || '')[0]}`)
        || (bySurname.get(k.surname) || []).some((c) => c.pid !== pid && fits(c.ck, k) && !(explicit && c.ck.initials.length < 2));
      if (ambiguous) {
        const ok = keyFromArchiveName(opp); const os = ok && ok.surname;
        // Tennis Abstract veto: its match that week (tourney date within 16 days before, 2 after) against that opponent
        // was a namesake's, and our first name is spelled out and differs from every such player's
        const mine0 = firstName(fullName.get(String(key))) || firstName(me.profileName);
        const tm = os ? ((amb.matches || {})[`${k.surname}|${String(k.initials || '')[0]}`] || []).filter(([td, , o]) => { const t = ymd(td); return d >= t - 2 && d <= t + 16 && o.includes(os); }) : [];
        const hide = () => { const s = hiddenRows.get(String(key)) || new Set(); s.add(`${date}|${name}|${opp}`); hiddenRows.set(String(key), s); note(key, 'unverified', name, date); return false; };
        if (mine0 && tm.length && tm.every(([, i]) => { const f = firstName(amb.players[i]); return f && f !== mine0; })) return hide();
        const mine = ownRows.get(pid) || [];
        if (!os || !mine.some((r) => Math.abs(r.d - d) <= OWN_MATCH_DAYS && r.opp.includes(os))) return hide();
      }
    }
    return true;
  }
  // rows rule 4 hid for a key (each page says "N rows hidden: identity unverified")
  const hidden = (key) => (hiddenRows.get(String(key)) || new Set()).size;
  return { allow, stats, merged, hidden, careerStart: (key) => { const pid = personOf.get(String(key)); const e = pid && P.get(pid); return e && e.own && isFinite(e.lo) ? new Date(e.lo * 864e5).toISOString().slice(0, 10) : null; } };
}

module.exports = { buildIdentityGate, CAREER_SLACK_DAYS, OWN_MATCH_DAYS };
