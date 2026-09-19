#!/usr/bin/env node
/**
 * TEN-242 phase 2, item C3 — tournament quote importer.
 *
 * Reads the founder's quote sheet (CSV) and emits `tournament-quotes.json`
 * keyed by our catalog tournament name, plus a full import report.
 *
 * THIS IS A PIPELINE STEP, NOT A ONE-OFF PASTE. It is re-runnable, and every
 * row it does not import is named in the report with a reason. Nothing is
 * inferred, fuzzy-matched, or quietly dropped.
 *
 * THE SEVEN HAZARDS (brief C3), and what this does about each:
 *
 *  a) COLUMN 1 IS OVERLOADED — it carries tournament names in one stretch and
 *     YEARS in another. Parsed exactly as specified: a 4-digit value sets the
 *     current year; any other non-empty value sets the current tournament AND
 *     CLEARS the year; blank inherits both. A parser that treated column 1 as
 *     the tournament would mint tournaments called "2026".
 *
 *  b) NO YEAR IS NOT A YEAR. 248 of 450 rows have none. Never inferred, never
 *     backfilled, never defaulted. The attribution simply omits it (C4).
 *
 *  c) THE TEXT'S OWN PREFIX BEATS THE ROW GROUP. Where the text opens with an
 *     event marker that resolves to a DIFFERENT event than the group header,
 *     the row is NOT imported and goes to the conflicts list. We do not pick a
 *     winner and we do not strip the prefix and import it under the group.
 *
 *  d) NOT EVERY ROW IS A PLAYER QUOTE. Rows with no player cell never import.
 *     Rows whose player cell does not resolve to a known ATP player are flagged
 *     for review — under a card headed "What players say", a ball supplier
 *     renders as a person.
 *
 *  e) TOURNAMENT NAMES ARE SPONSOR NAMES. Resolved only through the explicit
 *     map. An unmapped name FAILS LOUDLY: it is reported and its rows are not
 *     imported. It never silently drops and never fuzzy-matches.
 *
 *  f) PLAYER NAMES ARE INCONSISTENT. Normalised against our roster where an
 *     unambiguous match exists; everything else keeps the source spelling and
 *     is reported. No guessing.
 *
 *  g) TEXT HYGIENE. Only two alterations are ever made, both recorded per row:
 *     unwrapping a value that is ENTIRELY wrapped in one pair of quotes (so the
 *     card does not double-wrap), and repairing the `\!` escape artefact.
 *     The words themselves are never touched.
 *
 * Usage:
 *   node tools/quotes/build-tournament-quotes.mjs [--csv path] [--out path]
 *        [--report path] [--roster path] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

const CSV = arg('csv', path.join(ROOT, 'data', 'tournament-quotes.csv'));
const OUT = arg('out', path.join(ROOT, 'tournament-quotes.json'));
const REPORT = arg('report', path.join(ROOT, 'tournament-quotes-report.md'));
const ROSTER = arg('roster', path.join(ROOT, 'player-profiles.json'));
const MAP = path.join(HERE, 'tournament-quote-map.json');

// ---------------------------------------------------------------- CSV
// RFC4180 enough for this sheet: quoted fields, doubled quotes, embedded
// newlines and commas. Hand-rolled because a dependency for one file in a
// zero-dep repo is a worse trade than 25 lines.
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------- hygiene (g)
const PAIRS = [['“', '”'], ['"', '"'], ['‘', '’'], ["'", "'"]];
function hygiene(raw) {
  const notes = [];
  let t = raw.replace(/\s+$/, '').replace(/^\s+/, '');
  if (/\\!/.test(t)) { t = t.replace(/\\!/g, '!'); notes.push('removed \\! escape artefact'); }
  // Unwrap ONLY when the whole value is one balanced quoted span. A value that
  // merely CONTAINS quoted speech ("X: \"...\" said Y.") is narration and is
  // left exactly as written — the card must not wrap that in curly quotes.
  for (const [o, c] of PAIRS) {
    if (t.length > 2 && t.startsWith(o) && t.endsWith(c)) {
      const inner = t.slice(1, -1);
      if (!inner.includes(o) && !inner.includes(c)) {
        t = inner.trim(); notes.push(`unwrapped outer ${o}${c}`); break;
      }
    }
  }
  return { text: t, notes };
}

// Does the value already carry its own quotation marks? The card uses this to
// decide whether to add curly quotes — see the report's "presentation" section.
const carriesOwnQuotes = (t) => /["“”]/.test(t);

// ---------------------------------------------------------------- roster (f)
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');

function loadRoster() {
  try {
    const raw = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
    const players = raw.players || raw;
    const bySurname = new Map(); const full = new Set();
    for (const k of Object.keys(players)) {
      const p = players[k]; const name = p && (p.name || p.fullName);
      if (typeof name !== 'string' || !name.trim()) continue;
      full.add(name.trim());
      // Index EVERY trailing-token suffix, not just the last token. Our roster
      // writes "A. de Minaur" and the sheet writes "De Minaur"; a last-token
      // index gives "minaur" and never matches. Suffixes give "minaur" AND
      // "deminaur", so compound surnames and particles resolve without any
      // fuzzy matching — it is still an exact comparison, just of the right
      // string. Same for Auger-Aliassime / "Aliassime" and Mpetshi Perricard.
      const toks = name.trim().split(/\s+/);
      for (let s = Math.max(1, toks.length - 3); s < toks.length; s++) {
        const key = norm(toks.slice(s).join(''));
        if (!key) continue;
        if (!bySurname.has(key)) bySurname.set(key, new Set());
        bySurname.get(key).add(name.trim());
      }
    }
    return { bySurname, full, n: full.size };
  } catch (e) { return { bySurname: new Map(), full: new Set(), n: 0, error: String(e.message || e) }; }
}
function resolvePlayer(cell, roster) {
  const raw = cell.trim();
  if (!raw) return { status: 'absent' };
  // exact full name
  for (const f of roster.full) if (norm(f) === norm(raw)) return { status: 'exact', name: f };
  // surname-only, or "X. Surname" / "X.Surname" -> unique roster surname.
  // The initial is only stripped when a DOT actually follows it. `\.?` made the
  // dot optional, which ate the first letter of every bare surname — "Medvedev"
  // became "edvedev" and nothing matched. Caught because 42 Medvedev rows
  // reported as unresolved people.
  const token = raw.replace(/^[A-Z]\.\s*/, '').trim() || raw;
  const cands = roster.bySurname.get(norm(token));
  if (cands && cands.size === 1) return { status: 'surname', name: [...cands][0] };
  if (cands && cands.size > 1) return { status: 'ambiguous', options: [...cands] };
  return { status: 'unmatched' };
}

