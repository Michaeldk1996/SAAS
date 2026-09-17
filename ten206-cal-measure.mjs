// TEN-206 §5.4 · measurement harness for the Calendar-record rebuild.
//
// The founder's item 1 moves the heat grid off the priced archive and onto "the
// career match rows (same spine as Career record, all ruled levels)". Before any
// renderer is written this script answers the three questions that decide
// whether that is even buildable:
//
//   1. can every career row carry a MONTH?  (the grid is year x month)
//   2. how far does the grid total sit from the ruled career total (careerByYear)?
//   3. what fraction of the grid carries a Pinnacle closing price, i.e. how big
//      is the priced subset the yield rows are computed over?
//
// Reads the DEPLOYED shards, never the repo copies — the JSON is cron-refreshed
// and the committed files lag (memory: "live != committed profiles").
const BASE = 'https://michaeldk1996.github.io/SAAS';

async function j(path) {
  const res = await fetch(`${BASE}/${path}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

function oppKeyOf(name) {
  let s = String(name || '').trim();
  const c = s.indexOf(',');
  if (c > 0) s = s.slice(0, c);
  else if (/^[A-Za-z]\.\s+/.test(s)) s = s.replace(/^[A-Za-z]\.\s+/, '');
  else s = s.replace(/(\s+[A-Za-z]\.)+$/, '');
  return s.toLowerCase().replace(/[^a-z]/g, '');
}
function evKeyOf(name) {
  let s = String(name || '');
  const i = s.indexOf(' - ');
  if (i > 0) s = s.slice(0, i);
  s = s.replace(/^(ATP|WTA|ITF)\s+/i, '');
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// One entry per (key, value) pair; a key claimed twice is poisoned to null so a
// collision can never be resolved by picking one side (§3).
function uniqIndex(list, keyOf) {
  const m = {};
  for (const r of list) {
    const k = keyOf(r);
    if (Object.prototype.hasOwnProperty.call(m, k)) m[k] = null;
    else m[k] = r;
  }
  return m;
}

async function measure(key, label) {
  const [prof, mk, ch] = await Promise.all([
    j(`profiles/${key}.json`), j(`market-edge/${key}.json`), j(`career-history/${key}.json`)
  ]);
  const p = prof && prof.profile;
  if (!p) { console.log(`${label}: no profile shard`); return null; }
  const chRows = (ch && ch.matches) || [];
  const mkRows = (mk && mk.matches) || [];
  const rf = ((p.recentForm && p.recentForm.matches) || []);
  const cby = (p.careerByYear || []).filter(y => y && y.total);
  const spine = cby.reduce((a, y) => a + (y.total.won || 0) + (y.total.lost || 0), 0);

  // ── Q1 · month coverage of the career rows ────────────────────────────────
  const dated = chRows.filter(r => r && typeof r.date === 'string' && /^\d{4}-\d{2}/.test(r.date));

  // ── the display-name map · career-history's event vocabulary is NOT the
  // tournament modal's. Vote a tournamentHistory name per career-history event
  // off the (year, surname) join, exactly as tournJoin() votes the market names.
  const th = p.tournamentHistory || [];
  const thOwner = {};
  for (const t of th) for (const e of (t.editions || [])) for (const m of (e.matches || [])) {
    const k = `${e.year}|${oppKeyOf(m.opp)}`;
    if (!Object.prototype.hasOwnProperty.call(thOwner, k)) thOwner[k] = t.name;
    else if (thOwner[k] !== t.name) thOwner[k] = null;
  }
  const votes = {};
  for (const r of dated) {
    const owner = thOwner[`${String(r.date).slice(0, 4)}|${oppKeyOf(r.opponent)}`];
    if (!owner) continue;
    (votes[r.tournament] = votes[r.tournament] || {})[owner] =
      ((votes[r.tournament] || {})[owner] || 0) + 1;
  }
  const alias = {};
  for (const ev of Object.keys(votes)) {
    alias[ev] = Object.keys(votes[ev]).sort((a, b) => votes[ev][b] - votes[ev][a])[0];
  }
  const namedRows = dated.filter(r => alias[r.tournament]).length;

  // ── Q3 · the priced join. market-edge rows are dated, so the spine joins on
  // (date, surname) first and falls back to (year, event, surname).
  const mkByDate = uniqIndex(mkRows, r => `${r.date}|${oppKeyOf(r.opp)}`);
  const mkByEv = uniqIndex(mkRows.map(r => ({ r, ev: alias[r.event] || r.event })),
    x => `${String(x.r.date).slice(0, 4)}|${evKeyOf(x.ev)}|${oppKeyOf(x.r.opp)}`);
  let pricedStrong = 0, pricedWeak = 0, pinnacle = 0;
  const priced = new Map();
  dated.forEach((r, i) => {
    const d = mkByDate[`${r.date}|${oppKeyOf(r.opponent)}`];
    let row = null;
    if (d) { row = d; pricedStrong++; }
    else {
      const evName = alias[r.tournament] || r.tournament;
      const w = mkByEv[`${String(r.date).slice(0, 4)}|${evKeyOf(evName)}|${oppKeyOf(r.opponent)}`];
      if (w) { row = w.r; pricedWeak++; }
    }
    if (row && row.book === 'pinnacle' && row.price != null && row.pl != null) {
      pinnacle++; priced.set(i, row);
    }
  });

  // ── set scores for the drill's SCORE column — recentForm only, by measurement
  const rfByDate = uniqIndex(rf.filter(m => m && m.date),
    m => `${m.date}|${oppKeyOf(m.opponent)}`);
  const withSets = dated.filter(r => {
    const m = rfByDate[`${r.date}|${oppKeyOf(r.opponent)}`];
    return m && (m.sets || []).length;
  }).length;

  const years = dated.map(r => String(r.date).slice(0, 4)).sort();
  const out = {
    label, key,
    spineCareerByYear: spine,
    careerHistoryRows: chRows.length,
    datedRows: dated.length,
    gridSpan: years.length ? `${years[0]}-${years[years.length - 1]}` : null,
    gapVsSpine: spine - dated.length,
    displayNameCoverage: `${namedRows}/${dated.length} (${(100 * namedRows / (dated.length || 1)).toFixed(1)}%)`,
    pricedJoin: `${pricedStrong} strong + ${pricedWeak} weak`,
    pinnaclePriced: pinnacle,
    pinnacleShare: `${(100 * pinnacle / (dated.length || 1)).toFixed(1)}%`,
    marketEdgeRows: mkRows.length,
    setScoreCoverage: `${withSets}/${dated.length}`
  };
  console.log(JSON.stringify(out, null, 2));
  return { out, dated, priced, alias, p };
}

const TARGETS = [
  ['1980', 'A. Zverev (rank 2)'],
  ['1775', 'P. Martinez (rank 132)'],
];
for (const [k, l] of TARGETS) await measure(k, l);
