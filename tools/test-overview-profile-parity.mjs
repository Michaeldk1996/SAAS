// Match analysis → Overview vs the player profile's Career record (2026-10-21): the same player under the same tier must
// print the same career record, the same surface records and rates, the same season cells and the same "no surface"
// count in both places. Both sides are RENDERED by their real code — the profile's renderCareerModal (player-profile-v2.js)
// and the Overview's buildYearlyTables (bsp-consult-dashboard.html, sliced and executed by tools/ten334-overview-vm.mjs) —
// and compared on the printed figures, so a check cannot pass without running the Overview's record code.
//
// Population: a manufactured fixture (an Indoors carve-out, indoor matches with no surface, a "surface not known"
// residual, tier splits, a pre-2021 aggregate with no split), then every player in the deployed player-profiles.json under
// All / ATP / Challenger & ITF. With no deployed store reachable the roster leg says so and is skipped, never passed.
// The last check applies each mutation named below and fails if any survives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { overviewVM, profileWindow } from './ten334-overview-vm.mjs';

const require = createRequire(import.meta.url);
const HTML = readFileSync(new URL('../bsp-consult-dashboard.html', import.meta.url), 'utf8');
const TIERS = ['all', 'atp', 'chitf'];
const COLS = ['total', 'clay', 'hard', 'indoors', 'grass', 'unknown'];   // the profile's season-table order
const SURFS = ['clay', 'hard', 'indoors', 'grass'];
const YEAR = String(new Date().getFullYear());
const norm = s => (s == null ? null : String(s).replace(/[–/]/g, '-').trim());

// ── the profile, rendered ──
function profileFigures(win, p, tier) {
  const I = win.PlayerProfileV2._internals;
  Object.assign(I.state, { careerTab: 'record', careerScope: 'career', careerTier: tier, careerDrill: null });
  const h = I.renderCareerModal(p, { archetype: null });
  const hero = /font-size:31px;font-weight:800;[^>]*>([^<]*)<\/span>(?:<span[^>]*><span style="font-size:14px;font-weight:700;[^>]*>([\d.]+%)|<span style="font-size:14px;font-weight:700;[^>]*>([\d.]+%))?/.exec(h);
  const bars = {};
  for (const s of SURFS) {
    const a = h.indexOf(`data-pp2-srow="${s}"`), b = h.indexOf('data-pp2-srow=', a + 10);
    const sl = h.slice(a, b < 0 ? h.indexOf('vs all = ', a) : b);
    const rec = />(\d+–\d+|—)<\/span>/.exec(sl);
    const rate = />(\d+\.\d%)/.exec(sl);
    bars[s] = { rec: norm(rec && rec[1]), rate: rate ? rate[1] : null };
  }
  const un = /(\d+) (?:Davis Cup )?match(?:es)? with no surface/.exec(h);
  const seasons = {};
  const sp = h.slice(h.indexOf('Record by season'));
  const re = />(\d{4})<\/div>((?:<div[^>]*>[^<]*<\/div>){6})/g;
  let m;
  while ((m = re.exec(sp))) {
    const v = [...m[2].matchAll(/>([^<]*)<\/div>/g)].map(x => norm(x[1]));
    seasons[m[1]] = Object.fromEntries(COLS.map((c, i) => [c, v[i]]));
  }
  const ft = />Career<\/div>((?:<div[^>]*>[^<]*<\/div>){6})/.exec(sp);
  const career = ft ? Object.fromEntries([...ft[1].matchAll(/>([^<]*)<\/div>/g)].map((x, i) => [COLS[i], norm(x[1])])) : null;
  return { rec: norm(hero && hero[1]), rate: hero ? hero[2] || hero[3] || null : null, bars, unknownN: un ? +un[1] : 0, seasons, career,
    rateText: I.rateText };
}

