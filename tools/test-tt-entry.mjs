// Tournaments tab rebuild — Entry list (founder 2026-11-15, design_handoff_tournaments_tab `Entry Lists.dc.html`).
// Executes the SHIPPED data layer (window.EntryListsTab, sliced from bsp-consult-dashboard.html) and the SHIPPED renderer
// (tournaments-entry.js) on a real-data fixture (tools/fixtures/tt-entry: the deployed entry_lists_advance.json + the
// Paris Masters draws.json sheet + the roster rows they name, fetched 2026-11-15) with the clock pinned, and checks the
// structure, the dash rules and the data sources. CONTROL: every check goes red on its mutant.
//   node tools/test-tt-entry.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MOD = readFileSync(join(ROOT, 'tournaments-entry.js'), 'utf8');
const FX = n => JSON.parse(readFileSync(join(ROOT, 'tools/fixtures/tt-entry', n), 'utf8'));
const ADV = FX('entry_lists_advance.json'), DRAWS = FX('draws.json'), ROSTER = FX('player-index.json');

function dataLayerSrc(html) {
  const i = html.indexOf('window.EntryListsTab = (function(){');
  if (i < 0) throw new Error('window.EntryListsTab is gone');
  return html.slice(i, html.indexOf('</script>', i));
}

// Build one sandbox: the data layer + the renderer, clock pinned at `now`, shards answered from the fixture.
async function boot({ html = HTML, mod = MOD, now = '2026-10-28T10:00:00Z', adv = ADV, draws = DRAWS, roster = ROSTER, week = null } = {}) {
  const RD = Date, T = RD.parse(now);
  class FixedDate extends RD { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } }
  const win = {};
  const ctx = {
    window: win, Date: FixedDate, console, Promise, JSON, Math, Number, String, Object, Array, parseInt, isNaN, setTimeout,
    playerIndex: roster,
    tourxThisWeekEvents: () => week,
    // the registry key for the Paris Masters sheet (city "Nanterre"): stands in for the page's sfEventKey
    sfEventKey: (name, city) => (/paris/i.test(String(name)) || /nanterre/i.test(String(city || '')) ? 'Paris' : null),
    tourxEventName: () => { throw new Error('the Entry list must not print tourxEventName (founder 2026-11-15 ruling 1)'); },
    fetch: async (u) => {
      const f = String(u).split('?')[0];
      const body = f === 'entry_lists_advance.json' ? adv : f === 'draws.json' ? draws : null;
      return { ok: !!body, json: async () => JSON.parse(JSON.stringify(body)) };
    },
    document: { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) },
  };
  ctx.window = win; win.EntryListsTab = undefined;
  vm.createContext(ctx);
  vm.runInContext(dataLayerSrc(html), ctx);
  ctx.EntryListsTab = win.EntryListsTab;
  vm.runInContext(mod, ctx);
  ctx.window.TTEntry = win.TTEntry;
  await win.EntryListsTab.load();
  return { EL: win.EntryListsTab, TT: win.TTEntry, ctx };
}
const text = h => h.replace(/<[^>]*>/g, '|').replace(/\|+/g, '|');

