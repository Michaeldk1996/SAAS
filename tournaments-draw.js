// Tournaments tab rebuild (handoff 2026-11-20, design_handoff_tournaments_2026-11-20). Owner: the TTDraw builder.
// =================================================================
// TOURNAMENTS → DRAW — the 2026-11-20 Draw tab (design/Tournaments.dc.html, data-draw-root, holes dw.*; changelog
// "TOURNAMENTS · DRAW TAB LOCKED 2026-11-20 (evening)" + the refines above it), built on our own data.
// -----------------------------------------------------------------
// Card: round "?" (How to read this page) in the top right corner · "Draws" + count · picker row This week · Finished ·
// Archive (max 3) + "Download W/UE sheet" (WueSheet.download: one file, every round up to the last match played) ·
// open-draw head (logo tile, name, status chip, tier line | Champion | Matches played | Compare two routes) · toolbar
// (Draw · Statistics · Outright chances · Points to defend | From + Main draw · Qualifying) · progress row while in play.
// Views: Draw (bracket rows with the player's photo; a name opens the player box in a fixed layer; route panel, ONE
// compare table, opponents box) · Statistics · Outright chances · Points to defend.
//
// Data — every figure is ours or a grey dash "—" with its reason in the hover:
//   draws.json (the official sheet) · tournament-progression.json (results, set scores, players[].rounds[].metrics) ·
//   draws-archive.json (finished draws) · matches.json + _mcNowPair (price of an unplayed pair on Today's Matches) ·
//   how-it-plays.json · favourites-by-round.json · database-yield.json through settlement.js · tour-baselines.json ·
//   points-to-defend.json + player-index.json (`players[].points`, ranking points) · tournament-logos/index.json ·
//   career-history + H2HCore + style-meetings (opponents box).
// Standing ruling (founder 2026-11-15 ruling 3): every chance, fair-odds range, opening-price range and warning is a dash.
// No METZ demo, no DT_OLD, no leftovers (README "Data").
// =================================================================
(function () {
'use strict';
const DASH = '—', MINUS = '−', NDASH = '–';
const SCOPE = '.tabpage[data-page="tournaments"] .tt-draw';
const FLOOR = 15;   // TP_SAMPLE_FLOOR (tournaments.md): below 15 matches a % is a dash, its count in the hover

// ── colours: tokens only (BRIEF-COMMON colour map) ─────────────────────────────────────────────────────────────────
const C = {
  text: 'var(--tt-text)', white: 'var(--tt-white)', soft: 'var(--tt-soft)', muted: 'var(--tt-muted)',
  blue: 'var(--tt-blue)', red: 'var(--tt-red)', green: 'var(--tt-green)',
  card: 'var(--tt-card)', inset: 'var(--tt-inset)', lifted: 'var(--tt-lifted)', hover: 'var(--tt-hover)', track: 'var(--tt-track)',
  scrim62: 'var(--tt-scrim-62)', scrim66: 'var(--tt-scrim-66)', shOverlay: 'var(--tt-shadow-overlay)', shMenu: 'var(--tt-shadow-menu)',
};
const W = n => `color-mix(in srgb, var(--tt-white) ${n}%, transparent)`;
const B = n => `color-mix(in srgb, var(--tt-blue) ${n}%, transparent)`;
const MONO = "font-family:'IBM Plex Mono',monospace;";
const LBL = `font-size:11.5px; font-weight:600; color:${C.muted};`;            // small label: 11.5/600 grey, never caps
const LIFT = `background:${C.lifted}; border:1px solid ${W(14)};`;
const BAR55 = B(55);
const CLOSE_SVG = `<svg width="11" height="11" viewBox="0 0 10 10" fill="none" style="stroke:${C.soft}" stroke-width="1.6" stroke-linecap="round"><path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5"></path></svg>`;
const SEARCH_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="stroke:${C.muted}" stroke-width="1.6" stroke-linecap="round"><circle cx="6" cy="6" r="4.4"></circle><path d="M9.4 9.4 L12.6 12.6"></path></svg>`;

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = v => Math.abs(v).toFixed(1);
const sg = d => (d >= 0 ? '+' : MINUS) + f1(d);
const sgnC = d => (d == null || Math.abs(d) < 0.05 ? C.muted : d > 0 ? C.green : C.red);   // gap lines: green / red by their own sign, grey at 0
const LONG = { R128: 'Round of 128', R64: 'Round of 64', R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
const longOf = n => LONG[n] || (/^Q(\d+)$/.test(n) ? 'Qualifying round ' + n.slice(1) : n);
const reachWords = n => (n === 'F' ? 'the final' : n === 'SF' ? 'the semi-finals' : n === 'QF' ? 'the quarter-finals' : 'the ' + longOf(n));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── page globals (classic-script globals of bsp-consult-dashboard.html; every one optional) ─────────────────────────
const DV = () => (typeof window !== 'undefined' ? window.DrawView : null);
const progData = () => (typeof tournamentProgression !== 'undefined' ? tournamentProgression : null);
const boardData = () => (typeof matches !== 'undefined' && Array.isArray(matches) ? matches : []);
const tz = () => { try { return typeof newsTz === 'function' ? newsTz() : undefined; } catch (e) { return undefined; } };

// ── files: one loader (undefined = not asked, null = failed / absent, else the parsed file); a load repaints ────────
const FILES = {}, LOADING = {};
function file(name, cache) {
  if (FILES[name] !== undefined) return FILES[name];
  if (!LOADING[name] && typeof fetch === 'function') {
    LOADING[name] = fetch('./' + name + (cache === 'bust' ? '?_=' + Date.now() : ''), { cache: cache === 'bust' ? 'no-store' : 'no-cache' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(d => { FILES[name] = d || null; LOADING[name] = null; repaint(); return d; });
  }
  return undefined;
}
function drawsData() {
  if (typeof _tourxDraws !== 'undefined' && _tourxDraws) return _tourxDraws;   // the old renderer's copy, when it loaded one
  return file('draws.json', 'bust');
}
// this week's ATP standings: the page's own copy (playerIndex), else the file
function standings() {
  if (typeof playerIndex !== 'undefined' && Array.isArray(playerIndex) && playerIndex.length) return playerIndex;
  const f = file('player-index.json');
  return f === undefined ? undefined : f && Array.isArray(f.players) ? f.players : null;
}

// ── state ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const S = { key: null, kind: 'main', view: 'draw', from: null, sel: null, b: null, cmp: false, cmpQ: '', shut: null, opp: null,
  outCmp: false, outA: null, outB: null, outQ: '', outTab: 't', stat: null, ed: null, pop: null, help: null, dl: null, ptSort: 'pts', el: null };
const reset = () => Object.assign(S, { sel: null, b: null, cmp: false, cmpQ: '', shut: null, opp: null, stat: null, ed: null, outCmp: false, outA: null, outB: null, outQ: '', pop: null, help: null });

// ── events: This week · Finished (the two newest ended draws) · Archive (the rest + draws-archive, max 3 shown) ─────
const cityOf = t => t.feedCity || t.city;
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function entryFor(city) {
  const p = progData(); if (!p) return { entry: null, name: null };
  for (const map of [p.tournaments, p.drawResults]) {
    if (!map) continue;
    if (map[city]) return { entry: map[city], name: city };
    const k = Object.keys(map).find(x => map[x] && map[x].feedName === city);
    if (k) return { entry: map[k], name: k };
  }
  return { entry: null, name: null };
}
// The Database / favourites-by-round name of a draw. draws.json "Lyon" in October is the new indoor event (api-tennis
// key 14763, "Lyon (France)" — tournaments.md: no lineage to the clay Lyon Open).
function dataName(t) { const c = cityOf(t); return c === 'Lyon' && +String(t.startDate || '').slice(5, 7) >= 9 ? 'Lyon (France)' : c; }
function events() {
  const d = drawsData(), a = file('draws-archive.json');
  const today = isoToday(), out = [];
  for (const [id, t] of Object.entries((d && d.tournaments) || {})) {
    if (!t || !t.main || t.main.status !== 'posted') continue;
    const city = cityOf(t), e = entryFor(city);
    out.push({ key: 'd:' + id, id, city, label: city, draw: t, entry: e.entry, entryName: e.name, start: t.startDate || '', end: t.endDate || '',
      arch: false, ended: !!(t.endDate && t.endDate < today), dname: dataName(t),
      board: boardData().filter(m => String(m.tour || '').replace(/^ATP /, '') === city && !m.finalScore) });
  }
  const have = new Set(out.map(e => e.city + '|' + e.start));
  for (const [id, t] of Object.entries((a && a.tournaments) || {})) {
    if (!t || !t.main || t.main.status !== 'posted' || !t.results) continue;
    const city = cityOf(t); if (have.has(city + '|' + (t.startDate || ''))) continue;
    out.push({ key: 'a:' + id, id, city, label: city, draw: t, entry: t.results, entryName: null, start: t.startDate || '', end: t.endDate || '',
      arch: true, ended: true, archivedAt: t.archivedAt || null, dname: dataName(t), board: [] });
  }
  const now = out.filter(e => !e.arch && !e.ended).sort((x, y) => x.start.localeCompare(y.start) || x.city.localeCompare(y.city));
  const ended = out.filter(e => !e.arch && e.ended).sort((x, y) => y.end.localeCompare(x.end) || x.city.localeCompare(y.city));
  const fin = ended.slice(0, 2);
  // the design's Archive track shows the three most recent (founder 2026-11-20: "in archive maximum 3 tournaments")
  const arch = ended.slice(2).concat(out.filter(e => e.arch)).sort((x, y) => y.end.localeCompare(x.end) || x.city.localeCompare(y.city)).slice(0, 3);
  const shown = new Set(now.concat(fin, arch).map(e => e.key));
  return { all: out.filter(e => shown.has(e.key)), now, fin, arch };
}
// the event's printed name (tournaments.md "Event names": the site's ONE event name), else the city
function evName(ev) { try { return typeof tourxEventName === 'function' ? tourxEventName(ev.dname) || ev.city : ev.city; } catch (e) { return ev.city; } }

// ── draw model (DrawView.model — the live tab's one model) + derived facts ─────────────────────────────────────────
function modelOf(ev, kind) {
  const D = DV(); if (!D || !ev) return null;
  try { return D.model({ draw: ev.draw, entry: ev.entry, upcoming: ev.board, kind: kind === 'qual' ? 'qualifying' : 'main' }); } catch (e) { return null; }
}
const keyOf = s => (s && s.playerKey != null ? String(s.playerKey) : null);
const nameOf = s => (s ? (DV() ? DV().shortName(s.name) : s.name) : '');
const tagOf = s => (s ? (s.seed != null ? `[${s.seed}]` : s.entry && s.entry !== 'SEED' ? s.entry : '') : '');
const surname = n => String(n || '').trim().split(/\s+/).pop();
function facts(M, ev) {
  // per player: the round he lost in, the champion; slots by key
  const slots = ((ev.draw.main && ev.draw.main.slots) || []).filter(s => !s.bye && s.playerKey);
  const byKey = new Map(slots.map(s => [String(s.playerKey), s])), out = {};
  let champ = null;
  if (M) M.rounds.forEach((R, r) => R.cells.forEach(c => {
    if (!c.match) return;
    c.sides.forEach(s => { const k = keyOf(s); if (k && k !== c.match.winnerKey && out[k] == null) out[k] = r; });
    if (r === M.rounds.length - 1) champ = c.match.winnerKey;
  }));
  return { slots, byKey, out, champ };
}
const played = M => (M ? M.rounds.reduce((a, r) => a + r.done, 0) : 0);
const total = M => (M ? M.rounds.reduce((a, r) => a + r.total, 0) : 0);
function stageOf(M, F) {
  if (!M) return DASH;
  if (F.champ) { const s = F.byKey.get(F.champ); return s ? surname(nameOf(s)) : DASH; }
  if (!played(M)) return 'Draw out';
  const r = M.rounds.find(x => x.done < x.total); return r ? r.name : DASH;
}

// ── a finished match opens the one Match Analysis (founder 2026-11-16: "clicking a match does nothing") ─────────────
// The id is `past-<eventKey>`. The board's row (matches.json) or the draw store's copy (draw-matches.json) is the full row
// and always wins (the page's matchById). Past them the row is built from the draw's own published result: players,
// keys, set scores, date, round, surface, event key. Nothing else is filled in. Main draw only.
const ROUND_FEED = { R128: '1/64-finals', R64: '1/32-finals', R32: '1/16-finals', R16: '1/8-finals', QF: '1/4-finals', SF: '1/2-finals', F: 'Final' };
const ROWS = new Map();
function resultRow(ev, pm) {
  if (!pm || pm.eventKey == null || !pm.p1 || !pm.p2 || !Array.isArray(pm.score) || (pm.winner !== 1 && pm.winner !== 2)) return null;
  const tour = 'ATP ' + ((ev.entry && ev.entry.feedName ? String(ev.entry.feedName).replace(/^ATP /, '') : '') || ev.entryName || cityOf(ev.draw));
  const sets = pm.score.map(x => ({ p1: Number(x[0]), p2: Number(x[1]) }));
  const p1Sets = sets.filter(x => x.p1 > x.p2).length, p2Sets = sets.filter(x => x.p2 > x.p1).length;
  const sh = ev.draw && ev.draw.sheetHeader ? ev.draw.sheetHeader : {};
  const key = k => (k != null && k !== '' && Number.isFinite(+k) ? +k : null);
  return { id: 'past-' + pm.eventKey, date: pm.date || null, time: pm.time || null, p1: pm.p1.name, p2: pm.p2.name,
    p1Key: key(pm.p1.playerKey), p2Key: key(pm.p2.playerKey), tour, tourBadge: 'ATP',
    surface: sh.surface ? String(sh.surface).toLowerCase() : null,
    tournamentRound: ROUND_FEED[pm.roundCode] ? tour + ' - ' + ROUND_FEED[pm.roundCode] : null, qualifying: false,
    finalScore: { display: sets.map(x => x.p1 + '-' + x.p2).join(', '), sets, p1Sets, p2Sets, winner: pm.winner === 1 ? 'p1' : 'p2' },
    retired: pm.status === 'retired', walkover: pm.status === 'walkover', live: false, interrupted: false, fromDrawResult: true };
}
function analysisId(ev, m) {
  if (!m || m.eventKey == null || S.kind === 'qual') return null;
  const id = 'past-' + m.eventKey;
  if (!ROWS.has(id)) {
    const pm = ev.entry && Array.isArray(ev.entry.matches) ? ev.entry.matches.find(x => String(x.eventKey) === String(m.eventKey)) : null;
    const r = resultRow(ev, pm); if (!r) return null;
    ROWS.set(id, r);
  }
  return id;
}
function openMatch(id) { if (typeof openAnalysisModal === 'function') openAnalysisModal(id, 'matchstats'); }

// the path of one player through the main draw, round by round (no chance figure: founder ruling 3)
function pathOf(M, F, key) {
  const me = F.byKey.get(key); if (!M || !me) return null;
  const pos = me.pos, n = M.rounds.length;
  let outAt = -1, nextSet = false, line = '';
  const cells = M.rounds.map((R, r) => {
    const c = R.cells[(pos - 1) >> (r + 1)], rd = longOf(R.name);
    const base = { rd, code: R.name, r, state: 'gone', opp: DASH, oppKey: null, cands: [], known: false, fig: '', figColor: C.muted, sub: '', op: 1, next: false, score: '' };
    if (outAt >= 0 || (F.out[key] != null && F.out[key] < r)) return Object.assign(base, { op: 0.4 });
    if (r === 0 && c.bye) return Object.assign(base, { state: 'bye', opp: 'No opponent', fig: 'Bye', figColor: C.soft });
    const mine = c.sides.findIndex(s => keyOf(s) === key);
    if (c.match && mine >= 0) {
      const won = c.match.winnerKey === key, o = c.sides[1 - mine];
      const sc = (c.match.score || []).map(p => (mine ? [p[1], p[0]] : p)).map(p => p[0] + '-' + p[1]).join('  ');
      if (!won) outAt = r;
      return Object.assign(base, { state: won ? 'won' : 'lost', opp: o ? 'v ' + nameOf(o) + (tagOf(o) ? ' ' + tagOf(o) : '') : DASH, oppKey: keyOf(o),
        cands: o ? [o] : [], known: true, fig: won ? 'Won' : 'Lost', figColor: won ? C.white : C.muted, sub: sc, score: sc });
    }
    // not played yet: the opponent is known when the other side of his cell is decided; else every player still alive
    // in the opposite half (ordered by seed, then draw position — the draw's own order, never a chance)
    const o = mine >= 0 ? c.sides[1 - mine] : null;
    let cands;
    if (o) cands = [o];
    else {
      const g = 1 << (r + 1), half = g >> 1, gs = ((pos - 1) >> (r + 1)) << (r + 1), oFrom = (pos - 1 - gs) < half ? gs + half : gs;
      cands = F.slots.filter(s => s.pos - 1 >= oFrom && s.pos - 1 < oFrom + half && !(F.out[String(s.playerKey)] != null && F.out[String(s.playerKey)] < r))
        .sort((x, y) => (x.seed == null ? 99 : x.seed) - (y.seed == null ? 99 : y.seed) || x.pos - y.pos);
    }
    if (!cands.length) return Object.assign(base, { state: 'bye', opp: 'No opponent', fig: 'Bye', figColor: C.soft });
    const isNext = !nextSet;
    if (isNext) { nextSet = true; line = 'Next: ' + (o ? 'v ' + nameOf(o) + ' in ' : '') + 'the ' + rd.toLowerCase(); }
    return Object.assign(base, { state: 'open', next: isNext, known: !!o, cands: cands.slice(0, 3), more: Math.max(0, cands.length - 1), opp: o ? 'v ' + nameOf(o) + (tagOf(o) ? ' ' + tagOf(o) : '') : DASH,
      oppKey: keyOf(o), fig: DASH, figColor: C.white, sub: r === n - 1 ? 'to win the title' : 'to reach ' + reachWords(M.rounds[r + 1].name) });
  });
  const qi = M.rounds.findIndex(x => x.name === 'QF');
  const qWon = qi >= 0 && cells[qi] && cells[qi].state === 'won';
  return { me, key, cells, outAt, line, champion: F.champ === key, qWon };
}

// ── handlers: one registry per render (no string escaping in inline handlers) ──────────────────────────────────────
let H = [];
const on = fn => { H.push(fn); return `TTDraw._h(${H.length - 1},event)`; };

// ── shared bits ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ini = n => { const w = String(n || '').replace(/[^A-Za-zÀ-ɏ ]/g, ' ').split(' ').filter(Boolean); return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || '').slice(0, 1)).toUpperCase(); };
// The player's photo by key through the one resolver (player-photos.md); the initials sit under it as the fallback only.
function avatar(key, name, size, ring, fs, title) {
  const ph = key && typeof playerPhotoImg === 'function' ? playerPhotoImg(String(key), name) : '';
  return `<span class="tt-draw-av"${title ? ` title="${esc(title)}"` : ''} style="flex:none; position:relative; overflow:hidden; box-sizing:border-box; width:${size}px; height:${size}px; border-radius:50%; background:${C.lifted}; border:1px solid ${ring || W(10)}; display:flex; align-items:center; justify-content:center; font-size:${fs}px; font-weight:700; color:${C.soft};">${esc(ini(name))}${ph}</span>`;
}
function openProfile(key) { if (key && typeof psOpenProfile === 'function') psOpenProfile(String(key)); }
const hasProfile = key => !!key && (typeof newsHasProfile !== 'function' || newsHasProfile(String(key)));
function goH2H(ka, kb, ca, cb) {
  if (!ka || !kb) return;
  try { sessionStorage.setItem('stn_h2h_pair', JSON.stringify([String(ka), String(kb), ca || '', cb || ''])); } catch (e) { /* private mode */ }
  if (typeof window.sfGoToH2H === 'function') window.sfGoToH2H(String(ka), String(kb));
}
// a segment of a switch track: picked = lifted + 14% edge, white 700; idle = grey 600 (pillS)
const seg = (label, isOn, onclick, pad, extra) => `<span class="tt-draw-seg" onclick="${onclick || ''}" style="display:inline-flex; align-items:baseline; gap:9px; font-size:12.5px; border-radius:8px; padding:${pad || '6px 13px'}; white-space:nowrap; cursor:pointer; ${isOn ? `color:${C.white}; background:${C.lifted}; border:1px solid ${W(14)}; font-weight:700;` : `color:${C.muted}; background:transparent; border:1px solid transparent; font-weight:600;`} ${extra || ''}">${label}</span>`;
const track = inner => `<div style="display:flex; flex-wrap:wrap; gap:3px; background:${C.track}; border:1px solid ${W(10)}; border-radius:10px; padding:3px;">${inner}</div>`;
const closeBtn = (onclick, s) => `<span class="tt-draw-hov" onclick="${onclick}" title="Close" style="flex:none; cursor:pointer; display:flex; align-items:center; justify-content:center; box-sizing:border-box; width:${s || 34}px; height:${s || 34}px; border-radius:${s === 30 ? 8 : 9}px; ${LIFT}">${CLOSE_SVG}</span>`;
const liftBtn = (label, onclick, extra) => `<span class="tt-draw-hov" onclick="${onclick}" style="flex:none; cursor:pointer; display:inline-flex; align-items:center; gap:8px; height:34px; box-sizing:border-box; padding:0 14px; border-radius:9px; font-size:13px; font-weight:700; white-space:nowrap; color:${C.white}; ${LIFT} ${extra || ''}">${label}</span>`;
const chip = (txt, color, title) => `<span${title ? ` title="${esc(title)}"` : ''} style="display:inline-flex; align-items:center; height:22px; padding:0 8px; border-radius:7px; ${LIFT} font-size:11px; font-weight:600; color:${color || C.soft}; white-space:nowrap;">${esc(txt)}</span>`;
function fmtWhen(iso) {
  if (!iso) return DASH;
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz() }); }
  catch (e) { return DASH; }
}
function ago(iso) {
  const t = Date.parse(iso); if (!isFinite(t)) return DASH;
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ${min % 60} min ago`;
}
// the card book's current price for an unplayed pair that is on Today's Matches (odds.md: one book per card); a pair
// that is not on the board has no price → null (nothing drawn); on the board without a price → a dash
function boardPrice(ev, A, Bs) {
  const ka = keyOf(A), kb = keyOf(Bs); if (!ka || !kb) return null;
  const m = ev.board.find(x => [String(x.p1Key), String(x.p2Key)].sort().join('|') === [ka, kb].sort().join('|'));
  if (!m) return null;
  let p = null; try { p = typeof _mcNowPair === 'function' ? _mcNowPair(m) : null; } catch (e) { p = null; }
  if (!p || p.p1 == null || p.p2 == null) return { a: null, b: null, book: '' };
  const flip = String(m.p1Key) !== ka;
  return { a: flip ? p.p2 : p.p1, b: flip ? p.p1 : p.p2, book: p.book || '' };
}
const odd = v => (typeof v === 'number' && isFinite(v) && v >= 1.01 ? v.toFixed(2) : DASH);

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STATISTICS — Speed (how-it-plays.json) + Favourites and underdogs (favourites-by-round.json, database-yield.json
// through settlement.js, tour-baselines.json, this edition's progression scores)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const SPEED = [['Aces per match', 'acesPerMatch', 1, ''], ['Sets with a tiebreak', 'tiebreaksPerSet', 100, '%'], ['1st serve points won', 'firstServeWon', 100, '%'],
  ['2nd serve points won', 'secondServeWon', 100, '%'], ['Service games held', 'hold', 100, '%']];
const ROUND_IX = { '1st Round': 0, '2nd Round': 1, '3rd Round': 2, '4th Round': 3 };
function hipEvent(ev) { const hip = file('how-it-plays.json'); return hip && hip.events ? Object.values(hip.events).find(e => e && e.name === ev.dname) || null : hip === undefined ? undefined : null; }
// this event's Database rows (database-yield.json rows + retRows), name list + archive filter as tournament-market.json
// builds the event (build-tournament-market.js ALIAS / ROW_SPLIT); retirements through settlement.js
function dbRowsOf(ev) {
  const D = file('database-yield.json'), TM = file('tournament-market.json');
  if (D === undefined || TM === undefined) return undefined;
  if (!D) return null;
  const T = (D.meta && D.meta.tournaments) || [];
  const tm = TM && TM.tournaments && TM.tournaments[ev.dname];
  const names = tm && tm.archiveNames ? tm.archiveNames : (T.indexOf(ev.dname) >= 0 ? [ev.dname] : []);
  const filt = (tm && tm.archiveFilter) || {};
  const ix = new Map(names.map(n => [T.indexOf(n), n]).filter(x => x[0] >= 0));
  const ok = r => { const n = ix.get(r[4]); if (n == null) return false; const f = filt[n]; if (!f) return true;
    const y = Math.floor(r[0] / 1e4), mo = Math.floor(r[0] / 100) % 100;
    return (!f.years || f.years.includes(y)) && (!f.surfaces || f.surfaces.includes(r[2])) && (!f.months || f.months.includes(mo)); };
  const Sm = typeof window !== 'undefined' ? window.Settlement : null;
  const out = [];
  (D.rows || []).forEach((r, i) => { if (ok(r)) out.push({ r, i, ret: false, bet: true, win: true }); });
  (D.retRows || []).forEach((r, i) => {
    if (!ok(r)) return;
    const cm = D.retComment && D.retComment[i], fs = D.retFs && D.retFs[i];
    out.push({ r, i, ret: true, bet: !!(Sm && Sm.betCounts({ comment: cm, fs })), win: !!(Sm && Sm.matchWinner({ comment: cm, winnerSide: 1 }) != null) });
  });
  return out;
}
function seasonFigs(rows) {   // season → favourites won % (win population) and flat-1u yields (bet population), floor 15
  const by = {};
  for (const x of rows) {
    const y = Math.floor(x.r[0] / 1e4), o = by[y] || (by[y] = { favW: 0, favN: 0, fp: 0, dp: 0, betN: 0 });
    if (x.win) { o.favN++; if (x.r[7]) o.favW++; }
    if (x.bet) { o.betN++; o.fp += x.r[7] ? x.r[5] - 1 : -1; o.dp += x.r[7] ? -1 : x.r[6] - 1; }
  }
  const res = {};
  for (const y of Object.keys(by)) { const o = by[y];
    res[y] = { fav: o.favN >= FLOOR ? 100 * o.favW / o.favN : null, favN: o.favN, favY: o.betN >= FLOOR ? 100 * o.fp / o.betN : null,
      dogY: o.betN >= FLOOR ? 100 * o.dp / o.betN : null, betN: o.betN, favW: o.favW, fp: o.fp, dp: o.dp }; }
  return res;
}
// deciders and comebacks of this edition, from its own results (progression set scores through the draw model)
function setFacts(M, best) {
  let n = 0, dec = 0, cb = 0;
  if (M) M.rounds.forEach(R => R.cells.forEach(c => {
    const m = c.match; if (!m || m.status !== 'finished' || !Array.isArray(m.score) || !m.score.length) return;
    const wi = c.sides.findIndex(s => keyOf(s) === m.winnerKey); if (wi < 0) return;
    n++; const s0 = m.score[0], down = wi === 0 ? s0[0] < s0[1] : s0[1] < s0[0];
    if (m.score.length === best) dec++; if (down) cb++;
  }));
  return { n, dec, cb };
}
function bestOf(ev) { return /grand slam/i.test(String(ev.draw.category || '')) ? 5 : 3; }
function speedFig(ev, cy) {
  const hip = file('how-it-plays.json'), hev = hipEvent(ev), fl = (hip && hip.floor) || FLOOR;
  const cur = hev && hev.current && Array.isArray(hev.current.years) && hev.current.years.includes(cy) && hev.current.n >= fl ? hev.current : null;
  return cur && cur.metrics.acesPerMatch ? f1(cur.metrics.acesPerMatch.value) : '';
}
function statsModel(ev, M) {
  const yr = +String(ev.start).slice(0, 4), live = played(M) > 0, cy = live ? yr : yr - 1;
  const hip = file('how-it-plays.json'), fbr = file('favourites-by-round.json'), tb = file('tour-baselines.json');
  const hev = hipEvent(ev), hfloor = (hip && hip.floor) || FLOOR;
  const cur = hev && hev.current && Array.isArray(hev.current.years) && hev.current.years.includes(cy) && hev.current.n >= hfloor ? hev.current : null;
  const base = hev && hip.baseline ? hip.baseline[hev.baseline] : null;
  const by = base && base.years || [];
  const baseWords = hev ? `ATP ${hev.indoor ? 'indoor' : 'outdoor'} hard, best of three, ${by[0]}${NDASH}${by[by.length - 1]}` : '';
  const speed = SPEED.map(([label, k, mul, unit]) => {
    const mc = cur && cur.metrics[k], mb = base && base.metrics && base.metrics[k];
    return { label, unit, sign: false, v: mc ? mc.value * mul : null, tour: mb ? mb.value * mul : null, series: {},
      vTitle: mc ? `${cur.n} matches, ${ev.city} ${cy} main draw (our box scores)` : (hev ? `No ${cy} figure for ${ev.city} (fewer than ${hfloor} matches with box scores)` : `${ev.city}: no How it plays figures (hard courts only)`),
      tourTitle: mb ? `${baseWords}, ${base.n} matches (Sackmann 2016${NDASH}24 under CC BY-NC-SA, our box scores 2025)` : 'No tour average for this court' };
  });
  // the Speed group's empty state: no figure for this edition (or no How it plays figures for this court at all)
  const speedEmpty = speed.every(t => t.v == null)
    ? (hev ? `How it plays holds no ${cy} figures for ${ev.city} yet (fewer than ${hfloor} main-draw matches with box scores).` : `How it plays covers hard-court events only; ${ev.city} has no figures.`)
    : '';
  // Favourites and underdogs
  const fe = fbr && fbr.events && fbr.events[ev.dname];
  const lastRow = rows => (Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null);
  const fCur = fe && fe.current && fe.current.year === cy ? lastRow(fe.current.rows) : null;
  const fB = fe && fbr.baseline && fbr.baseline[fe.court], fBase = fB ? lastRow(fB.rows) : null;
  const pctOf = row => (row && row.n >= FLOOR ? 100 * row.fav / row.n : null);
  const dbRows = dbRowsOf(ev), sf = dbRows ? seasonFigs(dbRows) : {};
  const cyF = sf[cy] || null, sets = live ? setFacts(M, bestOf(ev)) : { n: 0, dec: 0, cb: 0 };
  const role = k => (tb && tb.roles && tb.roles[k] && tb.roles[k].yield != null ? tb.roles[k] : null);
  const series = k => { const o = {}; Object.keys(sf).forEach(y => { if (+y < cy && sf[y][k] != null) o[y] = sf[y][k]; }); return o; };
  const mkt = [
    { key: 'fav', label: 'Favourites won', unit: '%', sign: false, v: fCur ? pctOf(fCur) : cyF ? cyF.fav : null, tour: pctOf(fBase), series: series('fav'),
      vTitle: fCur ? `${fCur.fav} of ${fCur.n} priced matches won by the shorter price, the price every page shows for the match (${fCur.n - (fCur.approx || 0) - (fCur.b365 || 0)} Pinnacle closes, ${fCur.approx || 0} Pinnacle (approx.), ${fCur.b365 || 0} Bet365; ties and walkovers out)` : cyF ? `${cyF.favW} of ${cyF.favN} priced matches won by the shorter closing price (Database rows, retirements count)` : `No ${cy} favourites figure`,
      tourTitle: fBase ? `ATP ${String(fe.court).toLowerCase()}, ${(fB.years || []).join(NDASH)}, ${fBase.n} matches` : '' },
    { key: 'favY', label: 'Backing favourites', unit: '%', sign: true, v: cyF ? cyF.favY : null, tour: role('favourite') ? role('favourite').yield * 100 : null, series: series('favY'),
      vTitle: cyF ? `1 unit on every favourite, ${cyF.betN} priced matches (retirements settle on Pinnacle rules)` : `No ${cy} priced matches`,
      tourTitle: role('favourite') ? `Tour yield, ${role('favourite').n} matches, ${(tb.dateRange || []).join(NDASH)}` : '' },
    { key: 'dogY', label: 'Backing underdogs', unit: '%', sign: true, v: cyF ? cyF.dogY : null, tour: role('underdog') ? role('underdog').yield * 100 : null, series: series('dogY'),
      vTitle: cyF ? `1 unit on every underdog, ${cyF.betN} priced matches (retirements settle on Pinnacle rules)` : `No ${cy} priced matches`,
      tourTitle: role('underdog') ? `Tour yield, ${role('underdog').n} matches, ${(tb.dateRange || []).join(NDASH)}` : '' },
    { key: 'dec', label: 'Matches going to a decider', unit: '%', sign: false, v: sets.n >= FLOOR ? 100 * sets.dec / sets.n : null, tour: null, series: {},
      vTitle: sets.n ? `${sets.dec} of ${sets.n} completed matches` : 'No completed match yet', tourTitle: 'No tour figure on file (needs past set scores)' },
    { key: 'cb', label: 'Won from a set down', unit: '%', sign: false, v: sets.n >= FLOOR ? 100 * sets.cb / sets.n : null, tour: null, series: {},
      vTitle: sets.n ? `${sets.cb} of ${sets.n} completed matches` : 'No completed match yet', tourTitle: 'No tour figure on file (needs past set scores)' },
  ];
  [speed, mkt].forEach(g => g.forEach(t => {
    const held = Object.keys(t.series).map(Number).sort((a, b) => a - b);
    const five = held.slice(-5);
    t.dN = t.v != null && t.tour != null ? t.v - t.tour : null;
    t.gapN = t.dN != null ? sg(t.dN) : DASH;
    t.gapLL = 'vs ' + (cy - 1);
    t.dL = t.v != null && t.series[cy - 1] != null ? t.v - t.series[cy - 1] : null;
    t.gapL = t.dL != null ? sg(t.dL) : DASH;
    // past five = the five editions held before this one (founder 2026-11-15); fewer on file → a dash
    t.avg5 = five.length === 5 ? five.reduce((a, y) => a + t.series[y], 0) / 5 : null;
    t.dP = t.v != null && t.avg5 != null ? t.v - t.avg5 : null;
    t.gapP = t.dP != null ? sg(t.dP) : DASH;
    // six columns: those five editions (padded with the seasons before them when fewer are on file) + this one
    let ys = five.slice(); let y0 = (ys[0] || cy) - 1; while (ys.length < 5) { ys.unshift(y0); y0--; }
    ys = ys.concat([cy]);
    const vals = ys.map((y, j) => (j === 5 ? t.v : t.series[y] != null ? t.series[y] : null));
    const all = vals.concat([t.tour]).filter(x => x != null), lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    const ch = x => 18 + (hi > lo ? (x - lo) / (hi - lo) : 0.5) * 82;
    t.tourB = t.tour != null ? ch(t.tour) + '%' : null;
    t.cols = ys.map((y, j) => ({ y, now: j === 5, v: vals[j], h: vals[j] != null ? ch(vals[j]) + '%' : '0%' }));
    t.fig = t.v == null ? DASH : (t.sign && t.v > 0 ? '+' : t.v < 0 ? MINUS : '') + f1(t.v) + t.unit;
    t.figColor = t.sign && t.v != null ? (t.v > 0 ? C.green : t.v < 0 ? C.red : C.white) : C.white;
  }));
  const fm = (t, x) => (x == null ? DASH : (t.sign && x > 0 ? '+' : x < 0 ? MINUS : '') + f1(x) + t.unit);
  const up = speed.filter(t => t.v != null && t.tour != null && t.v > t.tour).length, have = speed.filter(t => t.v != null && t.tour != null).length;
  const n1 = have === 5 ? (up >= 4 ? `Playing faster than the tour, ${up} of 5 measures above average` : up <= 1 ? `Playing slower than the tour, ${5 - up} of 5 measures below average` : 'Speed close to the tour average') : '';
  const fd = mkt[0].v != null && mkt[0].tour != null ? mkt[0].v - mkt[0].tour : null;
  const n2 = fd == null ? '' : fd >= 4 ? 'Favourites are holding up better than usual' : fd <= -4 ? 'More upsets than usual' : 'Favourites win about as often as usual';
  return { live, cy, speed, mkt, n1, n2, fm, dbRows, sets, hev, speedEmpty };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PLAYER BOX — his figures in this draw against the field (design 1b, nine measures in Results · Serve · Return)
//   Results: sets won, games won — from the draw's own set scores (a retirement's unfinished set is no set).
//   Serve / Return: tournament-progression players[].rounds[].metrics (our box scores): aces, 1st / 2nd serve points won
//   (mean of his matches; the feed sends no count for them), service games held, return games won, break points
//   converted, break points saved (sums of the won / total counts; bpSaved from the progression since 2026-11-20 —
//   a draw built before that has no figure, a dash row).
//   Field = the mean over every player of this draw with that measure; Rank = 1 + players with a better figure.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const setDone = (a, b) => (Math.max(a, b) >= 6 && Math.abs(a - b) >= 2) || (Math.max(a, b) === 7 && Math.min(a, b) >= 5);
const MEASURES = [
  ['Results', 'Sets won', '%', 'sets'], ['Results', 'Games won', '%', 'games'],
  ['Serve', 'Aces per match', '', 'aces'], ['Serve', '1st serve points won', '%', 'firstServeWonPct'], ['Serve', '2nd serve points won', '%', 'secondServeWonPct'],
  ['Serve', 'Service games held', '%', 'svHold'], ['Serve', 'Break points saved', '%', 'bpSaved'],
  ['Return', 'Return games won', '%', 'retGames'], ['Return', 'Break points converted', '%', 'bpConv'],
];
function boxFigures(M, F, entry) {
  const ST = {};
  F.slots.forEach(s => { ST[String(s.playerKey)] = { m: 0, sw: 0, sl: 0, gw: 0, gl: 0 }; });
  if (M) M.rounds.forEach(R => R.cells.forEach(c => {
    const m = c.match; if (!m || !Array.isArray(m.score) || !m.score.length || m.status === 'walkover') return;
    const ka = keyOf(c.sides[0]), kb = keyOf(c.sides[1]); if (!ka || !kb || !ST[ka] || !ST[kb]) return;
    ST[ka].m++; ST[kb].m++;
    m.score.forEach(([a, b]) => { a = +a; b = +b; ST[ka].gw += a; ST[ka].gl += b; ST[kb].gw += b; ST[kb].gl += a;
      if (setDone(a, b)) { if (a > b) { ST[ka].sw++; ST[kb].sl++; } else { ST[kb].sw++; ST[ka].sl++; } } });
  }));
  const val = {};   // measure key → player key → { v, n } (n = what the figure is over, for the hover)
  MEASURES.forEach(x => { if (x[3]) val[x[3]] = {}; });
  Object.keys(ST).forEach(k => { const s = ST[k]; if (!s.m) return;
    if (s.sw + s.sl) val.sets[k] = { v: 100 * s.sw / (s.sw + s.sl), n: `${s.sw} of ${s.sw + s.sl} sets` };
    if (s.gw + s.gl) val.games[k] = { v: 100 * s.gw / (s.gw + s.gl), n: `${s.gw} of ${s.gw + s.gl} games` }; });
  const players = entry && Array.isArray(entry.players) ? entry.players : [];
  players.forEach(p => {
    const k = String(p.playerKey); if (!ST[k]) return;   // main-draw players of this sheet only
    const ms = (p.rounds || []).map(r => r.metrics).filter(Boolean);
    const sum = f => { let w = 0, t = 0; ms.forEach(m => { const x = m[f]; if (x && x.total > 0) { w += x.won; t += x.total; } }); return t ? { v: 100 * w / t, n: `${w} of ${t}` } : null; };
    const mean = f => { const xs = ms.map(m => m[f]).filter(x => typeof x === 'number' && isFinite(x)); return xs.length ? { v: xs.reduce((a, x) => a + x, 0) / xs.length, n: `mean of ${xs.length} match${xs.length === 1 ? '' : 'es'}` } : null; };
    const ac = ms.map(m => m.aces).filter(x => typeof x === 'number' && isFinite(x));
    if (ac.length) val.aces[k] = { v: ac.reduce((a, x) => a + x, 0) / ac.length, n: `${ac.reduce((a, x) => a + x, 0)} aces in ${ac.length} match${ac.length === 1 ? '' : 'es'}` };
    ['firstServeWonPct', 'secondServeWonPct'].forEach(f => { const r = mean(f); if (r) val[f][k] = r; });
    ['svHold', 'retGames', 'bpConv', 'bpSaved'].forEach(f => { const r = sum(f); if (r) val[f][k] = r; });
  });
  return { ST, val };
}
const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
function boxModel(M, F, entry, key) {
  const { ST, val } = boxFigures(M, F, entry), me = ST[key] || { m: 0 };
  const fieldN = Object.keys(ST).filter(k => ST[k].m > 0).length;
  let above = 0, cmp = 0;
  const rows = MEASURES.map(([grp, l, unit, k]) => {
    const pc = unit === '%', rd = x => (pc ? Math.round(x) : Math.round(x * 10) / 10), fmt = x => (pc ? String(x) : x.toFixed(1)) + unit;
    const all = k ? Object.keys(val[k]).map(p => rd(val[k][p].v)) : [];
    const avg = all.length ? rd(all.reduce((a, x) => a + x, 0) / all.length) : null;
    const mine = k && val[k][key] ? val[k][key] : null;
    const why = mine ? '' : 'No figure for him in our box scores for this draw';
    if (!mine) return { grp, l, v: DASH, f: avg != null ? fmt(avg) : DASH, g: DASH, gc: C.muted, barL: '50%', barW: '0%', rank: DASH, rankC: C.muted, rankW: 500, of: '', why, fTitle: all.length ? `mean of ${all.length} players` : 'No player of this draw has this figure' };
    const v = rd(mine.v), d = Math.round((v - avg) * 10) / 10, mx = Math.max.apply(null, all.map(x => Math.abs(x - avg))) || 1;
    const bw = d ? 18 + Math.abs(d) / mx * 28 : 0, rk = all.filter(x => x > v).length + 1;
    cmp++; if (d > 0) above++;
    return { grp, l, v: fmt(v), f: fmt(avg), g: (d > 0 ? '+' : d < 0 ? MINUS : '') + (pc ? Math.abs(d) : Math.abs(d).toFixed(1)), gc: d > 0 ? C.green : d < 0 ? C.red : C.muted,
      barL: (d >= 0 ? 50 : 50 - bw) + '%', barW: bw + '%', rank: ord(rk), rankC: rk <= 3 ? C.white : C.muted, rankW: rk <= 3 ? 700 : 500, of: 'of ' + all.length, why: mine.n, fTitle: `mean of ${all.length} players` };
  });
  return { me, fieldN, rows, above, cmp };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// POINTS TO DEFEND — points-to-defend.json (rows for the open draw by its ATP id and season) + player-index.json
// ranking points: "Would be" = his rank once the points he defends here drop, against every other player's points as
// they stand. His or the needed points missing → a dash, never a guess.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const LAST = { Won: 'Champion', F: 'Final', SF: 'Semi-final', QF: 'Quarter-final' };
const lastWord = r => LAST[r] || (/^Q\d$/.test(r) ? 'Qualifying ' + r : r === 'Q' ? 'Qualified' : longOf(r));
const lastWords = r => (r ? String(r).split('|').map(x => lastWord(x.trim())).join(' · ') : DASH);   // "R32 | Q" → "Round of 32 · Qualified"
function ptsModel(ev, F) {
  const P = file('points-to-defend.json'); if (P === undefined) return undefined;
  const e = P && P.events ? Object.values(P.events).find(x => x && String(x.atpId) === String(ev.id) && String(x.season) === String(ev.start).slice(0, 4)) : null;
  if (!e) return null;
  const idx = standings(), byKey = new Map((idx || []).map(r => [String(r.key), r]));
  const num = x => (x == null || x === '' ? null : Number.isFinite(+x) ? +x : Number.isFinite(parseInt(x, 10)) ? parseInt(x, 10) : null);
  const mk = r => {
    const k = String(r.playerKey), ix = byKey.get(k), pts = num(r.points), mine = ix ? num(ix.points) : null;
    const today = ix && num(ix.rank) != null ? num(ix.rank) : num(r.rank);
    let would = null;
    if (idx && mine != null && pts != null && today != null) {
      const left = mine - pts;
      would = Math.max(today, 1 + idx.filter(o => String(o.key) !== k && num(o.points) != null && num(o.points) > left).length);   // never above today's rank
    }
    const drop = would != null && today != null ? Math.max(0, would - today) : null;
    const slot = F.byKey.get(k);
    return { k, n: r.apiName || r.name, full: r.name, tag: slot ? tagOf(slot) : '', pts, last: lastWords(r.resultBadge) + (r.ll ? ' · LL' : ''), today, would, drop, inDraw: !!slot, status: r.status || '',
      whyRank: mine == null ? 'No ranking points on file for him' : pts == null ? 'The points he defends here are not known' : '' };
  };
  const rows = (e.rows || []).map(mk).concat((e.dashRows || []).map(mk));
  const frees = (e.zeroRows || []).map(mk);
  return { e, rows, frees, total: rows.reduce((a, r) => a + (r.pts || 0), 0), idx };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
function shell(inner) { return `<div class="tt-draw"><div class="tt-draw-pane" data-draw-root="1" style="position:relative;">${inner}</div></div>`; }
function render(el) {
  if (el) S.el = el;
  const root = S.el; if (!root) return;
  injectCss();
  H = [];
  const D = DV(), dd = drawsData();
  if (!D || dd === undefined) { paint(root, shell(`<div style="font-size:13px; color:${C.muted};">Loading the official draw…</div>`)); return; }
  file('draws-archive.json');   // finished draws with their final results (a 404 = none); repaints when it lands
  const E = events();
  if (!E.all.length) { paint(root, shell(`<div style="font-size:13px; color:${C.muted};">${dd === null ? 'The official draw could not be loaded ' + NDASH + ' try again in a minute.' : 'No official draw is posted for this week yet.'}</div>`)); return; }
  // the tab opens on the draw in play, else the latest finished one (README "Data")
  if (!S.key || !E.all.some(e => e.key === S.key)) S.key = (E.now[0] || E.fin[0] || E.arch[0]).key;
  const ev = E.all.find(e => e.key === S.key);
  const qualPosted = !!(ev.draw.qualifying && ev.draw.qualifying.status === 'posted');
  if (S.kind === 'qual' && !qualPosted) S.kind = 'main';
  if (S.view === 'out') S.kind = 'main';
  const Mm = modelOf(ev, 'main'), M = S.kind === 'qual' ? modelOf(ev, 'qual') : Mm, F = facts(Mm, ev);
  if (S.sel && !F.byKey.has(S.sel)) Object.assign(S, { sel: null, b: null, cmp: false });
  if (S.b && !F.byKey.has(S.b)) S.b = null;
  if (S.pop && (!F.byKey.has(S.pop.key) || S.kind === 'qual')) S.pop = null;
  const view = ['stats', 'out', 'pts'].includes(S.view) ? S.view : 'draw';
  if (view !== 'draw') S.pop = null;
  if (view === 'stats') { file('how-it-plays.json'); file('favourites-by-round.json'); file('tour-baselines.json'); file('database-yield.json'); file('tournament-market.json'); }
  if (view !== 'stats') { S.ed = null; S.stat = null; }
  const st = view === 'stats' ? statsModel(ev, Mm) : null;
  const pm = ptsModel(ev, F);
  if (view === 'pts') standings();
  const yr = +String(ev.start).slice(0, 4);
  const pl = played(Mm), tp = total(Mm), finished = !!F.champ || (ev.ended && pl > 0) || ev.arch;
  const logos = file('tournament-logos/index.json');

  let h = '';
  // ── round "?" in the top right corner (founder 2026-11-20: ALL explanatory text lives in its box) ──
  h += `<div style="position:absolute; top:26px; right:24px; z-index:3;"><span class="tt-draw-help" data-tt="help" onclick="${on(e => toggleHelp(e))}" title="How to read this page" style="cursor:pointer; box-sizing:border-box; width:16px; height:16px; border-radius:50%; border:1px solid ${S.help ? W(55) : W(22)}; color:${S.help ? C.white : C.muted}; display:flex; align-items:center; justify-content:center; ${MONO} font-size:10px; font-weight:700; line-height:1; user-select:none;">?</span></div>`;
  // ── "Draws" + count ──
  h += `<div style="display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; min-width:0; padding-right:28px;"><span style="font-size:24px; font-weight:800; letter-spacing:-0.015em; line-height:1.1;">Draws</span><span style="font-size:13px; color:${C.muted};">${E.now.length} this week · ${E.fin.length} finished · ${E.arch.length} in the archive</span></div>`;
  // ── picker row: This week · Finished · Archive + Download W/UE sheet at the right end ──
  const pickPill = (e, stage) => seg(`<span>${esc(evName(e))}</span>${stage ? `<span style="${MONO} font-size:10.5px; font-weight:500; color:${C.muted};">${esc(stage)}</span>` : ''}`, e.key === S.key,
    on(() => { S.key = e.key; S.from = null; S.kind = 'main'; reset(); repaint(); }));
  const stageFor = e => { const m = modelOf(e, 'main'); return stageOf(m, facts(m, e)); };
  const titled = (e, html) => { const s = stageFor(e); return s !== DASH && s !== 'Draw out' ? html.replace('<span class="tt-draw-seg"', `<span class="tt-draw-seg" title="Champion ${esc(s)}"`) : html; };
  const group = (label, inner) => `<div style="display:flex; align-items:center; gap:10px; min-width:0;"><span style="flex:none; ${LBL} white-space:nowrap;">${label}</span>${inner}</div>`;
  const wueName = ev.entryName || (ev.arch ? cityOf(ev.draw) : null);
  let wueRounds = 0; try { wueRounds = window.WueSheet && ev.entry && Array.isArray(ev.entry.matches) ? window.WueSheet.sheetRounds(ev.entry, ev.draw).length : 0; } catch (e) { wueRounds = 0; }
  const dlOk = !!(wueName && wueRounds && window.WueSheet && window.WueSheet.download);
  const dlLabel = S.dl === 'busy' ? 'Downloading…' : S.dl === 'done' ? 'Sheet downloaded' : S.dl === 'fail' ? 'Couldn’t reach the data' : 'Download W/UE sheet';
  const dlTitle = dlOk ? 'Winners and unforced errors, every round up to the last match played' : 'No match with statistics yet: available after the next data update';
  h += `<div style="display:flex; flex-wrap:wrap; align-items:center; gap:10px 22px; margin-top:14px;">`
    + group('This week', E.now.length ? track(E.now.map(e => pickPill(e, stageFor(e))).join('')) : `<span style="font-size:13px; color:${C.soft};">No draw in play</span>`)
    + (E.fin.length ? group('Finished', track(E.fin.map(e => titled(e, pickPill(e))).join(''))) : '')
    + (E.arch.length ? group('Archive', track(E.arch.map(e => titled(e, pickPill(e))).join(''))) : '')
    + `<span class="${dlOk ? 'tt-draw-hov' : ''}" data-tt="dl" onclick="${dlOk ? on(() => downloadSheet(wueName)) : ''}" title="${esc(dlTitle)}" style="flex:none; margin-left:auto; cursor:${dlOk ? 'pointer' : 'default'}; display:inline-flex; align-items:center; height:34px; box-sizing:border-box; padding:0 14px; border-radius:9px; font-size:13px; font-weight:700; white-space:nowrap; color:${dlOk ? (S.dl === 'fail' ? C.red : C.white) : C.muted}; ${LIFT}">${dlLabel}</span>`
    + `</div>`;
  h += `<div style="margin:20px -24px 0; border-top:1px solid ${W(6)};"></div>`;
  // ── open-draw head: logo tile · name + status chip over the tier line | Champion | Matches played | Compare two routes ──
  const lf = logos && logos.logos ? logos.logos[ev.dname] || logos.logos[ev.city] : null;
  const code = evName(ev).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  const logo = `<span title="${esc(evName(ev))}" style="flex:none; position:relative; overflow:hidden; width:48px; height:48px; border-radius:12px; background:${C.lifted}; box-shadow:inset 0 0 0 1px ${W(14)}; display:flex; align-items:center; justify-content:center; ${MONO} font-size:13px; font-weight:700; color:${C.soft};">${lf ? `<img src="./tournament-logos/${esc(lf)}" alt="${esc(evName(ev))} logo" loading="lazy" onerror="this.remove()" style="position:absolute; left:4px; top:4px; width:40px; height:40px; object-fit:contain;">` : esc(code)}</span>`;
  const tier = String(ev.draw.category || '').replace(/^ATP Tour /, '');
  const surf = ev.draw.sheetHeader && ev.draw.sheetHeader.surface ? ev.draw.sheetHeader.surface : '';
  const stChip = finished ? 'Finished' : pl === 0 ? 'Draw out' : 'In play';
  const champS = F.champ ? F.byKey.get(F.champ) : null;
  h += `<div style="display:flex; align-items:center; justify-content:space-between; gap:16px 32px; flex-wrap:wrap; margin-top:22px;">
    <div style="display:flex; align-items:center; gap:14px; min-width:0;">${logo}<div style="display:flex; flex-direction:column; gap:6px; min-width:0;">
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;"><span style="font-size:22px; font-weight:800; letter-spacing:-0.015em; line-height:1.1;">${esc(evName(ev))}</span>${chip(stChip)}</div>
      <span style="font-size:13px; color:${C.muted};">${esc([tier, surf].filter(Boolean).join(' · '))} · draw sheet ${esc(fmtWhen(Mm ? Mm.changedAt : ev.draw.contentChangedAt))}</span></div></div>
    <div style="display:flex; align-items:center; gap:16px 36px; flex-wrap:wrap;">`
    + (champS && S.kind !== 'qual' ? `<div style="display:flex; flex-direction:column; gap:6px;"><span style="${LBL}">Champion</span><span style="font-size:16px; font-weight:700; color:${C.white}; line-height:1.1;">${esc(nameOf(champS))}</span></div>` : '')
    + `<div style="display:flex; flex-direction:column; gap:6px;"><span style="${LBL}">Matches played</span><span style="${MONO} font-size:16px; font-weight:700; color:${C.white}; line-height:1.1;">${Mm ? pl + ' of ' + tp : DASH}</span></div>`
    + liftBtn(`${S.outCmp ? 'Cancel' : 'Compare two routes'}<span style="color:${C.blue};">›</span>`, on(() => {
        if (S.outCmp) Object.assign(S, { outCmp: false, outA: null, outB: null, outQ: '' });
        else { Object.assign(S, { kind: 'main', outCmp: true, outA: null, outB: null, outQ: '', sel: null, b: null, cmp: false, shut: null, pop: null }); S._focusNext = true; }
        repaint(); }))
    + `</div></div>`;
  if (S.outCmp) h += pickStrip(ev, F);
  // ── toolbar: views | From (Draw view only) + Main draw · Qualifying ──
  const views = [['draw', 'Draw', Mm ? `${pl} of ${tp}` : ''], ['stats', 'Statistics', speedFig(ev, pl > 0 ? yr : yr - 1)], ['out', 'Outright chances', ''], ['pts', 'Points to defend', pm ? String(pm.total) : '']];
  const names = M ? M.rounds.map(r => r.name) : [];
  const fromOpts = names.slice(0, Math.max(1, names.length - 1));
  if (S.kind === 'qual' || !fromOpts.includes(S.from)) S.from = names[0] || null;
  const showFrom = S.kind !== 'qual' && view === 'draw' && !!M;
  h += `<div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px 24px; margin-top:20px; padding-top:18px; border-top:1px solid ${W(6)};">
    ${track(views.map(([v, l, fig]) => seg(`${l}${fig ? `<span style="${MONO} font-size:11.5px; font-weight:500; color:${C.muted};">${esc(fig)}</span>` : ''}`, v === view,
      on(() => { S.view = v; if (v === 'out') S.kind = 'main'; S.pop = null; repaint(); }), '0 14px', 'height:32px; box-sizing:border-box; align-items:center; gap:8px;')).join(''))}
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:12px;">`
    + (showFrom ? `<div style="flex:none; display:flex; align-items:center; gap:10px;"><span style="${LBL}">From</span>${track(fromOpts.map(n => seg(n, n === S.from, on(() => { S.from = n; S.pop = null; repaint(); }), '6px 16px')).join(''))}</div>` : '')
    + track([['main', 'Main draw'], ['qual', 'Qualifying']].map(([k, l]) => (k === 'qual' && !qualPosted)
        ? `<span title="The qualifying draw is not posted" style="font-size:12.5px; font-weight:600; color:${C.muted}; opacity:0.4; border:1px solid transparent; border-radius:8px; padding:6px 12px; white-space:nowrap; cursor:default;">${l}</span>`
        : seg(l, S.kind === k, on(() => { S.kind = k; S.from = null; S.pop = null; if (k === 'qual' && (S.view === 'out' || S.view === 'pts')) S.view = 'draw'; repaint(); }), '6px 12px')).join(''))
    + `</div></div>`;
  // ── progress bar + "Results n min ago": ONLY while a draw is in play ──
  if (!finished && Mm) h += `<div style="display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; margin-top:16px;">
    <div title="${pl} of ${tp} matches played" style="flex:1 1 80px; height:4px; border-radius:2px; background:${W(7)}; overflow:hidden;"><div style="height:100%; width:${tp ? Math.round(pl / tp * 100) : 0}%; background:${BAR55}; border-radius:2px;"></div></div>
    <span style="flex:none; font-size:12px; color:${C.muted}; white-space:nowrap;">Results ${esc(progData() && progData().fetchedAt ? ago(progData().fetchedAt) : DASH)}</span></div>`;
  // ── the view ──
  if (view === 'stats') h += statsHtml(ev, Mm, st);
  if (view === 'pts') h += ptsHtml(ev, Mm, F, pm, finished);
  if (S.kind !== 'qual' && (view === 'out' || (view === 'draw' && S.sel))) {
    h += `<div style="margin-top:14px;">`;
    if (view === 'out') h += outrightHtml(ev, Mm, F);
    if (view === 'draw' && S.sel) h += selHtml(ev, Mm, F);
    h += `</div>`;
  }
  if (view === 'draw' && M) h += bracketHtml(ev, M, F);
  if (view === 'draw' && !M) h += `<div style="margin-top:24px; font-size:13px; color:${C.muted};">This draw is not posted yet.</div>`;
  if (S.pop && view === 'draw') h += popHtml(ev, Mm, F, finished);
  if (S.help) h += helpHtml(finished);
  paint(root, shell(h));
}

// the "?" box: fixed under its button, every explanatory line of the page (founder 2026-11-20)
function toggleHelp(e) {
  if (S.help) { S.help = null; return repaint(); }
  const t = e && e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
  const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800, vw = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280;
  S.help = t ? { t: Math.max(16, Math.min(t.bottom + 8, vh - 340)), r: Math.max(16, vw - t.right) } : { t: 80, r: 24 };
  repaint();
}
function helpHtml(finished) {
  const L = [
    finished ? ['Prices', 'Hover a name on an unplayed match for its current match-winner price, when Today’s Matches carries it.'] : ['Prices', 'Grey figures on unplayed matches are the current match-winner prices from Today’s Matches.'],
    ['Title chances', 'Not available yet: every chance, fair-odds range and opening-price range shows a dash until a source exists.'],
    ['Click a name', 'Opens his figures in this draw against the field. His name or photo in that box opens his profile.'],
    ['Compare two routes', 'The ringed round is where the two could meet. Click a round for his opponent, or the players he might face.'],
    ['Outright chances', 'The quarter winner is the player who reaches the semi-finals. Click a player to follow his route through the draw.'],
    ['Points to defend', 'Points he won here last year. "Would be" is his ranking once those points drop, against every other player’s ranking points as they stand.'],
    ['W/O', 'A walkover: no match was played, so it carries no statistics.'],
    ['Download W/UE sheet', 'One sheet with the winners and unforced errors of every round, up to the last match played.'],
  ];
  const close = on(() => { S.help = null; repaint(); });
  return `<div onclick="${close}" style="position:fixed; inset:0; z-index:29;"></div>
    <div class="tt-draw-helpbox" style="position:fixed; z-index:30; right:${S.help.r}px; top:${S.help.t}px; width:360px; max-width:calc(100vw - 32px); max-height:calc(100vh - ${S.help.t + 16}px); overflow-y:auto; box-sizing:border-box; background:${C.inset}; border:1px solid ${W(16)}; border-radius:12px; box-shadow:${C.shMenu}; padding:16px 18px 6px;">
      <span style="font-size:14px; font-weight:700; color:${C.white};">How to read this page</span>
      <div style="margin-top:10px;">${L.map(([k, v]) => `<div style="display:flex; flex-direction:column; gap:4px; padding:10px 0; border-top:1px solid ${W(6)};"><span style="font-size:12.5px; font-weight:700; color:${C.white};">${esc(k)}</span><span style="font-size:12.5px; line-height:1.5; color:${C.soft}; text-wrap:pretty;">${esc(v)}</span></div>`).join('')}</div></div>`;
}
function downloadSheet(name) {
  if (!name || !window.WueSheet || S.dl === 'busy') return;
  S.dl = 'busy'; repaint();
  const done = st => { S.dl = st; repaint(); setTimeout(() => { if (S.dl === st) { S.dl = null; repaint(); } }, 2400); };
  let p; try { p = Promise.resolve(window.WueSheet.download(name)); } catch (e) { p = Promise.reject(e); }
  p.then(() => done('done'), () => done('fail'));
}

// keep focus + caret in a re-rendered input (every keystroke repaints)
function paint(root, html) {
  const a = typeof document !== 'undefined' ? document.activeElement : null;
  const fid = a && a.getAttribute && root.contains(a) ? a.getAttribute('data-ttin') : null, pos = fid ? a.selectionStart : null;
  root.innerHTML = html;
  if (fid) { const n = root.querySelector(`[data-ttin="${fid}"]`); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* not text */ } } }
  else if (S._focusNext) { const af = root.querySelector('[data-ttin]'); if (af) af.focus(); }
  S._focusNext = false;
}
function repaint() { if (S.el && S.el.isConnected !== false && (!S.el.style || S.el.style.display !== 'none')) render(); }

// ── bracket ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function bracketHtml(ev, M, F) {
  const qual = S.kind === 'qual', fromIx = Math.max(0, M.rounds.findIndex(r => r.name === S.from));
  const vis = M.rounds.slice(fromIx), Hpx = vis[0].cells.length * 96;
  const selPos = !qual && S.sel && F.byKey.get(S.sel) ? F.byKey.get(S.sel).pos : null, bPos = !qual && S.b && F.byKey.get(S.b) ? F.byKey.get(S.b).pos : null;
  const cmpMode = !!(S.sel && S.cmp);
  const row = (c, k) => {
    const s = c.sides[k], o = c.sides[1 - k];
    if (!s) {
      if (c.bye) return `<div style="display:flex; align-items:center; height:26px; padding:0 6px; margin:0 -6px;"><span style="margin-left:30px; font-size:12.5px; color:${C.muted};">Bye</span></div>`;
      return `<div style="height:26px;"></div>`;
    }
    const key = keyOf(s), m = c.match, dec = !!m, win = dec && m.winnerKey === key, wo = dec && m.status === 'walkover';
    const isSel = !qual && key && key === S.sel, isB = !qual && key && key === S.b, isPop = S.pop && key === S.pop.key;
    const mark = isSel || (S.outCmp && key && key === S.outA), white = isB || (S.outCmp && key && key === S.outB);
    const w = win ? 700 : dec ? 500 : 600, color = win || mark || white ? C.white : dec ? C.muted : C.text;
    const bg = isPop || mark ? C.hover : white ? W(8) : 'transparent';
    let sets = '', odds = '', title = '';
    if (wo) { odds = win ? 'W/O' : ''; title = 'Walkover, no match played'; }
    else if (dec && Array.isArray(m.score)) sets = m.score.map(p => { const mine = k ? p[1] : p[0], th = k ? p[0] : p[1], won = mine > th;
      return `<span style="width:9px; text-align:center; font-weight:${won ? 700 : 400}; color:${won ? C.text : C.muted};">${esc(mine)}</span>`; }).join('');
    else if (!dec && c.when && c.when.live && c.when.liveScore) { sets = c.when.liveScore.map(p => `<span style="width:9px; text-align:center; font-weight:400; color:${C.text};">${esc(k ? p[1] : p[0])}</span>`).join(''); title = 'Live'; }
    else if (!dec && o && !qual) { const p = boardPrice(ev, c.sides[0], c.sides[1]); if (p) { const v = k ? p.b : p.a; odds = odd(v);
      title = v != null ? `Price ${odd(v)}${p.book ? ' · ' + (typeof mxBookLabel === 'function' ? mxBookLabel(p.book) : p.book) : ''}` : 'No current price on Today’s Matches'; } }
    const tag = tagOf(s) + (dec && !win && m.status === 'retired' ? ' ret.' : '');
    const country = s.ioc || (s.neutral ? 'Neutral athlete' : '');
    const aid = dec && !wo ? analysisId(ev, m) : null;
    const scoreAttrs = aid ? ` class="tt-draw-score" role="button" tabindex="0" title="Open match analysis" onclick="${on(() => openMatch(aid))}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault(); event.stopPropagation(); this.click();}"` : '';
    return `<div class="tt-draw-prow" data-tt-player="${esc(key || '')}" onclick="${on(e => pickName(key, qual, e))}"${title ? ` title="${esc(title)}"` : ''} style="cursor:pointer; display:flex; align-items:center; gap:8px; height:26px; padding:0 6px; margin:0 -6px; border-radius:6px; background:${bg};">`
      + avatar(key, s.name ? nameOf(s) : '', 22, W(10), 8.5, country)
      + `<span style="flex:1; min-width:0; display:flex; align-items:baseline; gap:6px;"><span style="min-width:0; font-size:13px; font-weight:${w}; color:${color}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(nameOf(s))}</span><span style="flex:none; ${MONO} font-size:10px; color:${C.muted};">${esc(tag)}</span></span>`
      + `<span${scoreAttrs} style="flex:none; display:flex; gap:7px; ${MONO} font-size:12.5px; font-variant-numeric:tabular-nums;${aid ? ' cursor:pointer; padding:2px 4px; margin:-2px -4px; border-radius:5px;' : ''}">${sets}${odds ? `<span style="font-size:11.5px; color:${C.muted};">${esc(odds)}</span>` : ''}</span></div>`;
  };
  const cols = vis.map((R, ci) => {
    const ri = fromIx + ci;
    const slots = R.cells.map((c, j) => {
      const any = c.sides[0] || c.sides[1] || c.match || c.bye;
      const foc = selPos != null, onA = foc && ((selPos - 1) >> (ri + 1)) === j, onB = foc && bPos != null && ((bPos - 1) >> (ri + 1)) === j;
      const ring = onA ? W(34) : onB ? W(22) : '';
      const op = foc && !cmpMode && !onA ? 0.55 : 1;
      const conn = ci > 0 ? `<span style="position:absolute; left:-28px; width:14px; top:25%; height:50%; border:1px solid ${W(10)}; border-left:0;"></span><span style="position:absolute; left:-14px; width:14px; top:50%; border-top:1px solid ${W(10)};"></span>` : '';
      const body = any
        ? `<div style="flex:1; min-width:0; background:${C.inset}; border:1px solid ${ring || W(6)}; border-radius:10px; padding:8px 11px; display:flex; flex-direction:column; gap:2px;">${row(c, 0)}${row(c, 1)}</div>`
        : `<div style="flex:1; height:64px; border:1px dashed ${ring || W(9)}; border-radius:10px;"></div>`;
      return `<div style="flex:1; min-height:0; position:relative; display:flex; align-items:center; opacity:${op}; transition:opacity .16s ease;">${conn}${body}</div>`;
    }).join('');
    return `<div style="flex:1 0 232px; min-width:232px; max-width:320px;"><div style="display:flex; align-items:baseline; justify-content:space-between; padding:0 2px 12px; border-bottom:1px solid ${W(6)};"><span style="font-size:14px; font-weight:700; color:${R.done === R.total ? C.soft : C.white};">${esc(longOf(R.name))}</span><span style="${MONO} font-size:10.5px; color:${C.muted};">${R.done} of ${R.total}</span></div><div style="display:flex; flex-direction:column; height:${Hpx}px; margin-top:10px;">${slots}</div></div>`;
  }).join('');
  return `<div class="tt-draw-bracket" style="display:flex; gap:28px; margin-top:24px; overflow-x:auto; padding-bottom:6px;">${cols}</div>`;
}
// a click on a bracket name: the player box beside the row (main draw); in compare mode it picks the second player;
// a qualifying name opens his profile (the design)
function pickName(key, qual, e) {
  if (!key) return;
  if (qual) { if (hasProfile(key)) openProfile(key); return; }
  if (S.outCmp) return pickOut(key);
  if (S.sel && S.cmp) { if (key !== S.sel) Object.assign(S, { b: key, cmpQ: '', shut: null, opp: null }); return repaint(); }
  if (S.pop && S.pop.key === key) { S.pop = null; return repaint(); }
  S.pop = popPlace(key, e && e.currentTarget);
  repaint();
}
// the box ALWAYS opens to the RIGHT of the row (founder 2026-11-20); only when 500px do not fit inside the card it is
// pinned to the card's right edge, 12px under the row (above it near the bottom of the screen), no caret. Fixed layer.
function popPlace(key, el) {
  const PW = 500, BH = 560;
  const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800;
  if (!el || !el.getBoundingClientRect || !S.el || !S.el.getBoundingClientRect) return { key, x: 24, y: 80, bot: null, side: 'n', ct: 31 };
  const r = el.getBoundingClientRect(), rr = S.el.getBoundingClientRect();
  let x = r.right + 16, y = r.top - 24, side = 'r', bot = null;
  if (x + PW > rr.right - 8) { x = Math.max(rr.left + 8, rr.right - PW - 8); y = r.bottom + 12; side = 'n'; }
  if (side === 'r') y = Math.max(8, Math.min(y, vh - BH - 8));
  else if (y + BH > vh - 8) { bot = Math.max(8, vh - r.top + 12); if (vh - bot - BH < 8) { bot = null; y = Math.max(8, vh - BH - 8); } }
  const mid = r.top + r.height / 2;
  return { key, x, y, bot, side, ct: Math.max(16, Math.min(BH - 60, mid - y - 5)) };
}
function popHtml(ev, M, F, finished) {
  const p = S.pop, s = F.byKey.get(p.key); if (!s) return '';
  const bx = boxModel(M, F, ev.entry, p.key);
  const isCh = F.champ === p.key, out = F.out[p.key];
  const chipT = isCh ? 'Champion' : out != null ? 'Out in the ' + longOf(M.rounds[out].name).toLowerCase() : finished ? 'Finished' : 'Still in';
  const chipC = isCh ? C.green : out != null ? C.soft : C.white;
  const nm = nameOf(s), prof = hasProfile(p.key) ? on(() => openProfile(p.key)) : '';
  const close = on(() => { S.pop = null; repaint(); });
  const sub = bx.me.m ? `${bx.me.m} ${bx.me.m === 1 ? 'match' : 'matches'} played · against the ${bx.fieldN} players with a match played` : 'No match played in this draw yet';
  const grps = []; bx.rows.forEach(r => { if (grps.indexOf(r.grp) < 0) grps.push(r.grp); });
  const GRID = 'grid-template-columns:minmax(0,1.35fr) 46px minmax(96px,1fr) 44px 46px; gap:12px;';
  const body = bx.me.m ? `<div style="padding:14px 18px 12px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding-bottom:12px;">
        <span style="display:inline-flex; align-items:center; gap:8px; height:28px; padding:0 11px; border-radius:8px; background:${C.lifted}; box-shadow:inset 0 0 0 1px ${W(14)}; font-size:12.5px; font-weight:600; color:${C.soft}; white-space:nowrap;">${bx.cmp ? `<span style="width:6px; height:6px; border-radius:50%; background:${bx.above * 2 >= bx.cmp ? C.green : C.red};"></span>` : ''}<span>Above the field on <span style="${MONO} font-weight:700; color:${C.white};">${bx.cmp ? bx.above + ' of ' + bx.cmp : DASH}</span> measures</span></span>
        <span style="display:flex; align-items:center; gap:12px; font-size:11.5px; color:${C.muted};"><span style="display:flex; align-items:center; gap:6px;"><span style="width:12px; height:4px; border-radius:2px; background:${C.red};"></span>Below</span><span style="display:flex; align-items:center; gap:6px;"><span style="width:1px; height:10px; background:${W(45)};"></span>Field</span><span style="display:flex; align-items:center; gap:6px;"><span style="width:12px; height:4px; border-radius:2px; background:${C.green};"></span>Above</span></span></div>`
    + grps.map((g, i) => `<div style="display:grid; ${GRID} align-items:baseline; margin-top:${i ? 8 : 0}px; padding:14px 0 6px; border-top:1px solid ${W(10)}; ${LBL} color:${i ? 'transparent' : C.muted};"><span style="font-size:14px; font-weight:700; color:${C.white};">${esc(g)}</span><span style="text-align:right;">Him</span><span style="text-align:center;">Gap</span><span style="text-align:right;">Field</span><span style="text-align:right;">Rank</span></div>`
      + bx.rows.filter(r => r.grp === g).map(r => `<div style="display:grid; ${GRID} align-items:center; height:40px; border-top:1px solid ${W(5)};">
          <span style="font-size:13px; font-weight:600; color:${C.soft}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(r.l)}</span>
          <span title="${esc(r.why)}" style="text-align:right; ${MONO} font-size:14px; font-weight:700; color:${r.v === DASH ? C.muted : C.white};">${esc(r.v)}</span>
          <div style="position:relative; height:22px;"><div style="position:absolute; left:0; right:0; top:9px; height:4px; border-radius:2px; background:${W(7)};"></div><div style="position:absolute; left:${r.barL}; width:${r.barW}; top:9px; height:4px; border-radius:2px; background:${r.gc};"></div>${r.g === DASH ? '' : `<span style="position:absolute; left:50%; top:1px; transform:translateX(-50%); display:inline-flex; align-items:center; height:20px; padding:0 6px; border-radius:7px; background:${C.lifted}; box-shadow:inset 0 0 0 1px ${W(14)}; ${MONO} font-size:11px; font-weight:700; color:${r.gc}; white-space:nowrap;">${esc(r.g)}</span>`}</div>
          <span title="${esc(r.fTitle)}" style="text-align:right; ${MONO} font-size:12.5px; color:${C.muted};">${esc(r.f)}</span>
          <span${r.of ? ` title="${esc(r.of)}"` : ''} style="text-align:right; ${MONO} font-size:12.5px; font-weight:${r.rankW}; color:${r.rankC};">${esc(r.rank)}</span></div>`).join('')).join('')
    + `</div>` : '';
  const caret = p.side === 'r' ? `<span style="position:absolute; left:-6px; top:${p.ct}px; width:10px; height:10px; transform:rotate(45deg); background:${C.card}; border-left:1px solid ${W(12)}; border-bottom:1px solid ${W(12)};"></span>` : '';
  return `<div onclick="${close}" style="position:fixed; inset:0; z-index:19;"></div>
    <div class="tt-draw-pop" data-tt="pop" style="position:fixed; z-index:20; left:${p.x}px; ${p.bot != null ? `bottom:${p.bot}px;` : `top:${p.y}px;`} width:500px; max-width:calc(100vw - 16px); max-height:calc(100vh - 16px); overflow-y:auto; box-sizing:border-box; background:${C.card}; border:1px solid ${W(12)}; border-radius:14px; box-shadow:${C.shOverlay};">${caret}
      <div style="display:flex; align-items:center; gap:12px; padding:16px 16px 14px 18px; border-bottom:1px solid ${W(6)};">
        <span${prof ? ` onclick="${prof}" title="Open his profile"` : ''} style="cursor:${prof ? 'pointer' : 'default'}; flex:none;">${avatar(p.key, nm, 40, W(14), 12, s.ioc || '')}</span>
        <div style="display:flex; flex-direction:column; gap:5px; min-width:0; margin-right:auto;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span class="${prof ? 'tt-draw-plink' : ''}"${prof ? ` onclick="${prof}" title="Open his profile"` : ''} style="cursor:${prof ? 'pointer' : 'default'}; display:inline-flex; align-items:baseline; gap:6px; font-size:17px; font-weight:800; color:${C.white};">${esc(nm)}${prof ? `<span style="font-size:14px; color:${C.blue};">›</span>` : ''}</span><span style="${MONO} font-size:11px; color:${C.muted};">${esc(tagOf(s))}</span>${chip(chipT, chipC)}</div>
          <span style="font-size:12px; color:${C.muted};">${esc(sub)}</span></div>
        <span class="tt-draw-hov" onclick="${on(() => { Object.assign(S, { sel: p.key, b: null, cmp: false, shut: null, opp: null, pop: null }); repaint(); })}" title="Follow his route through the draw" style="cursor:pointer; flex:none; display:inline-flex; align-items:center; gap:7px; height:30px; box-sizing:border-box; padding:0 11px; border-radius:8px; ${LIFT} font-size:12px; font-weight:700; color:${C.white}; white-space:nowrap;">Route<span style="color:${C.blue};">›</span></span>
        ${closeBtn(close, 30)}</div>${body}</div>`;
}
function pickOut(key) {
  if (key === S.outA) return;
  if (!S.outA) Object.assign(S, { outA: key, outQ: '' });
  else Object.assign(S, { view: 'draw', sel: S.outA, b: key, cmp: true, outCmp: false, outA: null, outB: null, outQ: '', cmpQ: '', shut: null, opp: null });
  S._focusNext = !!S.outCmp;
  repaint();
}

// ── Compare two routes · picker panel under the head ───────────────────────────────────────────────────────────────
const lc = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function pickStrip(ev, F) {
  const q = lc(S.outQ.trim());
  // suggestions: name matches while typing. With nothing typed the design lists the most likely winners — a list
  // ordered by chances (founder ruling 3), so no suggestion is drawn until a name is typed.
  const hits = q ? F.slots.filter(s => lc(nameOf(s)).indexOf(q) >= 0 || lc(s.name).indexOf(q) >= 0).map(s => String(s.playerKey)).filter(k => k !== S.outA && k !== S.outB).slice(0, 5) : [];
  const slot = (k, i) => {
    const f = !!k, act = !f && (i === 0 || !!S.outA), s = f ? F.byKey.get(k) : null;
    const av = f ? avatar(k, nameOf(s), 28, i ? W(40) : B(60), 10.5) : `<span style="flex:none; width:28px; height:28px; box-sizing:border-box; border-radius:50%; border:1.5px dashed ${act ? W(40) : W(25)}; display:flex; align-items:center; justify-content:center; font-size:10.5px; font-weight:700; color:${act ? C.text : C.muted};">${i + 1}</span>`;
    const inner = f ? `<span style="flex:1; min-width:0; font-size:14px; font-weight:700; color:${C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(nameOf(s))}</span><span class="tt-draw-chg" onclick="${on(() => { if (i) Object.assign(S, { outB: null, outQ: '' }); else Object.assign(S, { outA: S.outB, outB: null, outQ: '' }); S._focusNext = true; repaint(); })}" style="flex:none; cursor:pointer; font-size:12px; font-weight:700;">Change</span>`
      : act ? `<input data-ttin="outq" value="${esc(S.outQ)}" oninput="${on(e => { S.outQ = e.target.value; repaint(); })}" onkeydown="${on(e => { if (e.key === 'Enter' && hits[0]) pickOut(hits[0]); })}" placeholder="Type a name" style="flex:1; min-width:0; background:transparent; border:0; outline:none; color:${C.text}; font-family:inherit; font-size:14px;">`
      : `<span style="flex:1; font-size:14px; color:${C.muted};">Then the second player</span>`;
    return `<div style="grid-column:${i ? 3 : 1}; grid-row:1; display:flex; flex-direction:column; gap:7px; min-width:0;"><span style="${LBL}">${i ? 'Player two' : 'Player one'}</span><div style="display:flex; align-items:center; gap:10px; height:44px; box-sizing:border-box; padding:0 12px; border-radius:10px; background:${C.inset}; border:1px solid ${act ? W(22) : W(10)};">${av}${inner}</div></div>`;
  };
  const step = S.outA ? 'Step 2 of 2 · pick the second player, the comparison opens by itself' : 'Step 1 of 2 · type a name, tap a suggestion or click a player in the draw';
  const sug = q ? `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="${LBL} margin-right:4px;">Matches</span>${hits.map(k => `<span class="tt-draw-sug" onclick="${on(() => pickOut(k))}" style="cursor:pointer; display:inline-flex; align-items:center; height:30px; box-sizing:border-box; padding:0 11px; border-radius:8px; border:1px solid ${W(12)}; font-size:12.5px; font-weight:600; color:${C.text};">${esc(nameOf(F.byKey.get(k)))}</span>`).join('')}<span style="font-size:12.5px; color:${C.muted};">${hits.length ? '' : 'Nobody by that name in this draw'}</span></div>` : '';
  return `<div style="margin-top:14px; background:${C.inset}; border:1px solid ${W(12)}; border-radius:14px; padding:16px 18px 18px; display:flex; flex-direction:column; gap:14px;">
    <div style="display:flex; align-items:baseline; justify-content:space-between; gap:6px 16px; flex-wrap:wrap;"><span style="font-size:18px; font-weight:800; color:${C.white};">Compare two routes</span><span style="font-size:12.5px; color:${C.blue}; font-weight:700;">${step}</span></div>
    <div style="display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:end; gap:12px;">${slot(S.outA, 0)}${slot(S.outB, 1)}<span style="grid-column:2; grid-row:1; height:44px; display:flex; align-items:center; font-size:13px; color:${C.muted};">v</span></div>${sug}</div>`;
}

// ── single-player route panel / compare table / collapsed bar / opponents box ────────────────────────────────────────
function selHtml(ev, M, F) {
  const A = pathOf(M, F, S.sel); if (!A) return '';
  const me = A.me, cmpMode = !!S.cmp, picking = cmpMode && !S.b;
  const Bp = S.b ? pathOf(M, F, S.b) : null;
  if (Bp && S.shut === S.sel + '|' + S.b) {
    return `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px 20px; flex-wrap:wrap; background:${C.card}; border:1px solid ${W(12)}; border-radius:12px; padding:14px 18px;">
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; min-width:0;"><span style="flex:none; width:9px; height:9px; border-radius:50%; background:${C.blue};"></span><span style="font-size:15px; font-weight:800;">${esc(nameOf(me))}</span><span style="font-size:13px; color:${C.muted};">v</span><span style="flex:none; width:9px; height:9px; border-radius:50%; background:${C.text};"></span><span style="font-size:15px; font-weight:800;">${esc(nameOf(Bp.me))}</span><span style="font-size:12.5px; color:${C.muted};">Both players are still selected</span></div>
      <div style="display:flex; align-items:center; gap:8px;"><span class="tt-draw-hov" onclick="${on(() => { S.shut = null; repaint(); })}" style="cursor:pointer; display:inline-flex; align-items:center; height:32px; box-sizing:border-box; padding:0 13px; border-radius:8px; font-size:12.5px; font-weight:700; white-space:nowrap; color:${C.white}; ${LIFT}">Open the comparison <span style="color:${C.blue}; margin-left:7px;">›</span></span><span class="tt-draw-hov" onclick="${on(() => { Object.assign(S, { sel: null, b: null, cmp: false, shut: null, opp: null }); repaint(); })}" style="cursor:pointer; display:inline-flex; align-items:center; height:32px; box-sizing:border-box; padding:0 13px; border-radius:8px; font-size:12.5px; font-weight:700; white-space:nowrap; color:${C.text}; border:1px solid ${W(16)};">Clear both</span></div></div>`;
  }
  const nm = (p, size) => hasProfile(p.key)
    ? `<span class="tt-draw-plink" onclick="${on(() => openProfile(p.key))}" title="Open his profile" style="font-size:${size}px; cursor:pointer; font-weight:800; letter-spacing:-0.01em;">${esc(nameOf(p.me))}</span>`
    : `<span style="font-size:${size}px; font-weight:800; letter-spacing:-0.01em; color:${C.text};">${esc(nameOf(p.me))}</span>`;
  // where the two could meet (positions only: DrawView.meetRound)
  let meet = null;
  if (Bp) {
    const pa = A.me.pos, r = DV().meetRound(pa, Bp.me.pos), cell = M.rounds[r] && M.rounds[r].cells[(pa - 1) >> (r + 1)];
    const inA = !!cell && cell.sides.some(s => keyOf(s) === S.sel), inB = !!cell && cell.sides.some(s => keyOf(s) === S.b);
    const dead = (F.out[S.sel] != null && F.out[S.sel] < r) || (F.out[S.b] != null && F.out[S.b] < r);
    const both = inA && inB, metDone = !!(both && cell && cell.match);
    const rdL = longOf(M.rounds[r].name).toLowerCase();
    const line = dead ? 'Cannot meet in this draw any more' : (both ? (metDone ? 'Met in the ' : 'Meet in the ') : 'Could meet in the ') + rdL;
    meet = { r, dead, both, metDone, line, rdL };
  }
  const lineTxt = picking ? 'Search the second player below, or click him in the draw' : meet ? meet.line : A.champion ? 'Champion' : A.outAt >= 0 ? 'Out in the ' + A.cells[A.outAt].rd.toLowerCase() : A.line;
  const qFig = A.qWon ? 'Won' : DASH, tFig = A.champion ? 'Won' : DASH;
  const figBlock = (k, v, t) => `<div style="display:flex; flex-direction:column; gap:7px; align-items:flex-end;"><span style="${LBL}">${k}</span><span style="display:flex; align-items:baseline; gap:10px;"><span title="Fair odds: no source yet" style="font-size:12px; color:${C.muted}; white-space:nowrap;"></span><span${v === DASH ? ` title="${t}"` : ''} style="${MONO} font-size:26px; font-weight:700; line-height:1; color:${C.white};">${v}</span></span></div>`;
  let h = `<div style="background:${C.card}; border:1px solid ${W(12)}; border-radius:16px; padding:24px; box-sizing:border-box;">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:16px 28px; flex-wrap:wrap;">
      <div style="display:flex; align-items:center; gap:14px; min-width:0;">`
    + (!Bp ? `<span${hasProfile(A.key) ? ` onclick="${on(() => openProfile(A.key))}" title="Open his profile"` : ''} style="cursor:pointer; flex:none;">${avatar(A.key, nameOf(me), 44, W(14), 14, me.ioc || '')}</span>` : '')
    + `<div style="display:flex; flex-direction:column; gap:6px; min-width:0;"><div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">`
    + (Bp ? `<span style="flex:none; align-self:center; width:9px; height:9px; border-radius:50%; background:${C.blue};"></span>` : '') + nm(A, 18)
    + (Bp ? `<span style="font-size:14px; color:${C.muted};">v</span><span style="flex:none; align-self:center; width:9px; height:9px; border-radius:50%; background:${C.text};"></span>${nm(Bp, 17)}` : '')
    + `</div><span style="font-size:13px; font-weight:${picking ? 700 : 400}; color:${picking ? C.blue : C.soft};">${esc(lineTxt)}</span></div></div>
      <div style="display:flex; align-items:center; justify-content:flex-end; gap:14px 28px; flex-wrap:wrap; margin-left:auto;">`
    + (!cmpMode ? figBlock('Win his quarter', qFig, 'Chance to reach the semi-finals: no source yet') + figBlock('Title chance', tFig, 'Chance to win the title: no source yet') : '')
    + `<div style="display:flex; align-items:center; gap:8px;">`
    + (Bp ? `<span class="tt-draw-hov" onclick="${on(() => goH2H(S.sel, S.b, A.me.ioc, Bp.me.ioc))}" style="cursor:pointer; display:inline-flex; align-items:center; height:32px; box-sizing:border-box; padding:0 13px; border-radius:8px; font-size:12.5px; font-weight:700; white-space:nowrap; color:${C.white}; ${LIFT}">Open head to head <span style="color:${C.blue}; margin-left:7px;">›</span></span>` : '')
    + `<span class="tt-draw-hov" onclick="${on(() => { if (cmpMode) Object.assign(S, { cmp: false, b: null, cmpQ: '', opp: null }); else { Object.assign(S, { cmp: true, b: null, cmpQ: '' }); S._focusNext = true; } repaint(); })}" style="cursor:pointer; display:inline-flex; align-items:center; height:34px; box-sizing:border-box; padding:0 14px; border-radius:9px; font-size:12.5px; font-weight:700; white-space:nowrap; color:${cmpMode ? C.text : C.white}; background:${cmpMode ? 'transparent' : C.lifted}; border:1px solid ${cmpMode ? W(16) : W(14)};">${cmpMode ? 'Stop comparing' : 'Compare with another player'}</span>`
    + closeBtn(on(() => { if (Bp) Object.assign(S, { shut: S.sel + '|' + S.b, opp: null }); else Object.assign(S, { sel: null, b: null, cmp: false }); repaint(); }))
    + `</div></div></div>`;
  if (cmpMode) {
    const q = lc(S.cmpQ.trim());
    const hits = q ? F.slots.filter(s => String(s.playerKey) !== S.sel && (lc(nameOf(s)).indexOf(q) >= 0 || lc(s.name).indexOf(q) >= 0)).slice(0, 6) : [];
    h += `<div style="display:flex; align-items:center; gap:10px 14px; flex-wrap:wrap; margin-top:18px;">
      <label style="display:flex; align-items:center; gap:10px; box-sizing:border-box; width:320px; max-width:100%; height:40px; padding:0 14px; background:${C.inset}; border:1px solid ${W(14)}; border-radius:10px;">${SEARCH_SVG}<input data-ttin="cmpq" value="${esc(S.cmpQ)}" oninput="${on(e => { S.cmpQ = e.target.value; repaint(); })}" placeholder="${Bp ? 'Search another player to compare' : 'Search the second player'}" style="flex:1; min-width:0; background:transparent; border:0; outline:none; color:${C.text}; font-family:inherit; font-size:13.5px;"></label>`
      + hits.map(s => `<span class="tt-draw-sug" onclick="${on(() => { Object.assign(S, { b: String(s.playerKey), cmpQ: '', shut: null, opp: null }); repaint(); })}" style="cursor:pointer; display:inline-flex; align-items:baseline; gap:7px; height:34px; line-height:34px; box-sizing:border-box; padding:0 13px; border-radius:8px; border:1px solid ${W(12)}; font-size:13px; font-weight:600; color:${C.text}; white-space:nowrap;"><span>${esc(nameOf(s))}</span><span style="${MONO} font-size:10.5px; color:${C.muted};">${esc(tagOf(s) || s.ioc || '')}</span></span>`).join('')
      + `<span style="font-size:12.5px; color:${C.muted};">${q && !hits.length ? 'Nobody by that name in this draw' : ''}</span></div>`;
  }
  h += Bp ? compareTable(M, A, Bp, meet) : singleRail(A);
  if (S.opp && Bp) h += oppReport(ev, M, F, S.opp.who === 'b' ? Bp : A, S.opp.r);
  return h + `</div>`;
}
function singleRail(A) {
  const n = A.cells.length;
  return `<div style="display:grid; grid-template-columns:repeat(${n},minmax(0,1fr)); margin-top:22px; padding-top:20px; border-top:1px solid ${W(6)};">${A.cells.map(c => {
    const dot = c.state === 'won' ? C.white : c.state === 'bye' ? C.soft : c.next ? C.blue : C.inset;
    const dotBd = c.state === 'won' ? C.white : c.state === 'bye' ? C.soft : c.state === 'lost' ? C.muted : c.next ? C.blue : W(25);
    const link = c.state !== 'gone' && c.state !== 'bye' && c.oppKey;
    const opp = link ? `<span class="tt-draw-plink" onclick="${on(() => goH2H(A.key, c.oppKey, A.me.ioc, ''))}" title="${esc(c.opp)} · open head to head" style="cursor:pointer; font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(c.opp)}</span>`
      : `<span title="${esc(c.opp)}" style="font-size:13.5px; font-weight:600; color:${C.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(c.opp)}</span>`;
    const meta = c.state === 'open' ? `<span title="Likely opponent and opening price: no source yet" style="${MONO} font-size:11px; line-height:1.5; color:${C.muted};">${c.known ? '' : DASH + ' likely · '}opens ${DASH}</span>` : '';
    const bar = c.state === 'open' ? `<div title="Chance: no source yet" style="height:4px; border-radius:2px; background:${W(7)};"></div>` : '';
    return `<div style="display:flex; flex-direction:column; gap:8px; min-width:0; padding-right:14px; opacity:${c.op};">
      <div style="position:relative; height:11px; margin-bottom:5px;"><span style="position:absolute; left:0; right:-14px; top:5px; border-top:1px solid ${W(10)};"></span><span style="position:absolute; left:0; top:0; width:11px; height:11px; box-sizing:border-box; border-radius:50%; background:${dot}; border:1.5px solid ${dotBd}; box-shadow:0 0 0 4px ${C.card};"></span></div>
      <span style="${LBL} color:${c.next ? C.white : C.muted};">${esc(c.rd)}</span>${opp}${meta}
      <span${c.state === 'open' ? ' title="Chance: no source yet"' : ''} style="${MONO} font-size:20px; font-weight:700; line-height:1.15; margin-top:2px; color:${c.figColor};">${esc(c.fig)}</span>${bar}
      <span style="font-size:12px; color:${C.muted};">${esc(c.sub)}</span></div>`;
  }).join('')}</div>`;
}
// Compare two routes = ONE table (design 1a): Player · one column per round · Title. Every round with an opponent opens
// the opponents box; the meeting round is ringed on both rows. Chances are dashes (ruling 3), so no hardest step is red.
function compareTable(M, A, Bp, meet) {
  const n = M.rounds.length, GRID = `grid-template-columns:minmax(128px,1.3fr) repeat(${n},minmax(0,1fr)) 52px; gap:6px;`;
  const heads = M.rounds.map((R, ri) => `<span title="${esc(longOf(R.name))}" style="text-align:center; color:${ri === meet.r && !meet.dead ? C.white : C.muted};">${esc(R.name)}</span>`).join('');
  const row = (P, who) => {
    const prof = hasProfile(P.key) ? on(() => openProfile(P.key)) : '';
    const cells = P.cells.map((c, ri) => {
      const isMeet = ri === meet.r && !meet.dead, canOpen = c.cands.length > 0 && c.state !== 'gone' && c.state !== 'bye';
      const short = c.cands.length ? surname(nameOf(c.cands[0])) + (c.state === 'open' && c.more ? ' +' + c.more : '') : '';
      const fig = c.state === 'gone' ? '' : c.fig, figC = c.state === 'open' ? C.white : c.figColor;
      const tip = longOf(c.code) + (canOpen ? (c.cands.length > 1 || (c.state === 'open' && !c.known) ? ' · open the players he might face' : ' · open his opponent') : '') + (c.state === 'open' ? ' · chance: no source yet' : '');
      return `<span class="${canOpen ? 'tt-draw-hov' : ''}"${canOpen ? ` onclick="${on(() => { S.opp = { who, r: ri }; repaint(); })}"` : ''} title="${esc(tip)}" style="cursor:${canOpen ? 'pointer' : 'default'}; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; height:46px; min-width:0; padding:0 4px; border-radius:8px; background:${isMeet ? C.lifted : 'transparent'}; box-shadow:${isMeet ? `inset 0 0 0 1.5px ${C.white}` : canOpen ? `inset 0 0 0 1px ${W(9)}` : 'none'}; opacity:${c.op};">`
        + `<span style="display:flex; align-items:baseline; gap:5px;"><span style="${MONO} font-size:13.5px; font-weight:700; color:${figC};">${esc(fig)}</span>${canOpen ? `<span style="font-size:12px; font-weight:700; color:${C.blue};">›</span>` : ''}</span>`
        + `<span style="max-width:100%; font-size:10.5px; color:${C.muted}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(short)}</span></span>`;
    }).join('');
    const tFig = P.champion ? 'Won' : P.outAt >= 0 ? 'Out' : DASH;
    return `<div style="display:grid; ${GRID} align-items:center; height:60px; border-top:1px solid ${W(6)};">
      <span${prof ? ` onclick="${prof}" title="Open his profile"` : ''} style="cursor:${prof ? 'pointer' : 'default'}; display:flex; align-items:center; gap:9px; min-width:0;">${avatar(P.key, nameOf(P.me), 26, who === 'a' ? B(60) : W(30), 9.5)}<span class="${prof ? 'tt-draw-plink' : ''}" style="min-width:0; font-size:13.5px; font-weight:700; color:${C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(nameOf(P.me))}</span></span>
      ${cells}<span${tFig === DASH ? ' title="Title chance: no source yet"' : ''} style="text-align:right; ${MONO} font-size:14px; font-weight:700; color:${C.white};">${tFig}</span></div>`;
  };
  return `<div style="overflow-x:auto; margin-top:14px;"><div style="min-width:${Math.max(590, 128 + n * 76 + 52)}px; background:${C.inset}; border:1px solid ${W(6)}; border-radius:12px; padding:4px 16px 6px;">
    <div style="display:grid; ${GRID} align-items:center; height:34px; ${LBL}"><span>Player</span>${heads}<span style="text-align:right;">Title</span></div>${row(A, 'a')}${row(Bp, 'b')}</div></div>`;
}

