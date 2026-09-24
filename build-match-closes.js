#!/usr/bin/env node
/*
 * build-match-closes.js  (TEN-263 — Match analysis Form + H2H tabs)
 * ---------------------------------------------------------------------------
 * One lazy shard per player key: every closing price we hold for his matches, from
 * two kinds of source, so the page can apply the founder's picker (2026-09-23):
 *
 *   1. Pinnacle close, Tennis-Data     (odds-archive/{yyyy}.csv psw/psl)
 *   2. Pinnacle close, our capture     (captured-closes-pinnacle.json: oddspapi Pinnacle
 *                                       series from the board's odds history, cut at the
 *                                       ACTUAL start; a closed 2026-07..09 set)
 *   3. Bet365 close, Tennis-Data       (b365w/b365l)
 *   4. Bet365 close, our capture       (bet365-history/{yyyy-mm}.json, oddspapi, cut at
 *                                       the ACTUAL start)
 *   5. nothing — a dash
 *
 * ONE BOOK PER MATCH: a pair is kept only when BOTH sides are present, and the page
 * never mixes books or sources inside one match (fhPickBook).
 *
 * "WENT LIVE" = the actual start: oddspapi trueStart (bet365-history v2 rows carry it;
 * v1 rows take it from .ten225-fixture-index.json.gz, same fixture-id space). A capture
 * with NO known actual start is dropped — a price cut at the scheduled time can be an
 * in-play price (the match can start early), so it is never used. Every captured side
 * is the LAST tick at or before that instant.
 *
 * NAME JOIN: Tennis-Data and oddspapi carry no player IDs. Names are resolved to our
 * player keys with build-odds-performance.js's joiner (incl. its §2c alias/block table).
 * Each row also carries the OPPONENT's key when it resolves, so the page matches a
 * close to its match by ID (opponentKey / eventKey), not by name.
 *
 *   rows: [date, oppArchiveName, won(1|0), pinP, pinO, b365P, b365O, ret(1|0), oppKey|null]
 *   cap:  [date, oppKey, pinP, pinO, b365P, b365O, eventKey|null]   (won is not captured)
 * Emits match-closes/{key}.json + match-closes-index.json. No network calls.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { readCsv, ourCandidateKeys, keyFromArchiveName, fullKey, archiveOverride } = require('./build-odds-performance.js');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'match-closes');
const INDEX = path.join(ROOT, 'match-closes-index.json');
// bet365-history levels we price (no WTA). ITF Men + Davis Cup: founder ruling 2026-09-24.
const CAPTURE_CATS = new Set(['ATP', 'Challenger', 'ITF Men', 'Davis Cup']);

function price(v) { const f = parseFloat(v); return Number.isFinite(f) && f >= 1.01 && f <= 1000 ? f : null; }
const pair = (a, b) => { const x = price(a), y = price(b); return x != null && y != null ? [x, y] : null; };
function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } }

// Roster for the Tennis-Data join: profiles ∪ board (unchanged from the first build, so
// no existing correct join moves). The captured (oddspapi) join uses rosterNames below.
function roster(root) {
  const out = new Map();                     // key -> name
  const add = (key, name) => { if (key != null && name && !out.has(String(key))) out.set(String(key), String(name)); };
  const p = readJson(path.join(root, 'player-profiles.json'), {}).players || {};
  Object.entries(p).forEach(([k, v]) => add(k, v && v.name));
  const m = readJson(path.join(root, 'matches.json'), []);
  (Array.isArray(m) ? m : (m.matches || [])).forEach(x => { add(x.p1Key, x.p1); add(x.p2Key, x.p2); });
  return out;
}
// Resolver over a roster. A name key shared by two different players is ambiguous → null.
function makeResolver(players) {
  const byFull = new Map(), bySurname = new Map(), keys = new Set(players.keys());
  players.forEach((name, key) => {
    const cands = ourCandidateKeys(name);
    if (!cands.length) return;
    const fk = fullKey(cands[0]);
    const prev = byFull.get(fk);
    if (prev === undefined) byFull.set(fk, key); else if (prev !== key) byFull.set(fk, null);
    cands.forEach(ck => { if (!bySurname.has(ck.surname)) bySurname.set(ck.surname, []); bySurname.get(ck.surname).push({ key, k: ck }); });
  });
  const fromKey = (k) => {
    if (!k) return null;
    const exact = byFull.get(fullKey(k));
    if (exact !== undefined) return exact;
    const c = (bySurname.get(k.surname) || []).filter(x => x.k.initials && k.initials && (x.k.initials.startsWith(k.initials) || k.initials.startsWith(x.k.initials)));
    const ks = [...new Set(c.map(x => x.key))];
    return ks.length === 1 ? ks[0] : null;
  };
  return {
    archive(name) {                          // "Sinner J."
      const ov = archiveOverride(name);
      if (ov) return ov.block ? null : (keys.has(String(ov.key)) ? String(ov.key) : null);
      return fromKey(keyFromArchiveName(name));
    },
  };
}

// Every name a key is seen under: profiles, the board, and every form-shard opponent.
// Profiles hold api-tennis's order-scrambled names ("Ivan Justo Guido"), so ONE name per
// key misses players the form shards spell plainly ("G. I. Justo"); all of them count.
function rosterNames(root) {
  const out = new Map();
  const add = (key, name) => { if (key == null || !name) return; const k = String(key); if (!out.has(k)) out.set(k, new Set()); out.get(k).add(String(name)); };
  const p = readJson(path.join(root, 'player-profiles.json'), {}).players || {};
  Object.entries(p).forEach(([k, v]) => add(k, v && v.name));
  const m = readJson(path.join(root, 'matches.json'), []);
  (Array.isArray(m) ? m : (m.matches || [])).forEach(x => { add(x.p1Key, x.p1); add(x.p2Key, x.p2); });
  const dir = path.join(root, 'form');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
    if (!/^\d+\.json$/.test(f)) continue;
    const d = readJson(path.join(dir, f), null);
    ((d && d.matches) || []).forEach(r => add(r.opponentKey, r.opponent));
  }
  return out;
}
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv)$/;
// oddspapi "Surname, Given Names" → one player key, or null. oddspapi spells the given
// names in full, so a candidate (same surname) must agree with them: its initials are a
// prefix of the given initials ("J. P." ~ "Juan Pablo"), or its short first name is a
// prefix of the first given name ("Dar." ~ "Darwin"). Several agree → the unique most
// specific (longest) wins, else null: "Blanch, Darwin" is Dar. Blanch, never D. Blanch.
// Only when NO candidate agrees that way may ours carry MORE initials than oddspapi
// gives ("J. J. Schwaerzler" ~ "Schwaerzler, Joel"), and then only a unique one. A player
// known by a later given name ("T. Barrios Vera" ~ "Barrios Vera, Marcelo Tomas") is not
// guessed: he is in the shared alias table (build-odds-performance.js), consulted first.
function makeCommaResolver(names) {
  const bySurname = new Map();
  names.forEach((set, key) => set.forEach(n => ourCandidateKeys(n).forEach(ck => {
    if (!ck.surname || !ck.initials) return;
    if (!bySurname.has(ck.surname)) bySurname.set(ck.surname, []);
    bySurname.get(ck.surname).push({ key, ini: ck.initials });
  })));
  const first = (s) => fold(s.slice(s.indexOf(',') + 1).trim().split(/[\s-]+/)[0]);
  function comma(name) {
    const s = String(name || '').trim(), i = s.indexOf(',');
    if (i < 1 || s.includes('/')) return null;                  // "A / B" = a doubles pair
    const ov = archiveOverride(s);
    if (ov) return ov.block ? null : (names.has(String(ov.key)) ? String(ov.key) : null);
    const sToks = s.slice(0, i).trim().split(/\s+/).filter(t => !NAME_SUFFIX.test(fold(t)));
    const k = keyFromArchiveName(sToks.join(' ') + ' X.');
    const given = s.slice(i + 1).trim().split(/[\s-]+/).map(fold).filter(Boolean);
    if (!k || !given.length) return null;
    const gIni = given.map(t => t[0]).join('');
    const cands = bySurname.get(k.surname) || [];
    const hits = cands.filter(c => gIni.startsWith(c.ini) || given[0].startsWith(c.ini));
    if (hits.length) {
      const best = Math.max(...hits.map(c => c.ini.length));
      const keys = [...new Set(hits.filter(c => c.ini.length === best).map(c => c.key))];
      return keys.length === 1 ? keys[0] : null;
    }
    const more = [...new Set(cands.filter(c => c.ini.startsWith(gIni)).map(c => c.key))];
    return more.length === 1 ? more[0] : null;
  }
  return {
    comma,
    // Resolve a whole name list at once. oddspapi names players our roster may not hold,
    // and a namesake off the roster lands on the one who is ("Nakashima, Bryce" →
    // B. Nakashima = Brandon). So when one key is reached by two first given names that
    // are not the same name (neither a prefix of the other: Alex ~ Alexander, Bryce ≠
    // Brandon), none of them joins. Hand-checked aliases are exempt.
    resolveAll(list) {
      const out = new Map(), firsts = new Map();
      for (const n of new Set(list)) {
        const k = comma(n); out.set(n, k);
        if (k == null || archiveOverride(String(n).trim())) continue;
        if (!firsts.has(k)) firsts.set(k, new Set());
        firsts.get(k).add(first(String(n).trim()));
      }
      const clash = (set) => { const a = [...set]; return a.some(x => a.some(y => !x.startsWith(y) && !y.startsWith(x))); };
      for (const [n, k] of out) if (k != null && !archiveOverride(String(n).trim()) && clash(firsts.get(k))) out.set(n, null);
      return out;
    },
  };
}

// The book's suspension marker: BOTH sides at 1.01 on the same tick. It is not a price, so
// those ticks leave both series before the close is read (one side at 1.01 against a real
// price on the other is a real, if extreme, market and stays).
function dropSuspended(s1, s2) {
  const low = (s) => new Set((s || []).filter(t => Array.isArray(t) && Number(t[1]) <= 1.01).map(t => t[0]));
  const l1 = low(s1), sus = new Set([...low(s2)].filter(ts => l1.has(ts)));
  const keep = (s) => (s || []).filter(t => !(Array.isArray(t) && sus.has(t[0])));
  return [keep(s1), keep(s2)];
}
// Last tick at or before `cut` (epoch s) on one side; ticks are [epoch_s, price].
function lastAtOrBefore(series, cut) {
  let best = null;
  for (const t of series || []) if (Array.isArray(t) && t[0] <= cut && (!best || t[0] >= best[0])) best = t;
  return best && price(best[1]) != null ? price(best[1]) : null;
}
const isoDay = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const toSec = (v) => { if (v == null) return null; if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v; const t = Date.parse(v); return Number.isFinite(t) ? Math.floor(t / 1000) : null; };

// Captured Bet365 closes from bet365-history (oddspapi), cut at the actual start.
function capturedBet365(root, resolver, stats) {
  const out = [];
  const dir = path.join(root, 'bet365-history');
  if (!fs.existsSync(dir)) return out;
  let fx = {};
  try { fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, '.ten225-fixture-index.json.gz'))).toString()).fixtures || {}; } catch (e) { /* v2 rows still work */ }
  const fixtures = [];
  for (const f of fs.readdirSync(dir).filter(n => /^\d{4}-\d{2}\.json$/.test(n)).sort()) {
    const d = readJson(path.join(dir, f), null);
    for (const [id, v] of Object.entries((d && d.fixtures) || {})) if (CAPTURE_CATS.has(v.cat)) fixtures.push([id, v]);
  }
  const keyOf = resolver.resolveAll(fixtures.flatMap(([, v]) => [v.p1, v.p2]));
  for (const [id, v] of fixtures) {
    stats.capSeen++;
    const trueStart = toSec(v.trueStart != null ? v.trueStart : (fx[id] && fx[id].trueStart));
    if (trueStart == null) { stats.capNoStart++; continue; }       // never cut at a scheduled time
    const k1 = keyOf.get(v.p1), k2 = keyOf.get(v.p2);
    if (!k1 || !k2 || k1 === k2) { stats.capUnresolved++; continue; }
    const [s1, s2] = dropSuspended(v.s1, v.s2);
    const a = lastAtOrBefore(s1, trueStart), b = lastAtOrBefore(s2, trueStart);
    if (a == null || b == null) { stats.capOneSided++; continue; } // one-sided = no price
    out.push({ date: isoDay(trueStart), k1, k2, B: [a, b], ek: null });
    stats.capB365++;
  }
  return out;
}
// Captured Pinnacle closes: a committed one-time extract (tools/ten263-extract-captured-pinnacle.mjs),
// already cut at the actual start and keyed by board eventKey + both player keys.
function capturedPinnacle(root, stats) {
  const d = readJson(path.join(root, 'captured-closes-pinnacle.json'), null);
  const out = [];
  for (const r of (d && d.rows) || []) {
    const P = pair(r.p1, r.p2);
    if (!P || !r.p1Key || !r.p2Key || !r.date) continue;
    out.push({ date: r.date, k1: String(r.p1Key), k2: String(r.p2Key), P, ek: r.eventKey != null ? String(r.eventKey) : null });
    stats.capPin++;
  }
  return out;
}

