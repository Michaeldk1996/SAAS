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
const C = new Function(`${constLine(html, 'FH_BOOK')}\n${constLine(html, 'FH_SRC')}\n${constLine(html, 'SF_APPROX_HOVER')}\n${constLine(html, 'SF_OD10_HOVER')}\n${constLine(html, 'FH_B365_APPROX_HOVER')}\n${constLine(html, 'FH_B365_AT_HOVER')}\n${fn(html, 'fhB365Approx')}\n${fn(html, 'fhSrcTitle')}\n${fn(html, 'fhSourceNote')}
  return { FH_BOOK, SF_APPROX_HOVER, SF_OD10_HOVER, fhSrcTitle, fhSourceNote, fhB365Approx };`)();
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
const join2 = /r\.book = bk === 0 \|\| bk === 3 \|\| bk === 4 \? 'P' : bk === 2 \|\| bk === 5 \|\| bk === 8 \? 'A' : 'B';/.test(html);
check('the price join maps the store\'s books 2, 5 and 8 (the three Pinnacle snapshot sources) to "A" (never "B" or "P") and 3 / 4 (our archive) to "P"', join2);
// founder 2026-10-16 (round 3, item 1): our archive's closes carry their own source on every surface, never "Tennis-Data"
const join34 = /r\.src = bk === 3 \? 'hist' : bk === 4 \|\| bk === 6 \? 'cap' : bk === 5 \? 'od10' : bk === 7 \? 'atb' : bk === 8 \? 'te' : bk === 10 \? 'teb' : 'td'; r\.srcLabel = bk === 3 \? FH_SRC\.hist : bk === 4 \? FH_SRC\.cap : undefined;/.test(html);
check('the price join gives our archive\'s closes their own source: 3 → "from Pinnacle history", 4 → "captured", 5 → the start − 10 snapshot', join34);
// founder 2026-10-18 (item 3): book 6 = our captured Bet365 at the lower levels — 'B' + 'cap', so it hovers as an approx, never a close
check('the price join reads book 6 (our captured Bet365) as Bet365 with source "cap" → "Bet365 (approx.) · not a confirmed close"', join34 && join2 && C.fhSrcTitle({ book: 'B', src: 'cap' }) !== 'Bet365 close · captured');
// founder brief 2026-10-19 (item 3): book 7 = api-tennis's stored Bet365 — 'B' + 'atb', an approx that names its source
check('the price join reads book 7 (api-tennis Bet365) as Bet365 with source "atb", never a close', join34 && join2 && C.fhB365Approx({ book: 'B', src: 'atb' })
  && C.fhSrcTitle({ book: 'B', src: 'atb' }) === 'Bet365 (approx.) · Bet365 snapshot from api-tennis, no timestamp, not a confirmed close');
check('a Tournament-tab / sheet price from Pinnacle history reads "Pinnacle close · from Pinnacle history", a captured one "· captured"',
  C.fhSrcTitle({ book: 'P', src: 'hist', srcLabel: 'from Pinnacle history' }) === 'Pinnacle close · from Pinnacle history'
  && C.fhSrcTitle({ book: 'P', src: 'hist' }) === 'Pinnacle close · from Pinnacle history'
  && C.fhSrcTitle({ book: 'P', src: 'cap', srcLabel: 'captured' }) === 'Pinnacle close · captured');
check('every copy of a Database-join price keeps the join\'s source (no blanket src: \'td\' — the Playing styles ledger printed our archive\'s close as Tennis-Data)',
  !/book: j\.book, src: 'td'/.test(html) && /book: j\.book, src: j\.src \|\| 'td', srcLabel: j\.srcLabel/.test(html));
check('trDbJoinPx passes the join\'s own source on (the Tournament tab printed every join price as Tennis-Data)',
  /r\.src = ok \? \(x\.src \|\| 'td'\) : null;\s*r\.srcLabel = ok \? x\.srcLabel : undefined;/.test(fn(html, 'trDbJoinPx')));
