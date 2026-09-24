// TEN-270 — the Kibl stream -> live "Now" on the page, EXECUTED, not grepped.
//
// kibl-now-stream.js runs for real in a VM with a fake fetch/WebSocket, and the
// dashboard's own _streamNowOver / mcNowSrcHtml / ocs key helpers are SLICED OUT
// OF THE SHIPPED HTML and run against it — so a change to the shipped functions
// turns this red. Each rule has a case that fails when the rule is broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const client = readFileSync(join(HERE, 'kibl-now-stream.js'), 'utf8');

function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `shipped function ${name} not found`);
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}
function sliceConst(name) {
  const start = html.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `shipped const ${name} not found`);
  return html.slice(start, html.indexOf(';\n', start) + 1);
}

const NOW = Date.parse('2026-09-24T04:30:00Z');
// A fake page: a #matchlist holding the rendered cards, the page's top-level
// `matches`, a fetch that answers the heartbeat and card reads separately, and
// captured timers / visibility listener so each cost rule can be driven.
function makeCtx(restRows, opts = {}) {
  const sockets = [], fetches = [], intervals = [], listeners = {}, timeouts = [], winListeners = {};
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(s) { this.sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }
  const rendered = opts.rendered || [CARD];
  // Every query returns NEW element objects, as renderMatches() does on the
  // live page (innerHTML) — the case the first viewport build looped on.
  // Layout: card i sits at y = i*120 (120 px tall) minus the scroll offset;
  // opts.layout = true gives cards real rects, otherwise (old harness) none.
  const list = { querySelectorAll: () => ctx.__rendered.map((m, i) => {
    const el = { dataset: { id: m.id } };
    if (opts.layout) el.getBoundingClientRect = () => {
      const top = i * 120 - ctx.__scrollY; return { top, bottom: top + 120, width: 300, height: 120 }; };
    return el; }) };
  const hbRows = restRows.filter(r => r.kind === 'heartbeat');
  const cardRows = restRows.filter(r => r.kind !== 'heartbeat');
  const ctx = {
    console, Date: class extends Date {
      constructor(...a) { super(...(a.length ? a : [NOW])); }
      static now() { return NOW; }
      static parse(s) { return Date.parse(s); }
    },
    Math, JSON, Number, String, isFinite, isNaN, Map, Set, Promise, encodeURIComponent, Array,
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout: id => { if (id && timeouts[id - 1]) timeouts[id - 1].fn = null; },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: () => {},
    document: { hidden: false, addEventListener: (ev, fn) => { listeners[ev] = fn; },
                getElementById: id => (id === 'matchlist' ? list : null),
                querySelectorAll: () => [] },
    CSS: { escape: s => s },
    WebSocket: FakeWS,
    fetch: async (u) => { fetches.push(u); return { ok: true, json: async () =>
      (u.includes('kibl_now_card') ? cardRows : hbRows) }; },
    window: { SUPABASE_URL: 'https://proj.example.co', SUPABASE_ANON_KEY: 'sb_publishable_TEST',
              addEventListener: (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); } },
    newsTz: () => 'UTC',
    __rendered: rendered, __scrollY: 0,
  };
  if (opts.layout) ctx.innerHeight = 360;          // 3 cards on screen, +150 px margin = 5
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  // The shipped page helpers, then the shipped client.
  vm.runInContext(['ocsNfd', 'ocsNameKey', 'ocsMatchKey', 'ocsKeyOf', 'psEsc', 'mxBookLabel',
                   'mcAgoTxt', 'mcNowSrcHtml', '_streamNowOver', 'mxOverround', 'mxIsSuspendedPair', 'cardStartMs']
                    .map(slice).join('\n') + '\n' + sliceConst('MC_BOOK_NAMES') + '\n' + sliceConst('MX_BOOK_LABELS')
                   + '\n' + ['MX_SUSPENDED_OVERROUND', 'MX_MIN_REAL_PRICE', 'MX_SUPPRESSED'].map(sliceConst).join('\n')
                   + '\nfunction acctTzOffsetMin(){ return 120; }'
                   + '\nfunction ocsFmtClock(iso){ return new Date(iso).toISOString().slice(11,16); }'
                   + '\nlet matches = __rendered.concat(' + JSON.stringify(opts.extraMatches || []) + ');'
                   + '\nthis.KNS = { _streamNowOver, mcNowSrcHtml };', ctx);
  vm.runInContext(client, ctx);
  const scopeTick = () => intervals.find(i => i.ms === 2000).fn();
  const runTimers = () => { for (const t of timeouts.splice(0)) if (t.fn) t.fn(); };
  const fire = (ev) => (winListeners[ev] || []).forEach(f => f());
  const pendingDelays = () => timeouts.filter(t => t.fn).map(t => t.ms);
  return { ctx, sockets, fetches, listeners, scopeTick, runTimers, fire, pendingDelays };
}
// Open the socket, accept the join, and confirm Postgres Changes is listening
// (Supabase's `system` message): only now is the page really subscribed.
function ack(sock, j) {
  sock.onmessage({ data: JSON.stringify({ event: 'phx_reply', topic: j.topic, ref: j.ref,
                                           payload: { status: 'ok', response: {} } }) });
  sock.onmessage({ data: JSON.stringify({ event: 'system', topic: j.topic, ref: null,
    payload: { status: 'ok', extension: 'postgres_changes', message: 'Subscribed to PostgreSQL' } }) });
}
function joinOk(sock) {
  if (sock.readyState !== 1) { sock.readyState = 1; sock.onopen(); }
  const j = sock.sent.filter(m => m.event === 'phx_join').pop();
  ack(sock, j);
  return j;
}
const tick = () => new Promise(r => setImmediate(r));

