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
const OD10 = 'Pinnacle history, taken 10 minutes before the recorded start, not a confirmed close';  // founder 2026-10-17 item 2

// the shared constants + source titles (Tournament tab, profile, sheets)
const C = new Function(`${constLine(html, 'FH_BOOK')}\n${constLine(html, 'FH_SRC')}\n${constLine(html, 'SF_APPROX_HOVER')}\n${constLine(html, 'SF_OD10_HOVER')}\n${constLine(html, 'FH_B365_APPROX_HOVER')}\n${fn(html, 'fhB365Approx')}\n${fn(html, 'fhSrcTitle')}\n${fn(html, 'fhSourceNote')}
  return { FH_BOOK, SF_APPROX_HOVER, SF_OD10_HOVER, fhSrcTitle, fhSourceNote };`)();
check('the hover is the ruled words', C.SF_APPROX_HOVER === HOVER);
check('a Pinnacle (approx.) price hovers "Pinnacle (approx.) · <ruled words>" — never "Pinnacle close"',
  C.fhSrcTitle({ book: 'A', src: 'td' }) === 'Pinnacle (approx.) · ' + HOVER && !/close ·/.test(C.fhSrcTitle({ book: 'A', src: 'td' })));
check('start − 10: the hover is the ruled words, and a start − 10 price reads "Pinnacle (approx.) · Pinnacle history, taken 10 minutes …"',
  C.SF_OD10_HOVER === OD10 && C.fhSrcTitle({ book: 'A', src: 'od10' }) === 'Pinnacle (approx.) · ' + OD10);
check('start − 10: the api-tennis rows keep their own hover', C.fhSrcTitle({ book: 'A', src: 'td' }) === 'Pinnacle (approx.) · ' + HOVER);
check('control: a Pinnacle / Bet365 close keeps its words', C.fhSrcTitle({ book: 'P', src: 'td' }) === 'Pinnacle close · Tennis-Data' && C.fhSrcTitle({ book: 'B', src: 'td' }) === 'Bet365 close · Tennis-Data');
check('the source note names the snapshot with its count, never folds it into "Pinnacle"',
  C.fhSourceNote([{ book: 'P' }, { book: 'A' }, { book: 'A' }, { book: 'B' }]) === 'Pinnacle, Pinnacle (approx.) snapshot where no close (2), Bet365 where missing (1)');
check('control: without a snapshot the note is unchanged', C.fhSourceNote([{ book: 'P' }, { book: 'B' }]) === 'Pinnacle, Bet365 where missing (1)' && C.fhSourceNote([{ book: 'P' }]) === 'Pinnacle');

// the one join: book 2 → 'A'
const join2 = /r\.book = bk === 0 \|\| bk === 3 \|\| bk === 4 \? 'P' : bk === 2 \|\| bk === 5 \? 'A' : 'B';/.test(html);
check('the price join maps the store\'s books 2 and 5 (the two snapshot sources) to "A" (never "B" or "P") and 3 / 4 (our archive) to "P"', join2);
// founder 2026-10-16 (round 3, item 1): our archive's closes carry their own source on every surface, never "Tennis-Data"
const join34 = /r\.src = bk === 3 \? 'hist' : bk === 4 \|\| bk === 6 \? 'cap' : bk === 5 \? 'od10' : 'td'; r\.srcLabel = bk === 3 \? FH_SRC\.hist : bk === 4 \? FH_SRC\.cap : undefined;/.test(html);
check('the price join gives our archive\'s closes their own source: 3 → "from Pinnacle history", 4 → "captured", 5 → the start − 10 snapshot', join34);
// founder 2026-10-18 (item 3): book 6 = our captured Bet365 at the lower levels — 'B' + 'cap', so it hovers as an approx, never a close
check('the price join reads book 6 (our captured Bet365) as Bet365 with source "cap" → "Bet365 (approx.) · not a confirmed close"', join34 && join2 && C.fhSrcTitle({ book: 'B', src: 'cap' }) !== 'Bet365 close · captured');
check('a Tournament-tab / sheet price from Pinnacle history reads "Pinnacle close · from Pinnacle history", a captured one "· captured"',
  C.fhSrcTitle({ book: 'P', src: 'hist', srcLabel: 'from Pinnacle history' }) === 'Pinnacle close · from Pinnacle history'
  && C.fhSrcTitle({ book: 'P', src: 'hist' }) === 'Pinnacle close · from Pinnacle history'
  && C.fhSrcTitle({ book: 'P', src: 'cap', srcLabel: 'captured' }) === 'Pinnacle close · captured');
