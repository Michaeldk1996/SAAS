// TEN-304 Wave B · Match analysis → Weather tab. Executes the PAGE's renderer (sliced out of
// bsp-consult-dashboard.html by tools/ten304-weather-harness.mjs) — no rule is re-implemented here.
// Each test names the mutation that makes it fail; tools/test-ten304-mutants.js runs them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build, buildTips, buildCache, buildReport, attrsOf, makeFile, elements, text, HTML } from './tools/ten304-weather-harness.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
// TEN-376: the modal's token file (match-analysis-tokens.css) is gone — every colour resolves through tokens.css (Night).
const FOUNDATION_CSS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const NIGHT_TOKENS = (() => {
  const T = {};
  for (const b of FOUNDATION_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/day/.test(b[1])) continue;                               // Night = :root / [data-theme="night"]
    for (const m of b[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) T[m[1]] = m[2].trim();
  }
  return T;
})();
function resolveToken(value, depth = 0) {                         // var() chains + color-mix(…, transparent) → #RRGGBB / RGBA(r,g,b,a)
  if (depth > 20) throw new Error('var() cycle at ' + value);
  const rgba = v => { const s = String(v).replace(/\s+/g, '').toUpperCase(); let m = /^#([0-9A-F]{6})$/.exec(s);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
    m = /^RGBA?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/.exec(s); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; };
  const fmt = c => c[3] === 1 ? '#' + c.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase() : `RGBA(${c[0]},${c[1]},${c[2]},${+c[3].toFixed(4)})`;
  let v = String(value).trim().replace(/var\(--([\w-]+)\)/g, (_, n) => {
    if (!(n in NIGHT_TOKENS)) throw new Error(`--${n} is not set by tokens.css`);
    return resolveToken(NIGHT_TOKENS[n], depth + 1);
  });
  v = v.replace(/color-mix\(in srgb,\s*([^%]+?)\s+([\d.]+)%\s*,\s*transparent\)/g, (all, c, p) => {
    const x = rgba(c); if (!x) throw new Error('color-mix of a non-colour: ' + all); return fmt([x[0], x[1], x[2], x[3] * p / 100]); });
  const c = rgba(v); return c ? fmt(c) : v;
}
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// build-weather.js itself (the mutant runner points TEN304_BW at a mutated copy)
const BW = createRequire(import.meta.url)(process.env.TEN304_BW || './build-weather.js');

const NOW = Date.parse('2026-09-27T04:00:00Z');                       // 12:00 in Chengdu
const FETCHED = '2026-09-27T02:00:00Z';                               // 2 h old
const ENTRY = { key: 'Chengdu', indoor: false, file: 'weather/chengdu.json' };
// Mannarino v Shapovalov: 10:00 Berlin (CEST) = 08:00Z = 16:00 Chengdu.
const M = { tour: 'ATP Chengdu', date: '2026-09-27', time: '10:00', surface: 'Hard',
            courtSpeed: { abstractSpeed: 1.17, category: 'Fast' } };
const M0 = M;
const file = (hour, extra = {}) => makeFile(Object.assign({ from: '2026-09-25', fetchedAt: FETCHED, hour }, extra));
const render = (f, opts = {}, m = M, entry = ENTRY, now = NOW) => build(opts).buildWeatherSection(m, entry, f, now);

// Mutation: drop the `v == null → 'u'` branch in wxSev (a null reads as calm) or let a 'u' factor lead.
test('a factor with a null headline value renders "—", is UNAVAILABLE, and is never the lead', () => {
  const f = file((d, h) => d === '2026-09-27' && h === 16 ? { gusts: null, wind: 30, feels: 36 } : {});
  const html = render(f);
  const lead = elements(html, 'wx-lead');
  assert.equal(lead.length, 1);
  assert.match(text(elements(html, 'wx-verdict')[0]), /^Main factor at match time: Heat — feels like 36°$/);
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
  assert.match(fresh, /· Open-Meteo$/, 'the real provider is named');
  assert.ok(elements(html, 'wx-day').every(d => text(elements(d, 'wx-hi')[0]) === '—'));
  // control: 2 h old is not unavailable
  assert.equal(elements(render(file(() => ({}))), 'wx-banner').length, 0);
});