// ── the Overview, rendered ──
function overviewFigures(src, key, p, tier) {
  const vm = overviewVM(src, { profiles: { [key]: p } });
  const m = { id: 'parity', p1: p.name || key, p2: '—', p1Key: key, p2Key: null };
  vm.buildYearlyTables(m);
  vm._ov.tier = tier;
  const h = vm.buildYearlyTables(m);
  const col = h.slice(h.indexOf('data-ov-p="0"'), h.indexOf('data-ov-p="1"'));
  const rec = /class="ov-career-rec"[^>]*>([^<]*)</.exec(col);
  const pct = /class="ma-rate ov-career-pct"[^>]*>([^<]*)</.exec(col);
  const bars = {};
  for (const s of SURFS) {
    const v = new RegExp(`data-ov-bar="${s}"[\\s\\S]*?class="ov-surf-v"[^>]*>([\\s\\S]*?)</span></div>`).exec(col);
    const txt = v ? v[1] : '';
    const r = /^(\d+-\d+|—)/.exec(txt.replace(/<[^>]*>/g, ''));
    const rate = />(\d+\.\d%)</.exec(txt);
    bars[s] = { rec: r ? r[1] : null, rate: rate ? rate[1] : null };
  }
  const un = /class="ov-unknown-n">(\d+) match/.exec(col);
  const seasons = {};
  for (const x of col.matchAll(/data-ov-cell="0\|(\d{4})\|(\w+)"[^>]*>([^<]*)</g)) (seasons[x[1]] = seasons[x[1]] || {})[x[2]] = norm(x[3]);
  const tot = col.slice(col.indexOf('class="ov-total"'));
  const tv = [...tot.matchAll(/<span style="font-family:'IBM Plex Mono'[^>]*>([^<]*)<\/span>/g)].map(x => norm(x[1]));
  const career = Object.fromEntries(COLS.map((c, i) => [c, tv[i]]));
  const cards = {};
  for (const s of SURFS) {
    const a = col.indexOf(`data-ov-cell="0|season|${s}"`);
    const sl = col.slice(a, col.indexOf('</div></div>', a));
    const v = [...sl.matchAll(/<span style="width:\d+px;[^>]*>([\s\S]*?)<\/span>(?=<span|$)/g)].map(x => x[1].replace(/<[^>]*>/g, ''));
    cards[s] = { rec: norm(v[1]), rate: v[2] && /%$/.test(v[2]) ? v[2] : null };
  }
  return { rec: norm(rec && rec[1]), rate: pct ? pct[1].replace(/ win$/, '') : null, bars, unknownN: un ? +un[1] : 0, seasons, career, cards };
}

// One player, one tier: every figure the two pages print, compared. Returns the mismatches as strings.
function compare(src, key, p, tier) {
  const win = profileWindow({ [key]: p });
  const P = profileFigures(win, p, tier), O = overviewFigures(src, key, p, tier);
  const bad = [];
  const eq = (what, a, b) => { if (a !== b) bad.push(`${key} ${tier} ${what}: profile ${a} · overview ${b}`); };
  eq('career W-L', P.rec, O.rec);
  eq('career win %', P.rate, O.rate === '—' ? null : O.rate);   // n 0: the profile prints no rate, the Overview's D2 gate a dash
  for (const s of SURFS) { eq(`${s} W-L`, P.bars[s].rec, O.bars[s].rec); eq(`${s} win %`, P.bars[s].rate, O.bars[s].rate); }
  eq('no-surface count', P.unknownN, O.unknownN);
  for (const c of COLS) eq(`Total row ${c}`, P.career && P.career[c], O.career[c]);
  for (const y of Object.keys(P.seasons)) for (const c of COLS) eq(`${y} ${c}`, P.seasons[y][c], (O.seasons[y] || {})[c] || null);
  for (const y of Object.keys(O.seasons)) if (!P.seasons[y] && Object.values(O.seasons[y]).some(v => v !== '—')) bad.push(`${key} ${tier} ${y}: overview prints a season the profile does not`);
  // This season · by surface = the profile's current-season cells, rated by the profile's own formatter
  const cur = P.seasons[YEAR] || {};
  for (const s of SURFS) {
    const c = cur[s] && cur[s] !== '—' ? cur[s].split('-').map(Number) : null;
    eq(`this season ${s} W-L`, c ? `${c[0]}-${c[1]}` : '—', O.cards[s].rec);
    const r = c ? P.rateText(c[0], c[1]) : '—';
    eq(`this season ${s} win %`, r === '—' ? null : r, O.cards[s].rate);
  }
  return { bad, P, O };
}

// ── the manufactured fixture ──
const wl = (won, lost) => ({ won, lost });
const FX = { key: 'fx1', name: 'F. Ixture', careerByYear: [
  // Indoors carved out of Hard; 22-29 on the surfaces against a 22-30 total (one ATP match with no surface)
  { year: YEAR, allTier: true, total: wl(22, 30), clay: wl(13, 13), hard: wl(5, 12), grass: wl(4, 4), indoor: { total: wl(1, 0), clay: null, hard: wl(1, 0), grass: null },
    atp: { total: wl(17, 28), clay: wl(8, 11), hard: wl(5, 12), grass: wl(4, 4), indoor: { total: wl(1, 0), clay: null, hard: wl(1, 0), grass: null } },
    chitf: { total: wl(5, 2), clay: wl(5, 2), hard: null, grass: null, indoor: null } },
  { year: '2025', allTier: true, total: wl(34, 35), clay: wl(13, 8), hard: wl(20, 24), grass: wl(1, 3), indoor: { total: wl(9, 8), clay: null, hard: wl(9, 8), grass: null },
    atp: { total: wl(28, 32), clay: wl(10, 7), hard: wl(17, 22), grass: wl(1, 3), indoor: { total: wl(9, 8), clay: null, hard: wl(9, 8), grass: null } },
    chitf: { total: wl(6, 3), clay: wl(3, 1), hard: wl(3, 2), grass: null, indoor: null } },
  // indoor matches with no surface (Indoors 8-5 > indoor Hard 6-4) and a residual
  { year: '2024', allTier: true, total: wl(30, 20), clay: wl(10, 5), hard: wl(12, 10), grass: null, indoor: { total: wl(8, 5), clay: null, hard: wl(6, 4), grass: null },
    atp: { total: wl(4, 6), clay: wl(1, 2), hard: wl(3, 4), grass: null, indoor: null },
    chitf: { total: wl(26, 14), clay: wl(9, 3), hard: wl(9, 6), grass: null, indoor: { total: wl(8, 5), clay: null, hard: wl(6, 4), grass: null } } },
  // a pre-2021 aggregate: no tier split, no court type
  { year: '2018', allTier: false, total: wl(9, 4), clay: wl(3, 1), hard: wl(4, 3), grass: wl(1, 0), atp: null, chitf: null },
] };
// 51 of 80: the profile's 100 × W / n prints 63.8%, k / n × 100 prints 63.7% (player 1775's Challenger hard, deployed)
const FX2 = { key: 'fx2', name: 'R. Ounding', careerByYear: [
  { year: '2025', allTier: true, total: wl(51, 29), clay: null, hard: wl(51, 29), grass: null, indoor: null,
    atp: null, chitf: { total: wl(51, 29), clay: null, hard: wl(51, 29), grass: null, indoor: null } },
] };

const CHECKS = {
  // the figures themselves, on the fixture: the profile's numbers, independently stated, so a regression on BOTH sides
  // (the shared calculation moving) is caught too
  'fixture: the Overview prints the profile Career record (carved Indoors, residual, one decimal)'(src) {
    const { bad, O } = compare(src, FX.key, FX, 'all');
    assert.deepEqual(bad, []);
    assert.equal(O.rec, '95-89');
    assert.equal(O.rate, '51.6%');
    assert.deepEqual(O.bars.hard, { rec: '25-37', rate: '40.3%' });
    assert.deepEqual(O.bars.indoors, { rec: '18-13', rate: '58.1%' });
    assert.equal(O.unknownN, 12, '2026 0-1 + 2024 6-4 + 2018 1-0 (9-4 less 3-1, 4-3, 1-0) = 7-5');
    assert.deepEqual(O.seasons['2024'], { total: '30-20', clay: '10-5', hard: '6-6', indoors: '8-5', grass: '—', unknown: '6-4' });
    assert.deepEqual(O.cards.hard, { rec: '4-12', rate: '25.0%' });
    assert.deepEqual(O.cards.indoors, { rec: '1-0', rate: null });
  },
  'fixture: ATP and Challenger & ITF match the profile, the pre-2021 row dashed under both'(src) {
    for (const t of ['atp', 'chitf']) {
      const { bad, O } = compare(src, FX.key, FX, t);
      assert.deepEqual(bad, [], t);
      assert.deepEqual(O.seasons['2018'], { total: '—', clay: '—', hard: '—', indoors: '—', grass: '—', unknown: '—' }, t);
    }
  },
  'rates round exactly as the profile does (51 of 80 = 63.8%)'(src) {
    const { bad, O } = compare(src, FX2.key, FX2, 'all');
    assert.deepEqual(bad, []);
    assert.equal(O.rate, '63.8%');
    assert.equal(O.bars.hard.rate, '63.8%');
  },
  'every season row: the surfaces plus Surface not known add up to the total'(src) {
    for (const t of TIERS) {
      const { O } = compare(src, FX.key, FX, t);
      for (const [y, r] of Object.entries(O.seasons)) {
        if (r.total === '—') continue;
        const sum = ['clay', 'hard', 'indoors', 'grass', 'unknown'].reduce((a, c) => { if (r[c] === '—') return a; const [w, l] = r[c].split('-').map(Number); return [a[0] + w, a[1] + l]; }, [0, 0]);
        assert.equal(sum.join('-'), r.total, `${t} ${y}`);
      }
    }
  },
};

const MUTANTS = [
  // the Overview reads the raw careerByYear cells again (no Indoors carve, no residual) — the pre-fix state
  ['year table reads raw cells', 'OV_COLS.map(([s]) => ovCellHtml(i, r, s, tier, pk, false, g)).join(\'\'))(api.tierGridCells(r, tier))',
    'OV_COLS.map(([s]) => ovCellHtml(i, r, s, tier, pk, false, g)).join(\'\'))(tier === \'all\' ? r : (r[tier] || {}))'],
  ['career ignores the tier', 'api.careerTierCells({ careerByYear: real }, tier)', "api.careerTierCells({ careerByYear: real }, 'all')"],
  ['whole-number win %', "text: cn ? api.rateText(cr.won, cr.lost) + ' win' : null", "text: cn ? maPct(cr.won, cn) + ' win' : null"],
  ['surface rates on the k / n × 100 formula', "{ text: n ? api.rateText(c.won, c.lost) : null, nopct: '', note: 'title', color: OV_C.text, style: 'font-weight:700;' }",
    "{ dp: 1, nopct: '', note: 'title', color: OV_C.text, style: 'font-weight:700;' }"],
  ['no Indoors surface', "const OV_SURFS = [['clay', 'Clay'], ['hard', 'Hard'], ['indoors', 'Indoors'], ['grass', 'Grass']];", "const OV_SURFS = [['clay', 'Clay'], ['hard', 'Hard'], ['grass', 'Grass']];"],
  ['no unknown column', "const OV_COLS = [...OV_SURFS, ['unknown', 'Surface not known']];", 'const OV_COLS = [...OV_SURFS];'],
  ['no-surface footnote dropped', "${residN > 0 ? ` · <span class=\"ov-unknown-n\">", "${false ? ` · <span class=\"ov-unknown-n\">"],
  ['season cards ignore the tier', 'sg = sr ? api.tierGridCells(sr, tier) : null', "sg = sr ? api.tierGridCells(sr, 'all') : null"],
];

let failed = 0;
const ok = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').slice(0, 12).join('\n    ')}`); } };
console.log('test-overview-profile-parity');
for (const [name, fn] of Object.entries(CHECKS)) ok(name, () => fn(HTML));

// ── the deployed roster, every player, every tier ──
ok('deployed roster: every player, every tier, Overview = profile', () => {
  const store = require('./deployed-store.js').playerProfiles();
  if (store.source === 'committed') { console.log(`    SKIPPED (not passed): no deployed store — ${store.drift && store.drift.why}`); return; }
  const players = Object.entries(store.players).filter(([, p]) => Array.isArray(p.careerByYear) && p.careerByYear.length);
  assert.ok(players.length >= 100, `a roster of ${players.length} players is not a roster`);
  const bad = [];
  let indoorN = 0, unknownN = 0;
  for (const [k, p] of players) for (const t of TIERS) {
    const r = compare(HTML, k, Object.assign({ key: k }, p), t);
    bad.push(...r.bad);
    if (t === 'all') { if (r.O.bars.indoors.rec && r.O.bars.indoors.rec !== '—') indoorN++; if (r.O.unknownN) unknownN++; }
  }
  console.log(`    ${players.length} players × ${TIERS.length} tiers (${store.source} store, ${store.fetchedAt}); Indoors on ${indoorN}, a no-surface residual on ${unknownN}`);
  // a parity run over players with no Indoors and no residual would prove nothing about either
  assert.ok(indoorN > 0 && unknownN > 0, 'the roster carries no Indoors or no residual: nothing measured');
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} mismatches`);
});

ok(`mutants: ${MUTANTS.length} applied, every one caught`, () => {
  const survived = [];
  for (const [label, from, to] of MUTANTS) {
    assert.equal(HTML.split(from).length, 2, `mutant anchor for "${label}" must occur exactly once`);
    const mutant = HTML.replace(from, to);
    let caught = false;
    for (const fn of Object.values(CHECKS)) { try { fn(mutant); } catch (e) { if (e instanceof assert.AssertionError) { caught = true; break; } throw e; } }
    if (!caught) survived.push(label);
  }
  assert.deepEqual(survived, [], 'mutants that survived');
});

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
