#!/usr/bin/env node
/*
 * build-match-closes.js  (TEN-263 — Match analysis Form + H2H tabs)
 * ---------------------------------------------------------------------------
 * One lazy shard per player: every ATP main-draw match of his in the committed
 * tennis-data closing-price archive (odds-archive/{yyyy}.csv), with the closing
 * price of each side. The Form tab's "v market", H/A columns and Median odd, and
 * the H2H tab's Price range and Home/Away columns read it.
 *
 * WHY A NEW SHARD. The deployed market-edge/ shards are hand-built (they need the
 * gitignored career-history store), were last built on 2026-07-26 and drop
 * retirements and walkovers — they priced 51 of 782 board Form rows (TEN-263
 * data check 5). The CSVs are committed and complete, so this rebuilds from them
 * every pipeline run, like build-odds-performance.js.
 *
 * BOTH BOOKS PER MATCH (founder ruling, TEN-263, 2026-09-23): each row carries the
 * Pinnacle close pair and the Bet365 close pair from the same CSV row, each ONLY if
 * both of that book's sides are present. The browser picks Pinnacle, else Bet365,
 * else a dash — one book per match, never one side from each (fhCloseFor).
 * Walkovers are omitted (no match was played, so there is no close to read).
 * Retirements are kept and flagged: the close was struck before play.
 *
 * NAME JOIN: the archive names players "Sinner J."; the join to our player keys is
 * build-odds-performance.js's own (readCsv / ourCandidateKeys / keyFromArchiveName /
 * fullKey) — one joiner, several callers. Roster = player-profiles.json ∪ the
 * players on matches.json (the modal only opens for a board match).
 *
 * Row: [date, oppArchiveName, won(1|0), pinPrice, pinOppPrice, b365Price, b365OppPrice, ret(1|0)]
 *      a book's two cells are both null when that book lacks either side.
 * Emits match-closes/{key}.json + match-closes-index.json. No network calls.
 */
const fs = require('fs');
const path = require('path');
const { readCsv, ourCandidateKeys, keyFromArchiveName, fullKey } = require('./build-odds-performance.js');

const ROOT = __dirname;
const ARCHIVE_DIR = path.join(ROOT, 'odds-archive');
const OUT_DIR = path.join(ROOT, 'match-closes');
const INDEX = path.join(ROOT, 'match-closes-index.json');

function price(v) { const f = parseFloat(v); return Number.isFinite(f) && f >= 1.01 && f <= 1000 ? f : null; }

function roster(root) {
  const out = new Map();                     // key -> name
  const add = (key, name) => { if (key != null && name && !out.has(String(key))) out.set(String(key), String(name)); };
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, 'player-profiles.json'), 'utf8')).players || {};
    Object.entries(p).forEach(([k, v]) => add(k, v && v.name));
  } catch (e) { /* optional */ }
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'matches.json'), 'utf8'));
    (Array.isArray(m) ? m : (m.matches || [])).forEach(x => { add(x.p1Key, x.p1); add(x.p2Key, x.p2); });
  } catch (e) { /* optional */ }
  return out;
}

function build(root = ROOT, outDir = OUT_DIR, indexPath = INDEX) {
  const players = roster(root);
  const byFull = new Map(), bySurname = new Map();
  players.forEach((name, key) => {
    const cands = ourCandidateKeys(name);
    if (!cands.length) return;
    const primary = cands[0];
    if (!byFull.has(fullKey(primary))) byFull.set(fullKey(primary), { key, k: primary });
    cands.forEach(ck => { if (!bySurname.has(ck.surname)) bySurname.set(ck.surname, []); bySurname.get(ck.surname).push({ key, k: ck }); });
  });
  const resolve = (archiveName) => {
    const k = keyFromArchiveName(archiveName);
    if (!k) return null;
    const exact = byFull.get(fullKey(k));
    if (exact) return exact.key;
    const c = (bySurname.get(k.surname) || []).filter(x => x.k.initials && k.initials && (x.k.initials.startsWith(k.initials) || k.initials.startsWith(x.k.initials)));
    const keys = [...new Set(c.map(x => x.key))];
    return keys.length === 1 ? keys[0] : null;
  }
  const archive = path.join(root, 'odds-archive');
  const seasons = fs.existsSync(archive) ? fs.readdirSync(archive).filter(f => /^\d{4}\.csv$/.test(f)).sort() : [];
  if (!seasons.length) throw new Error('no season files in ' + archive);
  const rows = new Map();
  const stats = { rows: 0, walkovers: 0, sides: 0, priced: 0, pin: 0, b365only: 0 };
  let latest = '';
  seasons.forEach(file => {
    readCsv(path.join(archive, file)).forEach(r => {
      stats.rows++;
      if (r.date > latest) latest = r.date;
      const comment = String(r.comment || '').toLowerCase();
      if (comment.startsWith('walkover') || comment === 'w/o') { stats.walkovers++; return; }
      const ret = comment && comment !== 'completed' ? 1 : 0;
      // A book counts for this match only if it priced BOTH sides.
      const pair = (w, l) => { const a = price(w), b = price(l); return a != null && b != null ? [a, b] : null; };
      const P = pair(r.psw, r.psl), B = pair(r.b365w, r.b365l);
      [[r.winner, r.loser, 1, 0, 1], [r.loser, r.winner, 0, 1, 0]].forEach(([me, opp, won, i, j]) => {
        const key = resolve(me);
        if (!key) return;
        stats.sides++;
        if (!P && !B) return;             // an unpriced match is absent, never a zero
        stats.priced++;
        if (P) stats.pin++; else stats.b365only++;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push([r.date, opp, won, P ? P[i] : null, P ? P[j] : null, B ? B[i] : null, B ? B[j] : null, ret]);
      });
    });
  });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const index = {};
  rows.forEach((list, key) => {
    list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const tmp = path.join(outDir, `.${key}.json.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ key, through: latest, cols: ['date', 'opp', 'won', 'pin', 'pinOpp', 'b365', 'b365Opp', 'ret'], rows: list }));
    fs.renameSync(tmp, path.join(outDir, `${key}.json`));
    index[key] = list.length;
  });
  const tmp = indexPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ through: latest, players: index }));
  fs.renameSync(tmp, indexPath);
  return { stats, players: rows.size, latest };
}

module.exports = { build };
if (require.main === module) {
  const r = build();
  console.log(`match-closes: ${r.players} player shards, archive through ${r.latest}; ` +
    `${r.stats.rows} rows, ${r.stats.walkovers} walkovers skipped, ${r.stats.priced}/${r.stats.sides} resolved sides priced ` +
    `(${r.stats.pin} Pinnacle, ${r.stats.b365only} Bet365 only)`);
}
