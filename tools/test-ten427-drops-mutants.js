// TEN-427 step 14 (Part B · Dropping Odds) — every check in test-ten427-drops.mjs must FAIL when its rule is reverted or
// bent. Each mutant is applied to a copy of drops-page.js (TEN427D_SRC), drops-page.css (TEN427D_CSS) or
// price-history-box.js (TEN427D_PHB) and the suite runs against it; a mutant that leaves it green is a vacuous test and
// fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { js: path.join(ROOT, 'drops-page.js'), css: path.join(ROOT, 'drops-page.css'), phb: path.join(ROOT, 'price-history-box.js') };
const ENV = { js: 'TEN427D_SRC', css: 'TEN427D_CSS', phb: 'TEN427D_PHB' };
const SRC = { js: fs.readFileSync(FILES.js, 'utf8'), css: fs.readFileSync(FILES.css, 'utf8'), phb: fs.readFileSync(FILES.phb, 'utf8') };
const MUTANTS = [
  ['js', 'R1: the drop from the raw quotes, not the shown prices', "      var drop = dropOf(open, now);", "      var drop = (open - now) / open * 100;"],
  ['js', 'R1: the module\'s own rule rounds a half toward +inf', "    return Math.sign(q) * Math.round(Math.abs(q)) / 10;", "    return Math.round(q) / 10;"],
  ['js', 'Data 4: the box ignores the pop-up rows', "    if (phSide.length) {\n      if (phAgrees(", "    if (false) {\n      if (phAgrees("],
  ['js', 'Data 4: the alert\'s own points spliced into the pop-up line', "      var rowPts = b.ph ? [] : pre(tsPoints(rowPoints(x)))", "      var rowPts = pre(tsPoints(rowPoints(x)))"],
  ['js', 'Data 4 (review): the pop-up rows drawn though they disagree with the Bet105 row', "    return price2(side[0].v) === price2(row.open) && price2(side[side.length - 1].v) === price2(row.now);", "    return true;"],
  ['js', 'Data 4 (review): another book\'s box checks the pop-up against no Bet105 row', "      if (phAgrees(phSide, rowOf.Bet105)) {", "      if (phAgrees(phSide, r.book === 'Bet105' ? r : null)) {"],
  ['js', 'Data 4 (review): a source tick after the row\'s now ends the line', "        return !(isFinite(lT) && (p.t > lT || (p.t === lT && Math.abs(p.v - x.now) > 0.005)));", "        return true;"],
  ['js', 'Data 4 (review): a sighting carried whatever price it confirmed', "var carry = prevB.seen != null && prevLast != null && price2(prevLast) === price2(phSide[phSide.length - 1].v);", "var carry = prevB.seen != null;"],
  ['js', 'Data 4 (review): the price_history copy never expires', "        if (!got || Date.now() - got.at >= PH_TTL_MS) {", "        if (!got) {"],
  ['js', 'Data 5 (review): a Surface option click is dead', "      case 'surf': S.surf = v || 'all'; st.menu = null; break;   // single-select: the menu closes\n", ""],
  ['js', 'Data 5 (review): the Surface × leaves the surface set', "        if (v === 'surf') S.surf = 'all';\n", ""],
  ['js', 'Data 7 (review): the dead Refresh handler back', "      case 'reconnect': refresh(); return;", "      case 'refresh': case 'reconnect': refresh(); return;"],
  ['js', 'Data 4: the page never reads the card\'s price_history', "      if (cdat && cdat.source === 'rpc') {", "      if (cdat && cdat.source === 'rpc-off') {"],
  ['js', 'Data 3: an exchange counts as soft', "    return SHARP_BOOKS[s] || SHARP_BOOKS[base] || /exchange|matchbook|smarkets|betdaq/i.test(base) ? 'sharp' : 'soft';", "    return (SHARP_BOOKS[s] || SHARP_BOOKS[base]) && !/exchange/i.test(base) ? 'sharp' : 'soft';"],
  ['js', 'Data 3: the Bookmaker menu lists books not in the data', "    st.rows.forEach(function (r) { set[r.book] = 1; });\n    var order", "    ['Bet105', 'Superbet', 'Pinnacle'].forEach(function (b) { set[b] = 1; });\n    var order"],
  ['js', 'Data 5: the raw tour, not the canonical event table', "      event: card && card.tour ? (h.eventName ? (h.eventName(card.tour) || String(card.tour)) : String(card.tour)) : null,", "      event: card && card.tour ? String(card.tour) : null,"],
  ['js', 'Data 5: names not through the shared formatter', "      var d = k != null && h.playerName ? h.playerName(k, short) : null;", "      var d = null;"],
  ['js', 'Data 5: a row with no surface passes a surface filter', "    if (S.surf && S.surf !== 'all' && r.surface !== S.surf) return false;", "    if (S.surf && S.surf !== 'all' && r.surface && r.surface !== S.surf) return false;"],
  ['js', 'Data 5: the detail line drops the event', "    return ['Match winner', 'vs ' + (r.dOpp || r.opp || '—'), r.event, r.book].filter(Boolean).join(' · ');", "    return ['Match winner', 'vs ' + (r.dOpp || r.opp || '—'), r.book].filter(Boolean).join(' · ');"],
  ['js', 'Data 5: ITF dropped though the feed prices it', "    return { tiers: ['ATP', 'Challenger', 'ITF'], btype: 'all',", "    return { tiers: ['ATP', 'Challenger'], btype: 'all',"],
  ['js', 'Data 6: Updated = the clock', "    var upd = st.everLoaded && st.status && st.status.generatedAt ? clock(st.status.generatedAt) : '—';", "    var upd = clock(Date.now());"],
  ['js', 'Data 6: clocks in UTC, not stennisfy.tz', "    var o; try { o = f(tzName()); } catch (e) { o = f(undefined); }", "    var o = f('UTC');"],
  ['js', 'Data 6: the box start is the vendor\'s, not the card\'s', "  function startMs(r) { if (r.cardStart != null && isFinite(r.cardStart)) return r.cardStart;", "  function startMs(r) {"],
  ['js', 'Data 7: Refresh back', "'\"></div>' +\n      '</div>';", "'\"></div>' +\n      '<button class=\"do-btn\" data-act=\"refresh\">Refresh</button></div>';"],
  ['js', 'Data 7: Alerts back, disabled', "'\"></div>' +\n      '</div>';", "'\"></div>' +\n      '<button class=\"do-btn\" aria-disabled=\"true\">Alerts <span>COMING SOON</span></button></div>';"],
  ['js', 'Data 7: the list stops polling', "  var POLL_MS = 30000;", "  var POLL_MS = 0;"],
  ['js', 'header: the old subtitle', "Prices that have shortened since we first recorded them, each within one bookmaker. Biggest drops first.", "Prices that have shortened since we first recorded them, across every bookmaker we track. Biggest drops first."],
  ['js', 'header: no Updated stat', "      v('Updated', upd, 'updated') +\n", ""],
  ['js', 'avatars: a photo back', "    return '<span class=\"do-av\" aria-hidden=\"true\">' + esc(initials(r.dSide || r.side)) + ph + '</span>';", "    return '<img class=\"do-av\" src=\"x\" alt=\"\">';"],
  ['js', 'time axis 1a: the date back in the tick label', "tf: f === 0 ? 'none' : f === 1 ? 'translateX(-100%)' : 'translateX(-50%)', label: hm(t) };", "tf: f === 0 ? 'none' : f === 1 ? 'translateX(-100%)' : 'translateX(-50%)', label: dayOf(t) + ', ' + hm(t) };"],
  ['js', 'time axis 1a: no day bands', "    var db = single ? { bands: [{ w: '100%', label: dayOf(last.t) }], splits: [] } : dayBands(a0, a1);", "    var db = { bands: [], splits: [] };"],
  ['js', 'copy: the empty state without its full stop', "'No moves above your threshold in this window.';", "'No moves above your threshold in this window';"],
  ['css', 'tabs: the red underline back', "[data-page=\"drops\"] .do-tab.on { color: var(--text); border-bottom-color: var(--text); }", "[data-page=\"drops\"] .do-tab.on { color: var(--text); border-bottom-color: var(--neg); }"],
  ['css', 'rails: a blue selected fill', "[data-page=\"drops\"] .do-seg.on { font-weight: 700; color: var(--text); background: var(--selected); border-color: var(--edge-16); }", "[data-page=\"drops\"] .do-seg.on { font-weight: 700; color: var(--text); background: var(--bar); border-color: var(--edge-16); }"],
  ['css', 'rows: the meter track tinted red', "background: color-mix(in srgb, var(--text) 6%, transparent); overflow: hidden; flex: none; }", "background: color-mix(in srgb, var(--neg) 14%, transparent); overflow: hidden; flex: none; }"],
  ['css', 'menus: not the site filter menu', "box-shadow: var(--shadow-menu); padding: 4px;", "box-shadow: none; padding: 6px;"],
  ['css', 'search: an edge at rest', "  border-radius: 9px; background: var(--inner); border: 1px solid transparent; transition: border-color .14s ease;", "  border-radius: 9px; background: var(--inner); border: 1px solid var(--edge-10); transition: border-color .14s ease;"],
  ['css', 'tags: the blue-edged Sharp tag back', "border-radius: 4px; background: var(--inner); color: var(--text-label); border: none; }", "border-radius: 4px; background: var(--inner); color: var(--text-label); border: 1px solid var(--bar); }"],
  ['css', 'banner: a red fill', "  padding: 11px 16px; border-radius: 12px; background: var(--card); box-shadow: var(--top-light); border: none;", "  padding: 11px 16px; border-radius: 12px; background: color-mix(in srgb, var(--neg) 10%, transparent); box-shadow: var(--top-light); border: none;"],
  ['css', 'links: --link as an outline', ".do-ov-back { margin-left: auto; font-size: 11.5px; font-weight: 700; color: var(--link); cursor: pointer; }", ".do-ov-back { margin-left: auto; font-size: 11.5px; font-weight: 700; outline: 1px solid var(--link); cursor: pointer; }"],
  ['css', 'rows: a periwinkle hover ring', "[data-page=\"drops\"] .do-row:hover { border-color: var(--edge-16); }", "[data-page=\"drops\"] .do-row:hover { border-color: var(--open-card); }"],
  ['css', 'checkbox: a blue checked box', "[data-page=\"drops\"] .do-opt.on .do-box { background: var(--text); border-color: var(--text); }", "[data-page=\"drops\"] .do-opt.on .do-box { background: var(--bar); border-color: var(--bar); }"],
  ['css', 'box: the clicked book tinted red', ".do-ov-tr.sel:not(.own), .do-ov-tr.sel:not(.own):hover { background: var(--selected); border-color: var(--line); }", ".do-ov-tr.sel:not(.own), .do-ov-tr.sel:not(.own):hover { background: color-mix(in srgb, var(--neg) 10%, transparent); border-color: var(--line); }"],
  ['js', 'box: the own book unmarked', "(b.own ? ' own' : '') + '\" role=\"button\"", "'' + '\" role=\"button\""],
  // TEN-427 round 2 (founder 20de43fe)
  ['js', 'r2 ruling: an unknown row past its start (cut) listed again', "    if (r.liveAt || r.cutAt || r.status === 'in_play' || r.status === 'finished') return false;", "    if (r.status === 'in_play' || r.status === 'finished') return false;"],
  ['js', 'r2 ruling: a live sighting before the start keeps the row', "    if (r.liveAt || r.cutAt ||", "    if (r.cutAt ||"],
  ['js', 'r2 ruling: a row stays past its start', "    return t != null && now != null && t > now;", "    return t == null || now == null || t > now - 6 * H;"],
  ['js', 'r2 ruling: the Matches control back', "      '</div>';\n  }\n\n  function seg(", "      '<div class=\"do-rail do-views\"><span class=\"do-rail-k\">MATCHES</span></div></div>';\n  }\n\n  function seg("],
  ['js', 'r2 fix 8: no name canon (hyphens kept)', "    try { s = typeof ocsNfd === 'function' ? ocsNfd(n) : null; } catch (e) { s = null; }", "    s = fold(n);"],
  ['js', 'r2 fix 8: index words in one order only', "      var k = canonToks(p && p.name).sort().join(' ');", "      var k = canonToks(p && p.name).join(' ');"],
  ['js', 'r2 fix 8: a name two keys share still keyed', "      if (k) map[k] = map[k] === undefined ? { key: String(p.key), name: String(p.name) } : null;", "      if (k) map[k] = { key: String(p.key), name: String(p.name) };"],
  ['js', 'r2 fix 8: the feed\'s casing kept ("Mccormick")', "      if (c(hit.name) === c(s)) s = hit.name;\n", ""],
  ['js', 'r2 fix 8: the long name, not the site\'s short form', "    return abbrev ? abbrev(s) : s;", "    return s;"],
  ['js', 'r2 fix 10: the four unrecorded market tabs back', "  var MARKETS = [['mw', 'Match winner']];", "  var MARKETS = [['mw', 'Match winner'], ['sh', 'Set handicap'], ['gh', 'Game handicap'], ['tg', 'Total games'], ['ts', 'Total sets']];"],
  ['js', 'r2 fix 10: All markets is not the sum', "    var sum = loaded ? String(MARKETS.reduce(function (s, m) { return s + (v.mkCount[m[0]] || 0); }, 0)) : '—';", "    var sum = '—';"],
  ['js', 'r2 fix 11: the axis goes under 1.00', "    lo = Math.max(1, lo);", "    lo = lo;"],
  ['js', 'r2 fix 12: "First seen" back on the chip', "132px))\">' + openHelp('do-ov-help', 'do-ov-tip') + ' <span>'", "132px))\">' + (sel.opener ? 'Open' : 'First seen') + ' <span>'"],
  ['js', 'r2 fix 12: the box table head without its tooltip', "<span class=\"r do-ov-hr\">' + openHelp('do-ov-help', 'do-ov-tip') + ' → Now</span>", "<span class=\"r do-ov-hr\">OPEN → Now</span>"],
  ['css', 'r2 fix 12: the box tooltip never shows', ".do-ov-help:hover + .do-ov-tip { display: block; }", ".do-ov-help:hover + .do-ov-tip { display: none; }"],
  ['js', 'r2 fix 13: a later Pinnacle source overwrites the first', "        if (had && had.rank <= hb.rank) return;   // one line per book: the first source in its list with a price\n", ""],
  ['js', 'r2 fix 13: the stored source label shown as the book', "      if (k >= 0) return { name: B[i].name, rank: k, order: i, src: s };", "      if (k >= 0) return { name: s, rank: k, order: i, src: s };"],
  ['js', 'r2 fix 16: tournaments promised though rows carry no event', "    var ph = up.length && up.every(function (r) { return !!r.event; }) ? 'Search players or tournaments' : 'Search players';", "    var ph = 'Search players or tournaments';"],
  ['js', 'r2 fix 16: tournaments never offered', "    var ph = up.length && up.every(function (r) { return !!r.event; }) ? 'Search players or tournaments' : 'Search players';", "    var ph = 'Search players';"],
  // TEN-427 round 3 (founder 393874e7)
  ['js', 'r3 item 4: the "Live · updated" tail back in the header', "Biggest drops first.</span></p></div>' +", "Biggest drops first.</span> <span class=\"sfh__tail\">· Live · updated</span></p></div>' +"],
  ['css', 'r3 item 5: the row open not struck', "color: var(--text-label); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--neg) 60%, transparent); }   /* r3 item 5", "color: var(--text-label); }   /* r3 item 5"],
  ['css', 'r3 item 5: the box header open not struck', ".do-ov-open { font-size: 15px; color: var(--text-label); text-decoration: line-through;", ".do-ov-open { font-size: 15px; color: var(--text-label); text-decoration: none;"],
  ['css', 'r3 item 5: the strike in grey, not the reference\'s red', ".do-ov-to { font-size: 11px; color: var(--text-label); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--neg) 60%, transparent); }", ".do-ov-to { font-size: 11px; color: var(--text-label); text-decoration: line-through; text-decoration-color: var(--text-label); }"],
  ['js', 'r3 item 6: the TYPE chip column back', "              '<span class=\"do-ov-tb\"><span class=\"n\"><span>'", "              '<span class=\"do-ov-tt\"><span>TYPE</span></span><span class=\"do-ov-tb\"><span class=\"n\"><span>'"],
  ['js', 'r3 item 6: no Sharp / Soft group labels', "        return '<div class=\"do-ov-grp\"><span class=\"do-ov-grk\">' + (g === 'sharp' ? 'Sharp' : 'Soft') + '</span><span class=\"do-ov-grl\"></span></div>' +", "        return '' +"],
  ['js', 'r3 item 6: the "from" wording back', "'<span class=\"do-ov-to\">' + price2(b.first.v) + '</span>'", "'<span class=\"do-ov-to\">from ' + price2(b.first.v) + '</span>'"],
  ['css', 'r3 item 6: the five-column grid back', ".do-ov-th, .do-ov-tr { display: grid; grid-template-columns: minmax(0,1fr) 120px 84px; gap: 12px; }", ".do-ov-th, .do-ov-tr { display: grid; grid-template-columns: 48px minmax(0,1fr) 64px 84px 76px; gap: 12px; }"],
  ['js', 'r3 item 7: a lengthening a muted ▲ again', "    if (d < 0) return { txt: '+' + Math.abs(d).toFixed(1) + '%', c: 'pos' };", "    if (d < 0) return { txt: '▲ ' + Math.abs(d).toFixed(1) + '%', c: 'muted' };"],
  ['css', 'r3 item 7: the drift grey, not --pos', ".do-ov-td.pos { color: var(--pos); }", ".do-ov-td.pos { color: var(--text-label); }"],
  ['js', 'r3 item 8: "Latest HH:MM" back', "    return { label: 'Now', t: lt,", "    return { label: 'Latest ' + hm(lt), t: lt,"],
  ['js', 'r3 item 9: no dashed carry to the axis end', "    var ext = !single && extT > endT ?", "    var ext = false ?"],
  ['js', 'r3 item 9: the carry interpolated toward the open', "{ x1: fx(endT).toFixed(1), x2: fx(extT).toFixed(1), y: (pY(last.v) * 300).toFixed(1) }", "{ x1: fx(endT).toFixed(1), x2: fx(extT).toFixed(1), y: (pY(rec[0].v) * 300).toFixed(1) }"],
  ['js', 'r3 item 9: the end dot left at the last snapshot', "(fx(ext ? extT : endT) / 10)", "(fx(endT) / 10)"],
  ['js', 'r3 item 9: the axis ends at each book\'s last snapshot', "axisT: now != null && now > lt ? now : lt, confirmed: lt > last.t };", "axisT: lt, confirmed: lt > last.t };"],
  ['css', 'r3 item 9: the carry drawn solid', ".do-ov-plot .do-ext { stroke: var(--neg); stroke-width: 2.6; stroke-dasharray: 5 6;", ".do-ov-plot .do-ext { stroke: var(--neg); stroke-width: 2.6; stroke-dasharray: none;"],
  // review of 52050426c (round-3 review fixes)
  ['js', 'r3 review 1: a cut row\'s axis runs on to the live start', "      return { label: 'Last pre-match', t: ct, v: last.v, axisT: ct, confirmed: seenOk };", "      return { label: 'Last pre-match', t: ct, v: last.v, axisT: Math.max(ct, cut), confirmed: seenOk };"],
  ['js', 'r3 review 1: a "Last pre-match" end carries dashed', "    var extT = end && end.label === 'Last pre-match' ? endT : a1;", "    var extT = a1;"],
  ['js', 'r3 review 2: the carry crosses a recorded gap', "      if (he > endT && h[0] < extT) extT = Math.max(endT, h[0]);\n", ""],
  ['js', 'r3 review 2: the end dot at the axis end past a gap', "(fx(ext ? extT : endT) / 10)", "(fx(ext ? a1 : endT) / 10)"],
  ['js', 'r3 review 3: flat reads "0.0%", not the move view\'s', "    if (Math.abs(d) < 0.05) return { txt: zeroTxt(), c: 'muted' };", "    if (Math.abs(d) < 0.05) return { txt: '0.0%', c: 'muted' };"],
  ['js', 'r3 review 3: one recorded price reads a zero move', "    if (onePrice) return { txt: 'one price', c: 'muted' };\n", ""],
  ['js', 'r3 review 3: no book is ever flagged one-price', "single: !b.side || b.side.length < 2,", "single: false,"],
  ['js', 'r3 review 3: a one-price book shows its price as the open', "(!b.single && b.first && b.first.v != null ?", "(b.first && b.first.v != null ?"],
  ['js', 'ship 1: a confirmed one-price book keeps the Open chip', "      hasOpen: !single && openV != null && rec.length > 1,", "      hasOpen: !single && openV != null,"],
  ['js', 'ship 2: the box infers a round from the board', "roundBadgeText(card.tournamentRound) : null;", "roundBadgeText(card.tournamentRound || (board().filter(function (m) { return m.tour === card.tour && m.tournamentRound; })[0] || {}).tournamentRound) : null;"],
  ['js', 'ship 2: the box drops the card\'s own round', "roundBadgeText(card.tournamentRound) : null;", "null : null;"],
  ['phb', 'Data 4: the pop-up stops lending its history reader', " fetchShard, fetchHistory, changesOnly,", " fetchShard, changesOnly,"],
];
const SUITES = ['test-ten427-drops.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 90000 });
// Control: the unmutated files must pass, or every "caught" below means nothing.
const ctl = run({});
if (ctl.status !== 0) { console.error('control run failed:\n' + ctl.stdout.slice(-3000) + ctl.stderr.slice(-2000)); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten427d-'));
let survived = 0;
for (const [file, name, from, to] of MUTANTS) {
  const n = SRC[file].split(from).length - 1;
  if (n !== 1) { console.error(`ANCHOR (${n}x) ${name}`); survived++; continue; }
  const p = path.join(tmp, path.basename(FILES[file]));
  fs.writeFileSync(p, SRC[file].replace(from, to));
  const r = run({ [ENV[file]]: p });
  if (r.status === 0) { console.error('SURVIVED ' + name); survived++; } else console.log('caught   ' + name);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${MUTANTS.length - survived}/${MUTANTS.length} mutants caught`);
process.exit(survived ? 1 : 0);