// ---------------------------------------------------------------- main
const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const roster = loadRoster();
// A roster we could not read is not "0 matches" — it is a DIFFERENT ARTEFACT.
// The committed artefact was once built with a bad --roster path and shipped 425
// unmatched names; regenerating it in CI then changed 363 of them. Same commit,
// different names on screen. Fail rather than emit that quietly.
if (roster.error && !process.argv.includes('--allow-no-roster')) {
  console.error(`roster unreadable at ${ROSTER}: ${roster.error}\n` +
    `Player names would all keep their source spelling, so this build would NOT match\n` +
    `one made with the roster present. Pass --allow-no-roster only if that is intended.`);
  process.exit(3);
}
if (!fs.existsSync(CSV)) {
  console.error(`quote CSV not found at ${CSV}\n` +
    `Export the sheet as CSV to that path, or pass --csv. This step FAILS rather than\n` +
    `emitting an empty artefact: a silently empty quotes file would delete every card.`);
  process.exit(2);
}
const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
const body = rows.slice(1); // header

const PREFIX_RE = /^\s*([A-Z][A-Z\s.\-’'&,]{2,30}?)\s*:/;
const out = {};                       // canonical event -> [quote]
const R = {                           // the report
  rowsRead: body.length, candidates: 0,
  imported: 0, noPlayerCell: 0,
  unmappedGroup: new Map(), nullGroup: new Map(),
  unresolvedPrefix: new Map(), conflicts: [],
  nonPlayer: [], ambiguousPlayer: [], normalised: 0, keptSourceSpelling: 0, yearAsPlayer: [],
  altered: [], withYear: 0, withoutYear: 0, carriesOwnQuotes: 0,
  years: new Set(),
};
const bump = (m, k, row) => { if (!m.has(k)) m.set(k, []); m.get(k).push(row); };

let curT = null, curY = null;
for (let i = 0; i < body.length; i++) {
  const r = body[i], lineNo = i + 2;
  const c0 = (r[0] || '').trim(), pCell = (r[1] || '').trim(), tCell = (r[2] || '').trim();

  // (a) column 1 is overloaded
  if (/^\d{4}$/.test(c0)) { curY = c0; R.years.add(c0); }
  else if (c0) { curT = c0; curY = null; }

  if (!pCell && !tCell) continue;     // spacer row
  R.candidates++;

  // (d) no player cell -> never import
  if (!pCell) { R.noPlayerCell++; continue; }
  // ...and neither is a bare YEAR. Row 415's player cell is `2025` — the sheet
  // author shifted a year into the wrong column. Imported, it became the LEAD
  // quote on the Halle card, attributed to a person called "2025" with a 34px
  // avatar reading "2". Reporting it was not enough: a fabricated person is
  // exactly the class of thing that must never reach the screen.
  if (/^\d{4}$/.test(pCell)) { R.yearAsPlayer.push({ row: lineNo, cell: pCell }); continue; }

  // (e) the group must resolve through the explicit map
  if (!(curT in map.groups)) { bump(R.unmappedGroup, curT ?? '(none)', lineNo); continue; }
  const group = map.groups[curT];
  if (group === null) { bump(R.nullGroup, curT, lineNo); continue; }

  // (c) the text's own prefix beats the row group
  const m = PREFIX_RE.exec(tCell);
  if (m) {
    const token = m[1].trim();
    if (!(token in map.prefixes)) { bump(R.unresolvedPrefix, token, lineNo); continue; }
    const pref = map.prefixes[token];
    if (pref === null) { bump(R.unresolvedPrefix, token, lineNo); continue; }
    if (pref !== group) {
      R.conflicts.push({ row: lineNo, group, groupRaw: curT, prefix: pref, prefixRaw: token,
        player: pCell, text: tCell.slice(0, 160) });
      continue;                        // NOT imported, either way
    }
  }

  // (f) player normalisation
  const pr = resolvePlayer(pCell, roster);
  let player = pCell;
  if (pr.status === 'exact' || pr.status === 'surname') { player = pr.name; R.normalised++; }
  else if (pr.status === 'ambiguous') { R.ambiguousPlayer.push({ row: lineNo, cell: pCell, options: pr.options }); R.keptSourceSpelling++; }
  else { R.nonPlayer.push({ row: lineNo, cell: pCell, event: group }); R.keptSourceSpelling++; }

  // (g) hygiene
  const h = hygiene(tCell);
  if (h.notes.length) R.altered.push({ row: lineNo, notes: h.notes });
  if (carriesOwnQuotes(h.text)) R.carriesOwnQuotes++;

  if (curY) R.withYear++; else R.withoutYear++;

  (out[group] ||= []).push({
    player, playerRaw: pCell, playerMatch: pr.status,
    year: curY ? Number(curY) : null,     // (b) null is null. Never inferred.
    text: h.text,
    selfQuoted: carriesOwnQuotes(h.text), // the card must not double-wrap these
    sourceRow: lineNo,
  });
  R.imported++;
}

// ------------------------------------------------------------- write artefact
const events = Object.keys(out).sort();
for (const k of events) {
  // C5 PROPOSED ORDER (dull and checkable): most recent year first, undated
  // last, source-sheet order preserved inside each bucket. NOT implemented as a
  // display rule until the founder rules — this only fixes the array order so
  // the artefact is deterministic between runs.
  out[k].sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || a.sourceRow - b.sourceRow);
}
fs.writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  source: 'founder quote sheet (CSV export)',
  ordering: 'year desc, undated last, source order within a bucket (TEN-242 C5 — PROPOSED, awaiting ruling)',
  counts: { imported: R.imported, events: events.length },
  tournaments: out,
}, null, 2) + '\n');