const CARD = { id: 'upcoming-1', date: '2026-09-24', p1: 'C. Ugo Carabelli', p2: 'N. Borges' };
const KEY = '2026-09-24|borges|carabelli';
const HB = (ageMs, connected = true) => ({ card_key: '__stream__', side_key: '__hb__', kind: 'heartbeat',
  written_at: new Date(NOW - ageMs).toISOString(), note: { connected } });
// One card row: both sides, each with its own Kibl time (a = borges < b = carabelli).
const CR = (borges, bAt, carabelli, cAt, book = 'bet105') => ({ card_key: KEY, book, book_name: 'Bet105',
  a_side: 'borges', a_price: borges, a_at: bAt, b_side: 'carabelli', b_price: carabelli, b_at: cAt,
  written_at: [bAt, cAt].sort().pop(), source: 'stream' });
const OCS = (now1, now2, ts, book = 'bet105', ts2 = ts) => ({ book, p1: { now: now1, nowTs: ts }, p2: { now: now2, nowTs: ts2 } });

test('the page reads the CARD table with the publishable key and subscribes only to rendered cards', async () => {
  const { ctx, sockets, fetches } = makeCtx([]);
  await tick();
  assert.equal(ctx.window.KiblNow.enabled, true);
  assert.ok(fetches.some(u => u.includes('/kibl_now_card?')) && fetches.some(u => u.includes('kind=eq.heartbeat')));
  const join = joinOk(sockets[0]);
  const pcs = join.payload.config.postgres_changes;
  assert.equal(pcs.length, 1);
  assert.equal(pcs[0].table, 'kibl_now_card', 'one row per card: one message per change');
  assert.equal(pcs[0].filter, `card_key=in.(${KEY})`, 'scoped to the rendered card, not the board');
  assert.match(sockets[0].url, /apikey=sb_publishable_TEST/);
  assert.doesNotMatch(client, /service_role|SUPABASE_SECRET/, 'no secret key path in the client');
});

test('no rendered pre-match card: no socket, no channel, no messages', async () => {
  const done = { ...CARD, finalScore: { winner: 'p1' } };
  const { sockets } = makeCtx([], { rendered: [done, { ...CARD, id: 'l', live: true }] });
  await tick();
  assert.equal(sockets.length, 0);
});

