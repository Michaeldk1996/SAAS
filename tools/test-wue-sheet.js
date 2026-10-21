// W/UE tournament sheet (founder brief 2026-10-20) — export rules + pipeline rows + wiring.
//
//   1 · Acceptance   Michael's hand-entered Almaty 2026 R1 rows (W / UE / TT points / Dominance) reproduce exactly
//                    from the pinned real fixture (api-tennis, built by progressionSheetMatches on the live feed).
//   2 · Formulas     W/P, UE/P, W/UE, Bialik DR = returnPtsWon% / (100 − servicePtsWon%), 2 decimals.
//   3 · Dashes       an absent stat or a zero denominator is the em dash, never 0; a real 0 count stays 0.
//   4 · Flags        retired / walkover rows are flagged on the player cell.
//   5 · Pipeline     progressionSheetMatches keeps stat-less completed fixtures (nulls), stamps status, orders by play.
//   6 · Fresh read   the export fetches tournament-progression.json at click time, cache-busted + no-store.
//   7 · xlsx         a valid stored ZIP (CRCs check), one tab per round, header + 2 rows per match.
//   8 · Wiring       the page loads wue-sheet.js and renders the bar; the deploy copies + asserts the file.
//
// Run: node tools/test-wue-sheet.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`); }
}
console.log('W/UE tournament sheet');

const W = require(path.join(ROOT, 'wue-sheet.js'));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wue-sheet', 'almaty-2026-r1.json'), 'utf8'));

// ── 1 · acceptance (founder's hand-entered rows; reported as match/mismatch, never adjusted) ──
const rounds = W.sheetRounds(FX);
check('fixture is non-empty: 1 round, 9 matches → 9 winner rows (winners only, ruling 2026-10-20)', rounds.length === 1 && rounds[0].rows.length === 9, JSON.stringify(rounds.map(r => r.rows.length)));
const row = (n) => rounds[0].rows.find(r => r.player === n);
for (const [name, w, ue, tt, dr] of [['F. Diaz Acosta', 26, 24, 186, 1.54], ['A. Mannarino', 34, 37, 205, 1.45], ['J. Duckworth', 27, 18, 113, 1.21]]) {
  const r = row(name);
  check(`acceptance ${name} ${w}/${ue}/${tt}/${dr}`, r && r.values[0] === w && r.values[1] === ue && r.values[2] === tt && r.values[6] === dr,
    r ? JSON.stringify(r.values) : 'row missing');
}
check('tab is named by the actual round (R32), never "ROUND 1"', rounds[0].title === 'R32', rounds[0].title);
check('winners in order of play, losers removed (08:40 Kecmanovic–Duckworth → Duckworth first; no Kecmanovic row)', rounds[0].rows[0].player === 'J. Duckworth' && !rounds[0].rows.some(r => r.player === 'M. Kecmanovic'));

// ── 2 · formulas ──
const d = row('J. Duckworth').values;
check('W/P = W ÷ TT (27/113 = 0.24)', d[3] === 0.24, d[3]);
check('UE/P = UE ÷ TT (18/113 = 0.16)', d[4] === 0.16, d[4]);
check('W/UE = W ÷ UE (27/18 = 1.50)', d[5] === 1.5, d[5]);
check('DR from raw counts: 60/100 return, 50/100 serve → 60/(100−50) = 1.2',
  W.dominanceRatio({ won: 50, total: 100 }, { won: 60, total: 100 }) === 1.2);
check('TSV: every stat with 2 dot decimals (ruling 2026-10-21)', W.roundTsv(rounds[0]).split('\n')[0] === 'J. Duckworth\t27.00\t18.00\t113.00\t0.24\t0.16\t1.50\t1.21', W.roundTsv(rounds[0]).split('\n')[0]);

// ── 3 · dashes vs zero ──
const side = (o) => Object.assign({ name: 'X. Test', winners: null, unforcedErrors: null, totalPoints: null, servicePoints: null, returnPoints: null }, o);
const absent = W.playerRow(side({}), 'finished');
check('no stat sheet → every value null (dash), none 0', absent.values.every(v => v === null), JSON.stringify(absent.values));
check('dash renders as em dash in TSV', W.roundTsv({ rows: [absent] }) === 'X. Test\t—\t—\t—\t—\t—\t—\t—');
const zeroUe = W.playerRow(side({ winners: 10, unforcedErrors: 0, totalPoints: 80 }), 'finished');
check('UE = 0 is a real 0, and W/UE (÷0) is a dash', zeroUe.values[1] === 0 && zeroUe.values[5] === null && zeroUe.values[4] === 0, JSON.stringify(zeroUe.values));
check('won every service point → DR dash, not Infinity', W.dominanceRatio({ won: 40, total: 40 }, { won: 10, total: 50 }) === null);
check('W known, TT absent → W/P dash', W.playerRow(side({ winners: 5, unforcedErrors: 4 }), 'finished').values[3] === null);

