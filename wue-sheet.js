// =================================================================
// W/UE TOURNAMENT SHEET (founder brief 2026-10-20, Phase 1)
// -----------------------------------------------------------------
// Reproduces Michael's hand-entered W/UE Google Sheet from the published
// tournament-progression.json `matches` rows (bsp-pipeline.js
// progressionSheetMatches): one tab per round, players in order of play
// (no draw source exists for quarters / byes — founder ruling Option A).
//
//   Player | W | UE | TT points | W/P | UE/P | Ratio W/UE | Dominance Ratio
//   TT points       = total points PLAYED in the match (Total Points Won's total)
//   W/P             = W ÷ TT points
//   UE/P            = UE ÷ TT points
//   Ratio W/UE      = W ÷ UE
//   Dominance Ratio = returnPtsWon% / (100 − servicePtsWon%)   (Bialik — the
//                     same formula as live-tab.js Detail.dominance and
//                     tools/build-career-splits.js `dr`), from the per-match RAW
//                     won/total counts.
// Ratios carry 2 decimals. A missing stat is an em dash, never 0; a zero
// denominator is a dash too (the ratio does not exist). Retired and walkover
// matches are flagged on the player cell.
//
// The export reads tournament-progression.json at CLICK time (no-store, cache-
// busted) — never the copy the page loaded — so it is always the latest publish.
// No API keys: published static data only. The .xlsx is written here (stored
// ZIP + SpreadsheetML), so there is no third-party script to load.
// =================================================================
(function () {
'use strict';

const DASH = '—';
const COLUMNS = ['Player', 'W', 'UE', 'TT points', 'W/P', 'UE/P', 'Ratio W/UE', 'Dominance Ratio'];
const PROGRESSION_URL = './tournament-progression.json';
const DRAWS_URL = './draws.json';

const r2 = (x) => Math.round(x * 100) / 100;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// Bialik Dominance Ratio from raw won/total pairs. null when either pair is
// absent or the player won every service point (denominator 0).
function dominanceRatio(servicePoints, returnPoints) {
  if (!servicePoints || !returnPoints || !(servicePoints.total > 0) || !(returnPoints.total > 0)) return null;
  const spw = servicePoints.won / servicePoints.total * 100;
  const rpw = returnPoints.won / returnPoints.total * 100;
  return (100 - spw) > 0 ? rpw / (100 - spw) : null;
}

const FLAG = { retired: 'RET', walkover: 'W/O' };
const NO_STATS = 'NO STATS';

// One player's sheet row: numbers stay numbers (ratios rounded to 2dp); an absent value is null (the dash). A finished
// match the feed sent no stat sheet for is flagged [NO STATS] — dashes, never zeros (ruling 6, 2026-10-20).
function playerRow(side, status, hasStats) {
  const W = isNum(side.winners) ? side.winners : null;
  const UE = isNum(side.unforcedErrors) ? side.unforcedErrors : null;
  const TT = isNum(side.totalPoints) && side.totalPoints > 0 ? side.totalPoints : null;
  const dr = dominanceRatio(side.servicePoints, side.returnPoints);
  const flags = [FLAG[status], hasStats === false ? NO_STATS : null].filter(Boolean);
  return {
    player: side.name + flags.map(x => ` [${x}]`).join(''),
    flag: flags[0] || null,
    values: [
      W, UE, TT,
      W != null && TT != null ? r2(W / TT) : null,
      UE != null && TT != null ? r2(UE / TT) : null,
      W != null && UE != null && UE > 0 ? r2(W / UE) : null,
      dr != null ? r2(dr) : null,
    ],
  };
}

// ── Rounds (ruling 6, founder 2026-10-20) ─────────────────────────────────────────────────────────────────────────
// A tab per ACTUAL round, named by the feed's own round text (pipeline: roundCode, "1/16-finals" → R32) — never
// "ROUND 1". A round's tab exists as soon as ONE of its matches has finished with stats; every completed match of that
// round is in it (no-stats ones as flagged dashes). Matches not yet played are left out — or, once the official draw
// is posted, shown as blank rows in draw order (quarters Q1–Q4 + BYE rows, ruling 7). Never zeros.
const ROUND_ORDER = ['R256', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'];
const roundRank = (c) => { const k = ROUND_ORDER.indexOf(c); return k < 0 ? 99 : k; };
const roundOf = (m) => m.roundCode || null;
const BLANK = '';                                  // an unplayed match: left blank (not a dash — nothing is missing yet)
const BYE_ROW = ['BYE', BLANK, BLANK, BLANK, BLANK, BLANK, BLANK];

function drawFor(draws, tour) {
  const ts = draws && draws.tournaments ? Object.values(draws.tournaments) : [];
  const hit = ts.filter(t => String(t.city || '').toLowerCase() === String(tour).toLowerCase() && t.main && t.main.status === 'posted');
  return hit.length === 1 ? hit[0] : null;
}
function slotName(s) {                            // "DIAZ ACOSTA, Facundo" → "F. Diaz Acosta" (the feed's own style)
  if (!s || !s.name) return DASH;
  const [sur, given] = s.name.split(/,\s*/);
  const title = String(sur).toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase());
  const ini = String(given || '').trim().split(/\s+/).filter(w => w && w !== '…')
    .map(w => w.split('-').map(p => p[0].toUpperCase()).join('-') + '.').join(' ');      // "Tomas Martin" → "T. M.", "Jan-Lennard" → "J-L."
  return ini ? `${ini} ${title}` : title;
}
// The draw's rounds, first to last: a 32-slot draw → R32, R16, QF, SF, F.
function drawRounds(size) {
  const out = []; for (let n = size; n >= 2; n /= 2) out.push(n === 8 ? 'QF' : n === 4 ? 'SF' : n === 2 ? 'F' : `R${n}`);
  return out;
}
// Matches a round holds, from the draw: the first round = slot pairs without a bye; later rounds = size / 2^k.
function drawRoundTotals(draw) {
  const size = draw.main.size, slots = draw.main.slots, rounds = drawRounds(size), out = {};
  rounds.forEach((r, k) => {
    if (k === 0) { let n = 0; for (let p = 0; p < size; p += 2) if (!slots[p].bye && !slots[p + 1].bye) n++; out[r] = n; }
    else out[r] = size / Math.pow(2, k + 1);
  });
  return out;
}

// ── Winners only (founder ruling 2026-10-20, item 1) ──────────────────────────────────────────────────────────────
// A round tab lists the players who ADVANCED from that round, with the stats of the match they won. With the official
// draw, it is one row per MATCH SLOT in draw order (R32: 4 per quarter, R16: 2, QF: 1), so it lines up with Michael's
// sheet: a finished match → its winner; a first-round bye → "BYE" for the player advancing; a match not yet played →
// "TBD (A v B)" with blank stats (a side not decided yet is "TBD" — never a guessed name); finished without stats →
// the winner, dashes, flagged [NO STATS]. A match is placed by its two players' OWN draw positions — never inferred.
const TBD = 'TBD';
function winnerSide(m) { return m.winner === 1 ? m.p1 : m.winner === 2 ? m.p2 : null; }

function sheetRounds(entry, draw) {
  if (!entry || !Array.isArray(entry.matches)) return [];
  const withDraw = draw && draw.main && draw.main.status === 'posted' && Array.isArray(draw.main.slots);
  const byRound = new Map();
  for (const m of entry.matches) { const r = roundOf(m) || `? ${m.round}`; if (!byRound.has(r)) byRound.set(r, []); byRound.get(r).push(m); }
  // A tab exists once one of its matches finished WITH stats.
  const tabs = [...byRound.keys()].filter(r => byRound.get(r).some(m => m.hasStats !== false)).sort((a, b) => roundRank(a) - roundRank(b));
  if (!withDraw) {
    return tabs.map(r => ({ round: r, title: r, rows: byRound.get(r).map(m => { const w = winnerSide(m); return w ? playerRow(w, m.status, m.hasStats) : null; }).filter(Boolean) }));
  }
  return roundsWithDraw(byRound, tabs, draw);
}

function roundsWithDraw(byRound, tabs, draw) {
  const main = draw.main, size = main.size, slots = main.slots, order = drawRounds(size);
  const quarterOfPos = pos => 1 + Math.floor((pos - 1) / (size / 4));
  const posByKey = new Map(slots.filter(s => s.playerKey).map(s => [String(s.playerKey), s.pos]));
  const nameOf = (side) => side ? side.name : TBD;
  // decided[k][j] = the side object that won match slot j of round k (null = not decided yet). Round k's slot j covers
  // draw positions j*2^(k+1)+1 … (j+1)*2^(k+1). A completed match lands in the slot holding BOTH players' positions.
  const decided = order.map((_, k) => new Array(size / Math.pow(2, k + 1)).fill(null));
  const matchAt = order.map((_, k) => new Array(size / Math.pow(2, k + 1)).fill(null));
  const unplaced = {};
  order.forEach((r, k) => {
    const span = Math.pow(2, k + 1);
    for (const m of byRound.get(r) || []) {
      const a = posByKey.get(String(m.p1.playerKey)), b = posByKey.get(String(m.p2.playerKey));
      const ja = a ? Math.floor((a - 1) / span) : null, jb = b ? Math.floor((b - 1) / span) : null;
      if (ja == null || jb == null || ja !== jb || matchAt[k][ja]) { (unplaced[r] = unplaced[r] || []).push(m); continue; }
      matchAt[k][ja] = m; decided[k][ja] = winnerSide(m);
    }
    if (k === 0) for (let j = 0; j < size / 2; j++) {            // a first-round bye: the player advances, no match
      const x = slots[2 * j], y = slots[2 * j + 1];
      if (!matchAt[0][j] && (x.bye || y.bye)) decided[0][j] = { bye: true, name: slotName(x.bye ? y : x) };
    }
  });
  // who plays in round k slot j: the two winners feeding it (or the two draw slots in the first round)
  const sidesOf = (k, j) => k === 0
    ? [slots[2 * j].bye ? null : { name: slotName(slots[2 * j]) }, slots[2 * j + 1].bye ? null : { name: slotName(slots[2 * j + 1]) }]
    : [decided[k - 1][2 * j], decided[k - 1][2 * j + 1]];
  return tabs.filter(r => order.includes(r) || unplaced[r]).map(r => {
    const k = order.indexOf(r), rows = [];
    if (k >= 0) {
      const n = size / Math.pow(2, k + 1), perQ = n / 4;
      for (let j = 0; j < n; j++) {
        if (perQ >= 1 && j % perQ === 0) rows.push({ header: `Q${quarterOfPos(j * Math.pow(2, k + 1) + 1)}` });
        else if (n === 2) rows.push({ header: j === 0 ? 'TOP HALF' : 'BOTTOM HALF' });   // SF: one row per half; F: no header
        const m = matchAt[k][j];
        if (m) { const w = winnerSide(m); rows.push(w ? playerRow(w, m.status, m.hasStats) : { player: DASH, flag: null, values: Array(7).fill(null) }); continue; }
        if (k === 0 && decided[0][j] && decided[0][j].bye) { rows.push({ player: decided[0][j].name, flag: null, values: BYE_ROW.slice() }); continue; }
        const [p, q] = sidesOf(k, j);
        rows.push({ player: `${TBD} (${nameOf(p && p.bye ? { name: p.name } : p)} v ${nameOf(q && q.bye ? { name: q.name } : q)})`, flag: null, values: Array(7).fill(BLANK) });
      }
    }
    if (unplaced[r]) { rows.push({ header: 'UNPLACED' }); for (const m of unplaced[r]) { const w = winnerSide(m); if (w) rows.push(playerRow(w, m.status, m.hasStats)); } }
    return { round: r, title: r, quarters: true, rows };
  });
}

// On-page status, every round that has started: "R32: 11 of 12 · R16: 3 of 8". The total comes from the official
// draw; without one it is a dash, never a guess. Completed matches the feed sent no stats for are said out loud.
function roundStatus(entry, draw) {
  if (!entry || !Array.isArray(entry.matches)) return '';
  const totals = draw && draw.main && draw.main.status === 'posted' ? drawRoundTotals(draw) : {};
  const byRound = new Map();
  for (const m of entry.matches) { const r = roundOf(m) || `? ${m.round}`; if (!byRound.has(r)) byRound.set(r, []); byRound.get(r).push(m); }
  return [...byRound.keys()].sort((a, b) => roundRank(a) - roundRank(b)).map(r => {
    const ms = byRound.get(r), noStats = ms.filter(m => m.hasStats === false).length;
    return `${r}: ${ms.length} of ${totals[r] != null ? totals[r] : DASH}${noStats ? ` (${noStats} without stats)` : ''}`;
  }).join(' · ');
}

// Founder ruling 2026-10-21: every stat is a REAL NUMBER with 2 decimals (0.00), never text. Copy prints them with a
// DOT decimal whatever the viewer's browser locale: Number#toFixed is locale-independent (never toLocaleString here).
const fmt = (v) => v == null ? DASH : typeof v === 'string' ? v : v.toFixed(2);

// Tab-separated rows for pasting into a Round tab (data rows only — no header,
// so it never overwrites the tab's own header row).
function roundTsv(round) {
  return round.rows.map(r => r.header ? r.header : [r.player].concat(r.values.map(fmt)).join('\t')).join('\n');
}

// ---------------------------------------------------------------- xlsx writer
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => String.fromCharCode(65 + i);   // 8 columns: A..H
// Excel sheet-name rules: ≤31 chars, none of : \ / ? * [ ]
const sheetName = (s) => String(s).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

function sheetXml(round) {
  // s="1" header (bold) · s="2" ratio (0.00) · s="3" right-aligned dash
  const cell = (ref, v, ratio) => {
    if (v == null) return `<c r="${ref}" t="inlineStr" s="3"><is><t>${DASH}</t></is></c>`;
    if (v === BLANK) return '';                                                      // unplayed: an empty cell
    if (typeof v === 'number') return `<c r="${ref}"${ratio ? ' s="2"' : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  const rows = [`<row r="1">${COLUMNS.map((h, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${xmlEsc(h)}</t></is></c>`).join('')}</row>`];
  round.rows.forEach((r, k) => {
    const n = k + 2;
    if (r.header) { rows.push(`<row r="${n}"><c r="A${n}" t="inlineStr" s="1"><is><t>${xmlEsc(r.header)}</t></is></c></row>`); return; }
    // every stat column carries the 0.00 number format (s="2"); the stored value is the number itself
    rows.push(`<row r="${n}">${cell('A' + n, r.player)}${r.values.map((v, i) => cell(colName(i + 1) + n, v, true)).join('')}</row>`);
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="8" width="13" customWidth="1"/></cols>'
    + `<sheetData>${rows.join('')}</sheetData></worksheet>`;
}

function workbookFiles(rounds) {
  const sheets = rounds.length ? rounds : [{ title: 'NO COMPLETED MATCHES', rows: [] }];
  const files = [];
  files.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>']);
  files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>']);
  files.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + sheets.map((s, i) => `<sheet name="${xmlEsc(sheetName(s.title))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets></workbook>']);
  files.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>']);
  files.push(['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>']);
  sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]));
  return files;
}

// CRC-32 (IEEE) for the ZIP entries.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

// Stored (uncompressed) ZIP: every .xlsx reader accepts method 0.
function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
  const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1;   // 1980-01-01 00:00 — deterministic bytes
  for (const [name, text] of files) {
    const nameB = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const local = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0));
    parts.push(Uint8Array.from(local), nameB, data);
    central.push(Uint8Array.from([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), nameB);
    offset += local.length + nameB.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = Uint8Array.from([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
  const all = parts.concat(central, [end]);
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}

function buildXlsx(entry, draw) { return zipStore(workbookFiles(sheetRounds(entry, draw))); }

// ---------------------------------------------------------------- browser glue
// Always the latest publish: cache-busted, no-store, never the page's loaded copy.
// The page's copy of draws.json, for the status line's totals + the Copy buttons (approved 2026-10-20, ruling 7).
// Loaded once in the background; the export itself re-reads both files at click time (fetchLatest).
let _draws = null, _drawsP = null;
function prefetchDraws() {
  if (_drawsP) return _drawsP;
  _drawsP = fetch(`${DRAWS_URL}?_=${Date.now()}`, { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(d => { _draws = d; if (d && typeof window !== 'undefined' && typeof window.renderTourxReports === 'function') { try { window.renderTourxReports(); } catch (e) { /* page not on Reports */ } } return d; });
  return _drawsP;
}
function cachedDraw(tour) { return drawFor(_draws, tour); }

async function fetchLatest(tour) {
  const res = await fetch(`${PROGRESSION_URL}?_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`tournament-progression.json HTTP ${res.status}`);
  const data = await res.json();
  const entry = data && data.tournaments ? data.tournaments[tour] : null;
  if (!entry) throw new Error(`${tour} is no longer in the published progression data`);
  if (!Array.isArray(entry.matches)) throw new Error(`${tour}: published data has no per-match sheet rows yet`);
  // The official draw is optional: absent / unreachable → the sheet stays in match order (no quarters), never invented.
  let draw = null;
  try {
    const d = await fetch(`${DRAWS_URL}?_=${Date.now()}`, { cache: 'no-store' });
    if (d.ok) draw = drawFor(await d.json(), tour);
  } catch (e) { draw = null; }
  return { entry, draw, fetchedAt: data.fetchedAt || null };
}

function fileName(tour, fetchedAt) {
  const y = fetchedAt ? new Date(fetchedAt).getUTCFullYear() : '';
  return `${tour}${y ? ' ' + y : ''} W-UE.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
}

async function download(tour) {
  const { entry, draw, fetchedAt } = await fetchLatest(tour);
  const blob = new Blob([buildXlsx(entry, draw)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(tour, fetchedAt);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return sheetRounds(entry, draw).length;
}

// Copy one round as TSV. The text is fetched AFTER the click, so it goes through a
// ClipboardItem promise where supported (Safari drops the user gesture across an await).
async function copyRound(tour, round) {
  const textP = fetchLatest(tour).then(({ entry, draw }) => {
    const r = sheetRounds(entry, draw).find(x => x.round === round);
    if (!r) throw new Error(`${tour} ${round}: no completed matches in the published data`);
    return roundTsv(r);
  });
  let copied = false;
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': textP.then(t => new Blob([t], { type: 'text/plain' })) })]); copied = true; }
    catch (e) { await textP; }   // a data error (no such round) surfaces from textP; a permission error falls through
  }
  const text = await textP;
  if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); copied = true; } catch (e) { /* fall through */ }
  }
  if (!copied) {   // legacy path: still inside the click's transient activation in Chromium/WebKit
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta); ta.select();
    try { copied = document.execCommand('copy'); } finally { ta.remove(); }
  }
  if (!copied) throw new Error('the browser blocked clipboard access');
  return text.split('\n').length;
}

const WUE_SHEET = { COLUMNS, DASH, BLANK, NO_STATS, drawFor, slotName, drawRounds, drawRoundTotals, roundStatus, prefetchDraws, cachedDraw, dominanceRatio, playerRow, sheetRounds, roundTsv, workbookFiles, zipStore, crc32, buildXlsx, fileName, fetchLatest, download, copyRound };
if (typeof module !== 'undefined' && module.exports) module.exports = WUE_SHEET;
if (typeof window !== 'undefined') window.WueSheet = WUE_SHEET;
if (typeof window !== 'undefined' && typeof fetch === 'function') prefetchDraws();
}());
