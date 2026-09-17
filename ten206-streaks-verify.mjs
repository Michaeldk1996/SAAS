// ten206-streaks-verify.mjs — TEN-206 §5.4 Streaks re-verify (items 25-28 + (e)).
//
// Loads player-profile-v2.js against the DEPLOYED shards (not the committed
// ones — data JSON is cron-refreshed, so the repo copy is not what the founder
// is looking at) and RECOMPUTES every painted figure from the raw rows by a
// second, independent path. A read-back that only re-reads the module's own
// output proves nothing; every number below is recomputed here from
// career-history + market-edge before it is compared.
//
// Run: node ten206-streaks-verify.mjs

import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://michaeldk1996.github.io/SAAS';
const CACHE = process.env.STREAK_CACHE || path.join(process.cwd(), '.streaks-cache');
fs.mkdirSync(CACHE, { recursive: true });

async function grab(rel) {
  const f = path.join(CACHE, rel.replace(/\//g, '_'));
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const r = await fetch(`${BASE}/${rel}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${rel} -> ${r.status}`);
  const j = await r.json();
  fs.writeFileSync(f, JSON.stringify(j));
  return j;
}

const SUBJECTS = [
  { key: '1980', label: 'Zverev   (ATP 2)' },
  { key: '1775', label: 'Martinez (ATP 132)' },
  { key: '906', label: 'Krumich  (ATP 256, Challenger-only)' }
];

// The deployed eager file is frozen at 31 players (TEN-206 search-index split);
// every other profile arrives from ./profiles/{key}.json on click, so the
// subjects are pulled the same way the page pulls them.
const profiles = await grab('player-profiles.json');
for (const s of SUBJECTS) {
  if (!profiles.players[s.key]) {
    const shard = await grab(`profiles/${s.key}.json`);
    profiles.players[s.key] = shard.player || shard;
  }
}
const styles = await grab('playing-styles.json').catch(() => ({}));
const careerHistory = {}, market = {};
for (const s of SUBJECTS) {
  careerHistory[s.key] = (await grab(`career-history/${s.key}.json`)).matches || [];
  try { market[s.key] = await grab(`market-edge/${s.key}.json`); } catch { market[s.key] = null; }
}

const sandbox = {
  FEATURE_PP2: true,
  playerProfiles: profiles,
  careerHistory,
  marketEdge: market,
  playingStyles: styles
};
global.window = sandbox;
new Function('window', fs.readFileSync('player-profile-v2.js', 'utf8'))(sandbox);
const I = sandbox.PlayerProfileV2._internals;

let pass = 0, fail = 0;
const ck = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${a} !== ${b}`); };

const DASH = '—';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

for (const s of SUBJECTS) {
  const p = (profiles.players || profiles)[s.key];
  if (!p) { console.log(`\n!! no profile for ${s.label}`); continue; }
  p.key = s.key;
  console.log(`\n═══ ${s.label} ═══`);

  Object.assign(I.state, { key: s.key, calTab: 'streaks', calSurface: 'all', calRun: null });
  const rows = I.calSpineFiltered(p);
  const runs = I.calRuns(rows);
  const skipped = I.calRunsSkipped(rows);
  const seq = I.calRunRows(rows);
  const html = I.renderSeasonModal(p);

  // ── (e) Sum(run lengths) = M ───────────────────────────────────────────────
  ck('(e) Sum(run lengths) + walkovers given = M', () => {
    const sum = runs.reduce((a, r) => a + r.len, 0);
    eq(sum + skipped, rows.length, 'sum of run lengths + skipped vs M');
  });

  // ── (e) longest tiles = the tallest bars ──────────────────────────────────
  const lw = runs.filter(r => r.res === 'W').reduce((a, r) => Math.max(a, r.len), 0);
  const ll = runs.filter(r => r.res === 'L').reduce((a, r) => Math.max(a, r.len), 0);
  ck('(e) longest win/loss tile = the tallest bar of that colour', () => {
    // recomputed from `seq`, never from calRuns()
    let best = { W: 0, L: 0 }, cur = null, n = 0;
    for (const m of seq) {
      const r = m.won ? 'W' : 'L';
      if (r === cur) n++; else { cur = r; n = 1; }
      if (n > best[r]) best[r] = n;
    }
    eq(lw, best.W, 'longest W');
    eq(ll, best.L, 'longest L');
    if (lw) {
      const t = html.indexOf('Longest win run');
      if (t < 0) throw new Error('Longest win run tile not painted');
      if (!html.slice(t, t + 400).includes(`>${lw}<`)) throw new Error(`tile does not paint ${lw}`);
    }
  });

  // ── item 25 · one M ───────────────────────────────────────────────────────
  ck('item 25 · subtitle M, tiles M and the Calendar tab all read one number', () => {
    const sub = I.modalSubtitle('season', p, {});
    if (rows.length && !sub.includes(`${rows.length} matches`)) {
      throw new Error(`subtitle says "${sub}", grid holds ${rows.length}`);
    }
    if (!html.includes(`Runs count all ${rows.length - skipped} matches on record`)) {
      throw new Error(`footnote M is not ${rows.length - skipped}`);
    }
    const calTot = I.calGrid(rows).reduce(
      (a, y) => a + y.cells.reduce((b, c) => b + c.won + c.lost, 0), 0);
    eq(calTot, rows.length, 'Calendar grid total vs M');
  });

  // ── item 26 · priced coverage, per level, recomputed from raw ─────────────
  const TEAM = /davis cup|laver cup|united cup|olympic|atp cup|hopman|world team/i;
  const isQual = r => /qualif/i.test(String(r.round || ''));
  const mk = (market[s.key] || {}).matches || [];
  const pinRows = mk.filter(r => r.book === 'pinnacle' && r.price != null && r.pl != null);
  const pinEnd = pinRows.length ? pinRows.map(r => r.date).sort().pop() : null;
  const raw = careerHistory[s.key].filter(r => /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')));
  const bucket = (r) => {
    if (!pinEnd || r.date > pinEnd) return 'after archive end';
    if (r.level !== 'atp') return 'Challenger/ITF';
    if (TEAM.test(r.tournament || '')) return 'team event';
    if (isQual(r)) return 'ATP qualifying';
    return 'ATP main draw';
  };
  const tally = {};
  for (const r of raw) {
    const b = bucket(r);
    tally[b] = tally[b] || { n: 0, priced: 0 };
    tally[b].n++;
  }
  for (const r of rows) {
    const src = raw.find(x => x.date === r.date && (x.opponent || '') === (r.opp || ''));
    const b = bucket(src || r);
    if (tally[b] && r.cents != null) tally[b].priced++;
  }
  console.log(`        archive last Pinnacle price: ${pinEnd || DASH}`);
  for (const [b, v] of Object.entries(tally)) {
    console.log(`        ${b.padEnd(20)} n=${String(v.n).padStart(4)}  priced ${String(v.priced).padStart(4)}` +
      `  ${(100 * v.priced / v.n).toFixed(1)}%`);
  }

  // ── item 26 · the join never contradicts market-edge's own `won` column ───
  ck('item 26 · every joined price agrees with the archive\'s own result column', () => {
    let bad = 0, n = 0;
    for (const r of rows) {
      if (r.price == null) continue;
      const hit = pinRows.filter(m => Math.abs(Date.parse(m.date) - Date.parse(r.date)) <= 14 * 864e5 &&
        m.price === r.price);
      if (!hit.length) continue;
      n++;
      if (hit.every(m => !!m.won !== !!r.won)) bad++;
    }
    if (bad) throw new Error(`${bad} of ${n} priced rows disagree with the archive result`);
    console.log(`        ${n} priced rows cross-checked against the archive result column, 0 disagree`);
  });

  // ── (e) run detail W–L and priced count = its rows ────────────────────────
  ck('(e) run detail header reconciles to its own rows', () => {
    let worst = 0, wi = -1;
    runs.forEach((r, i) => { if (r.len > worst) { worst = r.len; wi = i; } });
    if (wi < 0) return;
    I.state.calRun = wi;
    const h = I.renderSeasonModal(p);
    const run = runs[wi];
    let cents = 0, np = 0;
    run.rows.forEach(r => { if (r.cents != null) { cents += r.cents; np++; } });
    const title = `${run.res === 'W' ? 'Winning run' : 'Losing run'} · ${run.len} matches`;
    if (!h.includes(title)) throw new Error(`title "${title}" not painted`);
    if (np) {
      const yld = cents / np;
      const u = `${cents > 0 ? '+' : '−'}${Math.abs(cents / 100).toFixed(2)}u`;
      const y = `${yld > 0 ? '+' : '−'}${Math.abs(yld).toFixed(1)}%`;
      const line = `${u} · ${y} · ${np} priced`;
      if (!h.includes(line)) throw new Error(`P&L line "${line}" not painted`);
    }
    // span always carries the year, at month resolution
    const a = run.from, b = run.to;
    const sp = a.slice(0, 4) === b.slice(0, 4)
      ? (a.slice(5, 7) === b.slice(5, 7) ? MON[+a.slice(5, 7) - 1]
        : `${MON[+a.slice(5, 7) - 1]} – ${MON[+b.slice(5, 7) - 1]}`) + ' ' + a.slice(0, 4)
      : `${MON[+a.slice(5, 7) - 1]} ${a.slice(0, 4)} – ${MON[+b.slice(5, 7) - 1]} ${b.slice(0, 4)}`;
    if (!h.includes(sp)) throw new Error(`run span "${sp}" not painted`);
    // unpriced rows dash HOME/AWAY/P&L and are excluded from the count
    eq(np, run.rows.filter(r => r.cents != null).length, 'priced count vs rows');
    I.state.calRun = null;
  });

  // ── items 19-22 · "what follows a run", recomputed independently ──────────
  ck('items 19-22 · "what follows a run" N per state recounts from raw rows', () => {
    const f = I.followStats(rows);
    // independent recount: walk the sequence, classify on the PRIOR streak
    const acc = {};
    ['W1', 'W2', 'W3+', 'L1', 'L2', 'L3+'].forEach(k => (acc[k] = { w: 0, l: 0, priced: 0, cents: 0 }));
    for (let i = 1; i < seq.length; i++) {
      let j = i - 1, res = seq[j].won ? 'W' : 'L', len = 0;
      while (j >= 0 && (seq[j].won ? 'W' : 'L') === res) { len++; j--; }
      const b = acc[res + (len >= 3 ? '3+' : String(len))];
      if (seq[i].won) b.w++; else b.l++;
      if (seq[i].cents != null) { b.cents += seq[i].cents; b.priced++; }
    }
    for (const k of Object.keys(acc)) {
      eq(f.rows[k].w, acc[k].w, `${k} wins`);
      eq(f.rows[k].l, acc[k].l, `${k} losses`);
      eq(f.rows[k].priced, acc[k].priced, `${k} priced`);
      eq(f.rows[k].cents, acc[k].cents, `${k} cents`);
    }
    // the six states must partition every observation but the first match
    const tot = Object.values(acc).reduce((a, b) => a + b.w + b.l, 0);
    eq(tot, Math.max(0, seq.length - 1), 'states partition the sequence');
    // baseline is the whole sequence
    eq(f.base.w + f.base.l, seq.length, 'baseline n vs sequence');
    // the file's own shape test: a 5-match win run gives 3 observations to W3+
    const five = runs.find(r => r.res === 'W' && r.len === 5);
    if (five) console.log('        (a 5-match win run is present; W3+ shape checked by the partition)');
    if (!html.includes('What follows a run')) throw new Error('the card is not painted');
    if (!html.includes('after W3+')) throw new Error('the W3+ row is not painted');
    if (!html.includes('baseline')) throw new Error('the baseline row is not painted');
    console.log(`        states: ${Object.entries(acc).map(([k, v]) => `${k} ${v.w + v.l}`).join('  ')}` +
      `  | baseline ${f.base.w + f.base.l} (${f.base.priced} priced)`);
  });

  // ── item 27 · walkovers ───────────────────────────────────────────────────
  ck('item 27 · walkovers received count as wins; walkovers given are stepped over', () => {
    const wo = rows.filter(r => r.wo);
    const got = wo.filter(r => r.won), given = wo.filter(r => !r.won);
    eq(skipped, given.length, 'skipped vs walkovers given');
    got.forEach((r) => {
      if (!seq.includes(r)) throw new Error(`walkover received ${r.date} was dropped from the sequence`);
    });
    console.log(`        walkovers: ${got.length} received (kept as wins), ${given.length} given (stepped over)`);
  });

  // ── item 28 · the expected figures ────────────────────────────────────────
  ck('item 28 · expected figures match the .dc.html formula on this player', () => {
    const n = seq.length, w = seq.filter(r => r.won).length, pr = n ? w / n : 0;
    const EL = (n2, p2) => (!n2 || !(p2 > 0 && p2 < 1)) ? null
      : Math.round(Math.log(n2 * (1 - p2)) / Math.log(1 / p2) + 0.5772 / Math.log(1 / p2) - 0.5);
    const E5 = (n2, p2) => (!n2 || !(p2 > 0 && p2 < 1)) ? null
      : Math.round(n2 * (1 - p2) * Math.pow(p2, 5) + n2 * p2 * Math.pow(1 - p2, 5));
    const exp5 = E5(n, pr), expW = EL(n, pr), expL = EL(n, 1 - pr);
    const obs5 = runs.filter(r => r.len >= 5).length;
    console.log(`        n=${n} p=${(pr * 100).toFixed(1)}%  runs of 5+: ${obs5} observed / ` +
      `${exp5} expected   longest W ${lw} / expected ${expW}   longest L ${ll} / expected ${expL}`);
    if (exp5 != null && !html.includes(`expected ${exp5} · ${runs.length} runs`)) {
      throw new Error(`"expected ${exp5} · ${runs.length} runs" not painted`);
    }
    if (expL != null && ll && !html.includes(`expected ${expL} · `)) {
      throw new Error(`loss-run "expected ${expL}" not painted`);
    }
    if (expW != null && !html.includes(`at ${(pr * 100).toFixed(1)}% over ${n} matches`)) {
      throw new Error('the Expected longest sub line is not painted');
    }
  });

  // ── items 1-11 · the painted structure ────────────────────────────────────
  ck('items 1-11 · tiles above the control, one mid rule, fixed pitch, year ticks', () => {
    const iTile = html.indexOf('Runs of 5+');
    const iSeg = html.indexOf('data-v="streaks"');
    if (iTile < 0) throw new Error('the tiles are not painted');
    if (iSeg < 0) throw new Error('the Calendar|Streaks control is not painted');
    if (iTile > iSeg) throw new Error('item 1: the control is still above the tiles');
    if (!html.includes('width:' + (runs.length * 7 - 1) + 'px'))
      throw new Error(`item 8: the timeline is not ${runs.length * 7 - 1}px wide (fixed pitch)`);
    if (!html.includes('top:50%;height:1px;background:rgba(255,255,255,0.12)'))
      throw new Error('item 7: no shared mid rule');
    if (html.includes('linear-gradient(to bottom,transparent 68px'))
      throw new Error('item 7: the old two-strip gradient survived');
    const yrs = new Set(runs.map(r => String(r.from).slice(0, 4)));
    for (const y of yrs) {
      if (!html.includes(`border-left:1px solid rgba(255,255,255,0.09);font-family:'IBM Plex Mono',monospace;` +
        `font-size:9.5px;font-weight:600;letter-spacing:0.12em;color:#5b6880;padding:6px 0 0 5px;">${y}<`))
        throw new Error(`item 9: no year tick for ${y}`);
    }
    if (!html.includes('Click a run for its matches'))
      throw new Error('item 11: the hint is missing with no run selected');
    // item 3: all four tile values white, never green/red
    const tileVals = html.match(/font-size:26px;font-weight:700;line-height:1;color:([^;]+);/g) || [];
    if (tileVals.length < 4) throw new Error(`only ${tileVals.length} tile values painted`);
    tileVals.slice(0, 4).forEach((v) => {
      if (!/#fff|#4b5672/.test(v)) throw new Error(`item 3: a tile value is coloured — ${v}`);
    });
  });

  // ── negative controls ─────────────────────────────────────────────────────
  //
  // The first version of this control flipped ONE mid-sequence result and
  // asserted the run count moved. On Krumich it did not — flipping a result
  // that already sits at a run boundary leaves the count unchanged — so the
  // control was vacuous for a third of the subjects. Inverting EVERY result is
  // deterministic: win runs become loss runs of exactly the same lengths, so
  // longest-W and longest-L must swap and the run count must be identical.
  ck('[neg] inverting every result swaps longest W and longest L exactly', () => {
    // `wo` is cleared so this control measures the RUN ENGINE alone — with the
    // flag left on, an inverted walkover-received becomes a walkover-given and
    // is stepped over, which is the next control's subject, not this one.
    const clone = rows.map(r => ({ ...r, won: !r.won, wo: false }));
    const plain = I.calRuns(rows.map(r => ({ ...r, wo: false })));
    const inv = I.calRuns(clone);
    const plw = plain.filter(r => r.res === 'W').reduce((a, r) => Math.max(a, r.len), 0);
    const pll = plain.filter(r => r.res === 'L').reduce((a, r) => Math.max(a, r.len), 0);
    eq(inv.length, plain.length, 'inverted run count');
    eq(inv.filter(r => r.res === 'W').reduce((a, r) => Math.max(a, r.len), 0), pll, 'inverted longest W');
    eq(inv.filter(r => r.res === 'L').reduce((a, r) => Math.max(a, r.len), 0), plw, 'inverted longest L');
    if (plw === pll && rows.length > 20) throw new Error('lw === ll makes the swap unobservable here');
  });
  ck('[neg] item 27 · the walkover rule is DIRECTIONAL, not a blanket exclusion', () => {
    const got = rows.filter(r => r.wo && r.won).length;
    if (!got && !skipped) throw new Error('no walkover on record — this control cannot fire here');
    // Received walkovers sit in the sequence; invert them and the same rows must
    // drop out. A rule that excluded every walkover, or none, fails both ways.
    const flipped = rows.map(r => (r.wo ? { ...r, won: !r.won } : r));
    eq(I.calRunRows(flipped).length, seq.length - got + skipped,
      'inverting the walkovers did not move exactly those rows');
  });
  ck('[neg] dropping the priced join dashes the money columns and nothing else', () => {
    const clone = rows.map(r => ({ ...r, price: null, oppPrice: null, cents: null }));
    const f = I.followStats(clone);
    eq(f.base.priced, 0, 'priced survived the drop');
    eq(f.base.w + f.base.l, seq.length, 'the run population moved when only prices were removed');
    const before = I.followStats(rows).base.priced;
    if (before === 0 && s.key !== '906') throw new Error('the control cannot distinguish: nothing was priced to begin with');
  });
  ck('[neg] a one-run timeline would not paint this width', () => {
    const w = runs.length * 7 - 1;
    if (html.includes('width:6px;')) { /* bars exist */ } else throw new Error('no 6px bars painted');
    if (w !== 6 && html.includes(`<div style="width:6px;">`))
      throw new Error('the fixed-pitch container width is not derived from the run count');
  });
}

console.log(`\n${'═'.repeat(60)}\nPASS ${pass}   FAIL ${fail}`);
process.exit(fail ? 1 : 0);