// ------------------------------------------------------------- report
const catalog = (() => {
  try {
    const D = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8').split('\n');
    const a = D.findIndex((l) => /^const TOURNAMENT_CATALOG = \[/.test(l)); let b = a;
    for (; b < D.length; b++) if (/^];?\s*$/.test(D[b])) break;
    // eslint-disable-next-line no-eval
    return eval('(' + D.slice(a, b + 1).join('\n').replace(/^const \w+ =/, '').replace(/;\s*$/, '') + ')').map((t) => t.name);
  } catch { return []; }
})();

const L = [];
const p = (s = '') => L.push(s);
const tbl = (m, label) => { if (!m.size) { p(`_none_`); return; }
  p(`| ${label} | rows | source lines |`); p('|---|---:|---|');
  for (const [k, v] of [...m.entries()].sort((x, y) => y[1].length - x[1].length))
    p(`| \`${k}\` | ${v.length} | ${v.slice(0, 8).join(', ')}${v.length > 8 ? ' …' : ''} |`); };

p('# Tournament quote import — report');
p('');
p(`Generated \`${new Date().toISOString()}\` by \`tools/quotes/build-tournament-quotes.mjs\`.`);
p('');
p('## Headline');
p('');
p('| | |');
p('|---|---:|');
p(`| Rows read (excl. header) | ${R.rowsRead} |`);
p(`| Candidate records (player or text present) | ${R.candidates} |`);
p(`| **Imported** | **${R.imported}** |`);
p(`| Events with at least one quote | ${events.length} |`);
p(`| Events in our catalog with NO quote (no card) | ${catalog.length ? catalog.length - events.filter((e) => catalog.includes(e)).length : 'n/a'} |`);
p(`| Dated / undated | ${R.withYear} / ${R.withoutYear} |`);
p(`| Years present in the sheet | ${[...R.years].sort().join(', ')} |`);
p('');
p('## Not imported, and why');
p('');
p('| reason | rows |');
p('|---|---:|');
p(`| No player cell (rule d) | ${R.noPlayerCell} |`);
p(`| **Player cell is a bare YEAR — never a person** | **${R.yearAsPlayer.length}** |`);
p(`| Group name not in the map — FAILS LOUDLY (rule e) | ${[...R.unmappedGroup.values()].reduce((a, b) => a + b.length, 0)} |`);
p(`| Group known but deliberately not importable | ${[...R.nullGroup.values()].reduce((a, b) => a + b.length, 0)} |`);
p(`| Text prefix unresolved | ${[...R.unresolvedPrefix.values()].reduce((a, b) => a + b.length, 0)} |`);
p(`| **Prefix/group conflict (rule c)** | **${R.conflicts.length}** |`);
p('');
p('### Unmapped group names — these FAIL LOUDLY');
tbl(R.unmappedGroup, 'group name');
p('');
p('### Known groups deliberately held out');
tbl(R.nullGroup, 'group name');
p('');
for (const [k, v] of R.nullGroup) if (map.groupNotes?.[k]) p(`- \`${k}\` — ${map.groupNotes[k]}`);
p('');
p('### Unresolved text prefixes');
tbl(R.unresolvedPrefix, 'prefix');
p('');
for (const [k] of R.unresolvedPrefix) if (map.prefixNotes?.[k]) p(`- \`${k}\` — ${map.prefixNotes[k]}`);
p('');
p('### Prefix/group conflicts — for you to resolve, not me');
p('');
if (!R.conflicts.length) p('_none_');
else {
  p('| row | filed under | text says | player | opening text |');
  p('|---:|---|---|---|---|');
  for (const c of R.conflicts)
    p(`| ${c.row} | ${c.group} (\`${c.groupRaw}\`) | **${c.prefix}** | ${c.player} | ${c.text.replace(/\|/g, '\\|').slice(0, 110)}… |`);
}
p('');
p('## People');
p('');
p(`- Normalised against our roster (${roster.n} players${roster.error ? ' — ROSTER UNREADABLE: ' + roster.error : ''}): **${R.normalised}**`);
p(`- Kept the source spelling (unmatched or ambiguous): **${R.keptSourceSpelling}**`);
p('');
p('### Player cells that did not resolve — check these are people (rule d)');
p('');
if (!R.nonPlayer.length) p('_none_');
else {
  const byCell = new Map();
  for (const x of R.nonPlayer) { if (!byCell.has(x.cell)) byCell.set(x.cell, []); byCell.get(x.cell).push(x.row); }
  p('| player cell | rows | source lines |'); p('|---|---:|---|');
  for (const [k, v] of [...byCell.entries()].sort((a, b) => b[1].length - a[1].length))
    p(`| \`${k}\` | ${v.length} | ${v.slice(0, 6).join(', ')}${v.length > 6 ? ' …' : ''} |`);
}
p('');
if (R.ambiguousPlayer.length) {
  p('### Ambiguous surnames (more than one roster match) — source spelling kept');
  p('');
  p('| row | cell | roster candidates |'); p('|---:|---|---|');
  for (const x of R.ambiguousPlayer.slice(0, 40)) p(`| ${x.row} | \`${x.cell}\` | ${x.options.join(' · ')} |`);
  p('');
}
p('## Text alterations');
p('');
p(`Only two alterations are ever made, and every one is listed. The WORDS are never touched.`);
p('');
if (!R.altered.length) p('_none_');
else { p('| row | what changed |'); p('|---:|---|'); for (const a of R.altered.slice(0, 60)) p(`| ${a.row} | ${a.notes.join('; ')} |`); }
p('');
p(`**${R.carriesOwnQuotes} of ${R.imported}** imported values already contain their own quotation marks — they are narration around reported speech, not clean quotations. Flagged per record as \`selfQuoted\`. See the report's presentation note.`);
p('');
p('## Quotes per event');
p('');
p('| event | quotes | dated | undated |');
p('|---|---:|---:|---:|');
for (const e of events.sort((a, b) => out[b].length - out[a].length))
  p(`| ${e} | ${out[e].length} | ${out[e].filter((q) => q.year).length} | ${out[e].filter((q) => !q.year).length} |`);
