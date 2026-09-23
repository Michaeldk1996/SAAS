#!/usr/bin/env node
// TEN-260 Part B — the Lines tab's FIELD, precomputed in the pipeline.
//
// Writes lines-field.json: for every format × surface × period × line, the SORTED
// coverage rates of every roster player with at least LN_MIN_N (5) matches on that
// line at that slice. The page reads it for Field (median), Vs field (rate − median)
// and Ranking (1 + rates strictly above / field size). Approved as "Option A" on
// TEN-256 item 5: one lazy ~36 KiB-gzip file instead of 225 shard fetches in the
// browser.
//
// ONE DEFINITION OF A RATE. This file does not re-implement the line rules. It
// SLICES them out of bsp-consult-dashboard.html (LN_LADDERS, lnPartition, lnFormat,
// lnHit, lnLine, lnPools, lnRate, ...) and runs them, so the rate a member sees for
// his player and the field that rate is ranked in cannot drift apart. If a function
// it needs is renamed, this throws instead of silently using a stale copy.
//
// Inputs, exactly the ones the page joins on:
//   surface-ratings.json  the roster the Lines picker searches (name only)
//   retired-players.json  names in `retired[]` are NOT in the field (TEN-262 ruling 6):
//                         they leave Field, Vs field, Ranking and every "N of M".
//                         A missing or unreadable list fails the build - it is
//                         never read as "nobody retired".
//   player-profiles.json  name -> profile key, EXACT name match (lnKeyForName)
//   career-history-index.json + career-history/<key>.json   the match rows
//
// Usage:
//   node build-lines-field.js                 # pipeline: read the files in cwd
//   node build-lines-field.js --from <url>    # dev/measurement: read a deployed site
//   --out <path> (default lines-field.json)   --cutoff YYYY-MM-DD (default today − 364d)
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FROM = opt('--from', null);
const OUT = opt('--out', 'lines-field.json');
const HTML = opt('--html', path.join(__dirname, 'bsp-consult-dashboard.html'));

// ── slice the page's own line logic ──────────────────────────────────────────
function fnSource(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' is gone from the dashboard — the field would be computed by a rule the page no longer uses');
  const nl = src.indexOf('\n', i);
  const oneLine = src.slice(i, nl < 0 ? src.length : nl);
  if ((oneLine.match(/\{/g) || []).length === (oneLine.match(/\}/g) || []).length && oneLine.trimEnd().endsWith('}')) return oneLine;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}
function varSource(src, name) {
  const m = new RegExp('var\\s+' + name + '\\s*=\\s*').exec(src);
  if (!m) throw new Error('var ' + name + ' is gone from the dashboard');
  const start = m.index, open = m.index + m[0].length;
  const oc = src[open], cc = oc === '{' ? '}' : oc === '[' ? ']' : null;
  if (!cc) { const end = src.indexOf(';', open); return src.slice(start, end + 1); }
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === oc) depth++;
    else if (src[k] === cc) { depth--; if (!depth) return src.slice(start, k + 1) + ';'; }
  }
  throw new Error('unbalanced slicing ' + name);
}
function loadLineLogic(htmlSrc, cutoff) {
  let code = '';
  for (const v of ['LN_LADDERS', 'LN_GROUPS', 'LN_MIN_N']) code += varSource(htmlSrc, v) + '\n';
  for (const f of ['lnCutoff', 'lnPartition', 'lnFormat', 'lnHit', 'lnLine', 'lnPools', 'lnRate', 'lnRound3']) code += fnSource(htmlSrc, f) + '\n';
  // lnCutoff() prefers LNF.l52Cutoff - hand it THIS build's cutoff, which is the
  // value the page will then read back out of the file.
  const fn = new Function('LNF', code + '\nreturn {LN_LADDERS, LN_GROUPS, LN_MIN_N, lnCutoff, lnPools, lnLine, lnRate, lnRound3};');
  return fn({ l52Cutoff: cutoff });
}

