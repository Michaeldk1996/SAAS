#!/usr/bin/env node
// Builds quote-entrants.json (founder rulings 2026-10-23): extra entrant lists for TOURNAMENT-QUOTE MATCHING ONLY.
//  - main draw: a quoted season the tournament store (tournament-profiles.json, five seasons) does not hold -> the
//    pinned Sackmann main draw (tennis_atp atp_matches_<y>.csv);
//  - qualifying: every quoted event-season the pinned copy covers (atp_matches_qual_chall_<y>.csv, rounds Q*, tour-level
//    events only), minus anyone Sackmann's own main draw of that event lists (a qualifier who got through is that man).
// Each entrant carries our player ID only through an ID chain: Sackmann name -> the ATP code TML (the Sackmann-schema
// mirror, which carries ATP codes) gives that name at the same event + season -> the alias map reversed. No code or no
// alias = key null (matched, monogram). Sackmann data is a flat file read here, never at runtime.
// Usage: node tools/build-quote-entrants.js <repo> <sackmann dir> <tournament-profiles.json (the deployed store)> [<tml dir>]
// (the committed tournament-profiles.json is a stale snapshot: the pipeline keeps the live one in its Actions cache)
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const [REPO, SK, TPF, TMLD] = process.argv.slice(2);
if (!REPO || !SK) { console.error('usage: build-quote-entrants.js <repo> <sackmann dir> [tournament-profiles.json]'); process.exit(2); }
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// the pinned copy is verified file by file before use (the te-resolve.js rule)
const sums = {}; fs.readFileSync(path.join(SK, 'SHA256SUMS'), 'utf8').trim().split('\n').forEach((l) => { const [h, f] = l.trim().split(/\s+/); sums[f.replace(/^\*/, '')] = h; });
const used = new Set();
const csv = (dir, f, verify) => { const p = path.join(dir, f); if (!fs.existsSync(p)) return [];
  if (verify) { const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); if (sums[f] !== h) throw new Error('SHA256 mismatch: ' + f); used.add(f); }
  const L = fs.readFileSync(p, 'utf8').split('\n'); const hd = L[0].split(',');
  return L.slice(1).filter(Boolean).map((l) => { const c = l.split(','); const o = {}; hd.forEach((k, i) => (o[k] = c[i])); return o; }); };
const Q = J(path.join(REPO, 'tournament-quotes.json')).tournaments;
const TP = J(TPF || path.join(REPO, 'tournament-profiles.json')).profiles;
const A = J(path.join(REPO, 'player-atp-aliases.json'));
const byCode = {}; for (const [k, c] of Object.entries(A)) byCode[c] = k;
const ALIAS = { 'Roland Garros': 'French Open' };
const SKNAME = { 'Monte Carlo': 'Monte Carlo Masters', Madrid: 'Madrid Masters', Rome: 'Rome Masters', 'Indian Wells': 'Indian Wells Masters',
  Miami: 'Miami Masters', Shanghai: 'Shanghai Masters', Cincinnati: 'Cincinnati Masters', Paris: 'Paris Masters' };
const evMatch = (tn, ev) => tn === (SKNAME[ev] || ev);
const out = {};
const need = new Set();
for (const [ev, list] of Object.entries(Q)) for (const q of list) if (q.year != null) need.add(ev + '|' + q.year);
for (const k of [...need].sort()) {
  const [ev, season] = k.split('|');
  const prof = TP[ev] || TP[ALIAS[ev]];
  const inStore = !!(prof && (prof.allEditionMatches || []).some((e) => String(e.season) === season));
  const tml = {}; for (const r of csv(TMLD || path.join(REPO, 'tml-cache'), season + '.csv', false)) if (evMatch(r.tourney_name, ev)) { tml[r.winner_name] = r.winner_id; tml[r.loser_name] = r.loser_id; }
  const keyOf = (n) => { const c = tml[n]; return c && byCode[c] ? byCode[c] : null; };
  const main = new Set(); for (const r of csv(SK, 'atp_matches_' + season + '.csv', true)) if (evMatch(r.tourney_name, ev) && /^[MAG]$/.test(r.tourney_level)) { main.add(r.winner_name); main.add(r.loser_name); }
  const qual = new Set(); for (const r of csv(SK, 'atp_matches_qual_chall_' + season + '.csv', true)) if (evMatch(r.tourney_name, ev) && /^[MAG]$/.test(r.tourney_level) && /^Q/.test(r.round)) { qual.add(r.winner_name); qual.add(r.loser_name); }
  const entry = {};
  if (!inStore && main.size) entry.main = [...main].sort().map((n) => ({ name: n, key: keyOf(n) }));
  const q2 = [...qual].filter((n) => !main.has(n)).sort();
  if (q2.length) entry.qual = q2.map((n) => ({ name: n, key: null }));   // TML carries no qualifying: no ATP code, no ID
  if (entry.main || entry.qual) out[k] = entry;
}
const doc = {
  _doc: 'Founder rulings 2026-10-23: entrant lists for TOURNAMENT-QUOTE MATCHING ONLY (tourxQuoteSpeakerKey). main = a quoted ' +
    'season tournament-profiles.json does not hold (Sackmann main draw); qual = Sackmann qualifying entrants not in that ' +
    'main draw. key = our player ID via TML\'s ATP code at the same event + season and the alias map; null = no ID chain.',
  source: 'JeffSackmann/tennis_atp pinned copy (store sackmann/, SHA256-verified: ' + [...used].sort().join(', ') + '); ATP codes from TML-Database',
  builtBy: 'node tools/build-quote-entrants.js <repo> <sackmann dir> <deployed tournament-profiles.json> [<tml dir>]',
  events: out,
};
fs.writeFileSync(path.join(REPO, 'quote-entrants.json.tmp'), JSON.stringify(doc, null, 1) + '\n');
fs.renameSync(path.join(REPO, 'quote-entrants.json.tmp'), path.join(REPO, 'quote-entrants.json'));
const nMain = Object.values(out).filter((e) => e.main).length, nQual = Object.values(out).filter((e) => e.qual).length;
console.log(`quote-entrants.json: ${Object.keys(out).length} event-seasons (${nMain} main, ${nQual} qualifying), ${fs.statSync(path.join(REPO, 'quote-entrants.json')).size} bytes`);
