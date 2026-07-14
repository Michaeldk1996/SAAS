#!/usr/bin/env node
'use strict';
// =============================================================================
// Task 12 — Career Splits + Last 52 Weeks Splits, from Jeff Sackmann's ATP
// match-results data.
//
// The canonical source (github.com/JeffSackmann/tennis_atp) is unreachable from
// this environment (egress allowlist), so we pull the SAME underlying data from
// Sackmann's own site, tennisabstract.com, which IS reachable: each player's
// player-classic.cgi page embeds a `var matchmx` array of every tour match with
// surface, level, round, score, best-of, and — critically for this task —
// opponent HAND (R/L) and opponent RANK at match time. Feasibility confirmed:
// both fields are present, so vs Righties / vs Lefties / vs Top 10 are real.
//
// Output: career-splits.json, keyed by player-profiles.json profile key, with a
// `career` and a `last52` block, each a map of the 14 split categories to
// { M, W, L, winPct, setW, setL, setPct }. Zero-match categories are dropped so
// the dashboard can hide empty rows. NOTHING is approximated — a split absent
// from the data is simply absent.
//
// Usage: node tools/build-career-splits.js [rankMax] [maxPlayers]
//   Re-runnable; pages cached in /tmp/ta-cache. Extend coverage by raising the
//   caps (default rankMax=250, maxPlayers=160 — the current relevant ATP field).
// =============================================================================

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const PROFILES = path.join(ROOT, 'player-profiles.json');
const OUT = path.join(ROOT, 'career-splits.json');
const CACHE = '/tmp/ta-cache';
const RANK_MAX = parseInt(process.argv[2], 10) || 250;
const MAX_PLAYERS = parseInt(process.argv[3], 10) || 160;
// tennisabstract rate-limits bursts (HTTP 429), so we pace: low concurrency, a
// base delay per request, and exponential backoff on 429. Cached pages skip the
// network entirely, so re-runs only pay for players not yet fetched.
const CONCURRENCY = 2;
const BASE_DELAY_MS = 600;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Reference "today" — the last-52-weeks window. Kept explicit (no Date.now in
// the artifact) so re-runs on the same day are deterministic.
const TODAY = '20260714';
function daysAgoStamp(stamp, cutoff) { return stamp >= cutoff; }
function cutoff52() {
  // 364 days before TODAY, as YYYYMMDD.
  const y = +TODAY.slice(0, 4), m = +TODAY.slice(4, 6), d = +TODAY.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 364);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`;
}
const CUT52 = cutoff52();

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function taId(fullName) {
  // "Carlos Alcaraz" -> "CarlosAlcaraz"; "Alex de Minaur" -> "AlexdeMinaur"
  return stripAccents(fullName).replace(/[^A-Za-z]/g, '');
}
function normKey(s) {
  return stripAccents(String(s || '')).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0 bsp-splits' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return get(res.headers.location).then(resolve, reject);
      }
      let data = ''; res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ---- parse one matchmx into normalized match objects ------------------------
function parseMatches(html) {
  const i = html.indexOf('var matchmx');
  if (i < 0) return [];
  const semi = html.indexOf('];', i);
  const arr = html.slice(html.indexOf('[', i), semi + 1);
  const rows = arr.match(/\[[^\[\]]*\]/g) || [];
  const out = [];
  for (const r of rows) {
    const cells = (r.match(/"((?:[^"\\]|\\.)*)"/g) || []).map(s => s.slice(1, -1));
    if (cells.length < 16) continue;
    const date = cells[0], surface = cells[2], level = cells[3], wl = cells[4],
      round = cells[8], score = cells[9], bestofRaw = cells[10],
      oppRank = cells[12], oppHand = cells[15];
    if (wl !== 'W' && wl !== 'L') continue;
    out.push({
      date, surface, level, wl, round, score,
      bestof: (bestofRaw === '5' || bestofRaw === '3') ? +bestofRaw : (level === 'G' ? 5 : 3),
      oppRank: /^\d+$/.test(oppRank) ? +oppRank : null,
      oppHand: (oppHand === 'R' || oppHand === 'L') ? oppHand : null,
    });
  }
  return out;
}

// player-perspective set W/L from a winner-first score string
function setRecord(m) {
  const sc = (m.score || '').trim();
  if (!sc || /w\/o|def|walkover/i.test(sc)) return { w: 0, l: 0 };
  let winnerSets = 0, loserSets = 0;
  for (const tok of sc.split(/\s+/)) {
    const mm = tok.replace(/\(.*?\)/g, '').match(/^(\d+)-(\d+)$/);
    if (!mm) continue;
    const a = +mm[1], b = +mm[2];
    if (a > b) winnerSets++; else if (b > a) loserSets++;
  }
  // score is written winner-first; flip to the player's perspective
  return m.wl === 'W' ? { w: winnerSets, l: loserSets } : { w: loserSets, l: winnerSets };
}

const CATEGORIES = [
  ['Hard', m => m.surface === 'Hard'],
  ['Clay', m => m.surface === 'Clay'],
  ['Grass', m => m.surface === 'Grass'],
  ['Grand Slams', m => m.level === 'G'],
  ['Masters', m => m.level === 'M'],
  ['Other Tours', m => m.level !== 'G' && m.level !== 'M'],
  ['Best of 5', m => m.bestof === 5],
  ['Best of 3', m => m.bestof === 3],
  ['Finals', m => m.round === 'F'],
  ['Semi-finals', m => m.round === 'SF'],
  ['Quarter-finals', m => m.round === 'QF'],
  ['vs. Righties', m => m.oppHand === 'R'],
  ['vs. Lefties', m => m.oppHand === 'L'],
  ['vs. Top 10', m => m.oppRank != null && m.oppRank <= 10],
];

function splits(matches) {
  const rows = {};
  for (const [label, pred] of CATEGORIES) {
    const sub = matches.filter(pred);
    if (!sub.length) continue; // zero-match categories dropped (dashboard hides)
    let W = 0, setW = 0, setL = 0;
    for (const m of sub) {
      if (m.wl === 'W') W++;
      const sr = setRecord(m); setW += sr.w; setL += sr.l;
    }
    const M = sub.length, L = M - W, setTot = setW + setL;
    rows[label] = {
      M, W, L,
      winPct: Math.round(W / M * 1000) / 10,
      setW, setL,
      setPct: setTot ? Math.round(setW / setTot * 1000) / 10 : null,
    };
  }
  return rows;
}

// ---- resolve current-ATP full names ----------------------------------------
async function loadCurrRank() {
  const { body } = await get('https://www.tennisabstract.com/jsplayers/curr_rank_atp.js');
  const m = body.match(/currRank\s*=\s*(\{[\s\S]*?\});/);
  return JSON.parse(m[1]); // { "Full Name": "rank" }
}

async function main() {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  const profiles = JSON.parse(fs.readFileSync(PROFILES, 'utf8')).players;
  const currRank = await loadCurrRank();

  // index currRank by (initial, surname)
  const idx = new Map();
  for (const [full, rk] of Object.entries(currRank)) {
    const t = normKey(full).split(' ');
    if (t.length < 2) continue;
    const key = t[0][0] + '|' + t[t.length - 1];
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push({ full, rank: +rk });
  }

  // build the work list: profile -> matched full name + rank, filtered/sorted
  const work = [];
  for (const [pkey, p] of Object.entries(profiles)) {
    const t = normKey(String(p.name).replace(/\./g, ' ')).split(' ').filter(Boolean);
    if (t.length < 2) continue;
    const cands = idx.get(t[0][0] + '|' + t[t.length - 1]);
    if (!cands || !cands.length) continue;
    cands.sort((a, b) => a.rank - b.rank);
    const hit = cands[0];
    if (hit.rank > RANK_MAX) continue;
    work.push({ pkey, name: p.name, full: hit.full, rank: hit.rank, id: taId(hit.full) });
  }
  work.sort((a, b) => a.rank - b.rank);
  const targets = work.slice(0, MAX_PLAYERS);
  console.log(`Resolved ${work.length} profiles to current ATP; ingesting ${targets.length} (rank<=${RANK_MAX}).`);

  const players = {};
  let ok = 0, miss = 0, empty = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const t = targets[cursor++];
      const cacheFile = path.join(CACHE, t.id + '.html');
      let html = null;
      try {
        if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 5000) {
          html = fs.readFileSync(cacheFile, 'utf8');
        } else {
          const url = `https://www.tennisabstract.com/cgi-bin/player-classic.cgi?p=${t.id}`;
          for (let attempt = 0; attempt < 4 && !html; attempt++) {
            await sleep(BASE_DELAY_MS + attempt * 1200);
            let status, body;
            try { ({ status, body } = await get(url)); } catch (e) { continue; }
            if (status === 200 && body.includes('var matchmx')) { html = body; fs.writeFileSync(cacheFile, body); }
            else if (status === 429) { await sleep(2500 * (attempt + 1)); }
            else break; // real 404 (name mismatch) — don't hammer
          }
        }
      } catch (e) { /* network */ }
      if (!html) { miss++; continue; }
      const matches = parseMatches(html);
      if (!matches.length) { empty++; continue; }
      const last52 = matches.filter(m => daysAgoStamp(m.date, CUT52));
      players[t.pkey] = {
        taId: t.id, fullName: t.full, rank: t.rank,
        matchesParsed: matches.length, last52Count: last52.length,
        career: splits(matches),
        last52: splits(last52),
      };
      ok++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const out = {
    fetchedAt: TODAY,
    source: 'Jeff Sackmann ATP match data via tennisabstract.com player-classic (matchmx)',
    window52Cutoff: CUT52,
    categories: CATEGORIES.map(c => c[0]),
    columns: ['M', 'W', 'L', 'winPct', 'setW', 'setL', 'setPct'],
    coverage: { ingested: ok, noPage: miss, noMatches: empty, attempted: targets.length },
    players,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`career-splits.json: ${ok} ingested / ${miss} no-page / ${empty} empty. 52wk cutoff ${CUT52}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