// ── inputs ──────────────────────────────────────────────────────────────────
async function readJson(rel) {
  if (FROM) {
    const r = await fetch(FROM.replace(/\/?$/, '/') + rel, { cache: 'no-store' });
    if (r.status === 404) return undefined;
    if (!r.ok) throw new Error(rel + ' HTTP ' + r.status);
    return r.json();
  }
  if (!fs.existsSync(rel)) return undefined;
  return JSON.parse(fs.readFileSync(rel, 'utf8'));
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function main() {
  const cutoff = opt('--cutoff', new Date(Date.now() - 364 * 864e5).toISOString().slice(0, 10));
  const L = loadLineLogic(fs.readFileSync(HTML, 'utf8'), cutoff);
  if (L.lnCutoff() !== cutoff) throw new Error('the sliced lnCutoff does not honour the file cutoff');

  const ratings = await readJson('surface-ratings.json');
  const profiles = await readJson('player-profiles.json');
  const index = await readJson('career-history-index.json');
  if (!ratings || !Array.isArray(ratings.players) || !ratings.players.length) throw new Error('surface-ratings.json missing or empty');
  if (!profiles || !profiles.players) throw new Error('player-profiles.json missing');
  if (!index || !index.players || !Object.keys(index.players).length) throw new Error('career-history-index.json missing or empty — the field would be built from nothing');

  // name -> key, EXACTLY as lnKeyForName does it: first profile whose `name`
  // equals the roster string. A fuzzy join would attach one player's games to
  // another's rate - the TEN-121 collision class.
  const byName = {};
  for (const k of Object.keys(profiles.players)) {
    const p = profiles.players[k];
    if (p && p.name != null && !(p.name in byName)) byName[p.name] = String(k);
  }
  const retiredFile = await readJson('retired-players.json');
  if (!retiredFile || !Array.isArray(retiredFile.retired)) throw new Error('retired-players.json missing or has no retired[] — the field would silently include retired players');
  const retiredSet = new Set(retiredFile.retired.map(r => r && r.name).filter(Boolean));
  const retiredExcluded = ratings.players.map(p => p.name).filter(nm => retiredSet.has(nm));
  const roster = ratings.players.map(p => p.name).filter(nm => !retiredSet.has(nm));
  const unresolved = roster.filter(nm => !byName[nm]);
  const resolved = roster.filter(nm => byName[nm]);

  // Shards. A player the index does not name HAS no rows (answered); a shard that
  // fails to load is a build failure, not a player with zero matches - one
  // silently missing player shifts every median and every rank.
  let failed = [];
  const rowsByName = {};
  await pool(resolved, 8, async (nm) => {
    const k = byName[nm];
    if (!index.players[k]) { rowsByName[nm] = []; return; }
    try {
      const d = await readJson('career-history/' + k + '.json');
      if (!d || !Array.isArray(d.matches)) throw new Error('no matches array');
      rowsByName[nm] = d.matches;
    } catch (e) { failed.push(nm + ' (' + e.message + ')'); }
  });
  if (failed.length) throw new Error(failed.length + ' career-history shard(s) failed: ' + failed.slice(0, 5).join('; '));

  const SURF = ['All', 'Hard', 'Clay', 'Grass'], SCOPE = ['career', 'l52'], FMT = ['bo3', 'bo5'];
  const slices = {}; let lines = 0, emptyLines = 0;
  for (const surf of SURF) for (const scope of SCOPE) {
    const pools = resolved.map(nm => L.lnPools(rowsByName[nm] || [], surf, scope));
    for (const fmt of FMT) {
      const key = fmt + '|' + surf + '|' + scope, sl = {};
      for (const grp of L.LN_GROUPS) for (const spec of (L.LN_LADDERS[fmt][grp] || [])) {
        const rates = [];
        for (const P of pools) {
          const r = L.lnRate(L.lnLine(P.byFmt[fmt], spec[1], spec[2]));
          if (r != null) rates.push(L.lnRound3(r));
        }
        rates.sort((a, b) => a - b);
        sl[spec[0]] = rates; lines++; if (!rates.length) emptyLines++;
      }
      slices[key] = sl;
    }
  }

  const out = {
    _doc: 'TEN-260 Part B. Sorted coverage rates (percent, 3dp) per format|surface|period and line, over every roster player with >= minN matches on that line at that slice. Built by build-lines-field.js from the dashboard\'s own line functions. Field = median, Vs field = rate - median, Ranking = 1 + rates strictly above / field size.',
    builtAt: new Date().toISOString(),
    l52Cutoff: cutoff,
    minN: L.LN_MIN_N,
    source: { rosterSize: roster.length, resolved: resolved.length, unresolved, shardless: resolved.filter(nm => !(rowsByName[nm] || []).length).length,
              storeSize: ratings.players.length, retiredExcluded },
    slices,
  };
  const body = JSON.stringify(out);
  fs.writeFileSync(OUT, body);
  const gz = require('zlib').gzipSync(body).length;
  const sizes = Object.values(slices).flatMap(sl => Object.values(sl).map(a => a.length)).sort((a, b) => a - b);
  console.log(`lines-field: ${lines} line slices (${emptyLines} empty) · roster ${roster.length} (${retiredExcluded.length} retired excluded of ${ratings.players.length} stored), resolved ${resolved.length}, unresolved ${unresolved.length} · field size min ${sizes[0]} / median ${sizes[sizes.length >> 1]} / max ${sizes[sizes.length - 1]} · ${body.length} B raw, ${gz} B gzip → ${OUT}`);
}

if (require.main === module) main().catch(e => { console.error('build-lines-field FAILED:', e.message); process.exit(1); });
module.exports = { loadLineLogic, fnSource, varSource };
