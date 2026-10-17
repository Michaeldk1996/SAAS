// Founder ruling 2026-10-16 (ruling 1): "Pinnacle (approx.)" for 13 Jan – 16 Sep 2026 ATP main draw = api-tennis's stored
// Pinnacle price, a SNAPSHOT. Every surface that names the book of a Database-join price must call it that, with the ruled
// hover, and never read it as Pinnacle or Bet365 — runs the page's own functions (sliced from the shipped HTML) and the
// real builder on a synthetic feed. Each check is paired with the mutation it must catch.
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log('  PASS ', name); } else { failed++; console.log('  FAIL ', name, '\n       ', String(detail).slice(-400)); } };
function fn(src, name) {
  const re = new RegExp(`\\n\\s*function ${name}\\s*\\(`); const m = re.exec(src); if (!m) throw new Error('no function ' + name);
  let i = src.indexOf('{', m.index), d = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(m.index, j + 1); }
}
const constLine = (src, name) => { const i = src.indexOf('const ' + name + ' '); return src.slice(i, src.indexOf('\n', i)); };
const HOVER = 'Pinnacle snapshot from api-tennis, no timestamp, not a confirmed close';

// the shared constants + source titles (Tournament tab, profile, sheets)
const C = new Function(`${constLine(html, 'FH_BOOK')}\n${constLine(html, 'FH_SRC')}\n${constLine(html, 'SF_APPROX_HOVER')}\n${fn(html, 'fhSrcTitle')}\n${fn(html, 'fhSourceNote')}
  return { FH_BOOK, SF_APPROX_HOVER, fhSrcTitle, fhSourceNote };`)();
check('the hover is the ruled words', C.SF_APPROX_HOVER === HOVER);
check('a Pinnacle (approx.) price hovers "Pinnacle (approx.) · <ruled words>" — never "Pinnacle close"',
  C.fhSrcTitle({ book: 'A', src: 'td' }) === 'Pinnacle (approx.) · ' + HOVER && !/close ·/.test(C.fhSrcTitle({ book: 'A', src: 'td' })));
check('control: a Pinnacle / Bet365 close keeps its words', C.fhSrcTitle({ book: 'P', src: 'td' }) === 'Pinnacle close · Tennis-Data' && C.fhSrcTitle({ book: 'B', src: 'td' }) === 'Bet365 close · Tennis-Data');
check('the source note names the snapshot with its count, never folds it into "Pinnacle"',
  C.fhSourceNote([{ book: 'P' }, { book: 'A' }, { book: 'A' }, { book: 'B' }]) === 'Pinnacle, Pinnacle (approx.) snapshot where no close (2), Bet365 where missing (1)');
check('control: without a snapshot the note is unchanged', C.fhSourceNote([{ book: 'P' }, { book: 'B' }]) === 'Pinnacle, Bet365 where missing (1)' && C.fhSourceNote([{ book: 'P' }]) === 'Pinnacle');

// the one join: book 2 → 'A'
const join2 = /r\.book = bk === 0 \|\| bk === 3 \|\| bk === 4 \? 'P' : bk === 2 \? 'A' : 'B';/.test(html);
check('the price join maps the store\'s book 2 to "A" (never "B" or "P") and 3 / 4 (our archive) to "P"', join2);
// founder 2026-10-16 (round 3, item 1): our archive's closes carry their own source on every surface, never "Tennis-Data"
const join34 = /r\.src = bk === 3 \? 'hist' : bk === 4 \? 'cap' : 'td'; r\.srcLabel = bk === 3 \? FH_SRC\.hist : bk === 4 \? FH_SRC\.cap : undefined;/.test(html);
check('the price join gives our archive\'s closes their own source: 3 → "from Pinnacle history", 4 → "captured"', join34);
check('a Tournament-tab / sheet price from Pinnacle history reads "Pinnacle close · from Pinnacle history", a captured one "· captured"',
  C.fhSrcTitle({ book: 'P', src: 'hist', srcLabel: 'from Pinnacle history' }) === 'Pinnacle close · from Pinnacle history'
  && C.fhSrcTitle({ book: 'P', src: 'hist' }) === 'Pinnacle close · from Pinnacle history'
  && C.fhSrcTitle({ book: 'P', src: 'cap', srcLabel: 'captured' }) === 'Pinnacle close · captured');
