// Founder ruling 2026-10-25 (the 13 Apr - 16 Sep fill, item 2): every buffer-cut fill price is marked on screen like the
// Bet365 "B" — the letter "E", tooltip "Pinnacle price ≥X min before scheduled start; true close unavailable" — carried end to
// end with the REAL code at every step (never a copy of a rule):
//   tools/pinarch.py export_rows → feed_label / td_feed_rows ('early cut 71')  →  build-database-yield.js (book 9, meta.earlyCut,
//   the master's book code)  →  the page's Database price join (h2hPriceJoin: 'A' + 'early' + the hover)  →  fhPxMark / fhSrcTitle /
//   fhPriceCell (the "E" and its tooltip), plus every hMark site that drew "B" now draws through fhPxMark.
// Each step has a control that must go the other way (a Bet365 row still "B", a start − 10 row unmarked, two buffers refused).
// Run: node tools/test-early-cut-marker.mjs   (no network; a temp dir for the builder)
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.EARLY_ROOT || join(HERE, '..');
const html = readFileSync(join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  PASS  ' + name); } catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n')[0]); } };

function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
const constLine = name => {
  const m = new RegExp(`^\\s*const ${name} = [^\\n]*$`, 'm').exec(html);
  assert.ok(m, `const ${name} not found`);
  return m[0].replace(/\/\/[^'\n]*$/, '');
};
const HOVER = "Early Pinnacle price — taken 71–131 min before Oddspapi's recorded start. True closing price unavailable.";

// ── 1. pinarch: export → td-feed (python, the real functions) ─────────────────────────────────────────────────────────
const py = String.raw`
import importlib.util, json, sys, os
s = importlib.util.spec_from_file_location('pinarch', os.path.join(sys.argv[1], 'tools', 'pinarch.py')); P = importlib.util.module_from_spec(s); s.loader.exec_module(P)
base = {'label': P.ARCHIVE_LABEL, 'p1_key': 1, 'p2_key': 2, 'source': 's', 'book': 'Pinnacle +30s', 'supersedes': None}
rows = [dict(base, id=10, event_key=50, match_date='2026-06-01', p1_name='A. Alpha', p2_name='B. Beta', p1=1.62, p2=2.35,
             start_source=P.FILL_START_SOURCE, detail={'closeCut': 'trueStart-buffer', 'bufferMin': int(sys.argv[2]), 'tier': 'ATP'}),
        dict(base, id=11, event_key=51, match_date='2026-06-03', p1_name='A. Alpha', p2_name='D. Delta', p1=1.30, p2=3.60,
             start_source=P.FILL_START_SOURCE, detail={'closeCut': 'trueStart-buffer', 'bufferMin': int(sys.argv[3]), 'tier': 'ATP'})]
ex = P.export_rows(rows)
td = [{'date': '2026-06-01', 'tournament': 'X Open', 'series': 'ATP250', 'court': 'Outdoor', 'surface': 'Hard', 'round': '1st Round', 'bestof': '3',
       'winner': 'Alpha A.', 'loser': 'Beta B.', 'comment': 'Completed', 'psw': '', 'psl': ''},
      {'date': '2026-06-03', 'tournament': 'X Open', 'series': 'ATP250', 'court': 'Outdoor', 'surface': 'Hard', 'round': '2nd Round', 'bestof': '3',
       'winner': 'Alpha A.', 'loser': 'Delta D.', 'comment': 'Completed', 'psw': '', 'psl': ''}]
fr, rep = P.td_feed_rows(ex, td, {}, '2025-12-31')
print(json.dumps({'export': ex, 'feed': fr, 'cols': P.FEED_COLS}))`;
const feedOf = (x1, x2) => JSON.parse(execFileSync('python3', ['-B', '-c', py, ROOT, String(x1), String(x2)], { encoding: 'utf8' }));
const F1 = feedOf(71, 71);
check('export: the fill row carries closeCut + bufferMin', () => {
  assert.deepEqual(F1.export.map(r => [r.closeCut, r.bufferMin]), [['trueStart-buffer', 71], ['trueStart-buffer', 71]]);
});
check('td-feed: the Tennis-Data row with no Pinnacle pair takes the fill price, labelled "early cut 71"', () => {
  assert.deepEqual(F1.feed.map(r => [r.kind, r.label, r.psw, r.psl]), [['override', 'early cut 71', 1.62, 2.35], ['override', 'early cut 71', 1.30, 3.60]]);
});

// ── 2. build-database-yield.js on that feed (the real builder, a temp dir) ────────────────────────────────────────────
const TD_HEAD = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
function build(feed) {
  const d = mkdtempSync(join(tmpdir(), 'early-'));
  for (const f of ['build-database-yield.js', 'settlement.js', 'td-identity.js', 'build-odds-performance.js', 'market-edge-core.js']) copyFileSync(join(ROOT, f), join(d, f));
  mkdirSync(join(d, 'odds-archive'));
  writeFileSync(join(d, 'odds-archive', '2026.csv'), [TD_HEAD,
    '2026-06-01,X Open,ATP250,Outdoor,Hard,1st Round,3,Alpha A.,Beta B.,10,20,Completed,1.5,2.5,,,,,,,file',
    '2026-04-02,X Open,ATP250,Outdoor,Hard,1st Round,3,Alpha A.,Gamma G.,10,30,Completed,1.4,2.8,,,,,,,file',   // Bet365 only, inside Jan–Apr 2026 (founder 2026-10-26)
    '2026-06-03,X Open,ATP250,Outdoor,Hard,2nd Round,3,Alpha A.,Delta D.,10,40,Completed,1.25,3.9,,,,,,,file'].join('\n') + '\n');
  writeFileSync(join(d, 'feed.csv'), [feed.cols.join(','), ...feed.feed.map(r => feed.cols.map(k => r[k] ?? '').join(','))].join('\n') + '\n');
  const r = spawnSync(process.execPath, ['build-database-yield.js'], { cwd: d, encoding: 'utf8', env: { ...process.env, DB_YIELD_FEED: join(d, 'feed.csv') } });
  const out = r.status === 0 ? { db: JSON.parse(readFileSync(join(d, 'database-yield.json'), 'utf8')), names: JSON.parse(readFileSync(join(d, 'database-yield-players.json'), 'utf8')),
    master: JSON.parse(readFileSync(join(d, 'database-yield-master.json'), 'utf8')) } : null;
  rmSync(d, { recursive: true, force: true });
  return { status: r.status, err: r.stderr, ...out };
}
const B1 = build(F1);
check('builder: the early-cut rows are book 9 (Database rows), the Bet365-only row stays book 1', () => {
  assert.equal(B1.status, 0, B1.err);
  assert.deepEqual(B1.db.rows.map(r => [r[0], r[8]]), [[20260601, 9], [20260402, 1], [20260603, 9]]);
});
check('builder: meta.earlyCut names book 9, the 71 min, the mark and the founder\'s exact tooltip', () => {
  assert.deepEqual([B1.db.meta.earlyCut.book, B1.db.meta.earlyCut.minutes, B1.db.meta.earlyCut.mark, B1.db.meta.earlyCut.hover], [9, 71, 'E', HOVER]);
});
check('builder: never counted as a Pinnacle close (its own book count; Pinnacle yields leave it out)', () => {
  assert.equal(B1.db.meta.archiveFeed.rowsByLabel['early cut 71'], 2);
  assert.equal(B1.db.meta.archiveFeed.rowsByLabel['from Pinnacle history'], 0);
  assert.deepEqual([B1.db.meta.yieldOverall.all.n, B1.db.meta.yieldOverall.Pinnacle.n, B1.db.meta.yieldOverall.Bet365.n], [3, 0, 1]);
});
check('master: book 9 rows, its code named, the same earlyCut meta', () => {
  const ci = B1.master.meta.cols.indexOf('book');
  assert.deepEqual(B1.master.rows.map(r => r[ci]).sort(), [1, 9, 9]);
  assert.equal(B1.master.meta.bookCodes[9], 'Pinnacle early cut (not a close)');
  assert.equal(B1.master.meta.earlyCut.hover, HOVER);
});
const B2 = build(feedOf(71, 12));
check('builder: two different buffers in one feed are refused (the tooltip could only be right for one)', () => {
  assert.equal(B2.status, 1); assert.match(B2.err, /different buffers/);
});

// ── 3. the page: the real join + the real marker / hover / cell ───────────────────────────────────────────────────────
const fhDayNum = new Function(`${slice('fhDayNum')}\nreturn fhDayNum;`)();
const JOIN_SRC = `const FH_DASHC = '—';\n${['H2H_PAGE_PRICE_WINDOW', 'H2H_PAGE_MATCH_WINDOW', 'H2H_PAGE_START_WINDOW', 'H2H_PAGE_ROW_WINDOW', 'H2H_TD_ROUND', 'H2H_PAGE_BEFORE_RANK'].map(constLine).join('\n')}
${['fhIsInitial', 'fhNameKey', 'psRoundAbbr', 'h2hRoundLabel', 'fhRoundCode', 'h2hTdIx', 'h2hTdKey', 'h2hTdSame', 'h2hTdRound', 'h2hTdEvent', 'h2hNearest', 'h2hPriceJoin'].map(slice).join('\n')}`;
globalThis.FH_SRC = { td: 'Tennis-Data', cap: 'captured', hist: 'from Pinnacle history' };
const priceJoin = new Function('fhDayNum', `${JOIN_SRC}\nreturn h2hPriceJoin;`)(fhDayNum);
const dbPriceJoinRows = new Function(`${slice('dbPriceJoinRows')}\nreturn dbPriceJoinRows;`)();
const UI = new Function(`const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
${['FH_MONO', 'FH_DASHC', 'FH_BOOK', 'SF_APPROX_HOVER', 'SF_OD10_HOVER', 'SF_TE_HOVER', 'SF_EARLY_HOVER_NO_X', 'FH_SRC', 'FH_B365_APPROX_HOVER', 'FH_B365_AT_HOVER'].map(constLine).join('\n')}
const FH_DASH = 'var(--text-label)';
${['fhEsc', 'fhPxMark', 'fhB365Approx', 'fhSrcTitle', 'fhPriceCell'].map(slice).join('\n')}
return { fhPxMark, fhSrcTitle, fhPriceCell };`)();
const J = B1.status === 0 ? dbPriceJoinRows(B1.db, B1.names) : null;
const view = (date, opp) => { const v = [{ date, won: true, round: null }]; priceJoin(v, { full: 'A. Alpha' }, { full: opp }, J); return v[0]; };
check('join: the early-cut meeting = Pinnacle (approx.) "A", source "early", the hover from the build', () => {
  const v = view('2026-06-01', 'B. Beta');
  assert.deepEqual([v.price, v.oppPrice, v.book, v.src, v.srcLabel], [1.62, 2.35, 'A', 'early', HOVER]);
});
check('render: the early cut draws "E" with the founder\'s tooltip; Bet365 still "B" (control); a start − 10 snapshot no mark (control)', () => {
  const e = view('2026-06-01', 'B. Beta'), b = view('2026-04-02', 'G. Gamma');
  assert.equal(UI.fhPxMark(e), 'E'); assert.equal(UI.fhSrcTitle(e), HOVER);
  assert.equal(b.book, 'B'); assert.equal(UI.fhPxMark(b), 'B');
  assert.equal(UI.fhPxMark({ price: 1.5, book: 'A', src: 'od10' }), '');
  assert.equal(UI.fhPxMark({ price: null, book: 'A', src: 'early' }), '', 'a dash carries no mark');
  const cell = UI.fhPriceCell(e.price, 'right', false, e, true);
  assert.match(cell, /class="fh-bmark"[^>]*>E<\/span>/); assert.ok(cell.includes(`title="${HOVER.replace(/&/g, '&amp;')}"`) || cell.includes('title="Pinnacle price ≥71'));
  assert.match(UI.fhPriceCell(b.price, 'right', false, b, true), /class="fh-bmark"[^>]*>B<\/span>/);
});
check('render: before the join answers, the tooltip never guesses an X', () => {
  assert.equal(UI.fhSrcTitle({ price: 1.6, book: 'A', src: 'early' }), "Early Pinnacle price — taken before Oddspapi's recorded start. True closing price unavailable.");
});
check('every "B" marker site now draws through fhPxMark (Form, H2H tab, Tournament, Head to Head page, price cell)', () => {
  const old = html.match(/hMark: r\.price != null && r\.book === 'B' \? 'B' : ''/g) || [];
  assert.equal(old.length, 0, 'no hMark site keeps the B-only expression');
  assert.equal((html.match(/hMark: fhPxMark\(r\)/g) || []).length, 3);
  assert.equal((html.match(/hMark: typeof fhPxMark === 'function' \? fhPxMark\(r\)/g) || []).length, 1);
  assert.match(slice('fhPriceCell'), /fhPxMark\(r\)/);
  assert.match(html, /if \(bk === 9\) \{ r\.book = 'A'; r\.src = 'early'; r\.srcLabel = /);
});
check('Market edge / profile book ids: the early cut is its own id, never "pinnacle-approx"', () => {
  assert.match(html, /'pinnacle-early': \['A', 'early'\]/);
  assert.equal((html.match(/r\.src === 'early' \? 'pinnacle-early' : 'pinnacle-approx'/g) || []).length, 2);
  assert.match(readFileSync(join(ROOT, 'build-market-edge.js'), 'utf8'), /9: \['pinnacle-early', /);
});

console.log(`\ntest-early-cut-marker: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
