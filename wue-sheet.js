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

// One player's sheet row: numbers stay numbers (ratios rounded to 2dp); an
// absent value is null (rendered as the dash).
function playerRow(side, status) {
  const W = isNum(side.winners) ? side.winners : null;
  const UE = isNum(side.unforcedErrors) ? side.unforcedErrors : null;
  const TT = isNum(side.totalPoints) && side.totalPoints > 0 ? side.totalPoints : null;
  const dr = dominanceRatio(side.servicePoints, side.returnPoints);
  return {
    player: side.name + (FLAG[status] ? ` [${FLAG[status]}]` : ''),
    flag: FLAG[status] || null,
    values: [
      W, UE, TT,
      W != null && TT != null ? r2(W / TT) : null,
      UE != null && TT != null ? r2(UE / TT) : null,
      W != null && UE != null && UE > 0 ? r2(W / UE) : null,
      dr != null ? r2(dr) : null,
    ],
  };
}

// The progression entry → [{ round, title, rows }] in round order. Rounds with
// no completed match are omitted (unplayed matches are not rows).
function sheetRounds(entry) {
  if (!entry || !Array.isArray(entry.matches)) return [];
  const labels = Array.isArray(entry.rounds) ? entry.rounds : [];
  const byRound = new Map();
  for (const m of entry.matches) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round).push(m);
  }
  const order = labels.filter(l => byRound.has(l)).concat([...byRound.keys()].filter(l => !labels.includes(l)));
  return order.map(round => {
    const idx = labels.indexOf(round);
    return {
      round,
      title: idx >= 0 ? `ROUND ${idx + 1}` : String(round).toUpperCase(),
      rows: byRound.get(round).flatMap(m => [playerRow(m.p1, m.status), playerRow(m.p2, m.status)]),
    };
  });
}

const fmt = (v, i) => v == null ? DASH : (i >= 3 ? v.toFixed(2) : String(v));   // values[3..6] are the ratios

// Tab-separated rows for pasting into a Round tab (data rows only — no header,
// so it never overwrites the tab's own header row).
function roundTsv(round) {
  return round.rows.map(r => [r.player].concat(r.values.map(fmt)).join('\t')).join('\n');
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
    if (typeof v === 'number') return `<c r="${ref}"${ratio ? ' s="2"' : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  const rows = [`<row r="1">${COLUMNS.map((h, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${xmlEsc(h)}</t></is></c>`).join('')}</row>`];
  round.rows.forEach((r, k) => {
    const n = k + 2;
    rows.push(`<row r="${n}">${cell('A' + n, r.player)}${r.values.map((v, i) => cell(colName(i + 1) + n, v, i >= 3)).join('')}</row>`);
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

function buildXlsx(entry) { return zipStore(workbookFiles(sheetRounds(entry))); }

// ---------------------------------------------------------------- browser glue
// Always the latest publish: cache-busted, no-store, never the page's loaded copy.
async function fetchLatest(tour) {
  const res = await fetch(`${PROGRESSION_URL}?_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`tournament-progression.json HTTP ${res.status}`);
  const data = await res.json();
  const entry = data && data.tournaments ? data.tournaments[tour] : null;
  if (!entry) throw new Error(`${tour} is no longer in the published progression data`);
  if (!Array.isArray(entry.matches)) throw new Error(`${tour}: published data has no per-match sheet rows yet`);
  return { entry, fetchedAt: data.fetchedAt || null };
}

function fileName(tour, fetchedAt) {
  const y = fetchedAt ? new Date(fetchedAt).getUTCFullYear() : '';
  return `${tour}${y ? ' ' + y : ''} W-UE.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
}

async function download(tour) {
  const { entry, fetchedAt } = await fetchLatest(tour);
  const blob = new Blob([buildXlsx(entry)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(tour, fetchedAt);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return sheetRounds(entry).length;
}

// Copy one round as TSV. The text is fetched AFTER the click, so it goes through a
// ClipboardItem promise where supported (Safari drops the user gesture across an await).
async function copyRound(tour, round) {
  const textP = fetchLatest(tour).then(({ entry }) => {
    const r = sheetRounds(entry).find(x => x.round === round);
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

const WUE_SHEET = { COLUMNS, DASH, dominanceRatio, playerRow, sheetRounds, roundTsv, workbookFiles, zipStore, crc32, buildXlsx, fileName, fetchLatest, download, copyRound };
if (typeof module !== 'undefined' && module.exports) module.exports = WUE_SHEET;
if (typeof window !== 'undefined') window.WueSheet = WUE_SHEET;
}());
