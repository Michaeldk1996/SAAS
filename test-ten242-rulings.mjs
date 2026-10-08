// TEN-242 — the founder's phase-1 rulings, encoded so they cannot silently regress.
//
// Three rulings were made on gate `ten242:phase1:feasibility:v1` (2026-09-19),
// each resolving a real contradiction between the Claude Design handoff bundle
// and code that was already shipping. A ruling that lives only in a comment is
// one clobber away from gone (see test-ten225-no-underway-chip.mjs for how that
// actually happened), so each is a TEXT assertion here: decidable from the
// source alone, on any board, at any hour, with no data and no browser.
//
//   1. SPEED BAND WORD  -> courtSpeedCategory() in bsp-pipeline.js is the single
//      truth. README §2.2's four bands (>=1.10 Fast / >=0.95 Medium / >=0.82
//      Medium-slow / else Slow) are OVERRULED. Measured before the ruling: the
//      README's word disagreed with courtSpeedCategory() on 4 of 64 venues and
//      with the word we shipped on 12 of 64 — including the Australian Open,
//      which would have printed "Medium" directly above a Conditions-read
//      paragraph describing a fast court.
//
//   2. DENOMINATORS -> all five figures render BARE, per the Tournaments README,
//      not with an n per STENNISFY-DESIGN-INSTRUCTIONS §5. The §5 sample gate
//      stays in the code. Measured: 61 events, min n=51, median 596, so the gate
//      never fires today — which is exactly why it needs a test, not a reader.
//
//   3. FABRICATED ZERO -> build-entry-lists-advance.mjs must not mint `ALT: 0`
//      on a tournament whose list was never fetched, and validate() must police
//      ALT alongside MD and Q.
//
// Run: node --test test-ten242-rulings.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASH = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const PIPE = readFileSync(join(HERE, 'bsp-pipeline.js'), 'utf8');
const ADV = readFileSync(join(HERE, 'tools/entry-lists/build-entry-lists-advance.mjs'), 'utf8');

// A comment-free view of the source. EVERY "this string must not appear"
// assertion below runs against CODE, never against prose: this repo documents
// the thing it removed, by design (the removal comment names the ladder it
// overruled, and the detail renderer explains why the AO would have read
// "Medium"). Matching raw text would make each of those comments fail the very
// rule it records — which cost three iterations of this file to learn.
function code(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')        // HTML comments
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
    .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
}
const DASH_CODE = code(DASH);

// Pull an object/array literal out of a source file by brace matching from its
// `const NAME =` line. Deliberately NOT an import: both files are browser/CJS
// sources, and the point is to read what SHIPS.
function literal(src, re) {
  const L = src.split('\n');
  const i = L.findIndex((l) => re.test(l));
  assert.ok(i >= 0, `literal not found: ${re}`);
  let j = i;
  for (; j < L.length; j++) if (/^];?\s*$/.test(L[j]) || /^};\s*$/.test(L[j])) break;
  return eval('(' + L.slice(i, j + 1).join('\n').replace(/^const \w+ =/, '').replace(/;\s*$/, '') + ')');
}

// ---------------------------------------------------------------- RULING 1
test('ruling 1: the hero band word derives from courtSpeedCategory(), not the README ladder', () => {
  assert.match(PIPE, /function courtSpeedCategory\(speed\)/,
    'courtSpeedCategory() is the ruled single source of truth and must exist in the pipeline');

  // The Tournaments detail column must read speedCat (courtSpeedCategory's output
  // via tourxConditionRegistry), NOT a locally re-derived ladder.
  const detail = DASH.slice(DASH.indexOf('function tourxConditionsPanelHtml()'),
                            DASH.indexOf('function tourxRankLineHtml'));
  assert.ok(detail.length > 500, 'could not isolate the detail-column renderer');
  assert.match(detail, /const bandWord = c\.speedCat/,
    'the hero word must come from c.speedCat (courtSpeedCategory), not a local threshold');

  // and the README's ladder must not be reintroduced anywhere on the page.
  assert.ok(!/Medium-slow/.test(DASH_CODE),
    'README §2.2\'s "Medium-slow" band is OVERRULED — it must not be rendered by the build');
  assert.ok(!/as >= 1\.05 \? 'Fast'/.test(DASH_CODE),
    'the old 3-band asLabel ladder (>=1.05) must not come back either');
  assert.ok(!/1\.10 \? 'Fast'/.test(DASH_CODE) && !/0\.82 \? /.test(DASH_CODE),
    'the README\'s four-band thresholds must not be re-implemented');
});