// ── Tennis Explorer · Pinnacle (the join's book 8, founder 2026-10-19): a snapshot; ONE fixed hover, no time ──
{
  const TEH = 'Pinnacle (approx.) · Tennis Explorer, last pre-match price, not a confirmed close';
  const T = new Function(`${constLine(html, 'FH_BOOK')}\n${constLine(html, 'FH_SRC')}\n${constLine(html, 'SF_APPROX_HOVER')}\n${constLine(html, 'SF_OD10_HOVER')}\n${constLine(html, 'SF_TE_HOVER')}
    ${constLine(html, 'FH_B365_APPROX_HOVER')}\n${constLine(html, 'FH_B365_AT_HOVER')}\n${fn(html, 'fhB365Approx')}\n${fn(html, 'fhSrcTitle')}\n${fn(html, 'sfApproxHover')}
    return { fhSrcTitle, sfApproxHover };`)();
  check('TE: every Tennis Explorer price hovers exactly "' + TEH + '"', T.fhSrcTitle({ book: 'A', src: 'te' }) === TEH, T.fhSrcTitle({ book: 'A', src: 'te' }));
  check('TE: one fixed text — a row carrying a change time hovers the same words, no time is ever shown',
    T.fhSrcTitle({ book: 'A', src: 'te', priceTs: '2026-09-28T09:18:00Z' }) === TEH && T.fhSrcTitle({ book: 'A', src: 'te', priceTs: '' }) === TEH
    && !/\d\d:\d\d|changed|recorded/.test(T.fhSrcTitle({ book: 'A', src: 'te', priceTs: '2026-09-28T09:18:00Z' })));
  check('TE: Series reads the same words through sfApproxHover', 'Pinnacle (approx.) · ' + T.sfApproxHover({ src: 'te' }) === TEH);
  check('control: the api-tennis and start − 10 snapshots keep their own words', T.fhSrcTitle({ book: 'A', src: 'td' }) === 'Pinnacle (approx.) · ' + HOVER && T.fhSrcTitle({ book: 'A', src: 'od10' }) === 'Pinnacle (approx.) · ' + OD10);
  check('TE: no page carries the time — no priceTs and no xTs in the page, the profile or the builder',
    !/priceTs|xTs/.test(html) && !/priceTs|xTs/.test(readFileSync(join(ROOT, 'player-profile-v2.js'), 'utf8')) && !/priceTs|xTs/.test(readFileSync(join(ROOT, 'build-database-yield.js'), 'utf8')));
  check('the profile hands a TE price to its sheet as A / te', /r\.src === 'te' \? 'pinnacle-approx-te'/.test(fn(html, 'trProfilePriceOf'))
    && /'pinnacle-approx-te': \['A', 'te'\]/.test(readFileSync(join(ROOT, 'player-profile-v2.js'), 'utf8')));
}

