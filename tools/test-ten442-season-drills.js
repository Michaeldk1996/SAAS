#!/usr/bin/env node
// TEN-442 (founder 2026-10-17) — every Record-by-season cell opens the matches behind its number.
//
// A WIRING test, not a parser test: it drives the REAL chain end to end, with no store and no network —
//   fixtures -> bsp-pipeline.js buildAllTierYearly   (the season table's counts, careerByYear)
//            -> bsp-pipeline.js playerMatchHistory   (the per-match rows)
//            -> bsp-pipeline.js writeCareerHistoryShards (the shard the page fetches, as shipped)
//            -> player-profile-v2.js renderCareerModal  (the season table AND the open drill, as painted)
// and asserts, for every non-empty cell under every Tier, that the drill paints exactly as many match rows
// as the cell it opened from counts, with the same wins and losses, and says "All N matches".
//
// What makes it fail: list the drill from any path other than the cell's own — e.g. have renderDrill() refuse
// Indoors again as it did before TEN-442 (every Indoors cell paints 0), drop seasonIndoor from calSpine() (the
// carved Hard / Indoors cells lose their rows), stop seasonCellOf() carving Indoor out of the surfaces (Hard lists
// the indoor matches too), skip the tier filter in drillScope(), list an unresolved court under its surface, or
// let playerMatchHistory read a different court map from buildAllTierYearly. Each runs below as a mutation and
// must go red.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const P = require('../bsp-pipeline.js');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); } };

const KEY = '7', CUR = 2026;
// tournament_key -> surface / court. 905 has no surface on record (counted in Total only, like the 5 Fils matches).
const surfaceMap = new Map([['900', 'hard'], ['901', 'hard'], ['902', 'clay'], ['903', 'grass'], ['904', 'clay'], ['906', 'hard']]);
const courtMap = new Map([['900', 'outdoor'], ['901', 'indoor'], ['902', 'outdoor'], ['903', 'outdoor'], ['904', 'indoor'], ['905', 'outdoor'], ['906', 'indoor']]);
const EVENTS = {
  900: ['Miami', 'Atp Singles'], 901: ['Rotterdam', 'Atp Singles'], 902: ['Rome', 'Atp Singles'], 903: ['Halle', 'Atp Singles'],
  904: ['Bergamo Challenger', 'Challenger Men Singles'], 905: ['Exhibition Cup', 'Atp Singles'], 906: ['Ortisei Challenger', 'Challenger Men Singles'],
};
let ek = 1000;
function fx(date, tk, won, opp, extra) {
  const [name, type] = EVENTS[tk];
  return Object.assign({
    event_key: String(ek++), event_date: date, tournament_key: String(tk), tournament_name: name, tournament_season: date.slice(0, 4),
    event_type_type: type, event_status: 'Finished', event_winner: won ? 'First Player' : 'Second Player',
    first_player_key: KEY, second_player_key: '99' + ek, event_first_player: 'P. Seven', event_second_player: opp,
    event_final_result: won ? '2 - 0' : '0 - 2', tournament_round: name + ' - 1/16-finals', event_qualification: 'False', scores: [],
  }, extra || {});
}
const fixtures = [
  // 2026: the Fils shape — indoor hard (2–2) carved out of a hard season, plus outdoor hard, clay, grass
  fx('2026-02-03', 901, true, 'V. Royer'), fx('2026-02-05', 901, true, 'U. Blanchet'), fx('2026-02-06', 901, false, 'F. Auger'),
  fx('2026-02-10', 901, false, 'A. De Minaur'),
  fx('2026-03-20', 900, true, 'A. Aa'), fx('2026-03-22', 900, false, 'B. Bb'),
  fx('2026-05-08', 902, true, 'C. Cc'), fx('2026-06-18', 903, true, 'D. Dd'),
  // 2025: a walkover (not a match — in neither the cell nor the list) and an unsurfaced match (Total only)
  fx('2025-03-01', 900, true, 'E. Ee', { event_status: 'Walk Over', event_final_result: '0 - 0' }),
  fx('2025-03-03', 900, false, 'F. Ff'), fx('2025-09-10', 905, true, 'G. Gg'),
  // 2023: Challenger-heavy, indoor clay at a Challenger and indoor hard at another, plus ATP outdoor clay
  fx('2023-01-10', 904, true, 'H. Hh'), fx('2023-01-11', 904, true, 'I. Ii'), fx('2023-01-12', 904, false, 'J. Jj'),
  fx('2023-10-02', 906, true, 'K. Kk'), fx('2023-10-03', 906, false, 'L. Ll'),
  fx('2023-04-15', 902, false, 'M. Mm'), fx('2023-04-16', 902, true, 'N. Nn', { event_status: 'Retired' }),
  // 2024: an indoor and an outdoor hard event with the SAME W–L — the season table's split alone cannot say which
  // is indoor, so without the per-match flag the court stays unknown (seasonCourts step 4 refuses to guess)
  fx('2024-02-12', 901, true, 'O. Oo'), fx('2024-02-13', 901, false, 'P. Pp'),
  fx('2024-03-08', 900, true, 'Q. Qq'), fx('2024-03-09', 900, false, 'R. Rr'),
];