test('ruling 1: courtSpeedCategory() still partitions all 64 rated venues into 3 bands', () => {
  // A band word the page prints for an event it cannot classify would be a
  // fabricated label. Every rated venue must classify.
  const CC = literal(PIPE, /^const COURT_CONDITIONS = \{/);
  const names = Object.keys(CC);
  assert.equal(names.length, 64, 'the rated-venue table changed size — re-measure before trusting the bands');
  const band = (sp) => (sp == null ? null : sp <= 43 ? 'Slow' : sp <= 68 ? 'Medium' : 'Fast');
  const words = new Set(names.map((n) => band(CC[n].speed)));
  assert.deepEqual([...words].sort(), ['Fast', 'Medium', 'Slow']);
  assert.ok(!names.some((n) => band(CC[n].speed) == null), 'every rated venue must get a word');
});

test('the court-speed table has ONE source: the two copies must stay identical', () => {
  // COURT_CONDITIONS is hand-mirrored into the dashboard. Sync was a comment
  // ("keep in sync"), not a mechanism — and it is the number the whole page is
  // about. Feasibility item (d).
  const A = literal(PIPE, /^const COURT_CONDITIONS = \{/);
  const B = literal(DASH, /^const COURT_CONDITIONS = \{/);
  assert.deepEqual(Object.keys(A).sort(), Object.keys(B).sort(), 'venue sets have drifted apart');
  for (const k of Object.keys(A)) {
    assert.deepEqual(B[k], A[k], `COURT_CONDITIONS["${k}"] differs between bsp-pipeline.js and the dashboard`);
  }
});

// ---------------------------------------------------------------- RULING 2
test('ruling 2: the five figures render bare, and the §5 sample gate survives', () => {
  const roi = DASH.slice(DASH.indexOf('function tourxRoiPairHtml'), DASH.indexOf('function tourxReliabilityHtml'));
  const rel = DASH.slice(DASH.indexOf('function tourxReliabilityHtml'), DASH.indexOf('function tourxReportCtaHtml'));
  assert.ok(roi.length > 300 && rel.length > 300, 'could not isolate the ROI / reliability renderers');
  for (const [name, body] of [['ROI', roi], ['reliability', rel]]) {
    assert.ok(!/n\s*=\s*\$\{/.test(body) && !/'n='/.test(body) && !/"n="/.test(body),
      `${name} must render a BARE percentage — the founder ruled against an inline n`);
  }
  // The gate is not decoration: it is the only thing between a thin future event
  // and a confident-looking percentage, so it must still be wired, not deleted.
  assert.match(DASH, /function tourxSampleGate\(n\)/, '§5 sample gate must remain in the build');
  assert.match(roi, /tourxSampleGate\(/, 'the ROI cards must still consult the gate');
  assert.match(rel, /tourxSampleGate\(/, 'reliability must still consult the gate');
});

test('the four prototype scaffolding formulas are absent (no fallback can emit a plausible number)', () => {
  // README: roiFav/roiDog/favRel/upsetRate are derived from court speed purely so
  // the mock stays self-consistent. A fallback formula standing in for a query is
  // the single worst failure available on this page.
  for (const f of ['roiFav', 'roiDog', 'favRel', 'upsetRate']) {
    assert.ok(!new RegExp(`(const|let|var|function)\\s+${f}\\b`).test(DASH_CODE),
      `${f} must not exist as a computed value anywhere in the build`);
  }
  assert.ok(!/\(1\.20 - speed\)|\(speed - 1\.00\) \* 8|62 \+ \(speed - 0\.70\)|\(1\.50 - speed\) \* 30/.test(DASH_CODE),
    'a prototype speed-derived formula body is present in the build');
});

// ---------------------------------------------------------------- RULING 3
test('ruling 3: a never-fetched entry list mints no ALT zero, and the gate polices it', () => {
  assert.match(ADV, /counts:\s*\{\s*MD:\s*null,\s*Q:\s*null,\s*ALT:\s*null\s*\}/,
    'the pending base object must carry ALT: null — ALT: 0 was a fabricated count on 25 of 71 rows');
  assert.ok(!/counts:\s*\{\s*MD:\s*null,\s*Q:\s*null,\s*ALT:\s*0\s*\}/.test(ADV),
    'ALT: 0 has come back in the pending base object');
  assert.match(ADV, /c\.MD !== null \|\| c\.Q !== null \|\| c\.ALT !== null/,
    'validate() must police ALT alongside MD and Q — checking only two of three is how this shipped');
});

test('the entry-list renderer tells a real zero apart from no data', () => {
  // The other direction of item 6.3: `alt || '—'` dashed a TRUE zero (a loaded
  // event with no alternates) exactly as if we had never fetched it.
  assert.match(DASH, /function countCell\(v\)/, 'the count cell helper must exist');
  const cell = DASH.slice(DASH.indexOf('function countCell(v)'), DASH.indexOf('function renderTournament'));
  assert.match(cell, /var isNull = \(v == null\)/, 'null, not falsiness, must decide the dash');
  assert.ok(!/\balt \|\| '—'\b/.test(DASH_CODE), 'the falsy-collapse that dashed a true zero has come back');
});

// ------------------------------------------------------------- brief items
// SUPERSEDED count: TEN-286 locked design/reference/portal-12a.html, whose nav carries Dropping Odds between
// Trading Report and Series; TEN-294 (founder, 2026-09-26) builds that page. Entry Lists stays removed.
test('item 1.1/1.4: the sidebar is the 12a portal\'s 12 items, in order', () => {
  const navStart = DASH.indexOf('<nav class="sf-nav" id="mainNav">');
  const nav = DASH.slice(navStart, DASH.indexOf('</nav>', navStart));
  const labels = [...nav.matchAll(/<button[^>]*data-tab="([^"]+)"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/button>/g)]
    .map((m) => m[2].trim());
  assert.deepEqual(labels, ['Matches', 'Live', 'Trading Report', 'Dropping Odds', 'Series', 'Players', 'Head to Head',
    'Tournaments', 'Database', 'Stennisfy Model', 'Playing Styles', 'News']);
  // match a real BUTTON, not any mention: the comment that replaced the item
  // names the alias on purpose, and a comment is not a nav item.
  assert.ok(!/<button[^>]*data-tab="entry-lists"/.test(nav), 'Entry Lists must not be a sidebar item');
  assert.ok(!/entryListsTabBtn/.test(DASH_CODE), 'the removed button\'s id must not be referenced in code');
});

test('item 1.3: the entry-lists alias still routes rather than 404ing', () => {
  // There was never a URL for this page, so nothing can 404 — but a residual
  // .click() dispatch must still land somewhere real.
  assert.match(DASH, /\(tab === 'entry-lists'\) \? 'tournaments'/,
    'data-tab="entry-lists" must alias onto the Tournaments page');
  assert.match(DASH, /if \(tab === 'entry-lists'\) \{ showTournamentList\(\); tourxSetSection\('entry'\); \}/,
    'the alias must select the Entry list section');
});

test('phase 2 C2: the quotes card renders ONLY when quotes exist — never a placeholder', () => {
  // SUPERSEDES the phase-1 guard "What players say is not built". Phase 1 had no
  // quote source; phase 2 imported 425 of them from the founder's sheet. The
  // invariant that survives is the one that always mattered: nothing on this page
  // may imply quotes exist for an event that has none. 19 of our 64 rated events
  // have none and must show no card at all.
  assert.match(DASH, /function tourxQuotesCardHtml\(c\)\{/);
  const card = DASH.slice(DASH.indexOf('function tourxQuotesCardHtml(c){'),
                          DASH.indexOf('function tourxQuotesPanelHtml'));
  assert.match(card, /if \(!list\) return '';/,
    'no quotes must return an EMPTY STRING — an empty node would still occupy the column gap');
  const cardCode = code(card);
  assert.ok(!/coming soon|not yet|no quotes|placeholder/i.test(cardCode),
    'no empty state, no "coming soon", nothing that implies the data exists');

  // FOUNDER RULING: render VERBATIM; curly-wrap only values carrying no quotes
  // of their own. 378 of 425 already contain their own quotation marks.
  assert.match(DASH, /return qt\.selfQuoted \? t : `“\$\{t\}”`;/,
    'the curly wrap is conditional on selfQuoted — wrapping narration double-quotes it');

  // C4: attribution shows only what exists. Never an invented year, never "n.d."
  const attrib = DASH.slice(DASH.indexOf('function tourxQuoteAttrib(qt){'),
                            DASH.indexOf('function tourxQuoteText'));
  assert.match(attrib, /if \(qt\.year\) bits\.push/);
  assert.ok(!/n\.d\.|unknown|—/.test(code(attrib)),
    'a missing year contributes NOTHING to the attribution line, not a placeholder');
});

test('phase 2 B: the Database page is mountable, and the standalone call site is untouched', () => {
  assert.match(DASH, /function mount\(root, opts\)\{/, 'mount(root, opts) must exist');
  assert.match(DASH, /return \{.*\bmount:\s*mount\b.*\binit:\s*init\b.*$/m,
    'the module must export BOTH mount and init — init() is the standalone page\'s untouched call site');
  assert.match(DASH, /if \(tab === 'database'\) \{ if \(window\.DatabaseTab\) window\.DatabaseTab\.init\(\); \}/,
    'the nav call site is deliberately unchanged');
  // no DOM read may escape its instance root
  assert.ok(!/getElementById\('db/.test(DASH),
    'every Database DOM read must be root-scoped via q(); a document-wide lookup makes two mounts fight');
  // B4: the overlay opens with round empty and the full year range so the tour
  // baseline column is valid on open.
  const m = DASH.slice(DASH.indexOf('if(opts.initialTournamentNames'), DASH.indexOf('    // 4: the side is not decoration'));
  assert.ok(m.length > 200, 'could not isolate the initialTournamentNames branch');
  assert.match(m, /state\.view='tournaments';/);
  assert.match(m, /state\.rounds=null;/);
  assert.match(m, /state\.yearMin=null; state\.yearMax=null;/);

  // THE KEY. The overlay must pass OFFICIAL ARCHIVE STRINGS, never the catalog
  // name — measured, only 4 of 73 catalog names exist in the archive, so the
  // catalog name opened an empty panel on 69 of them. And the strings must come
  // from tournament-market.json, which is the same map the ROI figure on the
  // clicked card was pooled from: any other source could make the panel show a
  // different population than the number the reader just clicked.
  assert.match(m, /state\.tournament=opts\.initialTournamentNames\.slice\(\);/);
  assert.ok(!/initialTournament:\s*c\.name/.test(DASH_CODE),
    'the catalog name must never be passed as the Database subject');
  assert.match(DASH, /const names = mkt && mkt\.archiveNames;/,
    'the archive names must come from tournament-market.json, not be re-derived');
  // and no fallback: an event with no archive names opens nothing at all
  assert.match(DASH, /if \(host && c && names && names\.length\)\{/);

  // The filter must accept a SET — 28 of 61 events pool several sponsor strings.
  assert.match(DASH, /Array\.isArray\(state\.tournament\) \? state\.tournament : \[state\.tournament\]/);
  assert.match(DASH, /if\(!tSet \|\| !tSet\.length\) return out; if\(tSet\.indexOf\(r\[4\]\)<0\) continue;/);

  // The embed must carry data-page=database or every --db-* var is undefined.
  assert.match(DASH, /data-db-root="roi" data-page="database"/,
    'the mount root carries the attribute the --db-* custom properties are declared on');
  assert.match(DASH, /#dbBody, \[data-db="body"\]\{/,
    'an ID selector cannot match the embedded body');

  // The leak: dedupe on a stable key, evict detached roots.
  assert.match(DASH, /if\(ex\.root!==root && !document\.contains\(ex\.root\)\) INSTANCES\.splice\(i,1\);/);
  assert.match(DASH, /for\(var i2=0;i2<INSTANCES\.length;i2\+\+\) if\(INSTANCES\[i2\]\.key===key\) inst=INSTANCES\[i2\];/);

  // The side is read, not just stored.
  assert.match(DASH, /function focusSide\(inst\)\{/);
  assert.match(DASH, /inst\.side = opts\.side \|\| null;/);
});

test('item 6.1: the per-week absence fires on "nothing loaded", not "no events"', () => {
  // The spec\'s own copy — "The ATP has {n} events in {week}. Their acceptance
  // lists are not in the build yet" — is a sentence about a week that HAS events
  // and no lists. Caught by a manufactured empty-week control: a 2-event week
  // with nothing loaded was rendering two per-EVENT "not loaded" rows instead.
  assert.match(DASH, /if\(!tourns\.length \|\| !tourns\.some\(hasList\)\)\{/,
    'the week-level empty state must also fire when no event that week carries a list');
  assert.match(DASH, /No lists loaded for this week/);
  assert.match(DASH, /Acceptance list not loaded for this event yet\./);
  assert.match(DASH, /Advance entry lists could not be updated/);
});

// ===========================================================================
// EXECUTED, not grepped.
//
// A clean-context review found two defects that every text assertion above
// shipped GREEN, and both were putting a fabricated number on screen:
//   * a never-fetched row printed `Alt 0` in the real-data colour next to two
//     dashes, because the builder fix is prospective and the DEPLOYED shard
//     still carries ALT: 0 on 25 of 71 rows;
//   * the speed-series trend line labelled a POINT COUNT as a duration, so
//     Brisbane's one-year move read "over 2 yrs" — 58 of 59 multi-point venues
//     were wrong.
// Grepping for the fix cannot catch either. These slice the real functions out
// of the shipped file and RUN them. Sliced, never stubbed: a stub is a second
// implementation and would agree with itself.
// ===========================================================================

// Cut `function name(...)` out of a source by brace matching, respecting
// strings, template literals and comments.
function fnSource(src, sig) {
  const i = src.indexOf(sig);
  assert.ok(i >= 0, `function not found: ${sig}`);
  let j = src.indexOf('{', i), depth = 0, k = j, s = null, esc = false, c = null;
  while (k < src.length) {
    const ch = src[k];
    if (c) {
      if (c === '//' && ch === '\n') c = null;
      else if (c === '/*' && ch === '*' && src[k + 1] === '/') { c = null; k++; }
    } else if (s) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === s) s = null;
    } else if (ch === '"' || ch === "'" || ch === '`') s = ch;
    else if (ch === '/' && (src[k + 1] === '/' || src[k + 1] === '*')) { c = src[k + 1] === '/' ? '//' : '/*'; k++; }
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
    k++;
  }
  assert.ok(depth === 0, `unbalanced braces in ${sig}`);
  return src.slice(i, k + 1);
}

test('EXECUTED: a never-fetched row dashes all three counts even on a shard that carries ALT: 0', () => {
  // The exact shape the DEPLOYED artefact serves for a pending tournament.
  const DEPLOYED_PENDING = { counts: { MD: null, Q: null, ALT: 0 }, sections: [],
    name: 'M25 Somewhere', tier: 'ITF', surface: 'Hard', startDate: '2026-10-05', weekStart: '2026-10-05' };
  const LOADED_NO_ALTS = { counts: { MD: 28, Q: 16, ALT: 0 }, sections: [{ title: 'Main Draw', players: [] }],
    name: 'Real Event', tier: 'ATP 250', surface: 'Clay', startDate: '2026-10-05', weekStart: '2026-10-05', sourcePublished: '2026-09-15T20:30:00Z' };

  const sandbox = [
    'const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];',
    'function hasList(t){ return !!(t.sections && t.sections.length); }',
    'function renderPlayers(){ return ""; }',
    'function fmtName(p){ return p.name; }',
    'function fmtStatus(){ return ""; }',
    fnSource(DASH, 'function tierCode(tier){'),
    fnSource(DASH, 'function shortDate(iso){'),
    fnSource(DASH, 'function countCell(v){'),
    fnSource(DASH, 'function renderTournament(t, idx){'),
    'return renderTournament;',
  ].join('\n');
  const renderTournament = eval(`(function(){ ${sandbox} })()`);

  // three right-aligned count cells, in grid order MD / Q / Alt
  const cells = (html) => [...html.matchAll(/<span style="text-align:right;font-family:[^"]*font-weight:700;font-variant-numeric:tabular-nums;color:(var\(--[a-z0-9-]+\));">([^<]*)<\/span>/g)]   // TEN-376: colours are tokens
    .map((m) => ({ colour: m[1], text: m[2] }));

  const never = cells(renderTournament(DEPLOYED_PENDING, 0));
  assert.equal(never.length, 3, 'expected three count cells');
  assert.deepEqual(never.map((c) => c.text), ['—', '—', '—'],
    'a never-fetched row must dash ALL THREE counts — the deployed shard\'s ALT: 0 must not reach the screen');
  assert.deepEqual([...new Set(never.map((c) => c.colour))], ['var(--text-label)'],
    'all three dashes must use the no-data colour (TEN-376: #6e7a93 → --text-label)');

  // ...and the other direction: a REAL zero on a loaded row must survive.
  const real = cells(renderTournament(LOADED_NO_ALTS, 1));
  assert.deepEqual(real.map((c) => c.text), ['28', '16', '0'],
    'a loaded event with no alternates must print 0 — "no alternates" is not "never fetched"');
  assert.equal(real[2].colour, 'var(--text)', 'a real zero is real data and takes the data colour (TEN-376: #ebf1f2 → --text)');
});

test('EXECUTED: the speed-series trend states the year SPAN, not the number of points', () => {
  const src = fnSource(DASH, 'function tourxSpeedSeriesHtml(c){');
  const tourxSpeedSeriesHtml = eval(`(function(){ ${src} return tourxSpeedSeriesHtml; })()`);
  const label = (html) => (html.match(/([+−]\d+\.\d\d) over (\d+) (yrs?)/) || []).slice(1);

  // Brisbane's real data: two points, ONE year apart.
  assert.deepEqual(label(tourxSpeedSeriesHtml({ as2023: null, as2024: 1.26, as2025: 1.23 })),
    ['−0.03', '1', 'yr'], 'two adjacent seasons are a ONE-year move');
  // Montreal's real data: two points either side of a hole, TWO years apart.
  assert.deepEqual(label(tourxSpeedSeriesHtml({ as2023: 1.07, as2024: null, as2025: 1.02 })),
    ['−0.05', '2', 'yrs'], 'a 2023->2025 move spans two years even though a season is missing');
  // three points, two years.
  assert.deepEqual(label(tourxSpeedSeriesHtml({ as2023: 1.10, as2024: 1.11, as2025: 1.11 }))[1], '2');

  // and the honesty rules the brief is explicit about
  const montreal = tourxSpeedSeriesHtml({ as2023: 1.07, as2024: null, as2025: 1.02 });
  assert.ok(!/>2024</.test(montreal), 'a missing season must not be plotted or labelled');
  assert.match(montreal, /Abstract court speed · 2023–2025/, 'the eyebrow states the real range');
  // TEN-401 item 6: a white dot inside a 2px card-tone ring (one per real season).
  const DOT = /width:9px;height:9px;border-radius:50%;background:var\(--text\);border:2px solid var\(--card\);/g;
  assert.equal((montreal.match(DOT) || []).length, 2, 'exactly one dot per real season');

  // a single season: one dot, single-year eyebrow, and NO trend (nothing to trend)
  const one = tourxSpeedSeriesHtml({ as2023: null, as2024: 1.01, as2025: null });
  assert.match(one, /Abstract court speed · 2024/);
  assert.ok(!/Holding steady|Trending/.test(one), 'one point is not a trend');
  assert.equal((one.match(DOT) || []).length, 1);

  // no seasons at all: render nothing rather than an empty chart
  assert.equal(tourxSpeedSeriesHtml({ as2023: null, as2024: null, as2025: null }), '');

  // all-equal values must not divide by zero
  assert.doesNotThrow(() => tourxSpeedSeriesHtml({ as2023: 1.00, as2024: 1.00, as2025: 1.00 }));
});

test('the second entry-list builder and its gate carry the same ruling', () => {
  // The draw shard has its own builder and its own QA gate. The gate REQUIRED
  // ALT to be an int, so it would have rejected the corrected value — which is
  // how the fabricated zero survived it.
  const drawB = readFileSync(join(HERE, 'tools/entry-lists/build-entry-lists.py'), 'utf8');
  const gate = readFileSync(join(HERE, 'tools/entry-lists/qa-gate.py'), 'utf8');
  assert.ok(!/"counts":\s*\{"MD":\s*None,\s*"Q":\s*None,\s*"ALT":\s*0\}/.test(drawB),
    'the draw builder must not mint ALT: 0 for a pending tournament');
  assert.ok(!/counts = \{"MD": None, "Q": None, "ALT": 0\}/.test(drawB));
  assert.match(gate, /alt is not None and \(not isinstance\(alt, int\)/,
    'the gate must ACCEPT a null ALT, or it rejects the corrected value');
  assert.match(gate, /any\(counts\.get\(k\) is not None for k in \("MD", "Q", "ALT"\)\)/,
    'pending must be policed on null-ness, not falsiness — `or` treated 0 as acceptable');
});

// ===========================================================================
// FOUNDER RULING 2026-09-19 — the hero knob is scaled from the DATA.
//
// The export hardcodes a 0.50–1.50 domain. Our observed range is 0.41–1.42, so
// Bucharest fell below the floor and pinned at the 3% stop — a marker that has
// stopped encoding anything. The ruling: derive the bounds from the venue set,
// pad them, and "add a test that fails if the knob position is ever computed
// from a hardcoded span."
//
// That last requirement is what the first assertion below is for, and it is the
// only one a hardcoded implementation cannot fake: the SAME speed is fed to two
// DIFFERENT venue sets and must land in two different places. A constant domain
// returns the same number both times, whatever else it gets right.
// ===========================================================================
test('ruling: the knob scale is derived from the venue set, not a hardcoded span', () => {
  const src = fnSource(DASH, 'function tourxKnobPct(as, speeds){');
  const knob = eval(`(function(){ const TOURX_KNOB_PAD = 0.08; ${src} return tourxKnobPct; })()`);

  // THE ANTI-HARDCODE CONTROL. Same value, two different populations.
  const wide = knob(1.00, [0.41, 1.42]);
  const narrow = knob(1.00, [0.90, 1.10]);
  assert.notEqual(wide, narrow,
    'the same speed landed in the same place under two different venue sets — the scale is not reading the data');
  // 1.00 is dead centre of 0.90–1.10, and above centre of 0.41–1.42
  assert.ok(Math.abs(narrow - 50) < 0.01, `1.00 should centre in a 0.90–1.10 field, got ${narrow}`);
  assert.ok(wide > 50, `1.00 sits above the midpoint of 0.41–1.42, got ${wide}`);

  // and a new outlier must MOVE the scale, not be clamped against it
  // 0.41 is the floor of the first field and no longer the floor of the second,
  // so it must move AWAY from the left end — a pinned marker would not move.
  const before = knob(0.41, [0.41, 1.42]);
  const after = knob(0.41, [0.20, 1.42]);
  assert.ok(after > before,
    `a new slower venue must move the old minimum off the floor: ${before} -> ${after}`);

  // no venue may rest on a stop on the real data
  const CC = literal(PIPE, /^const COURT_CONDITIONS = \{/);
  const CAT = literal(DASH, /^const TOURNAMENT_CATALOG = \[/);
  const speeds = CAT.filter((t) => CC[t.name]).map((t) => CC[t.name].abstractSpeed);
  const pinned = speeds.filter((v) => { const p = knob(v, speeds); return p <= 3 || p >= 97; });
  assert.deepEqual(pinned, [], `venue(s) still pinned at a clamp stop: ${pinned}`);
  const lo = Math.min(...speeds), hi = Math.max(...speeds);
  assert.ok(knob(lo, speeds) > 5 && knob(lo, speeds) < 10, `slowest venue should sit clear of the stop, got ${knob(lo, speeds)}`);
  assert.ok(knob(hi, speeds) > 90 && knob(hi, speeds) < 95, `fastest venue, got ${knob(hi, speeds)}`);

  // DEGENERATE SPAN -> centre, never NaN and never a divide by zero
  assert.equal(knob(1.00, [1.00]), 50, 'a single venue has no axis — centre it');
  assert.equal(knob(1.00, [1.00, 1.00, 1.00]), 50, 'an all-equal field has no axis either');
  assert.equal(knob(1.00, []), 50);
  assert.equal(knob(null, [0.4, 1.4]), 50);
  for (const out of [knob(1.0, [1.0]), knob(1.0, []), knob(null, [])]) assert.ok(Number.isFinite(out));

  // the export's hardcoded domain must not survive anywhere
  assert.ok(!/\(as - 0\.50\) \/ 1\.00/.test(DASH_CODE),
    'the README\'s hardcoded 0.50–1.50 knob domain has come back');
  assert.ok(!/0\.41/.test(fnSource(DASH, 'function tourxKnobPct(as, speeds){')),
    'the observed minimum must not be written into the scale — next season\'s outlier would pin silently');
});

// ---------------------------------------------------------------------------
// B key design: a live "Open favourites graphics →" link must never open a panel
// that says we hold no data for an event we hold data for.
//
// The link renders when `archiveNames` is non-empty. But archiveNames comes from
// build-tournament-market.js's ALIAS and is filtered against the ODDS CSVs,
// while the panel resolves those strings against database-yield.json's own list.
// Those two lists are not the same: measured 2026-09-20, 16 of 61 events name at
// least one archive string the Database archive does not hold. Today every event
// still has at least one string that DOES resolve, so no link opens empty — this
// test is what notices if that stops being true.
test('B: every event with a live ROI link resolves at least one archive string', () => {
  const mkt = JSON.parse(readFileSync(join(HERE, 'tournament-market.json'), 'utf8'));
  const dby = JSON.parse(readFileSync(join(HERE, 'database-yield.json'), 'utf8'));
  const held = new Set((dby.meta && dby.meta.tournaments) || []);
  assert.ok(held.size > 100, `database-yield.json lists only ${held.size} tournaments — wrong shape`);

  const empty = [], partial = [];
  for (const [name, t] of Object.entries(mkt.tournaments || {})) {
    const an = t.archiveNames || [];
    if (!an.length) continue;                       // no link is rendered; fine
    const hit = an.filter((s) => held.has(s));
    if (!hit.length) empty.push(`${name} (${an.join(' | ')})`);
    else if (hit.length < an.length) partial.push(`${name} ${hit.length}/${an.length}`);
  }
  assert.deepEqual(empty, [],
    `these events render a clickable ROI card whose panel resolves NOTHING — the reader clicks through to "No matches for this filter" on an event we hold an archive for: ${empty.join('; ')}`);

  // Not a failure — the card and the panel use the SAME ALIAS, so they under-cover
  // together and never disagree with each other. Pinned so a change is noticed.
  assert.ok(partial.length <= 16,
    `${partial.length} events now name archive strings the Database does not hold (was 16). If this grew, the ALIAS gained a string that resolves nowhere: ${partial.join(', ')}`);
});

// ---------------------------------------------------------------------------
// FOUNDER RULING 2026-09-20: "Land the guard with it: build FAILS when a new
// document-wide getElementById appears in that module. TEN-243 added one while
// B was in review, so the pattern is still spreading. Fix the class, not the
// four instances."
//
// The class is a DOCUMENT-WIDE DOM LOOKUP inside DatabaseTab. With two mounts
// on the page, `document.getElementById('dbBody')` resolves to whichever node
// happens to be first in the document — so the overlay renders into the
// standalone page, or the reverse. Last render wins and the other mount goes
// blank. Every such lookup must go through q(), which is root-scoped.
//
// This test is deliberately BROADER than getElementById: querySelector against
// the document has the identical failure mode, and blocking only the exact
// call TEN-243 used would just move the pattern one method along.
test('RULING: DatabaseTab contains NO document-wide DOM lookup (the class, not the instances)', () => {
  const i = DASH.indexOf('window.DatabaseTab = (function(){');
  assert.ok(i > 0, 'DatabaseTab module not found');
  const m = /\n[ \t]*return \{.*\binit:\s*init\b.*$/m.exec(DASH.slice(i));
  assert.ok(m, 'DatabaseTab module end not found');
  const MODULE = DASH.slice(i, i + m.index);

  // The ONE legitimate document read: init() has to find the standalone root
  // before any instance exists, so it cannot be root-scoped by definition.
  const ALLOWED = [`document.querySelector('[data-db-root="standalone"]')`];

  const offenders = [];
  const re = /document\s*\.\s*(getElementById|querySelector|querySelectorAll)\s*\([^)]*\)/g;
  let hit;
  while ((hit = re.exec(MODULE)) !== null) {
    const call = hit[0].replace(/\s+/g, ' ');
    if (ALLOWED.some((a) => call.replace(/\s+/g, ' ') === a)) continue;
    // line number in the real file, so the failure points at the source
    const line = DASH.slice(0, i + hit.index).split('\n').length;
    offenders.push(`bsp-consult-dashboard.html:${line}  ${call}`);
  }

  assert.deepEqual(offenders, [],
    `DatabaseTab must address its DOM through q(), which is scoped to the active ` +
    `instance's root. A document-wide lookup makes two mounts fight over one node ` +
    `and the last render wins. Route these through q('<name>') and give the node a ` +
    `data-db attribute:\n  ` + offenders.join('\n  '));

  // Anti-vacuity: the regex must actually match this shape, or an empty
  // offenders list means nothing. Prove it fires on a planted call.
  const planted = MODULE + `\n  var x = document.getElementById('dbBody');\n`;
  const found = [...planted.matchAll(re)].filter(
    (h) => !ALLOWED.includes(h[0].replace(/\s+/g, ' ')));
  assert.equal(found.length, 1,
    'the detector did not fire on a planted document.getElementById — it is not testing anything');
});

// ---------------------------------------------------------------------------
// FOUNDER RULING 2026-09-20 (divergence -> align_window): the ROI card and the
// Database panel it links to must cover the same matches.
//
// They are now computed from the SAME STORE — build-tournament-market.js reads
// database-yield.json's rows rather than re-parsing the CSVs with its own
// window, book and exclusion rules. This test recomputes every card's figures
// straight from that store and requires an exact match, so the two can never
// drift apart again the way they did (Hamburg: card -10.5%, panel +0.71%).
// An independent reading of tournament-market.json archiveFilter (not the dashboard's code): a row of a filtered
// archive string counts only if its season and surface are listed.
function lockOk(filter, names, r) {
  const f = filter && filter[names[r[4]]];
  if (!f) return true;
  return (!f.years || f.years.includes(Math.floor(r[0] / 10000))) && (!f.surfaces || f.surfaces.includes(r[2]));
}

test('RULING: every ROI card equals the panel it links to, recomputed from the store', () => {
  const mkt = JSON.parse(readFileSync(join(HERE, 'tournament-market.json'), 'utf8'));
  const y = JSON.parse(readFileSync(join(HERE, 'database-yield.json'), 'utf8'));
  const names = y.meta.tournaments;
  const idx = new Map(names.map((n, i) => [n, i]));

  assert.match(mkt.source, /database-yield\.json/,
    'the market artefact no longer declares the yield store as its source — if it went back to parsing the CSVs, the window/book divergence is back');
  assert.equal(mkt.windowStart, y.meta.windowStart,
    'the card window and the panel window disagree');

  const mismatches = [];
  let checked = 0;
  for (const [name, t] of Object.entries(mkt.tournaments)) {
    const want = (t.archiveNames || []).map((n) => idx.get(n)).filter((i) => i !== undefined);
    if (!want.length) continue;
    // TEN-401 row split (Montreal / Toronto / Turin / Hamburg / Antwerp share archive strings): the card pools only the
    // rows its archiveFilter names, and the panel locks to the same rows (DatabaseTab rowLockOk).
    const rs = y.rows.filter((r) => want.includes(r[4]) && lockOk(t.archiveFilter, names, r));
    let sf = 0, sd = 0, fw = 0;
    for (const r of rs) { const w = !!r[7]; sf += (w ? r[5] : 0) - 1; sd += (w ? 0 : r[6]) - 1; if (w) fw++; }
    const exp = {
      n: rs.length,
      roiFav: +(sf / rs.length * 100).toFixed(1),
      roiDog: +(sd / rs.length * 100).toFixed(1),
      favRel: Math.round(fw / rs.length * 100),
    };
    checked++;
    for (const k of ['n', 'roiFav', 'roiDog', 'favRel']) {
      if (exp[k] !== t[k]) mismatches.push(`${name}.${k}: card ${t[k]} vs store ${exp[k]}`);
    }
  }
  assert.ok(checked >= 50, `only ${checked} events cross-checked — the recomputation is not covering the artefact`);
  assert.deepEqual(mismatches, [],
    `these ROI cards do NOT match the panel they open — a reader clicks a figure and lands on a different one:\n  ${mismatches.join('\n  ')}`);

  // Anti-vacuity: the recomputation must be capable of disagreeing. Perturb one
  // card and confirm the same comparison catches it.
  const probe = Object.entries(mkt.tournaments)[0];
  const want = probe[1].archiveNames.map((n) => idx.get(n)).filter((i) => i !== undefined);
  const rs = y.rows.filter((r) => want.includes(r[4]) && lockOk(probe[1].archiveFilter, names, r));
  assert.notEqual(rs.length, probe[1].n + 1,
    'control setup is degenerate');
  assert.ok(rs.length === probe[1].n,
    'the control event does not reconcile, so the comparison above is not actually comparing');
});

// ---------------------------------------------------------------------------
// FOUNDER RULING 2026-09-20, gate `33f71aab` — three decisions, three guards.
// ---------------------------------------------------------------------------

test('RULING: retirements are VOIDED, not settled, and the footnote says so', () => {
  const b = readFileSync(join(HERE, 'build-database-yield.js'), 'utf8');
  // The classification, not a comment about it.
  const m = /const RESULT_STANDS = new Set\(\[([^\]]*)\]\)/.exec(b);
  assert.ok(m, 'RESULT_STANDS not found');
  assert.ok(!/Retired/.test(m[1]),
    `RESULT_STANDS still settles retirements (${m[1].trim()}) — a book voids that market, so settling it prices a bet the reader could never have had`);
  assert.match(b, /const RETIRED = new Set\(\['Retired', 'Rrtired'\]\)/);
  assert.match(b, /if \(RETIRED\.has\(comment\)\) \{ bucket\.retired\+\+; continue; \}/,
    'retirements must be counted into their own bucket and skipped');

  // The store must actually carry the count, or the footnote has nothing to print.
  const y = JSON.parse(readFileSync(join(HERE, 'database-yield.json'), 'utf8'));
  assert.ok(y.meta.exclusions.retired > 0,
    'meta.exclusions.retired is absent or zero — rebuild database-yield.json');
  assert.ok(!/Retired/.test(JSON.stringify(y.meta.books || [])), 'sanity');

  // The footnote named walkovers and stayed silent on retirements, which reads
  // as "retirements were excluded too" while they were being counted.
  assert.match(DASH, /fmtInt\(ex\.retired\)\+' retirements \(voided, as a book would\)/,
    'the What-is-included footnote does not state what happens to retirements');
});

test('RULING: the profit chart plots by MATCH INDEX, not by date', () => {
  const i = DASH.indexOf('function renderCurveCard');
  assert.ok(i > 0, 'renderCurveCard not found');
  const fn = DASH.slice(i, DASH.indexOf('\n  function ', i + 10));

  assert.ok(!/var x=\(dnum\(r\[0\]\)-d0\)\/span;/.test(fn),
    'the curve is back on a DATE axis — that is the staircase: a one-week event occupies one week of the width');
  assert.match(fn, /var x = nPts>1 \? \(x0 \+ \(1-x0\) \* i\/\(nPts-1\)\) : 0;/,
    "x must be the ZIP bundle's index formula x = x0 + (1 - x0) * i/(n-1)");
  assert.match(fn, /var x0=0, nPts=ordered\.length;/, 'x0 must exist so a late series stays late');
  assert.match(fn, /ticks=seasonIndexTicks\(ordered, xs, tickSteps\)/,
    'season labels must be placed at the match index where each season starts');
  // TEN-399 item 1 (override, supersedes the TEN-384 seam mark): one join per match in every
  // season, so the curve carries NO book seam — no seam line, no Bet365 pill, no footnote.
  assert.ok(!/seamX|seamAfter|db-seamlab|db-seamfoot|book artefact/.test(fn),
    'the profit chart still draws a book seam — TEN-399 removed it with the one join');

  // Smoothing: centred, w=3, endpoints pinned. Display only.
  const sv = /function smoothVals\(vals, k\)\{[\s\S]*?\n  \}/.exec(DASH);
  assert.ok(sv, 'smoothVals not found');
  assert.match(sv[0], /out\[0\]=vals\[0\]; out\[n-1\]=vals\[n-1\];/,
    'endpoints must be pinned so the line lands on the printed end value');

  // An index axis must not be captioned as if it were time.
  const cap = /db-xcap','<span class="db-eyebrow">([^<]*)<\/span>/.exec(DASH);
  assert.ok(cap, 'x caption not found');
  assert.notEqual(cap[1].trim(), 'Season',
    'an index axis captioned only "Season" invites reading durations off an axis that does not carry them');
  assert.match(cap[1], /match index/i);
});

// TEN-401 ticket item 7 (founder, step 7) supersedes the 2026-09-20 surface-tinted selection (gate 33f71aab).
test('TEN-401 item 7: Compare all — matched row is the selected tile, white text, Ring-blue bars; columns and marks neutral', () => {
  const i = DASH.indexOf('function tourxSpeedPanelHtml');
  assert.ok(i > 0, 'tourxSpeedPanelHtml not found');
  const fn = DASH.slice(i, DASH.indexOf('\n/* ---------- Section 1', i));
  const fnCode = code(fn);
  // matched row = the selected tile class (--selected + inset 16% ring), never a tint or an inset bar
  assert.match(fn, /class="tourx-cmprow\$\{on \? ' on' : ''\}"/);
  assert.match(DASH, /\.tourx-cmprow\.on\{ background:var\(--selected\); box-shadow:inset 0 0 0 1px var\(--edge-16\); \}/);
  assert.ok(!/inset 2px 0 0|tintOf|SURF\[|hexA\(/.test(fnCode), 'a surface tint / inset bar survives on the matched row');
  // white text, white value — no blue value
  assert.match(fn, /color:\$\{on \? 'var\(--text\)' : 'var\(--text-soft\)'\}/);
  assert.match(fn, /font-weight:700;color:var\(--text\);flex:none;">\$\{t\.abstractSpeed\.toFixed\(2\)\}/);
  // bars: solid --bar for the matched event, --bar-2 (45%) for the rest
  assert.match(fn, /background:\$\{on \? 'var\(--bar\)' : 'var\(--bar-2\)'\}/);
  // columns card tone; marks = badges (--inner, no edge, grey)
  assert.match(fn, /return `<div style="background:var\(--card\);display:flex;flex-direction:column;">/);
  const head = /height:41px[\s\S]*?\$\{rows\.length\} · med/.exec(fn);
  assert.ok(head, 'column header block not found');
  assert.match(head[0], /background:var\(--inner\);color:var\(--text-label\);font-family:var\(--font-words\)/);
  assert.ok(!/border:1px solid/.test(head[0]), 'the IND / OUT / CLY / GRS mark carries an edge');
});

test('TEN-401 item 7: every overlay is a pop-up sheet over a content-area scrim; Close is a control', () => {
  const sh = fnSource(DASH, 'function tourxOverlayShell(opts){');
  assert.match(sh, /inset:0 0 0 var\(--sf-side, 0px\)/, 'the scrim must start at the sidebar edge');
  assert.match(sh, /background:var\(--backdrop\); backdrop-filter:blur\(3px\);clip-path:inset\(0\)/);
  assert.match(sh, /background:var\(--card\);border:1px solid var\(--edge-10\);border-radius:16px;box-shadow:var\(--shadow-modal\)/);
  assert.match(sh, /class="tourx-closebtn"[^>]*background:var\(--inner\)/);
  assert.ok(!/border:1px solid var\(--edge-6\)/.test(sh), 'the sheet or its Close button still carries the old 6% panel edge');
  // Esc + outside click + the sidebar closer
  assert.match(DASH, /if \(e\.key === 'Escape'\) tourxCloseOverlays\(\);/);
  assert.match(DASH, /if \(scrim && e\.target === scrim\) tourxCloseOverlays\(\);/);
  assert.match(DASH, /\(\) => \{ if \(typeof tourxCloseOverlays === 'function'\) tourxCloseOverlays\(\); \}/);
  // quote avatars: initials grey on --inner, no edge
  const qp = fnSource(DASH, 'function tourxQuotesPanelHtml(){');
  assert.match(qp, /border-radius:50%;background:var\(--inner\);display:inline-flex;[^"]*color:var\(--text-label\);/);
});

test('TEN-401 items 3–5: rail, hero scale and Overview blocks', () => {
  const rail = fnSource(DASH, 'function tourxOverviewListHtml(){');
  // selected row = selected tile, no surface wash; tier chip grey, no edge
  assert.match(rail, /class="tourx-ovrow\$\{seld \? ' on' : ''\}"/);
  assert.ok(!/TOURX_RAIL_SURF|background:\$\{bg\}/.test(rail), 'a surface-coloured row wash survives');
  assert.match(rail, /border:none;color:var\(--text-label\);\$\{chipFont\}/);
  // search = control: --inner, no edge
  assert.match(rail, /class="tourx-search" style="display:flex;align-items:center;gap:10px;background:var\(--inner\);/);
  assert.match(DASH, /#tourxOverview \.tourx-search\{ border:1px solid transparent; \}/);
  const panel = fnSource(DASH, 'function tourxConditionsPanelHtml(){');
  // item 4 (override): 8px track at 6% white, no gradient; white knob + 3px card ring, nothing else
  assert.match(panel, /height:8px;border-radius:5px;background:var\(--track\);cursor:pointer;/);
  assert.ok(!/linear-gradient/.test(code(panel)), 'the court-speed scale still carries a gradient');
  assert.match(panel, /width:16px;height:16px;border-radius:50%;background:var\(--text\);border:3px solid var\(--card\);transform:translate\(-50%,-50%\);"/);
  // Completed badge: inner, grey caps, no edge
  assert.match(panel, /text-transform:uppercase;color:var\(--text-label\);background:var\(--inner\);border:1px solid transparent;[^`]*>Completed</);
  // ROI cards: clickable tiles when they open something; report button: inner, white, 10% edge on hover only
  const roi = fnSource(DASH, 'function tourxRoiPairHtml(c){');
  assert.match(roi, /class="tourx-roitile open"/);
  assert.match(DASH, /#tourxOverview \.tourx-roitile\{ background:var\(--card\); border:1px solid var\(--edge-7\);/);
  assert.match(DASH, /#tourxOverview \.tourx-roitile\.open:hover\{ background:var\(--tile-hover\); border-color:var\(--edge-16\); \}/);
  const cta = fnSource(DASH, 'function tourxReportCtaHtml(c){');
  assert.match(cta, /class="tourx-reportbtn"[^>]*color:var\(--text\);background:var\(--inner\)/);
  assert.ok(!/border:1px solid var\(--edge-10\)|var\(--bar\)/.test(cta), 'the report button carries a resting edge or a blue fill');
  assert.match(DASH, /#tourxOverview \.tourx-reportbtn:hover\{ border-color:var\(--edge-10\); \}/);
  // reliability bar: Ring blue on the 6% track
  const rel = fnSource(DASH, 'function tourxReliabilityHtml(c){');
  assert.match(rel, /background:var\(--track\);overflow:hidden;margin-top:11px;"><span style="display:block;height:100%;width:\$\{v\}%;background:var\(--bar\)/);
});

test('TEN-401 item 6: seven-year chart — no area fill, white 2.4px line, grey mono years', () => {
  const src = fnSource(DASH, 'function tourxSpeedSeriesHtml(c){');
  const f = eval(`(function(){ ${src} return tourxSpeedSeriesHtml; })()`);
  const h = f({ as2023: 1.10, as2024: 1.08, as2025: 1.11 });
  assert.ok(!/<path|linearGradient|fill="url/.test(h), 'an area fill (or its gradient) is drawn under the line');
  assert.match(h, /<polyline [^>]*fill="none" stroke="var\(--text\)" stroke-width="2\.4"/);
  assert.equal((h.match(/font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0\.06em;color:var\(--text-label\);">20\d\d</g) || []).length, 3);
  assert.equal((h.match(/font-size:12\.5px;font-weight:700;color:var\(--text\);white-space:nowrap;">\d\.\d\d</g) || []).length, 3, 'value labels are mono white');
});

test('TEN-401 item 5 / L1: ROI yield is green / red by SIGN, grey within 1pp of the tour; a thin event is a dash, never 0', () => {
  const src = fnSource(DASH, 'function tourxRoiPairHtml(c){');
  const gate = (n) => n == null ? { mode: 'none' } : n >= 30 ? { mode: 'full' } : { mode: 'small' };
  const run = (mkt) => eval(`(function(){ const tourxSampleGate = ${gate.toString()}; const tourxMarketFor = () => (${JSON.stringify(mkt)}); ${src} return tourxRoiPairHtml; })()`)({ name: 'X' });
  const vals = (h) => [...h.matchAll(/font-size:26px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;color:([^;]+);">([^<]+)</g)].map(m => [m[1], m[2]]);
  const base = { roiFav: -1.8, roiDog: -7 };
  assert.deepEqual(vals(run({ n: 1949, roiFav: 0.3, roiDog: -12, baseline: base, archiveNames: ['Wimbledon'] })),
    [['var(--pos)', '+0.3%'], ['var(--neg)', '−12.0%']], 'beyond 1pp: green above the tour, red below, true minus');
  assert.deepEqual(vals(run({ n: 987, roiFav: -2.0, roiDog: -7.5, baseline: base, archiveNames: ['Madrid'] })),
    [['var(--text-label)', '−2.0%'], ['var(--text-label)', '−7.5%']], 'within 1pp of the tour: grey');
  assert.deepEqual(vals(run(null)), [['var(--text-label)', '—'], ['var(--text-label)', '—']], 'no join: a grey dash, not a zero');
  // Founder ruling TEN-401 (card c572b773 roicol = sign): colour follows the SIGN, not the gap to the tour. Madrid
  // underdogs −4.4% (tour −7.0) beat the tour by 2.6pp but lose money → red; a +0.5% favourite 2.3pp above the tour → green.
  assert.deepEqual(vals(run({ n: 987, roiFav: 0.5, roiDog: -4.4, baseline: base, archiveNames: ['Madrid'] })),
    [['var(--pos)', '+0.5%'], ['var(--neg)', '−4.4%']], 'sign, not gap: a losing yield above the tour is red');
  // a card that opens nothing is a panel, not a clickable tile
  assert.ok(!/tourx-roitile/.test(run({ n: 40, roiFav: 1, roiDog: 1, baseline: base, archiveNames: [] })));
});

test('TEN-401 Data 3 / L3: a quote ships only with a traceable source (resolved speaker + year)', () => {
  const src = fnSource(DASH, 'function tourxQuoteTraceable(q){');
  const ok = eval(`(function(){ ${src} return tourxQuoteTraceable; })()`);
  assert.equal(ok({ player: 'J. Sinner', playerMatch: 'surname', year: 2026 }), true);
  assert.equal(ok({ player: 'J. Sinner', playerMatch: 'exact', year: 2025 }), true);
  assert.equal(ok({ player: 'J. Sinner', playerMatch: 'surname', year: null }), false, 'no date: not traceable');
  assert.equal(ok({ player: 'Ball kid', playerMatch: 'unmatched', year: 2026 }), false, 'speaker not resolved to a player');
  assert.equal(ok({ player: 'Cerundolo', playerMatch: 'ambiguous', year: 2026 }), false, 'speaker ambiguous');
  assert.match(DASH, /const TOURX_QUOTE_RULE = 'traceable';/);
  const fr = fnSource(DASH, 'function tourxQuotesFor(name){');
  assert.match(fr, /filter\(q => TOURX_QUOTE_RULE === 'all' \|\| tourxQuoteTraceable\(q\)\)/, 'the card, its count and the panel read the filtered list');
  // the shipped artefact: every event that renders a card has >= 1 traceable note, and the count is measured
  const Q = JSON.parse(readFileSync(join(HERE, 'tournament-quotes.json'), 'utf8')).tournaments;
  const events = Object.keys(Q).filter((k) => Q[k].some(ok));
  assert.ok(events.length > 0 && events.length < Object.keys(Q).length, `vacuous: ${events.length} of ${Object.keys(Q).length} events pass`);
});

// ---------------------------------------------------------------------------
// FOUNDER RULING 2026-09-20 (closing): the Player panels follow the axis, and
// NO chart in the product may plot x from a date.
//
// His reason, kept verbatim because it is the reason the guard is class-wide
// rather than site-specific: "Two charts in the same product using different
// axis semantics is the trap where one component gets migrated and one doesn't,
// and the bug that surfaces later looks exactly like the original bug coming
// back."
test('RULING: NO chart maps x from a date — the class, not the two instances', () => {
  // Any fraction-of-a-date-span mapping, however it is spelled.
  const offenders = [];
  const re = /\(\s*dnum\([^)]*\)\s*-\s*d0\s*\)\s*\/\s*span|\(\s*[A-Za-z_$][\w$]*\.d\s*-\s*d0\s*\)\s*\/\s*span|Date\.UTC\([^)]*\)\s*\/\s*86400000\s*-\s*d0\s*\)\s*\/\s*span/g;
  let m;
  while ((m = re.exec(DASH)) !== null) {
    const line = DASH.slice(0, m.index).split('\n').length;
    // a comment describing the old behaviour is not an implementation of it
    const src = DASH.split('\n')[line - 1];
    if (/^\s*(\/\/|\*)/.test(src)) continue;
    offenders.push(`bsp-consult-dashboard.html:${line}  ${m[0]}`);
  }
  assert.deepEqual(offenders, [],
    `these map x from a DATE span. A one-week event or an injury season then owns width proportional to TIME, not to matches:\n  ${offenders.join('\n  ')}`);

  // calendarTicks was the helper that made a date axis easy to reach for. It is
  // gone; leaving it would leave a working implementation of the superseded
  // semantics next to its replacement.
  assert.ok(!/function calendarTicks\s*\(/.test(DASH),
    'calendarTicks is back — that is the date axis one call away');

  // Anti-vacuity: the detector must fire on a planted date mapping, or an empty
  // offender list means nothing.
  const planted = 'var x=(dnum(r[0])-d0)/span;';
  assert.equal([...planted.matchAll(re)].length, 1,
    'the detector does not match a real date mapping — it is not testing anything');
});

test('RULING: the Player panels use the career match index and its season ticks', () => {
  const i = DASH.indexOf('function playerCharts');
  assert.ok(i > 0, 'playerCharts not found');
  const fn = DASH.slice(i, DASH.indexOf('\n  function panelFor', i));

  assert.match(fn, /var spine=series\[0\]\.recs\.slice\(\)\.sort/,
    'the index spine must be the All-matches series — the other two are SUBSETS of it, which is what makes x0 meaningful');
  assert.match(fn, /xs\.push\(N>1 \? rankOf\(v\.d\)\/\(N-1\) : 0\)/,
    'player x must be the rank of that match in the career sequence');
  assert.match(fn, /function rankOf\(d\)/, 'rank must be derived from date order, not object identity');
  // TEN-399 item 6: one tick set for all three panels (playerTicks), built from the
  // same spine on the same season-start rule.
  assert.match(fn, /var tAll=playerTicks\(spine, spineX, dOf\);/);
  assert.match(DASH, /var all=seasonIndexTicks\(spine, spineX, \[1\], dOf\);/);
  assert.ok(!/anchorHi/.test(fn), 'the calendar anchor is still being computed');

  // seasonIndexTicks serves two row shapes; without the accessor it reads r[0]
  // on a record object and every tick becomes NaN.
  assert.match(DASH, /function seasonIndexTicks\(rows, xs, steps, dateOf\)/);
  assert.match(DASH, /var get = dateOf \|\| function\(r\)\{ return r\[0\]; \};/);

  // The caption ruling applies to both surfaces.
  const caps = [...DASH.matchAll(/db-xcap','<span class="db-eyebrow">([^<]*)<\/span>/g)].map((m) => m[1].trim());
  assert.ok(caps.length >= 2, `expected a caption on both the Tour curve and the Player main panel, found ${caps.length}`);
  assert.deepEqual([...new Set(caps)], ['Season · match index'],
    `every profit-curve caption must name both axes; found ${JSON.stringify(caps)}`);
});

// ---------------------------------------------------------------------------
// TEN-401 review fix: the ROI panel's ROW LOCK runs the DASHBOARD's own functions, against a host-city table fixed
// here from outside sources (Wikipedia "YYYY Rogers Cup / National Bank Open" infobox, men's location; 2020 not held;
// ATP Finals London 2009–20, Turin 2021+; Hamburg's July clay editions 2021–24 filed as "European Open").
test('TEN-401: the ROI panel row lock reproduces Montreal / Toronto / Turin / Hamburg / Antwerp, and only on its own subject', () => {
  const y = JSON.parse(readFileSync(join(HERE, 'database-yield.json'), 'utf8'));
  const mkt = JSON.parse(readFileSync(join(HERE, 'tournament-market.json'), 'utf8'));
  const M = y.meta;
  const grab = (sig) => { const i = DASH.indexOf(sig); assert.ok(i > 0, sig + ' not found'); let d = 0, j = DASH.indexOf('{', i);
    for (let k = j; k < DASH.length; k++) { if (DASH[k] === '{') d++; else if (DASH[k] === '}' && --d === 0) return DASH.slice(i, k + 1); } };
  const { rowLockFor, rowLockOk } = eval(`(function(){ ${grab('function rowLockFor(filter){')} ${grab('function rowLockOk(lock, r){')} return { rowLockFor, rowLockOk }; })()`);
  const HOST = { Toronto: [2010, 2012, 2014, 2016, 2018, 2021, 2023, 2025], Montreal: [2011, 2013, 2015, 2017, 2019, 2022, 2024, 2026] };
  const count = (ev) => { const t = mkt.tournaments[ev]; const ix = t.archiveNames.map((n) => M.tournaments.indexOf(n)); const lock = rowLockFor(t.archiveFilter);
    return y.rows.filter((r) => ix.includes(r[4]) && rowLockOk(lock, r)).length; };
  for (const city of ['Montreal', 'Toronto']) {
    const f = mkt.tournaments[city].archiveFilter;
    const yrs = [...new Set(Object.values(f).flatMap((x) => x.years))].sort();
    assert.deepEqual(yrs, HOST[city], city + ': the pooled seasons are not the men\'s host years');
    assert.equal(count(city), mkt.tournaments[city].n, city + ': panel lock ≠ card');
  }
  const canada = y.rows.filter((r) => ['Rogers Masters', 'Canadian Open'].includes(M.tournaments[r[4]])).length;
  assert.equal(count('Montreal') + count('Toronto'), canada, 'Montreal + Toronto must partition every Canada row');
  assert.ok(Object.values(mkt.tournaments.Turin.archiveFilter).every((x) => x.years.every((v) => v >= 2021)), 'Turin pools a London season');
  assert.equal(count('Turin'), mkt.tournaments.Turin.n);
  const eo = y.rows.filter((r) => M.tournaments[r[4]] === 'European Open').length;
  const eoH = mkt.tournaments.Hamburg.archiveFilter['European Open'], eoA = mkt.tournaments.Antwerp.archiveFilter['European Open'];
  assert.deepEqual(eoH.surfaces, [M.surfaces.indexOf('Clay')], 'Hamburg takes European Open clay only');
  assert.deepEqual(eoA.surfaces, [M.surfaces.indexOf('Hard')], 'Antwerp takes European Open hard only');
  const eoRows = (f) => y.rows.filter((r) => M.tournaments[r[4]] === 'European Open' && f.years.includes(Math.floor(r[0] / 10000)) && f.surfaces.includes(r[2])).length;
  assert.equal(eoRows(eoH) + eoRows(eoA), eo, 'Hamburg + Antwerp must partition every European Open row');
  assert.equal(count('Hamburg'), mkt.tournaments.Hamburg.n); assert.equal(count('Antwerp'), mkt.tournaments.Antwerp.n);
  // the lock is wired into filteredRows and dies with its subject (a new pick)
  const fr = grab('function filteredRows(names){');
  assert.match(fr, /state\.tournLock && state\.tournLockFor===state\.tournament\) \? rowLockFor\(state\.tournLock\)/, 'filteredRows no longer binds the lock to its subject');
  assert.match(fr, /if\(_lock && !rowLockOk\(_lock, r\)\) continue;/, 'filteredRows no longer applies the row lock');
  assert.match(DASH, /state\.tournLock=opts\.initialTournamentFilter\|\|null;[^\n]*\n\s*state\.tournLockFor=state\.tournament;/, 'mount no longer sets the lock for this subject');
});