// opponents box: the facts we hold (head to head, his record against the opponent's archetype, the opponent's last
// five); the win chance, the warning, "x% likely" and the opening price are dashes (founder ruling 3). A played round
// opens the opponent he actually faced.
const OPP = {};   // "me|opp" → { h2h, arch, archK, last5 } (loaded once per pair)
const newsName = (key, fb) => { try { return typeof newsPlayerName === 'function' ? newsPlayerName(key, fb) : fb; } catch (e) { return fb; } };
function oppFacts(meKey, meName, o) {
  const ok = String(o.playerKey), id = meKey + '|' + ok;
  if (OPP[id]) return OPP[id];
  const f = OPP[id] = { h2h: null, arch: null, archK: 'Playing style', last5: null };
  if (typeof loadCareerHistory === 'function') {
    Promise.all([loadCareerHistory(meKey), loadCareerHistory(ok)]).then(([a, b]) => {
      try {
        const ansA = typeof careerHistoryAnswered !== 'function' || careerHistoryAnswered(meKey), ansB = typeof careerHistoryAnswered !== 'function' || careerHistoryAnswered(ok);
        if (ansA && ansB && window.H2HCore && typeof sfH2hSide === 'function') {
          const list = window.H2HCore.joinMeetings(sfH2hSide(meKey, meName), sfH2hSide(ok, nameOf(o)), a || [], b || [], typeof sfH2hNkCount === 'function' ? sfH2hNkCount() : undefined, []);
          const rec = window.H2HCore.record(list), lastM = window.H2HCore.played(list).slice().sort((x, y) => String(y.date).localeCompare(String(x.date)))[0];
          f.h2h = { a: rec.a, b: rec.b, n: rec.n, last: lastM ? (lastM.won ? 'won last' : 'lost last') : '' };
        }
        // the opponent's last five played matches, Form's population (walkovers, Laver Cup and exhibitions out)
        const NOT = typeof FH_FORM_NOT_ATP_RECORD !== 'undefined' ? FH_FORM_NOT_ATP_RECORD : null;
        if (ansB) {
          const rows = (b || []).filter(x => x && !x.walkover && !x.unconfirmed && !(NOT && NOT.test(String(x.tournament || ''))))
            .slice().sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, 5).reverse();
          f.last5 = rows.map(x => (x.won ? 'W' : 'L'));
        }
      } catch (e) { /* stays a dash */ }
      repaint();
    });
  }
  if (typeof ensureStyleMeetings === 'function' && typeof ps2Record === 'function') {
    const m = { p1: meName, p2: newsName(ok, nameOf(o)), p1Key: meKey, p2Key: ok };
    ensureStyleMeetings(m).then(() => {
      try { const r = ps2Record(m, 0); if (r && r.oppLab) f.archK = r.oppLab; f.arch = r; } catch (e) { /* dash */ }
      repaint();
    }).catch(() => {});
  }
  return f;
}
function oppReport(ev, M, F, P, r) {
  const c = P.cells[r]; if (!c || !c.cands.length) return '';
  const nm = nameOf(P.me);
  const cards = c.cands.map(o => {
    const f = oppFacts(P.key, newsName(P.key, nm), o);
    const h2h = f.h2h ? `${f.h2h.a}${NDASH}${f.h2h.b}${f.h2h.last ? ' · ' + f.h2h.last : ''}` : DASH;
    const A = f.arch && f.arch.state === 'ready' ? f.arch : null;
    const ar = A ? (A.n === 0 ? DASH : A.n < 5 ? `${A.w}${NDASH}${A.l}` : `wins ${Math.round(100 * A.w / A.n)}%`) : DASH;
    const arT = A ? `${nm} v ${A.oppLab}: ${A.w}${NDASH}${A.l} in ${A.n} meetings (classified players, walkovers out)` : '';
    const l5 = f.last5 && f.last5.length ? f.last5.join(' ') : DASH;
    const fa = [['Opening price', DASH, 'No source yet'], ['Head to head', h2h, f.h2h ? `${f.h2h.n} meetings (ATP head-to-head population)` : ''], [f.archK, ar, arT], ['On this court', DASH, 'No source yet'], ['Last five', l5, f.last5 && f.last5.length ? `${nameOf(o)}: last ${f.last5.length} played matches, oldest first` : '']];
    const ok = String(o.playerKey);
    const likely = c.state === 'won' || c.state === 'lost' ? 'Played' : c.known ? 'Confirmed' : DASH + ' likely';
    return `<div style="background:${C.inset}; border:1px solid ${W(6)}; border-radius:12px; padding:16px 18px 8px; display:flex; flex-direction:column; min-width:0;">
      <div style="display:flex; align-items:center; gap:10px;">${avatar(ok, nameOf(o), 36, W(14), 12)}<div style="display:flex; flex-direction:column; gap:2px; min-width:0;"><span class="tt-draw-plink" onclick="${on(() => goH2H(P.key, ok, P.me.ioc, o.ioc))}" title="Open head to head" style="cursor:pointer; font-size:14.5px; font-weight:700;">${esc(nameOf(o))}</span><span style="font-size:12px; color:${C.muted};">${likely}</span></div></div>
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-top:16px;"><span title="Chance to win this match: no source yet" style="${MONO} font-size:26px; font-weight:700; line-height:1; color:${C.white};">${DASH}</span><span title="No warning rule of ours yet" style="font-size:12px; font-weight:700; white-space:nowrap; color:${C.muted};">${DASH}</span></div>
      <div style="font-size:12px; color:${C.muted}; margin-top:6px;">to win this match</div>
      <div title="The tick is an even match" style="position:relative; height:12px; margin-top:12px;"><span style="position:absolute; left:0; right:0; top:4px; height:4px; border-radius:2px; background:${W(7)};"></span><span style="position:absolute; left:50%; top:0; width:2px; height:12px; margin-left:-1px; border-radius:1px; background:${C.white};"></span></div>
      <div style="margin-top:12px;">${fa.map(([k, v, t]) => `<div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:10px 0; border-top:1px solid ${W(6)};"><span style="font-size:12.5px; color:${C.muted};">${esc(k)}</span><span${t ? ` title="${esc(t)}"` : ''} style="font-size:13px; font-weight:600; text-align:right; white-space:pre; color:${C.white};">${esc(v)}</span></div>`).join('')}</div></div>`;
  }).join('');
  const close = on(() => { S.opp = null; repaint(); });
  return `<div class="tt-draw-ovl" onclick="${close}" style="position:fixed; inset:0; z-index:70; background:${C.scrim62}; display:flex; align-items:center; justify-content:center; padding:24px;">
    <div onclick="event.stopPropagation()" style="box-sizing:border-box; width:860px; max-width:100%; max-height:100%; overflow-y:auto; background:${C.card}; border:1px solid ${W(12)}; border-radius:14px; padding:26px 28px 28px; box-shadow:${C.shOverlay};">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;"><div style="display:flex; align-items:center; gap:12px; min-width:0;">${avatar(P.key, nm, 40, W(14), 13)}<div style="display:flex; flex-direction:column; gap:3px; min-width:0;"><span style="font-size:18px; font-weight:800; color:${C.white};">${esc(nm)}</span><span style="font-size:12.5px; color:${C.muted};">${esc(c.rd + (c.cands.length > 1 ? ' · who he could play' : ' · his opponent'))}</span></div></div>${closeBtn(close)}</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; margin-top:22px;">${cards}</div></div></div>`;
}