check('every copy of a Database-join price keeps the join\'s source (no blanket src: \'td\' — the Playing styles ledger printed our archive\'s close as Tennis-Data)',
  !/book: j\.book, src: 'td'/.test(html) && /book: j\.book, src: j\.src \|\| 'td', srcLabel: j\.srcLabel/.test(html));
check('trDbJoinPx passes the join\'s own source on (the Tournament tab printed every join price as Tennis-Data)',
  /r\.src = ok \? \(x\.src \|\| 'td'\) : null;\s*r\.srcLabel = ok \? x\.srcLabel : undefined;/.test(fn(html, 'trDbJoinPx')));
check('the profile hands its sheet the archive\'s source (pinnacle-history → P / hist)',
  /r\.src === 'hist' \? 'pinnacle-history' : r\.src === 'cap' \? 'pinnacle-capture'/.test(fn(html, 'trProfilePriceOf'))
  && /'pinnacle-history': \['P', 'hist'\]/.test(readFileSync(join(ROOT, 'player-profile-v2.js'), 'utf8')));

// 17 Oct 2026 live bug: `window.fhSrcTitle = (...a) => fhSrcTitle(...a)` replaced the page's global declaration with a
// wrapper that called itself (RangeError on every price hover). Run the page's own fhSrcTitle as a classic-script global
// plus every line of the page that assigns window.fhSrcTitle, then call it through window, as the profile does.
{
  const vm = await import('node:vm');
  const assigns = html.split('\n').filter(l => /window\.fhSrcTitle\s*=/.test(l)).join('\n');
  const run = (extra) => { const ctx = vm.createContext({}); ctx.window = ctx;
    vm.runInContext(`${constLine(html, 'FH_BOOK')}\n${constLine(html, 'FH_SRC')}\n${constLine(html, 'SF_APPROX_HOVER')}\n${constLine(html, 'SF_OD10_HOVER')}\n${constLine(html, 'FH_B365_APPROX_HOVER')}\n${fn(html, 'fhB365Approx')}\n${fn(html, 'fhSrcTitle')}\n${extra}`, ctx);
    try { return ctx.window.fhSrcTitle({ book: 'P', src: 'hist' }); } catch (e) { return e.name; } };
  check('the page never re-assigns its global fhSrcTitle: window.fhSrcTitle answers through window (17 Oct live stack overflow)',
    run(assigns) === 'Pinnacle close · from Pinnacle history');
  check('control: the 17 Oct wrapper line overflows the stack', run("window.fhSrcTitle = (...a) => fhSrcTitle(...a);") === 'RangeError');

  // Founder 2026-10-17: the test covers EVERY surface that calls fhSrcTitle. (1) The callers are pinned: a new caller turns
  // this red until it is added here. (2) The page holds one declaration and no re-binding of the name, so every bare call
  // resolves to it. (3) Each caller small enough to run alone is run, in the page's own code, with every window.fhSrcTitle
  // assignment the page makes applied — and the 17 Oct wrapper line put back makes each of them throw.
  const prof = readFileSync(join(ROOT, 'player-profile-v2.js'), 'utf8');
  const callers = (src) => { const L = src.split('\n'), out = new Set();
    L.forEach((l, n) => { if (!/fhSrcTitle\s*\(/.test(l) || /^\s*(\/\/|\*)/.test(l) || /^\s*function fhSrcTitle\s*\(/.test(l)) return;
      for (let k = n; k >= 0 && k > n - 500; k--) { const m = /^\s*(?:async\s+)?function\s+(\w+)\s*\(|^\s*(?:const|let)\s+(\w+)\s*=\s*(?:\(|function|async)/.exec(L[k]);
        if (m && (m[1] || m[2]) !== 'fhSrcTitle') { out.add(m[1] || m[2]); break; } } });
    return [...out].sort(); };
  const PINNED_PAGE = ['cell' /* Playing style meeting rows (ruling 5), inside ps2MeetCard */, 'cellHtml' /* Progression heat cell, inside buildMatchProgressionSection */, 'fhB365Tag', 'fhFormColumnHtml', 'fhFormRowData', 'fhH2hSrcTitle', 'fhPriceCell', 'meRowOf', 'ovPopHtml', 'trPxTitle'];
  const PINNED_PROFILE = ['pxSrcHtml'];
  check('every caller of fhSrcTitle is pinned (Progression, H2H B365 tag, Form bars + rows, H2H tab, price cells, Market edge, Overview pop-up, Tournament tab; the profile)',
    JSON.stringify(callers(html)) === JSON.stringify(PINNED_PAGE) && JSON.stringify(callers(prof)) === JSON.stringify(PINNED_PROFILE),
    JSON.stringify({ page: callers(html), profile: callers(prof) }));
  const decls = (html.match(/^\s*function fhSrcTitle\s*\(/gm) || []).length;
  const rebinds = html.split('\n').filter(l => !/^\s*\/\//.test(l) && /(?:^|[^.\w])(?:window\.)?fhSrcTitle\s*=(?!=)|(?:const|let|var)\s+fhSrcTitle\b/.test(l)).length;
  check('one declaration of fhSrcTitle on the page and no re-binding of the name, so every bare call reads it', decls === 1 && rebinds === 0, JSON.stringify({ decls, rebinds }));
  const runCallers = (extra) => { const ctx = vm.createContext({}); ctx.window = ctx;
    vm.runInContext(`${constLine(html, 'FH_BOOK')}\n${constLine(html, 'FH_SRC')}\n${constLine(html, 'SF_APPROX_HOVER')}\n${constLine(html, 'SF_OD10_HOVER')}\n${constLine(html, 'FH_MONO')}\n${constLine(html, 'FH_B365_HOVER')}
${constLine(html, 'FH_B365_APPROX_HOVER')}
${fn(html, 'fhB365Approx')}
      function fhEsc(s){ return String(s == null ? '' : s); } function trPxAfterTitle(){ return 'after'; }
      ${fn(html, 'fhSrcTitle')}\n${fn(html, 'fhH2hSrcTitle')}\n${fn(html, 'fhB365Tag')}\n${fn(html, 'fhPriceCell')}\n${fn(html, 'trPxTitle')}\n${extra}`, ctx);
    const hist = { book: 'P', src: 'hist' }, b = { book: 'B', src: 'td' };
    const res = {};
    for (const [k, f] of Object.entries({ h2hTab: () => ctx.fhH2hSrcTitle(hist), b365Tag: () => ctx.fhB365Tag(b, false), priceCell: () => ctx.fhPriceCell(1.5, 'right', false, hist, true), tournamentTab: () => ctx.trPxTitle(hist) }))
      try { res[k] = f(); } catch (e) { res[k] = e.name; }
    return res; };
  const okRun = runCallers(assigns), badRun = runCallers("window.fhSrcTitle = (...a) => fhSrcTitle(...a);");
  check('each caller runs with the page as shipped: H2H tab, B365 tag, price cell (Form / H2H rows), Tournament tab',
    okRun.h2hTab === 'Pinnacle close · from Pinnacle history' && /Bet365 close · Tennis-Data/.test(okRun.b365Tag) && /title="Pinnacle close · from Pinnacle history"/.test(okRun.priceCell) && okRun.tournamentTab === 'Pinnacle close · from Pinnacle history', JSON.stringify(okRun));
  check('control: with the 17 Oct wrapper every one of them throws RangeError', Object.values(badRun).every(v => v === 'RangeError'), JSON.stringify(badRun));
}
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
const H = new Function('SF_APPROX_HOVER', 'SF_OD10_HOVER', `const E = s => String(s); let _h2hDbSt = 'ready'; ${constLine(html, 'FH_B365_HOVER')}\n${constLine(html, 'H2H_PX_NOTE')}\n${fn('\n' + h2h, 'h2hPxNote')}\n${fn('\n' + h2h, 'h2hPriceTitle')}
  return { h2hPxNote, h2hPriceTitle };`)(HOVER, OD10);
check('a Head to Head ledger price on the snapshot hovers the ruled words', H.h2hPriceTitle({ price: 1.8, book: 'A' }) === 'Pinnacle (approx.) · ' + HOVER);
check('a Head to Head ledger price from our archive names it: "Pinnacle closing price · from Pinnacle history" / "· captured"',
  H.h2hPriceTitle({ price: 1.8, book: 'P', src: 'hist', srcLabel: 'from Pinnacle history' }) === 'Pinnacle closing price · from Pinnacle history'
  && H.h2hPriceTitle({ price: 1.8, book: 'P', src: 'cap', srcLabel: 'captured' }) === 'Pinnacle closing price · captured');
check('a Head to Head ledger price on the start − 10 snapshot hovers its own words', H.h2hPriceTitle({ price: 1.8, book: 'A', src: 'od10' }) === 'Pinnacle (approx.) · ' + OD10);
check('the profile hands a start − 10 price to its sheet as its own source (A / od10), never the api-tennis hover',
  /r\.src === 'od10' \? 'pinnacle-approx-od10' : 'pinnacle-approx'/.test(fn(html, 'trProfilePriceOf'))
  && /'pinnacle-approx-od10': \['A', 'od10'\]/.test(readFileSync(join(ROOT, 'player-profile-v2.js'), 'utf8')));
check('control: a Tennis-Data Pinnacle ledger price still names Tennis-Data', H.h2hPriceTitle({ price: 1.8, book: 'P', src: 'td' }) === 'Pinnacle closing price · Database join (Tennis-Data)');
check('control: a Bet365 / Pinnacle ledger price keeps its words (TEN-437 Bet365 hover)', H.h2hPriceTitle({ price: 1.8, book: 'B' }) === 'Bet365 closing odds, Pinnacle not available' && /^Pinnacle closing price/.test(H.h2hPriceTitle({ price: 1.8, book: 'P' })));
check('a ledger holding snapshot prices says so in its footnote, with the count',
  /Closing price · Pinnacle, else Bet365 · Pinnacle \(approx\.\) on 2: a snapshot, not a confirmed close/.test(H.h2hPxNote('', [{ price: 1.5, book: 'A' }, { price: 2, book: 'A' }, { price: 2, book: 'P' }])));
check('control: a ledger without one keeps the plain footnote', />Closing price · Pinnacle, else Bet365</.test(H.h2hPxNote('', [{ price: 2, book: 'P' }])));

// Founder 2026-10-16: each price gets exactly ONE hover, matching its source — a Pinnacle (approx.) price never shows
// TEN-437's Bet365 hover, on any surface (tab rows, tags, sheet meta, the H2H page, the Tournament tab).
const B365H = 'Bet365 closing odds, Pinnacle not available';
const hoverSrc = src => new Function(`${constLine(src, 'FH_BOOK')}\n${constLine(src, 'FH_SRC')}\n${constLine(src, 'SF_APPROX_HOVER')}\n${constLine(src, 'SF_OD10_HOVER')}\n${constLine(src, 'FH_B365_HOVER')}
${constLine(src, 'FH_B365_APPROX_HOVER')}
${fn(src, 'fhB365Approx')}
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
const ohMut = oneHover(html.replace(": r && r.book === 'B' ? FH_B365_HOVER : fhSrcTitle(r); }", ": r && r.book !== 'P' ? FH_B365_HOVER : fhSrcTitle(r); }"));
check('control: an H2H hover that treats any non-Pinnacle book as Bet365 is caught', !ohMut.ok);
const ohMut2 = oneHover(html.replace("if (r.price != null && r.book === 'A') return 'Pinnacle (approx.) · ' + (r.src === 'od10' ? SF_OD10_HOVER : SF_APPROX_HOVER);\n", ''));
check('control: the H2H page dropping its snapshot branch is caught', !ohMut2.ok);

// Series: the cell title
const ser = readFileSync(join(ROOT, 'series.js'), 'utf8');
check('Series names book A "Pinnacle (approx.)" and its title is the ruled words, not "… closing"',
  /BOOK_NAME = \{ P: 'Pinnacle', B: 'bet365', A: 'Pinnacle \(approx\.\)' \}/.test(ser) && /r\.book === BOOK_NAME\.A \? r\.book \+ ' · ' \+ \(\(r\.src === 'od10' \? window\.SF_OD10_HOVER : window\.SF_APPROX_HOVER\)/.test(ser));

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
  '2026-07-20,Generali Open,ATP250,Outdoor,Clay,1st Round,3,Ten T.,Odd O.,1,2,Completed,1.5,2.6,,',                     // start − 10 + api-tennis: start − 10 first
  '2026-07-21,Generali Open,ATP250,Outdoor,Clay,1st Round,3,Ate A.,Only O.,1,2,Completed,1.5,2.6,,',                    // api-tennis only (no pre-cut pair)
].join('\n') + '\n');
const AT = 'api-tennis Pinnacle', OD = 'oddspapi Pinnacle (start − 10)';
writeFileSync(join(d, 'approx.csv'), 'date,tournament,winner,loser,psw,psl,eventKey,snapshotId,source,cutTs,gapToStartS\n' +
  `2026-01-13,Adelaide International,Pin P.,Ned N.,1.4,2.9,1,1,${AT},,\n2026-02-03,Dallas Open,Snap S.,Shot S.,1.45,2.75,2,2,${AT},,\n2026-02-04,Dallas Open,Arch A.,Ive I.,1.45,2.75,3,3,${AT},,\n` +
  `2026-07-20,Generali Open,Ten T.,Odd O.,1.41,2.95,4,4,${AT},,\n2026-07-20,Generali Open,Ten T.,Odd O.,1.43,2.88,4,5,${OD},2026-07-20T09:50:00Z,1140\n` +
  `2026-07-21,Generali Open,Ate A.,Only O.,1.6,2.3,6,6,${AT},,\n`);
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
// founder ruling 2026-10-17 item 2: 13 Apr – 16 Sep, the Oddspapi archive at start − 10 first (book 5), api-tennis next (2)
check('builder: start − 10 before api-tennis (book 5, at its own price)', JSON.stringify(R['Ten T.']) === JSON.stringify([5, 1.43, 2.88]), R['Ten T.']);
check('builder: no start − 10 pair → the api-tennis snapshot (book 2)', JSON.stringify(R['Ate A.']) === JSON.stringify([2, 1.6, 2.3]), R['Ate A.']);
check('builder: both snapshot sources count as Pinnacle (approx.), each named with its hover and count in meta',
  MB.bookCounts['Pinnacle (approx.)'] === 3 && MB.approx.sources.od.used === 1 && MB.approx.sources.at.used === 2 && MB.approx.sources.od.hover === OD10,
  JSON.stringify({ bc: MB.bookCounts, s: MB.approx && MB.approx.sources }));
const agg5 = new Function(`function median(a){ return a.length ? a[a.length >> 1] : null; }\n${fn(html, 'agg')}\nreturn agg;`)();
const a5 = agg5([{ p: 1.5, w: 1, b: 2 }, { p: 1.6, w: 0, b: 5 }]);
check('the Database folds book 5 into Pinnacle (approx.) — never Pinnacle or Bet365', a5.book.ap && a5.book.ap.n === 2 && !a5.book.ps && !a5.book.b365, JSON.stringify(a5.book));
writeFileSync(join(d, 'old.csv'), 'date,tournament,winner,loser,psw,psl,eventKey,snapshotId\n2026-02-03,Dallas Open,Snap S.,Shot S.,1.45,2.75,2,2\n');
let oldErr = ''; try { run({ DB_YIELD_APPROX: join(d, 'old.csv'), DB_YIELD_FEED: join(d, 'feed.csv') }); } catch (e) { oldErr = String(e.stderr || e); }
check('control: a feed without the source column is refused, never read as one source', /unexpected header/.test(oldErr), oldErr);
const R0 = run({ DB_YIELD_APPROX: join(d, 'none.csv'), DB_YIELD_FEED: join(d, 'feed.csv') });
check('control: without the snapshot feed the same row is Bet365', JSON.stringify(R0['Snap S.']) === JSON.stringify([1, 1.5, 2.6]), R0['Snap S.']);
console.log(`\ntest-approx-pinnacle: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
