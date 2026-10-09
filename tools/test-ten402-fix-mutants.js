// TEN-402 lead review fixes (2026-10-08) — every check that locks a fix in test-ten402-b.mjs / test-ten402-c.mjs must FAIL
// when that fix is reverted. Each mutant is applied to a copy of bsp-consult-dashboard.html and both suites run against
// it (TEN402_HTML); a mutant that leaves them green is a vacuous test and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['fix 1: the bar tone follows the side again (A solid, B 70%)',
    "      tone: side === s ? 'var(--viz-white-lead)' : 'color-mix(in srgb, var(--viz-white-lead) 70%, transparent)' });",
    "      tone: s === 'a' ? 'var(--viz-white-lead)' : 'color-mix(in srgb, var(--viz-white-lead) 70%, transparent)' });"],
  ['fix 2: the Playing styles ledger back on the shard\'s oddsSelf / oddsOpp',
    "          h: q.price == null ? '—' : fhOdd(q.price), a: q.oppPrice == null ? '—' : fhOdd(q.oppPrice),",
    "          h: r.oddsSelf == null ? '—' : fhOdd(r.oddsSelf), a: r.oddsOpp == null ? '—' : fhOdd(r.oddsOpp),"],
  ['fix 2 / ruling 2026-10-08: the per-event model priced from the closes shard again',
    "  const P = trModelOf(hist, { ch, cl: null, px: trDbJoinPx(name, ch) }, k, name, clean, names, '', 'ready');",
    "  const P = trModelOf(hist, { ch, cl: _fhCl[k] }, k, name, clean, names, '', 'ready');"],
  ['fix 2: the join ignores the row\'s own opponent',
    '          if (!h2hTdSame(m.k, c.k)) return;\n', ''],
  ['fix 2: a full-name opponent ("Carlos Alcaraz") no longer joins',
    "    if (!t && toks.length > 1) return { s: fhNameKey(toks.slice(1).join(' ')), i: toks[0].replace(/[^A-Za-z]/g, '').charAt(0).toLowerCase(), loose: true, w: words(toks.slice(1).join(' ')) };\n", ''],
  ['r4 fix 2 (reverses R1 fix 3): the score cell back on one ellipsised line',
    '  #h2hRoot .h2hc-led .ma-row-score{ min-width:0; white-space:normal; overflow:visible; }',
    '  #h2hRoot .h2hc-led .ma-row-score{ min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }'],
  ['fix 4: the profit chart back on the shared date axis',
    'cChartModel(core, ser[0], ser[1], scope) : null,', 'core.chartModel(ser[0], ser[1], scope) : null,'],
  ['fix 4: the lines start under the Break even label again',
    '<div class="h2hc-lines" style="position:absolute; top:0; bottom:0; left:${C_BE_INSET}px; right:0;">',
    '<div class="h2hc-lines" style="position:absolute; top:0; bottom:0; left:0; right:0;">'],
  ['fix 5: the sheet\'s Dominance ratio card marks no better figure',
    "  const drBetter = typeof fhSheetTone === 'function' && fhSheetTone() === 'h2h' ? fhSheetBetter(", "  const drBetter = false ? fhSheetBetter("],
  ['fix 5: the better figure marked on every host (not only Head to Head)',
    "  const drBetter = typeof fhSheetTone === 'function' && fhSheetTone() === 'h2h' ? fhSheetBetter(", "  const drBetter = true ? fhSheetBetter("],
  ['fix 6: a season-finals group match back to "—"',
    "    return code === FH_DASHC && /\\bFinals\\b/i.test(String(tournament || '')) && !/Davis Cup/i.test(String(tournament || '')) ? 'RR' : code;",
    '    return code;'],
  ['fix 6: Davis Cup blanks guessed as RR',
    "    return code === FH_DASHC && /\\bFinals\\b/i.test(String(tournament || '')) && !/Davis Cup/i.test(String(tournament || '')) ? 'RR' : code;",
    "    return code === FH_DASHC && /\\bFinals\\b/i.test(String(tournament || '')) ? 'RR' : code;"],
  ['fix 6: the meeting rows no longer pass through h2hRoundOf', ' r.round = h2hRoundOf(r.round, x.tournament);', ''],
  // ---- review 2 (lead, 2026-10-08)
  // ---- R1 review (lead, 2026-10-09)
  ['R1 review: the memo compares the fresh market object again', 'mm.mkKey === mkKey && mm.md === tourxMarketData', 'mm.mk === mk'],
  ['R1 review: the info box loses the sfEventKey fallback', "|| (key ? cat.find(t => t.name === key) : null) || null;", '|| null;'],
  ['R1 review: the season finals read the knockout-only dates again', 'if (rr) dates = null;', ''],
  ['R1 review: the styles ledger retirement back to "0–0" (no dash)', "sets: m.ret ? '—' : m.pS + m.oS ? m.pS + '–' + m.oS : m.sets,", "sets: m.pS + m.oS ? m.pS + '–' + m.oS : m.sets,"],
  // ---- founder answer 3 (card 01102d24): retirement row display
  ['answer 3: a retirement row keeps its "0–0" sets', "sets: r.pS == null || r.ret ? '—' : r.pS + '–' + r.oS,", "sets: r.pS == null ? '—' : r.pS + '–' + r.oS,"],
  // ---- review 3 (lead, 2026-10-08)
  ['review 3: a start-dated row ranks the week before by unsigned distance again (Rio takes Buenos Aires)',
    'ad: dm >= 0 ? dm : H2H_PAGE_BEFORE_RANK - dm', 'ad: Math.abs(dm)'],
  ["review 3: the index files a name under its words only (\"O Connell C.\" never offered to C. O'Connell)",
    "function h2hTdIx(k) { return k.w.length > 1 ? k.w.concat(k.w.join('')) : k.w; }", 'function h2hTdIx(k) { return k.w; }'],
  ['review 2 item 1a: the Database rows no longer go to the career matches first (each ledger row joins alone)',
    '    M = h2hNearest(dbPairs(meet));', '    M = h2hNearest([]);'],
  ['review 2 item 1a: the ledgers no longer pass the career store',
    '      h2hPriceJoin(js, p, null, _h2hDb, null, career);', '      h2hPriceJoin(js, p, null, _h2hDb, null, null);'],
  ['review 2 item 1b: the archive\'s numbered rounds are not compared',
    "    return last && +k[1] <= last ? 'R' + 16 * Math.pow(2, last - +k[1]) : null;", '    return null;'],
  ['review 2 item 1c: a shard row reaches its career match only within the old 16 days',
    '  const H2H_PAGE_ROW_WINDOW = [-3, 24];', '  const H2H_PAGE_ROW_WINDOW = [-3, 16];'],
  ['review 2 item 1d: nearest-first takes the pairs in input order',
    '    const P = pairs.slice().sort((x, y) => x.ad - y.ad || x.l - y.l || x.r - y.r);', '    const P = pairs.slice();'],
  ['review 2: a start-dated career row joins on the match date again (Madrid / Rome 2011 swap: no start window, match-date rank)',
    "          if (m.ek ? dd < MW[0] || dd > MW[1] : dd < W[0] || dd > W[1] || (!m.row && (ds < SW[0] || ds > SW[1]))) return;\n          if (!h2hTdSame(m.k, c.k)) return;\n          // match day to match day; a start-dated career row start to start; a ledger row of unknown kind (step 3) its own date\n          out.push({ l: j, r: c.i, ad: Math.abs(m.ek || m.row ? dd : ds) });",
    "          if (m.ek ? dd < MW[0] || dd > MW[1] : dd < W[0] || dd > W[1]) return;\n          if (!h2hTdSame(m.k, c.k)) return;\n          out.push({ l: j, r: c.i, ad: Math.abs(dd) });"],
  ['review 2 item 3: no surname-tail rule (Mpetshi G. unjoined)',
    '    if (!k.i || !t.i || !k.w || !t.w || k.w.length === t.w.length) return false;', '    return false;'],
  ['review 2 item 3: a longer archive surname may END with ours (Lopez San Martin A. = A. Martin)',
    '    return k.w.join(\'\').length >= 4 && head(k.w, t.w);', '    return k.w.join(\'\').length >= 4 && (head(k.w, t.w) || tail(k.w, t.w));'],
  ['review 2 item 3: the initial no longer separates brothers',
    '    if (!k || !t || !k.s || !t.s || (k.i && t.i && k.i !== t.i)) return false;', '    if (!k || !t || !k.s || !t.s) return false;'],
  // ---- founder ruling 2026-10-08 (card 01102d24): one join, retirements settled on the ATP result
  ['ruling 2026-10-08: the join drops the retirements behind the store\'s flag (Cincinnati 2025 F a dash again)',
    '    return { rows: base.rows.concat(rr), names: nm.names.concat(rn), meta: base.meta, nDb: base.rows.length };',
    '    return { rows: base.rows, names: nm.names, meta: base.meta, nDb: base.rows.length };'],
  ['ruling 2026-10-08: the Backing tile counts only the completed rows (tile N ≠ the ledger\'s priced rows)',
    '    const np = P.priced.length, units = P.units;', '    const np = P.priced.filter(r => !r.ret).length, units = P.units;'],
  ['ruling 2026-10-08: the Tournament panel prices its rows a second time',
    "    const groups = shown.map(e2 => ({ title: e2.year, meta: e2.won + '–' + e2.lost, rows: e2.rows.map(r =>",
    "    h2hLedgerJoin(c.p, P.all, 'tour', r => r);\n    const groups = shown.map(e2 => ({ title: e2.year, meta: e2.won + '–' + e2.lost, rows: e2.rows.map(r =>"],
  ['ruling 2026-10-08: the Head to Head page stops exporting THE join',
    '    priceJoin: h2hPriceJoin,\n', ''],
  ['review 2 item 2: the profile sheet reuses the H2H page\'s state again',
    '  const st = _fh && !(_fh.m && _fh.m.h2hPage) ? _fh : fhStateFor({ pp2: true, key: x.subjectKey });',
    '  const st = _fh || fhStateFor({ pp2: true, key: x.subjectKey });'],
  ['review 2 item 6: the bright bar back on the longer bar',
    "  const aCol = better ? (better === 'a' ? BAR : BAR2) : aW != null && bW != null && aW < bW ? BAR2 : BAR;\n  const bCol = better ? (better === 'b' ? BAR : BAR2) : aW != null && bW != null && bW < aW ? BAR2 : BAR;",
    '  const aCol = aW != null && bW != null && aW < bW ? BAR2 : BAR, bCol = aW != null && bW != null && bW < aW ? BAR2 : BAR;'],
  ['review 2 item 6: the site\'s lower-is-better list not read',
    "  return (typeof MATCH_STAT_ORDER !== 'undefined' ? MATCH_STAT_ORDER : []).some(", '  return [].some('],
  // ---- founder round 1 (2026-10-09), builder X: fixes 1, 2, 6 (test-ten402-r1x.mjs, test-ten402-a.mjs)
  ['r1 fix 1: Last played takes the first edition in the list again',
    '  ((P && P.eds) || []).forEach(e => { if ((e.rows || []).length && (!best || (+e.year || 0) > (+best.year || 0))) best = e; });',
    '  ((P && P.eds) || []).forEach(e => { if ((e.rows || []).length && !best) best = e; });'],
  ['r1 fix 1: the Head to Head tile reads the list position again',
    '    const lp = trLastPlayed(P), lr = lp ? lp.row : null;',
    '    const lp = P.played.length ? { year: P.played[0].year, row: P.played[0].rows[0] } : null, lr = lp ? lp.row : null;'],
  ['r1 fix 2: sfEventName prints the cleaned feed name again',
    '  return k ? (SF_EVENT_NAMES[k] || k) : fhTournClean(raw);', '  return fhTournClean(raw);'],
  ['r1 fix 2: the archive / profile spellings are not folded through TournamentIdentity',
    '  if (TI && TI.canonicalTournament) cands.push(TI.canonicalTournament(s).display);\n', ''],
  ['r1 fix 2: the Playing styles group headers keep the shard\'s own name',
    "    const nm = r.tournament ? (typeof sfEventName === 'function' ? sfEventName(r.tournament) : r.tournament) : '—';",
    "    const nm = r.tournament || '—';"],
  ['r1 fix 2: a printed name loses its tier meta',
    '  return PS_TOUR_META[psNormTour(name)] || (rk && PS_TOUR_META[psNormTour(rk)]) || null;', '  return PS_TOUR_META[psNormTour(name)] || null;'],
  ['r1 fix 2: a printed name loses its hot-line code (Monte-Carlo Masters → MON)',
    '  return FH_TCODE[k] || (rk && FH_TCODE[psNormTour(rk)]) || fhTournClean', '  return FH_TCODE[k] || fhTournClean'],
  ['r1 fix 6: the chips ignore this week\'s events (Beijing / Tokyo finals of Mon 5 Oct back)',
    "      if (!wkSet.has(wkKey(String(m.tour || '').replace(/^ATP\\s+/i, '')))) return;   // fix 6: one of this week's events\n", ''],
  ['r1 fix 6: the week set is not the Entry list\'s rule',
    "    const wkFn = fn('tourxThisWeekEvents'), wk = wkFn ? wkFn() : null;", "    const wkFn = null, wk = [{ name: 'Beijing' }, { name: 'Tokyo' }, { name: 'Shanghai' }];"],
];
const SUITES = ['test-ten402-a.mjs', 'test-ten402-b.mjs', 'test-ten402-c.mjs', 'test-ten402-r1x.mjs', 'test-ten402-lead.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
// Control: the unmutated page must pass, or every "caught" below means nothing.
if (run({}).status !== 0) { console.error('✖ the suites are red on the unmutated page — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated page passes');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten402fix-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, to));
  if (run({ TEN402_HTML: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