// ── Outright chances (one card; every chance and fair-odds range is a dash: ruling 3) ───────────────────────────────
function outrightHtml(ev, M, F) {
  const tab = S.outTab === 'q' ? 'q' : 't';
  let h = `<div style="background:${C.inset}; border:1px solid ${W(6)}; border-radius:16px; padding:24px 24px 20px;">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px 16px; flex-wrap:wrap;">${track([['t', 'To win the title'], ['q', 'To win his quarter']].map(([k, l]) => seg(l, tab === k, on(() => { S.outTab = k; repaint(); }), '0 13px', 'height:30px; box-sizing:border-box; align-items:center;')).join(''))}</div>`
    + (S.outCmp ? `<div style="font-size:12.5px; margin-top:14px; font-weight:700; color:${C.blue};">Click a player in these lists to add him to the comparison</div>` : '');
  const hl = k => (k && (k === S.outA || k === S.outB) ? C.hover : 'transparent');
  const pick = k => (k ? on(() => { if (S.outCmp) pickOut(k); else { Object.assign(S, { sel: k, b: null, cmp: false, view: 'draw', shut: null, opp: null }); repaint(); } }) : '');
  const fair3 = (cols, fs) => `<span title="Fair odds: no source yet" style="display:grid; grid-template-columns:${cols}; align-items:baseline; ${MONO} font-size:${fs}px; font-weight:600; color:${C.text}; white-space:nowrap;"><span></span><span style="text-align:center; color:${C.muted};">${DASH}</span><span></span></span>`;
  if (tab === 't') {
    // the leader is the most likely winner (a chance: dash) — or, once the final is played, the champion (a result)
    const ck = F.champ, cs = ck ? F.byKey.get(ck) : null;
    const lead = `<div class="${ck ? 'tt-draw-edge' : ''}" onclick="${pick(ck)}" style="cursor:${ck ? 'pointer' : 'default'}; flex:1 1 260px; box-sizing:border-box; background:${C.card}; border:1px solid ${W(6)}; border-radius:11px; padding:18px 20px; display:flex; flex-wrap:wrap; align-items:center; align-content:flex-start; gap:16px 32px; min-width:0;">
      <span style="flex:0 0 100%; display:flex; justify-content:space-between; gap:8px; ${LBL}"><span>${ck ? 'Champion' : 'Most likely winner'}</span><span style="color:${C.blue}; font-weight:700;">${ck ? '›' : ''}</span></span>
      <div style="flex:1 1 200px; display:flex; align-items:center; gap:14px; min-width:0;">${cs ? avatar(ck, nameOf(cs), 44, W(14), 14) : `<span style="flex:none; width:44px; height:44px; box-sizing:border-box; border-radius:50%; background:${C.lifted}; border:1px solid ${W(14)};"></span>`}<div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start; min-width:0;"><span style="max-width:100%; font-size:18px; font-weight:800; color:${C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${cs ? esc(nameOf(cs)) : DASH}</span></div></div>
      <span${ck ? '' : ' title="Title chance: no source yet"'} style="${MONO} flex:none; font-size:40px; font-weight:700; line-height:1; color:${C.white};">${ck ? '100%' : DASH}</span>
      <div style="flex:1 1 200px; display:flex; flex-direction:column; gap:10px; font-size:13px;"><div style="display:flex; justify-content:space-between; gap:12px;"><span style="color:${C.muted};">Fair odds</span><span title="No source yet" style="${MONO} font-weight:700; color:${C.white};">${DASH}</span></div><div style="display:flex; justify-content:space-between; gap:12px;"><span style="color:${C.muted};">Ahead of the next</span><span title="No source yet" style="${MONO} font-weight:700; color:${C.white};">${DASH}</span></div></div></div>`;
    const G = 'grid-template-columns:minmax(130px,210px) minmax(40px,1fr) 48px 112px; gap:0 12px;';
    const rowD = () => `<div style="border-top:1px solid ${W(6)};"><div style="display:grid; ${G} align-items:center; height:40px; box-sizing:border-box; padding:0 8px; margin:2px -8px; border-radius:8px;"><span style="min-width:0; display:flex; align-items:center; gap:10px;"><span style="flex:none; width:26px; height:26px; box-sizing:border-box; border-radius:50%; background:${C.lifted}; border:1px solid ${W(10)};"></span><span style="font-size:13.5px; font-weight:600; color:${C.muted};">${DASH}</span></span><span style="min-width:0; height:4px; border-radius:2px; background:${W(7)};"></span><span title="Chance: no source yet" style="text-align:right; ${MONO} font-size:13.5px; font-weight:700; color:${C.white};">${DASH}</span>${fair3('50px 12px 50px', 13)}</div></div>`;
    const grp = (name, n) => `<div style="display:grid; ${G} align-items:baseline; padding:10px 0 9px; ${LBL}"><span style="min-width:0; font-size:14px; font-weight:700; color:${C.white}; white-space:nowrap;">${name}</span><span></span><span style="text-align:right;">Chance</span><span style="text-align:center; white-space:nowrap;">Fair odds</span></div>${Array.from({ length: n }, rowD).join('')}`;
    h += `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:18px;">${lead}<div title="Title chances: no source yet" style="flex:2 1 480px; background:${C.card}; border:1px solid ${W(6)}; border-radius:11px; padding:10px 20px 8px; min-width:0;">${grp('Also favoured', 2)}${grp('Three underdogs', 3)}</div></div>`;
  } else {
    // quarters from the draw's own positions (founder 2026-11-15): pos → ceil(pos / (size / 4)); the quarter winner
    // (won his quarter-final) first, then the players still in it by seed and position — never a chance order
    const size = (ev.draw.main && ev.draw.main.size) || 32, per = size / 4;
    const qi = M ? M.rounds.findIndex(r => r.name === 'QF') : -1;
    const qWin = q => { if (qi < 0) return null; const c = M.rounds[qi].cells[q]; return c && c.match ? c.match.winnerKey : null; };
    const G = 'grid-template-columns:minmax(0,1fr) 34px 76px; gap:8px;';
    const cards = [0, 1, 2, 3].map(q => {
      const w = qWin(q);
      const inQ = F.slots.filter(s => Math.ceil(s.pos / per) === q + 1);
      const list = (w && F.byKey.get(w) ? [F.byKey.get(w)] : []).concat(w ? [] : inQ.filter(s => F.out[String(s.playerKey)] == null)
        .sort((x, y) => (x.seed == null ? 99 : x.seed) - (y.seed == null ? 99 : y.seed) || x.pos - y.pos)).slice(0, 4);
      const rows = list.map((s, j) => { const k = String(s.playerKey);
        return `<div class="tt-draw-hov" onclick="${pick(k)}" title="${esc(nameOf(s))}" style="cursor:pointer; display:grid; ${G} align-items:center; height:40px; box-sizing:border-box; padding:0 6px; margin:2px -6px; border-radius:8px; background:${hl(k)};"><div style="display:flex; align-items:center; gap:8px; min-width:0;">${avatar(k, nameOf(s), 26, j ? W(18) : W(40), 9.5)}<span style="min-width:70px; font-size:13px; font-weight:${j ? 600 : 800}; color:${j ? C.text : C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(nameOf(s))}</span></div><span${k === w ? '' : ' title="Chance: no source yet"'} style="text-align:right; ${MONO} font-size:13px; font-weight:700; color:${C.white};">${k === w ? 'Won' : DASH}</span>${fair3('32px 12px 32px', 12)}</div>`; }).join('');
      return `<div style="background:${C.card}; border:1px solid ${W(6)}; border-radius:11px; padding:14px 12px 8px; min-width:0;"><div style="display:grid; ${G} align-items:baseline; padding-bottom:10px; border-bottom:1px solid ${W(6)}; ${LBL} white-space:nowrap;"><span style="font-size:14px; font-weight:700; color:${C.white};">Quarter ${q + 1}</span><span style="display:flex; justify-content:flex-end;">Chance</span><span style="text-align:center;">Fair odds</span></div>${rows}</div>`;
    }).join('');
    h += `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(max(240px, calc(25% - 6px)),1fr)); gap:8px; margin-top:18px;">${cards}</div>`;
  }
  return h + `</div>`;
}