// ── 4 · flags ──
check('retired flagged', W.playerRow(side({}), 'retired').player === 'X. Test [RET]');
check('walkover flagged', W.playerRow(side({}), 'walkover').player === 'X. Test [W/O]');
check('finished not flagged', W.playerRow(side({}), 'finished').player === 'X. Test');

// ── 5 · pipeline rows (module needs no network for this pure function) ──
process.env.API_TENNIS_KEY = process.env.API_TENNIS_KEY || 'test';
const { progressionSheetMatches: psm } = require(path.join(ROOT, 'bsp-pipeline.js'));
check('bsp-pipeline.js exports progressionSheetMatches', typeof psm === 'function');
const progressionSheetMatches = typeof psm === 'function' ? psm : () => [];
// stat_name arrives UPPER-cased here on purpose: the feed changes casing by season, and the reader must case-fold.
const st = (key, type, name, extra) => Object.assign({ stat_period: 'match', player_key: key, stat_type: type, stat_name: String(name).toUpperCase() }, extra);
const sheet = (k) => [
  st(k, 'Points', 'Winners', { stat_value: '20' }), st(k, 'Points', 'Unforced errors', { stat_value: '15' }),
  st(k, 'Points', 'Total Points Won', { stat_won: '70', stat_total: '140' }),
  st(k, 'Points', 'Service Points Won', { stat_won: '45', stat_total: '70' }),
  st(k, 'Points', 'Return Points Won', { stat_won: '25', stat_total: '70' }),
];
const fx = (ek, date, time, status, stats) => ({ event_key: ek, event_date: date, event_time: time, event_status: status, event_winner: 'First Player',
  tournament_name: 'Testville', tournament_round: 'Testville - 1/16-finals', first_player_key: 1, second_player_key: 2,
  event_first_player: 'A. One', event_second_player: 'B. Two', statistics: stats });
const out = progressionSheetMatches([
  fx(30, '2026-10-20', '12:00', 'Walk Over', []),
  fx(20, '2026-10-19', '15:00', 'Retired', [...sheet(1), ...sheet(2)]),
  fx(10, '2026-10-19', '15:00', 'Finished', [...sheet(1), ...sheet(2)]),
], { 'Testville - 1/16-finals': 'R1' });
check('every completed fixture kept, incl. the stat-less walkover', out.length === 3, out.length);
check('ordered by date, time, then event key', out.map(m => m.eventKey).join() === '10,20,30', out.map(m => m.eventKey).join());
check('status stamped', out.map(m => m.status).join() === 'finished,retired,walkover', out.map(m => m.status).join());
check('raw counts carried', out[0] && out[0].p1.winners === 20 && out[0].p1.unforcedErrors === 15 && out[0].p1.totalPoints === 140
  && out[0].p1.servicePoints.won === 45 && out[0].p1.returnPoints.total === 70 && out[0].p1.wueSource === 'api-tennis', JSON.stringify(out[0] && out[0].p1));
check('stat-less walkover publishes nulls, not 0', out[2] && ['winners', 'unforcedErrors', 'totalPoints', 'servicePoints', 'returnPoints'].every(k => out[2].p1[k] === null), JSON.stringify(out[2] && out[2].p1));
check('round label resolved', out[0] && out[0].round === 'R1');