function build(root = ROOT, outDir = OUT_DIR, indexPath = INDEX) {
  const td = makeResolver(roster(root));
  const wide = makeCommaResolver(rosterNames(root));
  const archive = path.join(root, 'odds-archive');
  const seasons = fs.existsSync(archive) ? fs.readdirSync(archive).filter(f => /^\d{4}\.csv$/.test(f)).sort() : [];
  if (!seasons.length) throw new Error('no season files in ' + archive);
  const rows = new Map(), cap = new Map();
  const stats = { rows: 0, walkovers: 0, sides: 0, priced: 0, pin: 0, b365only: 0, oppKeyed: 0,
    capSeen: 0, capNoStart: 0, capUnresolved: 0, capOneSided: 0, capB365: 0, capPin: 0 };
  let latest = '';
  seasons.forEach(file => {
    readCsv(path.join(archive, file)).forEach(r => {
      stats.rows++;
      if (r.date > latest) latest = r.date;
      const comment = String(r.comment || '').toLowerCase();
      if (comment.startsWith('walkover') || comment === 'w/o') { stats.walkovers++; return; }
      const ret = comment && comment !== 'completed' ? 1 : 0;
      const P = pair(r.psw, r.psl), B = pair(r.b365w, r.b365l);
      const kw = td.archive(r.winner), kl = td.archive(r.loser);
      [[kw, r.loser, kl, 1, 0, 1], [kl, r.winner, kw, 0, 1, 0]].forEach(([key, opp, oppKey, won, i, j]) => {
        if (!key) return;
        stats.sides++;
        if (!P && !B) return;             // an unpriced match is absent, never a zero
        stats.priced++;
        if (P) stats.pin++; else stats.b365only++;
        if (oppKey) stats.oppKeyed++;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push([r.date, opp, won, P ? P[i] : null, P ? P[j] : null, B ? B[i] : null, B ? B[j] : null, ret, oppKey || null]);
      });
    });
  });
  const addCap = (key, row) => { if (!cap.has(key)) cap.set(key, []); cap.get(key).push(row); };
  const caps = capturedPinnacle(root, stats).concat(capturedBet365(root, wide, stats));
  for (const c of caps) {
    const P = c.P || null, B = c.B || null;
    addCap(c.k1, [c.date, c.k2, P ? P[0] : null, P ? P[1] : null, B ? B[0] : null, B ? B[1] : null, c.ek]);
    addCap(c.k2, [c.date, c.k1, P ? P[1] : null, P ? P[0] : null, B ? B[1] : null, B ? B[0] : null, c.ek]);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const index = {};
  const byDate = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  for (const key of new Set([...rows.keys(), ...cap.keys()])) {
    const list = (rows.get(key) || []).sort(byDate), cl = (cap.get(key) || []).sort(byDate);
    const tmp = path.join(outDir, `.${key}.json.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ key, through: latest,
      cols: ['date', 'opp', 'won', 'pin', 'pinOpp', 'b365', 'b365Opp', 'ret', 'oppKey'], rows: list,
      capCols: ['date', 'oppKey', 'pin', 'pinOpp', 'b365', 'b365Opp', 'eventKey'], cap: cl }));
    fs.renameSync(tmp, path.join(outDir, `${key}.json`));
    index[key] = [list.length, cl.length];
  }
  const tmp = indexPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ through: latest, players: index }));
  fs.renameSync(tmp, indexPath);
  return { stats, players: Object.keys(index).length, latest };
}

module.exports = { build, makeResolver, makeCommaResolver, rosterNames, lastAtOrBefore, dropSuspended };
if (require.main === module) {
  const r = build();
  const s = r.stats;
  console.log(`match-closes: ${r.players} player shards, archive through ${r.latest}; ` +
    `Tennis-Data ${s.priced}/${s.sides} resolved sides priced (${s.pin} Pinnacle, ${s.b365only} Bet365 only; ${s.oppKeyed} with opponent key); ` +
    `captured Pinnacle ${s.capPin}; captured Bet365 ${s.capB365} of ${s.capSeen} ATP/Challenger/ITF Men/Davis Cup fixtures ` +
    `(no actual start ${s.capNoStart}, unresolved ${s.capUnresolved}, one-sided ${s.capOneSided})`);
}
