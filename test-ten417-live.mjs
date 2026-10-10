// TEN-417 step 11 (founder 2026-10-10): the Live page redesign. The SHIPPED Live renderer (the last <script> block of
// bsp-consult-dashboard.html) runs for real against the SHIPPED data layer (live-tab.js), house-ratings.js and
// holdbreak-heatmap.js, fed a frozen board built from real api-tennis rows (tools/fixtures/ten417-live.json, Shanghai,
// 9 Oct 2026). Every check names the mutation that turns it red. Rules: .claude/rules/live.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN417_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const FIX = JSON.parse(readFileSync(join(HERE, 'tools/fixtures/ten417-live.json'), 'utf8'));
const LIVE_BLOCK = (() => {
  const a = html.lastIndexOf('<script>'), b = html.indexOf('</script>', a);
  const s = html.slice(a + 8, b);
  assert.ok(/lvTab/.test(s) && /lvEventLabel/.test(s), 'the Live renderer is the last <script> block');
  return s;
})();
const CSS = (() => { const a = html.lastIndexOf('#lvTab * { box-sizing'); return html.slice(a, html.indexOf('</style>', a)); })();
// A dashboard function, sliced whole (brace-matched; a one-line function is taken whole first).
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, 'function ' + name);
  const nl = html.indexOf('\n', at + 1), line = html.slice(at + 1, nl);
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  let depth = 0, i = html.indexOf('{', at);
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const constLine = name => { const m = html.match(new RegExp('\\nconst ' + name + ' = [^\\n]*')); assert.ok(m, 'const ' + name); return m[0]; };
const HELPERS = [constLine('FH_BAR_FLOOR'), constLine('FH_RATING_SCALE'), constLine('FH_BAR_CAP'),
  fn('msBarFloor'), fn('msBarScale'), fn('fhStatBarWidth'), fn('formIni'), fn('fhIni'),
  fn('newsTz'), fn('newsFmtHMS'), fn('newsFmtAbs'), fn('newsPlayerName')].join('\n');

