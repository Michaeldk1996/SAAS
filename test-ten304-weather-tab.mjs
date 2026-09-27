// TEN-304 Wave B · Match analysis → Weather tab. Executes the PAGE's renderer (sliced out of
// bsp-consult-dashboard.html by tools/ten304-weather-harness.mjs) — no rule is re-implemented here.
// Each test names the mutation that makes it fail; tools/test-ten304-mutants.js runs them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, makeFile, elements, text } from './tools/ten304-weather-harness.mjs';

const NOW = Date.parse('2026-09-27T04:00:00Z');                       // 12:00 in Chengdu
const FETCHED = '2026-09-27T02:00:00Z';                               // 2 h old
const ENTRY = { key: 'Chengdu', indoor: false, file: 'weather/chengdu.json' };
// Mannarino v Shapovalov: 10:00 Berlin (CEST) = 08:00Z = 16:00 Chengdu.
const M = { tour: 'ATP Chengdu', date: '2026-09-27', time: '10:00', surface: 'Hard',
            courtSpeed: { abstractSpeed: 1.17, category: 'Fast' } };
const file = (hour, extra = {}) => makeFile(Object.assign({ from: '2026-09-25', fetchedAt: FETCHED, hour }, extra));
const render = (f, opts = {}, m = M, entry = ENTRY, now = NOW) => build(opts).buildWeatherSection(m, entry, f, now);

// Mutation: drop the `v == null → 'u'` branch in wxSev (a null reads as calm) or let a 'u' factor lead.
test('a factor with a null headline value renders "—", is UNAVAILABLE, and is never the lead', () => {
  const f = file((d, h) => d === '2026-09-27' && h === 16 ? { gusts: null, wind: 30, feels: 36 } : {});
  const html = render(f);
  const lead = elements(html, 'wx-lead');
  assert.equal(lead.length, 1);
  assert.match(lead[0], /data-factor="heat"/, 'heat (a real CONCERN value) leads, not the missing wind');
  const wind = elements(html, 'wx-tile').find(t => /data-factor="wind"/.test(t));
  assert.ok(wind, 'wind tile rendered');
  assert.equal(text(elements(wind, 'wx-val')[0]), '—');
  assert.equal(text(elements(wind, 'wx-sevl')[0]), 'UNAVAILABLE');
  assert.ok(!/>0 km\/h</.test(html), 'a missing gust never shows as 0');
  // gusts missing and nothing else hot → no lead at all, verdict never claims "no concern" from a partial read
  const f2 = file((d, h) => d === '2026-09-27' && h === 16 ? { gusts: null } : {});
  const h2 = render(f2);
  assert.equal(elements(h2, 'wx-lead').length, 0);
  assert.ok(!text(elements(h2, 'wx-verdict')[0]).includes('No weather concern at match time.'));
});

// Mutation: remove the `if (vm.indoor) return wrap(<indoor panel>)` early return.
test('indoor flag true → only the indoor panel renders (no strip, no tiles)', () => {
  const html = render(null, {}, M, { key: 'Basel', indoor: true, file: null });
  assert.equal(elements(html, 'wx-indoor').length, 1);
  for (const c of ['wx-strip', 'wx-tiles', 'wx-tile', 'wx-day', 'wx-verdict', 'wx-head']) assert.equal(elements(html, c).length, 0, c);
});

// Mutation: raise/ignore staleHours.unavailable, or print "—" instead of the real stamp.
test('a forecast older than the cut-off → unavailable, with the real last-update time in the freshness line', () => {
  const f = file(() => ({}), { fetchedAt: '2026-09-26T00:00:00Z' });           // 28 h old
  const html = render(f);
  assert.equal(elements(html, 'wx-banner').length, 1);
  const fresh = text(elements(html, 'wx-fresh')[0]);
  assert.match(fresh, /last successful update Sep 26, 08:00/, fresh);           // 00:00Z = 08:00 venue time
  assert.ok(!fresh.includes('update —'));
  assert.ok(elements(html, 'wx-day').every(d => text(elements(d, 'wx-hi')[0]) === '—'));
  // control: 2 h old is not unavailable
  assert.equal(elements(render(file(() => ({}))), 'wx-banner').length, 0);
});