test('the scope follows the rendered list: a NEW card re-joins with the new filter and re-reads the table', async () => {
  const other = { id: 'upcoming-2', date: '2026-09-24', p1: 'A. Rublev', p2: 'T. Machac' };
  const { ctx, sockets, fetches, scopeTick, runTimers } = makeCtx([], { extraMatches: [other] });
  await tick();
  const first = joinOk(sockets[0]);
  ctx.__rendered = [CARD, other];
  scopeTick();
  const joins = () => sockets[0].sent.filter(m => m.event === 'phx_join');
  assert.equal(joins().length, 1, 'the re-join waits out its jitter (a board refresh hits every viewer at once)');
  runTimers();
  const sent = sockets[0].sent;
  assert.ok(sent.some(m => m.event === 'phx_leave' && m.topic === first.topic), 'old channel left');
  const j2 = joins().pop();
  assert.notEqual(j2.topic, first.topic);
  assert.equal(j2.payload.config.postgres_changes[0].filter,
               'card_key=in.(2026-09-24|borges|carabelli,2026-09-24|machac|rublev)');
  scopeTick(); runTimers();
  assert.equal(joins().length, 2, 'an unchanged scope never re-joins');
  await tick();                              // let the first subscription's re-read finish
  const reads = fetches.length;
  ack(sockets[0], j2);
  await tick();
  assert.equal(fetches.length, reads + 2, 'every confirmed subscription re-reads the table (heartbeat + cards)');
  ctx.__rendered = [other];
  scopeTick(); runTimers();
  assert.equal(joins().length, 3, 'a card LEAVING the list re-joins without it (it no longer costs messages)');
  assert.equal(joins().pop().payload.config.postgres_changes[0].filter, 'card_key=in.(2026-09-24|machac|rublev)');
  ctx.__rendered = [];
  scopeTick();
  assert.ok(sent.filter(m => m.event === 'phx_leave').length >= 2, 'no rendered card: the channel is left');
});