function buildShard(fixturesIn, courtsForRows) {
  const careerByYear = P.buildAllTierYearly(fixturesIn, KEY, {}, CUR, surfaceMap, courtMap);
  const careerMatches = P.playerMatchHistory(fixturesIn, KEY, CUR, surfaceMap, courtsForRows || courtMap);
  const profiles = { [KEY]: { name: 'P. Seven', careerByYear, careerMatches } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten442-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  return P.writeCareerHistoryShards(profiles, { archive: {}, log: () => {}, currentYear: CUR }).then(() => {
    const shard = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history', KEY + '.json'), 'utf8'));
    process.chdir(cwd);
    return { profile: Object.assign({ key: KEY }, profiles[KEY]), rows: shard.matches };
  });
}

function loadModule(profile, rows, srcEdit) {
  let src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  if (srcEdit) {
    const out = srcEdit(src);
    if (out === src) throw new Error('mutation did not apply — the anchor moved');
    src = out;
  }
  const sb = { FEATURE_PP2: true, playerProfiles: { players: { [KEY]: profile } }, careerHistory: { [KEY]: rows },
    TournamentIdentity: require('../tournament-identity.js') };
  global.window = sb;
  new Function('window', src)(sb);
  return sb.PlayerProfileV2._internals;
}

const CELLS = ['', 'clay', 'hard', 'indoors', 'grass'];
// Opens every non-empty season cell, the career row and each surface row through the page's own state, and
// returns one line per mismatch between what the cell counts and what its drill paints.
function audit(I, p) {
  const bad = [];
  let opened = 0;
  for (const tier of ['all', 'atp', 'chitf']) {
    I.resetState();
    I.state.careerTab = 'record'; I.state.careerScope = 'career'; I.state.careerTier = tier;
    const scopes = p.careerByYear.map((y) => ({ key: String(y.year), g: I.tierGridCells(y, tier) }));
    scopes.push({ key: 'career', g: I.careerTierCells(p, tier) });
    for (const s of scopes) {
      for (const c of CELLS) {
        const rec = c ? s.g[c] : s.g.total;
        const n = rec ? (rec.won || 0) + (rec.lost || 0) : 0;
        if (!n) continue;
        I.state.careerDrill = { kind: 'cell', year: s.key, surf: c };
        const html = I.renderCareerModal(p);
        // The cell as painted in the table ("W/L") — read back, not recomputed.
        const m = new RegExp('data-v="' + s.key + '\\|' + c + '"[^>]*>(\\d+)/(\\d+)<').exec(html);
        if (!m) { bad.push(`${tier} ${s.key} ${c || 'total'}: the cell is not painted as a link`); continue; }
        if (+m[1] !== rec.won || +m[2] !== rec.lost) { bad.push(`${tier} ${s.key} ${c || 'total'}: painted ${m[1]}/${m[2]}`); continue; }
        const w = (html.match(/data-pp2-drill-row="W"/g) || []).length;
        const l = (html.match(/data-pp2-drill-row="L"/g) || []).length;
        const note = (/data-pp2-drill-note="1"[^>]*>([^<]*)</.exec(html) || [])[1];
        opened++;
        if (w !== rec.won || l !== rec.lost || note !== 'All ' + n + ' match' + (n === 1 ? '' : 'es')) {
          bad.push(`${tier} ${s.key} ${c || 'total'}: cell ${rec.won}/${rec.lost}, list ${w}/${l}, note "${note}"`);
        }
      }
    }
    // The surface rows above the table open the same drills, career-wide.
    for (const c of ['hard', 'clay', 'grass', 'indoors']) {
      const rec = I.careerTierCells(p, tier)[c];
      const n = rec ? rec.won + rec.lost : 0;
      if (n < 5) continue;   // a 1–4 row does not open (README §9 gate)
      I.state.careerDrill = { kind: 'surface', surf: c, year: null };
      const html = I.renderCareerModal(p);
      const rows = (html.match(/data-pp2-drill-row=/g) || []).length;
      opened++;
      if (rows !== n) bad.push(`${tier} surface row ${c}: counts ${n}, lists ${rows}`);
    }
  }
  return { bad, opened };
}

(async () => {
  const built = await buildShard(fixtures);
  const profile = built.profile;
  // A shard row in a season the table does not carry (2019): no drill may list it, the Career row included.
  const rows = built.rows.concat([Object.assign({}, built.rows[0], { year: '2019', date: '2019-06-01', opponent: 'Z. Outside' })]);
  const I = loadModule(profile, rows);

  check('fixture: the 2026 Indoors cell is the Fils shape (2/2, carved out of Hard)', () => {
    const g = I.tierGridCells(profile.careerByYear.find((y) => y.year === '2026'), 'all');
    assert.deepStrictEqual([g.indoors, g.hard, g.total], [{ won: 2, lost: 2 }, { won: 1, lost: 1 }, { won: 5, lost: 3 }]);
  });
  check('fixture: an unsurfaced match is counted in the 2025 Total and in no surface', () => {
    const y = profile.careerByYear.find((r) => r.year === '2025');
    assert.deepStrictEqual([y.total, y.hard, y.clay, y.grass], [{ won: 1, lost: 1 }, { won: 0, lost: 1 }, null, null]);
  });

  const base = audit(I, profile);
  check(`every opened drill paints exactly its cell's matches (${base.opened} drills opened)`, () => {
    assert.ok(base.opened >= 30, 'too few drills opened — the fixture or the state drive is broken: ' + base.opened);
    assert.deepStrictEqual(base.bad, []);
  });
  check('the 2025 Total lists the unsurfaced match, marked "No surface"', () => {
    I.resetState(); I.state.careerDrill = { kind: 'cell', year: '2025', surf: '' };
    assert.ok(/No surface/.test(I.renderCareerModal(profile)));
  });
  check('the 2026 Indoors drill lists Montpellier-shape rows as Indoor, never as an empty panel', () => {
    I.resetState(); I.state.careerDrill = { kind: 'cell', year: '2026', surf: 'indoors' };
    const html = I.renderCareerModal(profile);
    assert.strictEqual((html.match(/data-pp2-drill-row=/g) || []).length, 4);
    assert.ok(/Hard · Indoor · ATP/.test(html), 'group meta does not state surface · court · tier');
  });

  // ── a cell the store cannot fully back: show what exists, state the gap, never pad ──
  {
    // The shard as a pre-TEN-395 profile wrote it: no per-match court flag on any row.
    const stale = rows.map((r) => { const o = Object.assign({}, r); delete o.indoor; return o; });
    const Is = loadModule(profile, stale);
    Is.resetState(); Is.state.careerDrill = { kind: 'cell', year: '2026', surf: 'indoors' };
    const html = Is.renderCareerModal(profile);
    const note = (/data-pp2-drill-note="1"[^>]*>([^<]*)</.exec(html) || [])[1] || '';
    const painted = (html.match(/data-pp2-drill-row=/g) || []).length;
    check('stale shard: the Indoors drill never pads and states the gap in counts', () => {
      // Step 4 of seasonCourts() may still resolve whole events from the table's own split; whatever it
      // cannot place is stated, and the painted rows plus the stated gap always make up the cell.
      const m = /^(\d+) counted · (\d+) found in results · (\d+) missing/.exec(note);
      if (painted === 4) assert.strictEqual(note, 'All 4 matches');
      else {
        assert.ok(m, 'no counted/found/missing note: "' + note + '"');
        assert.deepStrictEqual([+m[1], +m[2], +m[1] - +m[3]], [4, painted, painted]);
        assert.ok(/no court type on record yet/.test(note), 'the reason is not named: "' + note + '"');
      }
    });
  }
  check('stale shard: an unresolvable season states the gap and its reason, word for word', () => {
    const Is = loadModule(profile, rows.map((r) => { const o = Object.assign({}, r); delete o.indoor; return o; }));
    const noteOf = (surf) => { Is.resetState(); Is.state.careerDrill = { kind: 'cell', year: '2024', surf };
      const h = Is.renderCareerModal(profile);
      return [(h.match(/data-pp2-drill-row=/g) || []).length, (/data-pp2-drill-note="1"[^>]*>([^<]*)</.exec(h) || [])[1]]; };
    assert.deepStrictEqual(noteOf('indoors'), [0, '2 counted · 0 found in results · 2 missing · 4 matches have no court type on record yet']);
    assert.deepStrictEqual(noteOf('hard'), [0, '2 counted · 0 found in results · 2 missing · 4 hard matches have no court type on record yet']);
    // r2 item 6 · the Total lists the unresolved-court rows and names them — they vanish nowhere
    assert.deepStrictEqual(noteOf(''), [4, 'All 4 matches · 4 have no court type on record yet']);
  });
  // r2 item 5 · a pre-window season (provider aggregate, tour-level archive rows) names its gap
  check('a pre-2021 season states "N not in database · Challenger/ITF results before 2021 not in database"', () => {
    const pre = Object.assign({}, profile, { careerByYear: profile.careerByYear.concat([{ year: '2020', allTier: false,
      total: { won: 2, lost: 1 }, clay: { won: 2, lost: 1 }, hard: null, grass: null, indoor: null, atp: null, chitf: null }]) });
    const Ip = loadModule(pre, rows);
    const noteOf = (year, surf) => { Ip.resetState(); Ip.state.careerDrill = { kind: 'cell', year, surf };
      return (/data-pp2-drill-note="1"[^>]*>([^<]*)</.exec(Ip.renderCareerModal(pre)) || [])[1]; };
    const cut = String(new Date().getFullYear() - 5);
    assert.strictEqual(noteOf('2020', ''), '3 counted · 0 found in results · 3 not in database · Challenger/ITF results before ' + cut + ' not in database');
    assert.strictEqual(noteOf('2020', 'clay'), '3 counted · 0 found in results · 3 not in database · Challenger/ITF results before ' + cut + ' not in database');
    // the Career row names that part of its gap, and only that part
    assert.ok(/^\d+ counted · \d+ found in results · 3 not in database · Challenger\/ITF results before \d{4} not in database$/.test(noteOf('career', '')),
      'career note: ' + noteOf('career', ''));
  });
  // r2 item 3 · Option A: the footnote says where the unsurfaced matches are listed, with the player's own count
  check('the Career footnote reads "N Davis Cup matches with no surface — listed under the year total" from his own rows', () => {
    const dc = rows.map((r) => (r.tournament === 'Exhibition Cup' ? Object.assign({}, r, { tournament: 'ATP Davis Cup - World Group' }) : r));
    const Id = loadModule(profile, dc);
    Id.resetState();
    const html = Id.renderCareerModal(profile);
    assert.ok(/>1 Davis Cup match with no surface — listed under the year total</.test(html), 'footnote: ' + (html.match(/>[^<>]*no surface[^<>]*</) || [''])[0]);
    // season by season: a stored no-surface row in a season whose total does not count it is not "listed"
    const moved = dc.map((r) => (/davis cup/i.test(r.tournament) ? Object.assign({}, r, { year: '2026', date: '2026-09-10' }) : r));
    const Im = loadModule(profile, moved);
    Im.resetState();
    assert.ok(/>1 match with no surface on record</.test(Im.renderCareerModal(profile)), 'a mis-seasoned row was called listed');
    // a non-Davis-Cup unsurfaced row is listed but not called Davis Cup
    I.resetState();
    assert.ok(/>1 match with no surface — listed under the year total</.test(I.renderCareerModal(profile)));
  });
  check('a career-history shard that has not answered says "match list loading", never a count', () => {
    const sb = loadModule(profile, rows);
    delete global.window.careerHistory[KEY];
    sb.resetState(); sb.state.careerDrill = { kind: 'cell', year: '2026', surf: 'indoors' };
    const note = (/data-pp2-drill-note="1"[^>]*>([^<]*)</.exec(sb.renderCareerModal(profile)) || [])[1];
    assert.strictEqual(note, 'match list loading');
  });

  // ── negative controls: each wiring break must turn the audit red ──
  const MUT = [
    ['the drill refuses Indoors again (the pre-TEN-442 behaviour)', (s) => s.replace(
      "var rows = opts.surf ? scope.filter(function (r) { return r.cell === opts.surf; }) : scope;",
      "var rows = opts.surf === 'indoors' ? [] : opts.surf ? scope.filter(function (r) { return r.cell === opts.surf; }) : scope;")],
    ['calSpine drops the per-match court flag', (s) => s.replace(
      "seasonIndoor: typeof r.indoor === 'boolean' ? r.indoor : null,", 'seasonIndoor: null,')],
    ['seasonCellOf stops carving Indoors out of the surfaces', (s) => s.replace(
      "if (court === 'Indoor') return 'indoors';\n    if (carved", "if (carved")],
    ['drillScope skips the tier filter', (s) => s.replace("if (t && r.tier !== t) return;", '')],
  ];
  for (const [name, edit] of MUT) {
    check('negative control — ' + name + ' → the audit goes red', () => {
      const r = audit(loadModule(profile, rows, edit), profile);
      assert.ok(r.bad.length > 0, 'the mutation passed the audit: the test cannot see this break');
    });
  }
  // Never pad: on a shard with no court flag, a carved season's unresolved rows (2024: two hard events, same W–L,
  // one indoor) belong to exactly one of Hard or Indoors, so neither may list them. Listing them under their
  // surface would paint more rows than the outdoor-only Hard cell counts.
  const staleRows = rows.map((r) => { const o = Object.assign({}, r); delete o.indoor; return o; });
  const overList = (Ix) => {
    const out = [];
    Ix.resetState();
    for (const y of profile.careerByYear) {
      const g = Ix.tierGridCells(y, 'all');
      for (const c of ['hard', 'indoors']) {
        if (!g[c]) continue;
        Ix.state.careerDrill = { kind: 'cell', year: String(y.year), surf: c };
        const n = (Ix.renderCareerModal(profile).match(/data-pp2-drill-row=/g) || []).length;
        if (n > g[c].won + g[c].lost) out.push(`${y.year} ${c}: lists ${n} > ${g[c].won + g[c].lost}`);
      }
    }
    return out;
  };
  check('stale shard: no carved cell lists more than it counts (2024 Hard / Indoors stay within their cells)', () => {
    assert.deepStrictEqual(overList(loadModule(profile, staleRows)), []);
  });
  check('negative control — drillScope lists a season the table does not carry → the audit goes red', () => {
    const r = audit(loadModule(profile, rows, (s) => s.replace("} else if (!seasons[r.year]) return;", "} else if (!seasons[r.year]) seasons[r.year] = { carved: false };")), profile);
    assert.ok(r.bad.length > 0, 'the out-of-table row passed');
  });
  check('negative control — seasonCellOf lists an unresolved court under its surface → Hard over-lists', () => {
    const r = overList(loadModule(profile, staleRows, (s) => s.replace("if (carved && court !== 'Outdoor') return COURT_UNKNOWN;", '')));
    assert.ok(r.length > 0, 'padding passed');
  });
  // The pipeline twins must read one court map: a list built on a different map than the cell must go red.
  const other = await buildShard(fixtures, new Map([...courtMap].map(([k, v]) => [k, k === '901' ? 'outdoor' : v])));
  check('negative control — playerMatchHistory reads a different court map → the audit goes red', () => {
    const r = audit(loadModule(profile, other.rows), profile);
    assert.ok(r.bad.length > 0, 'a court-map split between the twins passed');
  });

  console.log(`\nten442-season-drills: ${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
