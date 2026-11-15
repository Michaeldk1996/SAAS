#!/usr/bin/env node
// Read-only measurement: write the report of finished Grand Slam matches from OUR data only — no Tennis TV commentary,
// no on-court interview, no broadcast stats card, no quotes. Publishes nothing. Needs ANTHROPIC_API_KEY.
// Usage: node tools/news-ticker/slam-probe.mjs <eventKey:playerKey> ...   (playerKey = one of the two players)
import { factSheet, composeReport, assemble, roundCode } from './compose.mjs';
import { reportText, ratingLines } from './news-core.mjs';
import { surnameOf } from './humanise.mjs';
import { pbpFacts, scoreFacts } from './pbp-facts.mjs';
import { baselineFor } from './standouts.mjs';

const BASE = 'https://michaeldk1996.github.io/SAAS';
const get = async (p) => { const r = await fetch(`${BASE}/${p}`, { signal: AbortSignal.timeout(90000) }); return r.ok ? r.json() : null; };
const SLAM = /australian open|french open|roland garros|wimbledon|us open/i;
const ROUND = { '1/64-finals': ['first round', 1], '1/32-finals': ['second round', 2], '1/16-finals': ['third round', 3], '1/8-finals': ['round of 16', 4], 'quarter-finals': ['quarter-finals', 5], 'semi-finals': ['semi-finals', 6], final: ['final', 7],
  r128: ['first round', 1], r64: ['second round', 2], r32: ['third round', 3], r16: ['round of 16', 4], qf: ['quarter-finals', 5], sf: ['semi-finals', 6], f: ['final', 7] };