// ── Points to defend (design 3c + refines): two sorting tiles, the table, "Nothing to defend" chips ─────────────────
function ptsHtml(ev, M, F, pm, finished) {
  const card = inner => `<div style="margin-top:22px; background:${C.inset}; border:1px solid ${W(6)}; border-radius:16px; padding:24px 24px 20px;">${inner}</div>`;
  if (pm === undefined) return card(`<span style="font-size:13px; color:${C.muted};">Loading the points to defend…</span>`);
  const head = (sub, n, tot) => `<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;"><div style="display:flex; flex-direction:column; gap:6px;"><span style="font-size:18px; font-weight:800; color:${C.white};">Points to defend</span><span style="font-size:13px; color:${C.muted};">${esc(sub)}</span></div><div style="display:flex; flex-direction:column; align-items:flex-end; gap:7px;"><span style="${LBL}">Points across ${n} players</span><span style="${MONO} font-size:26px; font-weight:700; line-height:1; color:${C.white};">${tot}</span></div></div>`;
  if (!pm) return card(head('No points-to-defend list for this event on file', DASH, DASH));
  const prior = pm.e.prior && pm.e.prior.season ? pm.e.prior.season : (+String(ev.start).slice(0, 4) - 1);
  const dd = pm.e.dropDate ? new Date(pm.e.dropDate + 'T00:00:00Z') : null;
  const dropW = dd && isFinite(dd) ? `${dd.getUTCDate()} ${MON[dd.getUTCMonth()]}` : DASH;
  const sub = finished ? `Points won here in ${prior}, dropped when this edition ended` : `Points won here in ${prior} drop off on ${dropW}`;
  const byD = S.ptSort === 'drop';
  const L = pm.rows.slice().sort((x, y) => byD ? (y.drop == null ? -1 : y.drop) - (x.drop == null ? -1 : x.drop) || (y.pts || 0) - (x.pts || 0) : (y.pts || 0) - (x.pts || 0) || (y.drop == null ? -1 : y.drop) - (x.drop == null ? -1 : x.drop));
  const tp = pm.rows.slice().sort((x, y) => (y.pts || 0) - (x.pts || 0) || (y.drop == null ? -1 : y.drop) - (x.drop == null ? -1 : x.drop))[0];
  const td = pm.rows.filter(r => r.drop != null).sort((x, y) => y.drop - x.drop || (y.pts || 0) - (x.pts || 0))[0];
  const mxP = Math.max.apply(null, L.map(r => r.pts || 0).concat([1])), mxD = Math.max.apply(null, L.map(r => r.drop || 0).concat([1]));
  const rk = v => (v == null ? DASH : 'No. ' + v);
  const tile = (title, r, isOn, k, right, rightC, under) => `<div class="tt-draw-edge" data-tt="pt-${k}" onclick="${on(() => { S.ptSort = k; repaint(); })}" title="Sort the list" style="cursor:pointer; background:${C.card}; border:1px solid ${isOn ? W(22) : W(6)}; border-radius:11px; padding:16px 18px; display:flex; align-items:center; justify-content:space-between; gap:14px; min-width:0;">
      <div style="display:flex; align-items:center; gap:12px; min-width:0;">${r ? avatar(r.k, r.n, 36, W(14), 12) : ''}<div style="display:flex; flex-direction:column; gap:5px; min-width:0;"><span style="display:flex; gap:6px; ${LBL} white-space:nowrap;"><span>${title}</span><span style="color:${C.blue}; font-weight:700;">${isOn ? '↓' : '›'}</span></span><span title="${esc(r ? r.full : '')}" style="font-size:15px; font-weight:700; color:${C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(r ? r.n : DASH)}</span><span style="font-size:12px; color:${C.muted}; white-space:nowrap;${under && under.mono ? ' ' + MONO : ''}">${esc(under ? under.t : '')}</span></div></div>
      <span style="flex:none; ${MONO} font-size:26px; font-weight:700; line-height:1; color:${rightC};">${esc(right)}</span></div>`;
  const tiles = `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:8px; margin-top:18px;">`
    + tile('Most points to defend', tp, !byD, 'pts', tp && tp.pts != null ? String(tp.pts) : DASH, C.white, tp ? { t: `${tp.last} in ${prior}` } : null)
    + tile('Biggest drop if out first round', td, byD, 'drop', td ? (td.drop ? MINUS + td.drop : '0') : DASH, td && td.drop ? C.red : C.muted, td ? { t: `${rk(td.today)} → ${rk(td.would)}`, mono: true } : { t: 'Needs ranking points on file' })
    + `</div>`;
  const G = 'grid-template-columns:minmax(130px,190px) 96px minmax(40px,1fr) 52px 130px 44px; gap:0 12px;';
  const thead = `<div style="display:grid; ${G} align-items:end; margin-top:20px; padding:0 8px 10px; ${LBL} white-space:nowrap;"><span>Player</span><span>${prior} here</span><span></span><span style="text-align:right; color:${byD ? C.muted : C.white};">Points</span><span style="display:flex; flex-direction:column; gap:5px;"><span style="text-align:center; padding-bottom:5px; border-bottom:1px solid ${W(10)};">If out first round</span><span style="display:grid; grid-template-columns:56px 18px 56px;"><span style="text-align:right;">Today</span><span></span><span style="text-align:right;">Would be</span></span></span><span style="text-align:right; color:${byD ? C.white : C.muted};">Places</span></div>`;
  const rows = L.map(r => {
    const bar = byD ? (r.drop || 0) / mxD * 100 : (r.pts || 0) / mxP * 100;
    const full = byD ? r === td : /^(Champion|Final|Semi-final)/.test(r.last);
    const click = r.inDraw ? on(() => { Object.assign(S, { view: 'draw', kind: 'main', sel: r.k, b: null, cmp: false, shut: null, opp: null, pop: null }); repaint(); }) : '';
    const tTitle = r.inDraw ? 'Follow his route through the draw' : `${r.full}${r.status ? ' · ' + r.status : ''} · not in this draw`;
    return `<div style="border-top:1px solid ${W(6)};"><div class="${r.inDraw ? 'tt-draw-hov' : ''}" onclick="${click}" title="${esc(tTitle)}" style="cursor:${r.inDraw ? 'pointer' : 'default'}; display:grid; ${G} align-items:center; height:44px; margin:2px 0; padding:0 8px; border-radius:8px;">
      <span title="${esc(r.full)}" style="display:flex; align-items:center; gap:10px; min-width:0;">${avatar(r.k, r.n, 26, W(10), 9.5)}<span style="min-width:0; font-size:13.5px; font-weight:600; color:${C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(r.n)}</span><span style="flex:none; ${MONO} font-size:10px; color:${C.muted};">${esc(r.tag)}</span></span>
      <span style="display:flex;">${chip(r.last)}</span>
      <div style="height:4px; border-radius:2px; background:${W(7)};"><div style="height:100%; width:${bar}%; border-radius:2px; background:${full ? C.blue : BAR55};"></div></div>
      <span style="text-align:right; ${MONO} font-size:13.5px; font-weight:700; color:${r.pts == null ? C.muted : C.white};">${r.pts == null ? DASH : r.pts}</span>
      <span${r.whyRank ? ` title="${esc(r.whyRank)}"` : ''} style="display:grid; grid-template-columns:56px 18px 56px; align-items:baseline; ${MONO} font-size:12.5px; font-weight:600; white-space:nowrap;"><span style="text-align:right; color:${C.soft};">${rk(r.today)}</span><span style="text-align:center; font-size:11px; color:${C.muted};">→</span><span style="text-align:right; color:${r.would == null ? C.muted : C.white};">${rk(r.would)}</span></span>
      <span style="text-align:right; ${MONO} font-size:13.5px; font-weight:700; color:${r.drop ? C.red : C.muted};">${r.drop == null ? DASH : r.drop ? MINUS + r.drop : '0'}</span></div></div>`;
  }).join('');
  const frees = pm.frees.length ? `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; border-top:1px solid ${W(6)}; padding-top:16px;"><span style="${LBL} margin-right:6px;">Nothing to defend</span>${pm.frees.map(f => `<span class="${f.inDraw ? 'tt-draw-hov' : ''}" onclick="${f.inDraw ? on(() => { Object.assign(S, { view: 'draw', kind: 'main', sel: f.k, b: null, cmp: false, shut: null, opp: null }); repaint(); }) : ''}" title="${esc(f.full + (f.status ? ' · ' + f.status : ''))}" style="cursor:${f.inDraw ? 'pointer' : 'default'}; display:inline-flex; align-items:center; height:24px; padding:0 9px; border-radius:7px; background:${C.lifted}; box-shadow:inset 0 0 0 1px ${W(14)}; font-size:11.5px; font-weight:600; color:${C.soft};">${esc(f.n)}</span>`).join('')}</div>` : '';
  return card(head(sub, pm.rows.length, String(pm.total)) + tiles + `<div style="overflow-x:auto;"><div style="min-width:570px;">${thead}${rows}</div></div>` + frees);
}

