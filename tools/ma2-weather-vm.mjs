// Match analysis rebuild (2026-11-23) — the Weather tab's NEW renderer (maWeatherV2 in match-analysis-v2.js) run in a
// sandbox over the page's own data layer (wxModel, WX_CONFIG, WX_COPY … sliced from bsp-consult-dashboard.html by the
// TEN-304 harness). Test-only; never loaded by the page. The mutant runner points TEN304_HTML / TEN304_V2 at mutated copies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HTML, slice, constSrc, CONSTS, FNS } from './ten304-weather-harness.mjs';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const V2 = readFileSync(process.env.TEN304_V2 || join(HERE, 'match-analysis-v2.js'), 'utf8');

// Same contract as the harness's build(): `over` replaces a const, `viewerTz` = newsTz(), `search` = location.search,
// `board` = matches. `sel` = the picked day (_aWx.sel: opens that day inside the week card).
// trKeyOf answers no key, so ma2CourtSpeed takes its own documented fallback (the match's pipeline courtSpeed copy);
// the page-row branch is locked by tools/test-pp2-reconcile.js (N4).
export function build({ src = HTML, v2 = V2, over = {}, viewerTz, search = '', board = [], sel = null } = {}) {
  const c = n => (over[n] != null ? `\nconst ${n} = ${over[n]};` : constSrc(n, src));
  const win = {};
  return new Function('__viewerTz', '__search', '__board', '__sel', 'window', `
    const location = { search: __search };
    const matches = __board;
    const newsTz = () => __viewerTz;
    const fetch = () => Promise.resolve({ ok: false, json: async () => null });
    const trKeyOf = () => null;
    const _aWx = { sel: __sel };
    function renderWeatherSection(){}
    let _sfEventIx = null;
    ${CONSTS.map(c).join('\n')}
    ${FNS.map(n => slice(n, src)).join('\n')}
    const maWeatherV2 = (...a) => window.maWeatherV2(...a), ma2CourtSpeed = m => window.ma2CourtSpeed(m);
    ${v2}
    return { buildWeatherSection, wxModel, aContextLine, cardStartMs, cardFmtStart, WX_CONFIG, WX_COPY };
  `)(viewerTz, search, board, sel, win);
}

// ---- reading the new markup (it carries no wx-* classes; the cards carry data-wxcard / data-wxday) ----
// The balanced outer element (div / span) that starts at index i.
export function outer(html, i) {
  const tag = /^<(div|span)/.exec(html.slice(i))[1], open = new RegExp(`<${tag}[ >]`, 'g'), close = `</${tag}>`;
  let depth = 0, j = i;
  while (j < html.length) {
    open.lastIndex = j;
    const o = open.exec(html), cIdx = html.indexOf(close, j);
    if (o && o.index < cIdx) { depth++; j = o.index + 1; } else { depth--; j = cIdx + close.length; if (depth === 0) break; }
  }
  return html.slice(i, j);
}
export const all = (html, re) => [...html.matchAll(re)].map(m => outer(html, m.index));
export const card = (html, k) => all(html, new RegExp(`<div data-wxcard="${k}"`, 'g'))[0] || '';
export const days = html => all(html, /<div class="seg ma2-row" data-wxday=""/g);
export const dayOf = (html, date) => days(html).find(d => d.includes(`data-date="${date}"`));
// A factor box (wxBox): name, status word, figure, unit, detail, effect; lead = the lifted box.
export function boxes(html) {
  return all(html, /<div class="[^"]*"(?: role="button" tabindex="0" onclick="[^"]*")?(?: title="[^"]*")? style="display:flex; flex-direction:column; gap:14px; padding:/g).map(b => {
    const sp = [...b.matchAll(/<span style="([^"]*)">([^<]*)<\/span>/g)];
    const pick = re => { const x = sp.find(s => re.test(s[1])); return x ? txt(x[2]) : null; };
    return { html: b, lead: /background:var\(--ma2-lifted\)/.test(b.slice(0, 400)),
      name: pick(/^font-size:14px; font-weight:700/), stat: pick(/^font-size:11\.5px; font-weight:700/),
      fig: pick(/font-size:(26|22)px; font-weight:700/), unit: pick(/^font-size:12\.5px; color:var\(--ma2-grey\);$/),
      detail: pick(/min-height:31px/), effect: pick(/^flex:1; padding-top:14px/) };
  });
}
// A day card: weekday + date, hi / lo, the status line, the tag (Match HH:MM / Low confidence), "+N".
export function day(d) {
  const sp = [...d.matchAll(/<span style="([^"]*)">([^<]*)<\/span>/g)];
  const pick = re => { const x = sp.find(s => re.test(s[1])); return x ? txt(x[2]) : null; };
  return { hi: pick(/^font-size:15px; font-weight:700/), lo: pick(/^font-size:12px; color:var\(--ma2-grey\)/),
    reason: pick(/^font-size:11\.5px; line-height:1\.35/), tag: pick(/line-height:15px/),
    more: (/>\+(\d+)<\/span>/.exec(d) || [])[1] || null };
}
// the "At match time" chip (the head's short verdict)
export const chip = html => { const m = /<span style="flex:none; width:8px; height:8px; border-radius:50%;[^"]*"><\/span>([^<]*)<\/span>/.exec(card(html, 'match')); return m ? txt(m[1]) : null; };
// the head's scope line of a card (match-time date / time · freshness · may-start-later)
export const scope = (cardHtml) => { const i = cardHtml.indexOf('<span style="display:flex; align-items:baseline; gap:4px 8px;'); return i < 0 ? '' : txt(outer(cardHtml, i).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); };
export const txt = s => String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export const textOf = h => txt(String(h).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
