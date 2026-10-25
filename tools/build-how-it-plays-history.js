#!/usr/bin/env node
// "How it plays" — the Sackmann 2016–2024 half, reduced to a small committed aggregate (founder brief round 2, item 2.1)
// =============================================================================
// The pinned Sackmann copy (~/stennisfy-te-store/sackmann, checksummed in its SHA256SUMS) is not in the repo or CI,
// so the 2016–2024 seasons reach the pipeline as sums, not rows. LOCAL ONLY:
//
//   node tools/build-how-it-plays-history.js [--sackmann DIR] [--out FILE]   → how-it-plays-history.json (atomic write)
//
// Every per-match rule (population, completion, the five formulas' counts) is build-how-it-plays.js's own —
// excludedSackmannRow + sackmannRec — so the two halves cannot drift. This file adds only:
//   · the per-edition sums for every HARD best-of-three main-draw edition (the event-past half; the pipeline links
//     them to tournament keys by venue name, see build-how-it-plays.js EVENT LINEAGE), and
//   · the edition's indoor flag from Tennis-Data (committed odds-archive/<season>.csv, `court`): each Sackmann match is
//     joined to the one Tennis-Data row whose two surnames fit, dated tourney_date −3 … +20 days; the edition is
//     indoor/outdoor when ≥ 80% of its joined matches agree, else null (in neither baseline; counted).
//   · per-season baseline sums: indoorHard / outdoorHard (and unknownCourtHard, reported, never used).
// Reproducible: no timestamp; the same inputs give the same bytes. Inputs are verified against SHA256SUMS before use
// (a changed or unlisted file stops the run) and every input's sha256 is recorded in the output.
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('../build-how-it-plays.js');

const ROOT = path.join(__dirname, '..');
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? path.resolve(process.argv[i + 1]) : path.join(ROOT, 'how-it-plays-history.json'); })();
const FIRST = 2016, LAST = H.SACKMANN_LAST_SEASON;
const COURT_SHARE = 0.8;

const argDir = (() => { const i = process.argv.indexOf('--sackmann'); return i > 0 ? process.argv[i + 1] : null; })();
const SACK = argDir || path.join(process.env.HOME || '', 'stennisfy-te-store', 'sackmann');

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const letters = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const sackSurname = n => { const t = String(n || '').trim().split(/\s+/); return letters(t.slice(1).join('')); };
const fit = (a, b) => !!a && !!b && (a === b || (a.length >= 4 && b.length >= 4 && (a.endsWith(b) || b.endsWith(a))));
const dayOf = yyyymmdd => Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)) / 864e5;
const dayN = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;

function parseCsv(text) {
  const L = text.split(/\r?\n/).filter(Boolean);
  const h = L[0].split(',');
  return L.slice(1).map(l => { const c = l.split(','); const o = {}; h.forEach((k, i) => { o[k] = c[i]; }); return o; });
}