// ── Statistics view (ONE card) + its two boxes ──────────────────────────────────────────────────────────────────────
function statsHtml(ev, M, st) {
  const tile = (t, gi, i) => {
    const isOpen = gi === 0 ? S.ed === i : S.stat === t.key;
    const click = gi === 0 ? !!st.hev && t.v != null : st.live && !!t.key;
    const onc = click ? on(() => { if (gi === 0) S.ed = S.ed === i ? null : i; else S.stat = S.stat === t.key ? null : t.key; repaint(); }) : '';
    const cols = t.cols.map(c => `<div title="${esc(c.y + (c.now && st.live ? ' so far' : '') + ' · ' + st.fm(t, c.v))}" style="height:${c.h}; border-radius:3px 3px 0 0; background:${c.v == null ? 'transparent' : c.now ? C.blue : BAR55};"></div>`).join('');
    const yrs = t.cols.map(c => `<span style="display:flex; justify-content:center; white-space:nowrap; color:${c.now ? C.text : C.muted}; font-weight:${c.now ? 700 : 400};">${String(c.y).slice(2)}</span>`).join('');
    const gl = (lab, title, v, d) => `<span title="${esc(title)}" style="display:flex; align-items:baseline; justify-content:space-between; gap:6px; white-space:nowrap;"><span>${lab}</span><span style="${MONO} font-size:12.5px; font-weight:700; color:${sgnC(d)};">${v}</span></span>`;
    return `<div class="${click ? 'tt-draw-tile' : ''}" onclick="${onc}" style="position:relative; cursor:${click ? 'pointer' : 'default'}; background:${C.card}; border:1px solid ${isOpen ? W(22) : W(6)}; border-radius:11px; padding:16px 16px 14px; display:flex; flex-direction:column; gap:10px; min-width:0;">
      <span style="display:flex; justify-content:space-between; gap:8px; font-size:12.5px; font-weight:600; line-height:16px; min-height:32px; color:${C.soft};"><span style="text-wrap:balance;">${esc(t.label)}</span><span style="flex:none; color:${C.blue}; font-weight:700;">${click ? '›' : ''}</span></span>
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:5px 10px; flex-wrap:wrap;"><span title="${esc(t.vTitle)}" style="${MONO} font-size:26px; font-weight:700; line-height:1; color:${t.figColor};">${esc(t.fig)}</span>
        <span style="flex:0 0 100%; display:flex; flex-direction:column; gap:5px; margin-top:8px; font-size:12px; color:${C.muted};">${gl('vs tour', 'Against the tour average' + (t.tourTitle ? ' · ' + t.tourTitle : ''), t.gapN, t.dN)}${gl(t.gapLL, 'Against the past edition', t.gapL, t.dL)}${gl('vs past five', 'Against the average of the five editions before', t.gapP, t.dP)}</span></div>
      <div style="position:relative; height:56px; margin-top:4px;"><div style="position:absolute; inset:0; display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:5px; align-items:end;">${cols}</div>${t.tourB ? `<div title="${esc(t.tourTitle)}" style="position:absolute; left:-4px; right:-4px; bottom:${t.tourB}; border-top:1.5px dashed ${W(75)};"></div>` : ''}</div>
      <div style="display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:5px; ${MONO} font-size:10px;">${yrs}</div></div>`;
  };
  const head = (name, note, mt) => `<div style="display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-top:${mt};"><span style="font-size:18px; font-weight:800; color:${C.white};">${name}</span><span style="font-size:13px; color:${C.muted};">${esc(note)}</span></div>`;
  const grid = (tiles, gi) => `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:8px; margin-top:14px;">${tiles.map((t, i) => tile(t, gi, i)).join('')}</div>`;
  const chip5 = n => `<span style="display:inline-flex; align-items:center; height:26px; padding:0 10px; border-radius:7px; background:${C.lifted}; box-shadow:inset 0 0 0 1px ${W(14)}; font-size:11.5px; font-weight:600; color:${C.soft};">${n}</span>`;
  const noSpeed = `<div style="display:flex; align-items:center; gap:14px 28px; flex-wrap:wrap; margin-top:12px; padding:16px 18px; border-radius:12px; background:${C.card}; border:1px dashed ${W(14)};"><div style="display:flex; flex-direction:column; gap:5px; flex:1 1 320px; min-width:0;"><span style="font-size:14px; font-weight:700; color:${C.white};">No serve statistics for this edition yet</span><span style="font-size:13px; line-height:1.55; color:${C.soft}; text-wrap:pretty;">${esc(st.speedEmpty)}</span></div><div style="display:flex; flex-wrap:wrap; gap:6px;">${SPEED.map(x => chip5(x[0])).join('')}</div></div>`;
  const n1 = st.speedEmpty ? 'Not loaded for this edition' : [st.n1, st.hev ? 'click a box for its past editions' : ''].filter(Boolean).join(' · ');
  const n2 = [st.n2, st.live ? 'click a box for the matches behind it' : ''].filter(Boolean).join(' · ');
  let h = `<div style="margin-top:22px; background:${C.inset}; border:1px solid ${W(6)}; border-radius:16px;"><div style="padding:24px 24px 20px;">`
    + head('Speed', n1, '4px') + (st.speedEmpty ? noSpeed : grid(st.speed, 0))
    + head('Favourites and underdogs', n2, '22px') + grid(st.mkt, 1)
    + `<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px 18px; padding-top:14px; font-size:11.5px; color:${C.muted};"><span style="display:flex; align-items:center; gap:7px;"><span style="width:10px; height:10px; border-radius:2px; background:${C.blue};"></span>This edition</span><span style="display:flex; align-items:center; gap:7px;"><span style="width:10px; height:10px; border-radius:2px; background:${BAR55};"></span>Past editions</span><span style="display:flex; align-items:center; gap:7px;"><span style="width:18px; border-top:1.5px dashed ${W(75)};"></span>Tour average</span></div>`
    // "All statistics ›" opens the Reports tab (founder 2026-11-20: "should bring to the reports of the players")
    + `<div style="display:flex; justify-content:flex-end; margin-top:14px;"><span data-tt="allstats" onclick="${on(() => { if (typeof tourxSetSection === 'function') tourxSetSection('reports'); })}" style="cursor:pointer; font-size:12.5px; font-weight:700; color:${C.text};">All statistics <span style="color:${C.blue};">›</span></span></div>`
    + `</div></div>`;
  if (S.ed != null && st.speed[S.ed] && !st.speedEmpty) h += edBox(st, st.speed[S.ed]);
  if (S.stat && st.live) h += matchBox(ev, M, st);
  return h;
}
const sheet = (title, sub, onClose, body) => `<div class="tt-draw-ovl" onclick="${onClose}" style="position:fixed; inset:0; z-index:70; background:${C.scrim66}; display:flex; align-items:center; justify-content:center; padding:24px;">
  <div onclick="event.stopPropagation()" style="width:860px; max-width:100%; max-height:86vh; overflow:auto; box-sizing:border-box; background:${C.card}; border:1px solid ${W(12)}; border-radius:16px; box-shadow:${C.shOverlay}; padding:24px;">
    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><div style="display:flex; flex-direction:column; gap:5px; min-width:0;"><span style="font-size:18px; font-weight:800; color:${C.white};">${esc(title)}</span><span style="font-size:13px; color:${C.muted};">${esc(sub)}</span></div>${closeBtn(onClose)}</div>${body}</div></div>`;
