#!/usr/bin/env node
// TEN-206 audit — the non-api-tennis sources, measured from the real files on disk.
// Every store lives in the MAIN checkout (all of these dirs are gitignored, so a fresh
// worktree sees them empty — that is itself a finding).
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/Michael/bsp-consult-project';
const out = {};
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const csv = p => {
  const lines = rd(p).split('\n').filter(l => l.trim());
  const head = lines[0].split(',');
  return { head, rows: lines.slice(1).map(l => l.split(',')), n: lines.length - 1 };
};
const fill = (rows, head, col) => {
  const i = head.indexOf(col);
  if (i < 0) return null;
  const ok = rows.filter(r => r[i] !== undefined && r[i] !== '' && r[i] !== 'NA').length;
  return { col, pct: +(100 * ok / rows.length).toFixed(1), n: ok };
};

// ── 1. TML (Tennismylife/TML-Database mirror) ───────────────────────────────
{
  const years = fs.readdirSync(path.join(ROOT, 'tml-cache')).filter(f => /^\d{4}\.csv$/.test(f)).sort();
  const per = [];
  let levels = new Map();
  for (const f of years) {
    const { head, rows, n } = csv(`tml-cache/${f}`);
    const di = head.indexOf('tourney_date'), li = head.indexOf('tourney_level');
    const dates = rows.map(r => r[di]).filter(Boolean).sort();
    for (const r of rows) levels.set(r[li], (levels.get(r[li]) || 0) + 1);
    per.push({
      year: f.slice(0, 4), n,
      first: dates[0], last: dates[dates.length - 1],
      ace: fill(rows, head, 'w_ace')?.pct, minutes: fill(rows, head, 'minutes')?.pct,
      bp: fill(rows, head, 'w_bpSaved')?.pct, rank: fill(rows, head, 'winner_rank')?.pct,
    });
  }
  out.TML = { files: years.length, head: csv(`tml-cache/${years[0]}`).head, per, levels: Object.fromEntries(levels) };
}

// ── 2. chall-cache (Sackmann-schema Challenger+qualifying) ──────────────────
{
  const files = fs.readdirSync(path.join(ROOT, 'chall-cache')).filter(f => f.endsWith('.csv')).sort();
  const per = [];
  for (const f of files) {
    const { head, rows, n } = csv(`chall-cache/${f}`);
    const li = head.indexOf('tourney_level');
    const lv = new Map(); for (const r of rows) lv.set(r[li], (lv.get(r[li]) || 0) + 1);
    per.push({ file: f, n, levels: Object.fromEntries(lv), ace: fill(rows, head, 'w_ace')?.pct, minutes: fill(rows, head, 'minutes')?.pct });
  }
  out.CHALL = { files: files.length, per };
}

// ── 3. MatchChartingProject ─────────────────────────────────────────────────
{
  const m = csv('mcp-cache/matches.csv');
  const di = m.head.indexOf('Date'), p1 = m.head.indexOf('Player 1');
  const ids = m.rows.map(r => r[0]);
  const men = ids.filter(id => /^\d{8}-M-/.test(id)).length;
  const women = ids.filter(id => /^\d{8}-W-/.test(id)).length;
  const yr = new Map();
  for (const id of ids) { const y = id.slice(0, 4); if (/^\d{4}$/.test(y)) yr.set(y, (yr.get(y) || 0) + 1); }
  const o = csv('mcp-cache/overview.csv');
  const oi = { set: o.head.indexOf('set'), w: o.head.indexOf('winners'), u: o.head.indexOf('unforced'), mid: 0 };
  const total = o.rows.filter(r => r[oi.set] === 'Total');
  const wOk = total.filter(r => r[oi.w] !== '' && r[oi.w] !== undefined).length;
  const uOk = total.filter(r => r[oi.u] !== '' && r[oi.u] !== undefined).length;
  const menMids = new Set(ids.filter(id => /^\d{8}-M-/.test(id)));
  const menTotal = total.filter(r => menMids.has(r[oi.mid]));
  out.MCP = {
    matches: m.n, men, women,
    byYear: Object.fromEntries([...yr].sort()),
    overviewRows: o.n, totalRows: total.length,
    winnersFillPct: +(100 * wOk / total.length).toFixed(1),
    unforcedFillPct: +(100 * uOk / total.length).toFixed(1),
    menTotalRows: menTotal.length,
    overviewHead: o.head,
    hasNetPointsColumn: o.head.some(h => /net/i.test(h)),
    files: fs.readdirSync(path.join(ROOT, 'mcp-cache')),
  };
}

