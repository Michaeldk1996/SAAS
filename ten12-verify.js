// TEN-12 verification: the match-analysis modal's Recent Matches list must
// render tournament group headers instead of a flat run of rows.
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('bsp-consult-dashboard.html', 'utf8');

// Pull a top-level `function name(` ... matching-brace block out of the page.
function grab(name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`not found: ${name}`);
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++){
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}'){ depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced: ${name}`);
}
function grabConst(name){
  const re = new RegExp(`^const ${name}\\s*=.*$`, 'm');
  const m = src.match(re);
  if (!m) throw new Error(`not found: const ${name}`);
  return m[0];
}

const parts = [
  grabConst('PP_TOURNAMENT_EDITION_GAP_DAYS'),
  grabConst('PP_SURF_COLORS'),
  grabConst('PP_MONTHS'),
  grabConst('FORM_VISIBLE_MATCHES'),
  grab('ppTournamentGroupKey'),
  grab('ppDaysBetween'),
  grab('ppSurfName'),
  grab('ppFmtDateRange'),
  grab('ppGroupMatchesByTournament'),
  grab('buildFormGroupedList'),
  // The caller itself, so the test executes the real column template rather
  // than trusting the helper in isolation.
  grabConst('ANALYSIS_P1_COLOR'), grabConst('ANALYSIS_P2_COLOR'),
  grabConst('ANALYSIS_P1_RGBA'), grabConst('ANALYSIS_P2_RGBA'),
  grabConst('formFilterState'),
  grab('buildFormPlayerColumn'),
];

const ctx = { console, Math, Array, String, Object, JSON, Number, Set, Map, Date,
  // formRowHtml is the untouched per-row renderer; stub it so the test asserts
  // grouping/ordering only, and each row is identifiable.
  formRowHtml: (m) => `<row opp="${m.opponent}" t="${m.tournament}" d="${m.date}">`,
};
vm.createContext(ctx);
vm.runInContext(parts.join('\n'), ctx);

const data = JSON.parse(fs.readFileSync('matches.json', 'utf8'));
const arr = Array.isArray(data) ? data : (data.matches || []);

let checked = 0, failures = 0;
const fail = (msg) => { console.log('  FAIL: ' + msg); failures++; };

for (const mt of arr){
  for (const side of ['p1RecentFormMatches', 'p2RecentFormMatches']){
    const ms = mt[side];
    if (!ms || !ms.length) continue;
    checked++;

    const out = ctx.buildFormGroupedList(ms, 'p1', 123, 'X', 'main', true);

    // 1. Every input match must survive into the rendered list — grouping must
    //    never silently drop a row.
    const rows = (out.html.match(/<row /g) || []).length;
    if (rows !== ms.length) fail(`${side}: ${ms.length} matches in, ${rows} rows out`);

    // 2. There must be at least one tournament header (this is the whole point).
    const headers = (out.html.match(/class="aform-tgroup"/g) || []).length;
    if (!headers) fail(`${side}: no tournament group headers rendered`);

    // 3. Rows under a header must all belong to that header's tournament.
    const blocks = out.html.split('class="aform-tgroup"').slice(1);
    for (const b of blocks){
      const label = (b.match(/class="tname"[^>]*>([^<]+)</) || [])[1];
      if (!label || label === 'Other matches') continue;
      const tours = [...b.matchAll(/<row [^>]*t="([^"]*)"/g)]
        .map(x => x[1])
        .slice(0, (b.split('class="aform-tgroup"')[0].match(/<row /g) || []).length);
      for (const t of tours){
        if (!String(t).toLowerCase().includes(String(label).toLowerCase())
            && !String(label).toLowerCase().includes(String(t).toLowerCase())){
          fail(`row from "${t}" sits under header "${label}"`);
        }
      }
    }

    // 4. hiddenCount must equal the rows actually hidden behind show-more.
    const hiddenRows = [...out.html.matchAll(/class="aform-extra-p1"[^>]*>([\s\S]*?)(?=<div class="aform-extra-p1"|$)/g)]
      .reduce((n, m2) => n + ((m2[1].match(/<row /g) || []).length), 0);
    if (hiddenRows !== out.hiddenCount) fail(`${side}: hiddenCount=${out.hiddenCount} but ${hiddenRows} rows hidden`);

    // 5. The real column template must render (this is what caught the
    //    dangling extraRows reference) and must contain group headers.
    try {
      const col = ctx.buildFormPlayerColumn('A. Player', 60, ms, 'clay', 'p1', 123);
      if (!col.includes('aform-tgroup')) fail(`${side}: column rendered without group headers`);
      if (!col.includes('aform-list')) fail(`${side}: column missing list`);
    } catch (e) {
      fail(`${side}: buildFormPlayerColumn threw — ${e.message}`);
    }

    // 6. Collapse=false must hide nothing (the surface list).
    const openOut = ctx.buildFormGroupedList(ms, 'p1', 123, 'X', 'surf', false);
    if (openOut.hiddenCount !== 0) fail(`${side}: surface list hid ${openOut.hiddenCount} rows`);
    if (openOut.html.includes('aform-extra-')) fail(`${side}: surface list emitted collapse wrappers`);
  }
}

console.log(`\nchecked ${checked} form lists — ${failures} failure(s)`);

// Show one real rendering so the grouping is visible, not just asserted.
const sample = arr.find(x => x.p1RecentFormMatches && x.p1RecentFormMatches.length);
const s = ctx.buildFormGroupedList(sample.p1RecentFormMatches, 'p1', 1, 'X', 'main', true);
console.log(`\n=== sample: ${sample.p1} (hiddenCount=${s.hiddenCount}) ===`);
console.log(s.html
  .replace(/<div class="aform-extra-p1"[^>]*>/g, '\n--- behind "Show more" ---\n')
  .replace(/<div class="aform-tgroup">\s*<span class="tname"[^>]*>([^<]+)<\/span>[\s\S]*?class="trec">([^<]+)<[\s\S]*?<\/div>/g, '\n[$1]  $2')
  .replace(/<row opp="([^"]*)" t="[^"]*" d="([^"]*)">/g, '   $2  $1')
  .replace(/<[^>]+>/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim());