const rd = (r) => ROUND[String(r || '').toLowerCase()] || [null, 0];
const NEXT = { 4: 'quarter-final', 5: 'semi-final', 6: 'final' }, ORD = (n) => (n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`);

const [index, ratings, stylesFile] = await Promise.all([get('player-index.json'), get('surface-ratings.json'), get('playing-styles.json')]);
const names = ((index && index.players) || []).map((p) => p && p.name).filter(Boolean);
const surnames = new Set(names.flatMap((n) => String(n).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[\s-]+/).slice(1)).filter((x) => x.length >= 4));
const styleRows = (stylesFile && stylesFile.players) || [];
const styleOf = (card) => { const r = styleRows.filter((p) => p && p.name === card && p.archetype_label); return r.length === 1 ? String(r[0].archetype_label).toLowerCase() : null; };
let tin = 0, tout = 0;

for (const arg of process.argv.slice(2)) {
  const [ek, pk] = arg.split(':');
  const [sp, ss, ch] = await Promise.all([get(`pbp/${ek}.json`), get(`setstats/${ek}.json`), get(`career-history/${pk}.json`)]);
  const row = ch && ch.matches.find((r) => String(r.eventKey) === ek);
  if (!sp || !ss || !row) { console.log(`\n######## ${ek}: missing data (point log ${!!sp}, box score ${!!ss}, history row ${!!row})`); continue; }
  const me = String(ss.p1Key) === String(pk) ? 'p1' : 'p2', op = me === 'p1' ? 'p2' : 'p1';
  const sets = row.sets.map((s) => ({ [me]: s.p, [op]: s.o }));
  const tb = row.sets.map((s) => (s.pTb != null && s.oTb != null ? [s.pTb, s.oTb] : null));
  const wk = row.won ? me : op, [rw, rn] = rd(row.round);
  const m = { id: `past-${ek}`, date: row.date, time: null, p1: sp.p1, p2: sp.p2, tour: row.tournament, tourBadge: 'ATP', surface: row.surface, tournamentRound: `${row.tournament} - ${row.round}`, qualifying: false,
    p1Key: ss.p1Key, p2Key: ss.p2Key, venue: { indoor: !!row.indoor }, retired: false, walkover: false, matchStats: ss.match, setStats: ss.sets,
    finalScore: { display: sets.map((s, i) => `${s.p1}-${s.p2}${tb[i] ? `(${Math.min(...tb[i])})` : ''}`).join(', '), sets, tb, p1Sets: sets.filter((s) => s.p1 > s.p2).length, p2Sets: sets.filter((s) => s.p2 > s.p1).length, winner: wk } };
  const w = wk, l = w === 'p1' ? 'p2' : 'p1', W = surnameOf(m[w]), L = surnameOf(m[l]);
  // what it means, from our own records: titles and finals at tour level, and how far he has been at the Grand Slams
  const hist = async (key) => { const h = String(key) === String(pk) ? ch : await get(`career-history/${key}.json`); return ((h && h.matches) || []).filter((r) => r.level === 'atp' && !r.walkover && String(r.date) < String(row.date)); };
  const hw = await hist(m[w + 'Key']), hl = await hist(m[l + 'Key']), isSlam = SLAM.test(row.tournament), miles = [];
  const fin = (h) => h.filter((r) => rd(r.round)[1] === 7), slam = (h) => h.filter((r) => SLAM.test(r.tournament));
  if (rn === 7) {
    const titles = fin(hw).filter((r) => r.won).length + 1, slamTitles = fin(slam(hw)).filter((r) => r.won).length + 1;
    miles.push(`In our records this is tour-level title number ${titles} for ${W}${isSlam ? ` and his ${ORD(slamTitles)} Grand Slam title` : ''}.`);
    if (isSlam && !fin(slam(hl)).length) miles.push(`It was the first Grand Slam final of ${L}.`);
    else if (!fin(hl).length) miles.push(`It was the first tour-level final of ${L}.`);
  } else if (isSlam && NEXT[rn]) {
    const before = slam(hw).filter((r) => rd(r.round)[1] >= rn + 1).length;
    miles.push(`${W} is in a Grand Slam ${NEXT[rn]} for the ${ORD(before + 1)} time in our records.`);
  }
  const mine = (ch.matches || []).filter((r) => r.tournament === row.tournament && r.year === row.year && String(r.date) > String(row.date)).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  const path = rn === 7 ? [`This was the final: ${W} wins the title.`] : (row.won && mine ? [`Next for ${W}: ${surnameOf(mine.opponent)} in ${roundCode(rd(mine.round)[0])}.`] : []);
  const bestOf = isSlam ? 5 : 3, pbp = pbpFacts(sp, m.finalScore, bestOf);
  const baselines = { [w]: baselineFor(ratings, m[w + 'Key'], m.surface), [l]: baselineFor(ratings, m[l + 'Key'], m.surface) };
  const rep = reportText(m, w, l, { baselines, h2h: null, pbp, score: scoreFacts(m.finalScore, w), round: rw, duration: null });
  const sheet = factSheet({ m, w, l, rep, shard: sp, round: rw, card: null, commentary: null, quotes: [], path, styles: { [w]: styleOf(m[w]), [l]: styleOf(m[l]) }, physical: [], bestOf, milestones: miles });
  console.log(`\n######## ${ek} ${m[w]} d. ${m[l]} (${row.tournament} ${row.year}, ${rw})`);
  console.log(`---- FACT SHEET\n${sheet.text}\n---- END SHEET`);
  const c = await composeReport(sheet, { surnames });
  if (c.usage) { tin += c.usage.input; tout += c.usage.output; }
  console.log(`---- REPORT (${c.status}, ${c.tries} tr${c.tries === 1 ? 'y' : 'ies'})${c.retryWhy ? ` first try refused: ${JSON.stringify(c.retryWhy)}` : ''}${c.failures ? ` FAILED: ${c.failures.join(' | ')}` : ''}`);
  console.log(c.text ? assemble(c.text, [], ratingLines(m, w, l, null)) : (c.rejected || c.detail || ''));
  console.log(`USAGE ${ek} ${JSON.stringify(c.usage)}`);
}
console.log(`\nSLAM-PROBE ${JSON.stringify({ input: tin, output: tout, usd: +((tin * 4 + tout * 20) / 1e6).toFixed(3) })}`);