p('');
if (catalog.length) {
  const none = catalog.filter((c) => !events.includes(c));
  p(`## Events with no quotes — **${none.length}** of ${catalog.length} get NO card`);
  p('');
  p(none.map((n) => `\`${n}\``).join(' · '));
}
p('');
fs.writeFileSync(REPORT, L.join('\n'));

// (e) UNMAPPED NAMES MUST ACTUALLY FAIL. The map file promises they "FAIL
// LOUDLY", but loudness that lives only in a markdown file CI throws away is not
// loudness: the founder renames a sponsor in the sheet, every quote for that
// event silently vanishes, and the deploy stays green. Non-zero exit is the only
// signal a pipeline step can actually carry.
if (R.unmappedGroup.size) {
  console.error(`UNMAPPED tournament name(s) — nothing was imported for these:`);
  for (const [k, v] of R.unmappedGroup) console.error(`  "${k}"  (${v.length} row(s), lines ${v.slice(0, 6).join(', ')})`);
  console.error(`Add each to tools/quotes/tournament-quote-map.json. Never fuzzy-match.`);
  process.exit(4);
}

if (process.argv.includes('--json')) console.log(JSON.stringify({ imported: R.imported, events: events.length, conflicts: R.conflicts.length }, null, 2));
else {
  console.log(`imported ${R.imported} of ${R.candidates} candidate rows into ${events.length} event(s)`);
  console.log(`  no player cell        ${R.noPlayerCell}`);
  console.log(`  unmapped group        ${[...R.unmappedGroup.values()].reduce((a, b) => a + b.length, 0)}  (${[...R.unmappedGroup.keys()].join(', ') || 'none'})`);
  console.log(`  held-out group        ${[...R.nullGroup.values()].reduce((a, b) => a + b.length, 0)}`);
  console.log(`  unresolved prefix     ${[...R.unresolvedPrefix.values()].reduce((a, b) => a + b.length, 0)}`);
  console.log(`  prefix/group CONFLICT ${R.conflicts.length}`);
  console.log(`report -> ${REPORT}`);
  console.log(`artefact -> ${OUT}`);
}
