// TEN-158 QA gate: durable round/qualifying labels must be derived ONLY from
// settled, final fixtures. Reproduces the TEN-157 Blockx/Trungelliti class:
// a mid-match snapshot with a declared winner but in-play event_status must be
// neither classified nor cached. Drives the REAL exported fetchPlayerCareerHistory
// through a mocked feed — no logic duplication.
const PK = '39913'; // Blockx
function fx(over) {
  return Object.assign({
    tournament_name: 'US Open', tournament_round: '1/32-finals', // R64 = 2nd round
    event_qualification: 'False',
    first_player_key: PK, second_player_key: '395',
    event_first_player: 'A. Blockx', event_second_player: 'M. Trungelliti',
    event_winner: 'First Player', tournament_season: '2026',
    event_date: '2026-08-30', event_final_result: '3 - 1',
    event_status: 'Finished',
  }, over);
}
function mockFeed(result) {
  global.fetch = async () => ({ json: async () => ({ success: true, result }) });
}
const path = process.argv[2] || require("path").join(__dirname, "bsp-pipeline.js");
const { fetchPlayerCareerHistory } = require(path);

function findMatch(history, tName) {
  if (!Array.isArray(history)) return null;
  const t = history.find(h => h.name === tName);
  if (!t) return null;
  const rows = [];
  for (const e of (t.editions || [])) for (const m of (e.matches || [])) rows.push({ ...m, year: e.year });
  return { t, rows };
}

(async () => {
  let pass = 0, fail = 0;
  const check = (name, cond, detail) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, '::', detail); } };

  // --- 1. Transient in-play snapshot, winner already declared, score lagging "2 - 1" ---
  mockFeed([ fx({ event_status: 'Set 3', event_final_result: '2 - 1' }) ]);
  let h = await fetchPlayerCareerHistory(PK);
  let hit = findMatch(h, 'US Open');
  check('in-play Slam R64 snapshot is NOT classified/cached',
        !hit || hit.rows.length === 0, `leaked rows=${JSON.stringify(hit && hit.rows)}`);

  // --- 2. Same match, now Finished with a settled 3-1 score -> classifies as a real R64 win (never Q) ---
  mockFeed([ fx({ event_status: 'Finished', event_final_result: '3 - 1' }) ]);
  h = await fetchPlayerCareerHistory(PK);
  hit = findMatch(h, 'US Open');
  const m2 = hit && hit.rows[0];
  check('finished Slam R64 classifies as a real R64 win', !!m2 && m2.round === 'R64' && m2.res === 'W', `got=${JSON.stringify(m2)}`);
  check('finished Slam R64 is NOT mislabeled Q', !!m2 && m2.round !== 'Q', `got round=${m2 && m2.round}`);

  // --- 3. Non-Slam WORD-label in-play snapshot (isolates the status guard from the TEN-157 _frac patch) ---
  mockFeed([ fx({ tournament_name: 'ATP Cincinnati', tournament_round: 'Quarter-finals',
                  event_status: 'Set 2', event_final_result: '1 - 0' }) ]);
  h = await fetchPlayerCareerHistory(PK);
  hit = findMatch(h, 'Cincinnati') || findMatch(h, 'ATP Cincinnati');
  check('in-play non-Slam QF snapshot is NOT classified', !hit || hit.rows.length === 0, `leaked=${JSON.stringify(hit && hit.rows)}`);

  // --- 4. Retired + Walk Over remain terminal (must still classify) ---
  mockFeed([ fx({ event_status: 'Retired', event_final_result: '2 - 1' }),
             fx({ tournament_name: 'ATP Rome', tournament_round: '1/16-finals', event_status: 'Walk Over', event_final_result: '' }) ]);
  h = await fetchPlayerCareerHistory(PK);
  const uso = findMatch(h, 'US Open'), rome = findMatch(h, 'Rome') || findMatch(h, 'ATP Rome') || findMatch(h, 'Internazionali BNL d\'Italia') || findMatch(h, 'Italian Open');
  check('Retired terminal still classifies', !!uso && uso.rows.length === 1, `uso=${JSON.stringify(uso && uso.rows)}`);
  check('Walk Over terminal still classifies', !!rome && rome.rows.length === 1, `rome=${JSON.stringify(rome && rome.rows)}`);

  console.log(`\nTEN-158 QA: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('QA harness error:', e); process.exit(2); });
