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
  assert.match(l, /market_live_current\?select=event_key,venue,liquidity,read_at,started_at/);
  assert.match(l, /market_live_beat\?select=beat_at/);
  assert.match(l, /window\.SUPABASE_ANON_KEY/);
});
