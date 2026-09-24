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
function makeCtx(restRows) {
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(s) { this.sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; }
  }
  const ctx = {
    console, Date: class extends Date {
      constructor(...a) { super(...(a.length ? a : [NOW])); }
      static now() { return NOW; }
      static parse(s) { return Date.parse(s); }
    },
    Math, JSON, Number, String, isFinite, isNaN, Map, Set, Promise, encodeURIComponent,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    document: { hidden: false, addEventListener() {}, getElementById: () => null,
                querySelectorAll: () => [] },
    CSS: { escape: s => s },
    WebSocket: FakeWS,
    fetch: async () => ({ ok: true, json: async () => restRows }),
    window: { SUPABASE_URL: 'https://proj.example.co', SUPABASE_ANON_KEY: 'sb_publishable_TEST' },
    newsTz: () => 'UTC',
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  // The shipped page helpers, then the shipped client.
  vm.runInContext(['ocsNfd', 'ocsNameKey', 'ocsMatchKey', 'ocsKeyOf', 'psEsc', 'mxBookLabel',
                   'mcAgoTxt', 'mcNowSrcHtml', '_streamNowOver', 'mxOverround', 'mxIsSuspendedPair', 'cardStartMs']
                    .map(slice).join('\n') + '\n' + sliceConst('MC_BOOK_NAMES') + '\n' + sliceConst('MX_BOOK_LABELS')
                   + '\n' + ['MX_SUSPENDED_OVERROUND', 'MX_MIN_REAL_PRICE', 'MX_SUPPRESSED'].map(sliceConst).join('\n')
                   + '\nfunction acctTzOffsetMin(){ return 120; }'
                   + '\nfunction ocsFmtClock(iso){ return new Date(iso).toISOString().slice(11,16); }'
                   + '\nthis.KNS = { _streamNowOver, mcNowSrcHtml };', ctx);
  vm.runInContext(client, ctx);
  return { ctx, sockets };
}
const tick = () => new Promise(r => setImmediate(r));

const CARD = { date: '2026-09-24', p1: 'C. Ugo Carabelli', p2: 'N. Borges' };
const KEY = '2026-09-24|borges|carabelli';
const HB = (ageMs, connected = true) => ({ card_key: '__stream__', side_key: '__hb__', kind: 'heartbeat',
  written_at: new Date(NOW - ageMs).toISOString(), note: { connected } });
const PX = (side, price, ins, book = 'bet105') => ({ card_key: KEY, side_key: side, kind: 'price', price,
  book, book_name: 'Bet105', kibl_inserted_on: ins, written_at: ins, source: 'stream' });
const OCS = (now1, now2, ts, book = 'bet105', ts2 = ts) => ({ book, p1: { now: now1, nowTs: ts }, p2: { now: now2, nowTs: ts2 } });

test('the page reads ONE table with the publishable key and subscribes to price rows only', async () => {
  const { ctx, sockets } = makeCtx([]);
  await tick();
  assert.equal(ctx.window.KiblNow.enabled, true);
  sockets[0].readyState = 1; sockets[0].onopen();
  const join = sockets[0].sent.find(m => m.event === 'phx_join');
  const pc = join.payload.config.postgres_changes[0];
  assert.equal(pc.table, 'kibl_now_price');
  assert.equal(pc.filter, 'kind=eq.price', 'heartbeats must not cost Realtime messages');
  assert.match(sockets[0].url, /apikey=sb_publishable_TEST/);
  assert.doesNotMatch(client, /service_role|SUPABASE_SECRET/, 'no secret key path in the client');
});

test('stream wins only when NEWER than the poller, and only for the card\'s own book', async () => {
  const { ctx } = makeCtx([HB(10000), PX('carabelli', 4.8, '2026-09-24T04:20:00Z'),
                           PX('borges', 1.18, '2026-09-24T04:20:00Z')]);
  await tick();
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
  const { ctx } = makeCtx([HB(1000), PX('carabelli', 1.40, '2026-09-24T04:20:00Z'),
                           PX('borges', 1.40, '2026-09-24T04:20:00Z')]);
  await tick();
  assert.equal(ctx.KNS._streamNowOver(CARD, OCS(5.0, 1.15, '2026-09-24T04:00:00Z')), null,
               'a 1.40/1.40 pair is a 43% overround — suspended, not a Now');
});

test('pre-match only on the page: a started, live or finished card never takes a stream Now', async () => {
  const { ctx } = makeCtx([HB(1000), PX('carabelli', 4.8, '2026-09-24T04:20:00Z'),
                           PX('borges', 1.18, '2026-09-24T04:20:00Z')]);
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
  const { ctx } = makeCtx([HB(1000), PX('carabelli', 4.8, '2026-09-24T04:00:00Z'),
                           PX('borges', 1.18, '2026-09-24T04:26:00Z')]);
  await tick();
  assert.equal(ctx.KNS._streamNowOver(CARD, OCS(5.0, 1.15, '2026-09-24T04:05:00Z')), null,
               'p1 would be OLDER than the poller\'s p1 — never shown, and never a mixed pair');
  assert.ok(ctx.KNS._streamNowOver(CARD, OCS(5.0, 1.15, '2026-09-24T03:50:00Z')),
            'both stream sides at least as new, one strictly newer: shown');
});

test('half a pair is no pair', async () => {
  const { ctx } = makeCtx([HB(1000), PX('borges', 1.18, '2026-09-24T04:20:00Z')]);
  await tick();
  assert.equal(ctx.KNS._streamNowOver(CARD, OCS(null, null, null)), null);
});

test('a dead stream is never labelled live, and the real time is shown', async () => {
  const failing = { ...HB(1000), note: { connected: true, write_ok: false } };
  for (const [hb, want] of [[HB(10000), true], [HB(400000), false], [HB(1000, false), false], [failing, false]]) {
    const { ctx } = makeCtx([hb, PX('carabelli', 4.8, '2026-09-24T04:20:00Z'),
                             PX('borges', 1.18, '2026-09-24T04:20:00Z')]);
    await tick();
    const sp = ctx.KNS._streamNowOver(CARD, OCS(null, null, null));
    assert.equal(sp.live, want);
    const line = ctx.KNS.mcNowSrcHtml(sp);
    assert.equal(line.includes('● live'), want);
    assert.match(line, /Bet105 · updated 04:20 · 10m ago/);
  }
});

test('Realtime push applies directly; an older push never moves Now back', async () => {
  const { ctx, sockets } = makeCtx([HB(1000), PX('carabelli', 4.8, '2026-09-24T04:20:00Z'),
                                    PX('borges', 1.18, '2026-09-24T04:20:00Z')]);
  await tick();
  const push = rec => sockets[0].onmessage({ data: JSON.stringify(
    { event: 'postgres_changes', payload: { data: { record: rec } } }) });
  push(PX('borges', 1.12, '2026-09-24T04:25:00Z'));
  assert.equal(ctx.KNS._streamNowOver(CARD, OCS(null, null, null)).p2, 1.12);
  push(PX('borges', 1.30, '2026-09-24T04:10:00Z'));
  assert.equal(ctx.KNS._streamNowOver(CARD, OCS(null, null, null)).p2, 1.12);
  assert.equal(ctx.window.KiblNow.samples.length, 1, 'only the applied push is a delay sample');
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
