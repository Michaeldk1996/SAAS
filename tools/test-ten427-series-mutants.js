// TEN-427 step 14 (Series) — every check in test-ten427-series.mjs must FAIL when its rule is reverted or bent.
// Each mutant is applied to a copy of series.js (TEN427S_SRC), series.css (TEN427S_CSS) or build-series.js
// (TEN427S_ENGINE, written beside the original so its relative requires resolve) and the suite runs against it; a
// mutant that leaves it green is a vacuous test and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { js: path.join(ROOT, 'series.js'), css: path.join(ROOT, 'series.css'), eng: path.join(ROOT, 'build-series.js') };
const SRC = { js: fs.readFileSync(FILES.js, 'utf8'), css: fs.readFileSync(FILES.css, 'utf8'), eng: fs.readFileSync(FILES.eng, 'utf8') };
const MUTANTS = [
  ['js', 'Data 2: a match outside Today / Tomorrow keeps its card', "if (day !== 'today' && day !== 'tomorrow') return null;", 'if (!day) return null;'],
  ['js', 'Data 2: the raw feed event, not the canonical name', 'event: eventLabel(bm ? bm.tour : u.tournament),', 'event: (bm ? bm.tour : u.tournament),'],
  ['js', 'Round 3 item 2: "v" instead of the reference\'s "vs"', "html += '<span class=\"sr-next-opp\"> · vs ' +", "html += '<span class=\"sr-next-opp\"> · v ' +"],
  ['js', 'Data 2: the Next line loses the card time', "var full = [when + (s.clock ? ' ' + s.clock : '')];", "var full = [when];"],
  ['js', 'Data 3: Level not wired', "    if (f.level !== 'all' && p.tier !== f.level) return false;", ''],
  ['js', 'Data 3: Day not wired', "    if (f.day !== 'all' && s.day !== f.day) return false;", ''],
  ['js', 'Data 3: Show already-played SELECTS played instead of including them', 'if (!f.showPlayed && s.played) return false;', 'if (f.showPlayed ? !s.played : s.played) return false;'],
  ['js', 'Data 3: a started board match is not "played"', 'var started = bm ? !!(bm.live || bm.interrupted) :', 'var started = bm ? false :'],
  ['js', 'Data 3: a finished board match is not "played"', 'var finished = bm ? (typeof isFinishedMatch', 'var finished = bm ? false && (typeof isFinishedMatch'],
  ['js', 'Data 3: Soonest sorts the time string', 'var ka = a.slot && a.slot.startMs != null ? a.slot.startMs : Infinity;', 'var ka = -a.streak.count;'],
  ['js', 'Header: Updated = the clock', 'var upd = fmtUpdated(_data && _data.generatedAt);', 'var upd = zoneClock(Date.now());'],
  ['js', 'Header: Updated in UTC', "var tz = (typeof newsTz === 'function' && newsTz()) || undefined;", "var tz = 'UTC';"],
  ['js', 'Header: Longest run not white', "longest != null ? '' : ' sfh__v--none')", "longest != null ? ' sfh__v--soft' : ' sfh__v--none')"],
  ['js', 'Header: the old one-line sentence', "var SUBTITLE = 'Current streaks for players scheduled today and tomorrow, each with the pool it was drawn from and the date of its latest match.';", "var SUBTITLE = 'Current streaks for players scheduled today and tomorrow.';"],
  ['js', 'Filters: Type counts follow the Type filter', 'if (!passesFilters(c, true)) return;', 'if (!passesFilters(c, false)) return;'],
  ['js', 'Card: a photo instead of initials', "'<span class=\"sr-ava\">' + esc(initialsOf(name)) + '</span>'", "'<img class=\"sr-ava\" src=\"https://randomuser.me/api/portraits/men/1.jpg\">'"],
  ['js', 'Card: direction read off the raw direction (lines lose Neutral)', 'esc(DIR_LABEL[valence(st)])', 'esc(DIR_LABEL[st.direction])'],
  ['js', 'Card: Started loses its year', 'var startTxt = fmtShort(startedOf(st), true);', 'var startTxt = fmtShort(startedOf(st), false);'],
  ['js', 'Data 5: Avg price from the Away price', 'if (rows[i].price != null) { sumC += cents(rows[i].price); n++; }', 'if (rows[i].price != null) { sumC += cents(rows[i].oppPrice); n++; }'],
  ['js', 'Data 5: the ledger total on unrounded rows', 'totalC += r.won ? (cents(r.price) - 100) : -100;', 'totalC += r.won ? (r.price - 1) * 100 + 0.4 : -100;'],
  ['js', 'Data 5: "{n} priced" counts every row', "var right = '<span class=\"sr-ov-total-k\">' + esc(String(n)) + ' priced</span>';", "var right = '<span class=\"sr-ov-total-k\">' + esc(String(rows.length)) + ' priced</span>';"],
  ['js', 'Data 5: a P&L on a line family', 'if (isResult && _pxState !== \'idle\'', 'if (_pxState !== \'idle\''],
  ['js', 'Data 5: rows not priced on the Database join', '        trDbJoinPx(displayName(p.key, p.name), pc[1])(list);\n', '\n'],
  ['js', 'Data 5: a failed join says nothing', '>Prices unavailable<', '>0 priced<'],
  ['js', 'Data 5: the after-archive reason dropped', "r.book ? r.book + ' closing' : after;", "r.book ? r.book + ' closing' : null;"],
  ['js', 'Type: a hyphen in scores', "'<span class=\"sr-mscore\">' + (r.score ? esc(scoreTxt(r.score)) : DASH)", "'<span class=\"sr-mscore\">' + (r.score ? esc(r.score) : DASH)"],
  ['js', 'Type: a hyphen-minus in P&L', "return (v > 0 ? '+' : (v < 0 ? '−' : '')) + Math.abs(v).toFixed(dp);", "return (v > 0 ? '+' : (v < 0 ? '-' : '')) + Math.abs(v).toFixed(dp);"],
  ['js', 'Pop-up: the pool replaced by the count', "' of ' + esc(String(st.pool)) + ' ' +", "' of ' + esc(String(st.count)) + ' ' +"],
  ['js', 'Copy: "pre-match" back in the footnote', 'Prices are closing prices, flat 1 unit per match.', 'Prices are pre-match prices, flat 1 unit per match.'],
  ['js', 'Copy: the empty-state sentence', "'<div class=\"sr-empty\"><span>No streaks match these filters.</span>'", "'<div class=\"sr-empty\"><span>No streaks match.</span>'"],
  ['js', 'Copy: Clear resets only the Type tab', 'Object.keys(DEFAULTS).forEach(function (k) { _filters[k] = DEFAULTS[k]; });', '_filters.type = DEFAULTS.type;'],
  ['css', 'Colour: a blue fill on the selected segment', '[data-page="series"] .sr-segbtn.active { background: var(--selected);', '[data-page="series"] .sr-segbtn.active { background: var(--bar);'],
  ['css', 'Cards: an outline back, radius 14', 'background: var(--card); box-shadow: var(--top-light); border: 1px solid transparent; border-radius: 16px;\n  padding: 18px 20px 6px;', 'background: var(--card); box-shadow: var(--top-light); border: 1px solid var(--edge-6); border-radius: 14px;\n  padding: 18px 20px 6px;'],
  ['css', 'Cards: a blue hover edge', '[data-page="series"] .sr-card.sr-has-detail:hover { border-color: var(--edge-16); }', '[data-page="series"] .sr-card.sr-has-detail:hover { border-color: var(--link); }'],
  ['css', 'Colour: green on a card', '[data-page="series"] .sr-claimsub { font-size: 12px; color: var(--text-label); }', '[data-page="series"] .sr-claimsub { font-size: 12px; color: var(--pos); }'],
  ['css', 'Round 3 item 2: the Next line in the label grey, not the reference\'s soft grey', 'text-overflow: ellipsis; font-size: 12.5px; color: var(--text-soft); }', 'text-overflow: ellipsis; font-size: 12.5px; color: var(--text-label); }'],
  ['css', 'Checkbox: a blue checked fill', '[data-page="series"] .sr-toggle input:checked + .sr-box { background: var(--text);', '[data-page="series"] .sr-toggle input:checked + .sr-box { background: var(--bar);'],
  ['css', 'Pop-up: the scrim is not navy 62%', 'background: color-mix(in srgb, var(--page) 62%, transparent);', 'background: var(--backdrop);'],
  ['css', 'Hairlines: 5% instead of 6% on the card rows', 'padding: 9px 0; border-top: 1px solid var(--edge-6);\n}', 'padding: 9px 0; border-top: 1px solid var(--line);\n}'],
  ['eng', 'Generator: retirements skipped again', "if (fx.event_status !== 'Finished' && fx.event_status !== 'Retired') return null;", "if (fx.event_status !== 'Finished') return null;"],
  ['eng', 'Generator: a walkover counts', "if (fx.event_status !== 'Finished' && fx.event_status !== 'Retired') return null;", "if (fx.event_status !== 'Finished' && fx.event_status !== 'Retired' && fx.event_status !== 'Walk Over') return null;"],
  ['eng', 'Generator: a retirement before a game counts', "  if (fx.event_status === 'Retired' && !scoreLine) return null;   // retired before a game: not a match played\n", ''],
  ['js', 'Data 5: a negative yield rounds toward zero', 'yield: halfAway(10 * totalC / priced) / 10,', 'yield: Math.round(10 * totalC / priced) / 10,'],
  ['js', 'Data 5: a failed join reads as unpriced on the card', '<span class="sr-dash" title="Prices unavailable">—</span>', '<span class="sr-dash">—</span>'],
  ['js', 'Data 5: a failed join is never retried', "    if (_pxState === 'failed' && Date.now() - _pxFailAt > PX_RETRY_MS) priceBoard();   // retry a failed join\n", ''],
  ['js', 'Slate: slots computed once (a page show keeps the stale already-played)', '      reslot();\n      render();\n      if (_data', '      render();\n      if (_data'],
  ['js', 'Slate: the 5-minute tick does not recompute the slots', '    if (!_active) return;\n    reslot();\n', '    if (!_active) return;\n'],
  ['js', 'Slate: series.json never refetched', 'Date.now() - _loadedAt > DATA_MAX_AGE_MS) fetchData();', 'false) fetchData();'],
  ['eng', 'Generator: a retirement typed off the winner\'s set count (Slam "6-3 6-2 ret" = bo3)', 'if (altFormat || !complete) bestOf = null;', 'if (altFormat) bestOf = null;'],
  // round 2 (founder 20de43fe)
  ['js', 'Fix 1: the streak is not cut at the next match\'s start', 'c.streak = shownStreak(c);', 'c.streak = c.base;'],
  ['js', 'Fix 1: a run under the min-length floor after the cut still shows', '    if (keep.length < minLen) return null;\n', ''],
  ['js', 'Fix 1: a run under the pool floor after the cut still shows', "    if (famOf(st) !== 'all' && typeof pool === 'number' && pool < minPool) return null;\n", ''],
  ['js', 'Fix 1: the pool keeps the cut rows', "var pool = (typeof st.pool === 'number') ? st.pool - dropped : st.pool;", 'var pool = st.pool;'],
  ['js', 'Fix 1: Last stays the engine\'s', 'out.lastDate = last.date || null;', 'out.lastDate = st.lastDate;'],
  ['js', 'Fix 1: no date rule when the run lacks the match key', 'if (slot.played && d === day) {', 'if (false) {'],
  ['js', 'Fix 1: a same-day row before an unstarted match is cut', 'if (d > day) { cut = i; break; }', 'if (d >= day) { cut = i; break; }'],
  ['js', 'Fix 2: the claim drops "N straight"', "function straightOf(st) { return streakVerb(st.direction) + ' ' + esc(String(st.count)) + ' straight'; }", 'function straightOf(st) { return streakVerb(st.direction); }'],
  ['js', 'Fix 2: the handicap claim off the reference template', "? 'Won by more than ' + esc(String(st.line)) + ' games — covered −' + esc(String(st.line))", "? 'Covered −' + esc(String(st.line)) + ' games'"],
  ['js', 'Fix 3: the Next line has no full-string tooltip', "'<span class=\"sr-next\" title=\"' + esc('Next ' + full.join(' · ')) + '\">", "'<span class=\"sr-next\" title=\"' + esc('Next') + '\">"],
  ['js', 'Round 3 item 2: the event cut inside (ellipsis) instead of dropped whole', '      if (ev && el.scrollWidth > el.clientWidth) ev.remove();', "      if (ev && el.scrollWidth > el.clientWidth) ev.textContent = ev.textContent.slice(0, 4) + '…';"],
  ['js', 'Round 3 item 2: the event never dropped (no fit pass)', '    fitNextLines(root);\n', '\n'],
  ['js', 'Round 3 item 2: the event dropped from every line, fitting or not', '      if (ev && el.scrollWidth > el.clientWidth) ev.remove();', '      if (ev) ev.remove();'],
  ['css', 'Fix 3: cards in a row at their own heights', 'repeat(auto-fill, minmax(400px, 1fr)); align-items: stretch; gap: 14px;', 'repeat(auto-fill, minmax(400px, 1fr)); align-items: start; gap: 14px;'],
  ['js', 'Fix 4: the rules line reads the Min length chip', "var parts = ['runs ' + num(r.minLen) + '+'];", "var parts = ['runs ' + _filters.minLen + '+'];"],
  ['js', 'Fix 4: the pool floor dropped from the rules line', "    parts.push('pool floor ' + num(r.minPoolConditional) + ' for surface, style, set and line runs');\n", '\n'],
  ['js', 'Round 3 item 1: the data date dropped', "    parts.push('data ' + dataDate(_data && _data.generatedAt));\n", '\n'],
  ['js', 'Round 3 item 1: the data date = the clock', "var ms = iso ? Date.parse(iso) : NaN;", "var ms = Date.now();"],
  ['js', 'Round 3 item 1: the data date in UTC, not stennisfy.tz', "var f = function (z) { return new Intl.DateTimeFormat('en-CA', { timeZone: z,", "var f = function (z) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC',"],
  ['js', 'Round 3 item 1: the 75-day break dropped', "    parts.push('a gap over ' + num(r.maxGapDays) + 'd ends a run');\n", '\n'],
  ['js', 'Round 3 item 1: Grand Slams exempt printed whatever the rules say', "(r.slamAgeExempt ? ' (Grand Slams exempt)' : '')", "' (Grand Slams exempt)'"],
  ['js', 'Round 3 item 1: the tag-row sentence missing', "'<p>Direction shows as a word in the tag row — <span class=\"sr-fn-w\">Winning run</span>", "'<p><span class=\"sr-fn-w\">Winning run</span>"],
  ['css', 'Round 3 item 1: the rules line not mono', 'max-width: none; font-family: var(--font-nums); font-size: 11.5px;', 'max-width: none; font-size: 11.5px;'],
  ['css', 'Round 3 item 1: the footnote at round 2\'s 11px', 'max-width: 1130px; font-size: 12.5px; line-height: 1.6;', 'max-width: 1130px; font-size: 11px; line-height: 1.6;'],
  ['js', 'Fix 6: a non-ATP / Challenger tier paints a card', "    if (p.tier !== 'tour' && p.tier !== 'chal') return false;    // Level is ATP / Challenger only (never ITF)\n", ''],
  ['eng', 'Fix 6: an ITF fixture reaches the slate', "  if (t === 'Challenger Men Singles') return 'chal';\n  return null;", "  if (t === 'Challenger Men Singles') return 'chal';\n  return t ? 'chal' : null;"],
  // round 2 fix 1 at the source (the generator's as-of-start set) + the fallback trim's recency / same-day fixes
  ['js', 'Fix 1 (source): the as-of-start set is never shown', "if (c.set === 'start') return (s && s.played) ? c.base : null;", "if (c.set === 'start') return null;"],
  ['js', 'Fix 1 (source): the as-of-start set shows before its match has started', "if (c.set === 'start') return (s && s.played) ? c.base : null;", "if (c.set === 'start') return c.base;"],
  ['js', 'Fix 1 (source): the post-match runs show beside the as-of-start set', '    if (Array.isArray(p.asOfStart)) return null;', '    if (false) return null;'],
  ['js', 'Fix 1 (source): a series.json with the field is still trimmed on the page', '    if (_data && _data.rules && _data.rules.asOfStart) return c.base;', '    if (false) return c.base;'],
  ['js', 'Fix 1 (fallback): no recency cap at the match start', '    if (!(age <= maxAge) && !slam) return null;', '    if (false) return null;'],
  ['js', 'Fix 1 (fallback): a Grand Slam last match is not exempt', '    if (!(age <= maxAge) && !slam) return null;', '    if (!(age <= maxAge)) return null;'],
  ['js', 'Fix 1 (fallback): ageDays stays the build\'s', '    out.ageDays = age;\n', ''],
  ['js', 'Fix 1 (fallback): an earlier same-day row is cut', 'if (!(rs != null && slot.startMs != null && rs < slot.startMs)) { cut = i; break; }', '{ cut = i; break; }'],
  ['eng', 'Fix 1 (generator): recency measured at the build, not the start', '  RECENCY_AT_MS = atMs;', '  RECENCY_AT_MS = null;'],
  ['eng', 'Fix 1 (generator): an earlier same-day fixture is cut', '  return Number.isFinite(a) && Number.isFinite(s) && a < s;', '  return false;'],
  ['eng', 'Fix 1 (generator): fixtures after the start are kept', '  if (d !== day) return d < day;', '  if (d !== day) return true;'],
  ['eng', 'Fix 1 (generator): no relevance gate on the as-of-start set', 'try { relevant = streaksFor(recs, tier).filter(st => isRelevant(st, ctx)); }', 'try { relevant = streaksFor(recs, tier); }'],
  ['eng', 'Fix 1 (generator): more than one card per family', '  const out = collapseByFamily(relevant);\n  for (const st of out) st.reference', '  const out = relevant;\n  for (const st of out) st.reference'],
  ['eng', 'Fix 1 (generator): a match whose start has passed is not "started"', '  return Number.isFinite(s) && s <= nowMs;', '  return false;'],
  // outcomes ledger = the run as it stood at the start (founder card 011f0d2d)
  ['eng', 'Ledger: judged on the post-match runs (the match already inside them)', '  const runs = asOfStartStreaks(fixtures, pk, tier, ctx, surfaceMap, styleMap) || [];', "  const runs = collapseByFamily(streaksFor(orderedRecords(fixtures, pk, tier, surfaceMap, styleMap, tier === 'tour'), tier).filter(st => isRelevant(st, ctx)));"],
  ['eng', 'Ledger: every evaluable run reads held', '      held: conditionHeld(st, pr), streakCount', '      held: pr ? true : null, streakCount'],
  ['eng', 'Ledger: a walkover reads held', '      held: conditionHeld(st, pr), streakCount', '      held: pr ? conditionHeld(st, pr) : true, streakCount'],
  ['eng', 'Ledger: the count includes the judged match', 'streakCount: st.count, pool: st.pool,', 'streakCount: st.count + 1, pool: st.pool,'],
  ['eng', 'Ledger: the row loses the result the P&L is priced on', '      won: pr ? pr.won : null,\n', '\n'],
  ['eng', 'Ledger: the rule marker is not the rebuilt file\'s', "const LEDGER_RULE = 'as-of-start';", "const LEDGER_RULE = 'post-match';"],
  // seed migration: series-outcomes.json is the commit-back's; the rebuild ships as series-outcomes.rebuild.json
  ['eng', 'Ledger migration: an old-rule ledger (no marker) is kept instead of the seed', "if (j && j.rule === LEDGER_RULE && j.records && typeof j.records === 'object'", "if (j && j.records && typeof j.records === 'object'"],
  ['eng', 'Ledger migration: the old-rule ledger falls back to an empty one, not the seed', '  return { rule: LEDGER_RULE, records: s.records };', '  return { rule: LEDGER_RULE, records: {} };'],
  ['eng', 'Ledger migration: a marked ledger is replaced by the seed', "if (j && j.rule === LEDGER_RULE && j.records && typeof j.records === 'object'", "if (j && j.rule === 'never' && j.records && typeof j.records === 'object'"],
  ['eng', 'Ledger migration: the seed is merged into a marked ledger', '!Array.isArray(j.records)) return j;', '!Array.isArray(j.records)) { try { Object.assign(j.records, JSON.parse(fs.readFileSync(seed, \'utf8\')).records); } catch (_) {} return j; }'],
  ['eng', 'Ledger migration: a missing seed starts an empty ledger', "try { s = JSON.parse(fs.readFileSync(seed, 'utf8')); } catch (e) {", "try { s = JSON.parse(fs.readFileSync(seed, 'utf8')); } catch (e) { return { rule: LEDGER_RULE, records: {} };"],
  ['eng', 'Ledger migration: an old-rule seed is accepted', "if (!s || s.rule !== LEDGER_RULE || !s.records", "if (!s || !s.records"],
];
const SUITES = ['test-ten427-series.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 120000 });
// Control: the unmutated files must pass, or every "caught" below means nothing.
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated files — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated files pass');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten427s-mut-'));
const engCopy = path.join(ROOT, '.ten427-mutant-build-series.js');
try {
  for (const [kind, name, from, to] of MUTANTS) {
    if (SRC[kind].split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
    const file = kind === 'eng' ? engCopy : path.join(dir, kind === 'js' ? 'm.js' : 'm.css');
    fs.writeFileSync(file, SRC[kind].replace(from, to));
    const env = kind === 'js' ? { TEN427S_SRC: file } : kind === 'css' ? { TEN427S_CSS: file } : { TEN427S_ENGINE: file };
    if (run(env).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(engCopy, { force: true });
}
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