check('trDbJoinPx passes the join\'s own source on (the Tournament tab printed every join price as Tennis-Data)',
  /r\.src = ok \? \(x\.src \|\| 'td'\) : null;\s*r\.srcLabel = ok \? x\.srcLabel : undefined;/.test(fn(html, 'trDbJoinPx')));
check('the profile hands its sheet the archive\'s source (pinnacle-history → P / hist)',
  /r\.src === 'hist' \? 'pinnacle-history' : r\.src === 'cap' \? 'pinnacle-capture'/.test(fn(html, 'trProfilePriceOf'))
  && /'pinnacle-history': \['P', 'hist'\]/.test(readFileSync(join(ROOT, 'player-profile-v2.js'), 'utf8')));

// founder 2026-10-16 (round 3, item 1): the Player Profile's Record per tournament prices hover their one source,
// through the host's fhSrcTitle — run the module's own pxSrcHtml on the page's own words
{
  const pp = readFileSync(join(ROOT, 'player-profile-v2.js'), 'utf8');
  const sbI = pp.indexOf('var SHEET_BOOK = {'), sb = pp.slice(sbI, pp.indexOf('};', sbI) + 2);
  const mk = (src) => new Function('window', `var DASH = '—'; function esc(s){ return String(s); }\n${fn(src, 'oddsText')}\n${sb}\n${fn(src, 'pxSrcHtml')}\nreturn pxSrcHtml;`)({ fhSrcTitle: C.fhSrcTitle });
  const px = mk(pp);
  check('profile: a Record per tournament price from Pinnacle history hovers "Pinnacle close · from Pinnacle history"',
    px({ book: 'pinnacle-history' }, 1.5) === '<span data-pp2-px-src="1" title="Pinnacle close · from Pinnacle history">1.50</span>', px({ book: 'pinnacle-history' }, 1.5));
  check('profile: captured / Tennis-Data / approx / Bet365 each hover their own source; no price = the plain dash',
    /title="Pinnacle close · captured"/.test(px({ book: 'pinnacle-capture' }, 1.5)) && /title="Pinnacle close · Tennis-Data"/.test(px({ book: 'pinnacle' }, 1.5))
    && px({ book: 'pinnacle-approx' }, 1.5).includes('Pinnacle (approx.) · ' + HOVER) && /title="Bet365 close · Tennis-Data"/.test(px({ book: 'bet365-archive' }, 1.5))
    && px({ book: 'pinnacle' }, null) === '—');
  check('profile: both price cells of a Record per tournament row print through pxSrcHtml', (pp.match(/pxAfterHtml\(m, t\) \|\| pxSrcHtml\(m, m\.(price|oppPrice)\)/g) || []).length === 2);
  check('control: the Database join\'s Bet365 reaches the profile as Tennis-Data\'s (bet365-archive), never the ledger capture',
    /r\.book === 'B' \? 'bet365-archive'/.test(fn(html, 'trProfilePriceOf')));
}

// Head to Head ledgers: hover + footnote
const h2h = html.slice(html.indexOf('function h2hPxNote('), html.indexOf('function h2hPriceTitle(') + 2000);
const H = new Function('SF_APPROX_HOVER', `const E = s => String(s); let _h2hDbSt = 'ready'; ${constLine(html, 'FH_B365_HOVER')}\n${constLine(html, 'H2H_PX_NOTE')}\n${fn('\n' + h2h, 'h2hPxNote')}\n${fn('\n' + h2h, 'h2hPriceTitle')}
  return { h2hPxNote, h2hPriceTitle };`)(HOVER);
check('a Head to Head ledger price on the snapshot hovers the ruled words', H.h2hPriceTitle({ price: 1.8, book: 'A' }) === 'Pinnacle (approx.) · ' + HOVER);
check('a Head to Head ledger price from our archive names it: "Pinnacle closing price · from Pinnacle history" / "· captured"',
  H.h2hPriceTitle({ price: 1.8, book: 'P', src: 'hist', srcLabel: 'from Pinnacle history' }) === 'Pinnacle closing price · from Pinnacle history'
  && H.h2hPriceTitle({ price: 1.8, book: 'P', src: 'cap', srcLabel: 'captured' }) === 'Pinnacle closing price · captured');
