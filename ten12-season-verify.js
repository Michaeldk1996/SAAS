// TEN-12 Season results verification: every season tab must render that
// season's full match list, grouped by tournament, losing no matches.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('bsp-consult-dashboard.html', 'utf8');
function grab(name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0; const i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++){
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}'){ depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function grabConst(name){
  const m = src.match(new RegExp(`^(?:const|let) ${name}\\s*=.*$`, 'm'));
  if (!m) throw new Error('not found: ' + name); return m[0];
}
const parts = [
  grabConst('PP_TOURNAMENT_EDITION_GAP_DAYS'), grabConst('PP_SURF_COLORS'), grabConst('PP_MONTHS'),
  grabConst('FORM_VISIBLE_MATCHES'), grabConst('formSeasonState'), grabConst('_formSeasonCtx'),
  grab('ppTournamentGroupKey'), grab('ppDaysBetween'), grab('ppSurfName'), grab('ppFmtDateRange'),
  grab('ppGroupMatchesByTournament'), grab('buildFormGroupedList'),
  grab('seasonYearsOf'), grab('buildSeasonResultsBody'),
];
const ctx = { console, Math, Array, String, Object, JSON, Number, Set, Map, Date,
  formRowHtml: (m) => `<row opp="${m.opponent}" t="${m.tournament}" d="${m.date}">`,
  playerHistories: JSON.parse(fs.readFileSync('/tmp/live-histories.json', 'utf8')),
};
vm.createContext(ctx);
vm.runInContext(parts.join("\n") + "\nglobalThis._formSeasonCtx=_formSeasonCtx; globalThis.formSeasonState=formSeasonState; globalThis.seasonYearsOf=seasonYearsOf; globalThis.buildSeasonResultsBody=buildSeasonResultsBody;", ctx);

let tabs = 0, failures = 0, totalRows = 0;
const fail = m => { console.log('  FAIL: ' + m); failures++; };
for (const [key, hist] of Object.entries(ctx.playerHistories)){
  ctx._formSeasonCtx.p1 = { playerKey: key, name: 'X' };
  const years = ctx.seasonYearsOf(hist);
  if (!years.length) fail(`player ${key}: no seasons`);
  // Tabs must be newest-first and cover every season present in the sidecar.
  const expected = [...new Set(hist.map(m => String(m.year)))].sort((a,b)=>b.localeCompare(a));
  if (JSON.stringify(years) !== JSON.stringify(expected)) fail(`player ${key}: tab years ${years} != ${expected}`);
  for (const y of years){
    tabs++;
    const html = ctx.buildSeasonResultsBody('p1', y);
    const rows = (html.match(/<row /g) || []).length;
    const want = hist.filter(m => String(m.year) === String(y)).length;
    if (rows !== want) fail(`player ${key} ${y}: ${want} matches in, ${rows} rows out`);
    if (!/class="aform-tgroup"/.test(html)) fail(`player ${key} ${y}: no tournament headers`);
    // Every row must belong to the selected season.
    for (const d of html.match(/d="(\d{4})-/g) || []) if (d.slice(3,7) !== y) fail(`player ${key} ${y}: leaked ${d}`);
    totalRows += rows;
  }
}
console.log(`checked ${tabs} season tabs across ${Object.keys(ctx.playerHistories).length} players, ${totalRows} rows — ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
