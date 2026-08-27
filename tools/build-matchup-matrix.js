#!/usr/bin/env node
// =============================================================================
// Build the archetype matchup matrix on the BOARD-FINALIZED v5.1 labels (TEN-12).
//
// WHY THIS EXISTS: classify-styles.js emits matchup-matrix.json keyed on the
// retired machine taxonomy (big_server, attacking_baseliner, ...), then
// tools/apply-board-archetypes.js overwrites playing-styles.json with the board
// labels but does NOT touch the matrix. So the deployed matrix was keyed on a
// taxonomy the site no longer shows. This step REBUILDS matchup-matrix.json on
// the exact `archetype_label` strings a member can see on the site.
//
// WHAT IT DOES (board decision, TEN-12, 2026-08-26 — three locked confirmations):
//   1. PRIMARIES = the 8 distinct `archetype_label` strings, taken from the
//      DEPLOYED playing-styles.json (249 labelled players), NOT the 263-row
//      canonical tools/board-archetypes.json. The 14 held debutants are below the
//      classifier's 20-match / 400-serve-point floor and have no match sample, so
//      the matrix reproduces exactly the counts a member sees on the page.
//   2. FULL 8x8 INCLUDING THE DIAGONAL. Same-archetype cells (e.g. Attacking
//      Baseliner vs Attacking Baseliner — the most-opened matchup on the board)
//      are populated at 50% by construction with the real match count `n`: two
//      players of one archetype is a coin flip on STYLE, which is itself useful
//      information a member wants stated rather than a blank cell.
//   3. VARIETY IS IGNORED. `variety` is a modifier chip, not a 9th category;
//      "Attacking Baseliner + Variety Player" counts as Attacking Baseliner. The
//      matrix keys purely on the base `archetype_label` string.
//
// Per-cell `n` is always surfaced (below-floor cells show n with pct=null).
// Match pool = both endpoints in the 249 labelled set, over the TML window
// 2000-2026. Join is by surname + first-initial (accent-folded), the same match
// rule tools/apply-board-archetypes.js uses.
//
// Idempotent. Meant to run in the daily refresh RIGHT AFTER
// tools/apply-board-archetypes.js. Reads tml-cache/*.csv (already populated by
// classify-styles.js in the same run).
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STYLES = path.join(ROOT, 'playing-styles.json');
const TML_CACHE = path.join(ROOT, 'tml-cache');
const OUT = path.join(ROOT, 'matchup-matrix.json');
// TEN-88 option B: per-player CAREER meeting shards — the detail view under the
// "Personally" career record. One shard per player, lazily fetched, keyed by the
// SAME surname|initial the byPlayer aggregate uses, so the row list reconciles to
// the Personally `n` by construction. matchup-matrix.json stays byte-identical —
// these are separate files (the shards carry the heavy per-meeting rows).
const OUT_MEET_DIR = path.join(ROOT, 'style-meetings');
const OUT_MEET_INDEX = path.join(ROOT, 'style-meetings-index.json');

const FROM_YEAR = 2000, TO_YEAR = 2026;   // must match classify-styles.js window
const MATRIX_MIN_N = 20;                   // off-diagonal cell needs this many real matches

// Stable primary order for the emitted grid (serve family first, then baseline
// families, then the elite/defensive tail). Any label present in the data but
// missing here is appended; any listed-but-absent label is dropped.
const PRIMARY_ORDER = [
  'Big Server',
  'Big Server + First Strike',
  'Big Server + Complete Baseliner',
  'Attacking Baseliner',
  'Solid Baseliner',
  'Counterpuncher',
  'Solid Defender',
  'All Court Elite',
];

// ---- name matching (mirrors tools/apply-board-archetypes.js) ----
function fold(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}
function norm(name) { return String(name || '').trim().replace(/\.(?=\S)/g, '. '); }
function parts(name) {
  const toks = norm(name).split(/\s+/).filter(Boolean);
  if (toks.length <= 1) return [null, toks];
  return [toks[0], toks.slice(1)];
}
const initialOf = ft => { const f = fold(ft); return f ? f[0] : null; };
const skey = st => fold(st.join(''));                     // full surname (all tokens after the first)
const lastkey = st => (st.length ? fold(st[st.length - 1]) : '');

