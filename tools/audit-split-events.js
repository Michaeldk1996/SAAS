// tools/audit-split-events.js — find ONE real event that reaches us under
// several names and therefore renders as several tournament rows.
//
// TEN-206-A item 3 (founder ruling 2026-09-18). Tour Finals is the named case;
// the ruling also asks for the full list of events split the same way, with row
// counts, BEFORE any of the rest are merged.
//
// METHOD. Two independent signals, because either alone produces noise:
//   (a) SAME-PLAYER CO-OCCURRENCE IN A YEAR. One player cannot play two
//       different events in the same calendar year and have them be the same
//       event — unless they ARE the same event under two names, in which case
//       the SAME matches appear under both rows. So: for each pair of distinct
//       tournament identities a player holds in a shared year, compare the
//       match sets. Identical or overlapping match sets in a shared year is the
//       double-count signature.
//   (b) NAME KINSHIP. Token-level containment or a shared distinctive token
//       between two identities ("finals" ⊂ "finals turin"), which catches a
//       rename that happened cleanly — no player ever holding both — and which
//       (a) therefore cannot see.
//
// Signal (a) is EVIDENCE of a defect. Signal (b) is a CANDIDATE for a ruling.
// The output separates them and never merges anything itself.
//
// Reads the DEPLOYED store. Run: node tools/audit-split-events.js [--json]

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DEPLOYED = require('./deployed-store.js');
const { canonicalTournament, identityKey } = require('../tournament-identity.js');

const STORE = DEPLOYED.playerProfiles();
if (STORE.source !== 'deployed') { console.error('✗ deployed store unreachable'); process.exit(1); }
const PROFILES = STORE.players;
const TH = DEPLOYED.hydrateTournamentHistory(PROFILES);
if (TH.error || TH.attached < TH.indexed) { console.error(`✗ hydrate short: ${TH.error || TH.attached + '/' + TH.indexed}`); process.exit(1); }

// ── inventory every tournament identity on the deployed store ───────────────
const ident = new Map(); // id -> { id, displays:Map(name->rows), rows, editions, matches, players:Set, years:Set }
function slot(id, display) {
  let e = ident.get(id);
  if (!e) { e = { id, displays: new Map(), rows: 0, editions: 0, matches: 0, players: new Set(), years: new Set() }; ident.set(id, e); }
  e.displays.set(display, (e.displays.get(display) || 0) + 1);
  return e;
}
// playerKey -> Map(id -> Map(year -> [matchSignature]))
const byPlayer = new Map();
function sig(m) { return `${m.round}|${m.res}|${m.opp}|${m.score}`; }

for (const [key, p] of Object.entries(PROFILES)) {
  const perId = new Map();
  for (const t of (p.tournamentHistory || [])) {
    const { id } = canonicalTournament(t.name);
    const e = slot(id, t.name);
    e.rows++; e.players.add(key);
    let ym = perId.get(id); if (!ym) { ym = new Map(); perId.set(id, ym); }
    for (const ed of (t.editions || [])) {
      e.editions++; e.years.add(Number(ed.year));
      const ms = (ed.matches || []);
      e.matches += ms.length;
      const arr = ym.get(Number(ed.year)) || [];
      ms.forEach((m) => arr.push(sig(m)));
      ym.set(Number(ed.year), arr);
    }
  }
  byPlayer.set(key, perId);
}

// ── (a) same-player, same-year co-occurrence with overlapping matches ───────
const pairEvidence = new Map(); // "idA||idB" -> { players:Set, years:Set, sharedMatches, totalA, totalB }
for (const [key, perId] of byPlayer) {
  const ids = [...perId.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = perId.get(ids[i]), B = perId.get(ids[j]);
      for (const [year, aMs] of A) {
        const bMs = B.get(year);
        if (!bMs) continue;
        const bSet = new Set(bMs);
        const shared = aMs.filter((s) => bSet.has(s)).length;
        if (!shared) continue;
        // A match signature is round|result|opponent|score, which is NOT unique
        // across events: a player can beat the same opponent in the same round
        // by the same score at Indian Wells and at Miami in one year, and that
        // pair duly showed up at 10 shared rows out of ~3,600. Coincidence and
        // duplication are told apart by the OVERLAP RATIO against the smaller
        // side's matches that year — a genuine split is ~1.0, a collision ~0.01.
        const ratio = shared / Math.min(aMs.length, bMs.length);
        const pk = ids[i] < ids[j] ? `${ids[i]}||${ids[j]}` : `${ids[j]}||${ids[i]}`;
        let e = pairEvidence.get(pk);
        if (!e) { e = { players: new Set(), years: new Set(), sharedMatches: 0, ratios: [] }; pairEvidence.set(pk, e); }
        e.players.add(key); e.years.add(year); e.sharedMatches += shared; e.ratios.push(ratio);
      }
    }
  }
}

// ── (b) name kinship between distinct identities ───────────────────────────
// Stop-tokens are the words that appear across many unrelated events; two
// identities sharing only one of those are not kin.
const STOP = new Set(['atp', 'open', 'cup', 'masters', 'championships', 'international',
  'classic', 'championship', 'tennis', 'trophy', 'de', 'do', 'du', 'la', 'le', 'of', 'the', '1', '2']);