// ── 4. Tennis-Data (odds-archive mirror) ────────────────────────────────────
{
  const files = fs.readdirSync(path.join(ROOT, 'odds-archive')).filter(f => f.endsWith('.csv')).sort();
  const per = [];
  for (const f of files) {
    const { head, rows, n } = csv(`odds-archive/${f}`);
    const di = head.findIndex(h => /^date$/i.test(h));
    const dates = rows.map(r => r[di]).filter(Boolean).sort();
    per.push({
      year: f.slice(0, 4), n, first: dates[0], last: dates[dates.length - 1],
      psw: fill(rows, head, 'psw')?.pct ?? fill(rows, head, 'PSW')?.pct,
      b365: fill(rows, head, 'b365w')?.pct ?? fill(rows, head, 'B365W')?.pct,
      avgw: fill(rows, head, 'avgw')?.pct ?? fill(rows, head, 'AvgW')?.pct,
      maxw: fill(rows, head, 'maxw')?.pct ?? fill(rows, head, 'MaxW')?.pct,
    });
  }
  out.TENNISDATA = { files: files.length, head: csv(`odds-archive/${files[0]}`).head, per };
}

// ── 5. Oddspapi bet365-history ──────────────────────────────────────────────
{
  const dir = path.join(ROOT, 'bet365-history');
  const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).sort();
  const per = [];
  let totalFixtures = 0;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const arr = Array.isArray(j) ? j : (j.fixtures || j.matches || Object.values(j).find(Array.isArray) || []);
    totalFixtures += arr.length;
    per.push({ file: f, fixtures: arr.length, keys: arr[0] ? Object.keys(arr[0]) : Object.keys(j).slice(0, 12) });
  }
  out.ODDSPAPI = { files, totalFixtures, per: per.map(p => ({ file: p.file, fixtures: p.fixtures })), sampleKeys: per[0]?.keys };
}

// ── 6. Our own published stores ─────────────────────────────────────────────
{
  const stores = {};
  for (const d of ['career-history', 'splits-matches', 'market-edge', 'odds-performance', 'form', 'odds', 'h2h-model']) {
    const p = path.join(ROOT, d);
    if (!fs.existsSync(p)) { stores[d] = null; continue; }
    const files = fs.readdirSync(p);
    let bytes = 0; for (const f of files) { try { bytes += fs.statSync(path.join(p, f)).size; } catch {} }
    stores[d] = { files: files.length, mb: +(bytes / 1048576).toFixed(1), sample: files.slice(0, 3) };
  }
  out.OWN = stores;
}

fs.writeFileSync('/Users/Michael/bsp-wt-ten206audit/ten206-source-audit.json', JSON.stringify(out, null, 2));

// ── print ───────────────────────────────────────────────────────────────────
console.log('TML years:', out.TML.per.length, 'levels:', JSON.stringify(out.TML.levels));
console.log('TML head:', out.TML.head.join(' ').slice(0, 300));
for (const r of out.TML.per) console.log(`  TML ${r.year} n=${String(r.n).padStart(5)} ${r.first}..${r.last} ace=${r.ace}% min=${r.minutes}% bp=${r.bp}% rank=${r.rank}%`);
console.log('\nCHALL:', JSON.stringify(out.CHALL.per, null, 1));
console.log('\nMCP:', JSON.stringify({ ...out.MCP, overviewHead: out.MCP.overviewHead.join(',') }, null, 1));
console.log('\nTENNISDATA head:', out.TENNISDATA.head.join(' '));
for (const r of out.TENNISDATA.per) console.log(`  TD ${r.year} n=${String(r.n).padStart(4)} ${r.first}..${r.last} PSW=${r.psw}% B365=${r.b365}% Avg=${r.avgw}% Max=${r.maxw}%`);
console.log('\nODDSPAPI:', JSON.stringify(out.ODDSPAPI, null, 1));
console.log('\nOWN:', JSON.stringify(out.OWN, null, 1));