// Build a name -> label index from the labelled roster. Primary key is
// surname+initial; a last-token+initial key is a fallback for multi-token
// surnames. Collisions inside the labelled set are marked AMBIGUOUS and never
// resolve (so we never mis-assign a match).
function buildLabelIndex(players) {
  const surnInit = new Map(), lastInit = new Map();
  const AMB = Symbol('ambiguous');
  const put = (m, k, label) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, label);
    else if (m.get(k) !== label) m.set(k, AMB);   // same key, different label -> ambiguous
  };
  for (const p of players) {
    const [ft, st] = parts(p.name);
    const ini = initialOf(ft || (st[0] || ''));
    put(surnInit, skey(st) + '|' + ini, p.archetype_label);
    put(lastInit, lastkey(st) + '|' + ini, p.archetype_label);
  }
  const lookup = name => {
    const [ft, st] = parts(name);
    const ini = initialOf(ft || (st[0] || ''));
    let v = surnInit.get(skey(st) + '|' + ini);
    if (v === undefined) v = lastInit.get(lastkey(st) + '|' + ini);
    return v === undefined || v === AMB ? null : v;
  };
  return { lookup };
}

function surfaceOf(raw) {
  const s = String(raw || '').toLowerCase();
  return s.includes('clay') ? 'clay' : s.includes('grass') ? 'grass' : s.includes('hard') ? 'hard' : 'other';
}

// TML tourney_date is YYYYMMDD; the client's row renderer keys/sorts on an ISO
// date string, so normalise here.
function isoDate(raw) {
  const s = String(raw || '').trim();
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : (s || null);
}
// TML scores are winner-perspective ("6-7(5) 6-2 6-1"). A meeting row is shown
// from the SUBJECT player's side, so a loss must read loser-first. Flip each set
// token's two game counts while preserving the tie-break suffix "(5)" and any
// trailing "RET"/"W/O" marker.
function flipScore(score) {
  const s = String(score || '').trim();
  if (!s) return s;
  return s.split(/\s+/).map(tok => {
    const m = tok.match(/^(\d+)-(\d+)(\(\d+\))?$/);
    return m ? `${m[2]}-${m[1]}${m[3] || ''}` : tok;   // non-set tokens (RET, W/O) pass through
  }).join(' ');
}

