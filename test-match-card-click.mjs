// Card click targets on the Matches tab (CHANGES_2026-11-11 A4, replacing the 2026-10-22 whole-card click): the card root
// has no click; the header row and each player row (avatar, odds, implied, form) open the analysis; the name opens the
// profile; the star, Market Signal (chip + open drawer) and "See full analysis" keep their own behaviour; the footer's empty
// space does nothing; a text selection is not a click; Enter on the focused header row opens it.
// The handlers are run from the dashboard source in a VM against a small fake DOM shaped like the card template.
// Control: TEST_HTML=<pre-fix dashboard> must fail the Upcoming cases.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(process.env.TEST_HTML || new URL('./bsp-consult-dashboard.html', import.meta.url), 'utf8');
let fails = 0, passes = 0;
function test(name, fn){
  try { fn(); passes++; console.log('ok   ' + name); }
  catch (e) { fails++; console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); }
}

// ── source slicing ──────────────────────────────────────────────────────────
function balanced(from, open){
  const close = open === '(' ? ')' : '}';
  let i = SRC.indexOf(open, from), d = 0;
  for (; i < SRC.length; i++){ if (SRC[i] === open) d++; else if (SRC[i] === close && --d === 0) return i + 1; }
  throw new Error('unbalanced at ' + from);
}
function fnSrc(name){
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) return '';
  return SRC.slice(at, balanced(SRC.indexOf('{', at), '{'));
}
function listenerSrc(type){
  const head = `document.getElementById('matchlist').addEventListener('${type}'`;
  const at = SRC.indexOf(head);
  assert.ok(at >= 0, 'matchlist ' + type + ' listener present');
  return SRC.slice(at, balanced(at + head.length - (`'${type}'`.length) - 1, '(')) + ';';
}

// ── fake DOM ────────────────────────────────────────────────────────────────
function matchesOne(el, sel){
  const m = sel.trim().match(/^([a-z]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i);
  if (!m) throw new Error('unsupported selector ' + sel);
  if (m[1] && el.tag !== m[1]) return false;
  for (const c of m[2].split('.').filter(Boolean)) if (!el.cls.has(c)) return false;
  for (const a of m[3].match(/\[[^\]]+\]/g) || []){
    const [, k, v] = a.match(/\[([\w-]+)(?:="([^"]*)")?\]/);
    if (!(k in el.attrs)) return false;
    if (v !== undefined && el.attrs[k] !== v) return false;
  }
  return true;
}
function el(tag, cls = '', attrs = {}, kids = []){
  const e = { tag, cls: new Set(cls.split(' ').filter(Boolean)), attrs, parent: null, kids,
    dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5), v])),
    closest(sel){ for (let n = this; n; n = n.parent) if (sel.split(',').some(s => matchesOne(n, s))) return n; return null; },
    contains(o){ for (let n = o; n; n = n.parent) if (n === this) return true; return false; } };
  e.classList = { contains: c => e.cls.has(c) };
  for (const k of kids) k.parent = e;
  return e;
}
const find = (root, sel) => { if (matchesOne(root, sel)) return root; for (const k of root.kids){ const f = find(k, sel); if (f) return f; } return null; };
// Shaped as the template: head (star on Upcoming) · players (avatar, name, price) · foot (chip + link) · drawer.
function card(id, completed){
  return el('article', 'match-card mx-match' + (completed ? ' cmpl' : ''), { 'data-id': id }, [
    el('div', 'mc-head', { role: 'button', tabindex: '0' }, [
      ...(completed ? [] : [el('button', 'mc-star', { 'data-fav': id }, [el('svg')])]),
      el('span', 'mc-surface'), el('span', 'mc-tourn'), el('span', 'mc-datetime')]),
    el('div', 'mc-players', {}, [el('div', 'mc-row a', {}, [
      el('span', 'mc-id', {}, [el('span', 'mc-avwrap a', {}, [el('img', 'mc-av')]), el('span', 'mc-nameline', {}, [el('span', 'mc-name')])]),
      el('span', 'mc-oddswrap', {}, [el('span', 'mc-odds'), el('span', 'mc-implied')]), el('span', 'mc-form')])]),
    el('div', 'mc-foot', {}, [
      el('button', 'mc-msig mx-msigchip', {}, [el('span', 'chev')]),
      el('a', 'mc-analysis')]),
    el('div', 'mc-sigpanel', {}, [el('div', 'mc-sig-row', {}, [el('span', 'mc-sig-src')])])]);
}

