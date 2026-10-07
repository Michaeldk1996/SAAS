// tools/probe-ten384-figures-roster.js — the ROSTER-WIDE sweep of the TEN-384 "figures agree" checks.
//
// NOT wired into npm test, on purpose. It walks every player with a career-history shard (~480) against the
// DEPLOYED stores (or PP2_BUILT_STORE=_site), so its population and its figures move with live data — a
// deploy gate must not pin a value that moves. The gate is tools/test-ten384-figures-agree.js (a pinned
// fixture + the two founder-named players, skipping out loud without the stores). Run this by hand before
// shipping a change to the Calendar / Career record / Market edge join, and after a store rebuild:
//
//   node tools/probe-ten384-figures-roster.js            # needs ./career-history (deployed shards) + network
//
// Sweeps (each reports a count and the first offenders; exit 1 on any disagreement):
//   R  Last 52 = the Calendar window, and Last 52 undated = Calendar undated, for every player
//   U  the undated count is never negative on any tier (fx2 item 8: no silent clamp)
//   6  Court speed H / A = ledger H / A on every priced ledger row
//   Y  Calendar Career yield = Market edge box, for every player with a shard
//   J  every Calendar row the join prices agrees with its Market edge row on the result
//   C  (fx7 item 1) the Last 52 window and the season table split courts with ONE classifier: for the top-120 by rank,
//      every dated season (2021+) and tier, the window's filter run over the season lists the season table's Indoors
//      exactly, and Hard / Clay / Grass differ from the table only by that season's undated matches on that surface
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');
const DEPLOYED = require('./deployed-store.js');

const ROOT = L.ROOT;
const BUILT = DEPLOYED.BUILT_DIR;
const CH_DIR = path.join(BUILT || ROOT, 'career-history');
function abort(msg) { console.error('\n  ✗ ' + msg + ' — ABORTING (this probe measures the deployed stores; it has nothing to read).\n'); process.exit(2); }
if (!fs.existsSync(CH_DIR)) abort('career-history/ absent at ' + CH_DIR);
const STORE = DEPLOYED.playerProfiles();
if (STORE.source !== (BUILT ? 'built' : 'deployed')) abort('could not read the ' + (BUILT ? 'built' : 'deployed') + ' player-profiles.json');
const PLAYERS = STORE.players;
const TH = DEPLOYED.hydrateTournamentHistory(PLAYERS);
if (TH.error || !TH.indexed) abort('tournament-history/ did not hydrate');
const CH = {};
fs.readdirSync(CH_DIR).filter(f => f.endsWith('.json')).forEach((f) => {
  CH[f.replace(/\.json$/, '')] = ((JSON.parse(fs.readFileSync(path.join(CH_DIR, f), 'utf8')) || {}).matches) || [];
});
const IDX = DEPLOYED.careerHistoryIndex() || {};
const short = Object.keys(CH).filter(k => typeof IDX[k] === 'number' && CH[k].length < IDX[k]);
if (short.length) abort(`career-history/ is short of the index for ${short.length} players (${short.slice(0, 5).join(', ')})`);
const keys = Object.keys(PLAYERS).filter(k => CH[k]);
const ME = DEPLOYED.fetchShards('market-edge', keys);
const MARKET = {};
ME.ok.forEach((t, k) => { try { MARKET[k] = JSON.parse(t); } catch (e) { /* not a shard */ } });
const B365 = {};
const bdir = path.join(ROOT, 'bet365-history');
if (fs.existsSync(bdir)) fs.readdirSync(bdir).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).forEach((f) => {
  B365[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(bdir, f), 'utf8'));
});
const { I } = L.loadPp2({ players: PLAYERS, careerHistory: CH, marketEdge: MARKET, bet365History: B365 });
const R = L.readers(I);
const H = L.harness();
console.log(`  stores: ${BUILT ? 'BUILT ' + BUILT : 'DEPLOYED'} profiles ${STORE.fetchedAt} · career-history ${Object.keys(CH).length} · ` +
  `market-edge ${Object.keys(MARKET).length} (${ME.failed.length} failed) · ${keys.length} players walked`);