const TEN = Array.from({ length: 10 }, (_, i) => ({ id: 'c' + i, date: '2026-09-24',
  p1: 'A. ' + ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet'][i], p2: 'B. Zulu' }));
const keyOf = i => '2026-09-24|' + [TEN[i].p1.split(' ')[1].toLowerCase(), 'zulu'].sort().join('|');

test('ON SCREEN: only cards within the viewport (+150 px) are subscribed', async () => {
  const { ctx, sockets } = makeCtx([], { layout: true, rendered: TEN });
  await tick();
  assert.equal(ctx.window.KiblNow.viewport, true);
  const j = joinOk(sockets[0]);
  // innerHeight 360 + 150 margin: cards at y 0,120,240,360,480 reach <= 510 -> 5 cards
  assert.equal(j.payload.config.postgres_changes[0].filter, `card_key=in.(${[0,1,2,3,4].map(keyOf).sort().join(',')})`);
});

test('a REPAINT (new element objects, same layout) never leaves or re-joins — the loop the first build had', async () => {
  const { sockets, scopeTick, runTimers } = makeCtx([], { layout: true, rendered: TEN });
  await tick();
  joinOk(sockets[0]);
  for (let i = 0; i < 20; i++) { scopeTick(); runTimers(); }   // 20 repaints/checks
  const sent = sockets[0].sent;
  assert.equal(sent.filter(m => m.event === 'phx_leave').length, 0, 'no leave across 20 repaints');
  assert.equal(sent.filter(m => m.event === 'phx_join').length, 1, 'still the one join');
});

test('a member SCROLL subscribes the cards scrolled in and drops the ones scrolled off, at once', async () => {
  const { ctx, sockets, runTimers, fire } = makeCtx([], { layout: true, rendered: TEN });
  await tick();
  const j1 = joinOk(sockets[0]);
  ctx.__scrollY = 600;                               // cards 5..9 now on screen (+margin)
  fire('wheel'); fire('scroll'); runTimers();        // input marks it the member's; scroll triggers the check
  const joins = sockets[0].sent.filter(m => m.event === 'phx_join');
  assert.equal(joins.length, 2, 're-joined at once (no jitter) after the member scrolled');
  const keys = joins[1].payload.config.postgres_changes[0].filter;
  for (const i of [5, 6, 7, 8, 9]) assert.ok(keys.includes(keyOf(i)), 'scrolled-in card ' + i + ' subscribed');
  for (const i of [0, 1, 2]) assert.ok(!keys.includes(keyOf(i)), 'scrolled-off card ' + i + ' unsubscribed');
  assert.ok(sockets[0].sent.some(m => m.event === 'phx_leave' && m.topic === j1.topic), 'old channel left');
});

test('a DAY-TAB switch (new list, member click) subscribes the new day at once', async () => {
  const tomorrow = TEN.map(m => ({ ...m, id: 't' + m.id, date: '2026-09-25' }));
  const { ctx, sockets, runTimers, fire, scopeTick } = makeCtx([], { layout: true, rendered: TEN, extraMatches: tomorrow });
  await tick();
  joinOk(sockets[0]);
  ctx.__rendered = tomorrow; fire('click'); scopeTick(); runTimers();
  const last = sockets[0].sent.filter(m => m.event === 'phx_join').pop();
  assert.ok(/^card_key=in\.\(2026-09-25\|/.test(last.payload.config.postgres_changes[0].filter), 'tomorrow\'s cards subscribed');
  assert.ok(!last.payload.config.postgres_changes[0].filter.includes('2026-09-24'), 'today\'s cards dropped');
});

test('a DATA-driven scope change (no member input) is spread over the jitter window', async () => {
  const { ctx, sockets, runTimers, fire, pendingDelays } = makeCtx([], { layout: true, rendered: TEN });
  await tick();
  joinOk(sockets[0]);
  ctx.__scrollY = 600; fire('scroll');               // e.g. a board refresh moved the list; no wheel/click
  const before = timeouts => timeouts;
  runTimers();                                        // the 150 ms check runs; the re-join is scheduled
  assert.equal(sockets[0].sent.filter(m => m.event === 'phx_join').length, 1, 'not re-joined in the same tick');
  assert.ok(pendingDelays().some(d => d >= 0 && d < 5000), 'a jittered re-join is pending');
});

test('no re-scope while a join awaits confirmation; live is judged on the JOINED keys', async () => {
  const { ctx, sockets, runTimers, fire } = makeCtx([HB(1000), CR(1.18, '2026-09-24T04:20:00Z', 4.8, '2026-09-24T04:20:00Z')],
    { layout: true, rendered: [CARD, ...TEN] });
  await tick();
  joinOk(sockets[0]);
  const S = () => ctx.KNS._streamNowOver(CARD, OCS(null, null, null)).live;
  assert.equal(S(), true);
  ctx.__scrollY = 600; fire('wheel'); fire('scroll'); runTimers();      // scroll: re-join sent, not confirmed
  const joinsAfterScroll = sockets[0].sent.filter(m => m.event === 'phx_join').length;
  ctx.__scrollY = 0; fire('wheel'); fire('scroll'); runTimers();        // layout moves again in the gap
  assert.equal(sockets[0].sent.filter(m => m.event === 'phx_join').length, joinsAfterScroll,
               'no second join while the first awaits confirmation (the wrap loop)');
  assert.equal(S(), false, 'not live while the channel is unconfirmed');
});

test('more than 100 rendered cards split into bindings of at most 100 keys', async () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ id: 'u' + i, date: '2026-09-24',
    p1: 'A. Player' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)), p2: 'B. Zed' }));
  const { sockets } = makeCtx([], { rendered: many });
  await tick();
  const pcs = joinOk(sockets[0]).payload.config.postgres_changes;
  assert.deepEqual(pcs.map(p => p.filter.split(',').length), [100, 50]);
});

