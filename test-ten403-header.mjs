// TEN-403 part 1 (founder shell refresh, 2026-10-08) — the "35b" page header, ONE component (.sfh) on every page
// header card: Today's Matches / Results, Live, Trading Report, Dropping Odds, Series, Players, Tournaments, Database,
// News (Head to Head takes the .sfh--ctl variant in its own commit). Values = the COMPUTED 35b header of the
// 2026-10-08 reference export at 1512 night (card 18x26, centred row, gap 28, radius 12; title Hanken 24/800 -0.015em
// lh 1.1; ONE 13px --text-soft sentence nowrap+ellipsis with an optional --text-label tail; NO caps line; stats gap 30,
// caps 10.5/700/0.10em over Plex Mono 15/700; clocks --text-soft; Today's Matches' first column = live dot + clock).
// Rules: .claude/rules/app-shell.md "Page header (35b, TEN-403)". Every check runs against mutants at the bottom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');
const DASH = read('bsp-consult-dashboard.html');
const JS = { trading: read('trading-report.js'), series: read('series.js'), drops: read('drops-page.js') };
const CSS = { series: read('series.css'), drops: read('drops-page.css') };

// the LAST rule whose selector list is exactly `sel` (the cascade winner among equal-specificity rules)
function rule(src, sel) {
  const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n') || src;
  let out = null;
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');   // top-level rules only
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    if (m[1].trim() === sel) out = m[2];
  return out;
}
function slice(src, name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`function ${name} not found`);
  let depth = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && !--depth) return src.slice(at, j + 1);
  }
  throw new Error('unbalanced ' + name);
}

// ── 1. the component's values ──────────────────────────────────────────────────────────────────────────────────
const WANT = {
  '.sfh': ['display:flex', 'align-items:center', 'justify-content:space-between', 'gap:28px', 'padding:18px 26px', 'border:0',
    'border-radius:12px', 'background:var(--card)', 'box-shadow:var(--top-light)'],
  '.sfh__text': ['flex:1 1 0', 'min-width:0', 'flex-direction:column', 'gap:5px'],
  '.sfh__title': ['margin:0', 'font-family:var(--font-words)', 'font-size:24px', 'font-weight:800', 'letter-spacing:-0.015em', 'line-height:1.1', 'color:var(--text)'],
  '.sfh__sub': ['margin:0', 'font-size:13px', 'font-weight:400', 'color:var(--text-soft)', 'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis'],
  '.sfh__tail': ['color:var(--text-label)'],
  '.sfh__stats': ['display:flex', 'align-items:flex-end', 'gap:30px', 'flex:0 0 auto'],
  '.sfh__stat': ['flex-direction:column', 'align-items:flex-end', 'gap:4px'],
  '.sfh__l': ['font-family:var(--font-words)', 'font-size:10.5px', 'font-weight:700', 'letter-spacing:0.10em', 'text-transform:uppercase', 'color:var(--text-label)'],
  '.sfh__v': ['font-family:var(--font-nums)', 'font-size:15px', 'font-weight:700', 'color:var(--text)'],
  '.sfh__v--soft': ['color:var(--text-soft)'],
  '.sfh__live': ['display:flex', 'align-items:center', 'gap:7px'],
  '.sfh__dot': ['width:7px', 'height:7px', 'border-radius:50%', 'background:var(--pos)'],
  // controls under the row (Head to Head pickers): 18x26x22, row margin-bottom 16
  '.sfh.sfh--ctl': ['display:block', 'padding:18px 26px 22px'],
  '.sfh--ctl > .sfh__row': ['display:flex', 'align-items:center', 'justify-content:space-between', 'gap:28px', 'margin:0 0 16px'],
};
function checkComponent(src) {
  for (const [sel, decls] of Object.entries(WANT)) {
    const body = rule(src, sel);
    if (body == null) return `no rule ${sel}`;
    const got = body.split(';').map(d => d.trim().replace(/\s*:\s*/, ':')).filter(Boolean);
    for (const d of decls) if (!got.includes(d)) return `${sel} lacks ${d} (has: ${got.join('; ')})`;
  }
  return null;
}