const toks = (id) => id.split(' ').filter((t) => t && !STOP.has(t));
const idList = [...ident.keys()];
const kinship = [];
for (let i = 0; i < idList.length; i++) {
  for (let j = i + 1; j < idList.length; j++) {
    const a = toks(idList[i]), b = toks(idList[j]);
    if (!a.length || !b.length) continue;
    const aS = new Set(a), bS = new Set(b);
    const shared = a.filter((t) => bS.has(t));
    if (!shared.length) continue;
    const contained = a.every((t) => bS.has(t)) || b.every((t) => aS.has(t));
    if (!contained) continue;              // require containment, not mere overlap
    kinship.push({ a: idList[i], b: idList[j], shared });
  }
}

// ── report ─────────────────────────────────────────────────────────────────
function line(id) {
  const e = ident.get(id);
  const names = [...e.displays.entries()].sort((x, y) => y[1] - x[1]).map(([n, c]) => `"${n}"×${c}`).join(', ');
  const yrs = [...e.years].sort();
  return `${String(e.rows).padStart(4)} rows · ${String(e.editions).padStart(5)} eds · ${String(e.matches).padStart(5)} matches · `
    + `${String(e.players.size).padStart(3)} players · ${yrs.length ? yrs[0] + '–' + yrs[yrs.length - 1] : '—'}  ${names}`;
}

console.log(`store: DEPLOYED ${STORE.fetchedAt} · ${Object.keys(PROFILES).length} players · `
  + `${ident.size} tournament identities · ${TH.tournamentRows} tournament rows\n`);

console.log('═══ (A) MEASURED DOUBLE-COUNTING — the same matches under two identities ═══');
console.log('    These are not candidates. A player holds the identical match rows under both names.\n');
const MEAN = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const all = [...pairEvidence.entries()].map(([pk, e]) => ({ pk, e, overlap: MEAN(e.ratios) }));
// >=0.5 mean overlap == the two rows are largely the SAME matches. Below that,
// a handful of signature collisions across thousands of rows.
// Three bands. A high ratio alone is not enough: two matches out of three in a
// single year is 67% and means nothing. A genuine split shows the overlap
// across MANY players, so the absolute counts carry the confidence.
const band = (x) => (x.e.players.size >= 5 && x.e.sharedMatches >= 10 && x.overlap >= 0.5) ? 'confirmed'
  : (x.overlap >= 0.8 && x.e.sharedMatches >= 3) ? 'likely' : 'noise';
const byBand = (b) => all.filter((x) => band(x) === b).sort((x, y) => y.e.sharedMatches - x.e.sharedMatches);
const evid = byBand('confirmed');
const likely = byBand('likely');
const noise = byBand('noise');
if (!evid.length) console.log('    (none)');
evid.forEach(({ pk, e, overlap }) => {
  const [a, b] = pk.split('||');
  console.log(`  ● "${a}"  ✕  "${b}"    overlap ${(overlap * 100).toFixed(0)}%`);
  console.log(`      ${e.sharedMatches} duplicated match rows across ${e.players.size} players, years ${[...e.years].sort().join(', ')}`);
  console.log(`      A: ${line(a)}`);
  console.log(`      B: ${line(b)}`);
});
console.log(`\n  ── LIKELY (high overlap, thin counts — real but small): ${likely.length} pairs ──`);
likely.forEach(({ pk, e, overlap }) =>
  console.log(`      "${pk.split('||').join('" ✕ "')}"  ${e.sharedMatches} rows / ${e.players.size} players, `
    + `overlap ${(overlap * 100).toFixed(0)}%, years ${[...e.years].sort().join(', ')}`));
console.log(`\n  ── NOISE (signature collisions across unrelated events): ${noise.length} pairs, `
  + `max ${noise.length ? noise[0].e.sharedMatches : 0} shared rows ──`);

console.log('\n═══ (B) NAME-KINSHIP CANDIDATES — report only, no merge without a ruling ═══');
console.log('    One identity\'s distinctive tokens are contained in the other\'s. Some are real\n'
  + '    renames; some are genuinely different events (a "2" suffix, a different city).\n');
if (!kinship.length) console.log('    (none)');
kinship.sort((x, y) => (ident.get(y.a).matches + ident.get(y.b).matches) - (ident.get(x.a).matches + ident.get(x.b).matches));
kinship.forEach((k) => {
  console.log(`  ○ "${k.a}"  ~  "${k.b}"   (shared: ${k.shared.join(', ')})`);
  console.log(`      A: ${line(k.a)}`);
  console.log(`      B: ${line(k.b)}`);
});

// ── the year-end championship, named explicitly by the ruling ──────────────
console.log('\n═══ YEAR-END CHAMPIONSHIP — every identity that could be it ═══');
const YE = /final|masters cup|tour final|turin|world tour/i;
const ye = idList.filter((id) => YE.test(id) && !/next gen/i.test(id));
ye.forEach((id) => console.log(`  ${String(id).padEnd(28)} ${line(id)}`));
if (!ye.length) console.log('  (none)');

if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(ROOT, 'ten206a-split-events.json'), JSON.stringify({
    store: STORE.fetchedAt,
    identities: [...ident.entries()].map(([id, e]) => ({ id, displays: [...e.displays], rows: e.rows, editions: e.editions, matches: e.matches, players: e.players.size, years: [...e.years].sort() })),
    measuredDoubleCounting: evid.map(([pk, e]) => ({ pair: pk.split('||'), sharedMatches: e.sharedMatches, players: [...e.players], years: [...e.years].sort() })),
    kinshipCandidates: kinship,
    yearEndIdentities: ye,
  }, null, 2));
  console.log('\n  wrote ten206a-split-events.json');
}