// Mutation: badge in the viewer zone; header formatted in UTC. The renderer runs in a child process
// whose REAL process zone is set with TZ (no zone preference: newsTz() is undefined, as on the page).
test('Chengdu match viewed with TZ=Asia/Shanghai vs TZ=UTC: badge (venue time) and header (viewer time) are one instant', () => {
  const harness = new URL('./tools/ten304-weather-harness.mjs', import.meta.url).href;
  const child = `import { build, makeFile, elements, text } from ${JSON.stringify(harness)};
    const M = ${JSON.stringify(M)}, ENTRY = ${JSON.stringify(ENTRY)};
    const R = build({});
    const f = makeFile({ from: '2026-09-25', fetchedAt: ${JSON.stringify(FETCHED)} });
    const html = R.buildWeatherSection(M, ENTRY, f, ${NOW});
    console.log(JSON.stringify({ header: R.aContextLine(M, 'Quarter-finals'), badge: text(elements(html, 'wx-badge')[0]),
      athead: text(elements(html, 'wx-athead')[0]), start: R.cardStartMs(M) }));`;
  const out = {};
  for (const tz of ['Asia/Shanghai', 'UTC']) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    out[tz] = JSON.parse(r.stdout.trim().split('\n').pop());
  }
  // header = viewer's clock; badge = Chengdu's clock (UTC+8) of the SAME instant, whoever views it
  assert.equal(out['Asia/Shanghai'].header, 'ATP Chengdu · Quarter-finals · 16:00');
  assert.equal(out['UTC'].header, 'ATP Chengdu · Quarter-finals · 08:00');
  for (const tz of ['Asia/Shanghai', 'UTC']) {
    assert.equal(out[tz].badge, 'MATCH · 16:00', tz);
    assert.equal(out[tz].athead, 'Sun Sep 27 · 16:00', tz);
    assert.equal(out[tz].start, Date.parse('2026-09-27T08:00:00Z'), tz);
  }
  // the header's clock time, read in the viewer's zone, is the badge's instant
  const hm = s => s.slice(-5), at = (hhmm, offH) => Date.parse('2026-09-27T' + hhmm + ':00Z') - offH * 3600e3;
  assert.equal(at(hm(out['UTC'].header), 0), at(hm(out['UTC'].badge), 8));
  assert.equal(at(hm(out['Asia/Shanghai'].header), 8), at(hm(out['Asia/Shanghai'].badge), 8));
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

// Founder Q21 (2026-09-30): the heat flag is the file's words ("Heat — high", DF L2411) at the EXISTING feels-like
// severities — watch and concern both, the colour telling them apart (TEN-376: watch neutral --text-soft, concern
// --neg; amber is Model + Trading Report only); wind keeps its value flag.
// Mutation: WX_COPY.flag.heat back to "Feels like {v}°" (tools/test-ten304-mutants.js).
test('Q21: the heat flag reads "Heat — high" at watch and at concern, at the WX_CONFIG cut-offs', () => {
  const T = build().WX_COPY.flag.heat, cut = build().WX_CONFIG.thresholds.feels;
  assert.deepEqual([cut.watch, cut.concern], [30, 35], 'no threshold change (D8 still open)');
  assert.deepEqual(T, { a: 'Heat — high', r: 'Heat — high' });
  const at = feels => { const f = file((d, h) => d === '2026-09-28' && h === 14 ? { feels } : {});
    return elements(render(f), 'wx-day').find(x => /data-date="2026-09-28"/.test(x)); };
  const watch = at(31), concern = at(36), calm = at(29);
  assert.equal(text(elements(watch, 'wx-reason')[0]), 'Heat — high');
  assert.equal(text(elements(concern, 'wx-reason')[0]), 'Heat — high');
  assert.equal(text(elements(calm, 'wx-reason')[0]), 'No concern', 'below the watch cut-off no flag');
  assert.equal(elements(watch, 'wx-dot').length + elements(concern, 'wx-dot').length, 0, 'TEN-380 review item 2: the flag is text only, no status dot');
  assert.ok(!/Feels like \d/.test(watch + concern), 'never the old "Feels like {v}°" flag');
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

// Mutation: a <script src> to the pixel fixture/harness in the dashboard, or a cp of tools/ into _site.
test('the test-only pixel fixture never ships: not referenced by the dashboard, not in the deploy allowlist', async () => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('./', import.meta.url);
  const page = readFileSync(new URL('bsp-consult-dashboard.html', root), 'utf8');
  for (const s of ['ten304-weather-fixture', 'ten304-weather-harness', '__wxDiff', '__wxCol']) assert.ok(!page.includes(s), s);
  const yml = readFileSync(new URL('.github/workflows/pipeline.yml', root), 'utf8');
  const assemble = yml.slice(yml.indexOf('name: Assemble site'));
  const copies = assemble.split('\n').filter(l => /^\s*(cp|rsync)\s/.test(l));
  assert.ok(copies.length > 10, 'the assemble step was found');
  assert.ok(!copies.some(l => /tools|ten304-weather-f/.test(l)), copies.filter(l => /tools/.test(l)).join('\n'));
  // …and the files the tab DOES fetch are published
  assert.ok(copies.some(l => /cp weather-index\.json _site\//.test(l)), 'weather-index.json copied');
  assert.ok(copies.some(l => /cp -r weather _site\//.test(l)), 'weather/ copied');
});

// Mutation: the shared delay changed (250 → 0), the focusin listener dropped, or a Weather tip moved to
// another attribute / a second tooltip. The Weather tab's chip, "+1" and day cards are driven through
// TEN-303's REAL initAOddsTips / aOddsTipShow (sliced from the page) with a fake DOM and clock.
test('Weather tooltips use the ONE shared tooltip: data-aotip + tabindex, 250 ms delay, hover and keyboard focus', () => {
  // two flags at the match hour (10:00 Berlin = 16:00 Chengdu) → "+1" on the match-day tile (founder review 2: match-time figures)
  const f = file((d, h) => d === '2026-09-27' && h === 16 ? { gusts: 40, feels: 36 } : {});
  const html = render(f);
  const targets = { more: attrsOf(html, 'wx-more'), day: attrsOf(html, 'wx-day') };
  assert.equal(attrsOf(html, 'wx-tbd').length, 0, 'TEN-380 review item 1: no THRESHOLDS chip'); assert.ok(targets.more.length >= 1); assert.equal(targets.day.length, 7);
  for (const [k, list] of Object.entries(targets)) for (const a of list) {
    assert.equal(a.tabindex, '0', k + ' is keyboard-focusable');
    assert.ok(a['data-aotip'] && a['data-aotip'].length > 20, k + ' carries a shared-tooltip body');
    assert.ok(!('title' in a) && !('data-sftip' in a), k + ': no native title, no second tooltip');
  }
  assert.ok(!/data-sftip|\bsfTip|SF_TIP/.test(HTML), 'no second tooltip component on the page');
  assert.match(targets.more[0]['data-aotip'], /Heat — high/);   // founder Q21: the file's words
  assert.match(targets.day[0]['data-aotip'], /Max gusts.*40 km\/h.*Open-Meteo/s);
  for (const type of ['focusin', 'mouseover']) {
    for (const a of [targets.more[0], targets.day[0]]) {
      const T = buildTips(); T.api.initAOddsTips();
      const el = T.mkEl(a);
      T.fire(type, el);
      assert.equal(T.tip(), null, type + ': nothing before the delay');
      assert.deepEqual(T.delays, [250], type + ': the shared 250 ms delay');
      T.tick(249); assert.equal(T.tip(), null);
      T.tick(1); assert.equal(T.tip(), a['data-aotip'], type + ': the body shows after 250 ms');
      T.fire(type === 'focusin' ? 'focusout' : 'mouseout', el); assert.equal(T.tip(), null, 'hidden on leave / blur');
    }
  }
});

// ── review fold-in (TEN-304 Wave B) ─────────────────────────────────────────────────────────────────
// Mutation: build-weather.js keeps Open-Meteo's fixed-offset labels as if they were true instants
// (`t - off * 1000` → `t`), or the page buckets hours in UTC instead of the venue's IANA zone.
test('DST: a Sydney match after the 4 Oct 2026 change reads the RIGHT hour (real toFile → page renderer)', () => {
  // Open-Meteo, timezone=auto, Sydney 3–8 Oct 2026: every label at the FIXED +10 of the range start.
  const time = []; for (let h = 0; h < 6 * 24; h++) time.push(`2026-10-0${3 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`);
  const base = (v) => time.map(() => v);
  const gusts = base(12), feels = base(20);
  gusts[time.indexOf('2026-10-05T15:00')] = 41;     // label 15:00 (+10) = 05:00Z = 16:00 AEDT, the match hour
  feels[time.indexOf('2026-10-05T09:00')] = 33;     // label 09:00 (+10) = 23:00Z 4 Oct = 10:00 AEDT 5 Oct: IN the window
  feels[time.indexOf('2026-10-06T09:00')] = 34;     // label 09:00 (+10) 6 Oct = 10:00 AEDT 6 Oct: in 6 Oct's window
  const f = BW.toFile('Sydney', -33.9, 151.2, { timezone: 'Australia/Sydney', utc_offset_seconds: 36000,
    hourly: { time, temperature_2m: base(18), relative_humidity_2m: base(50), apparent_temperature: feels, precipitation_probability: base(5),
      precipitation: base(0), wind_speed_10m: base(8), wind_gusts_10m: gusts },
    daily: { time: ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'], weather_code: base(3).slice(0, 6),
      temperature_2m_max: base(22).slice(0, 6), temperature_2m_min: base(14).slice(0, 6) } }, '2026-10-05T00:00:00Z');
  // 16:00 AEDT 5 Oct = 05:00Z = 07:00 Berlin (CEST), the api-tennis wall clock
  const m = { tour: 'ATP Sydney', date: '2026-10-05', time: '07:00', surface: 'Hard' };
  const html = build({ viewerTz: 'UTC' }).buildWeatherSection(m, { key: 'Sydney', indoor: false, file: 'weather/sydney.json' }, f, Date.parse('2026-10-05T01:00:00Z'));
  assert.equal(text(elements(html, 'wx-badge')[0]), 'MATCH · 16:00');
  const lead = elements(html, 'wx-lead');
  assert.equal(lead.length, 1, 'the 41 km/h gust at the true match hour leads');
  assert.match(lead[0], /data-factor="wind"/); assert.match(text(lead[0]), /41/);
  const d5 = elements(html, 'wx-day').find(x => /data-date="2026-10-05"/.test(x));
  assert.equal(text(elements(d5, 'wx-reason')[0]).replace(/\+1$/, ''), 'Gusts 41 km/h');
  // founder review 2 (2026-10-04): the match-day tile prints the match-hour figures (feels 20° at 16:00 → no heat flag);
  // its hover still carries the window max, so the 10:00 AEDT 33° proves the DST bucketing there, and 6 Oct's tile too.
  assert.doesNotMatch(d5, /class="wx-reason"[^>]*>Heat/, 'match day: the match-hour figures, not the window max');
  assert.match(d5, /Feels-like max.*?33°/s, '10:00 AEDT is inside the playing window (the day hover)');
  const d6 = elements(html, 'wx-day').find(x => /data-date="2026-10-06"/.test(x));
  assert.match(d6, /Heat — high/, '10:00 AEDT 6 Oct is inside that day\'s window');
});

// Mutation: wxFileDue never says due for a cached file; the matches reload no longer marks the index stale.
test('session cache: a venue file ≥ 3 h old is fetched again on open; a matches reload re-reads the index and the open tab', async () => {
  const H = 3600e3, T0 = Date.parse('2026-09-27T04:00:00Z');
  const M = Object.assign({}, M0, { time: '20:00' });   // 18:00Z: still upcoming at every clock below
  let fileAt = T0 - 2 * H, tours = { 'ATP Chengdu': ENTRY };
  const server = url => url === 'weather-index.json' ? { v: 1, tours } : url === 'weather/chengdu.json' ? file(() => ({}), { fetchedAt: new Date(fileAt).toISOString() }) : null;
  const C = buildCache({ server });
  C.clock.now = T0; C.api.setMatch(M);
  await C.api.openWeatherTab();
  assert.deepEqual(C.calls, ['./weather-index.json', './weather/chengdu.json']);
  C.clock.now = T0 + 0.5 * H; await C.api.openWeatherTab();
  assert.equal(C.calls.length, 2, 'a 2.5 h old copy is not refetched');
  fileAt = T0 + 0.9 * H;                                          // the pipeline published a fresh one
  C.clock.now = T0 + 1.1 * H; await C.api.openWeatherTab();       // cached copy now 3.1 h old
  assert.deepEqual(C.calls.slice(2), ['./weather/chengdu.json']);
  assert.equal(C.renders.pop().fetchedAt, new Date(fileAt).toISOString(), 'the fresh file is rendered');
  // a refetch that fails keeps the last good copy
  const C2 = buildCache({ server: (u, now) => (now > T0 + H && u !== 'weather-index.json') ? null : server(u) });
  C2.clock.now = T0; C2.api.setMatch(M); await C2.api.openWeatherTab();
  C2.clock.now = T0 + 5 * H; await C2.api.openWeatherTab();
  assert.equal(C2.calls.length, 3); assert.ok(C2.renders.pop().fetchedAt, 'last good copy kept, never blank');
  C2.clock.now = T0 + 5 * H + 60e3; await C2.api.openWeatherTab();
  assert.equal(C2.calls.length, 3, 'no refetch storm: at most once per refetchGapMin');
  // matches reload: the index is re-read; an OPEN Weather tab re-renders; a new tournament appears
  const M2 = Object.assign({}, M, { tour: 'ATP Hangzhou' });
  C.api.setMatch(M2); await C.api.openWeatherTab();
  assert.equal(C.renders.pop().entry, null, 'not in the index yet');
  tours = Object.assign({}, tours, { 'ATP Hangzhou': { key: 'Hangzhou', indoor: true, file: null } });
  C.dom.tabActive = true; C.dom.modalOpen = true;
  const n = C.calls.length; C.api.wxOnMatchesReload(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(C.calls.slice(n), ['./weather-index.json']);
  assert.deepEqual(C.renders.pop().entry, { key: 'Hangzhou', indoor: true, file: null });
});

// Mutation: printAnalysisReport prints without waiting for the Weather load.
test('Download report waits for the Weather section before printing (tab never opened)', async () => {
  let done; const wx = new Promise(r => { done = r; });
  const R = buildReport({ openWeatherTab: () => wx });
  const p = R.print();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(!R.log.some(x => x.startsWith('print')), 'not printed while the Weather files load');
  done(); await p;
  assert.deepEqual(R.log.filter(x => x !== 'cap:8000'), ['add:printing', 'print:']);
});

// Mutation: drop the print fallback (a Weather load that never lands prints "Loading forecast…").
test('Download report never prints "Loading forecast…": an unloaded Weather section prints real dashes', async () => {
  const R0 = build({});
  const el = { innerHTML: '<div>' + R0.WX_COPY.loading + '</div>' };
  const R = buildReport({ openWeatherTab: () => Promise.resolve(), wx: { el, ready: false, m: M },
    buildWeatherSection: (m, e, f, now, a) => R0.buildWeatherSection(m, e, f, NOW, a) });
  await R.print();
  const printed = R.log.find(x => x.startsWith('print:'));
  assert.ok(!printed.includes(R0.WX_COPY.loading), 'no loading line in the report');
  assert.equal(elements(printed.slice(6), 'wx-banner').length, 1, 'the unavailable state');
  assert.ok(elements(printed.slice(6), 'wx-day').every(d => text(elements(d, 'wx-hi')[0]) === '—'), 'dashes, never a guess');
});

// Mutation: the pace shift reads an UNAVAILABLE rain as calm (the old `on('rain') ? … : on('heat') ? 'quicker'`).
test('pace: "PLAYS QUICKER" needs heat hot AND rain calm — an UNAVAILABLE rain gives no status and no copy', () => {
  const pace = f => elements(render(f), 'wx-tile').find(t => /data-factor="pace"/.test(t));
  const noRain = pace(file((d, h) => d === '2026-09-27' && h === 16 ? { feels: 32, rainChance: null } : {}));
  assert.equal(text(elements(noRain, 'wx-sevl')[0]), ''); assert.equal(text(elements(noRain, 'wx-effect')[0]), '');
  assert.equal(text(elements(noRain, 'wx-val')[0]), '1.17', 'the court speed itself still shows');
  const calmRain = pace(file((d, h) => d === '2026-09-27' && h === 16 ? { feels: 32, rainChance: 5 } : {}));
  assert.equal(text(elements(calmRain, 'wx-sevl')[0]), 'PLAYS QUICKER');   // control
});

// Mutation: drop `|| uncovered` (a match day the file does not reach renders a dashed strip with an "ok" line).
test('a match day outside the forecast file → the unavailable state, with the real last-update time', () => {
  const far = Object.assign({}, M, { date: '2026-10-20' });                    // beyond the file's last day
  const html = render(file(() => ({})), {}, far);
  assert.equal(elements(html, 'wx-banner').length, 1);
  assert.match(text(elements(html, 'wx-fresh')[0]), /^Forecast unavailable · last successful update Sep 27, 10:00 · Open-Meteo$/);
  assert.equal(text(elements(html, 'wx-verdict')[0]), 'Match-time forecast unavailable.');
  assert.equal(elements(render(file(() => ({}))), 'wx-banner').length, 0, 'control: an in-range match is available');
});

// ── founder rulings, 27 Sep 06:54Z ──────────────────────────────────────────────────────────────────
// Completed match = our archived pre-start forecast only (build-weather.js's real updateArchive builds it).
const PAST = Object.assign({}, M, { id: 'past-12166157' });                  // 08:00Z = 16:00 Chengdu
const LATER = Date.parse('2026-09-27T12:00:00Z');
const archOf = (fetchedAt, hour) => BW.updateArchive(null, makeFile({ from: '2026-09-25', fetchedAt, hour }),
  [{ key: '12166157', startMs: Date.parse('2026-09-27T08:00:00Z') }], LATER);
// Mutation: a started match reads the CURRENT file (archived = false), or the archived label is dropped.
test('completed match: the archived pre-start forecast shows, labelled "forecast, not observed"; none → unavailable', () => {
  const arch = archOf('2026-09-27T04:00:00Z', (d, h) => d === '2026-09-27' && h === 16 ? { gusts: 38 } : {});
  const R = build({});
  const html = R.buildWeatherSection(PAST, ENTRY, null, LATER, arch);
  assert.equal(elements(html, 'wx-banner').length, 0);
  assert.equal(text(elements(html, 'wx-athead')[0]), 'Sun Sep 27 · 16:00 · forecast, not observed');
  assert.equal(text(elements(html, 'wx-verdict')[0]), 'Main factor at match time: Wind — gusts 38 km/h');
  assert.equal(text(elements(html, 'wx-fresh')[0]), 'Archived forecast · fetched Sep 27, 12:00 · Open-Meteo');
  const tip = attrsOf(html, 'wx-day').find(a => a['data-date'] === '2026-09-27')['data-aotip'];
  assert.ok(tip.includes('archived forecast, not observed'), 'day tooltip labels the archive');
  // no archive → unavailable; a CURRENT forecast file is never read for a started match
  for (const [f, a] of [[null, null], [file(() => ({ gusts: 38 })), null], [file(() => ({ gusts: 38 })), { v: 1, days: {}, matches: {} }]]) {
    const h = R.buildWeatherSection(PAST, ENTRY, f, LATER, a);
    assert.equal(elements(h, 'wx-banner').length, 1);
    assert.equal(text(elements(h, 'wx-verdict')[0]), 'Match-time forecast unavailable.');
    assert.ok(!/38/.test(text(elements(h, 'wx-tiles')[0] || '')), 'never the current forecast for a past date');
    assert.ok(!text(elements(h, 'wx-athead')[0]).includes('not observed'), 'no archived label when nothing archived is shown');
  }
});

// Mutation: archived day tooltips stamp the MATCH row's fetch time instead of the day's own.
test('completed match: each archived day card says when ITS forecast was fetched', () => {
  const f = t => makeFile({ from: '2026-09-25', fetchedAt: t });
  const mk = [{ key: '12166157', startMs: Date.parse('2026-09-27T08:00:00Z') }];
  const arch = BW.updateArchive(BW.updateArchive(null, f('2026-09-27T01:00:00Z'), mk, LATER), f('2026-09-27T04:00:00Z'), mk, LATER);
  const html = build({}).buildWeatherSection(PAST, ENTRY, null, LATER, arch);
  const tipOf = date => attrsOf(html, 'wx-day').find(a => a['data-date'] === date)['data-aotip'];
  assert.ok(tipOf('2026-09-27').includes('Sep 27, 09:00'), 'the 27th: fetched 01:00Z (before its window)');
  assert.ok(tipOf('2026-09-28').includes('Sep 27, 12:00'), 'the 28th: the later pre-window fetch');
  assert.equal(text(elements(html, 'wx-fresh')[0]), 'Archived forecast · fetched Sep 27, 12:00 · Open-Meteo');
});

// Mutation: the partial verdict loses its {missing} list (or lists an available factor).
test('partial read: "No weather concern in the values we have. Missing: rain."', () => {
  const html = render(file((d, h) => d === '2026-09-27' && h === 16 ? { rainChance: null } : {}));
  assert.equal(text(elements(html, 'wx-verdict')[0]), 'No weather concern in the values we have. Missing: rain.');
  const h2 = render(file((d, h) => d === '2026-09-27' && h === 16 ? { rainChance: null, gusts: null } : {}));
  assert.equal(text(elements(h2, 'wx-verdict')[0]), 'No weather concern in the values we have. Missing: wind, rain.');
});

// Mutation: the zone ignores the index entry's tz (falls back to the viewer's zone with no forecast file).
test('no forecast file: venue time still comes from the venue list (index tz); the viewer-zone note is only a fallback', () => {
  const withTz = render(null, { viewerTz: 'UTC' }, M, Object.assign({}, ENTRY, { tz: 'Asia/Shanghai' }));
  assert.equal(text(elements(withTz, 'wx-tznote')[0]), 'Times shown in venue local time');
  assert.equal(text(elements(withTz, 'wx-badge')[0]), 'MATCH · 16:00');
  const noTz = render(null, { viewerTz: 'UTC' }, M, ENTRY);
  assert.equal(text(elements(noTz, 'wx-tznote')[0]), 'Times shown in your time zone');
  assert.equal(text(elements(noTz, 'wx-badge')[0]), 'MATCH · 08:00');
});

// Mutation: wxFirstSlot always true (no note) or always false (the first match gets it too).
test('"may start later" note on every match that is not first on court that day', () => {
  const first = M, second = Object.assign({}, M, { time: '13:00' }), other = Object.assign({}, M, { tour: 'ATP Beijing', time: '06:00' });
  const board = [first, second, other];
  const note = m => elements(build({ board }).buildWeatherSection(m, ENTRY, file(() => ({})), NOW), 'wx-later').map(text);
  assert.deepEqual(note(second), ['Scheduled time — later matches often start later.']);
  assert.deepEqual(note(first), [], 'the first match of the day at that tournament has no note');
  assert.deepEqual(note(Object.assign({}, M, { time: '10:00' })), [], 'a tie with the first slot is first on court');
});

// Mutation: drop the Escape keydown listener from initAOddsTips (the shared TEN-303 tooltip).
test('Escape closes the shared tooltip (open or pending)', () => {
  const T = buildTips(); T.api.initAOddsTips();
  const el = T.mkEl({ 'data-aotip': '<b>x</b>', tabindex: '0' });
  T.fire('mouseover', el); T.tick(250); assert.equal(T.tip(), '<b>x</b>');
  T.key('Escape'); assert.equal(T.tip(), null, 'open tooltip closed');
  const el2 = T.mkEl({ 'data-aotip': '<b>y</b>' });
  T.fire('focusin', el2); T.key('Escape'); T.tick(300); assert.equal(T.tip(), null, 'pending tooltip cancelled');
  T.fire('focusin', T.mkEl({ 'data-aotip': '<b>z</b>' })); T.key('Enter'); T.tick(250); assert.ok(T.tip(), 'other keys do nothing');
});

// TEN-335. Mutations: the tooltip's Esc listener in the bubble phase, or not stopped — one Esc would close the tooltip
// AND the Odds pop-up under it (maPopEscKey, bubble phase), losing the layered dismissal; or stopped while the tooltip is
// only pending / in a hidden modal (an Esc meant for the page is swallowed).
test('Escape with a tooltip up is consumed by the tooltip (capture phase, stopped); with none it passes on', () => {
  const T = buildTips(); T.api.initAOddsTips();
  assert.deepEqual(T.keyCapture(), [true], 'the tooltip listens in the capture phase, ahead of maPopEscKey');
  T.fire('mouseover', T.mkEl({ 'data-aotip': '<b>x</b>' })); T.tick(250);
  assert.equal(T.key('Escape').stopped, true, 'an open tooltip stops the Esc');
  assert.equal(T.tip(), null, 'and closes');
  assert.equal(T.key('Escape').stopped, false, 'no tooltip: the next Esc reaches the pop-up');
  T.fire('mouseover', T.mkEl({ 'data-aotip': '<b>p</b>' }));   // pending (250 ms not up): hidden, never swallowed
  assert.equal(T.key('Escape').stopped, false, 'a pending tooltip does not take the Esc'); T.tick(300); assert.equal(T.tip(), null);
  T.fire('mouseover', T.mkEl({ 'data-aotip': '<b>h</b>' })); T.tick(250); T.tipEl().rects = 0;   // shown, but its modal closed
  assert.equal(T.key('Escape').stopped, false, 'a tooltip in a closed (hidden) modal does not take the Esc');
});

// ── colours: the ONE token file, tokens.css (TEN-376 Foundation; supersedes the TEN-314 modal token file) ──
// Each WX_C colour is the var() (or a colour-mix of one) of the foundation token its ROLE maps to (.claude/rules/foundation.md,
// modal-weather.md), and tokens.css resolves it (Night) to the foundation value. All borders 1px (README §4).
// Severity: CONCERN --neg; WATCH neutral (--text-soft, --edge-16 border) — amber is Model + Trading Report only (U3).
// Mutation: a WX_C value back to a literal (text #E7E9EE), CONCERN back to the Weather red, amber leaking into WX_C,
// the badge fill on the text token, a hairline 0.33px.
const WX_ROLE = { text: 'var(--text)', sub: 'var(--text-soft)', muted: 'var(--text-soft)', dim: 'var(--text-label)', faint: 'var(--text-label)', card: 'var(--card)',
  lead: 'var(--card)', bd: 'var(--edge-6)', box: 'var(--line)', rule: 'var(--line)', ruleFx: 'var(--line)', inner: 'var(--inner)',
  dashBd: 'var(--edge-10)', tagBd: 'var(--edge-10)', bar: 'var(--track)', amber: 'var(--text-soft)', red: 'var(--text)',   // founder R4: CONCERN has no colour
  amberBd: 'var(--edge-6)', redBd: 'var(--edge-6)',
  chipBd: 'var(--edge-16)', unavail: 'color-mix(in srgb, var(--text) 15%, transparent)',
  match: 'var(--text)', matchFill: 'var(--inner)', matchBd: 'var(--edge-24)', badgeInk: 'var(--text-soft)', badgeBd: 'var(--edge-16)' };
// tokens.css Night values the roles above must resolve to
const WX_NIGHT = { text: '#FFFFFF', sub: '#DDE0EA', muted: '#DDE0EA', dim: '#A3AABE', faint: '#A3AABE', card: '#10131D', lead: '#10131D',
  bd: 'RGBA(255,255,255,0.06)', box: 'RGBA(255,255,255,0.05)', rule: 'RGBA(255,255,255,0.05)', ruleFx: 'RGBA(255,255,255,0.05)', inner: '#171B28',
  dashBd: 'RGBA(255,255,255,0.1)', tagBd: 'RGBA(255,255,255,0.1)', bar: 'RGBA(255,255,255,0.06)', amber: '#DDE0EA', red: '#FFFFFF',
  amberBd: 'RGBA(255,255,255,0.06)', redBd: 'RGBA(255,255,255,0.06)', chipBd: 'RGBA(255,255,255,0.16)', unavail: 'RGBA(255,255,255,0.15)',
  match: '#FFFFFF', matchFill: '#171B28', matchBd: 'RGBA(255,255,255,0.24)', badgeInk: '#DDE0EA', badgeBd: 'RGBA(255,255,255,0.16)' };
test('Weather colours are foundation role tokens (no literal), resolving to the tokens.css Night values; borders 1px', () => {
  const C = build({}).WX_C, n = v => String(v).replace(/\s/g, '');
  assert.deepEqual(Object.keys(C).sort(), Object.keys(WX_ROLE).concat(['hw', 'hw1']).sort(), 'every colour is locked');
  for (const [k, v] of Object.entries(WX_ROLE)) {
    assert.equal(n(C[k]), n(v), k);
    assert.equal(resolveToken(C[k]), WX_NIGHT[k], `${k} resolves (Night)`);
  }
  assert.equal(C.hw, '1px'); assert.equal(C.hw1, '1px');
  // amber is Model + Trading Report only (TEN-376 U3): no WX_C colour reads the amber tokens
  assert.deepEqual(Object.keys(C).filter(k => /--(viz-)?amber\b/.test(C[k])), []);
  // founder Q1 (TEN-380, README §9): the MATCH badge is NEUTRAL — --inner fill, --text-soft ink, a neutral ring; no blue
  const h = render(file(() => ({}))), badge = attrsOf(h, 'wx-badge')[0] || {};
  assert.match(badge.style || '', /color:var\(--text-soft\); background:var\(--inner\); box-shadow:inset 0 0 0 1px var\(--edge-16\);/, 'MATCH badge neutral');
  assert.ok(!/var\(--bar\)|var\(--open-card\)|var\(--link\)/.test(h), 'no blue anywhere on the tab');
  assert.ok(elements(h, 'wx-day').filter(d => /is-match/.test(d)).every(d => /border:1px solid var\(--edge-24\)/.test(d)), 'match-day edge neutral --edge-24');
});

// Mutation: a literal put back into WX_C (the engine would re-tone it; a DESIGN_ZONES entry would be needed again).
test('the 12a engine has nothing to map in WX_C (no design-verbatim zone left); a literal put back would be re-toned', async () => {
  const src = readFileSync(new URL('./tools/theme-12a/recolour.mjs', import.meta.url), 'utf8');
  assert.match(src, /\nconst DESIGN_ZONES = \{\};/);
  const R = await import('./tools/theme-12a/recolour.mjs');
  const out = r => typeof r === 'string' ? r : (r.out != null ? r.out : r.src);
  const wx = s => s.slice(s.indexOf('\nconst WX_C = {'), s.indexOf('\n};', s.indexOf('\nconst WX_C = {')));
  assert.equal(wx(out(R.recolourFile('bsp-consult-dashboard.html', HTML))), wx(HTML));
  const mut = HTML.replace("  text: 'var(--text)',              // primary", "  text: '#E7E9EE',              // primary");
  assert.notEqual(mut, HTML, 'mutant anchor');
  assert.notEqual(wx(out(R.recolourFile('bsp-consult-dashboard.html', mut))), wx(mut), 'control: a literal in WX_C is re-toned');
});

// ── the api-tennis 02:00Z placeholder (founder ruling 27 Sep; 33 of 34 cards first published at it were revised) ──
// Mutation: apiStartMs returns cardStartMs unchanged (the placeholder read as a real 02:00Z start).
test('api-tennis 02:00Z placeholder = no time: "MATCH · TBC", "time TBC", no header time — CEST and CET; a real 02:05Z is a time', () => {
  const E = Object.assign({}, ENTRY, { tz: 'Asia/Shanghai' });
  const R = build({ viewerTz: 'UTC' });
  const view = m => { const h = R.buildWeatherSection(m, E, null, NOW); return { badge: text(elements(h, 'wx-badge')[0]), head: text(elements(h, 'wx-athead')[0]), header: R.aContextLine(m, 'Quarter-finals') }; };
  const cest = view(Object.assign({}, M, { time: '04:00' }));                 // 04:00 Berlin CEST = 02:00Z
  assert.equal(cest.badge, 'MATCH · TBC'); assert.equal(cest.head, 'Sun Sep 27 · time TBC'); assert.equal(cest.header, 'ATP Chengdu · Quarter-finals');
  const cet = view(Object.assign({}, M, { date: '2026-10-26', time: '03:00' })); // 03:00 Berlin CET = 02:00Z (after 25 Oct)
  assert.equal(cet.badge, 'MATCH · TBC');
  const real = view(Object.assign({}, M, { time: '04:05' }));                 // 02:05Z: a real time, 10:05 Chengdu
  assert.equal(real.badge, 'MATCH · 10:05'); assert.match(real.header, / · 02:05$/);
  const cet4 = view(Object.assign({}, M, { date: '2026-10-26', time: '04:00' })); // 04:00 CET = 03:00Z: real, 11:00 Chengdu
  assert.equal(cet4.badge, 'MATCH · 11:00');
  const ts = view(Object.assign({}, M, { time: '04:00', startTs: '2026-09-27T02:00:00Z' }));   // an explicit startTs is trusted
  assert.equal(ts.badge, 'MATCH · 10:00');
  // the build never archives a forecast for the placeholder hour
  assert.ok(Number.isNaN(BW.defaultStartMs({ date: '2026-09-27', time: '04:00' })));
  assert.equal(BW.defaultStartMs({ date: '2026-09-27', time: '04:05' }), Date.parse('2026-09-27T02:05:00Z'));
});

// ── TEN-337 re-verification against Match Analysis Progression v1.dc.html (TEN-312) ──
// TEN-380 review item 1 (founder 2026-10-04): the THRESHOLDS TBD chip is an internal note and never ships, so the STATE row
// goes with it — the tab opens on the strip header, as the reference draws it. Mutation: the chip row back.
test('no STATE switcher and no THRESHOLDS chip ship; the tab opens on the strip header', () => {
  const html = render(file(() => ({})));
  assert.equal(elements(html, 'wx-chiprow').length + elements(html, 'wx-tbd').length, 0);
  assert.ok(!/THRESHOLDS TBD/.test(html), 'no internal note in the product');
  assert.match(html, /^<div class="wx-tab"[^>]*><div class="wx-head"/, 'the strip header comes first');
  for (const s of ['a · Calm week', 'b · One problem day', 'c · Match day red', 'd · Indoor', 'e · Unavailable', '>STATE<']) assert.ok(!html.includes(s), s);
});

// Mutation: write the pace copy's apostrophe as ’ (U+2019) — the file (DF wxFor) and the spec §5 write ASCII '.
test('pace copy quotes the file verbatim: "Today\'s heat should make it play quicker than that." (ASCII apostrophe)', () => {
  const pace = elements(render(file((d, h) => d === '2026-09-27' && h === 16 ? { feels: 32, rainChance: 5 } : {})), 'wx-tile').find(t => /data-factor="pace"/.test(t));
  assert.equal(text(elements(pace, 'wx-effect')[0]), "Base court speed is 1.17 (Fast). Today's heat should make it play quicker than that.");
});

// TEN-380 (README §9, step 3 reference): the legend row and the "Forecast updated" stamp are gone; a 6–24 h old forecast
// keeps its ruled staleness line. Lead box = panel, its metric tiles --inner with no edge, sentence-case names 14/700,
// unit and effect text --text-label; side tiles 13/700 sentence case; FROM TOURNAMENT tag dashed --edge-10.
// Mutation: the legend row back, or the fresh stamp printed again.
test('TEN-380: no legend row, no "Forecast updated" stamp (the stale line stays); lead box and tiles restyled', () => {
  const f = file((d, h) => d === '2026-09-27' && h === 16 ? { gusts: 40, wind: 22 } : {});
  const html = render(f);
  assert.ok(!/Days 4\+ ahead|Forecast updated/.test(text(html)), 'no legend, no fresh stamp');
  assert.equal(elements(html, 'wx-fresh').length, 0);
  assert.ok(!/legend/.test(JSON.stringify(build({}).WX_COPY || {})), 'the legend copy is deleted, not hidden');
  const stale = render(file(() => ({}), { fetchedAt: '2026-09-26T20:00:00Z' }));
  assert.match(text(elements(stale, 'wx-fresh')[0] || ''), /^Forecast updated 8h ago · Open-Meteo$/, 'a 6–24 h old forecast keeps its staleness line');
  const lead = elements(html, 'wx-lead')[0];
  assert.match(lead, /class="wx-lead-name" style="font-size:14px; font-weight:700;">Wind</, 'sentence case 14/700');
  assert.match(lead, /class="wx-unit" style="font-size:14px; color:var\(--text-label\);">km\/h gusts</);
  const met = elements(lead, 'wx-metric');
  assert.equal(met.length, 2);
  assert.ok(met.every(x => /background:var\(--inner\); border:1px solid transparent;/.test(x)), 'metric tiles --inner, no edge');
  assert.match(elements(lead, 'wx-effect')[0], /color:var\(--text-label\)/);
  const tiles = elements(html, 'wx-tile');
  assert.ok(tiles.every(t => /border:1px solid var\(--edge-6\)/.test(t)), 'tiles --edge-6');
  assert.ok(tiles.every(t => /class="wx-name" style="font-size:13px; font-weight:700;/.test(t)), 'tile names 13/700, no caps');
  assert.ok(tiles.every(t => /class="wx-effect"[^>]*color:var\(--text-label\)/.test(t)), 'effect text --text-label');
  assert.match(html, /FROM TOURNAMENT/);
  assert.match(html, /font-size:9\.5px;[^"]*border:1px dashed var\(--edge-10\);">FROM TOURNAMENT</);
  assert.ok(elements(html, 'wx-day').every(d => /border:1px solid var\(--edge-(6|24)\)/.test(d)), 'day cards --edge-6 (match day keeps its edge, Q1)');
  assert.ok(!/THRESHOLDS TBD/.test(html), 'TEN-380 review item 1: no THRESHOLDS chip');
});

// TEN-380 review items 2 + 3 (founder 2026-10-04): status lines are text only — no round dot on a day line, the verdict
// line or a factor tile; and the court pace never says "usual" (ruling 14 — no source). Founder review 2 (2026-10-04):
// calm conditions read against the event's base court speed instead — "PLAYS AT BASE" + its sentence (below).
// Mutations: a dot back on the day reason / verdict / tile; "AS USUAL" or "close to its usual" back.
test('TEN-380 review: no status dots anywhere on the tab; calm court pace never says "usual"', () => {
  const flagged = render(file((d, h) => d === '2026-09-27' && h === 16 ? { gusts: 40, wind: 22 } : {}));
  const calm = render(file(() => ({})));
  for (const h of [flagged, calm]) {
    assert.ok(!/border-radius:50%/.test(h), 'no round dot on the tab');
    assert.equal(elements(h, 'wx-dot').length, 0);
  }
  const pace = elements(calm, 'wx-tile').find(t => /data-factor="pace"/.test(t));
  assert.ok(pace, 'pace tile renders');
  assert.ok(!/usual/i.test(text(pace)), 'no "usual" on a calm day: ' + text(pace));
  assert.match(text(pace), /1\.17/, 'the figure still prints');
});

// Founder review 2 (TEN-380, 2026-10-04) item 4: calm rain and heat → the pace keeps its verdict, "PLAYS AT BASE", and the
// sentence under the figure names the base speed — in the lead layout (wind leads) and the calm layout alike.
// Mutations: the base label or sentence dropped; the calm layout prints no label.
test('review 2: calm conditions → "PLAYS AT BASE" + "Base court speed is 1.17 (Fast)…" in both layouts', () => {
  const windy = render(file((d, h) => d === '2026-09-27' && h === 16 ? { gusts: 40, wind: 22 } : {}));
  const calm = render(file(() => ({})));
  for (const [name, h] of [['lead layout', windy], ['calm layout', calm]]) {
    const pace = elements(h, 'wx-tile').find(t => /data-factor="pace"/.test(t));
    assert.ok(pace, name + ': pace tile');
    assert.equal(text(elements(pace, 'wx-sevl')[0]), 'PLAYS AT BASE', name);
    assert.match(text(pace), /Base court speed is 1\.17 \(Fast\)\. Today's conditions should not change it\./, name);
    assert.ok(!/usual/i.test(text(pace)), name + ': still no "usual"');
  }
  assert.match(text(elements(windy, 'wx-tile').find(t => /data-factor="pace"/.test(t))), /Wind adds variance on top\./, 'wind on → the variance clause');
});

// Founder review 2 item 3: the match-day tile prints the MATCH-HOUR figure, the same as Main factor — never the day's
// max (57 at 13:00 vs 40 at the 16:00 match hour). Another day keeps its window max. Mutation: the match day keeps the max.
test('review 2: the match-day tile = the match-hour figure (= Main factor); other days keep the window max', () => {
  const f = file((d, h) => d === '2026-09-27' ? (h === 13 ? { gusts: 57 } : h === 16 ? { gusts: 40 } : {}) : d === '2026-09-28' && h === 13 ? { gusts: 57 } : {});
  const html = render(f);
  assert.match(text(elements(html, 'wx-verdict')[0]), /gusts 40 km\/h/);
  const day = date => elements(html, 'wx-day').find(x => new RegExp('data-date="' + date + '"').test(x));
  assert.equal(text(elements(day('2026-09-27'), 'wx-reason')[0]), 'Gusts 40 km/h', 'match day = match hour');
  assert.match(day('2026-09-27'), /Max gusts.*?57 km\/h/s, 'its hover still lists the day max, labelled Max');
  assert.equal(text(elements(day('2026-09-28'), 'wx-reason')[0]), 'Gusts 57 km/h', 'another day = its window max');
});

// Founder review 2 next-round item: "LOW CONFIDENCE" on one line where the day card holds it (≥ 1400px), wrapping inside
// its card below that instead of spilling into the next card (clean review 3: 8px overflow per side at 1280).
test('review 2: LOW CONFIDENCE is one line at ≥ 1400px and wraps inside its card below', () => {
  assert.match(HTML, /\.modal-analysis \.wx-lowconf\{ white-space:nowrap; \}/);
  assert.match(HTML, /@media \(max-width:1399px\)\{ \.modal-analysis \.wx-lowconf\{ white-space:normal; \} \}/);
  const far = render(file(() => ({})), {}, Object.assign({}, M, { date: '2026-09-27' }));
  assert.ok(elements(far, 'wx-lowconf').length >= 1, 'the label carries its class');
});
