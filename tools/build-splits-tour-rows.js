#!/usr/bin/env node
// Level & round tour figures (founder 2026-11-15: "fix the statistics that are a dash"). For every tracked player's
// splits-matches/<key>.json, the profile's own row rules (PlayerProfileV2._internals.splTourRowsOf — the drawer's
// splGroupsDef + splStats, never a copy) give his per-row COUNTS for career and his own last 52 weeks; this sums them
// over every player and writes them into career-splits-tour.json as `rows` = { career: { label: counts }, last52: … }.
// A row's tour figure is then Σ counts ÷ Σ counts (exact, never an average of rates). Population: every tracked player
// with a splits-matches file; a match between two tracked players is in both players' rows (as the existing pool).
//
//   node tools/build-splits-tour-rows.js [dir]      # dir = where splits-matches/ and career-splits-tour.json live (.)
'use strict';
const fs = require('fs');
const path = require('path');

// The host page's event category (window.pp2EventCategory: sfEventKey over TOURNAMENT_CATALOG), evaluated from the shipped
// dashboard source with the real TournamentIdentity — the drawer splits "Other Tours" into ATP 500 / ATP 250 with it.
function eventCategoryFromSource(src) {
  const fn = name => { const a = src.indexOf('\nfunction ' + name + '('); if (a < 0) throw new Error(name + ' not found');
    let d = 0, i = src.indexOf('{', a); for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; } return src.slice(a, i + 1); };
  const cst = name => { const a = src.indexOf('\nconst ' + name + ' = '); if (a < 0) throw new Error(name + ' not found'); return src.slice(a, src.indexOf(';\n', a) + 1); };
  // eslint-disable-next-line no-new-func
  return new Function('window', ['TOURNAMENT_CATALOG', 'SF_EVENT_NAMES', 'SF_EVENT_ALIAS', 'SF_EVENT_LITERAL'].map(cst).join('\n') + '\nlet _sfEventIx = null;\n' +
    ['ppCleanTournamentName', 'fhTournClean', 'sfEventKey'].map(fn).join('\n') +
    '\nreturn function (name) { try { const k = sfEventKey(name); const e = k ? TOURNAMENT_CATALOG.find(t => t.name === k) : null; return e ? e.category : null; } catch (_) { return null; } };')(
    { TournamentIdentity: require('../tournament-identity.js') });
}
function loadModule(root) {
  const src = fs.readFileSync(path.join(root, 'player-profile-v2.js'), 'utf8');
  const cat = eventCategoryFromSource(fs.readFileSync(path.join(root, 'bsp-consult-dashboard.html'), 'utf8'));
  const W = { FEATURE_PP2: true, playerProfiles: { players: [] }, careerHistory: {}, pp2EventCategory: cat };
  const prev = global.window; global.window = W;
  try { new Function('window', src)(W); } finally { if (prev === undefined) delete global.window; else global.window = prev; }
  return W.PlayerProfileV2._internals;
}

function build(dir, I) {
  const md = path.join(dir, 'splits-matches');
  const files = fs.readdirSync(md).filter(f => /^\d+\.json$/.test(f)).sort();
  const out = { career: {}, last52: {} };
  let players = 0;
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(md, f), 'utf8'));
    if (!d || !Array.isArray(d.matches)) continue;
    players++;
    const one = I.splTourRowsOf(d);
    for (const scope of ['career', 'last52']) {
      for (const [label, c] of Object.entries(one[scope])) {
        const a = out[scope][label] || (out[scope][label] = { players: 0 });
        if (c.n) a.players++;
        for (const [k, v] of Object.entries(c)) a[k] = (a[k] || 0) + (v || 0);
      }
    }
  }
  return { rows: out, players };
}

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || '.');
  const I = loadModule(path.join(__dirname, '..'));
  const { rows, players } = build(dir, I);
  const tf = path.join(dir, 'career-splits-tour.json');
  const tour = JSON.parse(fs.readFileSync(tf, 'utf8'));
  tour.rows = rows;
  tour.rowsMeta = { players, builtAt: new Date().toISOString(), rule: 'Σ counts over every tracked player\'s splits-matches rows, the profile\'s own row rules (splTourRowsOf)' };
  const tmp = tf + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(tour));
  fs.renameSync(tmp, tf);   // atomic
  const all = rows.career['All matches'] || {};
  console.log(`splits tour rows: ${players} players, ${Object.keys(rows.career).length} rows; career All matches n=${all.n}, ` +
    `win ${all.n ? (100 * all.w / all.n).toFixed(1) : '—'}%, hold ${all.sv ? (100 * all.held / all.sv).toFixed(1) : '—'}%`);
}
module.exports = { build, loadModule };