// A stub DOM: #lvTab keeps its innerHTML; cards and the sheet hand back their click handlers so the test can click.
const RAIL = (() => { const a = html.indexOf('// TEN-403 rail badges.'); return html.slice(a, html.indexOf('})();', a) + 5); })();
function boot(opts = {}) {
  const store = { 'stennisfy.tz': 'UTC' };
  const badge = { textContent: '', hidden: true };
  const handlers = { cards: {}, overlay: null, keydown: [] };
  const tab = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    querySelectorAll(sel) {
      if (sel !== '.lvcard[data-open]') return [];
      return [...this._html.matchAll(/class="lvcard" data-open="([^"]+)"/g)].map(m => ({ dataset: { open: m[1] }, addEventListener: (t, f) => { handlers.cards[m[1]] = f; } }));
    } };
  const document = {
    readyState: 'complete', hidden: false,
    getElementById(id) {
      if (id === 'lvTab') return tab;
      if (id === 'lvOverlay') return /id="lvOverlay"/.test(tab._html) ? { addEventListener: (t, f) => { handlers.overlay = f; } } : null;
      if (id === 'sfLiveCount') return badge;
      if (id === 'liveTabBtn') return { style: { display: '' } };
      return null;
    },
    querySelector(sel) { return sel === '[data-tab="live"]' ? { addEventListener() {}, removeEventListener() {} } : null; },
    querySelectorAll: () => [],
    addEventListener(t, f) { if (t === 'keydown') handlers.keydown.push(f); },
  };
  const window = { FEATURE_LIVE_PROXY: true, FEATURE_LIVE_DETAIL: true, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', __LV_SUBS: [],
    holdbreak: opts.holdbreak || null };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: k => (k in store ? store[k] : null) },
    fetch: opts.rows ? async () => ({ ok: true, json: async () => opts.rows }) : () => new Promise(() => {}), setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console: { warn() {}, log() {}, error() {} },
    playerProfiles: opts.profiles || {}, WebSocket: function () {} });
  ctx.globalThis = ctx;
  vm.runInContext(readFileSync(join(HERE, 'house-ratings.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(join(HERE, 'holdbreak-heatmap.js'), 'utf8'), ctx);
  vm.runInContext(`window.HouseRatings = globalThis.HouseRatings || window.HouseRatings; window.HoldBreakHeatmap = globalThis.HoldBreakHeatmap || window.HoldBreakHeatmap;`, ctx);
  // The canonical event table is tested where it lives (TEN-402); here it is the two names this fixture needs.
  vm.runInContext(`const SF_TEST = { Shanghai: 'Shanghai Masters' }; function sfEventName(raw){ return SF_TEST[raw] || raw; }\n${HELPERS}`, ctx);
  if (opts.rail) vm.runInContext(RAIL, ctx);
  vm.runInContext(LIVE_BLOCK, ctx);
  vm.runInContext(readFileSync(join(HERE, 'live-tab.js'), 'utf8'), ctx);
  const LF = window.LiveFeed;
  LF.pbpGet = ek => FIX.pbp[ek] ? { games: FIX.pbp[ek], at: 0, loading: false, error: false } : null;
  LF.pbpLoad = () => {};
  const subs = window.__LV_SUBS.slice();
  const publish = board => { const live = board.filter(LF.isAtpSingles).filter(LF.isUnderway);
    subs.forEach(f => f({ ready: true, matches: board, live, isStale: false, ageMs: 0, updatedAt: Date.UTC(2026, 9, 9, 7, 41, 5), connected: true })); };
  const target = (attr, val) => ({ id: '', closest: sel => (sel === `[${attr}]` ? { dataset: { [attr.replace('data-', '').replace(/-(\w)/g, (_, c) => c.toUpperCase())]: String(val) } } : null) });
  return {
    window, tab, handlers, publish, subs, badge,
    html: () => tab._html,
    open(ek) { handlers.cards[ek](); },
    click(attr, val) { handlers.overlay({ target: target(attr, val) }); },
    backdrop() { handlers.overlay({ target: null, get _() { return 0; } }); },
    esc() { handlers.keydown.forEach(f => f({ key: 'Escape' })); },
  };
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const sheet = h => h.slice(h.lastIndexOf('<div', h.indexOf('id="lvOverlay"')));
const ZHOU = '12169254', KHACH = '12169275';
const live = () => { const P = boot(); P.publish(FIX.board); return P; };

test('Header: In play excludes Interrupted, Interrupted amber above 0, Events distinct, Updated = feed refresh HH:MM:SS (mutants: in-play counts interrupted / grey interrupted / Updated = now)', () => {
  const h = live().html();
  const v = l => { const i = h.indexOf(`<span class="sfh__l">${l}</span>`); return h.slice(i, h.indexOf('</div>', i)); };
  assert.match(v('In play'), />3<\/span>$/);
  assert.match(v('Interrupted'), /color:var\(--amber\);">1</);
  assert.match(v('Events'), />1<\/span>$/);
  assert.match(v('Updated'), />07:41:05<\/span>$/);
  assert.match(v('Updated'), /title="09 Oct 2026, 07:41:05"/);
  const P = boot(); P.publish([]);
  const z = P.html();
  assert.match(z, /color:var\(--text-label\);">0</, 'Interrupted grey at 0');
  assert.match(text(z), /Nothing in play Matches appear here the moment the first point is played\./);
});

test('Before the first snapshot every header figure dashes and no empty state shows (mutant: ready:false read as 0 in play)', () => {
  const P = boot(); P.subs.forEach(f => f({ ready: false, matches: [], live: [], updatedAt: null }));
  assert.equal((P.html().match(/sfh__v--none/g) || []).length, 3);
  assert.doesNotMatch(P.html(), /Nothing in play/);
});

test('Cards: canonical event + round, initials not photos, Live pulses white, Interrupted amber caps, PTS white, no footer (mutants: photo back / raw tournament_name / --pos PTS)', () => {
  const h = live().html();
  assert.doesNotMatch(h, /<img|randomuser|placeholder data|feed has not reported that figure/);
  assert.match(h, /Shanghai Masters · 1\/32-finals/);
  assert.doesNotMatch(h, />Shanghai · /);
  const zc = h.slice(h.indexOf(`data-open="${ZHOU}"`), h.indexOf('data-open=', h.indexOf(`data-open="${ZHOU}"`) + 20));
  assert.match(zc, /animation:lvpulse 1\.6s ease-in-out infinite/);
  assert.match(zc, />YZ<\/span>/);
  assert.match(zc, /background:var\(--serve-ball\)/);
  const kc = h.slice(h.indexOf(`data-open="${KHACH}"`));
  assert.match(kc.slice(0, 1200), /color:var\(--amber\);"><span style="width:5px;height:5px;border-radius:50%;background:var\(--amber\);animation:none;"><\/span>INTERRUPTED/);
  assert.doesNotMatch(h.slice(0, h.indexOf('id="lvOverlay"') > 0 ? h.indexOf('id="lvOverlay"') : h.length), /var\(--pos\)/);
  assert.match(CSS, /\.lvcard:hover \{ border-color:var\(--edge-16\); \}/);
  for (const m of h.matchAll(/<div class="lvcard"[^>]*>/g)) assert.doesNotMatch(m[0], /border:/, 'an inline edge outranks the hover (TEN-190 D1 dead hover)');
  assert.match(CSS, /\.lvcard \{ cursor:pointer; border:1px solid transparent;/);
});

test('Sheet: opens on Ratings with status, canonical event line, sets + serving sub; Esc / backdrop / ✕ close (mutants: opens on Stats / no Esc)', () => {
  const P = live(); P.open(ZHOU);
  const s = sheet(P.html());
  assert.match(text(s), /^✕ Live · Set 3 ATP · Shanghai Masters · 1\/32-finals YZ Y\. Zhou 1 set · serving/);
  assert.deepEqual([...s.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]), ['Ratings', 'Stats', 'Points', 'Break/Hold']);
  assert.match(s, /data-tab="Ratings" style="[^"]*font-weight:700;color:var\(--text\);background:var\(--selected\);border:1px solid var\(--edge-16\)/);
  P.esc(); assert.doesNotMatch(P.html(), /lvOverlay/, 'Esc closes');
  P.open(ZHOU); P.handlers.overlay({ target: { id: 'lvClose', closest: () => null } }); assert.doesNotMatch(P.html(), /lvOverlay/, '✕ closes');
  P.open(KHACH);
  assert.match(sheet(P.html()), /color:var\(--amber\);"><span style="width:6px;height:6px;border-radius:50%;background:currentColor;"><\/span>Interrupted · Set 2/);
  assert.doesNotMatch(text(sheet(P.html())), /serving/, 'no "· serving" while interrupted');
});

test('Opening a card resets to Ratings · Match · Set 1 · Hold (mutant: state carried between opens)', () => {
  const P = live(); P.open(ZHOU);
  P.click('data-tab', 'Points'); P.click('data-pset', 3); P.click('data-tab', 'Stats'); P.click('data-scope', 2);
  P.open(ZHOU);
  assert.match(sheet(P.html()), /Momentum · margin per game/);
  P.click('data-tab', 'Stats');
  assert.match(sheet(P.html()), /data-scope="MATCH" style="[^"]*color:var\(--text\)/);
  assert.match(text(sheet(P.html())), /Dominance Match to date/);
});

test('Stats: MATCH · SET 1 … SET n from the feed periods, scope name in each section, lead white 700 / trail soft 500, a missing side dashes (mutants: only the current set / lead colour inverted)', () => {
  const P = live(); P.open(ZHOU); P.click('data-tab', 'Stats');
  assert.deepEqual([...sheet(P.html()).matchAll(/data-scope="([^"]+)"/g)].map(m => m[1]), ['MATCH', '1', '2', '3']);
  P.click('data-scope', 2);
  const s = sheet(P.html());
  assert.equal((text(s).match(/ Set 2 /g) || []).length >= 4, true, 'every section names its scope');
  // Aces, set 2 (feed rows): Zhou 3, Musetti 2 → Zhou leads.
  const row = s.slice(s.indexOf('>Aces<') - 700, s.indexOf('>Aces<') + 900);
  assert.match(row, /font-size:14px;font-weight:700;color:var\(--text\);">3</);
  assert.match(row, /font-size:14px;font-weight:500;color:var\(--text-soft\);">2</);
  assert.match(row, /background:var\(--bar\);border-radius:3px;/);
  assert.match(row, /background:var\(--bar-2\);border-radius:3px;/);
  assert.doesNotMatch(s, /Pressure points/);
});

test('Points: running games (server white), lifted game-winning score, BP chip, no LOST SERVE on the tiebreak row, tiebreak rows with MP (mutants: TB summary shown as a break / MP never tagged / lift on a garbled last entry)', () => {
  const P = live(); P.open(ZHOU); P.click('data-tab', 'Points'); P.click('data-pset', 1);
  let s = sheet(P.html());
  assert.match(text(s), /SET 1 7–6/);
  const games1 = text(s).slice(0, text(s).indexOf('Tiebreak · Set 1'));
  assert.ok(games1.length > 100 && /6 · 6/.test(games1));
  assert.doesNotMatch(games1, /LOST SERVE|7 · 6/, 'set 1 had no break: the 7–6 summary row carries serve_lost and is the tiebreak');
  // tiebreak rows: Musetti's set points at 3–6 … 5–6, Zhou's at 7–6 and 8–7 (the score wins at 9–7: no tag)
  assert.match(text(s), /Tiebreak · Set 1 1 · 0 2 · 0 LOST SERVE .* 3 · 6 SP 4 · 6 LOST SERVE SP 5 · 6 LOST SERVE SP 6 · 6 SP 7 · 6 7 · 7 SP 8 · 7 LOST SERVE 9 · 7$/);
  P.click('data-pset', 3); s = sheet(P.html());
  const tb = s.slice(s.indexOf('Tiebreak · Set 3'));
  // Zhou leads the decider's tiebreak 6–0 and 6–1 with set 1 won: match points on his side.
  assert.equal((tb.match(/>MP</g) || []).length, 2);
  assert.match(s, />BP</);
  assert.match(s, /font-weight:700;color:var\(--text\);white-space:nowrap;background:var\(--selected\);border:1px solid var\(--edge-16\)/);
  // a garbled last entry is never lifted: set 3 game 7 ends "15 - 15"
  assert.doesNotMatch(s, /background:var\(--selected\);border:1px solid var\(--edge-16\);border-radius:6px;padding:2px 7px;">15:15</);
});

test('Points: a 7–6 row with no tiebreak rows logged shows the score but never LOST SERVE (mutant: the summary row read as a break)', () => {
  const P = boot();
  const keep = FIX.pbp[ZHOU];
  FIX.pbp[ZHOU] = keep.filter(g => !/tiebreak/i.test(g.set_number));
  try {
    P.publish(FIX.board); P.open(ZHOU); P.click('data-tab', 'Points'); P.click('data-pset', 1);
    const t = text(sheet(P.html()));
    assert.match(t, /7 · 6/);
    assert.doesNotMatch(t, /LOST SERVE/);
  } finally { FIX.pbp[ZHOU] = keep; }
});

test('Ratings + Momentum: four cards, Ratio W/UE components, one column per set, tiebreak not plotted, unreadable margin unlabelled (mutants: TB plotted as a break / label from a garbled entry)', () => {
  const P = live(); P.open(ZHOU);
  const s = sheet(P.html());
  for (const l of ['Dominance ratio', 'Serve rating', 'Return rating', 'Ratio W/UE']) assert.match(s, new RegExp('>' + l.replace('/', '\\/') + '<'));
  assert.match(text(s), /\(W\/P \d\.\d\d · UE\/P \d\.\d\d\)/);
  const mom = s.slice(s.indexOf('Momentum · margin per game'));
  const cols = mom.match(/grid-template-columns:(\d+fr \d+fr \d+fr)/);
  assert.ok(cols, 'three set columns');
  assert.equal(cols[1], '12fr 9fr 12fr', 'set 1 = 12 games (7–6 tiebreak not plotted), set 2 = 9, set 3 = 12 so far');
  assert.match(mom, /Set 3 · 6–6/);
  assert.doesNotMatch(mom, />0-15</, 'a deuce game ending on "0 - 15" is not labelled');
  const set1 = mom.slice(mom.indexOf('grid-template-columns:12fr'), mom.indexOf('Set 1 · 7–6'));
  assert.doesNotMatch(set1, /border:1px solid var\(--neg\)/, 'no break drawn in set 1');
});

test('Break/Hold: real rollup, initials, signed gap under the rate, HOLD / BREAK on the inner track (mutants: num/den under the rate / photo / card-tone track)', () => {
  const hb = { players: { '39862': { serve: { all: { '1': { '1': { won: 14, n: 15 } }, '2': { '1': { won: 10, n: 12 } } } }, return: { all: {} } } } };
  const P = boot({ holdbreak: hb }); P.publish(FIX.board); P.open(ZHOU); P.click('data-tab', 'Break/Hold');
  const s = sheet(P.html());
  assert.doesNotMatch(s, /<img/);
  assert.match(s, /data-hb="HOLD"/);
  assert.match(s.slice(s.indexOf('data-hb="HOLD"') - 400, s.indexOf('data-hb="HOLD"')), /background:var\(--inner\);border:1px solid transparent;border-radius:9px;padding:3px;/);
  // Game 1-2: S1 14/15 = 93%, S2 10/12 = 83%, all-sets 24/27 = 89% → +4 pts / −6 pts (true minus)
  assert.match(text(s), /93% \+4 pts/);
  assert.match(text(s), /83% −6 pts/);
  assert.match(text(s), /All surfaces · last 24m/);
});

test('Review fixes: Slam qualifying is best-of-three with a 10-point deciding tiebreak; a tiebreak row names its own point winner; Momentum says loading until the log lands (mutants: qualifying bo5 / bo5-only target / score-diff winner / "no games" while loading)', () => {
  const q = JSON.parse(JSON.stringify(FIX.board[0]));
  q.tournament_name = 'US Open'; q.event_qualification = 'True'; q.event_key = '777';
  const keep = FIX.pbp[ZHOU];
  // the same real point log with one tiebreak row dropped: 5-0 → [6-0 missing] → 6-1. The running score says Zhou won
  // the 6-1 point (his count moved); the row says Musetti served it and did not lose it — Musetti's point.
  const tb3 = keep.filter(g => g.set_number === 'Set 3 TieBreak').sort((x, y) => +x.number_game - +y.number_game).map(g => g.score);
  assert.deepEqual(tb3.slice(4), ['5 - 0', '6 - 0', '6 - 1'], 'fixture: the set-3 tiebreak runs 1-0 … 6-0, 6-1');
  FIX.pbp['777'] = keep.filter(g => !(g.set_number === 'Set 3 TieBreak' && g.number_game === '6'));
  try {
    const P = boot(); P.publish([q]); P.open('777'); P.click('data-tab', 'Points'); P.click('data-pset', 3);
    const s = sheet(P.html()), tb = s.slice(s.indexOf('Tiebreak · Set 3'));
    // US Open qualifying, deciding set 3 at 1–1 in sets: target 10 → 6–0 / 6–1 are not yet match points
    assert.equal((tb.match(/>MP</g) || []).length, 0);
    assert.match(tb, /color:var\(--text-label\);">6<\/span>\s*<span[^>]*>·<\/span>\s*<span[^>]*color:var\(--text\);">1</);
    P.click('data-tab', 'Break/Hold');
    assert.match(sheet(P.html()), /color:color-mix\(in srgb, var\(--text-label\) 40%, transparent\);">S4</, 'S4 dimmed: best-of-three');
  } finally { delete FIX.pbp['777']; }
  const L = boot(); L.publish(FIX.board);
  const pg = L.window.LiveFeed.pbpGet; L.window.LiveFeed.pbpGet = () => null;
  L.open(ZHOU);
  assert.match(text(sheet(L.html())), /Loading the point log…/);
  assert.doesNotMatch(text(sheet(L.html())), /No completed games/);
  L.window.LiveFeed.pbpGet = pg;
});

test('Colour: no blue text or rings, lime only on the serve dot, green only in the heatmap (mutant: blue name)', () => {
  const P = live(); P.open(ZHOU);
  let all = P.html();
  for (const t of ['Stats', 'Points', 'Break/Hold']) { P.click('data-tab', t); all += P.html(); }
  assert.doesNotMatch(all, /color:var\(--(bar|link|viz-lead)\)/);
  assert.doesNotMatch(all, /(border|box-shadow)[^;]*var\(--bar\)/);
  assert.equal((all.match(/var\(--serve-ball\)/g) || []).length > 0, true);
  assert.doesNotMatch(all.replace(/background:var\(--serve-ball\)/g, ''), /serve-ball/);
  assert.doesNotMatch(all, /var\(--pos\)/);
});

test('R1 fix 1: the rail badge reads the header In play (interrupted excluded), through the real live-tab.js publish (mutant: badge counts every underway match)', async () => {
  const P = boot({ rail: true, rows: [{ board: { matches: FIX.board }, updated_at: '2026-10-09T07:41:05Z' }] });
  P.window.LiveTab.setActive(true);
  try {
    await new Promise(r => setTimeout(r, 30));
    const h = P.html(), i = h.indexOf('<span class="sfh__l">In play</span>');
    assert.match(h.slice(i, i + 120), />3<\/span>/);
    assert.equal(P.badge.textContent, '3');
    assert.equal(P.badge.hidden, false);
    assert.equal(await P.window.LiveFeed.liveCount(), 3, 'the one-shot count off the Live page is In play too');
  } finally { P.window.LiveTab.setActive(false); }   // stop the 30 s poll so the runner can exit
});

test('R1 fix 2: every bar is the player\'s share of the pair, A ÷ (A + B); a zero draws nothing; one side missing draws nothing (mutant: TEN-263 absolute / floor widths)', () => {
  const P = live(); P.open(ZHOU);
  const card = (s, label) => { const i = s.indexOf('>' + label + '<'); return [...s.slice(i, i + 2500).matchAll(/<span style="width:([0-9.]+%);background:var\(--bar(?:-2)?\)/g)].slice(0, 2).map(m => m[1]); };
  assert.deepEqual(card(sheet(P.html()), 'Return rating'), ['33.8%', '66.2%'], 'Return rating 52 v 102');
  P.click('data-tab', 'Stats'); P.click('data-scope', 2);
  const s = sheet(P.html());
  const after = l => { const i = s.indexOf('>' + l + '<'); return [...s.slice(i, i + 1600).matchAll(/<span style="width:([0-9.]+%);background:var\(--bar(?:-2)?\)/g)].slice(0, 2).map(m => m[1]); };
  assert.deepEqual(after('Aces'), ['60.0%', '40.0%']);
  assert.deepEqual(after('Double faults'), ['0%', '100.0%']);
  assert.deepEqual(after('1st serve percentage'), ['53.7%', '46.3%'], '76 v 65.5');
});

test('R1 fix 6: 1st serve percentage carries its count (first serves in / service points) at one decimal (mutant: the feed\'s rounded figure, no count)', () => {
  const P = live(); P.open(ZHOU); P.click('data-tab', 'Stats'); P.click('data-scope', 2);
  const t = text(sheet(P.html()));
  assert.match(t, /76% \(19\/25\) 1st serve percentage \(19\/29\) 65\.5%/);
});

test('R1 fixes 3–4 + R2 fix 3: a printed ±3 is neutral and reads "at global · −3 pts vs this bucket’s global N%"; −4 is red, "below global" (mutants: −3 red / pair wording / word by sign)', () => {
  // Game 1-2: S1 28/30 = 93%, S2 80/100 = 80%, S3 9/10 = 90% → all-sets 117/140 = 84%: +9 / −4 / … ; Game 3-4: S1 81/100, S2 19/20 → global 100/120 = 83%: −2 / +12
  const hb = { players: { '39862': { serve: { all: { '1': { '1': { won: 28, n: 30 }, '2': { won: 81, n: 100 } }, '2': { '1': { won: 80, n: 100 }, '2': { won: 19, n: 20 } }, '3': { '1': { won: 9, n: 10 } } } }, return: { all: {} } } } };
  const P = boot({ holdbreak: hb }); P.publish(FIX.board); P.open(ZHOU); P.click('data-tab', 'Break/Hold');
  const s = sheet(P.html());
  const cell = pct => { const i = s.indexOf('>' + pct + '</span>'); return s.slice(s.lastIndexOf('<span class="hbcell"', i), s.indexOf('</span>\n</span>', i)); };
  // 80% vs 84% → −4: red; 93% vs 84% → +9: green; 90% vs 84%? (S3) → +6 green; Game 3-4: 81% vs 83% → −2 neutral
  assert.match(cell('80%'), /viz-down/);
  assert.match(cell('80%'), /below global · −4 pts vs this bucket’s global 84%/);
  const P3 = boot({ holdbreak: { players: { '39862': { serve: { all: { '1': { '1': { won: 81, n: 100 } }, '2': { '1': { won: 87, n: 100 } } } }, return: { all: {} } } } } });
  P3.publish(FIX.board); P3.open(ZHOU); P3.click('data-tab', 'Break/Hold');
  const s3 = sheet(P3.html()); const i3 = s3.indexOf('>81%</span>'); const c3 = s3.slice(s3.lastIndexOf('<span class="hbcell"', i3), s3.indexOf('</span>\n</span>', i3));
  // S1 81, S2 87 → global 168/200 = 84% → S1 −3 (printed), S2 +3
  assert.match(c3, /−3 pts/);
  assert.doesNotMatch(c3, /viz-down|viz-up/, '−3 printed → neutral');
  assert.match(c3, /at global · −3 pts vs this bucket’s global 84%/, 'R2 fix 3: the word follows the band');
  assert.doesNotMatch(s3, /pair’s all-sets/);
});

test('R1 fix 7 + R2: every game opens on 0:0, every chip is reachable from the one before it, BP only where the receiver is one point from the game (never 40:40), the lifted chip is the winner\'s game point — every decided game, both logs (mutants: feed list verbatim / feed BP flag / no 0:0)', () => {
  const V = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4 };
  const st = c => c.split(':').map(x => V[x]);
  const reach = (a, b) => [0, 1].some(s => { const me = a[s], op = a[1 - s], n = [a[0], a[1]];
    if (me <= 2 && op <= 3) n[s] = me + 1; else if (me === 3 && op === 3) n[s] = 4; else if (me === 3 && op === 4) n[1 - s] = 3; else return false;
    return n[0] === b[0] && n[1] === b[1]; });
  let games = 0, lifted = 0, bps = 0, deuces = 0, bp40 = 0;
  for (const [ek, sets] of [[ZHOU, [1, 2, 3]], [KHACH, [1, 2]]]) {
    const P = live(); P.open(ek); P.click('data-tab', 'Points');
    for (const n of sets) {
      P.click('data-pset', n);
      const s = sheet(P.html());
      const body = s.slice(s.indexOf('data-pset'));
      const rows = body.split('<div style="padding:14px 4px;border-top:1px solid var(--edge-6);">').slice(1).filter(r => /border-radius:6px;padding:2px 7px;">/.test(r));
      let prevG = null;
      for (const r of rows) {
        const g = [...r.matchAll(/font-size:20px;font-weight:700;color:[^;]+;">(\d+)</g)].map(m => +m[1]);
        const chips = r.split('display:inline-flex;align-items:center;gap:4px;">').slice(1).map(w => { const m = /font-weight:(\d+);color:[^;]+;white-space:nowrap;background:([^;]+);[^>]*>([^<]+)</.exec(w); return { w: m[1], bg: m[2], v: m[3], bp: />BP</.test(w) }; });
        // R2 fix 4: every game opens on a 0:0 chip (the reference), then every chip is one point on from the one before
        assert.equal(chips[0].v, '0:0', `${ek} set ${n} games ${g}: first chip ${chips[0].v}`);
        let prev = [0, 0];
        for (const c of chips.slice(1)) { assert.ok(reach(prev, st(c.v)), `${ek} set ${n} games ${g}: ${c.v} not reachable from ${prev}`); prev = st(c.v); }
        // R2 fix 2: BP after exactly the scores where the RECEIVER is one point from the game; never on 40:40
        const servesA = r.indexOf('width:15px;height:15px') < r.indexOf('font-size:20px');
        for (const c of chips) {
          const [a, b] = st(c.v), rc = servesA ? b : a, sv = servesA ? a : b;
          const want = rc === 4 || (rc === 3 && sv <= 2);
          assert.equal(c.bp, want, `${ek} set ${n} games ${g} (${servesA ? 'A' : 'B'} serving): ${c.v} BP ${c.bp}`);
          if (c.v === '40:40') { bp40 += c.bp ? 1 : 0; deuces++; }
          bps += c.bp ? 1 : 0;
        }
        const lift = chips.filter(c => c.bg === 'var(--selected)');
        if (lift.length) {
          lifted++;
          assert.equal(lift.length, 1); assert.equal(lift[0], chips[chips.length - 1], 'only the last chip is lifted');
          const aWon = prevG ? g[0] > prevG[0] : g[0] > g[1];
          const L = st(lift[0].v), me = aWon ? L[0] : L[1], op = aWon ? L[1] : L[0];
          assert.ok(me === 4 || (me === 3 && op <= 2), `${ek} set ${n} ${g}: lifted ${lift[0].v} is not the winner's game point`);
        }
        prevG = g; games++;
      }
    }
  }
  assert.ok(games > 40 && lifted > 40 && bps > 10 && deuces > 5, `checked ${games} games, ${lifted} lifted, ${bps} BP, ${deuces} deuce chips`);
  assert.equal(bp40, 0, 'no BP on 40:40');
});

test('Ruling (R1): an interrupted card shows no serve dot (mutant: dot while interrupted)', () => {
  const h = live().html();
  const kc = h.slice(h.indexOf(`data-open="${KHACH}"`), h.indexOf('data-open=', h.indexOf(`data-open="${KHACH}"`) + 20));
  assert.doesNotMatch(kc, /var\(--serve-ball\)/);
  const zc = h.slice(h.indexOf(`data-open="${ZHOU}"`), h.indexOf('data-open=', h.indexOf(`data-open="${ZHOU}"`) + 20));
  assert.match(zc, /var\(--serve-ball\)/);
});

test('Edge cases (manufactured from the real rows): a list that never reaches game point lifts and labels nothing; "Suspended" is Interrupted; one side missing draws no bars (mutants: lift/label guards, own regex, full bar to the known side)', () => {
  const keep = FIX.pbp[ZHOU], board = JSON.parse(JSON.stringify(FIX.board));
  // Zhou held set 1 game 1; the list here stops at 30:15 — no game point for him is ever shown
  FIX.pbp[ZHOU] = keep.map(g => (g.set_number === 'Set 1' && g.number_game === '1') ? Object.assign({}, g, { points: [{ score: '15 - 0' }, { score: '30 - 0' }, { score: '30 - 15' }, { score: '0 - 15' }] }) : g);
  board[0].statistics = board[0].statistics.filter(r => !(r.stat_period === 'set2' && String(r.stat_name).toLowerCase() === 'aces' && String(r.player_key) === String(board[0].second_player_key)));
  board[1].event_status = 'Suspended';
  // set 1 game 2 joins mid-game: the log opens at 15:30 (one point missing from 0:0)
  FIX.pbp[ZHOU] = FIX.pbp[ZHOU].map(g => (g.set_number === 'Set 1' && g.number_game === '2') ? Object.assign({}, g, { points: [{ score: '0 - 30' }, { score: '0 - 40' }] }) : g);
  try {
    const P = boot(); P.publish(board);
    const h = P.html(), i = h.indexOf('<span class="sfh__l">Interrupted</span>');
    assert.match(h.slice(i, i + 160), />1<\/span>/, '"Suspended" counts as Interrupted');
    P.open(ZHOU); P.click('data-tab', 'Points'); P.click('data-pset', 1);
    const s = sheet(P.html()), g1 = s.slice(s.indexOf('padding:14px 4px'), s.indexOf('padding:14px 4px', s.indexOf('padding:14px 4px') + 20));
    assert.match(text(g1), /1 · 0 0:0 , 15:0 , 30:0 , 30:15 <div/);
    assert.doesNotMatch(g1, /background:var\(--selected\)/, 'no lift without a game point');
    assert.match(text(s), /1 · 1 0:30 , 0:40 2 · 1/, 'a log that joins mid-game keeps its chips');
    P.click('data-tab', 'Ratings');
    const mom = sheet(P.html()).slice(sheet(P.html()).indexOf('grid-template-columns:12fr'));
    const firstBar = mom.slice(0, mom.indexOf('</span>\n      </span>'));
    assert.match(firstBar, /white-space:nowrap;">$/, 'first momentum bar unlabelled');
    P.click('data-tab', 'Stats'); P.click('data-scope', 2);
    const st = sheet(P.html()), a = st.indexOf('>Aces<');
    assert.deepEqual([...st.slice(a, a + 1600).matchAll(/<span style="width:([0-9.]+%);background:var\(--bar(?:-2)?\)/g)].slice(0, 2).map(m => m[1]), ['0%', '0%']);
  } finally { FIX.pbp[ZHOU] = keep; }
});