// ---- client-parity player key (TEN-88 #2) ----
// The per-player split (`byPlayer`) is looked up on the front end by the SAME
// surname|initial key the dashboard already builds for every player
// (psEloNorm -> styleKey in bsp-consult-dashboard.html). These two helpers are a
// byte-for-byte mirror of that pair — keep them in sync so a career record keys
// to the right player card.
function psEloNorm(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function clientKey(name) {
  const p = psEloNorm(name).split(' ').filter(Boolean);
  return p.length < 2 ? null : p[p.length - 1] + '|' + p[0][0];
}

function main() {
  const styles = JSON.parse(fs.readFileSync(STYLES, 'utf8'));
  const labelled = (styles.players || []).filter(p => p.archetype_label);
  if (!labelled.length) throw new Error('no labelled players in playing-styles.json — run apply-board-archetypes.js first');

  // Establish the primary set from the DEPLOYED roster.
  const present = new Set(labelled.map(p => p.archetype_label));
  const PRIMARIES = PRIMARY_ORDER.filter(l => present.has(l));
  for (const l of present) if (!PRIMARIES.includes(l)) PRIMARIES.push(l);   // append any unexpected label

  const playerCount = {};
  for (const l of PRIMARIES) playerCount[l] = 0;
  for (const p of labelled) playerCount[p.archetype_label]++;

  const { lookup } = buildLabelIndex(labelled);

  // ---- per-player career split (TEN-88 #2) ----
  // Keyed by client key (surname|initial). A client key that two DIFFERENT
  // labelled players collapse onto is dropped, so we never merge two players'
  // records under one card. This is the same collision the front-end byKey has,
  // so nothing is lost that the client could have distinguished anyway.
  const CK_AMB = Symbol('ck_amb');
  const byClientKey = new Map();
  for (const p of labelled) {
    const k = clientKey(p.name);
    if (!k) continue;
    if (!byClientKey.has(k)) byClientKey.set(k, { name: p.name, label: p.archetype_label });
    else { const cur = byClientKey.get(k); if (cur !== CK_AMB && cur.name !== p.name) byClientKey.set(k, CK_AMB); }
  }
  const byPlayer = {};                       // clientKey -> { name, vs: { <oppLabel>: {w,l} } }
  const meetings = {};                        // clientKey -> { name, vs: { <oppLabel>: [rows] } }
  let bpCounted = 0;
  // bump() owns BOTH the w/l aggregate and the per-meeting row so they can never
  // drift: every counted endpoint increments the count AND pushes exactly one row
  // under the same key, so meetings[k].vs[opp].length === byPlayer[k].vs[opp].(w+l).
  const bump = (name, oppLabel, won, meeting) => {
    const k = clientKey(name);
    if (!k) return;
    const slot = byClientKey.get(k);
    if (!slot || slot === CK_AMB) return;    // subject not a unique labelled player
    const e = byPlayer[k] || (byPlayer[k] = { name: slot.name, vs: {} });
    const v = e.vs[oppLabel] || (e.vs[oppLabel] = { w: 0, l: 0 });
    if (won) { v.w++; } else { v.l++; }
    bpCounted++;
    const me = meetings[k] || (meetings[k] = { name: slot.name, vs: {} });
    const list = me.vs[oppLabel] || (me.vs[oppLabel] = []);
    // Row shape mirrors the api-tennis form-shard row the client already renders
    // (won/opponent/surface/tournament/result/date), MINUS eventKey — TML carries
    // no api-tennis key, so these rows are static (never open a box-score panel).
    list.push({
      won: !!won,
      opponent: meeting.opponent,
      surface: meeting.surface,
      tournament: meeting.tournament,
      result: won ? meeting.score : flipScore(meeting.score),
      date: meeting.date,
      round: meeting.round || null,
    });
  };

  // ---- tally matches where BOTH endpoints resolve to a labelled primary ----
  const wins = {}, winsSurf = {};
  const SURFACES = ['hard', 'clay', 'grass'];
  for (const A of PRIMARIES) { wins[A] = {}; for (const B of PRIMARIES) wins[A][B] = 0; }
  for (const s of SURFACES) { winsSurf[s] = {}; for (const A of PRIMARIES) { winsSurf[s][A] = {}; for (const B of PRIMARIES) winsSurf[s][A][B] = 0; } }

  let tmlTotal = 0, counted = 0;
  const surfaceCounted = { hard: 0, clay: 0, grass: 0 };
  for (let y = FROM_YEAR; y <= TO_YEAR; y++) {
    const f = path.join(TML_CACHE, `${y}.csv`);
    if (!fs.existsSync(f)) { console.log(`  TML ${y}: missing`); continue; }
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => l.length);
    if (!lines.length) continue;
    const H = lines[0].split(','); const ix = {}; H.forEach((h, i) => { ix[h] = i; });
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const wn = c[ix.winner_name], ln = c[ix.loser_name];
      if (!wn || !ln) continue;
      tmlTotal++;
      const wl = lookup(wn), ll = lookup(ln);
      if (!wl || !ll) continue;                 // at least one endpoint outside the deployed pool
      wins[wl][ll]++; counted++;
      // Same pool, split per player: the winner beat an `ll`-archetype opponent;
      // the loser lost to a `wl`-archetype opponent. All surfaces pooled.
      const surf = surfaceOf(c[ix.surface]);
      const meta = {
        surface: surf === 'other' ? null : surf,
        tournament: c[ix.tourney_name] || null,
        score: c[ix.score] || '',
        date: isoDate(c[ix.tourney_date]),
        round: c[ix.round] || null,
      };
      bump(wn, ll, true,  { ...meta, opponent: ln });
      bump(ln, wl, false, { ...meta, opponent: wn });
      if (winsSurf[surf]) { winsSurf[surf][wl][ll]++; surfaceCounted[surf]++; }
    }
  }

  // ---- assemble grid (full NxN incl. diagonal) ----
  const cell = (W, A, B) => {
    if (A === B) return { pct: 50, n: W[A][B], note: 'same archetype — coin flip on style' };
    const aw = W[A][B], bw = W[B][A], nAB = aw + bw;
    return { pct: nAB >= MATRIX_MIN_N ? +(aw / nAB * 100).toFixed(0) : null, n: nAB };
  };
  const build = W => {
    const m = {};
    for (const A of PRIMARIES) { m[A] = {}; for (const B of PRIMARIES) m[A][B] = cell(W, A, B); }
    return m;
  };
  const matrix = build(wins);
  const matrixBySurface = {}; for (const s of SURFACES) matrixBySurface[s] = build(winsSurf[s]);

  const retention = tmlTotal ? +(counted / tmlTotal * 100).toFixed(1) : 0;
  const bigServerN = PRIMARIES.filter(l => l.startsWith('Big Server'))
    .reduce((acc, A) => acc + PRIMARIES.reduce((s, B) => s + (A === B ? wins[A][B] : wins[A][B] + wins[B][A]) / (A === B ? 1 : 2), 0), 0);

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'Computed from board-finalized v5.1 archetype labels (playing-styles.json) x TML match results',
    window: `${FROM_YEAR}-${TO_YEAR}`,
    note: 'Win% of row archetype vs column, over matches where BOTH players are in the deployed labelled roster. Full grid incl. the diagonal: same-archetype cells are 50% by construction (coin flip on style) and carry the real match count n. Off-diagonal cells below the sample floor show n but no pct.',
    varietyNote: 'Keyed on the 8 base archetype labels only. The `variety` modifier is ignored — "X + Variety Player" counts as X.',
    bigServerFloorNote: 'The bare "Big Server" primary is the thinnest bucket (' + (playerCount['Big Server'] || 0) + ' players). If a future review moves any of them, its off-diagonal cells can fall below the sample floor — watch this row. All Court Elite (' + (playerCount['All Court Elite'] || 0) + ' players) x Big Server is already below the floor and correctly shows n with no pct.',
    minSampleN: MATRIX_MIN_N,
    rosterBasis: 'deployed',
    playersLabelled: labelled.length,
    playerCountByPrimary: playerCount,
    matchesCounted: counted,
    matchesInWindow: tmlTotal,
    retentionPct: retention,
    archetypes: Object.fromEntries(PRIMARIES.map(k => [k, { en: k }])),
    matrix,
    surfaceNote: 'matrixBySurface splits the same construction by court surface (hard/clay/grass). Same floor per surface; carpet/unknown dropped.',
    surfaceMatchesCounted: surfaceCounted,
    matrixBySurface,
    byPlayerNote: 'TEN-88 #2: per-player CAREER record vs each opponent archetype, all surfaces pooled, over the same pool as the matrix (both endpoints in the deployed labelled roster — TML tour-level only). Keyed by surname|initial (the dashboard\'s player key); value is { name, vs: { <archetype_label>: {w,l} } }. Ambiguous keys (two labelled players collapsing to one key) are omitted. n is often small — the client applies a sample ladder (n>=10 shows %, 5-9 small-sample, <5 W-L only, 0 dash).',
    byPlayerPlayers: Object.keys(byPlayer).length,
    byPlayerEndpointsCounted: bpCounted,
    byPlayer,
  };

  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(tmp, OUT);

  // ---- per-player meeting shards (TEN-88 option B) ----
  // Filename is the client key with '|' -> '-' (the pipe is awkward in a URL/path);
  // the client applies the identical transform to styleKey(name). Rows sorted
  // newest-first to match the form list's convention.
  const slugOf = k => k.replace(/\|/g, '-');
  fs.rmSync(OUT_MEET_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_MEET_DIR, { recursive: true });
  const index = [];
  let meetRows = 0;
  for (const k of Object.keys(meetings).sort()) {
    const rec = meetings[k];
    for (const opp of Object.keys(rec.vs)) {
      rec.vs[opp].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      meetRows += rec.vs[opp].length;
    }
    const slug = slugOf(k);
    fs.writeFileSync(path.join(OUT_MEET_DIR, `${slug}.json`),
      JSON.stringify({ key: k, name: rec.name, vs: rec.vs }) + '\n');
    index.push(slug);
  }
  index.sort();
  fs.writeFileSync(OUT_MEET_INDEX, JSON.stringify(index) + '\n');

  // Reconciliation invariant: every (player, oppLabel) meeting list length MUST
  // equal that cell's byPlayer w+l. If this ever fails the detail list would
  // disagree with the "Personally" record above it — the exact thing TEN-88 fixes.
  let mism = 0;
  for (const k of Object.keys(byPlayer)) {
    const agg = byPlayer[k].vs, det = (meetings[k] && meetings[k].vs) || {};
    for (const opp of Object.keys(agg)) {
      const want = agg[opp].w + agg[opp].l, got = (det[opp] || []).length;
      if (want !== got) { console.error(`RECONCILE MISMATCH ${k} vs ${opp}: byPlayer=${want} rows=${got}`); mism++; }
    }
  }
  if (mism) throw new Error(`${mism} meeting-shard reconciliation mismatches — refusing to write a detail list that disagrees with the career record`);

  // ---- console sanity ----
  console.log(`Wrote matchup-matrix.json — ${PRIMARIES.length} primaries, ${counted}/${tmlTotal} matches (${retention}% retention).`);
  console.log(`Per-player split: ${Object.keys(byPlayer).length} players, ${bpCounted} player-endpoints (2 per counted match = ${counted * 2}; drop = ambiguous/unkeyed).`);
  console.log(`Meeting shards: ${index.length} players, ${meetRows} rows, reconciled clean vs byPlayer.`);
  console.log('Players per primary:');
  for (const l of PRIMARIES) console.log(`  ${String(playerCount[l]).padStart(3)}  ${l}`);
  console.log('Below-floor off-diagonal cells (n < ' + MATRIX_MIN_N + '):');
  let thin = 0;
  for (const A of PRIMARIES) for (const B of PRIMARIES) {
    if (A === B) continue;
    if (A < B) { const nAB = wins[A][B] + wins[B][A]; if (nAB < MATRIX_MIN_N) { console.log(`  n=${nAB}  ${A}  x  ${B}`); thin++; } }
  }
  if (!thin) console.log('  (none)');
}

main();