// ------------------------------------------------------------------ checks (each returns null = pass, else the reason)
async function checkStructure(o = {}) {
  const { EL, TT } = await boot(o);
  const m = EL.model();
  if (!m.loaded) return 'the fixture did not load';
  if (m.weeks.join(',') !== '2026-10-26,2026-11-02,2026-11-16,2026-11-23,2026-12-07') return 'weeks: ' + m.weeks.join(',');
  if (m.defaultWeek !== '2026-11-02') return 'default week (the earliest with a row): ' + m.defaultWeek;
  const v = TT._view(m);
  if (TT.FOOT !== 'Acceptance order, not seeding. Ranks are the ATP singles ranking when the list was published.') return 'footnote copy';
  if (!/>2 Nov – 8 Nov<\/span><span class="tt-entry-wcount">1</.test(v.weeks)) return 'week chip label + count (design "2 Nov – 8 Nov" + mono count)';
  if (!/tt-entry-week on" role="tab" aria-selected="true" data-ttentry-week="2026-11-02"/.test(v.weeks)) return 'the default week is not the selected chip';
  if (v.count !== '1 event · 1 list loaded') return 'head count: ' + v.count;
  // tier card head: tier name + n events, caps column heads
  if (!/tt-entry-tiername">Masters<\/span><span class="tt-entry-tiermeta">1 event<\/span>/.test(v.body)) return 'tier card head';
  if (!/>Main draw<\/span><span class="tt-entry-caps">Qualifying<\/span><span class="tt-entry-caps">Alternates</.test(v.body)) return 'caps heads';
  // ATP row = the registry city key ("Paris"), never the sheet name or tourxEventName
  if (!/tt-entry-evname">Paris</.test(v.body)) return 'ATP row name is not the city key';
  if (!/Nov 2 · Hard · published —/.test(v.body)) return 'meta line "Nov 2 · Hard · published —"';
  // first visit: the first event with names opens; columns sentence case with "N players"
  if (!/tt-entry-ev open can"/.test(v.body) || !/>Hide<\/span>/.test(v.body)) return 'the default event is not open';
  if (!/tt-entry-coltitle">Main draw<\/span><span class="tt-entry-colnote">64 players/.test(v.body)) return 'main draw column title / note';
  if (!/tt-entry-coltitle">Qualifying</.test(v.body)) return 'qualifying column';
  if (!/<span class="r">No\.<\/span><span>Player<\/span><span><\/span><span class="r">Rank<\/span>/.test(v.body)) return 'column head';
  return null;
}

async function checkDashes(o = {}) {
  const { EL, TT } = await boot(o);
  const m = EL.model(), S = TT._state;
  // Paris draw: a non-seed has no list rank -> current ATP ranking with the hover; a slot with no country -> "—"
  let v = TT._view(m);
  const rows = [...v.body.matchAll(/<div class="tt-entry-pgrid tt-entry-prow">([\s\S]*?)<\/div>/g)].map(x => x[1]);
  if (rows.length < 64) return 'read ' + rows.length + ' player rows';
  const z = rows.find(r => /Alexander Zverev/.test(r));
  if (!z || !/tt-entry-pnat">GER</.test(z) || !/>#2</.test(z) || /title="Current ATP/.test(z)) return 'Zverev: list rank #2, GER';
  const atp = rows.filter(r => /title="Current ATP ranking \(the list prints none\)"/.test(r));
  if (!atp.length) return 'no row fell back to the current ATP ranking';
  if (!rows.some(r => /tt-entry-pnat">—</.test(r))) return 'a missing country is not "—"';
  if (!rows.some(r => /tt-entry-pname bye">Bye</.test(r))) return 'byes are not listed as Bye';
  if (rows.some(r => /tt-entry-pname bye/.test(r) && /#|—/.test(r))) return 'a Bye carries a rank or a dash';
  if (!rows.some(r => /data-ttentry-profile="1980"/.test(r))) return 'a trusted key does not link to the profile';
  // never-fetched rows (7 Dec week): three dashes, "Names pending", no chevron, the tooltip, not clickable
  S.week = '2026-12-07'; S.picked = true;
  v = TT._view(m);
  const pend = [...v.body.matchAll(/<div class="tt-entry-grid tt-entry-ev pending"[^>]*>([\s\S]*?)<\/span><\/span><\/div>/g)];
  if (pend.length !== 3) return 'pending rows: ' + pend.length;
  if (!/title="Player names are not loaded for this event yet"/.test(v.body)) return 'pending tooltip';
  if (/data-ttentry-ev=/.test(v.body) || /<svg/.test(v.body)) return 'a pending row is clickable or has a chevron';
  if ((v.body.match(/tt-entry-n none">—</g) || []).length !== 9) return 'pending counts are not 9 dashes';
  if (v.count !== '0 events · 0 lists loaded' && !/^\d+ events? · 0 lists loaded$/.test(v.count)) return 'pending week count: ' + v.count;
  // a real 0 stays 0 (Montevideo ALT 0)
  S.week = '2026-11-16';
  v = TT._view(m);
  if (!/Montevideo \(CH 75\)[\s\S]*?tt-entry-n">24<\/span><span class="tt-entry-n">18<\/span><span class="tt-entry-n">0<\/span>/.test(v.body)) return 'Montevideo ALT 0 is not 0';
  // a row whose shard carries counts but no sections dashes them (the shard is not trusted)
  const fake = Object.assign({}, m, { tournaments: m.tournaments.concat([{ tour: 'ATP', name: 'Ghost (CH 50)', tier: 'Challenger', weekStart: '2026-11-16', startDate: '2026-11-16', counts: { MD: 32, Q: 16, ALT: 0 }, sections: [] }]) });
  v = TT._view(fake);
  if (!/Ghost \(CH 50\)[\s\S]*?tt-entry-n none">—<\/span><span class="tt-entry-n none">—<\/span><span class="tt-entry-n none">—</.test(v.body)) return 'a never-fetched row shows the shard counts';
  // the pinned China Open list (7 Oct; moved here from test-ten401-f1a f1.4): Medvedev, Rublev, Khachanov, Safiullin play
  // under no flag -> "—", never a blank cell
  const china = JSON.parse(readFileSync(join(ROOT, 'tools/fixtures/ten401-f1a/entry-lists-2026-10-07.json'), 'utf8')).chinaOpen;
  const cm = Object.assign({}, m, { tournaments: [Object.assign({}, china, { tour: 'ATP', weekStart: '2026-11-16', tournamentId: 'china-pin' })] });
  S.opened['2026-11-16|china-pin'] = true;
  v = TT._view(cm);
  for (const n of ['Medvedev', 'Rublev', 'Khachanov', 'Safiullin']) {
    const r = [...v.body.matchAll(/<div class="tt-entry-pgrid tt-entry-prow">([\s\S]*?)<\/div>/g)].map(x => x[1]).find(x => new RegExp(n, 'i').test(x));
    if (!r) return 'vacuous: ' + n + ' is not on the pinned China Open list';
    if (!/tt-entry-pnat">—</.test(r)) return n + ': a missing country is not "—"';
  }
  // the empty week (26 Oct: no shard rows; the current week counts the This-week set)
  S.week = '2026-10-26';
  v = TT._view(m);
  if (!/No lists loaded for this week[\s\S]*The ATP has 0 events in 26 Oct – 1 Nov\. Their acceptance lists are not in the build yet — once they are loaded they appear here, grouped by tier\./.test(v.body)) return 'empty-week copy: ' + text(v.body);
  if (/Clear search/.test(v.body)) return 'the empty week offers Clear search';
  return null;
}

async function checkSearch(o = {}) {
  const { EL, TT } = await boot(o);
  const m = EL.model(), S = TT._state;
  S.q = 'ba';
  let v = TT._view(m);
  if (!v.searching || !/opacity:0\.55/.test(v.weeks) || /aria-selected="true"/.test(v.weeks)) return 'search: week track not dimmed / a week still selected';
  const evs = (v.body.match(/tt-entry-grid tt-entry-ev/g) || []).length;
  if (v.count !== 'Entered in ' + evs + ' events · all weeks' || evs < 2) return 'search count: ' + v.count + ' over ' + evs;
  if (/data-ttentry-ev=/.test(v.body)) return 'a search result is toggleable';
  const names = [...v.body.matchAll(/data-ttentry-profile="[^"]*" title="([^"]*)"|<span title="([^"]*)">/g)].map(x => (x[1] || x[2]).split(' · ')[0]);
  const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!names.length || names.some(n => !fold(n).includes('ba'))) return 'a non-matching player is listed: ' + names.filter(n => !fold(n).includes('ba')).join(', ');
  if (!/tt-entry-colnote">\d+ match(es)?</.test(v.body)) return 'search column note';
  if (/Copenhagen|La Paz|Monastir 3/.test(v.body)) return 'an event without names was searched';
  // accents fold: "baez" finds Báez-type spellings across weeks
  S.q = 'zzzz';
  v = TT._view(m);
  if (!/No player found[\s\S]*Nobody matching “zzzz” is on a loaded list\. Events still waiting for their player names are not searched\.[\s\S]*Clear search/.test(v.body)) return 'no-player state';
  if (v.count !== 'Entered in 0 events · all weeks') return 'no-player count: ' + v.count;
  S.q = '';
  return null;
}

async function checkIdentity(o = {}) {
  const { EL } = await boot(o);
  // a shard key whose roster name disagrees is another player: no profile link, no rank from it
  const roster = [{ key: '1206', name: 'Calvin Hemery', rank: 309 }];
  const { EL: E2 } = await boot({ ...o, roster });
  if (E2.linkKey({ name: 'Clement Hemery', playerKey: '1206', status: 'ALT' }) !== null) return 'Clement Hemery links to Calvin Hemery';
  if (E2.rankOf({ name: 'Clement Hemery', playerKey: '1206', rank: null }) !== null) return 'Clement Hemery takes Calvin Hemery\'s rank';
  if (E2.linkKey({ name: 'Calvin Hemery', playerKey: '1206' }) !== '1206') return 'an agreeing key lost its link';
  if (EL.displayName({ name: 'DAVIDOVICH FOKINA, Alej…', playerKey: null }) === 'Alej… Davidovich Fokina') return 'a cut name is printed mid-word';
  return null;
}

function checkCss(mod = MOD) {
  const css = (mod.match(/R \+ '[^']*'|R \+ '.*?\}'/g) || []);
  if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(mod)) return 'a raw colour in the module';
  const ctx = { window: {}, document: { getElementById: () => null }, console };
  vm.createContext(ctx); vm.runInContext(mod, ctx);
  const rules = ctx.window.TTEntry.CSS.split('\n');
  if (rules.some(r => !r.startsWith('.tabpage[data-page="tournaments"] .tt-entry-'))) return 'a rule is not scoped under the page + tt-entry- prefix';
  const R = sel => (rules.find(r => r.startsWith('.tabpage[data-page="tournaments"] ' + sel + '{')) || '');
  if (!/border:1\.25px solid color-mix\(in srgb, var\(--tt-white\) 6%, transparent\); border-radius:16px/.test(R('.tt-entry-card'))) return 'tier card border 1.25 white 6% r16';
  if (!/grid-template-columns:minmax\(0,1fr\) 84px 84px 84px 96px/.test(R('.tt-entry-grid'))) return 'event grid tracks';
  if (!/grid-template-columns:26px minmax\(0,1fr\) 40px 52px/.test(R('.tt-entry-pgrid'))) return 'player grid tracks';
  if (!/color:var\(--link\)/.test(R('.tt-entry-ev.open .tt-entry-cue'))) return 'Hide cue is not the export blue';
  if (!/border-color:color-mix\(in srgb, var\(--tt-blue\) 60%, transparent\)/.test(R('.tt-entry-search:focus-within'))) return 'search focus ring';
  if (!/background:var\(--selected\); border-color:color-mix\(in srgb, var\(--tt-white\) 16%, transparent\)/.test(R('.tt-entry-week.on'))) return 'selected week';
  if (!/repeat\(auto-fit,minmax\(340px,1fr\)\)/.test(R('.tt-entry-panel'))) return 'panel columns';
  return null;
}

function checkRetired(html = HTML) {
  const dl = dataLayerSrc(html);
  for (const f of ['renderTournament', 'renderPlayers', 'renderWeekTabs', 'renderHead', 'renderFreshness', 'staleBannerHtml', 'weekRangeHtml'])
    if (new RegExp('function ' + f + '\\(').test(dl)) return f + ' (old renderer) is still in the data layer';
  if (/\[data-page="entry-lists"\]/.test(html)) return 'old [data-page="entry-lists"] CSS / DOM is still there';
  if (!/return \{ init: init, load: load, currentWeekRows: currentWeekRows, model: model,/.test(dl)) return 'the data layer no longer exports load / currentWeekRows / model';
  if (!/<script src="tournaments-entry\.js"><\/script>/.test(html)) return 'the module is not loaded by the page';
  return null;
}

const run = async (name, fn) => { const r = await fn(); assert.equal(r, null, name + ': ' + r); console.log('ok  ', name); };
await run('structure: head, week track, tier cards, event rows, open columns, footnote', () => checkStructure());
await run('dashes: never fetched = —, real 0 = 0, no country = —, rank fallback with hover, Bye, empty week', () => checkDashes());
await run('search: every week, hits only, not toggleable, no-player state', () => checkSearch());
await run('identity: a disagreeing key gets no link and no rank', () => checkIdentity());
await run('CSS: scoped, export values, no raw colour', () => checkCss());
await run('old renderer retired; data API kept; module loaded', () => checkRetired());

// ------------------------------------------------------------------ CONTROL: each check goes red on its mutant
const red = async (check, mut) => { try { return (await check(mut)) !== null; } catch (e) { return true; } };
const unesc = x => x.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const mm = (src, a, b) => { if (!src.includes(a)) { a = unesc(a); b = unesc(b); } assert.equal(src.split(a).length, 2, 'mutant anchor not unique: ' + a.slice(0, 60)); return src.replace(a, b); };
const M = (a, b) => ({ mod: mm(MOD, a, b) }), Hm = (a, b) => ({ html: mm(HTML, a, b) });
const mutants = [
  [checkStructure, M("'published \\u2014'", "'published 8 Sep 2026'"), 'published date invented'],
  [checkStructure, M("return k || t.city || t.name || '\\u2014';", "return t.name || '\\u2014';"), 'ATP row prints the sheet name'],
  [checkStructure, M("+ ' \\u2013 ' + sun.getDate()", "+ ' - ' + sun.getDate()"), 'week label hyphen'],
  [checkStructure, M("if (first) S.opened[el.eventId(first)] = true;", ""), 'nothing opens by default'],
  [checkDashes, M("var cell = function(v){ v = has ? v : null;", "var cell = function(v){"), 'shard counts trusted on a never-fetched row'],
  [checkDashes, M("esc(p.country || '\\u2014')", "esc(p.country || '')"), 'blank country'],
  [checkDashes, Hm("    return (Number.isFinite(m) && m > 0) ? { rank: m, src: 'atp' } : null;", "    return null;"), 'no ATP rank fallback'],
  [checkDashes, M("(v == null ? '\\u2014' : esc(v))", "(v == null ? '0' : esc(v))"), 'a missing count reads 0'],
  [checkDashes, M("'The ATP has ' + (nEv == null", "'The ATP had ' + (nEv == null"), 'empty-week copy'],
  [checkSearch, M("var rows = hit ? all.filter(function(x){ return hit(x.p); }) : all;", "var rows = all;"), 'search lists every player'],
  [checkSearch, M("if (searching) shown = m.tournaments.filter(function(t){ return weeks.some(function(w){ return w.key === t.weekStart; })", "if (searching) shown = m.tournaments.filter(function(t){ return t.weekStart === S.week"), 'search only the selected week'],
  [checkSearch, M("(has && !searching ? ' data-ttentry-ev=", "(has ? ' data-ttentry-ev="), 'search results toggleable'],
  [checkIdentity, Hm("    return (kr && rr !== kr) ? null : String(p.playerKey);", "    return String(p.playerKey);"), 'disagreeing key linked'],
  [checkCss, mm(MOD, "border:1.25px solid ' + W(6) + '; border-radius:16px; overflow:hidden;", "border:1px solid ' + W(6) + '; border-radius:16px; overflow:hidden;"), 'card border 1px'],
  [checkCss, mm(MOD, "R + '.tt-entry-ev.open .tt-entry-cue{ color:var(--link); }'", "'.tt-entry-ev.open .tt-entry-cue{ color:var(--link); }'"), 'unscoped rule'],
  [checkCss, mm(MOD, "background:var(--selected); border-color:' + W(16)", "background:var(--tt-blue); border-color:' + W(16)"), 'selected week blue fill'],
  [checkRetired, mm(HTML, "  function hasList(t){ return !!(t.sections && t.sections.length); }", "  function hasList(t){ return !!(t.sections && t.sections.length); }\n  function renderHead(){}"), 'old renderer back'],
];
let n = 0;
for (const [check, mut, label] of mutants) { assert.ok(await red(check, mut), 'mutant survived: ' + label); n++; }
console.log('ok   CONTROL: ' + n + ' mutants, all red');
