// Tournaments tab — Entry list (design_handoff_tournaments_2026-11-20 `Entry Lists.dc.html`: one ringed open block, list
// switch, two-column players, ATP · Challenger · ITF filter defaulting to ATP).
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
    // the dashboard's one photo resolver, stubbed: proves the photo is asked by player key only
    playerPhotoImg: (k, n) => '<img class="sf-ph" data-k="' + k + '" alt="' + n + '">',
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

const ALL = { atp: true, ch: true, itf: true };
const prows = h => [...h.matchAll(/<div class="tt-entry-prow">([\s\S]*?)<\/div>/g)].map(x => x[1]);

// ------------------------------------------------------------------ checks (each returns null = pass, else the reason)
async function checkStructure(o = {}) {
  const { EL, TT } = await boot(o);
  const m = EL.model();
  if (!m.loaded) return 'the fixture did not load';
  if (m.weeks.join(',') !== '2026-10-26,2026-11-02,2026-11-16,2026-11-23,2026-12-07') return 'weeks: ' + m.weeks.join(',');
  if (m.defaultWeek !== '2026-11-02') return 'default week (the earliest with a row): ' + m.defaultWeek;
  const S = TT._state;
  if (JSON.stringify(S.levels) !== '{"atp":true}') return 'default levels are not ATP only: ' + JSON.stringify(S.levels);
  TT._setLogos({ Paris: 'paris.png' });
  let v = TT._view(m);
  if (TT.FOOT !== 'Acceptance order, not seeding. Ranks are the ATP singles ranking when the list was published.') return 'footnote copy';
  if (!/>2 Nov – 8 Nov<\/span><span class="tt-entry-scount">1</.test(v.weeks)) return 'week chip label + count (design "2 Nov – 8 Nov" + mono count)';
  if (!/tt-entry-seg on" role="tab" aria-selected="true" data-ttentry-week="2026-11-02"/.test(v.weeks)) return 'the default week is not the selected chip';
  // level switch: three options, counts for the picked week, ATP picked
  if (!/data-ttentry-level="atp"><span class="tt-entry-slabel">ATP<\/span><span class="tt-entry-scount">1</.test(v.weeks)) return 'ATP level count';
  if (!/tt-entry-seg on" role="tab" aria-selected="true" data-ttentry-level="atp"/.test(v.weeks)) return 'ATP is not the picked level';
  if (!/data-ttentry-level="ch"><span class="tt-entry-slabel">Challenger<\/span><span class="tt-entry-scount">0</.test(v.weeks)) return 'Challenger level count';
  if (!/data-ttentry-level="itf"><span class="tt-entry-slabel">ITF<\/span><span class="tt-entry-scount">0</.test(v.weeks)) return 'ITF level count';
  if (v.count !== '1 event · 1 with names loaded') return 'head count: ' + v.count;
  if (!/tt-entry-tiername">Masters<\/span><span class="tt-entry-tiermeta">1 event<\/span>/.test(v.body)) return 'tier card head';
  if (!/tt-entry-lab">Main draw<\/span><span class="tt-entry-lab">Qualifying<\/span><span class="tt-entry-lab">Alternates</.test(v.body)) return 'column labels';
  // ATP row = the registry city key ("Paris"), never the sheet name or tourxEventName; logo file from the index
  if (!/tt-entry-evname">Paris</.test(v.body)) return 'ATP row name is not the city key';
  if (!/tt-entry-logo">PAR<img src="\.\/tournament-logos\/paris\.png"/.test(v.body)) return 'logo tile: code under the indexed file';
  if (!/Nov 2 · Hard · published —/.test(v.body)) return 'meta line "Nov 2 · Hard · published —"';
  // first visit: the first event with names opens as ONE ringed block with a list switch, one list at a time
  if (!/tt-entry-wrap open"><div class="tt-entry-grid tt-entry-ev open can"/.test(v.body)) return 'the default event is not open in its ring';
  if (!/data-ttentry-tab="[^"]*#0"><span class="tt-entry-slabel">Main draw<\/span><span class="tt-entry-scount">64</.test(v.body)) return 'list switch: Main draw 64';
  if (!/data-ttentry-tab="[^"]*#1"><span class="tt-entry-slabel">Qualifying</.test(v.body)) return 'list switch: Qualifying';
  if (!/tt-entry-tabnote">64 players</.test(v.body)) return 'tab note';
  if ((v.body.match(/tt-entry-cols/g) || []).length !== 1) return 'more than one list shown at a time';
  const md = prows(v.body).length;
  const id = Object.keys(S.opened).find(k => S.opened[k]);
  S.tabs[id] = 1;
  v = TT._view(m);
  const qn = prows(v.body).length;
  if (!(md >= 64) || qn === md || !/tt-entry-seg on" role="tab" aria-selected="true" data-ttentry-tab="[^"]*#1"/.test(v.body)) return 'the Qualifying tab does not switch the list';
  S.tabs[id] = 0;
  TT._setLogos({});
  v = TT._view(m);
  if (/<img src="\.\/tournament-logos/.test(v.body) || !/tt-entry-logo">PAR</.test(v.body)) return 'no logo file = the three-letter code';
  return null;
}

async function checkLevels(o = {}) {
  const { EL, TT } = await boot(o);
  const m = EL.model(), S = TT._state;
  S.week = '2026-11-16'; S.picked = true;
  let v = TT._view(m);
  // ATP only on a Challenger-only week: the design's empty state, never a mock row
  if (!/No events at this level this week[\s\S]*Nothing is listed for 16 Nov – 22 Nov at the levels switched on\. Turn on another level or pick another week\./.test(v.body)) return 'empty level state: ' + text(v.body);
  if (v.count !== '0 events · 0 with names loaded') return 'empty level count: ' + v.count;
  if (!/data-ttentry-level="ch"><span class="tt-entry-slabel">Challenger<\/span><span class="tt-entry-scount">3</.test(v.weeks)) return 'Challenger count 3';
  TT._toggleLevel('ch');
  v = TT._view(m);
  if (!/tt-entry-tiername">Challenger<\/span><span class="tt-entry-tiermeta">3 events</.test(v.body)) return 'Challenger card after the toggle';
  if (v.count !== '3 events · 3 with names loaded') return 'count after the toggle: ' + v.count;
  TT._toggleLevel('atp'); TT._toggleLevel('ch');   // ch alone, then try to switch it off: at least one stays on
  if (!S.levels.ch || S.levels.atp) return 'at least one level stays on: ' + JSON.stringify(S.levels);
  // ITF rows (none in the fixture): a real ITF row counts under ITF only, and shows only when ITF is on
  const itf = { tour: 'ATP', tournamentId: 'itf-x', name: 'M15 Monastir', tier: 'ITF', weekStart: '2026-11-16', startDate: '2026-11-16', counts: { MD: 32, Q: 32, ALT: 4 }, sections: [] };
  const fm = Object.assign({}, m, { tournaments: m.tournaments.concat([itf]) });
  v = TT._view(fm);
  if (!/data-ttentry-level="itf"><span class="tt-entry-slabel">ITF<\/span><span class="tt-entry-scount">1</.test(v.weeks)) return 'ITF count';
  if (/M15 Monastir/.test(v.body)) return 'an ITF row shows with ITF off';
  TT._toggleLevel('itf');
  v = TT._view(fm);
  if (!/tt-entry-tiername">ITF</.test(v.body) || !/tt-entry-logo">MON</.test(v.body)) return 'ITF card / code (M15 prefix dropped)';
  // while searching, a level click clears the search and shows that level only
  S.q = 'ba';
  TT._toggleLevel('atp');
  if (S.q !== '' || JSON.stringify(S.levels) !== '{"atp":true}') return 'level click during search: ' + S.q + ' ' + JSON.stringify(S.levels);
  return null;
}

async function checkDashes(o = {}) {
  const { EL, TT } = await boot(o);
  const m = EL.model(), S = TT._state;
  // Paris draw: a non-seed has no list rank -> current ATP ranking with the hover; a slot with no country -> "—"
  let v = TT._view(m);
  const rows = prows(v.body);
  if (rows.length < 64) return 'read ' + rows.length + ' player rows';
  const z = rows.find(r => /Alexander Zverev/.test(r));
  if (!z || !/tt-entry-pnat">GER</.test(z) || !/>#2</.test(z) || /title="Current ATP/.test(z)) return 'Zverev: list rank #2, GER';
  if (!/tt-entry-av">AZ<img class="sf-ph" data-k="1980"/.test(z)) return 'Zverev avatar: photo by key 1980 over initials';
  const atp = rows.filter(r => /title="Current ATP ranking \(the list prints none\)"/.test(r));
  if (!atp.length) return 'no row fell back to the current ATP ranking';
  if (!rows.some(r => /tt-entry-pnat">—</.test(r))) return 'a missing country is not "—"';
  if (!rows.some(r => /tt-entry-pname bye">Bye</.test(r))) return 'byes are not listed as Bye';
  if (rows.some(r => /tt-entry-pname bye/.test(r) && /#|—|sf-ph/.test(r))) return 'a Bye carries a rank, a dash or a photo';
  if (!rows.some(r => /data-ttentry-profile="1980"/.test(r))) return 'a trusted key does not link to the profile';
  if (rows.some(r => /sf-ph/.test(r) && !/data-ttentry-profile/.test(r))) return 'a photo on a row with no trusted key';
  S.levels = Object.assign({}, ALL);
  // never-fetched rows (7 Dec week): three dashes, "Names pending", no chevron, the tooltip, not clickable
  S.week = '2026-12-07'; S.picked = true;
  v = TT._view(m);
  if ((v.body.match(/tt-entry-ev pending"/g) || []).length !== 3) return 'pending rows';
  if (!/title="Player names are not loaded for this event yet"/.test(v.body) || !/>Names pending</.test(v.body)) return 'pending tooltip / cue';
  if (/data-ttentry-ev=/.test(v.body) || /<svg/.test(v.body)) return 'a pending row is clickable or has a chevron';
  if ((v.body.match(/tt-entry-n none">—</g) || []).length !== 9) return 'pending counts are not 9 dashes';
  if (v.count !== '3 events · 0 with names loaded') return 'pending week count: ' + v.count;
  // a real 0 stays 0 (Montevideo ALT 0)
  S.week = '2026-11-16';
  v = TT._view(m);
  if (!/Montevideo \(CH 75\)[\s\S]*?tt-entry-n">24<\/span><span class="tt-entry-n">18<\/span><span class="tt-entry-n">0<\/span>/.test(v.body)) return 'Montevideo ALT 0 is not 0';
  // a row whose shard carries counts but no sections dashes them (the shard is not trusted)
  const fake = Object.assign({}, m, { tournaments: m.tournaments.concat([{ tour: 'ATP', name: 'Ghost (CH 50)', tier: 'Challenger', weekStart: '2026-11-16', startDate: '2026-11-16', counts: { MD: 32, Q: 16, ALT: 0 }, sections: [] }]) });
  v = TT._view(fake);
  if (!/Ghost \(CH 50\)[\s\S]*?tt-entry-n none">—<\/span><span class="tt-entry-n none">—<\/span><span class="tt-entry-n none">—</.test(v.body)) return 'a never-fetched row shows the shard counts';
  // the pinned China Open list (7 Oct): Medvedev, Rublev, Khachanov, Safiullin play under no flag -> "—", never blank
  const china = JSON.parse(readFileSync(join(ROOT, 'tools/fixtures/ten401-f1a/entry-lists-2026-10-07.json'), 'utf8')).chinaOpen;
  const cm = Object.assign({}, m, { tournaments: [Object.assign({}, china, { tour: 'ATP', weekStart: '2026-11-16', tournamentId: 'china-pin' })] });
  S.opened['2026-11-16|china-pin'] = true;
  v = TT._view(cm);
  for (const n of ['Medvedev', 'Rublev', 'Khachanov', 'Safiullin']) {
    const r = prows(v.body).find(x => new RegExp(n, 'i').test(x));
    if (!r) return 'vacuous: ' + n + ' is not on the pinned China Open list';
    if (!/tt-entry-pnat">—</.test(r)) return n + ': a missing country is not "—"';
  }
  // the empty week (26 Oct: no shard rows)
  S.week = '2026-10-26';
  v = TT._view(m);
  if (!/No events at this level this week[\s\S]*Nothing is listed for 26 Oct – 1 Nov/.test(v.body)) return 'empty-week copy: ' + text(v.body);
  if (/Clear search/.test(v.body)) return 'the empty week offers Clear search';
  return null;
}

async function checkSearch(o = {}) {
  const { EL, TT } = await boot(o);
  const m = EL.model(), S = TT._state;
  S.q = 'ba';
  let v = TT._view(m);
  if (!v.searching || (v.weeks.match(/opacity:0\.55/g) || []).length !== 2 || /aria-selected="true"/.test(v.weeks)) return 'search: switches not dimmed / an option still picked';
  const evs = (v.body.match(/tt-entry-grid tt-entry-ev/g) || []).length;
  if (v.count !== 'Entered in ' + evs + ' events · all weeks' || evs < 2) return 'search count: ' + v.count + ' over ' + evs;
  if (!/Helsinki|Montevideo|Champaign|Florian/.test(v.body)) return 'search skipped the Challenger level (ATP only is picked)';
  if (/data-ttentry-ev=/.test(v.body) || /data-ttentry-tab=/.test(v.body)) return 'a search result is toggleable or shows the list switch';
  const names = [...v.body.matchAll(/data-ttentry-profile="[^"]*" title="([^"]*)"|<span title="([^"]*)">/g)].map(x => (x[1] || x[2]).split(' · ')[0]);
  const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!names.length || names.some(n => !fold(n).includes('ba'))) return 'a non-matching player is listed: ' + names.filter(n => !fold(n).includes('ba')).join(', ');
  if (!/tt-entry-secnote">\d+ match(es)?</.test(v.body)) return 'search section note';
  if (/Copenhagen|La Paz|Monastir 3/.test(v.body)) return 'an event without names was searched';
  S.q = 'zzzz';
  v = TT._view(m);
  if (!/No player found[\s\S]*Nobody matching “zzzz” is on a loaded list\. Events still waiting for their player names are not searched\.[\s\S]*Clear search/.test(v.body)) return 'no-player state';
  if (v.count !== 'Entered in 0 events · all weeks') return 'no-player count: ' + v.count;
  S.q = '';
  return null;
}

async function checkIdentity(o = {}) {
  const { EL } = await boot(o);
  // a shard key whose roster name disagrees is another player: no profile link, no rank, no photo from it
  const roster = [{ key: '1206', name: 'Calvin Hemery', rank: 309 }];
  const { EL: E2, TT: T2 } = await boot({ ...o, roster });
  const ev = { tour: 'ATP', tournamentId: 'hem', name: 'M15 Monastir', tier: 'ITF', weekStart: '2026-11-02', startDate: '2026-11-02', counts: { MD: 1 },
    sections: [{ title: 'Main Draw', players: [{ name: 'Clement Hemery', playerKey: '1206', status: 'ALT', country: 'FRA' }] }] };
  T2._state.levels = { itf: true };
  const hv = T2._view(Object.assign({}, E2.model(), { tournaments: [ev] }));
  if (!/Clement Hemery/.test(hv.body)) return 'vacuous: the Hemery row is not drawn';
  if (/sf-ph/.test(hv.body)) return 'Clement Hemery shows Calvin Hemery\'s photo';
  if (E2.linkKey({ name: 'Clement Hemery', playerKey: '1206', status: 'ALT' }) !== null) return 'Clement Hemery links to Calvin Hemery';
  if (E2.rankOf({ name: 'Clement Hemery', playerKey: '1206', rank: null }) !== null) return 'Clement Hemery takes Calvin Hemery\'s rank';
  if (E2.linkKey({ name: 'Calvin Hemery', playerKey: '1206' }) !== '1206') return 'an agreeing key lost its link';
  if (EL.displayName({ name: 'DAVIDOVICH FOKINA, Alej…', playerKey: null }) === 'Alej… Davidovich Fokina') return 'a cut name is printed mid-word';
  return null;
}

function checkCss(mod = MOD) {
  if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(mod)) return 'a raw colour in the module';
  const ctx = { window: {}, document: { getElementById: () => null }, console };
  vm.createContext(ctx); vm.runInContext(mod, ctx);
  const rules = ctx.window.TTEntry.CSS.split('\n');
  if (rules.some(r => !r.startsWith('.tabpage[data-page="tournaments"] .tt-entry-'))) return 'a rule is not scoped under the page + tt-entry- prefix';
  const R = sel => (rules.find(r => r.startsWith('.tabpage[data-page="tournaments"] ' + sel + '{')) || '');
  if (!/background:var\(--tt-card\); border:1px solid color-mix\(in srgb, var\(--tt-white\) 6%, transparent\); border-radius:16px; padding-bottom:10px/.test(R('.tt-entry-card'))) return 'tier card #0E1019 + 6% r16';
  if (!/grid-template-columns:minmax\(0,1fr\) 84px 84px 84px 96px/.test(R('.tt-entry-grid'))) return 'event grid tracks';
  if (!/grid-template-columns:22px 26px minmax\(0,1fr\) 34px 48px/.test(R('.tt-entry-prow')) || !/height:42px/.test(R('.tt-entry-prow'))) return 'player row grid';
  if (!/columns:300px 2; column-gap:36px/.test(R('.tt-entry-cols'))) return 'players down two columns';
  if (!/margin:6px 14px; box-shadow:inset 0 0 0 1px color-mix\(in srgb, var\(--tt-white\) 12%, transparent\)/.test(R('.tt-entry-wrap.open'))) return 'open event ring 12%';
  if (!/background:var\(--tt-lifted\); border-color:color-mix\(in srgb, var\(--tt-white\) 14%, transparent\)/.test(R('.tt-entry-seg.on'))) return 'picked option lifted + 14%';
  if (!/background:var\(--tt-lifted\); border-color:color-mix\(in srgb, var\(--tt-white\) 14%, transparent\)/.test(R('.tt-entry-search:focus-within'))) return 'search focus: lifted, never blue';
  if (!/rotate\(90deg\)/.test(R('.tt-entry-ev.open .tt-entry-cue svg'))) return 'chevron turns 90°';
  if (!/width:26px; height:26px; border-radius:50%/.test(R('.tt-entry-av'))) return '26px round avatar';
  if (/text-transform:uppercase/.test(ctx.window.TTEntry.CSS)) return 'caps labels';
  if (!/font-size:11\.5px; font-weight:600/.test(R('.tt-entry-lab'))) return 'small labels 11.5/600';
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
await run('structure: head, week + level switches, tier cards, logo tile, ringed open event, list switch, footnote', () => checkStructure());
await run('levels: ATP default, real counts, empty state, at least one on, search click', () => checkLevels());
await run('dashes: never fetched = —, real 0 = 0, no country = —, rank fallback with hover, Bye, photo by key, empty week', () => checkDashes());
await run('search: every week and level, hits only, not toggleable, no-player state', () => checkSearch());
await run('identity: a disagreeing key gets no link and no rank', () => checkIdentity());
await run('CSS: scoped, export values, no raw colour, no caps', () => checkCss());
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
  [checkStructure, M("var f = levelOf(t) === 'atp' && LOGOS ? LOGOS[nm] : null;", "var f = null;"), 'logo file ignored'],
  [checkStructure, M("else if (cols.length > 1) body =", "else if (false) body ="), 'no list switch'],
  [checkStructure, M("var S = { week: null, picked: false, q: '', opened: {}, openInit: {}, levels: { atp: true }, tabs: {} };", "var S = { week: null, picked: false, q: '', opened: {}, openInit: {}, levels: { atp: true, ch: true, itf: true }, tabs: {} };"), 'default every level'],
  [checkLevels, M("return inWeek(t) && levelOf(t) === l[0]; }).length;", "return levelOf(t) === l[0]; }).length;"), 'level count over every week'],
  [checkLevels, M("if (LEVELS.some(function(l){ return nx[l[0]]; })) S.levels = nx;", "S.levels = nx;"), 'all levels can switch off'],
  [checkLevels, M("if (S.q.trim()){ clearQ(); S.levels = {}; S.levels[k] = true; return; }", ""), 'level click keeps the search'],
  [checkLevels, M("var g = EL().levelGroup(t.tier); return g === 'Challenger' ? 'ch' : g === 'ITF' ? 'itf' : 'atp';", "return 'atp';"), 'every row counted as ATP'],
  [checkDashes, M("var cell = function(v){ v = has ? v : null;", "var cell = function(v){"), 'shard counts trusted on a never-fetched row'],
  [checkDashes, M("esc(p.country || '\\u2014')", "esc(p.country || '')"), 'blank country'],
  [checkDashes, Hm("    return (Number.isFinite(m) && m > 0) ? { rank: m, src: 'atp' } : null;", "    return null;"), 'no ATP rank fallback'],
  [checkDashes, M("(v == null ? '\\u2014' : esc(v))", "(v == null ? '0' : esc(v))"), 'a missing count reads 0'],
  [checkIdentity, M("var ph = key && typeof playerPhotoImg", "var ph = p.playerKey && typeof playerPhotoImg"), 'photo on an untrusted key'],
  [checkSearch, M("var rows = hit ? all.filter(function(x){ return hit(x.p); }) : all;", "var rows = all;"), 'search lists every player'],
  [checkSearch, M("if (searching) shown = m.tournaments.filter(function(t){ return m.weeks.indexOf(t.weekStart) >= 0", "if (searching) shown = m.tournaments.filter(function(t){ return t.weekStart === S.week"), 'search only the selected week'],
  [checkSearch, M("(has && !searching ? ' data-ttentry-ev=", "(has ? ' data-ttentry-ev="), 'search results toggleable'],
  [checkIdentity, Hm("    return (kr && rr !== kr) ? null : String(p.playerKey);", "    return String(p.playerKey);"), 'disagreeing key linked'],
  [checkCss, mm(MOD, "R + '.tt-entry-cols{ columns:300px 2; column-gap:36px; }'", "R + '.tt-entry-cols{ columns:300px 1; column-gap:36px; }'"), 'one column'],
  [checkCss, mm(MOD, "R + '.tt-entry-ev.open .tt-entry-cue svg{ transform:rotate(90deg); }'", "'.tt-entry-ev.open .tt-entry-cue svg{ transform:rotate(90deg); }'"), 'unscoped rule'],
  [checkCss, mm(MOD, "R + '.tt-entry-seg.on{ background:var(--tt-lifted);", "R + '.tt-entry-seg.on{ background:var(--tt-blue);"), 'picked option blue fill'],
  [checkCss, mm(MOD, "R + '.tt-entry-lab{ font-size:11.5px; font-weight:600;", "R + '.tt-entry-lab{ font-size:10.5px; font-weight:700; text-transform:uppercase;"), 'caps labels'],
  [checkRetired, mm(HTML, "  function hasList(t){ return !!(t.sections && t.sections.length); }", "  function hasList(t){ return !!(t.sections && t.sections.length); }\n  function renderHead(){}"), 'old renderer back'],
];
let n = 0;
for (const [check, mut, label] of mutants) { assert.ok(await red(check, mut), 'mutant survived: ' + label); n++; }
console.log('ok   CONTROL: ' + n + ' mutants, all red');