test('hidden tab: the channel is left and the socket closed, "● live" goes, and visible re-reads and re-joins', async () => {
  const { ctx, sockets, fetches, listeners } = makeCtx([HB(1000), CR(1.18, '2026-09-24T04:20:00Z', 4.8, '2026-09-24T04:20:00Z')]);
  await tick();
  const j = joinOk(sockets[0]);
  const S = ctx.KNS._streamNowOver;
  assert.equal(S(CARD, OCS(null, null, null)).live, true, 'joined + fresh heartbeat: live');
  ctx.__paints = [];
  ctx.renderMatches = () => ctx.__paints.push(ctx.window.KiblNow.healthy());
  ctx.document.hidden = true; listeners.visibilitychange();
  assert.ok(sockets[0].sent.some(m => m.event === 'phx_leave' && m.topic === j.topic));
  assert.equal(sockets[0].readyState, 3, 'socket closed while hidden');
  const sp = S(CARD, OCS(null, null, null));
  assert.equal(sp.live, false, 'paused: never live');
  assert.equal(ctx.KNS.mcNowSrcHtml(sp).includes('● live'), false);
  assert.equal(sp.p1, 4.8, 'the last real price stays, with its real time');
  assert.deepEqual(ctx.__paints, [false], 'painted AT the pause, not live — no stale "● live" to come back to');
  const reads = fetches.length;
  ctx.document.hidden = false; listeners.visibilitychange();
  await tick();
  assert.ok(fetches.length > reads, 're-seeded from the table on return');
  assert.equal(sockets.length, 2, 'a fresh socket');
  assert.equal(S(CARD, OCS(null, null, null)).live, false, 'not live until the join is acknowledged');
  joinOk(sockets[1]);
  assert.equal(S(CARD, OCS(null, null, null)).live, true);
});

test('stream wins only when NEWER than the poller, and only for the card\'s own book', async () => {
  const { ctx, sockets } = makeCtx([HB(10000), CR(1.18, '2026-09-24T04:20:00Z', 4.8, '2026-09-24T04:20:00Z')]);
  await tick();
  joinOk(sockets[0]);
  const S = ctx.KNS._streamNowOver;
  const newer = S(CARD, OCS(5.0, 1.15, '2026-09-24T04:00:00Z'));
  assert.equal(newer.p1, 4.8); assert.equal(newer.p2, 1.18);        // placed by SURNAME, not order
  assert.equal(newer.src, 'stream'); assert.equal(newer.live, true);
  assert.equal(S(CARD, OCS(5.0, 1.15, '2026-09-24T04:25:00Z')), null, 'older stream price never shown');
  assert.equal(S(CARD, OCS(5.0, 1.15, '2026-09-24T04:20:00Z')), null, 'equal time keeps the poller');
  assert.equal(S(CARD, OCS(5.0, 1.15, '2026-09-24T04:00:00Z', 'bet365')), null,
               'a bet365-selected card never takes a Bet105 Now (whole-card rule)');
  assert.equal(S(CARD, OCS(null, null, null)).p1, 4.8, 'no poller Now: the stream fills it');
});

test('a suspended stream pair never renders; the poller keeps the card', async () => {
  const { ctx } = makeCtx([HB(1000), CR(1.40, '2026-09-24T04:20:00Z', 1.40, '2026-09-24T04:20:00Z')]);
  await tick();
  assert.equal(ctx.KNS._streamNowOver(CARD, OCS(5.0, 1.15, '2026-09-24T04:00:00Z')), null,
               'a 1.40/1.40 pair is a 43% overround — suspended, not a Now');
});

test('pre-match only on the page: a started, live or finished card never takes a stream Now', async () => {
  const { ctx } = makeCtx([HB(1000), CR(1.18, '2026-09-24T04:20:00Z', 4.8, '2026-09-24T04:20:00Z')]);
  await tick();
  const S = ctx.KNS._streamNowOver;
  assert.ok(S({ ...CARD, startTs: '2026-09-24T05:00:00Z' }, OCS(null, null, null)), 'before the start: shown');
  assert.equal(S({ ...CARD, startTs: '2026-09-24T04:29:00Z' }, OCS(null, null, null)), null,
               'past the start with the poller Now withheld: NOT filled from the stream');
  assert.equal(S({ ...CARD, live: true }, OCS(null, null, null)), null, 'live: never');
  assert.equal(S({ ...CARD, finalScore: { winner: 'p1' } }, OCS(null, null, null)), null, 'finished: never');
});

