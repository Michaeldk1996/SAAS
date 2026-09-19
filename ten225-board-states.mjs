#!/usr/bin/env node
/* TEN-225 items 2/3/4 — what the LIVE board is actually in, measured.
 *
 * Founder 2026-09-19:
 *   2. "Report how many cards on today's board are in each state and which
 *       columns each renders."
 *   3. "FINISHED MATCHES ARE STILL IN UPCOMING ... Report the cause."
 *   4. "Per fixture: is the 0% evidenced (two real observations) or a single
 *       sighting rendered twice? ... Dougaz 1.00/1.00 is not a price ... report
 *       why [the 20% guard] did not [catch it] ... For the Open-with-dashed-Now
 *       cases: which book, and why is there no current price?"
 *
 * READS THE DEPLOYED ARTEFACTS, not the checkout — matches.json and
 * odds-card-state.json are cron-refreshed and the repo copies are stubs. The
 * card-state resolution below mirrors the shipped `_ocsOf` / `_mcOpenNowPair`
 * rules; it is a measurement of the published data, and the DOM read in
 * ten225-columns-probe.mjs is the check on the RENDER.
 *
 * ⚠️ A fixture is classed UNDERWAY on the client clock (start instant passed,
 * no final score) — the same test the card itself uses. That is a statement
 * about our data, not about the court: a match the results feed has not yet
 * settled looks identical to one genuinely in play, and telling them apart is
 * exactly what item 3 is about.
 */
const BASE = 'https://michaeldk1996.github.io/SAAS';