// Mutation: build the badge from m.time as a wall clock, or format it in the viewer's zone.
test('the MATCH badge is the header\'s instant in venue time, for viewers in other zones', () => {
  for (const [viewerTz, headerTime] of [['UTC', '08:00'], ['Asia/Shanghai', '16:00'], ['America/New_York', '04:00']]) {
    const R = build({ viewerTz });
    const header = R.aContextLine(M, 'Quarter-finals');
    assert.equal(header, 'ATP Chengdu · Quarter-finals · ' + headerTime, viewerTz);
    const html = R.buildWeatherSection(M, ENTRY, file(() => ({})), NOW);
    assert.equal(text(elements(html, 'wx-badge')[0]), 'MATCH · 16:00', viewerTz);    // same instant, Chengdu clock
    // header instant (viewer zone) and badge instant (venue zone) are the same moment
    assert.equal(R.cardStartMs(M), Date.parse('2026-09-27T08:00:00Z'));
  }
  // after the DST change the same wall clock is one hour later in UTC (CET)
  const late = Object.assign({}, M, { date: '2026-10-26' });
  assert.equal(build({ viewerTz: 'UTC' }).aContextLine(late, 'R1'), 'ATP Chengdu · R1 · 09:00');
});

// Mutation: widen WX_CONFIG.window to 0–23 (or drop the window filter in wxModel).
test('an hourly value outside 10:00–23:00 does not flag the day card', () => {
  const night = file((d, h) => d === '2026-09-28' && h === 3 ? { gusts: 60, rainChance: 95, feels: 40 } : {});
  const day = elements(render(night), 'wx-day').find(x => /data-date="2026-09-28"/.test(x));
  assert.equal(text(elements(day, 'wx-reason')[0]), 'No concern');
  const noon = file((d, h) => d === '2026-09-28' && h === 12 ? { gusts: 60 } : {});
  const day2 = elements(render(noon), 'wx-day').find(x => /data-date="2026-09-28"/.test(x));
  assert.equal(text(elements(day2, 'wx-reason')[0]), 'Gusts 60 km/h');       // control: inside the window flags
});

// Mutation: hard-code a cut-off in wxSev instead of reading WX_CONFIG.thresholds.
test('thresholds come from config: changing one flips severity in the render', () => {
  const f = file((d, h) => d === '2026-09-27' && h === 16 ? { gusts: 20 } : {});
  assert.equal(elements(render(f), 'wx-lead').length, 0, 'gusts 20 < placeholder watch 25');
  const R = build({ over: { WX_CONFIG: `{ thresholds: { gusts: { watch: 15, concern: 18 }, feels: { watch: 30, concern: 35 }, rain: { watch: 30, concern: 60 } },
    window: { fromHour: 10, toHour: 23 }, staleHours: { amber: 6, unavailable: 24 }, stripDays: 7, lowConfFromOffset: 3 }` } });
  const lead = elements(R.buildWeatherSection(M, ENTRY, f, NOW), 'wx-lead');
  assert.equal(lead.length, 1); assert.match(lead[0], /data-factor="wind"/); assert.match(text(lead[0]), /CONCERN/);
});

test('missing match time → badge "MATCH · TBC", header "… · time TBC", no-time verdict, dashed tiles', () => {
  const html = render(file(() => ({})), {}, Object.assign({}, M, { time: null }));
  assert.equal(text(elements(html, 'wx-badge')[0]), 'MATCH · TBC');
  assert.match(text(elements(html, 'wx-athead')[0]), /time TBC$/);
  assert.equal(text(elements(html, 'wx-verdict')[0]), 'Match time not set — no hourly forecast yet.');
  assert.ok(elements(html, 'wx-tile').filter(t => !/data-factor="pace"/.test(t)).every(t => text(elements(t, 'wx-val')[0]) === '—'));
});

test('court speed missing → pace tile "—", blank status, no effect text, no empty number in copy', () => {
  const html = render(file(() => ({})), {}, Object.assign({}, M, { courtSpeed: null }));
  const pace = elements(html, 'wx-tile').find(t => /data-factor="pace"/.test(t));
  assert.equal(text(elements(pace, 'wx-val')[0]), '—');
  assert.equal(text(elements(pace, 'wx-effect')[0]), '');
  assert.ok(!/\(\)|usual  |speed is  /.test(text(html)));
});

test('the test-only ?wxForce=unavailable param forces the unavailable state; nothing else does', () => {
  const f = file(() => ({}));
  assert.equal(elements(build({ search: '?wxForce=unavailable' }).buildWeatherSection(M, ENTRY, f, NOW), 'wx-banner').length, 1);
  assert.equal(elements(build({ search: '?wxForce=1' }).buildWeatherSection(M, ENTRY, f, NOW), 'wx-banner').length, 0);
});