H.check('R · roster: Last 52 = Calendar window and undated agree for every player with a career shard', () => {
  let n = 0; const bad = [];
  keys.forEach((k) => {
    const p = PLAYERS[k];
    const l = I.last52GridCells(p, 'all');
    if (!l) return;
    n++;
    const w = R.calWindow(p);
    if (l.total.won !== w.won || l.total.lost !== w.lost || l.undated !== I.calResidual(p).undated) bad.push(k);
  });
  assert(n > 0, 'no player walked');
  assert.deepStrictEqual(bad.slice(0, 5), [], `${bad.length} of ${n} players disagree`);
  return `${n} players: Last 52 = Calendar window, undated = Calendar undated`;
});
H.check('U · roster: no player has a negative undated count on any tier', () => {
  const bad = [];
  keys.forEach((k) => ['all', 'atp', 'chitf'].forEach((t) => {
    const u = I.undatedFor(PLAYERS[k], t);
    if (!(u >= 0)) bad.push(k + ':' + t + '=' + u);
  }));
  assert.deepStrictEqual(bad.slice(0, 8), [], `${bad.length} player-tiers negative`);
  return `${keys.length} players × 3 tiers ≥ 0`;
});
H.check('6 · roster: Court speed H / A = ledger H / A for every player', () => {
  let rows = 0; const bad = [];
  keys.forEach((k) => {
    const b = R.haMismatches(PLAYERS[k]);
    rows += I.ledgerRows(PLAYERS[k]).filter(x => x.price != null).length;
    if (b.length) bad.push(k + ':' + b.length);
  });
  assert(rows > 0, 'no priced ledger row walked');
  assert.deepStrictEqual(bad.slice(0, 8), [], `${bad.length} players differ`);
  return `${rows} priced ledger rows across ${keys.length} players agree`;
});
H.check('Y · roster: Calendar Career yield = Market edge box for every player with a shard', () => {
  let n = 0; const bad = [], selfOff = [];
  keys.forEach((k) => {
    const mk = MARKET[k];
    if (!mk || !mk.headline || !mk.headline.n || mk.headline.yield == null) return;
    n++;
    const y = L.playerChecks(I, R, PLAYERS[k], mk, k, { shardSelfCheck: false }).filter(c => /^Y /.test(c.name))[0];
    try { y.fn(); } catch (e) { bad.push(k + ': ' + e.message.split('\n')[0]); }
    if (L.fmt1(L.boxYield(mk).y) !== L.fmt1(mk.headline.yield)) selfOff.push(k);
  });
  assert(n > 0, 'no player with a shard');
  assert.deepStrictEqual(bad.slice(0, 5), [], `${bad.length} of ${n} disagree: ${bad.slice(0, 5).join(' | ')}`);
  return `${n} players: Calendar Career yield = Market edge box` +
    (selfOff.length ? ` · NOTE ${selfOff.length} shard headline(s) differ from their own rows at 1 dp (builder, both surfaces print the headline): ${selfOff.join(', ')}` : '');
});
H.check('J · roster: every Calendar row priced by the join agrees with its Market edge row on the result', () => {
  let players = 0, joined = 0, shard = 0, ret = 0; const bad = [], conflict = [];
  keys.forEach((k) => {
    if (!MARKET[k]) return;
    players++;
    shard += L.boxYield(MARKET[k]).n;
    const a = L.joinAudit(I, PLAYERS[k]);
    joined += a.joined; ret += a.ret; bad.push(...a.bad); conflict.push(...a.conflict);
  });
  assert(joined > 0, 'no joined row');
  assert.deepStrictEqual(bad.slice(0, 5), [], `${bad.length} joined rows disagree on the result`);
  return `${players} players: ${joined} of ${shard} Market edge rows joined (${(100 * joined / shard).toFixed(1)}%) · 0 mispaired · ` +
    `${ret} retirements settled differently · ${conflict.length} same-day result conflicts${conflict.length ? ' (' + conflict.slice(0, 6).join(', ') + ')' : ''}`;
});
H.check('C · top-120: the Last 52 window and the season table split every dated season\'s courts the same way', () => {
  const SURF = ['hard', 'clay', 'grass', 'indoors'];
  const top = keys.filter(k => PLAYERS[k].rank > 0).sort((a, b) => PLAYERS[a].rank - PLAYERS[b].rank).slice(0, 120);
  const wl = c => (c ? (c.won || 0) + '–' + (c.lost || 0) : '—');
  let seasons = 0; const bad = [];
  top.forEach((k) => {
    const p = PLAYERS[k], sp = I.calSpine(p);
    (p.careerByYear || []).filter(y => y && y.total && +y.year >= 2021).forEach(y => ['all', 'atp', 'chitf'].forEach((tier) => {
      const raw = tier === 'all' ? y : y[tier];
      if (!raw) return;
      seasons++;
      const yr = String(y.year), table = I.seasonCells(p, y, tier);
      const inTier = r => tier === 'all' || r.tier === tier;
      const dated = {};
      SURF.forEach((s) => { dated[s] = { won: 0, lost: 0 }; });
      sp.forEach((r) => { if (r.year === yr && inTier(r) && dated[r.surface]) dated[r.surface][r.won ? 'won' : 'lost']++; });
      SURF.forEach((s) => {
        const win = { won: 0, lost: 0 };
        I.drillRows(p, s, yr, yr + '-01-01').filter(inTier).forEach((r) => { win[r.won ? 'won' : 'lost']++; });
        const t = table[s] || { won: 0, lost: 0 };
        const rr = raw[s] || { won: 0, lost: 0 };
        const ok = s === 'indoors'
          ? t.won === win.won && t.lost === win.lost
          : (t.won || 0) - win.won === (rr.won || 0) - dated[s].won && (t.lost || 0) - win.lost === (rr.lost || 0) - dated[s].lost;
        if (!ok) bad.push(`${p.name} ${yr} [${tier}] ${s}: table ${wl(table[s])}, window ${wl(win)}`);
      });
    }));
  });
  assert(seasons > 0, 'no dated season walked');
  assert.deepStrictEqual(bad.slice(0, 6), [], `${bad.length} season-surfaces disagree`);
  return `${top.length} players · ${seasons} season-tier rows (2021+) · 0 disagreements`;
});
H.done();
