// tools/build-ambiguous-archive-names.js — which Tennis-Data names ("Surname I.") more than one real player fits
// (founder 2026-10-22, containment). Source: the Tennis Abstract match files (tml-cache/*.csv), every winner and loser
// with his TML id. A name key is surname + FIRST initial, the way the identity gate's rule 4 reads an archive name.
// Writes ambiguous-archive-names.json.gz (committed, gzip: the gate reads it with no network and no TML at run time).
// For every such key, every TML match of a player under it: [yyyymmdd, player index, opponent letters], so the gate can veto
// a row whose match TML gives to a namesake with a different first name (our own store misfiled Ze Zhang's 2015
// Shenzhen matches under Zhizhen Zhang).
//   node tools/build-ambiguous-archive-names.js [tmlDir] [out]
'use strict';
const fs = require('fs');
const path = require('path');
const { ourCandidateKeys } = require('../build-odds-performance.js');
const ROOT = path.resolve(__dirname, '..');
const dir = process.argv[2] || path.join(ROOT, 'tml-cache');
const out = process.argv[3] || path.join(ROOT, 'ambiguous-archive-names.json.gz');

const letters = (x) => String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const byKey = new Map();   // "surname|i" -> Map(tmlId -> { name, first, last })
const matchesOf = new Map(); // tmlId -> [[yyyymmdd, oppLetters]]
let rows = 0, through = '';
for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}\.csv$/.test(x)).sort()) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  const head = lines[0].split(',');
  const col = (n) => head.indexOf(n);
  const [cd, wi, wn, li, ln] = ['tourney_date', 'winner_id', 'winner_name', 'loser_id', 'loser_name'].map(col);
  for (const line of lines.slice(1)) {
    const c = line.split(','); if (c.length < head.length) continue;
    rows++; if (c[cd] > through) through = c[cd];
    for (const [id, name, opp] of [[c[wi], c[wn], c[ln]], [c[li], c[ln], c[wn]]]) {
      if (!id || !name) continue;
      if (!matchesOf.has(id)) matchesOf.set(id, []); matchesOf.get(id).push([Number(c[cd]), letters(opp)]);
      for (const k of ourCandidateKeys(name)) {
        if (!k.surname || !k.initials) continue;
        const key = `${k.surname}|${k.initials[0]}`;
        if (!byKey.has(key)) byKey.set(key, new Map());
        const m = byKey.get(key); const e = m.get(id) || { name, first: c[cd], last: c[cd] };
        if (c[cd] < e.first) e.first = c[cd]; if (c[cd] > e.last) e.last = c[cd]; m.set(id, e);
      }
    }
  }
}
const names = {}, players = [], matches = {};
for (const [key, m] of [...byKey].sort()) {
  if (m.size < 2) continue;
  names[key] = [...m.values()].map((e) => `${e.name} ${e.first.slice(0, 4)}–${e.last.slice(0, 4)}`);
  matches[key] = [];
  for (const [id, e] of m) { const i = players.push(e.name) - 1; for (const [d, o] of matchesOf.get(id) || []) matches[key].push([d, i, o]); }
}
const doc = { v: 2, source: 'Tennis Abstract match files (tml-cache)', through: `${through.slice(0, 4)}-${through.slice(4, 6)}-${through.slice(6, 8)}`, rows, keys: Object.keys(names).length, names, players, matches };
const tmp = `${out}.tmp`; fs.writeFileSync(tmp, require('zlib').gzipSync(JSON.stringify(doc))); fs.renameSync(tmp, out);
console.log(`ambiguous-archive-names: ${doc.keys} name keys fit more than one TML player (${rows} matches, through ${doc.through}) -> ${path.relative(ROOT, out)}`);
