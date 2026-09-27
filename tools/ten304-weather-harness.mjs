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
export const CONSTS = ['SF_TIP_C', 'WX_CONFIG', 'WX_COPY', 'WX_C'];
export const FNS = ['acctTzOffsetMin', 'cardStartMs', 'cardFmtStart', 'aContextLine', 'escapeHtml', 'sfTipAttr', 'sfTipHtml',
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

// ---- synthetic data in the exact shape build-weather.js publishes ----
const pad = n => String(n).padStart(2, '0');
export function addDays(date, n) { return new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
// A venue file covering `days` days from `from` (venue-local). `hour(date, h)` returns overrides for that
// hour ({gusts, feels, …}); the base is a calm hour. `day(date)` returns {code, hi, lo} overrides.
export function makeFile({ tz = 'Asia/Shanghai', venue = 'Chengdu', fetchedAt, from, days = 10, hour = () => ({}), day = () => ({}) }) {
  const H = { time: [], temp: [], humidity: [], feels: [], rainChance: [], rainMm: [], wind: [], gusts: [] };
  const D = { date: [], code: [], hi: [], lo: [] };
  for (let d = 0; d < days; d++) {
    const date = addDays(from, d);
    const dd = Object.assign({ code: 3, hi: 26, lo: 18 }, day(date));
    D.date.push(date); D.code.push(dd.code); D.hi.push(dd.hi); D.lo.push(dd.lo);
    for (let h = 0; h < 24; h++) {
      const v = Object.assign({ temp: 22, humidity: 55, feels: 22, rainChance: 5, rainMm: 0, wind: 8, gusts: 14 }, hour(date, h));
      H.time.push(`${date}T${pad(h)}:00`);
      for (const k of ['temp', 'humidity', 'feels', 'rainChance', 'rainMm', 'wind', 'gusts']) H[k].push(v[k] === undefined ? null : v[k]);
    }
  }
  return { v: 1, venue, lat: 0, lon: 0, tz, source: 'Open-Meteo', fetchedAt, pastHours: 'forecast', hourly: H, daily: D };
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