function main() {
  const sumsFile = path.join(SACK, 'SHA256SUMS');
  if (!fs.existsSync(sumsFile)) { console.error(`how-it-plays-history: no SHA256SUMS in ${SACK} — stop`); process.exit(1); }
  const listed = new Map(fs.readFileSync(sumsFile, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
  const inputs = [];
  const seasons = {}, editions = [], coverage = { editions: 0, courtKnown: 0, courtSplit: 0, courtNoJoin: 0, matchesJoined: 0, matchesInEditions: 0 };
  for (let y = FIRST; y <= LAST; y++) {
    const name = `atp_matches_${y}.csv`, f = path.join(SACK, name);
    const h = sha(f);
    if (listed.get(name) !== h) { console.error(`how-it-plays-history: ${name} does not match SHA256SUMS — stop`); process.exit(1); }
    inputs.push({ file: `sackmann/${name}`, sha256: h });
    const tdFile = path.join(ROOT, 'odds-archive', `${y}.csv`);
    inputs.push({ file: `odds-archive/${y}.csv`, sha256: sha(tdFile) });
    const td = parseCsv(fs.readFileSync(tdFile, 'utf8')).map(r => ({ d: dayN(r.date), w: H.surnameTD(r.winner), l: H.surnameTD(r.loser), court: r.court }));

    const rows = parseCsv(fs.readFileSync(f, 'utf8'));
    const byEd = new Map();
    for (const r of rows) {
      if (+String(r.tourney_id).slice(0, 4) !== y) continue;
      if (H.excludedSackmannRow(r) || r.surface !== 'Hard') continue;
      if (!byEd.has(r.tourney_id)) byEd.set(r.tourney_id, []);
      byEd.get(r.tourney_id).push(r);
    }
    const S = { indoorHard: H.emptySums(), outdoorHard: H.emptySums(), unknownCourtHard: H.emptySums() };
    for (const [id, rs] of byEd) {
      const d0 = dayOf(rs[0].tourney_date);
      const win = td.filter(t => t.d >= d0 - 3 && t.d <= d0 + 20);
      let ind = 0, out = 0, joined = 0;
      let sums = H.emptySums();
      for (const r of rs) {
        sums = H.addRec(sums, H.sackmannRec(r));
        const a = sackSurname(r.winner_name), b = sackSurname(r.loser_name);
        const c = win.filter(t => (fit(a, t.w) && fit(b, t.l)) || (fit(a, t.l) && fit(b, t.w)));
        if (c.length !== 1) continue;
        joined++;
        if (c[0].court === 'Indoor') ind++; else if (c[0].court === 'Outdoor') out++;
      }
      const tot = ind + out;
      const indoor = tot && ind / tot >= COURT_SHARE ? true : tot && out / tot >= COURT_SHARE ? false : null;
      coverage.editions++; coverage.matchesJoined += joined; coverage.matchesInEditions += rs.length;
      if (indoor !== null) coverage.courtKnown++; else if (tot) coverage.courtSplit++; else coverage.courtNoJoin++;
      editions.push({ id, season: y, name: rs[0].tourney_name, level: rs[0].tourney_level, surface: 'Hard', indoor, court: { joined, of: rs.length, indoor: ind, outdoor: out }, sums });
      const b = indoor === true ? 'indoorHard' : indoor === false ? 'outdoorHard' : 'unknownCourtHard';
      S[b] = H.addSums(S[b], sums);
    }
    seasons[y] = S;
  }
  editions.sort((a, b) => a.season - b.season || (a.id < b.id ? -1 : 1));
  const out = {
    v: 1,
    source: 'Sackmann tennis_atp atp_matches (pinned copy, ~/stennisfy-te-store/sackmann) + Tennis-Data court (odds-archive/)',
    builtBy: 'tools/build-how-it-plays-history.js',
    seasonRange: [FIRST, LAST],
    population: 'levels A/M, best_of 3, hard, no Finals/Next Gen/Olympics/team events (build-how-it-plays.js excludedSackmannRow); sums per build-how-it-plays.js sackmannRec',
    sumsKeys: 'm matches with full serve stats · held/sg · fw/fi · sw/sp · ace · tm matches with set scores · tb/sets · nonStd match-tiebreak matches · partial (0 here) · unknown · incomplete',
    courtRule: `Tennis-Data court of the edition's joined matches, >= ${COURT_SHARE * 100}% agreement, else null`,
    inputs, coverage, seasons, editions,
  };
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out) + '\n');
  fs.renameSync(tmp, OUT);
  console.log(`how-it-plays-history: ${editions.length} hard editions ${FIRST}–${LAST}; court known ${coverage.courtKnown}, split ${coverage.courtSplit}, no join ${coverage.courtNoJoin}; ` +
    `${coverage.matchesJoined}/${coverage.matchesInEditions} matches joined to Tennis-Data; ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
}
main();
