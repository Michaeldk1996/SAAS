// TEN-332 — every check in test-ten332-tournament.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html (TEN332_HTML) or player-profile-v2.js (TEN332_PP2) and the suite is run
// against it; a mutant that leaves the suite green is a vacuous test and fails this runner. Anchors must occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { html: 'bsp-consult-dashboard.html', pp2: 'player-profile-v2.js' };
const ENV = { html: 'TEN332_HTML', pp2: 'TEN332_PP2' };
const MUTANTS = [
  ['N6: a synthesised Withdrawal edition renders', "  const years = ((hist && hist.years) || []).filter(y => !y.withdrew);", "  const years = ((hist && hist.years) || []);"],
  ['result: a won final not "Won"', "    else if (last.won && lastRd === 'F') result = 'Won';", "    else if (false) result = 'Won';"],
  ['result: an in-progress edition labelled by its last round', "    else if (String(y.year) === mYear) result = 'In progress';", "    else if (String(y.year) === mYear && !m.finalScore) result = 'In progress';"],
  ['N2: a set-less history row read as a walkover', "  if (r.wo){ r.wo = false; r.ret = true; r.retSettle = true;", "  if (false){ r.wo = false; r.ret = true; r.retSettle = true;"],
  ["join: the season + opponent fallback takes another event's row", "      && trSameEvent(c.tournament, names)\n", ""],
  ['rows: group meta loses the W–L', "meta: e.result + ' · ' + e.won + '–' + e.lost,", "meta: e.result,"],
  ['gate: the W–L % ungated (0% at n 0, % below n 5)', "  const wlRate = maRateHtml(P.W, P.n, { note: 'title', nopct: '' });", "  const wlRate = (P.n ? Math.round(P.W / P.n * 100) : 0) + '%';"],
  ["sets: a retirement's unfinished set counted", "  eds.forEach(e => e.rows.forEach(r => { if (r.pS != null && !r.wo){ sW += r.pS; sT += r.pS + r.oS; } }));", "  eds.forEach(e => e.rows.forEach(r => { if (r.sets){ sW += r.sets.filter(x => x[0] > x[1]).length; sT += r.sets.length; } else if (r.pS != null){ sW += r.pS; sT += r.pS + r.oS; } }));"],
  ['best: an in-progress edition counts as a result', "    const code = e.result === 'Won' ? 'Won' : e.rows.length && !e.rows[0].won ? e.rows[0].round : null;", "    const code = e.result === 'Won' ? 'Won' : e.rows.length ? e.rows[0].round : null;"],
  ['backing: Pinnacle only (the Bet365 fallback dropped)', "  const priced = core ? all.filter(core.inWinner) : [];", "  const priced = core ? all.filter(r => core.inWinner(r) && r.book === 'P') : [];"],
  ['backing: a retirement not settled at the close', "  const priced = core ? all.filter(core.inWinner) : [];", "  const priced = core ? all.filter(r => core.inWinner(r) && !r.ret) : [];"],
  ['vm: shown below n 5', "    const vmTxt = np >= TR_VS_MKT_MIN && P.vm != null", "    const vmTxt = np >= 1 && P.vm != null"],
  ['vm: implied rate not de-vigged', "  const exp = priced.reduce((s, r) => s + (1 / r.price) / ((1 / r.price) + (1 / r.oppPrice)), 0);", "  const exp = priced.reduce((s, r) => s + (1 / r.price), 0);"],
  ['backing: the TEN-325 note dropped', "<span data-ret-note=\"tournament\">${fhEsc(core ? core.RET_SETTLE_NOTE : '')}</span>", ""],
  ["N4: the design's AS cut-offs back", "    ? Number(cs.abstractSpeed).toFixed(2) + (cs.category ? ' · ' + cs.category : '')", "    ? Number(cs.abstractSpeed).toFixed(2) + ' · ' + (cs.abstractSpeed < 0.9 ? 'Slow' : cs.abstractSpeed < 1.15 ? 'Medium' : 'Fast')"],
  ['TEN-321: Roland Garros dash loses its reason', "function trSpeedNote(m){ return trIsRG(m) ? TR_RG_NOTE : TR_NO_SPEED; }", "function trSpeedNote(m){ return TR_NO_SPEED; }"],
  ['the reading paragraph back (placeholder copy)', "      ${trHeaderHtml(m)}${toggle}", "      ${trHeaderHtml(m)}<div>Read the records below with that in mind.</div>${toggle}"],
  ['trend: a missing season interpolated', "  pts.forEach(p => { if (p.v != null) cur.push(p); else { if (cur.length) segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur);", "  segs.push(pts.filter(p => p.v != null));"],
  ['trend: the delta claims seven years', "    delta = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2) + ' over ' + yrs + ' yr' + (yrs === 1 ? '' : 's');", "    delta = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2) + ' over 7 yrs';"],
  ['ROI: a card clickable with no archive names', "  const openable = !!(mkt && mkt.archiveNames && mkt.archiveNames.length);\n  const roiCard", "  const openable = !!mkt;\n  const roiCard"],
  ['ROI: a small-n yield in full colour', "    const col = !has || g === 'small' ? MA_GREY :", "    const col = !has ? MA_GREY :"],
  ['DoD 8: a row stops opening the sheet', "    cls: 'tr-row', attrs: ` data-fh-mid=\"${fhEsc(r.mid)}\"`, click: ` onclick=\"fhOpenSheet('${fhEsc(r.mid)}')\"`,", "    cls: 'tr-row', attrs: ` data-fh-mid=\"${fhEsc(r.mid)}\"`, click: '',"],
  ['DoD 8: a tab-local row renderer again', "function trRowData(r){", "function atournMatchRowHtml(x){ return ''; }\nfunction trRowData(r){"],
  ['more: "1 earlier editions"', "(P.eds.length - TR_LIM === 1 ? '' : 's')", "'s'"],
  ['N5 (profile): per-event Backing back to Pinnacle only', "      if (r.inBasis && r.pl != null && isFinite(r.pl)) { b.pinPl += r.pl; b.pinN++; }", "      if (r.book === 'pinnacle' && r.pl != null && isFinite(r.pl)) { b.pinPl += r.pl; b.pinN++; }", 'pp2'],
];
const SUITES = ['test-ten332-tournament.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env || {}), encoding: 'utf8' });
if (run().status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated page passes');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten332-mut-'));
for (const [name, from, to, which] of MUTANTS) {
  const k = which || 'html', src = fs.readFileSync(path.join(ROOT, FILES[k]), 'utf8');
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm-' + k);
  fs.writeFileSync(file, src.replace(from, to));
  if (run({ [ENV[k]]: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