function harness(){
  const listeners = {}, opens = [];
  let selection = '';
  const ctx = {
    document: { getElementById: id => { assert.equal(id, 'matchlist'); return { addEventListener: (t, f) => { listeners[t] = f; } }; } },
    window: { getSelection: () => ({ isCollapsed: !selection, toString: () => selection }) },
    openAnalysisModal: (...a) => opens.push(a),
    matchById: id => MATCHES[id] || null,
    String, Object,
  };
  vm.createContext(ctx);
  vm.runInContext([fnSrc('mxHasBoxScore'), fnSrc('mxLandingTab'), fnSrc('mxOpenCompletedCard'), fnSrc('mxOpenCard'), fnSrc('mxCardZone'), fnSrc('mxCardClickInert'),
                   listenerSrc('click'), listenerSrc('keydown')].join('\n'), ctx);
  const ev = (target, extra = {}) => ({ target, preventDefault(){ this.dp = true; }, ...extra });
  return {
    opens,
    select: t => { selection = t; },
    click: target => listeners.click(ev(target)),
    key: (target, key) => listeners.keydown(ev(target, { key })),
  };
}

const UP = card('u1', false), UP2 = card('u2', false), DONE = card('c1', true);
const BOX = { p1: { 'Service:Aces': 3 }, p2: { 'Service:Aces': 1 } };
const MATCHES = {
  u1: { id: 'u1' }, u2: { id: 'u2' },
  c1: { id: 'c1', finalScore: { winner: 'p1' }, matchStats: BOX },
  wo: { id: 'wo', finalScore: { winner: 'p1' }, walkover: true },
  retNo: { id: 'retNo', finalScore: { winner: 'p2' }, retired: true, matchStats: { p1: {}, p2: {} } },
  retBox: { id: 'retBox', finalScore: { winner: 'p2' }, retired: true, matchStats: BOX },
};