const tiles4 = list => `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:8px; margin-top:20px;">${list.map(t => `<div style="background:${C.inset}; border:1px solid ${W(6)}; border-radius:11px; padding:16px 18px 14px; display:flex; flex-direction:column; align-items:flex-start; gap:9px; text-align:left; min-width:0;"><span style="${LBL}">${esc(t.label)}</span><span${t.title ? ` title="${esc(t.title)}"` : ''} style="${MONO} font-size:22px; font-weight:700; line-height:1; color:${t.color || C.white};">${esc(t.fig)}</span><span style="font-size:12px; color:${C.soft}; text-wrap:balance;">${esc(t.sub)}</span></div>`).join('')}</div>`;
const tHead = (GRID, cells) => `<div style="display:grid; ${GRID} padding-bottom:10px; border-bottom:1px solid ${W(6)}; ${LBL}">${cells}</div>`;
function edBox(st, t) {
  const fm = x => st.fm(t, x);
  const nowL = st.cy + (st.live ? ' so far' : '');
  const past = t.cols.slice(0, 5).map(c => ({ y: c.y, v: t.series[c.y] != null ? t.series[c.y] : null })).reverse();
  const known = past.filter(p => p.v != null).concat(t.v != null ? [{ y: nowL, v: t.v }] : []);
  const hi = known.slice().sort((a, b) => b.v - a.v)[0], lo = known.slice().sort((a, b) => a.v - b.v)[0];
  const tiles = [{ label: 'This edition', fig: fm(t.v), sub: nowL, title: t.vTitle },
    { label: 'Tour average', fig: fm(t.tour), sub: 'this edition ' + (t.dN != null ? sg(t.dN) : DASH), title: t.tourTitle },
    { label: 'Past five editions', fig: fm(t.avg5), sub: 'average · this edition ' + (t.dP != null ? sg(t.dP) : DASH), title: t.avg5 == null ? 'Needs five past editions on file' : '' },
    { label: 'Highest', fig: known.length >= 2 ? fm(hi.v) : DASH, sub: known.length >= 2 ? `in ${hi.y} · lowest ${fm(lo.v)} in ${lo.y}` : 'needs past editions on file' }];
  const rowsAll = [{ y: nowL, v: t.v, now: true }].concat(past);
  const sp = (Math.max.apply(null, rowsAll.filter(r => r.v != null && t.v != null).map(r => Math.abs(r.v - t.v)).concat([0])) * 1.1) || 1;
  const GRID = 'grid-template-columns:120px 84px 84px 120px minmax(120px,1fr); gap:0 20px;';
  const rows = rowsAll.map(r => { const d = r.v != null && t.v != null ? r.v - t.v : null, bw = d == null ? 0 : Math.abs(d) / sp * 50, dt = r.v != null && t.tour != null ? r.v - t.tour : null;
    return `<div style="display:grid; ${GRID} align-items:center; padding:13px 0; border-bottom:1px solid ${W(6)};">
      <span style="font-size:13.5px; font-weight:${r.now ? 700 : 500}; color:${r.now ? C.white : C.soft}; white-space:nowrap;">${esc(r.y)}</span>
      <span style="text-align:right; ${MONO} font-size:14.5px; font-weight:700; color:${r.now ? C.white : C.soft};">${fm(r.v)}</span>
      <span style="text-align:right; ${MONO} font-size:13px; font-weight:700; color:${sgnC(dt)};">${dt != null ? sg(dt) : DASH}</span>
      <span style="text-align:right; ${MONO} font-size:13px; font-weight:700; color:${r.now ? C.muted : sgnC(d)};">${r.now || d == null ? DASH : sg(d)}</span>
      <div style="position:relative; height:12px;"><div style="position:absolute; left:0; right:0; top:4px; height:4px; border-radius:2px; background:${W(7)};"></div>${d != null && !r.now ? `<div style="position:absolute; left:${d >= 0 ? 50 : 50 - bw}%; top:4px; height:4px; border-radius:2px; width:${bw}%; background:${BAR55};"></div>` : ''}<div title="This edition" style="position:absolute; top:0; left:50%; width:2px; height:12px; margin-left:-1px; border-radius:1px; background:${C.white};"></div></div></div>`; }).join('');
  const body = tiles4(tiles) + `<div style="overflow-x:auto; margin-top:18px;"><div style="min-width:560px;">${tHead(GRID, `<span>Edition</span><span style="text-align:right;">Figure</span><span style="text-align:right;">Vs tour</span><span style="text-align:right;">Vs this edition</span><span style="display:flex; justify-content:space-between;"><span>Lower</span><span>Higher</span></span>`)}${rows}</div></div>`;
  return sheet(t.label, 'This edition and the five before', on(() => { S.ed = null; repaint(); }), body);
}
// the matches behind a Favourites and underdogs tile: this edition's priced Database rows (names from
// database-yield-players.json); set scores from the draw's own results, joined by both surnames, exactly one match
function matchBox(ev, M, st) {
  const t = st.mkt.find(x => x.key === S.stat); if (!t) return '';
  const NM = file('database-yield-players.json'), D = file('database-yield.json');
  const close = on(() => { S.stat = null; repaint(); });
  if (NM === undefined || D === undefined || st.dbRows === undefined) return sheet(t.label, 'Loading the matches…', close, '');
  const RN = (D && D.meta && D.meta.rounds) || [];
  const plain = s => lc(s).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const tdSur = n => plain(String(n).replace(/\s+[A-Z][A-Za-z.\-]*\.?$/, ''));                 // "Ymer E." → "ymer"
  const drSur = n => plain(String(n).replace(/^(?:[A-Z][a-z]?\.(?:-[A-Z]\.)?\s+)+/, ''));       // "J. M. Cerundolo" → "cerundolo"
  const draws = [];
  M.rounds.forEach(R => R.cells.forEach(c => { if (c.match && c.sides[0] && c.sides[1]) draws.push({ c, a: drSur(nameOf(c.sides[0])), b: drSur(nameOf(c.sides[1])) }); }));
  const cy = st.cy;
  const L = (st.dbRows || []).filter(x => Math.floor(x.r[0] / 1e4) === cy).map(x => {
    const nm = NM ? (x.ret ? NM.retNames : NM.names)[x.i] : null; if (!nm) return null;
    const w = nm[0], l = nm[1], ws = tdSur(w), ls = tdSur(l), fw = !!x.r[7];
    const hit = draws.filter(d => (d.a === ws && d.b === ls) || (d.a === ls && d.b === ws));
    const rl = RN[x.r[3]], rd = rl === 'Quarterfinals' ? 'QF' : rl === 'Semifinals' ? 'SF' : rl === 'The Final' ? 'F' : ROUND_IX[rl] != null && M.rounds[ROUND_IX[rl]] ? M.rounds[ROUND_IX[rl]].name : DASH;
    let score = null, three = null, down = null;
    if (hit.length === 1) { const c = hit[0].c, wi = c.sides.findIndex(s => keyOf(s) === c.match.winnerKey); const sc = (c.match.score || []).map(p => (wi ? [p[1], p[0]] : p));
      score = sc.map(p => p[0] + '-' + p[1]).join('  '); three = sc.length === bestOf(ev); down = sc.length ? sc[0][0] < sc[0][1] : null; }
    return { rd, fav: fw ? w : l, dog: fw ? l : w, favP: x.r[5], dogP: x.r[6], favWon: fw, bet: x.bet, win: x.win, score, three, down, fr: x.r[5] - 1, dr: x.r[6] - 1 };
  }).filter(Boolean);
  const wins = L.filter(x => x.win), N = wins.length, ups = wins.filter(x => !x.favWon), bets = L.filter(x => x.bet);
  const big = ups.slice().sort((a, b) => b.dogP - a.dogP)[0], shortBeat = ups.slice().sort((a, b) => a.favP - b.favP)[0];
  const fy = bets.reduce((a, x) => a + (x.favWon ? x.fr : -1), 0), dy = bets.reduce((a, x) => a + (x.favWon ? -1 : x.dr), 0);
  const u = v => (v >= 0 ? '+' : MINUS) + Math.abs(v).toFixed(2), sc2 = v => (v >= 0 ? C.green : C.red), of = (a, b) => a + ' of ' + b;
  const decs = wins.filter(x => x.three === true), downs = wins.filter(x => x.down === true), nf = a => a.filter(x => x.favWon).length;
  const gapT = tt => ({ label: 'Against the tour', fig: tt.gapN === DASH ? DASH : tt.gapN + ' pts', sub: tt.tour != null ? 'tour ' + st.fm(tt, tt.tour) : 'no tour figure on file', title: tt.tourTitle, color: tt.dN == null ? C.white : sgnC(tt.dN) });
  const none = lab => ({ label: lab, fig: DASH, sub: 'no upset yet' });
  const TL = {
    fav: [{ label: 'Favourites won', fig: of(N - ups.length, N), sub: t.fig + ' of matches' }, { label: 'Upsets', fig: String(ups.length), sub: 'underdog winners' }, big ? { label: 'Biggest upset', fig: big.dogP.toFixed(2), sub: big.dog + ' beat ' + big.fav } : none('Biggest upset'), gapT(st.mkt[0])],
    favY: [{ label: 'Yield', fig: t.fig, sub: t.tour != null ? 'tour ' + st.fm(t, t.tour) : '', color: t.figColor }, { label: 'Profit', fig: bets.length ? u(fy) : DASH, sub: 'units over ' + bets.length + ' bets', color: bets.length ? sc2(fy) : C.white }, { label: 'Favourites won', fig: of(N - ups.length, N), sub: st.mkt[0].fig + ' of matches' }, shortBeat ? { label: 'Shortest price beaten', fig: shortBeat.favP.toFixed(2), sub: shortBeat.fav + ' lost to ' + shortBeat.dog } : none('Shortest price beaten')],
    dogY: [{ label: 'Yield', fig: t.fig, sub: t.tour != null ? 'tour ' + st.fm(t, t.tour) : '', color: t.figColor }, { label: 'Profit', fig: bets.length ? u(dy) : DASH, sub: 'units over ' + bets.length + ' bets', color: bets.length ? sc2(dy) : C.white }, { label: 'Underdogs won', fig: of(ups.length, N), sub: 'upsets' }, big ? { label: 'Best winner', fig: '+' + big.dr.toFixed(2), sub: big.dog + ' at ' + big.dogP.toFixed(2), color: C.green } : none('Best winner')],
    dec: [{ label: 'Went to a decider', fig: of(st.sets.dec, st.sets.n), sub: t.fig + ' of matches' }, { label: 'Favourite took it', fig: of(nf(decs), decs.length), sub: 'of the priced deciders' }, { label: 'Underdog took it', fig: of(decs.length - nf(decs), decs.length), sub: 'of the priced deciders' }, gapT(t)],
    cb: [{ label: 'Won from a set down', fig: of(st.sets.cb, st.sets.n), sub: t.fig + ' of matches' }, { label: 'Favourites', fig: of(nf(downs), downs.length), sub: 'of the priced comebacks' }, { label: 'Underdogs', fig: of(downs.length - nf(downs), downs.length), sub: 'of the priced comebacks' }, gapT(t)],
  };
  const yl = S.stat === 'favY' || S.stat === 'dogY';
  const rowsL = S.stat === 'dec' ? decs : S.stat === 'cb' ? downs : yl ? bets : wins;
  const sub = S.stat === 'fav' ? `${N - ups.length} of ${N} matches` : S.stat === 'favY' ? `1 unit on every favourite · ${u(fy)} units over ${bets.length} matches` : S.stat === 'dogY' ? `1 unit on every underdog · ${u(dy)} units over ${bets.length} matches` : `${rowsL.length} of ${N} matches`;
  const GRID = 'grid-template-columns:44px minmax(0,1fr) minmax(0,1fr) 96px 108px; gap:0 14px;';
  const head = `<div style="display:grid; ${GRID} padding:0 0 8px; border-bottom:1px solid ${W(6)}; ${LBL}"><span>Round</span><span>Favourite</span><span>Underdog</span><span>Score</span><span style="text-align:right;">${yl ? '1 unit staked' : 'Result'}</span></div>`;
  const rows = rowsL.map(x => { const r = S.stat === 'favY' ? (x.favWon ? x.fr : -1) : (x.favWon ? -1 : x.dr);
    return `<div style="display:grid; ${GRID} align-items:baseline; padding:11px 0; border-bottom:1px solid ${W(6)}; font-size:13.5px;">
      <span style="${MONO} font-size:11px; color:${C.muted};">${esc(x.rd)}</span>
      <span style="display:flex; align-items:baseline; gap:8px; min-width:0;"><span style="min-width:0; font-weight:${x.favWon ? 700 : 500}; color:${x.favWon ? C.white : C.muted}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(x.fav)}</span><span style="flex:none; ${MONO} font-size:11.5px; color:${C.muted};">${x.favP.toFixed(2)}</span></span>
      <span style="display:flex; align-items:baseline; gap:8px; min-width:0;"><span style="min-width:0; font-weight:${x.favWon ? 500 : 700}; color:${x.favWon ? C.muted : C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(x.dog)}</span><span style="flex:none; ${MONO} font-size:11.5px; color:${C.muted};">${x.dogP.toFixed(2)}</span></span>
      <span style="${MONO} font-size:12px; color:${C.soft}; white-space:pre;">${esc(x.score || DASH)}</span>
      <span style="text-align:right; font-weight:700; font-size:12.5px; color:${yl ? sc2(r) : x.favWon ? C.soft : C.white}; white-space:nowrap;">${yl ? u(r) : x.favWon ? 'Favourite won' : 'Upset'}</span></div>`; }).join('');
  const body = tiles4(TL[S.stat]) + `<div style="overflow-x:auto; margin-top:18px;"><div style="min-width:560px;">${head}${rows}</div></div>`;
  return sheet(t.label, sub, close, body);
}