// ── Tennis Explorer · Bet365 (the join's book 10, founder 2026-10-30, "last before dash"): Bet365, an approx, its own hover ──
{
  const TBH = 'Bet365 (approx.) · Tennis Explorer, last pre-match price, not a confirmed close';
  const T = new Function(`${constLine(html, 'FH_BOOK')}\n${constLine(html, 'FH_SRC')}\n${constLine(html, 'SF_APPROX_HOVER')}\n${constLine(html, 'SF_OD10_HOVER')}\n${constLine(html, 'SF_TE_HOVER')}
    ${constLine(html, 'FH_B365_APPROX_HOVER')}\n${constLine(html, 'FH_B365_AT_HOVER')}\n${constLine(html, 'FH_B365_TE_HOVER')}\n${constLine(html, 'FH_B365_HOVER')}\n${fn(html, 'fhB365Approx')}\n${fn(html, 'fhSrcTitle')}\n${fn(html, 'fhH2hSrcTitle')}\n${fn(html, 'fhB365Tag')}
    return { fhSrcTitle, fhH2hSrcTitle, fhB365Approx, fhB365Tag };`)();
  check('TE Bet365: book 10 is Bet365 ("B") with source "teb" in the join', join2 && join34);
  check('TE Bet365: an approx, never a close — every hover reads "' + TBH + '"', T.fhB365Approx({ book: 'B', src: 'teb' })
    && T.fhSrcTitle({ book: 'B', src: 'teb' }) === TBH && T.fhH2hSrcTitle({ book: 'B', src: 'teb' }) === TBH && T.fhB365Tag({ book: 'B', src: 'teb' }, true).includes(`title="${TBH}"`));
  check('control: api-tennis Bet365 and our captured Bet365 keep their own words', T.fhSrcTitle({ book: 'B', src: 'atb' }) !== TBH && T.fhSrcTitle({ book: 'B', src: 'cap' }) === 'Bet365 (approx.) · not a confirmed close');
  check('TE Bet365: the profile hands it to its sheet as B / teb, both ways', /r\.src === 'teb' \? 'bet365-approx-te'/.test(html)
    && /'bet365-approx-te': \['B', 'teb'\]/.test(readFileSync(join(ROOT, 'player-profile-v2.js'), 'utf8')) && /'bet365-approx-te': \['B', 'teb'\]/.test(html));
}

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
      ${fn(html, 'fhPxMark')}\n${fn(html, 'fhSrcTitle')}\n${fn(html, 'fhH2hSrcTitle')}\n${fn(html, 'fhB365Tag')}\n${fn(html, 'fhPriceCell')}\n${fn(html, 'trPxTitle')}\n${extra}`, ctx);
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
  check('control: the Database join\'s Bet365 reaches the profile as Tennis-Data\'s (bet365-archive), a captured one as bet365-capture, api-tennis\'s and Tennis Explorer\'s as their own',
    /r\.book === 'B' \? \(r\.src === 'atb' \? 'bet365-approx-at' : r\.src === 'teb' \? 'bet365-approx-te' : r\.src === 'cap' \? 'bet365-capture' : 'bet365-archive'\)/.test(fn(html, 'trProfilePriceOf')));
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
  /r\.src === 'od10' \? 'pinnacle-approx-od10' : r\.src === 'te' \? 'pinnacle-approx-te' : r\.src === 'early' \? 'pinnacle-early' : 'pinnacle-approx'/.test(fn(html, 'trProfilePriceOf'))
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
  // founder ruling 2026-10-25: every marker site draws through fhPxMark ('B' Bet365, 'E' the early cut) — an approx. snapshot none
  const PM = new Function(`${fn(src, 'fhPxMark')}\nreturn fhPxMark;`)();
  const marks = [...src.matchAll(/hMark: (?:typeof fhPxMark === 'function' \? )?fhPxMark\(r\)/g)].map(() => PM(A) + '|' + PM(B));
  return { ok: titles.every(t => t === 'Pinnacle (approx.) · ' + HOVER) && tags === '' && marks.length >= 4 && marks.every(m => m === '|B')
    && F.fhH2hSrcTitle(B) === B365H && F.h2hPriceTitle(B) === B365H, titles, tags, marks };
};
const oh = oneHover(html);
check('one hover per price: a Pinnacle (approx.) price reads only the snapshot hover on every surface — never the Bet365 hover, no B mark, no B365 tag',
  oh.ok, JSON.stringify(oh));
const ohMut = oneHover(html.replace(": r && r.book === 'B' ? FH_B365_HOVER : fhSrcTitle(r); }", ": r && r.book !== 'P' ? FH_B365_HOVER : fhSrcTitle(r); }"));
check('control: an H2H hover that treats any non-Pinnacle book as Bet365 is caught', !ohMut.ok);
const ohMut2 = oneHover(html.replace("if (r.price != null && r.book === 'A') return 'Pinnacle (approx.) · ' + (r.src === 'od10' ? SF_OD10_HOVER : r.src === 'te' ? SF_TE_HOVER : SF_APPROX_HOVER);\n", ''));
check('control: the H2H page dropping its snapshot branch is caught', !ohMut2.ok);

// Series: the cell title
const ser = readFileSync(join(ROOT, 'series.js'), 'utf8');
check('Series names book A "Pinnacle (approx.)" and its title is the ruled words, not "… closing"',
  /BOOK_NAME = \{ P: 'Pinnacle', B: 'bet365', A: 'Pinnacle \(approx\.\)' \}/.test(ser) && /r\.book === BOOK_NAME\.A \? r\.book \+ ' · ' \+ \(\(typeof window\.sfApproxHover === 'function' \? window\.sfApproxHover\(r\) : r\.src === 'od10' \? window\.SF_OD10_HOVER : window\.SF_APPROX_HOVER\)/.test(ser));

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
for (const f of ['build-database-yield.js', 'build-odds-performance.js', 'settlement.js']) copyFileSync(join(ROOT, f), join(d, f));
const H26 = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl\n';
writeFileSync(join(d, 'odds-archive', '2026.csv'), H26 + [
  '2026-01-13,Adelaide International,ATP250,Outdoor,Hard,1st Round,3,Pin P.,Ned N.,1,2,Completed,1.5,2.6,1.55,2.62',   // TD Pinnacle: kept
  '2026-02-03,Dallas Open,ATP500,Indoor,Hard,1st Round,3,Snap S.,Shot S.,1,2,Completed,1.5,2.6,,',                       // snapshot
  '2026-02-04,Dallas Open,ATP500,Indoor,Hard,1st Round,3,Arch A.,Ive I.,1,2,Completed,1.5,2.6,,',                        // archive close first
  '2026-02-05,Dallas Open,ATP500,Indoor,Hard,1st Round,3,Bet B.,Three T.,1,2,Completed,1.5,2.6,,',                       // no snapshot: Bet365
  '2026-02-06,Dallas Open,ATP500,Indoor,Hard,1st Round,3,Cap C.,Ture T.,1,2,Completed,1.5,2.6,,',                        // our captured close
  '2026-07-20,Generali Open,ATP250,Outdoor,Clay,1st Round,3,Ten T.,Odd O.,1,2,Completed,1.5,2.6,,',                     // start − 10 + api-tennis: start − 10 first
  '2026-07-21,Generali Open,ATP250,Outdoor,Clay,1st Round,3,Ate A.,Only O.,1,2,Completed,1.5,2.6,,',                    // api-tennis only (no pre-cut pair)
  // founder 2026-10-30 ("TE above Bet365"): read only by the TE feed below (approx-te.csv); with approx.csv they are Bet365 / dashes
  '2026-02-07,Dallas Open,ATP500,Indoor,Hard,2nd Round,3,Tee T.,Bee B.,1,2,Completed,1.5,2.6,,',                      // TE over Bet365
  '2026-02-08,Dallas Open,ATP500,Indoor,Hard,2nd Round,3,Dash D.,Fill F.,1,2,Completed,,,,',                         // TE fills a dash
  '2026-02-09,Dallas Open,ATP500,Indoor,Hard,2nd Round,3,Both B.,Api A.,1,2,Completed,1.5,2.6,,',                     // api-tennis + TE: api-tennis
  '2026-07-22,Generali Open,ATP250,Outdoor,Clay,1st Round,3,Odte O.,Ten N.,1,2,Completed,1.5,2.6,,',                 // start − 10 + TE: TE
  '2026-02-10,Dallas Open,ATP500,Indoor,Hard,2nd Round,3,Arch E.,Tee E.,1,2,Completed,1.5,2.6,,',                     // archive close + TE: the close
  '2026-02-11,Dallas Open,ATP500,Indoor,Hard,2nd Round,3,Early E.,Api E.,1,2,Completed,1.5,2.6,,',                    // E + api-tennis: E
].join('\n') + '\n');
const AT = 'api-tennis Pinnacle', OD = 'oddspapi Pinnacle (start − 10)';
writeFileSync(join(d, 'approx.csv'), 'date,tournament,winner,loser,psw,psl,eventKey,snapshotId,source,cutTs,gapToStartS\n' +
  `2026-01-13,Adelaide International,Pin P.,Ned N.,1.4,2.9,1,1,${AT},,\n2026-02-03,Dallas Open,Snap S.,Shot S.,1.45,2.75,2,2,${AT},,\n2026-02-04,Dallas Open,Arch A.,Ive I.,1.45,2.75,3,3,${AT},,\n` +
  `2026-07-20,Generali Open,Ten T.,Odd O.,1.41,2.95,4,4,${AT},,\n2026-07-20,Generali Open,Ten T.,Odd O.,1.43,2.88,4,5,${OD},2026-07-20T09:50:00Z,1140\n` +
  `2026-07-21,Generali Open,Ate A.,Only O.,1.6,2.3,6,6,${AT},,\n`);
writeFileSync(join(d, 'feed.csv'), 'kind,date,tournament,series,court,surface,round,bestof,winner,loser,comment,psw,psl,archiveId,label,eventKey\n' +
  'override,2026-02-04,Dallas Open,,,,,,Arch A.,Ive I.,,1.48,2.7,9,from Pinnacle history,9\n' +
  'override,2026-02-06,Dallas Open,,,,,,Cap C.,Ture T.,,1.47,2.72,10,captured,10\n' +
  'override,2026-02-10,Dallas Open,,,,,,Arch E.,Tee E.,,1.49,2.69,11,from Pinnacle history,11\n' +
  'override,2026-02-11,Dallas Open,,,,,,Early E.,Api E.,,1.44,2.8,12,early cut 71,12\n');
const run = env => { execFileSync('node', ['build-database-yield.js'], { cwd: d, env: { ...process.env, ...env }, stdio: 'pipe' });
  const b = JSON.parse(readFileSync(join(d, 'database-yield.json'), 'utf8')), n = JSON.parse(readFileSync(join(d, 'database-yield-players.json'), 'utf8'));
  return Object.fromEntries(b.rows.map((r, i) => [n.names[i][0], [r[8], r[5], r[6]]])); };
const R = run({ DB_YIELD_APPROX: join(d, 'approx.csv'), DB_YIELD_FEED: join(d, 'feed.csv') });
check('builder: a Tennis-Data Pinnacle close is never replaced by a snapshot', JSON.stringify(R['Pin P.']) === JSON.stringify([0, 1.55, 2.62]), R['Pin P.']);
check('builder: our archive\'s close outranks the snapshot, under its own code (3 = from Pinnacle history)', JSON.stringify(R['Arch A.']) === JSON.stringify([3, 1.48, 2.7]), R['Arch A.']);
check('builder: a captured close from our archive is code 4, at its own price', JSON.stringify(R['Cap C.']) === JSON.stringify([4, 1.47, 2.72]), R['Cap C.']);
const MB = JSON.parse(readFileSync(join(d, 'database-yield.json'), 'utf8')).meta;
check('builder: the Pinnacle count includes our archive\'s closes (no figure moves), and meta names each label',
  MB.bookCounts.Pinnacle === 4 && MB.archiveFeed.rowsByLabel['from Pinnacle history'] === 2 && MB.archiveFeed.rowsByLabel.captured === 1, JSON.stringify(MB.bookCounts));
check('builder: no Pinnacle close → the snapshot, book 2', JSON.stringify(R['Snap S.']) === JSON.stringify([2, 1.45, 2.75]), R['Snap S.']);
check('builder: no snapshot → Bet365 stays the fallback', JSON.stringify(R['Bet B.']) === JSON.stringify([1, 1.5, 2.6]), R['Bet B.']);
// founder ruling 2026-10-26 (supersedes 2026-10-17 item 2 for the ATP main draw): a start − 10 snapshot is never shown —
// the match is a DASH, with no fall-through to api-tennis or Bet365 (tools/test-b365-window.mjs carries the full rule)
check('builder: a start − 10 row is a dash, never book 5 and never the api-tennis snapshot beside it', R['Ten T.'] === undefined, R['Ten T.']);
check('builder: no start − 10 pair → the api-tennis snapshot (book 2)', JSON.stringify(R['Ate A.']) === JSON.stringify([2, 1.6, 2.3]), R['Ate A.']);
check('builder: both snapshot sources count as Pinnacle (approx.), each named with its hover and count in meta',
  MB.bookCounts['Pinnacle (approx.)'] === 2 && MB.approx.sources.od.used === 0 && MB.approx.sources.at.used === 2 && MB.approx.sources.od.hover === OD10
  && MB.od10Dropped && MB.od10Dropped.rows === 1,
  JSON.stringify({ bc: MB.bookCounts, s: MB.approx && MB.approx.sources }));
const agg5 = new Function(`function median(a){ return a.length ? a[a.length >> 1] : null; }\n${fn(html, 'agg')}\nreturn agg;`)();
const a5 = agg5([{ p: 1.5, w: 1, b: 2 }, { p: 1.6, w: 0, b: 5 }]);
check('the Database folds book 5 into Pinnacle (approx.) — never Pinnacle or Bet365', a5.book.ap && a5.book.ap.n === 2 && !a5.book.ps && !a5.book.b365, JSON.stringify(a5.book));
writeFileSync(join(d, 'old.csv'), 'date,tournament,winner,loser,psw,psl,eventKey,snapshotId\n2026-02-03,Dallas Open,Snap S.,Shot S.,1.45,2.75,2,2\n');
let oldErr = ''; try { run({ DB_YIELD_APPROX: join(d, 'old.csv'), DB_YIELD_FEED: join(d, 'feed.csv') }); } catch (e) { oldErr = String(e.stderr || e); }
check('control: a feed without the source column is refused, never read as one source', /unexpected header/.test(oldErr), oldErr);
const R0 = run({ DB_YIELD_APPROX: join(d, 'none.csv'), DB_YIELD_FEED: join(d, 'feed.csv') });
check('control: without the snapshot feed the same row is Bet365', JSON.stringify(R0['Snap S.']) === JSON.stringify([1, 1.5, 2.6]), R0['Snap S.']);
// ── TE on the ATP main draw (founder ruling 2026-10-30): TD Pinnacle > archive close > E > api-tennis > TE > Bet365 > dash;
// TE is the one source that prices a start − 10 dash
{
  const TE = 'Tennis Explorer · Pinnacle';
  writeFileSync(join(d, 'approx-te.csv'), readFileSync(join(d, 'approx.csv'), 'utf8') +
    `2026-02-07,Dallas Open,Tee T.,Bee B.,1.52,2.58,20,20,${TE},,\n2026-02-08,Dallas Open,Dash D.,Fill F.,1.7,2.15,21,21,${TE},,\n` +
    `2026-02-09,Dallas Open,Both B.,Api A.,1.61,2.35,22,22,${AT},,\n2026-02-09,Dallas Open,Both B.,Api A.,1.66,2.25,22,23,${TE},,\n` +
    `2026-07-22,Generali Open,Odte O.,Ten N.,1.4,2.9,24,24,${OD},2026-07-22T09:50:00Z,600\n2026-07-22,Generali Open,Odte O.,Ten N.,1.42,2.85,24,25,${TE},,\n` +
    `2026-02-10,Dallas Open,Arch E.,Tee E.,1.5,2.6,26,26,${TE},,\n2026-02-11,Dallas Open,Early E.,Api E.,1.6,2.3,27,27,${AT},,\n`);
  const teRun = (src) => { if (src) copyFileSync(src, join(d, 'build-database-yield.js'));
    try { return run({ DB_YIELD_APPROX: join(d, 'approx-te.csv'), DB_YIELD_FEED: join(d, 'feed.csv') }); } finally { copyFileSync(join(ROOT, 'build-database-yield.js'), join(d, 'build-database-yield.js')); } };
  const T = teRun();
  check('TE on the ATP main draw: a Bet365 row with a TE price is priced on TE, book 8', JSON.stringify(T['Tee T.']) === JSON.stringify([8, 1.52, 2.58]), T['Tee T.']);
  check('TE on the ATP main draw: a dash with a TE price is priced on TE', JSON.stringify(T['Dash D.']) === JSON.stringify([8, 1.7, 2.15]), T['Dash D.']);
  check('TE on the ATP main draw: api-tennis Pinnacle stays above TE', JSON.stringify(T['Both B.']) === JSON.stringify([2, 1.61, 2.35]), T['Both B.']);
  check('TE on the ATP main draw: a start − 10 dash is priced on TE (never on the start − 10 snapshot)', JSON.stringify(T['Odte O.']) === JSON.stringify([8, 1.42, 2.85]), T['Odte O.']);
  check('TE on the ATP main draw: our archive close stays above TE; a start − 10 row with no TE stays a dash',
    JSON.stringify(T['Arch E.']) === JSON.stringify([3, 1.49, 2.69]) && T['Ten T.'] === undefined, JSON.stringify([T['Arch E.'], T['Ten T.']]));
  check('ruling 1: E stays above api-tennis, and the overlap is counted (meta.approx.eOverApiTennis)',
    JSON.stringify(T['Early E.']) === JSON.stringify([9, 1.44, 2.8]) && JSON.parse(readFileSync(join(d, 'database-yield.json'), 'utf8')).meta.approx.eOverApiTennis === 1,
    JSON.stringify(T['Early E.']));
  check('control: with the feed that has no TE rows the same matches are Bet365 / a dash, as before',
    JSON.stringify(R['Tee T.']) === JSON.stringify([1, 1.5, 2.6]) && R['Dash D.'] === undefined && JSON.stringify(R['Odte O.']) === JSON.stringify([1, 1.5, 2.6]),
    JSON.stringify([R['Tee T.'], R['Dash D.'], R['Odte O.']]));
  const MT = JSON.parse(readFileSync(join(d, 'database-yield.json'), 'utf8')).meta;
  check('TE on the ATP main draw: meta counts TE in Pinnacle (approx.) and names it: used, over Bet365, filled a dash, filled a start − 10 dash',
    MT.approx.sources.te.used === 3 && MT.approx.sources.te.overBet365 === 1 && MT.approx.sources.te.filledDash === 1 && MT.approx.sources.te.filledStart10Dash === 1
    && MT.od10Dropped.pricedByTe === 1 && MT.bookCounts['Pinnacle (approx.)'] === MT.approx.sources.at.used + MT.approx.sources.od.used + 3
    && MT.approx.sources.te.hover === 'Tennis Explorer, last pre-match price, not a confirmed close', JSON.stringify({ s: MT.approx.sources.te, bc: MT.bookCounts }));
  const src = readFileSync(join(ROOT, 'build-database-yield.js'), 'utf8');
  const mut = (a, b, name) => { if (!src.includes(a)) { check('mutant anchor present: ' + name, false); return null; } const f = join(d, 'mut.js'); writeFileSync(f, src.replace(a, b)); return teRun(f); };
  const m1 = mut('} else if (pick) { AP = ap[pick];', '} else if (pick && !teOk) { AP = ap[pick];', 'TE above api-tennis');
  check('MUTANT TE above api-tennis is caught', m1 && JSON.stringify(m1['Both B.']) !== JSON.stringify([2, 1.61, 2.35]));
  const m2 = mut("if (teOk) { od10Cut = false;", "if (false) { od10Cut = false;", 'no TE for start − 10');
  check('MUTANT a start − 10 dash TE does not price is caught', m2 && m2['Odte O.'] === undefined);
  const m3 = mut("    const b365Ok = (validPrice(B365[0])", "    if (APS === 'te') { AP = null; APS = null; }\n    const b365Ok = (validPrice(B365[0])", 'TE below Bet365');
  check('MUTANT TE below Bet365 is caught', m3 && JSON.stringify(m3['Tee T.']) === JSON.stringify([1, 1.5, 2.6]));
  const a8 = new Function(`function median(a){ return a.length ? a[a.length >> 1] : null; }\n${fn(html, 'agg')}\nreturn agg;`)()([{ p: 1.5, w: 1, b: 8 }, { p: 1.6, w: 0, b: 0 }]);
  check('the Database folds book 8 into Pinnacle (approx.) (the per-book split had no bucket for it: a crash)', a8.book.ap && a8.book.ap.n === 1 && a8.book.ps.n === 1, JSON.stringify(a8.book));
  const fT = paintFoot({ ...M0, books: ['Pinnacle', 'Bet365', 'Pinnacle (approx.)'], bookCounts: { ...M0.bookCounts, 'Pinnacle (approx.)': 755 },
    approx: { hover: HOVER, sources: { at: { used: 752 }, od: { used: 0 }, te: { used: 3, hover: 'Tennis Explorer, last pre-match price, not a confirmed close' } } } });
  check('the footnote names TE apart, with its own count, outside the dated 13 Jan – 16 Sep sentence',
    /and 752 on Pinnacle \(approx\.\) — /.test(fT) && /and 3 on Pinnacle \(approx\.\) · Tennis Explorer, last pre-match price, not a confirmed close \(ATP main draw, where no other Pinnacle price exists\)/.test(fT), fT.slice(0, 1200));
}
{
  const { createRequire } = await import('node:module');
  const ME = createRequire(import.meta.url)(join(ROOT, 'build-market-edge.js'));
  const meSrc = readFileSync(join(ROOT, 'build-market-edge.js'), 'utf8');
  check('Market edge reads Database book 8 as Tennis Explorer (pinnacle-approx-te, the page\'s own book id) and keeps it on its basis',
    JSON.stringify(ME.DB_BOOK[8]) === JSON.stringify(['pinnacle-approx-te', 'Pinnacle (approx.) · Tennis Explorer']) && /'pinnacle-approx-te'\]\);/.test(meSrc)
    && /'pinnacle-approx-te': \['A', 'te'\]/.test(html), JSON.stringify(ME.DB_BOOK[8]));
}
console.log(`\ntest-approx-pinnacle: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