check('control: a Tennis-Data Pinnacle ledger price still names Tennis-Data', H.h2hPriceTitle({ price: 1.8, book: 'P', src: 'td' }) === 'Pinnacle closing price · Database join (Tennis-Data)');
check('control: a Bet365 / Pinnacle ledger price keeps its words (TEN-437 Bet365 hover)', H.h2hPriceTitle({ price: 1.8, book: 'B' }) === 'Bet365 closing odds, Pinnacle not available' && /^Pinnacle closing price/.test(H.h2hPriceTitle({ price: 1.8, book: 'P' })));
check('a ledger holding snapshot prices says so in its footnote, with the count',
  /Closing price · Pinnacle, else Bet365 · Pinnacle \(approx\.\) on 2: a snapshot, not a confirmed close/.test(H.h2hPxNote('', [{ price: 1.5, book: 'A' }, { price: 2, book: 'A' }, { price: 2, book: 'P' }])));
check('control: a ledger without one keeps the plain footnote', />Closing price · Pinnacle, else Bet365</.test(H.h2hPxNote('', [{ price: 2, book: 'P' }])));

// Founder 2026-10-16: each price gets exactly ONE hover, matching its source — a Pinnacle (approx.) price never shows
// TEN-437's Bet365 hover, on any surface (tab rows, tags, sheet meta, the H2H page, the Tournament tab).
const B365H = 'Bet365 closing odds, Pinnacle not available';
const hoverSrc = src => new Function(`${constLine(src, 'FH_BOOK')}\n${constLine(src, 'FH_SRC')}\n${constLine(src, 'SF_APPROX_HOVER')}\n${constLine(src, 'FH_B365_HOVER')}
  const FH_MONO = ''; let _h2hDbSt = 'ready';
  ${fn(src, 'fhSrcTitle')}\n${fn(src, 'fhH2hSrcTitle')}\n${fn(src, 'fhB365Tag')}\n${fn(src, 'fhB365Meta')}\n${fn(src, 'trPxTitle')}
  ${fn('\n' + src.slice(src.indexOf('function h2hPriceTitle(')), 'h2hPriceTitle')}
  function trPxAfterTitle(){ return 'after'; }
  return { fhSrcTitle, fhH2hSrcTitle, fhB365Tag, fhB365Meta, trPxTitle, h2hPriceTitle };`)();
const oneHover = src => {
  const F = hoverSrc(src), A = { price: 1.8, oppPrice: 2.1, book: 'A', src: 'td' }, B = { price: 1.8, oppPrice: 2.1, book: 'B', src: 'td' };
  const titles = [F.fhSrcTitle(A), F.fhH2hSrcTitle(A), F.trPxTitle(A), F.h2hPriceTitle(A)];
  const tags = F.fhB365Tag(A, true) + F.fhB365Tag(A, false) + F.fhB365Meta(A);
  const marks = [...src.matchAll(/hMark: r\.price != null && r\.book === '([A-Z])' \? '([A-Z])' : ''/g)].map(m => m[1] + m[2]);
  return { ok: titles.every(t => t === 'Pinnacle (approx.) · ' + HOVER) && tags === '' && marks.length >= 4 && marks.every(m => m === 'BB')
    && F.fhH2hSrcTitle(B) === B365H && F.h2hPriceTitle(B) === B365H, titles, tags, marks };
};
const oh = oneHover(html);
check('one hover per price: a Pinnacle (approx.) price reads only the snapshot hover on every surface — never the Bet365 hover, no B mark, no B365 tag',
  oh.ok, JSON.stringify(oh));
const ohMut = oneHover(html.replace("function fhH2hSrcTitle(r){ return r && r.book === 'B' ?", "function fhH2hSrcTitle(r){ return r && r.book !== 'P' ?"));
check('control: an H2H hover that treats any non-Pinnacle book as Bet365 is caught', !ohMut.ok);
const ohMut2 = oneHover(html.replace("if (r.price != null && r.book === 'A') return 'Pinnacle (approx.) · ' + SF_APPROX_HOVER;\n", ''));
check('control: the H2H page dropping its snapshot branch is caught', !ohMut2.ok);