// ── CSS: the hover states inline styles cannot carry; every selector under the Tournaments page ─────────────────────
function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('tt-draw-css')) return;
  const s = document.createElement('style'); s.id = 'tt-draw-css';
  s.textContent = `
/* the shared .tourx-shell is the design's tab card; the old renderer's #tourxDraw padding is cancelled while this module
   renders, so the pane is the design's 22/24/28 box (data-draw-root) */
.tabpage[data-page="tournaments"] #tourxDraw{ padding:0; }
${SCOPE}{ font-family:'Hanken Grotesk',sans-serif; font-size:16px; line-height:normal; color:${C.text}; -webkit-font-smoothing:antialiased; }
${SCOPE} *{ box-sizing:border-box; }
${SCOPE} .tt-draw-pane{ padding:22px 24px 28px; }
${SCOPE} .tt-draw-seg{ transition:background .14s ease, color .14s ease, border-color .14s ease; }
${SCOPE} .tt-draw-hov:hover{ background:${C.hover} !important; }
${SCOPE} .tt-draw-edge:hover{ border-color:${W(22)} !important; }
${SCOPE} .tt-draw-tile:hover{ box-shadow:inset 0 0 0 1px ${W(22)}; }
${SCOPE} .tt-draw-prow:hover{ background:${C.hover} !important; }
${SCOPE} .tt-draw-score:hover, ${SCOPE} .tt-draw-score:focus-visible{ background:${W(10)}; outline:none; }
${SCOPE} .tt-draw-sug:hover{ background:${C.hover}; border-color:${W(22)} !important; }
${SCOPE} .tt-draw-chg{ color:${C.muted}; } ${SCOPE} .tt-draw-chg:hover{ color:${C.text}; }
${SCOPE} .tt-draw-plink{ color:${C.text}; } ${SCOPE} .tt-draw-plink:hover{ text-decoration:underline; text-underline-offset:3px; }
${SCOPE} input::placeholder{ color:${C.muted}; }
${SCOPE} ::-webkit-scrollbar{ width:10px; height:10px; } ${SCOPE} ::-webkit-scrollbar-thumb{ background:${W(8)}; border-radius:6px; }
${SCOPE} .tt-draw-av .sf-ph.sf-on{ background:${C.lifted}; }
`;
  document.head.appendChild(s);
  // the fixed layers (player box, "?" box) belong to the row / button that opened them: a scroll closes them
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('scroll', e => {
    if (!(S.pop || S.help)) return;
    const t = e && e.target; if (t && t.closest && t.closest('.tt-draw-pop, .tt-draw-helpbox')) return;
    S.pop = null; S.help = null; repaint();
  }, { passive: true, capture: true });
}

const TTDraw = {
  render(el) { render(el); },
  // Match Analysis rows for finished draw matches the board and the draw store no longer hold (the page's matchById)
  rowById(id) { return ROWS.get(String(id)) || null; },
  _h(i, ev) { const f = H[i]; if (typeof f !== 'function') return; if (ev && ev.type === 'click' && ev.stopPropagation) ev.stopPropagation(); f(ev); },
  // test hooks (Node): the pure parts and the state
  _test: { S, events, modelOf, facts, pathOf, statsModel, seasonFigs, dbRowsOf, setFacts, stageOf, render, FILES, reset, boardPrice, resultRow, analysisId, ROWS,
    boxModel, ptsModel, pickName, get H() { return H; } },
};
if (typeof module !== 'undefined' && module.exports) module.exports = TTDraw;
if (typeof window !== 'undefined') window.TTDraw = TTDraw;
}());