test('A4 · header row (surface, tournament, time, the row itself) opens the analysis on Key factors', () => {
  const h = harness();
  for (const s of ['.mc-head', '.mc-surface', '.mc-tourn', '.mc-datetime']) h.click(find(UP, s));
  assert.deepEqual(h.opens, [['u1', 'key'], ['u1', 'key'], ['u1', 'key'], ['u1', 'key']]);
  assert.ok(SRC.includes(`<a class="mc-analysis" onclick="mxOpenCard(this.closest('.match-card'))">See full analysis →</a>`), '"See full analysis" opens the analysis');
});
test('A4 · each player row — avatar, odds, implied, form, the row — opens the analysis on Key factors', () => {
  const h = harness();
  for (const s of ['.mc-row', '.mc-avwrap', '.mc-av', '.mc-odds', '.mc-implied', '.mc-form']) h.click(find(UP, s));
  assert.equal(h.opens.length, 6);
  assert.ok(h.opens.every(o => o[0] === 'u1' && o[1] === 'key'));
});
test('A4 · the card root, the players block between rows and the footer\'s empty space do nothing', () => {
  const h = harness();
  for (const c of [UP, DONE]) for (const s of ['.match-card', '.mc-players', '.mc-foot']) h.click(c.cls.has(s.slice(1)) ? c : find(c, s));
  assert.deepEqual(h.opens, []);
});
test('Completed: a header / row click opens on its landing tab (Match stats; a walkover or a box-score-less retirement on Key factors)', () => {
  const h = harness();
  h.click(find(DONE, '.mc-row'));
  for (const id of ['wo', 'retNo', 'retBox']) h.click(find(card(id, true), '.mc-head'));
  assert.deepEqual(h.opens, [['c1', 'matchstats'], ['wo', 'key'], ['retNo', 'key'], ['retBox', 'matchstats']]);
});
test('source: each card handler is defined once (a re-run patch once doubled mxOpenCard)', () => {
  for (const f of ['mxOpenCard', 'mxOpenCompletedCard', 'mxCardClickInert', 'mxCardZone']) assert.equal(SRC.split('function ' + f + '(').length - 1, 1, f);
});
test('two cards: each click opens its own match', () => {
  const h = harness();
  h.click(find(UP2, '.mc-odds')); h.click(find(UP, '.mc-odds'));
  assert.deepEqual(h.opens, [['u2', 'key'], ['u1', 'key']]);
});
test('star (button and its svg) only toggles the star', () => {
  const h = harness();
  h.click(find(UP, '.mc-star')); h.click(find(UP, 'svg'));
  assert.deepEqual(h.opens, []);
});
test('Market Signal chip, its caret and anything inside the open drawer never open the card', () => {
  const h = harness();
  for (const c of [UP, DONE]) for (const s of ['.mc-msig', '.chev', '.mc-sigpanel', '.mc-sig-row', '.mc-sig-src']) h.click(find(c, s));
  assert.deepEqual(h.opens, []);
});
test('"See full analysis" is left to its own onclick: the card adds no second open', () => {
  const h = harness();
  h.click(find(UP, '.mc-analysis')); h.click(find(DONE, '.mc-analysis'));
  assert.deepEqual(h.opens, []);
});
test('the player name keeps its profile route; the avatar no longer links to the profile (A4)', () => {
  const h = harness();
  h.click(find(UP, '.mc-name'));
  assert.deepEqual(h.opens, []);
  assert.ok(/const attrs = '';/.test(fnSrc('mcAvatarHtml')), 'card avatars carry no profile link');
});
test('a drag-selection is not a click; a collapsed one is', () => {
  const h = harness();
  h.select('1.85'); h.click(find(UP, '.mc-odds'));
  assert.deepEqual(h.opens, []);
  h.select(''); h.click(find(UP, '.mc-odds'));
  assert.deepEqual(h.opens, [['u1', 'key']]);
});
test('keyboard: Enter on the focused header row opens it; Enter on the card root or a control inside does not', () => {
  const h = harness();
  h.key(find(UP, '.mc-head'), 'Enter'); h.key(find(DONE, '.mc-head'), ' '); h.key(UP, 'Enter'); h.key(find(UP, '.mc-star'), 'Enter'); h.key(find(UP, '.mc-head'), 'a');
  assert.deepEqual(h.opens, [['u1', 'key'], ['c1', 'matchstats']]);
});
test('template: the root carries no button role; the header row is focusable with a button role and a label', () => {
  assert.ok(SRC.includes(`data-ek="\${eventKeyOfMatch(m)}">`));
  assert.ok(!SRC.includes(`data-ek="\${eventKeyOfMatch(m)}" role="button"`));
  assert.ok(SRC.includes(`<div class="mc-head" role="button" tabindex="0" aria-label="Match analysis — \${psEsc(m.p1)} v \${psEsc(m.p2)}">`));
});
test('template: the card\'s own controls are the ones the inert rule covers', () => {
  assert.ok(/<button type="button" class="mc-star/.test(fnSrc('mxFavStarHtml')), 'star is a <button>');
  assert.ok(SRC.includes('<button class="mc-msig mx-msigchip"'), 'Market Signal is a <button>');
  assert.ok(/stopPropagation\(\);openPlayerProfileFromMatch/.test(fnSrc('profileLinkAttrs')), 'name route stops propagation');
});
test('CSS: the root is cursor default with no hover edge; header + rows pointer; the header row carries the focus ring', () => {
  assert.ok(SRC.includes('[data-page="matches"] .match-card.mx-match{ cursor:default; }'));
  assert.ok(SRC.includes('[data-page="matches"] .match-card.mx-match .mc-head, [data-page="matches"] .match-card.mx-match .mc-players .mc-row{ cursor:pointer; }'));
  assert.ok(!SRC.includes('.match-card.mx-match:not(.sig-open):hover{ border-color'));
  assert.ok(SRC.includes('[data-page="matches"] .match-card.mx-match .mc-head:focus-visible{ outline:2px solid var(--edge-16); outline-offset:-2px; }'));
});

console.log(`\n${passes} passed, ${fails} failed`);
if (!passes) { console.log('no cases ran'); process.exit(1); }
process.exit(fails ? 1 : 0);
