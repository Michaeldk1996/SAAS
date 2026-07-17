#!/usr/bin/env node
// Diff our computed career-splits.json against Tennis Abstract's OWN rendered
// tables, cell by cell. TA pre-renders the finished splits tables as HTML inside
// jsfrags/{taId}.js, which makes free, cell-exact ground truth available for
// every player. Nothing here feeds the site — it exists to prove the builder.
//
//   node tools/verify-splits.js [name ...]     (default: a spread of players)
const fs = require('fs');
const https = require('https');
const path = require('path');

const SPLITS = path.join(__dirname, '..', 'career-splits.json');
const CACHE = '/tmp/ta-gt-cache';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0 bsp-splits-verify' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return get(res.headers.location).then(resolve, reject);
      }
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Pull one <table id="..."> out of the frag and parse it into rows of raw text.
function parseTable(js, id) {
  const i = js.indexOf(`<table id="${id}"`);
  if (i < 0) return null;
  const end = js.indexOf('</table>', i);
  const html = js.slice(i, end);
  const body = html.slice(html.indexOf('<tbody'));
  const rows = [];
  for (const tr of body.split('<tr').slice(1)) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
      .map(m => m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
    if (cells.length > 5) rows.push(cells);
  }
  return rows;
}

// TA column order, mapped onto our keys. null = we do not publish that column.
const COLS = [
  ['M', r => r.M], ['W', r => r.W], ['L', r => r.L], ['Win%', r => r.winPct],
  ['Set W-L', r => `${r.setW}-${r.setL}`], ['Set%', r => r.setPct],
  ['Game W-L', r => `${r.gameW}-${r.gameL}`], ['Game%', r => r.gamePct],
  ['TB W-L', r => `${r.tbW}-${r.tbL}`], ['TB%', r => r.tbPct],
  ['MS', r => r.MS], ['Hld%', r => r.hldPct], ['Brk%', r => r.brkPct],
  ['A%', r => r.aPct], ['DF%', r => r.dfPct], ['1stIn', r => r.firstInPct],
  ['1st%', r => r.firstWonPct], ['2nd%', r => r.secondWonPct],
  ['SPW', r => r.spwPct], ['RPW', r => r.rpwPct], ['TPW', r => r.tpwPct],
  ['DR', r => r.dr],
];

// TA prints "63.6%" / "1.06" / "-" ; normalise both sides to a comparable string.
function norm(v) {
  if (v == null || v === '' || v === '-' || v === '—') return null;
  const s = String(v).replace(/%/g, '').trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
function eq(mine, theirs, col) {
  const a = norm(mine), b = norm(theirs);
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (typeof a === 'number' && typeof b === 'number') {
    // TA rounds to 1dp (2dp for DR); allow only a rounding-boundary tick.
    const tol = col === 'DR' ? 0.011 : 0.051;
    return Math.abs(a - b) <= tol;
  }
  return String(a) === String(b);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(SPLITS, 'utf8'));
  const byName = new Map(Object.values(data.players).map(p => [p.fullName, p]));
  let names = process.argv.slice(2);
  if (!names.length) {
    names = ['Ben Shelton', 'Carlos Alcaraz', 'Jannik Sinner', 'Novak Djokovic',
      'Alexander Zverev', 'Taylor Fritz', 'Holger Rune', 'Frances Tiafoe',
      'Andrey Rublev', 'Casper Ruud'].filter(n => byName.has(n));
  }
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });

  const totals = { cells: 0, bad: 0 };
  const byCol = new Map();
  for (const name of names) {
    const p = byName.get(name);
    if (!p) { console.log(`?? ${name}: not in career-splits.json`); continue; }
    const cf = path.join(CACHE, p.taId + '.js');
    let js;
    if (fs.existsSync(cf) && fs.statSync(cf).size > 5000) js = fs.readFileSync(cf, 'utf8');
    else {
      await sleep(1500); // TA 429s bursts
      const { status, body } = await get(`https://www.tennisabstract.com/jsfrags/${p.taId}.js`);
      if (status !== 200 || body.length < 5000) { console.log(`?? ${name}: frag HTTP ${status}`); continue; }
      js = body; fs.writeFileSync(cf, body);
    }
    for (const [tableId, view] of [['career-splits', 'career'], ['last52-splits', 'last52']]) {
      const gt = parseTable(js, tableId);
      if (!gt) { console.log(`?? ${name}/${view}: no ${tableId} table`); continue; }
      for (const cells of gt) {
        // TA labels these "vs Righties"; our categories carry the period.
        const label = cells[0].replace(/^vs /, 'vs. ');
        const mine = p[view][label];
        if (!mine) continue; // TA row we drop (zero-match) or label mismatch
        COLS.forEach(([col, pick], k) => {
          const theirs = cells[k + 1];
          if (theirs === undefined) return;
          totals.cells++;
          if (!eq(pick(mine), theirs, col)) {
            totals.bad++;
            byCol.set(col, (byCol.get(col) || 0) + 1);
            if (totals.bad <= 25) console.log(`  MISMATCH ${name}/${view}/${label}/${col}: mine=${pick(mine)} TA=${theirs}`);
          }
        });
      }
    }
    console.log(`checked ${name}`);
  }
  const okPct = totals.cells ? ((totals.cells - totals.bad) / totals.cells * 100).toFixed(2) : 0;
  console.log(`\n=== ${totals.cells - totals.bad}/${totals.cells} cells exact (${okPct}%)`);
  if (byCol.size) {
    console.log('mismatches by column:');
    [...byCol.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${c}: ${n}`));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
