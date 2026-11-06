// Founder 2026-11-06: the Market Signal liquidity lines read the per-minute table (market_live_current) when it is
// usable, frozen by the database at our live sighting. Executes the shipped mcSigLiqRec / mcSigPolyHtml / mcSigKalshiHtml.
// Checks: a fresh row wins over the 30-min file; a frozen row always wins (also over a newer file read, which can be
// in-play) and its hover says "last read before the start"; with the recorder down (stale beat) the newer file read
// wins; no row → the file, exactly as before; the drawer starts the per-minute poll; the loader reads the table + beat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
const NOW = Date.parse('2026-11-06T12:00:00Z');
const S = (kal, live, beatAgoMin) => new Function('kal', 'live', 'beatAt', `
  const Date_ = Date; const newsTz = () => 'UTC';
  const MKT_LIVE_STALE_MS = 3 * 60e3;
  const mktLive = { byEvent: live, beatAt };
  let polymarketVol = null, kalshiVol = kal;
  const _now = ${NOW}; Date.now = () => _now;
  ${slice('eventKeyOfMatch')} ${slice('psEsc')} ${slice('mcSigClock')} ${slice('mcSigPolyUsd')} ${slice('mcSigLiveFresh')}
  ${slice('mcSigLiqRec')} ${slice('mcSigPolyHtml')} ${slice('mcSigKalshiHtml')}
  return { mcSigKalshiHtml, mcSigLiqRec };`)(kal, live, NOW - beatAgoMin * 60e3);