async function j(p){ const r = await fetch(`${BASE}/${p}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); }

// ── the shipped helpers, reproduced only where the measurement needs them ──
const ACCT_TZ_STD = 60, ACCT_TZ_DST = 120;
function acctTzOffsetMin(ms){ const d = new Date(ms), mo = d.getUTCMonth();
  return (mo >= 2 && mo <= 9) ? ACCT_TZ_DST : ACCT_TZ_STD; }
function cardStartMs(m){
  if (m && m.startTs != null){ const t = new Date(m.startTs).getTime(); if (isFinite(t)) return t; }
  if (m && m.date && /^\d{2}:\d{2}/.test(m.time || '')){
    const naive = Date.parse(`${m.date}T${m.time.slice(0,5)}:00Z`);
    if (isFinite(naive)) return naive - acctTzOffsetMin(naive) * 60000;
  }
  return NaN;
}
const isFinished = m => !m.live && !!m.finalScore;
function nameKey(n){
  const s = String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const toks = s.split(/[^a-z]+/).filter(Boolean);
  return toks.length ? toks[toks.length - 1] : '';
}
function ocsKeyOf(m){
  if (!m || !m.date) return null;
  const a = nameKey(m.p1), b = nameKey(m.p2);
  if (!a || !b) return null;
  return `${m.date}|${[a,b].sort().join('|')}`;
}
const px = v => (typeof v === 'number' && v > 0) ? v : null;
const overround = (a,b) => (typeof a === 'number' && typeof b === 'number' && a > 0 && b > 0)
  ? (1/a) + (1/b) - 1 : null;

const M = await j('matches.json');
const OCS = await j('odds-card-state.json');
const matches = Array.isArray(M) ? M : (M.matches || []);
const byKey = OCS.byKey || {};

// today's board, viewer-local, the same bucket the page uses
const ds = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const TODAY = ds(new Date());
const board = matches.filter(m => m.date === TODAY);
const now = Date.now();

console.log(`deployed matches.json ${matches.length} fixtures · odds-card-state ${Object.keys(byKey).length} keys`);
console.log(`odds-card-state generatedAt ${OCS.generatedAt}`);
console.log(`today = ${TODAY} (viewer-local) · board n=${board.length} · measured ${new Date().toISOString()}\n`);

// ───────────────────────────────── ITEM 2 — card states ──────────────────
const state = m => {
  const s = cardStartMs(m);
  if (isFinished(m)) return 'COMPLETED';
  if (isFinite(s) && now >= s) return 'UNDERWAY';
  return 'UPCOMING';
};
const buckets = { UPCOMING: [], UNDERWAY: [], COMPLETED: [] };
for (const m of board) buckets[state(m)].push(m);

console.log('='.repeat(74));
console.log('ITEM 2 — CARD STATE on today\'s board');
console.log('='.repeat(74));
for (const k of ['UPCOMING','UNDERWAY','COMPLETED']){
  console.log(`  ${k.padEnd(10)} n=${String(buckets[k].length).padStart(3)}` +
    (buckets[k].length < 30 ? '   ⚠️ n<30' : ''));
}
console.log('\n  UNDERWAY fixtures (started on our clock, no final score):');
if (!buckets.UNDERWAY.length) console.log('    none — nothing to check, so any column claim below would be vacuous');
for (const m of buckets.UNDERWAY){
  const mins = ((now - cardStartMs(m))/60000);
  const e = byKey[ocsKeyOf(m) || ''] || null;
  const sides = e && e.sides ? Object.values(e.sides) : [];
  const hasNow = sides.some(s => px(s.now) != null);
  const hasClose = sides.some(s => px(s.close) != null);
  const hasOpen = sides.some(s => px(s.open) != null);
  console.log(`    ${String(m.id).padEnd(22)} +${mins.toFixed(0).padStart(4)}m  live=${!!m.live}` +
    `  ocs=${e ? e.book : '-'}  open=${hasOpen} now=${hasNow} close=${hasClose}  ${m.p1} v ${m.p2}`);
}

// ───────────────────────────── ITEM 3 — finished in Upcoming ─────────────
console.log('\n' + '='.repeat(74));
console.log('ITEM 3 — finished matches sitting on the UPCOMING tab');
console.log('='.repeat(74));
console.log('  The tab predicate is `if (effView===\'upcoming\' && isFinishedMatch(m)) return false;`');
console.log('  and isFinishedMatch(m) = !m.live && !!m.finalScore. So a card only reaches');
console.log('  Upcoming when our DATA says it is unfinished. Classifying every card the');
console.log('  predicate admits whose start instant has already passed:\n');
const lateNoScore = buckets.UNDERWAY.slice().sort((a,b)=>cardStartMs(a)-cardStartMs(b));
const reason = m => {
  if (m.live) return 'feed says LIVE (in play)';
  if (m.finalScore) return 'has finalScore — should NOT be here';
  if (m.liveStatus) return `no finalScore; liveStatus=${JSON.stringify(m.liveStatus)}`;
  return 'no finalScore, no live flag — results-feed has not settled it';
};
const byReason = {};
for (const m of lateNoScore){ const r = reason(m); (byReason[r] ||= []).push(m); }
for (const [r, ms] of Object.entries(byReason)){
  console.log(`  ${String(ms.length).padStart(3)}  ${r}`);
  for (const m of ms.slice(0, 8)){
    const mins = (now - cardStartMs(m))/60000;
    console.log(`         +${mins.toFixed(0).padStart(5)}m  ${m.time} ${m.p1} v ${m.p2}  [${m.tour}]`);
  }
  if (ms.length > 8) console.log(`         ... and ${ms.length - 8} more`);
}
const stale = lateNoScore.filter(m => (now - cardStartMs(m))/60000 > 180);
console.log(`\n  started >180 min ago and still unsettled: ${stale.length}` +
  (stale.length < 30 ? '   ⚠️ n<30' : ''));

// ───────────────────────────── ITEM 4 — the wall of 0% ───────────────────
console.log('\n' + '='.repeat(74));
console.log('ITEM 4 — flat 0% cards: evidenced, or one sighting rendered twice?');
console.log('='.repeat(74));
const rows = [];
for (const m of board){
  const e = byKey[ocsKeyOf(m) || ''] || null;
  if (!e || !e.sides) continue;
  const k1 = nameKey(m.p1), k2 = nameKey(m.p2);
  const s1 = e.sides[k1], s2 = e.sides[k2];
  if (!s1 || !s2) continue;
  const o1 = px(s1.open), o2 = px(s2.open), n1 = px(s1.now), n2 = px(s2.now);
  const openObs = s1.openObs || s2.openObs || null;
  const nowObs  = s1.nowObs  || s2.nowObs  || null;
  const openTs  = s1.openTs  || s2.openTs  || null;
  const nowTs   = s1.nowTs   || s2.nowTs   || null;
  rows.push({ m, e, o1, o2, n1, n2, openObs, nowObs, openTs, nowTs,
              flat: o1 != null && n1 != null && o1 === n1 && o2 === n2 });
}
const flat = rows.filter(r => r.flat);
const evid = r => {
  const a = Date.parse(r.openObs || r.openTs || ''), b = Date.parse(r.nowObs || r.nowTs || '');
  return Number.isFinite(a) && Number.isFinite(b) && b > a;
};
console.log(`  fixtures on today's board carrying a published open+now pair: ${rows.length}` +
  (rows.length < 30 ? '   ⚠️ n<30' : ''));
console.log(`  of those, FLAT (open === now on both sides): ${flat.length}`);
console.log(`     evidenced by two distinct observations : ${flat.filter(evid).length}`);
console.log(`     SINGLE SIGHTING rendered twice         : ${flat.filter(r=>!evid(r)).length}`);
console.log('\n  per fixture:');
for (const r of flat){
  console.log(`    ${evid(r) ? 'EVIDENCED' : 'SINGLE   '} ${String(r.e.book).padEnd(10)}` +
    ` ${String(r.o1).padStart(6)}/${String(r.o2).padEnd(6)}` +
    ` openObs=${r.openObs || r.openTs || '-'} nowObs=${r.nowObs || r.nowTs || '-'}` +
    `  ${r.m.p1} v ${r.m.p2}`);
}

// ── the impossible-leg sentinel the 20% pair guard cannot see ─────────────
console.log('\n  --- legs at or below 1.01, and what the 20% pair guard makes of them ---');
let sent = 0;
for (const r of rows){
  for (const [lbl, a, b] of [['open', r.o1, r.o2], ['now', r.n1, r.n2]]){
    if (a == null || b == null) continue;
    if (!(a <= 1.01 || b <= 1.01)) continue;
    sent++;
    const ov = overround(a, b);
    console.log(`    ${lbl.padEnd(5)} ${String(a).padStart(6)}/${String(b).padEnd(7)}` +
      ` overround ${(ov*100).toFixed(1).padStart(6)}%  ` +
      `${ov > 0.20 ? 'CAUGHT by the 20% rule' : 'NOT CAUGHT — the pair looks ordinary'}` +
      `  [${r.e.book}] ${r.m.p1} v ${r.m.p2}`);
  }
}
if (!sent) console.log('    none on this board — so a pass here would be vacuous; see the manufactured control');

// ── open-with-dashed-now ─────────────────────────────────────────────────
console.log('\n  --- OPEN present, NOW dashed: which book, and why ---');
const openNoNow = rows.filter(r => r.o1 != null && r.o2 != null && (r.n1 == null || r.n2 == null));
console.log(`  n=${openNoNow.length}` + (openNoNow.length < 30 ? '   ⚠️ n<30' : ''));
for (const r of openNoNow){
  const st = cardStartMs(r.m);
  const started = isFinite(st) && now >= st;
  const why = started ? 'fixture has STARTED — the Now rule withholds an in-play price'
            : (r.e.source === 'api-tennis' ? 'api-tennis sighting row: the fallback path writes no now_price'
            : 'the selected book has published no current price');
  console.log(`    ${String(r.e.book).padEnd(10)} src=${String(r.e.source).padEnd(10)}` +
    ` open ${r.o1}/${r.o2}  started=${started}  ${why}  — ${r.m.p1} v ${r.m.p2}`);
}
