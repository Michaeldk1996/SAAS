// TEN-304 Wave B — the Weather-tab renderer sliced out of bsp-consult-dashboard.html and run in a
// sandbox. Shared by test-ten304-weather-tab.mjs, the mutant runner (tools/test-ten304-mutants.js) and
// the test-only pixel fixture (tools/ten304-weather-fixture.mjs). Nothing here re-implements a rule:
// every function below is the page's own source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
// The mutant runner points TEN304_HTML at a mutated copy.
export const HTML = readFileSync(process.env.TEN304_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

export function slice(name, src = HTML) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
export function constSrc(name, src = HTML) {
  const start = src.indexOf(`\nconst ${name} = `);
  assert.ok(start > 0, `const ${name} not found`);
  return src.slice(start, src.indexOf(';\n', start) + 1);
}
export const CONSTS = ['AODDS_C', 'WX_CONFIG', 'WX_COPY', 'WX_C'];
export const FNS = ['acctTzOffsetMin', 'cardStartMs', 'cardFmtStart', 'aContextLine', 'escapeHtml', 'aOddsTipHtml',
  'wxForced', 'wxNum', 'wxFmt', 'wxSev', 'wxRank', 'wxLocalParts', 'wxAddDays', 'wxDayDiff', 'wxDow', 'wxMonDay', 'wxStamp',
  'wxAgo', 'wxIconKind', 'wIcon', 'wxModel', 'buildWeatherSection'];

// The page's renderer in a sandbox. `over` replaces a const's source (e.g. a config under test);
// `viewerTz` is what newsTz() returns (undefined = the runtime's zone, as on the page with no preference);
// `search` is location.search (for the test-only ?wxForce param).
export function build({ src = HTML, over = {}, viewerTz, search = '' } = {}) {
  const c = n => (over[n] != null ? `\nconst ${n} = ${over[n]};` : constSrc(n, src));
  return new Function('__viewerTz', '__search', `
    const location = { search: __search };
    const newsTz = () => __viewerTz;
    ${CONSTS.map(c).join('\n')}
    ${FNS.map(n => slice(n, src)).join('\n')}
    return { buildWeatherSection, wxModel, aContextLine, cardStartMs, cardFmtStart, WX_CONFIG, WX_COPY, WX_C };
  `)(viewerTz, search);
}

// The SHARED tooltip (TEN-303's aOddsTip*, which the Weather tab uses) run against a minimal fake DOM:
// document listeners, one #aoddsTip element and a manual clock. Each fake element carries the attributes
// parsed from the rendered markup. Returns { fire(type, el), tick(ms), tip(), delays }.
export function buildTips({ src = HTML } = {}) {
  const listeners = {}, timers = [], delays = [];
  let now = 0, tipEl = null;
  const mkEl = attrs => ({ attrs, isConnected: true, style: {}, innerHTML: '', id: '',
    getAttribute: k => (k in attrs ? attrs[k] : null), setAttribute(k, v) { this[k] = v; },
    closest(sel) { const m = /^\[([\w-]+)\]$/.exec(sel); return m && m[1] in attrs ? this : (sel === '.modal-analysis' ? null : null); },
    contains: () => false, getBoundingClientRect: () => ({ left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20 }),
    offsetWidth: 100, offsetHeight: 40, appendChild() {} });
  const document = {
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    getElementById: id => (id === 'aoddsTip' ? tipEl : null),
    createElement: () => { const e = mkEl({}); return e; },
    body: { appendChild: e => { tipEl = e; } },
  };
  const window = { innerWidth: 1000, innerHeight: 800 };
  const setTimeout = (f, ms) => { delays.push(ms); timers.push({ at: now + ms, f }); return timers.length; };
  const clearTimeout = id => { if (timers[id - 1]) timers[id - 1].f = null; };
  const api = new Function('document', 'window', 'setTimeout', 'clearTimeout', `
    ${constSrc('AODDS_C', src)}
    ${slice('escapeHtml', src)}
    let _aoTipTimer = null, _aoTipFor = null;
    ${['aOddsTipEl', 'aOddsTipHide', 'aOddsTipShow', 'initAOddsTips'].map(n => slice(n, src)).join('\n')}
    return { initAOddsTips, aOddsTipHide };
  `)(document, window, setTimeout, clearTimeout);
  return {
    api, delays, mkEl,
    fire: (type, el) => (listeners[type] || []).forEach(f => f({ target: el, relatedTarget: null })),
    tick: ms => { now += ms; timers.forEach(t => { if (t.f && t.at <= now) { const f = t.f; t.f = null; f(); } }); },
    tip: () => (tipEl && tipEl.style.display === 'block' ? tipEl.innerHTML : null),
    listenerTypes: () => Object.keys(listeners),
  };
}
// The Weather data layer (lazy loads, refetch, matches-reload hook, openWeatherTab) with a fake fetch, a
// settable clock and a fake DOM. renderWeatherSection is a recorder (the renderer is tested elsewhere).
export function buildCache({ src = HTML, server }) {
  const decl = src.slice(src.indexOf('\nlet _wxIndex = null'), src.indexOf('\nfunction loadWeatherIndex('));
  const clock = { now: 0 }, calls = [], renders = [];
  const fetch = async url => { calls.push(url); const r = server(url.replace(/^\.\//, ''), clock.now); return r == null ? { ok: false, json: async () => null } : { ok: true, json: async () => JSON.parse(JSON.stringify(r)) }; };
  const dom = { tabActive: false, modalOpen: false };
  const document = { getElementById: id => id === 'aSectionWeather' ? { classList: { contains: c => c === 'active' && dom.tabActive } }
    : id === 'analysisModal' ? { classList: { contains: c => c === 'open' && dom.modalOpen } } : null };
  const api = new Function('fetch', 'document', 'Date', 'console', '__renders', `
    ${constSrc('WX_CONFIG', src)}
    ${decl}
    function renderWeatherSection(){ __renders.push(_aWx.ready && _aWx.m === _aWxMatch ? { tour: _aWx.m.tour, entry: _aWx.entry, fetchedAt: _aWx.file && _aWx.file.fetchedAt } : 'loading'); }
    ${['loadWeatherIndex', 'wxFileDue', 'loadWeatherFile', 'ensureWeather', 'wxOnMatchesReload', 'openWeatherTab'].map(n => slice(n, src)).join('\n')}
    return { openWeatherTab, wxOnMatchesReload, setMatch: m => { _aWxMatch = m; } };
  `)(fetch, document, { now: () => clock.now, parse: s => Date.parse(s) }, { warn() {} }, renders);
  return { api, clock, calls, renders, dom };
}
// printAnalysisReport with a fake modal / window; `openWeatherTab` is injected (a promise the test settles).
export function buildReport({ src = HTML, openWeatherTab }) {
  const log = [];
  const modal = { classList: { add: c => log.push('add:' + c), remove: c => log.push('remove:' + c) } };
  const fn = new Function('document', 'window', 'openWeatherTab', 'setTimeout', `${slice('printAnalysisReport', src)}; return printAnalysisReport;`)(
    { querySelector: () => modal }, { addEventListener() {}, print: () => log.push('print') }, openWeatherTab, (f, ms) => { log.push('cap:' + ms); });
  return { print: fn, log };
}
// Attributes of every element in `html` whose class starts with `cls` (first tag only), entities decoded.
export function attrsOf(html, cls) {
  return elements(html, cls).map(e => { const tag = e.slice(0, e.indexOf('>') + 1), o = {}; let m;
    const re = /([\w-]+)="([^"]*)"/g; while ((m = re.exec(tag))) o[m[1]] = text(m[2]); return o; });
}

// ---- synthetic data in the exact shape build-weather.js publishes ----
const pad = n => String(n).padStart(2, '0');
export function addDays(date, n) { return new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
// Venue-local date + hour of an instant (Intl, the IANA zone) — used only to BUILD fixtures.
function localParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24 };
}
// A venue file covering `days` venue-local days from `from`, in build-weather.js's v2 shape: hourly.time
// are TRUE UTC instants, one per real hour (a DST day has 23 or 25). `hour(date, h)` returns overrides
// for the venue-local hour ({gusts, feels, …}); the base is a calm hour. `day(date)` → {code, hi, lo}.
export function makeFile({ tz = 'Asia/Shanghai', venue = 'Chengdu', fetchedAt, from, days = 10, hour = () => ({}), day = () => ({}) }) {
  const H = { time: [], temp: [], humidity: [], feels: [], rainChance: [], rainMm: [], wind: [], gusts: [] };
  const D = { date: [], code: [], hi: [], lo: [] };
  const last = addDays(from, days - 1);
  for (let d = 0; d < days; d++) {
    const date = addDays(from, d), dd = Object.assign({ code: 3, hi: 26, lo: 18 }, day(date));
    D.date.push(date); D.code.push(dd.code); D.hi.push(dd.hi); D.lo.push(dd.lo);
  }
  // walk real hours from 14 h before `from` 00:00Z (covers every zone) and keep those whose local date is in range
  for (let ms = Date.parse(from + 'T00:00:00Z') - 14 * 3600e3; ; ms += 3600e3) {
    const lp = localParts(ms, tz);
    if (lp.date > last) break;
    if (lp.date < from) continue;
    const v = Object.assign({ temp: 22, humidity: 55, feels: 22, rainChance: 5, rainMm: 0, wind: 8, gusts: 14 }, hour(lp.date, lp.hour));
    H.time.push(new Date(ms).toISOString().replace('.000Z', 'Z'));
    for (const k of ['temp', 'humidity', 'feels', 'rainChance', 'rainMm', 'wind', 'gusts']) H[k].push(v[k] === undefined ? null : v[k]);
  }
  return { v: 2, venue, lat: 0, lon: 0, tz, source: 'Open-Meteo', fetchedAt, pastHours: 'forecast', hourly: H, daily: D };
}

// ---- reading the rendered string (no DOM needed: the renderer returns markup) ----
// Every element whose class list starts with `cls`, as its full outer markup (balanced on <div>/<span>).
export function elements(html, cls) {
  const out = [], re = new RegExp(`<(div|span) class="${cls}(?:[ "])`, 'g');
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1], open = new RegExp(`<${tag}[ >]`, 'g'), close = `</${tag}>`;
    let depth = 0, i = m.index;
    while (i < html.length) {
      open.lastIndex = i;
      const o = open.exec(html), cIdx = html.indexOf(close, i);
      if (o && o.index < cIdx) { depth++; i = o.index + 1; }
      else { depth--; i = cIdx + close.length; if (depth === 0) break; }
    }
    out.push(html.slice(m.index, i));
  }
  return out;
}
export const text = s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