// ── 2. every page header card IS the component, with no caps line and no page-owned override ───────────────────
const STATIC = [   // [page, the header markup's opening, the title]
  ['matches', '<div class="sfh mx-titlerow">', "Today's Matches"],
  ['players', '<div class="sfh pgh-card">', 'Players'],
  ['tournaments', '<div class="sfh tourx-head">', 'Tournaments'],
  ['database', '<div class="sfh db-headcard" data-db="head">\n', 'Database'],   // the page mount (the two overlay mounts are one line)
  ['news', '<div class="sfh news-head">', 'Tennis News'],
  ['live', '<div class="sfh">\n    <div class="sfh__text">\n      <h1 class="sfh__title">Live</h1>', 'Live'],
];
function checkPages(dash, js, css) {
  for (const [page, open, title] of STATIC) {
    const at = dash.indexOf(open);
    if (at < 0) return `${page}: header is not the 35b .sfh card`;
    const head = dash.slice(at, at + 900);
    if (!new RegExp(`<h1 class="sfh__title[^"]*">${title.replace(/'/g, "'")}</h1>`).test(head)) return `${page}: title is not .sfh__title "${title}"`;
    if (!/<p class="sfh__sub"/.test(head)) return `${page}: no one-line .sfh__sub sentence`;
  }
  // the two embedded Database mounts (ROI overlays) carry the same header
  if ((dash.match(/<div class="sfh db-headcard" data-db="head"><div class="sfh__text"><h1 class="sfh__title">Database<\/h1><p class="sfh__sub" data-db="subtitle"><\/p><\/div><div class="sfh__stats" data-db="fresh"><\/div><\/div>/g) || []).length !== 2)
    return 'database: an embedded mount is not the 35b header';
  const jsHeads = { trading: /'<div class="sfh tr-hdr">' \+\s*'<div class="sfh__text">' \+\s*'<h1 class="sfh__title">Trading report<\/h1>' \+\s*'<p class="sfh__sub">/,
    series: /'<div class="sfh sr-head">' \+\s*'<div class="sfh__text"><h1 class="sfh__title">Series<\/h1><p class="sfh__sub">'/,
    drops: /'<div class="sfh do-head"><div class="sfh__text">' \+\s*'<h1 class="sfh__title">Dropping Odds<\/h1>' \+\s*'<p class="sfh__sub">/ };
  for (const [k, re] of Object.entries(jsHeads)) if (!re.test(js[k])) return `${k}: header is not the 35b .sfh card`;
  // no caps label line above any title (the old headers' "ATP TOUR · …" eyebrows)
  if (/pgh-eyebrow|tourx-headcap|db-headcap|ATP tour · this week's draws|ATP tour · Season calendar|ATP tour · closing-line archive/.test(dash))
    return 'a caps line above a header title came back';
  // no page-owned rule restyling the header (the 29px / 22x26 / 13.5px copies are gone)
  const OLD = [/\[data-page="matches"\] \.mx-titlerow\{[^}]*padding/, /\[data-page="matches"\] \.mx-h1\{[^}]*font-size/, /\.pgh-card\{/, /\.pgh-title\{/,
    /#tourListView \.tourx-head h1\{/, /\.db-headcard\{/, /\.db-headcard h1\{/, /\[data-page="trading"\] \.tr-hdr\{/, /\[data-page="trading"\] \.tr-hdr-title\{/,
    /\[data-page="news"\] \.news-head h1\{/, /font-size:29px;font-weight:800;letter-spacing:-0\.015em;line-height:1\.1;">Live/];
  for (const re of OLD) if (re.test(dash)) return 'a page-owned header rule is back: ' + re;
  if (/\.sr-head \{|\.sr-h1 \{/.test(css.series)) return 'series.css restyles the header';
  if (/\.do-head \{|\.do-h1 \{/.test(css.drops)) return 'drops-page.css restyles the header';
  return null;
}

// ── 3. ONE line per header: the reference's own Today's Matches line is two short sentences on one line, so the rule is
//      the line, not the full stop — every header's copy stays at or under 120 characters (Trading's 119 is the
//      longest; Series' TEN-194 paragraph and Drops' "Biggest drops first." were trimmed to get there). ──────────
function checkOneSentence(dash, js) {
  const subs = [...dash.matchAll(/<p class="sfh__sub"[^>]*>(?:<span class="[^"]*">)?([^<]+)</g)].map(m => m[1].trim());
  const series = (/var SUBTITLE = '([^']+)'/.exec(js.series) || [])[1];
  const trading = (/<p class="sfh__sub">([^<]+)<\/p>/.exec(js.trading) || [])[1];
  const drops = (/<span class="do-subtitle">Lines flagged in the last ' \+ esc\(st\.windowH \|\| 24\) \+ '(h[^<]+)<\/span>/.exec(js.drops) || [])[1];
  const all = subs.concat([series, trading, drops]);
  if (all.some(s => !s)) return 'a header sentence could not be read: ' + JSON.stringify(all);
  for (const s of all) if (s.length > 120 || (s.match(/[.!?](\s|$)/g) || []).length > 2) return 'header copy is longer than one line: ' + s;
  return null;
}

// ── 4. Today's Matches: the live column (dot + clock, mono soft) and the Completed tail ─────────────────────────
function liveHtml(src) {
  const body = `const escapeHtml = s => String(s); const headerClockFmt = d => d.toISOString().slice(11, 19); const dataLoadedAt = new Date('2026-10-08T09:00:00Z');
    const mxOddsAgeBound = () => B;\n${slice(src, 'mxHeaderStatusHtml')}\nreturn mxHeaderStatusHtml();`;
  return B => new Function('B', body)(B);
}
function checkLive(src) {
  const run = liveHtml(src);
  for (const [B, label] of [[{ oldest: Date.parse('2026-10-08T08:45:12Z'), dated: 3, undated: 0, shown: 3 }, 'Live · oldest odds'],
    [{ oldest: null, dated: 0, undated: 2, shown: 2 }, 'Live · loaded']]) {
    const h = run(B);
    const m = /^<span class="sfh__l mx-live-txt"[^>]*>([^<]+)<\/span><span class="sfh__v sfh__v--soft sfh__live"><span class="sfh__dot" aria-hidden="true"><\/span><span class="mx-clock"[^>]*>(\d\d:\d\d:\d\d)<\/span><\/span>$/.exec(h);
    if (!m) return 'the live column is not caps label over dot + soft mono clock: ' + h;
    if (m[1] !== label) return `label "${m[1]}" want "${label}" (ruling A wording kept)`;
  }
  // markup: the live column is the FIRST column of the stats row, before the four board stats
  if (!/<div class="sfh__stats">\s*<div class="sfh__stat mx-datastatus" id="dataStatus">[\s\S]*?<\/div>\s*<div class="mx-hstats" id="mxHeaderStats"/.test(src)) return 'live column is not first in the stats row';
  if (!/\[data-page="matches"\] \.mx-hstats\{ display:contents; \}/.test(src)) return 'the four stats are not in the same row';
  // Completed: no live column; "Settled · <date>" + the zone ride in the grey sentence tail; Upcoming tail = the zone
  const chrome = slice(src, 'updateMatchesHeaderChrome');
  if (!/const parts = \(completed \? \[`Settled · \$\{settledDateLabel\(\)\}`\] : \[\]\)\.concat\(tz \? \[tz\] : \[\]\);\n\s*tzEl\.textContent = parts\.length \? `· \$\{parts\.join\(' · '\)\}` : '';/.test(chrome)) return 'the sentence tail is not "· [Settled · date ·] zone"';
  if (!/if \(completed\)\{\n[^\n]*\n\s*ds\.style\.display = 'none';/.test(chrome)) return 'Completed still shows the live column';
  if (!/<span class="sfh__tail" id="tzLine"><\/span><\/p>/.test(src)) return 'no tail span inside the sentence line';
  return null;
}

test('the 35b component: card, title, one-line sentence, stats, live dot, controls-under variant', () => assert.equal(checkComponent(DASH), null));
test('every page header card is the component; no caps line; no page-owned header rule left', () => assert.equal(checkPages(DASH, JS, CSS), null));
test('one line per header (trimmed copy, at most 120 characters)', () => assert.equal(checkOneSentence(DASH, JS), null));
test("Today's Matches: live column first (dot + soft mono clock), Completed puts Settled in the tail", () => assert.equal(checkLive(DASH), null));

test('CONTROL: each check goes red on its mutant', () => {
  const m = (src, a, b) => { assert.equal(src.split(a).length, 2, 'mutant anchor not found exactly once: ' + a.slice(0, 70)); return src.replace(a, b); };
  const red = f => { try { return f() !== null; } catch (e) { return true; } };
  // component values
  assert.ok(red(() => checkComponent(m(DASH, 'gap:28px; padding:18px 26px; margin:0; border:0;', 'gap:28px; padding:22px 26px; margin:0; border:0;'))), 'old 22x26 padding');
  assert.ok(red(() => checkComponent(m(DASH, 'font-size:24px; font-weight:800; letter-spacing:-0.015em;', 'font-size:29px; font-weight:800; letter-spacing:-0.015em;'))), '29px title');
  assert.ok(red(() => checkComponent(m(DASH, 'color:var(--text-soft);\n    white-space:nowrap;', 'color:var(--text-soft);\n    white-space:normal;'))), 'sentence wraps');
  assert.ok(red(() => checkComponent(m(DASH, '.sfh__stats{ display:flex; align-items:flex-end; gap:30px;', '.sfh__stats{ display:flex; align-items:flex-end; gap:34px;'))), 'stats gap 34');
  assert.ok(red(() => checkComponent(m(DASH, 'font-family:var(--font-nums); font-size:15px; font-weight:700;', 'font-family:var(--font-nums); font-size:17px; font-weight:700;'))), 'value 17px');
  assert.ok(red(() => checkComponent(m(DASH, '.sfh--ctl > .sfh__row{ display:flex; align-items:center; justify-content:space-between; gap:28px; margin:0 0 16px; }', '.sfh--ctl > .sfh__row{ display:flex; align-items:center; justify-content:space-between; gap:28px; margin:0 0 12px; }'))), 'H2H row gap');
  // pages
  assert.ok(red(() => checkPages(m(DASH, '<h1 class="sfh__title">Players</h1>', '<div class="pgh-eyebrow">ATP tour · this week\'s draws</div><h1 class="sfh__title">Players</h1>'), JS, CSS)), 'caps line back');
  assert.ok(red(() => checkPages(m(DASH, '<div class="sfh db-headcard" data-db="head">\n', '<div class="db-headcard" data-db="head">\n'), JS, CSS)), 'database off the component');
  assert.ok(red(() => checkPages(DASH, { ...JS, series: m(JS.series, "'<div class=\"sfh sr-head\">'", "'<div class=\"sr-head\">'") }, CSS)), 'series off the component');
  assert.ok(red(() => checkPages(m(DASH, '#tourListView .tourx-head{ margin-bottom:16px; }', '#tourListView .tourx-head h1{ font-size:29px; }'), JS, CSS)), 'page-owned title rule');
  assert.ok(red(() => checkPages(DASH, JS, { ...CSS, drops: CSS.drops + '\n[data-page="drops"] .do-head { padding: 22px 26px; }' })), 'drops restyles its header');
  // one sentence
  assert.ok(red(() => checkOneSentence(DASH, { ...JS, series: m(JS.series, "'Current streaks for players scheduled today and tomorrow.'", "'Current streaks for players scheduled today and tomorrow — runs of wins or losses against a playing style, on a surface, straight across all competitions.'") })), 'the old paragraph');
  // live column
  assert.ok(red(() => checkLive(m(DASH, '<span class="sfh__dot" aria-hidden="true"></span><span class="mx-clock" title="${escapeHtml(detail)}">', '<span class="mx-clock" title="${escapeHtml(detail)}">'))), 'no dot');
  assert.ok(red(() => checkLive(m(DASH, "      ds.style.display = 'none';\n      ds.classList.add('settled');", "      ds.style.display = '';\n      ds.classList.add('settled');"))), 'Completed live column');
  assert.ok(red(() => checkLive(m(DASH, '[data-page="matches"] .mx-hstats{ display:contents; }', '[data-page="matches"] .mx-hstats{ display:flex; gap:34px; }'))), 'stats in their own row');
});