// ── 6 · fresh read at click time ──
(async () => {
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ fetchedAt: '2026-10-20T11:00:00Z', tournaments: { Almaty: FX } }) }; };
  const got = await W.fetchLatest('Almaty');
  check('fetches tournament-progression.json then draws.json, both cache-busted + no-store (ruling 7: quarters at click time)',
    calls.length === 2 && /^\.\/tournament-progression\.json\?_=\d+$/.test(calls[0].url) && /^\.\/draws\.json\?_=\d+$/.test(calls[1].url)
    && calls.every(c => c.opts.cache === 'no-store'), JSON.stringify(calls));
  check('returns the fetched entry', got.entry === FX);
  let err = null;
  global.fetch = async () => ({ ok: true, json: async () => ({ tournaments: { Almaty: { rounds: ['R1'], players: [] } } }) });
  try { await W.fetchLatest('Almaty'); } catch (e) { err = e; }
  check('published entry without sheet rows fails loudly, never an empty sheet', err && /no per-match sheet rows/.test(err.message), err && err.message);
  check('file name carries tournament + season', W.fileName('Almaty', '2026-10-20T11:00:00Z') === 'Almaty 2026 W-UE.xlsx');

  // ── 7 · xlsx structure ──
  const z = Buffer.from(W.buildXlsx(FX));
  const entries = []; let p = 0;
  while (z.readUInt32LE(p) === 0x04034b50) {
    const crc = z.readUInt32LE(p + 14), size = z.readUInt32LE(p + 18), nlen = z.readUInt16LE(p + 26), xlen = z.readUInt16LE(p + 28);
    const name = z.slice(p + 30, p + 30 + nlen).toString(); const data = z.slice(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    entries.push({ name, crc, data }); p += 30 + nlen + xlen + size;
  }
  check('zip has the 6 SpreadsheetML parts', entries.map(e => e.name).join() === '[Content_Types].xml,_rels/.rels,xl/workbook.xml,xl/_rels/workbook.xml.rels,xl/styles.xml,xl/worksheets/sheet1.xml', entries.map(e => e.name).join());
  if (typeof zlib.crc32 === 'function') check('every CRC verifies (zlib.crc32)', entries.every(e => zlib.crc32(e.data) === e.crc));
  else check('every CRC verifies (module crc32 vs stored)', entries.every(e => W.crc32(e.data) === e.crc));
  check('end-of-central-directory record present', z.readUInt32LE(z.length - 22) === 0x06054b50 && z.readUInt16LE(z.length - 12) === entries.length);
  const wb = entries.find(e => e.name === 'xl/workbook.xml').data.toString();
  check('one tab named R32', /<sheet name="R32" sheetId="1"/.test(wb) && (wb.match(/<sheet /g) || []).length === 1);
  const ws = entries.find(e => e.name === 'xl/worksheets/sheet1.xml').data.toString();
  check('header + 9 winner rows', (ws.match(/<row /g) || []).length === 10);
  check('header columns in brief order', W.COLUMNS.join('|') === 'Player|W|UE|TT points|W/P|UE/P|Ratio W/UE|Dominance Ratio' && W.COLUMNS.every(c => ws.includes(`<t>${c}</t>`)));
  check('ratios carry the 0.00 number format', /<c r="E2" s="2"><v>0.24<\/v><\/c>/.test(ws), ws.slice(ws.indexOf('<row r="2"'), ws.indexOf('<row r="2"') + 200));
  const empty = W.workbookFiles(W.sheetRounds({ rounds: [], matches: [] }));
  check('no completed match → one explicit "NO COMPLETED MATCHES" tab, no rows invented', /name="NO COMPLETED MATCHES"/.test(empty[2][1]) && (empty[5][1].match(/<row /g) || []).length === 1);

  // ── 8 · wiring ──
  const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  check('page loads wue-sheet.js', html.includes('<script src="wue-sheet.js"></script>'));
  check('Reports card renders the W/UE bar', html.includes("${filterBar}${partialLine}${typeof tourxWueBarHtml === 'function' ? tourxWueBarHtml(tourxState.tour) : ''}${viewBar}${body}"));
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
  check('deploy copies wue-sheet.js into _site', yml.includes('cp wue-sheet.js _site/'));
  check('deploy asserts wue-sheet.js present', /h2h-core\.js wue-sheet\.js( draw-view\.js)? \\/.test(yml));
  check('live publish lane copies wue-sheet.js (tools/site-code.sh)', fs.readFileSync(path.join(ROOT, 'tools', 'site-code.sh'), 'utf8').includes('cp wue-sheet.js "$SITE/"'));
  check('live publish lane requires wue-sheet.js (publish-site.mjs CODE_REQUIRED)', /CODE_REQUIRED = \[[^\]]*'wue-sheet\.js'/.test(fs.readFileSync(path.join(ROOT, 'tools', 'publish-site.mjs'), 'utf8')));
  const pipe = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
  check('progression entry publishes matches[]', pipe.includes('matches: progressionSheetMatches(played, roundLabelByName),'));

  // ruling 2026-10-21: every stat cell is a NUMBER (never text) with the 0.00 format, and Copy uses a dot decimal whatever
// the viewer's locale — proven under a comma-decimal locale (de-DE) forced onto toLocaleString / Intl.
{
  const z2 = Buffer.from(W.buildXlsx(FX)).toString('latin1'), sd = z2.slice(z2.indexOf('<sheetData>'), z2.indexOf('</sheetData>'));
  const nums = [...sd.matchAll(/<c r="([B-H])(\d+)"( s="(\d)")?><v>([^<]*)<\/v><\/c>/g)];
  check('xlsx: every stat cell (W, UE, TT, W/P, UE/P, W/UE, DR) is a number with the 0.00 format (s=2); none is text', nums.length === 63 && nums.every(m => m[4] === '2' && /^-?\d+(\.\d+)?$/.test(m[5])) && !/<c r="[B-H]\d+" t="inlineStr"><is><t xml:space="preserve">\d/.test(sd), `${nums.length} numeric cells`);
  const tl = Number.prototype.toLocaleString, NF = Intl.NumberFormat;
  Number.prototype.toLocaleString = function () { return tl.call(this, 'de-DE', { minimumFractionDigits: 2 }); };
  Intl.NumberFormat = function () { return new NF('de-DE'); };
  const t = W.roundTsv(rounds[0]);
  Number.prototype.toLocaleString = tl; Intl.NumberFormat = NF;
  check('Copy under a comma-decimal locale still prints dot decimals ("27.00", "0.24"), never "27,00"', /\t27\.00\t/.test(t) && /\t0\.24\t/.test(t) && !/\d,\d/.test(t), t.split('\n')[0]);
}
console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