test('newer is judged per side: one stale stream side keeps the whole poller pair', async () => {
  // Stream: p1 (Ugo Carabelli) 04:00, p2 (Borges) 04:26. Poller: p1 04:05, p2 04:05.
  const { ctx } = makeCtx([HB(1000), CR(1.18, '2026-09-24T04:26:00Z', 4.8, '2026-09-24T04:00:00Z')]);
  await tick();
  assert.equal(ctx.KNS._streamNowOver(CARD, OCS(5.0, 1.15, '2026-09-24T04:05:00Z')), null,
               'p1 would be OLDER than the poller\'s p1 — never shown, and never a mixed pair');
  assert.ok(ctx.KNS._streamNowOver(CARD, OCS(5.0, 1.15, '2026-09-24T03:50:00Z')),
            'both stream sides at least as new, one strictly newer: shown');
});

test('another card\'s row is no pair for this card', async () => {
  const { ctx } = makeCtx([HB(1000), { ...CR(1.18, '2026-09-24T04:20:00Z', 4.8, '2026-09-24T04:20:00Z'),
                                       card_key: '2026-09-25|borges|carabelli' }]);
  await tick();
  assert.equal(ctx.KNS._streamNowOver(CARD, OCS(null, null, null)), null);
});

test('a dead stream is never labelled live, and the real time is shown', async () => {
  const failing = { ...HB(1000), note: { connected: true, write_ok: false } };
  for (const [hb, want] of [[HB(10000), true], [HB(400000), false], [HB(1000, false), false], [failing, false]]) {
    const { ctx, sockets } = makeCtx([hb, CR(1.18, '2026-09-24T04:20:00Z', 4.8, '2026-09-24T04:20:00Z')]);
    await tick();
    joinOk(sockets[0]);
    const sp = ctx.KNS._streamNowOver(CARD, OCS(null, null, null));
    assert.equal(sp.live, want);
    const line = ctx.KNS.mcNowSrcHtml(sp);
    assert.equal(line.includes('● live'), want);
    assert.match(line, /Bet105 · updated 04:20 · 10m ago/);
  }
});

test('live needs the subscription CONFIRMED; a refused, errored or closed channel is never live', async () => {
  const { ctx, sockets, runTimers } = makeCtx([HB(1000), CR(1.18, '2026-09-24T04:20:00Z', 4.8, '2026-09-24T04:20:00Z')]);
  await tick();
  const S = () => ctx.KNS._streamNowOver(CARD, OCS(null, null, null)).live;
  sockets[0].readyState = 1; sockets[0].onopen();
  const j = sockets[0].sent.find(m => m.event === 'phx_join');
  assert.equal(S(), false, 'join sent, no reply yet');
  sockets[0].onmessage({ data: JSON.stringify({ event: 'phx_reply', topic: j.topic, ref: j.ref, payload: { status: 'ok' } }) });
  assert.equal(S(), false, 'join accepted but Postgres Changes not yet listening');
  sockets[0].onmessage({ data: JSON.stringify({ event: 'system', topic: j.topic,
    payload: { status: 'error', extension: 'postgres_changes', message: 'Unable to subscribe' } }) });
  assert.equal(S(), false, 'subscription error');
  runTimers();
  const j2 = sockets[0].sent.filter(m => m.event === 'phx_join').pop();
  assert.notEqual(j2.topic, j.topic, 'an errored channel re-joins');
  ack(sockets[0], j2);
  assert.equal(S(), true);
  sockets[0].onmessage({ data: JSON.stringify({ event: 'phx_error', topic: j2.topic, payload: {} }) });
  assert.equal(S(), false, 'a channel error (e.g. the events/s ceiling) drops "● live"');
  runTimers();
  const j3 = sockets[0].sent.filter(m => m.event === 'phx_join').pop();
  sockets[0].onmessage({ data: JSON.stringify({ event: 'phx_reply', topic: j3.topic, ref: j3.ref,
    payload: { status: 'error', response: { reason: 'too_many_connections' } } }) });
  assert.equal(S(), false, 'refused join');
});