// Series: the cell title
const ser = readFileSync(join(ROOT, 'series.js'), 'utf8');
check('Series names book A "Pinnacle (approx.)" and its title is the ruled words, not "… closing"',
  /BOOK_NAME = \{ P: 'Pinnacle', B: 'bet365', A: 'Pinnacle \(approx\.\)' \}/.test(ser) && /r\.book === BOOK_NAME\.A \? r\.book \+ ' · ' \+ \(window\.SF_APPROX_HOVER/.test(ser));

// Database page: per-book sums take book 2 (no crash), the footnote names it with its count
const agg = new Function(`function median(a){ return a.length ? a[a.length >> 1] : null; }\n${fn(html, 'agg')}\nreturn agg;`)();
const a = agg([{ p: 1.5, w: 1, b: 0 }, { p: 1.6, w: 0, b: 2 }, { p: 1.7, w: 1, b: 1 }]);
check('the Database\'s per-book sums take book 2 as its own book (ap), never Bet365', a.book.ap && a.book.ap.n === 1 && a.book.b365.n === 1 && a.book.ps.n === 1);
const agg2 = new Function(`function median(a){ return a.length ? a[a.length >> 1] : null; }\n${fn(html, 'agg')}\nreturn agg;`)();
const a34 = agg2([{ p: 1.5, w: 1, b: 0 }, { p: 1.6, w: 0, b: 3 }, { p: 1.7, w: 1, b: 4 }, { p: 1.8, w: 1, b: 1 }]);
check('the Database counts our archive\'s closes (3 / 4) as Pinnacle in every figure (prices unchanged)',
  a34.book.ps && a34.book.ps.n === 3 && a34.book.b365.n === 1 && !a34.book.ap, JSON.stringify(a34.book));
const fo = ['el', 'esc', 'fmtInt', 'dbApproxN', 'dbApproxHover'].map(f => fn(html, f)).join('\n');
const paintFoot = M => {
  const parts = []; const doc = { createElement: () => ({ set innerHTML(v) { parts.push(v); }, appendChild() {}, className: '' }) };
  const body = { appendChild() {} };
  new Function('document', 'M', 'window', `${fo}\nfunction fmtDate(d){ return d; }\n${fn(html, 'renderFootnote')}\nrenderFootnote(arguments[3]);`)(doc, M, { SF_APPROX_HOVER: HOVER }, body);
  return parts.join(' ');
};
const M0 = { dateRange: ['2010-01-04', '2026-10-15'], books: ['Pinnacle', 'Bet365'], pinnacleLastPriced: '2026-01-13', used: 41000, archiveRows: 60000, windowStart: 2010,
  bookCounts: { Pinnacle: 38830, Bet365: 2170 }, exclusions: { preWindow: 1, noResolvingBookPrice: 1, walkover: 1, retired: 1, exactTie: 1, edge: 1, overroundGt115: 1 } };
const f1 = paintFoot({ ...M0, books: ['Pinnacle', 'Bet365', 'Pinnacle (approx.)'], bookCounts: { ...M0.bookCounts, 'Pinnacle (approx.)': 752 }, approx: { hover: HOVER } });
check('the footnote names the snapshot rows with their count and the ruled words', /and 752 on Pinnacle \(approx\.\) — Pinnacle snapshot from api-tennis, no timestamp, not a confirmed close/.test(f1), f1.slice(0, 900));
const f0 = paintFoot(M0);
check('control: a store without snapshot rows paints the footnote as before', !/approx/.test(f0) && /38,830 priced on Pinnacle and 2,170 on Bet365 \(where Pinnacle has no price\)\./.test(f0), f0.slice(0, 900));

// the real builder on a synthetic feed: order Tennis-Data Pinnacle > archive close > snapshot > Bet365
const d = mkdtempSync(join(tmpdir(), 'approx-'));
mkdirSync(join(d, 'odds-archive'));
for (const f of ['build-database-yield.js', 'build-odds-performance.js']) copyFileSync(join(ROOT, f), join(d, f));
const H26 = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl\n';
writeFileSync(join(d, 'odds-archive', '2026.csv'), H26 + [
  '2026-01-13,Adelaide International,ATP250,Outdoor,Hard,1st Round,3,Pin P.,Ned N.,1,2,Completed,1.5,2.6,1.55,2.62',   // TD Pinnacle: kept
  '2026-02-03,Dallas Open,ATP500,Indoor,Hard,1st Round,3,Snap S.,Shot S.,1,2,Completed,1.5,2.6,,',                       // snapshot
  '2026-02-04,Dallas Open,ATP500,Indoor,Hard,1st Round,3,Arch A.,Ive I.,1,2,Completed,1.5,2.6,,',                        // archive close first
  '2026-02-05,Dallas Open,ATP500,Indoor,Hard,1st Round,3,Bet B.,Three T.,1,2,Completed,1.5,2.6,,',                       // no snapshot: Bet365
  '2026-02-06,Dallas Open,ATP500,Indoor,Hard,1st Round,3,Cap C.,Ture T.,1,2,Completed,1.5,2.6,,',                        // our captured close
].join('\n') + '\n');
writeFileSync(join(d, 'approx.csv'), 'date,tournament,winner,loser,psw,psl,eventKey,snapshotId\n' +
  '2026-01-13,Adelaide International,Pin P.,Ned N.,1.4,2.9,1,1\n2026-02-03,Dallas Open,Snap S.,Shot S.,1.45,2.75,2,2\n2026-02-04,Dallas Open,Arch A.,Ive I.,1.45,2.75,3,3\n');
writeFileSync(join(d, 'feed.csv'), 'kind,date,tournament,series,court,surface,round,bestof,winner,loser,comment,psw,psl,archiveId,label,eventKey\n' +
  'override,2026-02-04,Dallas Open,,,,,,Arch A.,Ive I.,,1.48,2.7,9,from Pinnacle history,9\n' +
  'override,2026-02-06,Dallas Open,,,,,,Cap C.,Ture T.,,1.47,2.72,10,captured,10\n');
const run = env => { execFileSync('node', ['build-database-yield.js'], { cwd: d, env: { ...process.env, ...env }, stdio: 'pipe' });
  const b = JSON.parse(readFileSync(join(d, 'database-yield.json'), 'utf8')), n = JSON.parse(readFileSync(join(d, 'database-yield-players.json'), 'utf8'));
  return Object.fromEntries(b.rows.map((r, i) => [n.names[i][0], [r[8], r[5], r[6]]])); };
const R = run({ DB_YIELD_APPROX: join(d, 'approx.csv'), DB_YIELD_FEED: join(d, 'feed.csv') });
check('builder: a Tennis-Data Pinnacle close is never replaced by a snapshot', JSON.stringify(R['Pin P.']) === JSON.stringify([0, 1.55, 2.62]), R['Pin P.']);
check('builder: our archive\'s close outranks the snapshot, under its own code (3 = from Pinnacle history)', JSON.stringify(R['Arch A.']) === JSON.stringify([3, 1.48, 2.7]), R['Arch A.']);
check('builder: a captured close from our archive is code 4, at its own price', JSON.stringify(R['Cap C.']) === JSON.stringify([4, 1.47, 2.72]), R['Cap C.']);
const MB = JSON.parse(readFileSync(join(d, 'database-yield.json'), 'utf8')).meta;
check('builder: the Pinnacle count includes our archive\'s closes (no figure moves), and meta names each label',
  MB.bookCounts.Pinnacle === 3 && MB.archiveFeed.rowsByLabel['from Pinnacle history'] === 1 && MB.archiveFeed.rowsByLabel.captured === 1, JSON.stringify(MB.bookCounts));
check('builder: no Pinnacle close → the snapshot, book 2', JSON.stringify(R['Snap S.']) === JSON.stringify([2, 1.45, 2.75]), R['Snap S.']);
check('builder: no snapshot → Bet365 stays the fallback', JSON.stringify(R['Bet B.']) === JSON.stringify([1, 1.5, 2.6]), R['Bet B.']);
const R0 = run({ DB_YIELD_APPROX: join(d, 'none.csv'), DB_YIELD_FEED: join(d, 'feed.csv') });
check('control: without the snapshot feed the same row is Bet365', JSON.stringify(R0['Snap S.']) === JSON.stringify([1, 1.5, 2.6]), R0['Snap S.']);
console.log(`\ntest-approx-pinnacle: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
