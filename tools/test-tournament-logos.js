#!/usr/bin/env node
// tools/test-tournament-logos.js — the self-hosted ATP tournament logos (.claude/rules/tournament-logos.md).
// What must hold:
//   1. every index entry names a stored WebP in tournament-logos/, and its ?v= hash is that file's own sha1 (cache-buster);
//   2. no stray file: every .webp is named by the index;
//   3. no two events share one file (or one source image) unless the map declares them the same event (sameAs);
//   4. no placeholder: every file is a real WebP of sane size, and its source logo NAMES the event (logo-map match words);
//   5. every index key is a label of the curated map, every map label is in the index (logo) or `missing` (with reason);
//   6. the map covers exactly the Database's tournament labels (TOURN_SPLIT / TOURN_COMMON over the committed
//      database-yield.json meta.tournaments) — SKIPPED out loud when the dashboard holds no such tables;
//   7. publish ships the folder (tools/site-code.sh) and no page requests atptour.com for a logo.
// Each check is run against a mutant that must fail it.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'tournament-logos');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '\n       ' + detail : '')); } };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

function check(idx, map, files) {
  const errs = [];
  const fileOf = (v) => String(v).split('?')[0];
  for (const [label, v] of Object.entries(idx.logos || {})) {
    const f = fileOf(v), buf = files[f];
    if (!buf) { errs.push(`${label}: file ${f} missing`); continue; }
    const h = (String(v).split('?v=')[1] || '');
    if (!h || crypto.createHash('sha1').update(buf).digest('hex').slice(0, h.length) !== h) errs.push(`${label}: ?v= hash is not the file's`);
    if (buf.length < 200 || buf.slice(0, 4).toString() !== 'RIFF' || buf.slice(8, 12).toString() !== 'WEBP') errs.push(`${label}: ${f} is not a real WebP`);
    const e = map.events[label];
    if (!e) { errs.push(`${label}: not a map label`); continue; }
    const src = (idx.sources || {})[label] || {};
    const owner = e.sameAs ? map.events[e.sameAs] : e;
    if (e.sameAs && fileOf(idx.logos[e.sameAs] || '') !== f) errs.push(`${label}: sameAs ${e.sameAs} but a different file`);
    if (!owner || !(owner.match || []).some((w) => norm(src.alt).includes(norm(w)) || norm(path.basename(String(src.src || '').split('?')[0])).includes(norm(w))))
      errs.push(`${label}: its source logo ("${src.alt}", ${src.src}) does not name the event`);
  }
  const named = new Set(Object.values(idx.logos || {}).map(fileOf));
  for (const f of Object.keys(files)) if (!named.has(f)) errs.push(`stray file ${f}`);
  const byFile = {}, bySrc = {};
  for (const [label, v] of Object.entries(idx.logos || {})) {
    const root = (map.events[label] || {}).sameAs || label;
    const f = fileOf(v); if (byFile[f] && byFile[f] !== root) errs.push(`${label} and ${byFile[f]} share ${f}`); byFile[f] = root;
    const s = ((idx.sources || {})[label] || {}).srcSha1; if (s) { if (bySrc[s] && bySrc[s] !== root) errs.push(`${label} and ${bySrc[s]} share one source image`); bySrc[s] = root; }
  }
  for (const label of Object.keys(map.events)) if (!(idx.logos || {})[label] && !(idx.missing || {})[label]) errs.push(`${label}: neither a logo nor a reason`);
  for (const label of Object.keys(idx.missing || {})) if ((idx.logos || {})[label]) errs.push(`${label}: both a logo and missing`);
  return errs;
}

const idx = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'tournament-logos', 'logo-map.json'), 'utf8'));
const files = Object.fromEntries(fs.readdirSync(DIR).filter((f) => f.endsWith('.webp')).map((f) => [f, fs.readFileSync(path.join(DIR, f))]));
const errs = check(idx, map, files);
ok(`the published index: ${Object.keys(idx.logos).length} of ${Object.keys(map.events).length} events with a logo, every rule holds`, errs.length === 0, errs.slice(0, 8).join('\n       '));
ok('at least the four reference events have a logo (Australian Open, Wimbledon, Shanghai, Chengdu)', ['Australian Open', 'Wimbledon', 'Shanghai', 'Chengdu'].every((l) => idx.logos[l]));

// mutants: each must be caught
const clone = (o) => JSON.parse(JSON.stringify(o));
const someLabel = Object.keys(idx.logos).find((l) => !map.events[l].sameAs), other = Object.keys(idx.logos).find((l) => l !== someLabel && !map.events[l].sameAs);
const M = [
  ['an entry pointing at a missing file', () => { const i = clone(idx); i.logos[someLabel] = 'nope-1.webp?v=abc'; return [i, map, files]; }],
  ['a stale ?v= hash', () => { const i = clone(idx); i.logos[someLabel] = i.logos[someLabel].split('?')[0] + '?v=0000000000'; return [i, map, files]; }],
  ['two events sharing one file', () => { const i = clone(idx); i.logos[other] = i.logos[someLabel]; i.sources[other] = { ...i.sources[someLabel] }; return [i, map, files]; }],
  ['a placeholder that is not a WebP', () => { const f = { ...files }; const k = idx.logos[someLabel].split('?')[0]; f[k] = Buffer.from('<html>blocked</html>'.repeat(20)); return [idx, map, f]; }],
  ['another event\'s logo (source names a different city)', () => { const i = clone(idx); i.sources[someLabel] = { ...i.sources[someLabel], alt: 'Some Other Open', src: '/x/othercity_logo.png' }; return [i, map, files]; }],
  ['a stray file', () => [idx, map, { ...files, 'stray-1.webp': files[idx.logos[someLabel].split('?')[0]] }]],
  ['a map label with neither logo nor reason', () => { const i = clone(idx); delete i.missing[Object.keys(i.missing)[0] || '']; const m = clone(map); m.events['Nowhere Open'] = { pages: [], match: ['nowhere'] }; return [i, m, files]; }],
];
for (const [name, mk] of M) ok(`MUTANT caught: ${name}`, check(...mk()).length > 0);

// 6. the map covers exactly the Database's labels
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const grab = (name) => { const m = new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\n  \\});').exec(html); return m ? Function('return ' + m[1])() : null; };
const SPLIT = grab('TOURN_SPLIT'), COMMON = grab('TOURN_COMMON');
let dy = null; try { dy = JSON.parse(fs.readFileSync(path.join(ROOT, 'database-yield.json'), 'utf8')); } catch {}
if (!SPLIT || !COMMON || !dy) console.log('  SKIP map = the Database labels: dashboard tables or database-yield.json not readable here');
else {
  const labels = new Set(dy.meta.tournaments.map((t) => SPLIT[t] || COMMON[t] || t));
  const extra = [...labels].filter((l) => !map.events[l]);
  ok(`every Database tournament label (${labels.size}) is in the map`, extra.length === 0, 'unmapped: ' + extra.join(', '));
}

// 7. shipped, and never fetched from ATP at run time
const sc = fs.readFileSync(path.join(ROOT, 'tools', 'site-code.sh'), 'utf8');
ok('tools/site-code.sh ships tournament-logos/', /cp -r tournament-logos "\$SITE\/"/.test(sc));
ok('no page requests atptour.com for a tournament logo', !/atptour\.com[^"'\s]*atp-tournaments\/logos/.test(html));

console.log(`\ntournament logos: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
