// TEN-402 round 2, builder L — the Database join loads after the profile shows (founder card 7bc622d5). Every check in
// test-ten402-r2l.mjs that locks the rule must FAIL when the rule is reverted: each mutant is applied to a copy of
// bsp-consult-dashboard.html (TEN402_HTML) or player-profile-v2.js (TEN402_PP2) and the suite runs against it; a mutant
// that leaves it green is a vacuous test and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SRC = { html: path.join(ROOT, 'bsp-consult-dashboard.html'), pp2: path.join(ROOT, 'player-profile-v2.js') };
const ENV = { html: 'TEN402_HTML', pp2: 'TEN402_PP2' };
const MUTANTS = [
  ['the click-time profile loads request the join again (before the first paint)', 'html',
    '[loadCareerHistory(k), fhLoadCloses(k), tourxFetchMarket()].map(', '[loadCareerHistory(k), fhLoadCloses(k), tourxFetchMarket(), sfDbJoinLoad()].map('],
  ['reading the model starts the fetch again (the first render pulls it)', 'html',
    "  if (!(k in _careerHistoryShards) || _sfDbJoinSt !== 'ready') return null;\n  const ch = _careerHistoryShards[k] || [];",
    "  if (_sfDbJoinSt == null) sfDbJoinLoad().catch(() => {});\n  if (!(k in _careerHistoryShards) || _sfDbJoinSt !== 'ready') return null;\n  const ch = _careerHistoryShards[k] || [];"],
  ['the mount requests the join at once (before the paint)', 'html',
    '  pp2DbJoinAfterPaint(key);   // TEN-402 R2', '  pp2DbJoinNeed(key);   // TEN-402 R2'],
  ['the mount never requests the join (the tile stays pending until a click)', 'html',
    '  pp2DbJoinAfterPaint(key);   // TEN-402 R2: the Database join is requested only after this paint\n', ''],
  ['no wait for the paint / idle', 'html', '  requestAnimationFrame(() => requestAnimationFrame(idle));', '  go();'],
  ['one frame instead of two (requested in the paint\'s own frame)', 'html', '  requestAnimationFrame(() => requestAnimationFrame(idle));', '  requestAnimationFrame(idle);'],
  ['a profile left before idle still pulls the join', 'html', '  const go = () => { if (ppState.key === k) pp2DbJoinNeed(k); };', '  const go = () => pp2DbJoinNeed(k);'],
  ['no repaint when the join lands', 'html', '  p.then(() => pp2RepaintIfOpen(k), () => pp2RepaintIfOpen(k));', '  p.catch(() => {});'],
  ['a failed load is never retried (the promise is kept)', 'html',
    "    .catch(e => { _sfDbJoinSt = 'failed'; _sfDbJoinP = null; throw e; });", "    .catch(e => { _sfDbJoinSt = 'failed'; throw e; });"],
  ['each ask recomputes the join (no session cache)', 'html',
    "  if (_sfDbJoinSt === 'ready' || _sfDbJoinSt === 'loading') return false;\n  const k = String(key == null ? ppState.key : key);",
    "  _sfDbJoinP = null;\n  const k = String(key == null ? ppState.key : key);"],
  ['the Database page fetches its file again (no session cache)', 'html', '    if(basePromise) return basePromise;\n', ''],
  ['the Backing column dashes while loading', 'pp2',
    "(t.backingPending ? BACKING_PEND_HTML : pin == null ? DASH : t.pinTxt || signed(pin, 1, 'u'))", "(pin == null ? DASH : t.pinTxt || signed(pin, 1, 'u'))"],
  ['the column prints 0 while loading', 'pp2',
    "(t.backingPending ? BACKING_PEND_HTML : pin == null ? DASH : t.pinTxt || signed(pin, 1, 'u'))", "(t.backingPending ? signed(0, 1, 'u') : pin == null ? DASH : t.pinTxt || signed(pin, 1, 'u'))"],
  ['the "Backing him here" tile dashes while loading', 'pp2',
    "    var pinTxt = t.backingPending ? BACKING_PEND_HTML : t.pinN ? t.pinTxt || signed(t.pinPl, 1, 'u') : DASH;",
    "    var pinTxt = t.pinN ? t.pinTxt || signed(t.pinPl, 1, 'u') : DASH;"],
  ['the rows\' H dash while loading', 'pp2', "t.backingPending ? BACKING_PEND_HTML : pxAfterHtml(m) || oddsText(m.price)", 'oddsText(m.price)'],
  ['opening Record per tournament does not ask for the join', 'pp2', " if (state.modal === 'tourn') tournNeedJoin();", ''],
  ['every box asks for the join', 'pp2', " if (state.modal === 'tourn') tournNeedJoin();", ' tournNeedJoin();'],
  ['opening an event does not ask for the join', 'pp2', "el.getAttribute('data-t')); tournNeedJoin(); }", "el.getAttribute('data-t')); }"],
  // ---- R3 (2026-10-09)
  ['R3 fix 1: H2H keeps its own state again (a failed load is final; a join another surface loaded is never read)', 'html',
    "    if (st === 'ready' && _sfDbJoin) { _h2hDb = _sfDbJoin; _h2hDbSt = 'ready'; return; }",
    "    if (_h2hDbSt === 'ready' || _h2hDbSt === 'failed') return;"],
  ['R3 fix 1: no retry throttle (the render after a failure fetches again — a loop)', 'html',
    "if (Date.now() - _h2hDbAskAt < H2H_DB_RETRY_MS) return; }", "}"],
  ['R3 fix 1: a failed join is never asked again from H2H (no retry at all)', 'html',
    "if (Date.now() - _h2hDbAskAt < H2H_DB_RETRY_MS) return; }", "return; }"],
  ['R3 fix 1: a visit does not clear the throttle', 'html',
    "    if (visit) _h2hDbAskAt = 0;   // TEN-402 R3 fix 1", "    // TEN-402 R3 fix 1"],
  ['R3 fix 1: every ensureInit (loadMatches\' hand-back too) counts as a visit', 'html',
    "    if (visit) _h2hDbAskAt = 0;   // TEN-402 R3 fix 1", "    _h2hDbAskAt = 0;   // TEN-402 R3 fix 1"],
  ['R3 fix 1: a load another surface started never repaints the page', 'html',
    "    p.then(() => { h2hEnsureDb(); render(); })", "    p.then(() => {})"],
  ['R3 fix 1: a repaint per render while loading (no once-per-load guard)', 'html',
    "    if (_h2hDbWait === p) return;   // one repaint per load\n", ""],
  ['R3 fix 2: the box falls back to the W–L rate on a failed join', 'pp2',
    "      : tournBackingFailed(p) ? { headline: null, support: BACKING_FAIL_TXT, failed: true }\n", ""],
  ['R3 fix 2: the box dashes on every answered join', 'pp2',
    "    return (tournViews(p) || []).some(function (t) { return t.backingFailed; });", "    return true;"],
  ['R3 fix 3: the H cell drops the reason', 'pp2',
    "t.backingPending ? BACKING_PEND_HTML : pxAfterHtml(m) || oddsText(m.price)", "t.backingPending ? BACKING_PEND_HTML : oddsText(m.price)"],
  ['R3 fix 3: the A cell drops the reason', 'pp2',
    "t.backingPending ? BACKING_PEND_HTML : pxAfterHtml(m) || oddsText(m.oppPrice)", "t.backingPending ? BACKING_PEND_HTML : oddsText(m.oppPrice)"],
  ['R3 fix 3: a priced row after the end prints the reason instead of its price', 'pp2',
    "    if (!m || m.price != null) return null;", "    if (!m) return null;"],
  ['R3 fix 3: the archive\'s last day itself counts as after it', 'html',
    "  return end && date && String(date).slice(0, 10) > end ? trPxAfterTitle() : null;", "  return end && date && String(date).slice(0, 10) >= end ? trPxAfterTitle() : null;"],
  ['R3 fix 3: the reason before the join answered (no end date yet → every row)', 'html',
    "  return end && date && String(date).slice(0, 10) > end ? trPxAfterTitle() : null;", "  return date && (!end || String(date).slice(0, 10) > end) ? trPxAfterTitle() : null;"],
  ['R3 fix 3: the profile words its own copy of the reason', 'pp2',
    "    var why = typeof window.trPxAfterOf === 'function' ? window.trPxAfterOf(m.date) : null;", "    var why = typeof window.trPxAfterOf === 'function' && window.trPxAfterOf(m.date) ? 'After the archive: no closing price yet' : null;"],
];
const SUITE = path.join(ROOT, 'test-ten402-r2l.mjs');
const run = env => spawnSync(process.execPath, ['--test', SUITE], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated sources — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated sources pass');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten402r2l-mut-'));
for (const [name, which, from, to] of MUTANTS) {
  const src = fs.readFileSync(SRC[which], 'utf8');
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm-' + path.basename(SRC[which]));
  fs.writeFileSync(file, src.replace(from, to));
  if (run({ [ENV[which]]: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