test('a card this page is not subscribed to is never live', async () => {
  const other = { id: 'x', date: '2026-09-24', p1: 'A. Rublev', p2: 'T. Machac' };
  const row = { card_key: '2026-09-24|machac|rublev', book: 'bet105', book_name: 'Bet105',
    a_side: 'machac', a_price: 2.6, a_at: '2026-09-24T04:20:00Z', b_side: 'rublev', b_price: 1.5,
    b_at: '2026-09-24T04:20:00Z', written_at: '2026-09-24T04:20:00Z' };
  const { ctx, sockets } = makeCtx([HB(1000), row, CR(1.18, '2026-09-24T04:20:00Z', 4.8, '2026-09-24T04:20:00Z')]);
  await tick();
  joinOk(sockets[0]);
  assert.equal(ctx.KNS._streamNowOver(CARD, OCS(null, null, null)).live, true);
  const sp = ctx.KNS._streamNowOver(other, OCS(null, null, null));
  assert.equal(sp.p1, 1.5, 'its last real price still shows, with its time');
  assert.equal(sp.live, false, 'but not "● live": nothing is pushing it to this page');
});

test('Realtime push: one card row moves both sides; an older side never moves Now back', async () => {
  const { ctx, sockets } = makeCtx([HB(1000), CR(1.18, '2026-09-24T04:20:00Z', 4.8, '2026-09-24T04:20:00Z')]);
  await tick();
  const j = joinOk(sockets[0]);
  const push = (rec, topic = j.topic) => sockets[0].onmessage({ data: JSON.stringify(
    { event: 'postgres_changes', topic, payload: { data: { record: rec } } }) });
  push(CR(1.12, '2026-09-24T04:25:00Z', 5.5, '2026-09-24T04:25:00Z'));
  let sp = ctx.KNS._streamNowOver(CARD, OCS(null, null, null));
  assert.equal(sp.p2, 1.12); assert.equal(sp.p1, 5.5);
  push(CR(1.30, '2026-09-24T04:10:00Z', 6.0, '2026-09-24T04:27:00Z'));
  sp = ctx.KNS._streamNowOver(CARD, OCS(null, null, null));
  assert.equal(sp.p2, 1.12, 'the older Borges side is refused');
  assert.equal(sp.p1, 6.0, 'the newer Ugo Carabelli side in the same row applies');
  push(CR(1.01, '2026-09-24T04:29:00Z', 9.0, '2026-09-24T04:29:00Z'), 'realtime:kibl-now-old');
  assert.equal(ctx.KNS._streamNowOver(CARD, OCS(null, null, null)).p1, 6.0, 'a left channel\'s push is ignored');
  assert.equal(ctx.window.KiblNow.samples.length, 2, 'only applied pushes are delay samples');
});

test('a poller Now with no clock says so instead of borrowing one', async () => {
  const { ctx } = makeCtx([]);
  await tick();
  assert.match(ctx.KNS.mcNowSrcHtml({ book: 'bet365', at: null }), /· update time —/);
});

test('no creds: the client is inert and every card stays on the poller', () => {
  const ctx = { window: { SUPABASE_URL: '__SUPABASE_URL__', SUPABASE_ANON_KEY: '__SUPABASE_ANON_KEY__' },
                document: { addEventListener() {} } };
  vm.createContext(ctx);
  vm.runInContext(client, ctx);
  assert.equal(ctx.window.KiblNow.enabled, false);
  assert.equal(ctx.window.KiblNow.pairFor({}), null);
});