const FILE = { generatedAt: '2026-11-06T11:30:00Z', byEvent: { '12177788': { event: 'KX', liquidity: 243875, liquidityAt: '2026-11-06T11:30:00Z' } } };
const m = { id: 'upcoming-12177788', p1: 'B. Shelton', p2: 'T. Paul' };
const row = (liq, at, started) => ({ '12177788|kalshi': { event_key: '12177788', venue: 'kalshi', liquidity: liq, read_at: at, started_at: started || null } });
const liqOf = (h) => (h.match(/mc-sg-polyv">([^<]*)</) || [])[1];

test('a fresh per-minute row wins over the 30-min file', () => {
  const h = S(FILE, row('250100.5', '2026-11-06T11:59:00Z'), 1).mcSigKalshiHtml(m);
  assert.equal(liqOf(h), '$250,101 liquidity');
  assert.match(h, /read Fri 06 Nov, 11:59"/);
  assert.doesNotMatch(h, /before the start/);
});
test('a frozen row always wins, even over a newer file read, and says so', () => {
  const late = { ...FILE, byEvent: { '12177788': { ...FILE.byEvent['12177788'], liquidityAt: '2026-11-06T11:58:00Z', liquidity: 1 } } };
  const h = S(late, row('240000', '2026-11-06T11:40:00Z', '2026-11-06T11:40:30Z'), 60).mcSigKalshiHtml(m);
  assert.equal(liqOf(h), '$240,000 liquidity');
  assert.match(h, /read Fri 06 Nov, 11:40 · last read before the start"/);
});
test('recorder down (stale beat): the newer file read wins; an older file still loses to the row', () => {
  assert.equal(liqOf(S(FILE, row('200000', '2026-11-06T11:00:00Z'), 10).mcSigKalshiHtml(m)), '$243,875 liquidity');
  assert.equal(liqOf(S(FILE, row('260000', '2026-11-06T11:45:00Z'), 10).mcSigKalshiHtml(m)), '$260,000 liquidity');
});
test('no row → exactly the file line as before; no file and no row → no line', () => {
  const h = S(FILE, {}, 1).mcSigKalshiHtml(m);
  assert.equal(liqOf(h), '$243,875 liquidity');
  assert.match(h, /read Fri 06 Nov, 11:30"/);
  assert.equal(S(null, {}, 1).mcSigKalshiHtml(m), '');
  assert.equal(liqOf(S(null, row('0', '2026-11-06T11:59:00Z'), 1).mcSigKalshiHtml(m)), '$0 liquidity', 'a genuine 0 is 0');
});
test('the drawer starts the per-minute poll; the loader reads the table and the beat with the publishable key', () => {
  assert.match(slice('toggleSig'), /if \(m\) mcSigLiveStart\(\);/);
  assert.match(slice('mcSigLiveStart'), /setInterval\(mcSigLiveTick, 60e3\)/);
  assert.match(slice('mcSigLiveTick'), /document\.hidden\) \{ clearInterval\(mktLiveTimer\)/, 'stops when no drawer is open or the tab is hidden');
  const l = slice('loadMarketLive');
  assert.match(l, /rowsOf\('event_key,venue,liquidity,outcomes,flow,read_at,started_at'\)\.then\(r => r \|\| rowsOf\('event_key,venue,liquidity,outcomes,read_at,started_at'\)\)/, 'without the traded column yet: the same read without it');
  assert.match(l, /market_live_beat\?select=beat_at/);
  assert.match(l, /window\.SUPABASE_ANON_KEY/);
  assert.match(html, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(!document\.hidden && document\.querySelector\('\.match-card\.sig-open'\)\) mcSigLiveStart\(\); \}\);/, 'resumes when the tab comes back');
  assert.match(slice('mcSigLiveTick'), /if \(panel\.dataset\.liveHtml !== html\)/, 'repaints only on a change');
});
test('the loader: placeholder config reads nothing; real config reads the table rows + beat', async () => {
  const L = (cfg, fetchImpl) => new Function('window', 'fetch', `let mktLive = { byEvent: {}, beatAt: NaN }, mktLiveP = null; ${slice('loadMarketLive')} return loadMarketLive().then(() => mktLive);`)(cfg, fetchImpl);
  let calls = 0;
  const none = await L({ SUPABASE_URL: '__SUPABASE_URL__', SUPABASE_ANON_KEY: '__SUPABASE_ANON_KEY__' }, () => { calls++; });
  assert.equal(calls, 0, 'placeholder config: no request');
  assert.deepEqual(none.byEvent, {});
  const urls = [];
  const got = await L({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_ANON_KEY: 'pk' }, async (u) => {
    urls.push(u);
    return { ok: true, json: async () => u.includes('market_live_beat') ? [{ beat_at: '2026-11-06T11:59:00Z' }]
      : [{ event_key: '1', venue: 'kalshi', liquidity: '5', read_at: '2026-11-06T11:59:00Z', started_at: null }] };
  });
  assert.equal(urls.length, 2);
  const urls2 = [];
  const fb = await L({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_ANON_KEY: 'pk' }, async (u) => {
    urls2.push(u);
    if (u.includes('flow')) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => u.includes('market_live_beat') ? [] : [{ event_key: '2', venue: 'kalshi', liquidity: '7', read_at: '2026-11-06T11:59:00Z', started_at: null }] };
  });
  assert.equal(urls2.length, 3, 'a 400 on the new column → one retry without it');
  assert.equal(fb.byEvent['2|kalshi'].liquidity, '7');
  assert.ok(urls[0].startsWith('https://x.supabase.co/rest/v1/market_live_current?'));
  assert.equal(got.byEvent['1|kalshi'].liquidity, '5');
  assert.equal(got.beatAt, Date.parse('2026-11-06T11:59:00Z'));
});

// Founder design 2026-11-07 (CHANGES §2–§3): the Kalshi / Polymarket rows of the Market Signal ledger.
const MK = (live, kal = null, poly = null) => new Function('live', 'kal', 'poly', `
  const newsTz = () => 'UTC';
  const MKT_LIVE_STALE_MS = 3 * 60e3;
  const mktLive = { byEvent: live, beatAt: ${NOW} };
  let polymarketVol = poly, kalshiVol = kal;
  const _now = ${NOW}; Date.now = () => _now;
  ${slice('eventKeyOfMatch')} ${slice('psEsc')} ${slice('mcSigClock')} ${slice('mcSigPolyUsd')} ${slice('mcSigLiveFresh')} ${slice('mxSurname')}
  ${slice('ocsNfd')} ${slice('mcSigLiqRec')} ${slice('mcSigSurKey')} ${slice('mcSigK')} ${slice('mcSigPredRows')} ${slice('mcSigRowHtml')}
  return { rows: (m, done) => mcSigPredRows(m, done), html: (m, done, W) => mcSigPredRows(m, done).map(r => mcSigRowHtml(r, W || null, null)).join('') };`)(live, kal, poly);
const OC = [{ name: 'Tommy Paul', bid: 0.54, ask: 0.55, mid: 0.545 }, { name: 'Ben Shelton', bid: 0.45, ask: 0.46, mid: 0.455 }];
const prow = (venue, at, extra = {}) => ({ [`12177788|${venue}`]: { event_key: '12177788', venue, liquidity: '242649.08', outcomes: OC, read_at: at, started_at: null,
  flow: { byName: { 'Ben Shelton': 27512.4, 'Tommy Paul': 3700 }, trades: 430, at }, ...extra } });

test('prediction rows: each player by surname, the mid scaled to 100% as fair odds, a $ chip under each price, "$X traded · N trades" under the name', () => {
  const h = MK(prow('kalshi', '2026-11-06T11:59:10Z')).html(m, false);
  assert.match(h, /<span class="mc-sg-name">Kalshi<\/span><\/span><span class="mc-sg-meta">\$31\.2k traded · 430 trades<\/span><\/span>/);
  assert.match(h, /<span class="mc-sg-oa"><span class="mc-sg-o">2\.20<\/span><span class="mc-sg-chip">\$27\.5k<\/span><\/span><span class="mc-sg-pa">46%<\/span>/, 'Shelton (p1) = 0.455 → 2.20, though the venue lists Paul first; the trailing side grey');
  assert.match(h, /<span class="mc-sg-pb lead">55%<\/span><span class="mc-sg-ob"><span class="mc-sg-o">1\.83<\/span><span class="mc-sg-chip lead">\$3\.7k<\/span>/, 'the leaning side lead');
  assert.match(h, /live mid \(best bid and ask, both players scaled to 100%\) · read Fri 06 Nov, 11:59 · bid \/ ask Shelton 0\.45 \/ 0\.46, Paul 0\.54 \/ 0\.55 · traded Shelton \$27\.5k, Paul \$3\.7k[^"]*\$242\.6k resting \(read Fri 06 Nov, 11:59\) · not a bookmaker price/, 'resting liquidity in the hover only');
  assert.match(MK(prow('polymarket', '2026-11-06T11:59:10Z')).html(m, false), /title="Kalshi · no market for this match"/, 'the other venue: a dash row');
});
test('prediction rows: Upcoming shows the current read (a frozen one says so); Completed only a row frozen before the start', () => {
  const fz = prow('kalshi', '2026-11-06T11:40:00Z', { started_at: '2026-11-06T11:40:30Z' });
  assert.match(MK(fz).html(m, false), /read Fri 06 Nov, 11:40 · last read before the start/);
  assert.match(MK(fz).html(m, true), /last mid before the start/, 'Completed reads the frozen row');
  assert.match(MK(prow('kalshi', '2026-11-06T11:59:10Z')).html(m, true), /title="Kalshi · no read stored from before the start/, 'Completed never shows an unfrozen read');
  assert.match(MK({ '12177788|kalshi': { ...fz['12177788|kalshi'], outcomes: null, liquidity: null } }).html(m, true), /no price read before the start/);
});
test('prediction rows: no confident player match or no mid → a dash row (never a guess); no traded sum → no chips', () => {
  const twoSame = { '12177788|kalshi': { ...prow('kalshi', '2026-11-06T11:59:10Z')['12177788|kalshi'], outcomes: [{ name: 'Ben Shelton', mid: 0.5 }, { name: 'Tom Shelton', mid: 0.5 }] } };
  assert.match(MK(twoSame).html(m, false), /title="Kalshi · no price for both players · \$242\.6k resting/);
  const noMid = { '12177788|kalshi': { ...prow('kalshi', '2026-11-06T11:59:10Z')['12177788|kalshi'], outcomes: [{ name: 'Tommy Paul', mid: null }, OC[1]] } };
  assert.match(MK(noMid).html(m, false), /title="Kalshi · no price for both players/);
  const noFlow = { '12177788|kalshi': { ...prow('kalshi', '2026-11-06T11:59:10Z')['12177788|kalshi'], flow: null } };
  const h = MK(noFlow).html(m, false);
  assert.doesNotMatch(h, /mc-sg-chip|mc-sg-meta/);
  assert.match(h, /<span class="mc-sg-o">2\.20<\/span><\/span>/);
});
test('Completed: the winner\'s side carries the lead on prediction rows too', () => {
  const fz = prow('kalshi', '2026-11-06T11:40:00Z', { started_at: '2026-11-06T11:40:30Z' });
  const h = MK(fz).html(m, true, 'a');
  assert.match(h, /<span class="mc-sg-o lead">2\.20<\/span><span class="mc-sg-chip lead">\$27\.5k<\/span>/, 'Shelton won: his side lead although the market had him at 46%');
  assert.match(h, /<span class="a win" style="width:45\.5/);
});
