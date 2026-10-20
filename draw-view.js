// =================================================================
// DRAW VIEW (founder ruling 2026-10-20, item 2) — the official draw as a bracket on the Tournaments page.
// -----------------------------------------------------------------
// Positions come ONLY from draws.json (the ATP Supervisor's released sheet, protennislive). A match is placed in the
// bracket by its two players' own draw slots — never by guessing from later pairings. A future slot whose players are
// not decided yet is an empty placeholder, never a guessed name. Results + set scores: tournament-progression.json
// (matches[] main draw, qualifying[]); times of matches not yet played: matches.json first (refreshed every run), then
// the progression's `scheduled` (both api-tennis, Central-European wall clock → shown in the viewer's zone by the
// page's own apiStartMs). Clicking a finished main-draw match opens OUR match stats (W, UE, W/UE, Dominance) — dashes
// where the feed sent none.
// =================================================================
(function () {
'use strict';
const DASH = '—';

// ── model (pure; Node-testable) ─────────────────────────────────────────────────────────────────────────────────────
function mainRoundNames(size) { const o = []; for (let n = size; n >= 2; n /= 2) o.push(n === 8 ? 'QF' : n === 4 ? 'SF' : n === 2 ? 'F' : `R${n}`); return o; }
// Rounds a qualifying draw plays down to its qualifiers. The number of qualifiers is read from the posted main draw
// (its "Q" entries); without it the depth is unknown, so only the first round is shown (never a guessed depth).
function qualRoundNames(size, qualifiers) {
  if (!(qualifiers > 0) || size % qualifiers) return ['Q1'];
  const n = Math.round(Math.log2(size / qualifiers)); return Array.from({ length: Math.max(1, n) }, (_, i) => `Q${i + 1}`);
}
const feedCode = (t) => { const r = String(t || '').toLowerCase(), m = r.match(/1\/(\d+)-finals?/);
  if (m) return `R${Number(m[1]) * 2}`; if (/semi/.test(r)) return 'SF'; if (/quarter/.test(r)) return 'QF'; if (/final$/.test(r.trim())) return 'F'; return null; };

const meetRound = (p, q) => (p === q ? -1 : Math.floor(Math.log2((p - 1) ^ (q - 1))));

function model({ draw, entry, upcoming, kind }) {
  const sheet = draw && (kind === 'qualifying' ? draw.qualifying : draw.main);
  if (!sheet || sheet.status !== 'posted' || !Array.isArray(sheet.slots)) return null;
  const size = sheet.size, slots = sheet.slots;
  const qualifiers = draw.main && draw.main.status === 'posted' ? draw.main.slots.filter(s => s.entry === 'Q').length : 0;
  const names = kind === 'qualifying' ? qualRoundNames(size, qualifiers) : mainRoundNames(size);
  const slotByKey = new Map(slots.filter(s => s.playerKey).map(s => [String(s.playerKey), s]));
  const results = ((kind === 'qualifying' ? entry && entry.qualifying : entry && entry.matches) || []).filter(m => m.winner === 1 || m.winner === 2);
  const sched = [];
  for (const u of upcoming || []) sched.push({ a: String(u.p1Key || ''), b: String(u.p2Key || ''), date: u.date, time: u.time, code: feedCode(u.tournamentRound), live: !!u.live, src: 'board' });
  for (const u of (entry && entry.scheduled) || []) sched.push({ a: String(u.p1.playerKey || ''), b: String(u.p2.playerKey || ''), date: u.date, time: u.time, code: feedCode(u.roundText), live: u.status === 'live', src: 'feed' });
  const posOf = (k) => { const s = k != null && slotByKey.get(String(k)); return s ? s.pos : null; };
  const side = (s) => s && !s.bye ? { name: s.name, ioc: s.ioc || null, seed: s.seed, entry: s.entry || null, playerKey: s.playerKey || null, pos: s.pos } : null;
  const rounds = [];
  names.forEach((name, k) => {
    const span = Math.pow(2, k + 1), n = size / span, cells = [];
    for (let j = 0; j < n; j++) {
      const lo = j * span + 1, hi = (j + 1) * span, inRange = p => p != null && p >= lo && p <= hi;
      let A = null, B = null, bye = false;
      if (k === 0) { const x = slots[2 * j], y = slots[2 * j + 1]; A = side(x); B = side(y); bye = !!(x.bye || y.bye); }
      else { const prev = rounds[k - 1].cells; A = prev[2 * j].advances; B = prev[2 * j + 1].advances; }
      // A result belongs here only if BOTH players' own slots sit in this cell's range AND the draw makes this the round
      // those two slots meet in: round = highest differing bit of (p−1) XOR (q−1). That is the draw's structure, not a
      // reading of later pairings (and it places qualifying results whose feed labels say "Semi-finals"/"Final").
      const m = results.find(r => { const p = posOf(r.p1.playerKey), q = posOf(r.p2.playerKey);
        return inRange(p) && inRange(q) && meetRound(p, q) === k; });
      let match = null, advances = null;
      if (m) {
        const w = m.winner === 1 ? m.p1 : m.p2, wSlot = slotByKey.get(String(w.playerKey));
        const flip = A && String(A.playerKey) !== String(m.p1.playerKey);
        match = { eventKey: m.eventKey, status: m.status, hasStats: m.hasStats, winnerKey: String(w.playerKey),
          score: Array.isArray(m.score) ? m.score.map(([a, b]) => (flip ? [b, a] : [a, b])) : null, raw: m };
        advances = side(wSlot) || { name: w.name, ioc: null, seed: null, entry: null, playerKey: String(w.playerKey) };
        if (!A) A = side(slotByKey.get(String(flip ? m.p2.playerKey : m.p1.playerKey))) || { name: (flip ? m.p2 : m.p1).name };
        if (!B) B = side(slotByKey.get(String(flip ? m.p1.playerKey : m.p2.playerKey))) || { name: (flip ? m.p1 : m.p2).name };
      } else if (bye) advances = A || B;
      let when = null;
      if (!match && A && B && A.playerKey && B.playerKey) {
        const keys = [String(A.playerKey), String(B.playerKey)].sort().join('|');
        const hit = sched.filter(x => [x.a, x.b].sort().join('|') === keys).sort((x, y) => (x.src === 'board' ? -1 : 1))[0];
        if (hit) when = { date: hit.date, time: hit.time, live: hit.live };
      }
      cells.push({ round: name, j, sides: [A, B], bye, match, advances, when });
    }
    const total = k === 0 ? cells.filter(c => !c.bye).length : cells.length;
    rounds.push({ name, cells, done: cells.filter(c => c.match).length, total });
  });
  return { kind, size, rounds, changedAt: draw.contentChangedAt || null, released: sheet.releasedLocal || null, qualifiers };
}

// ── render (browser) ────────────────────────────────────────────────────────────────────────────────────────────────
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function shortName(full) {                         // "DIAZ ACOSTA, Facundo" → "F. Diaz Acosta"
  if (!full) return '';
  const [sur, given] = String(full).split(/,\s*/);
  const t = String(sur).toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase());
  const ini = String(given || '').trim().split(/\s+/).filter(w => w && w !== '…').map(w => w.split('-').map(p => p[0].toUpperCase()).join('-') + '.').join(' ');
  return given === undefined ? String(full) : (ini ? `${ini} ${t}` : t);
}
function startLabel(when, tz) {
  if (!when) return '';
  if (when.live) return 'Live';
  const ms = typeof window !== 'undefined' && typeof window.apiStartMs === 'function' ? window.apiStartMs({ date: when.date, time: when.time }) : NaN;
  if (!isFinite(ms)) return when.date ? new Date(when.date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }) + ' · time TBC' : '';
  try { return new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }); }
  catch (e) { return new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); }
}
function sideRow(s, won, lost, games, isBye) {
  if (isBye) return `<div class="dv-row dv-row--bye"><span class="dv-ioc"></span><span class="dv-name">Bye</span></div>`;
  if (!s) return `<div class="dv-row dv-row--tbd"><span class="dv-ioc"></span><span class="dv-name">&nbsp;</span></div>`;
  const mark = s.entry && s.entry !== 'SEED' ? `<span class="dv-mark">${esc(s.entry)}</span>` : '';
  const seed = s.seed != null ? `<span class="dv-seed">[${esc(s.seed)}]</span>` : '';
  const sets = (games || []).map(g => `<span class="dv-set">${esc(g)}</span>`).join('');
  return `<div class="dv-row${won ? ' dv-row--won' : ''}${lost ? ' dv-row--lost' : ''}">`
    + `<span class="dv-ioc">${s.ioc ? esc(s.ioc) : ''}</span><span class="dv-name">${esc(shortName(s.name))}</span>${seed}${mark}`
    + `<span class="dv-sets">${sets}</span></div>`;
}
function cardHtml(c, tz, kind) {
  const [A, B] = c.sides;
  if (c.bye) {
    const s = A || B;
    return `<div class="dv-card dv-card--bye">${sideRow(s, false, false, null, false)}${sideRow(null, false, false, null, true)}</div>`;
  }
  if (!A && !B && !c.match) return `<div class="dv-card dv-card--empty" aria-label="not decided yet">${sideRow(null)}${sideRow(null)}</div>`;
  const m = c.match;
  const wA = m && A && String(A.playerKey) === m.winnerKey, wB = m && B && String(B.playerKey) === m.winnerKey;
  const gA = m && m.score ? m.score.map(x => x[0]) : null, gB = m && m.score ? m.score.map(x => x[1]) : null;
  const flag = m && m.status === 'retired' ? '<span class="dv-tag">Ret.</span>' : m && m.status === 'walkover' ? '<span class="dv-tag">W/O</span>' : '';
  const top = m ? '' : `<div class="dv-when">${esc(startLabel(c.when, tz))}</div>`;
  const click = m && kind === 'main' ? ` role="button" tabindex="0" data-dv-ev="${esc(m.eventKey)}" onclick="DrawView.openStats('${esc(m.eventKey)}')"` : '';
  return `<div class="dv-card${m ? ' dv-card--done' : ''}"${click}>${top}${sideRow(A, wA, m && !wA, gA)}${sideRow(B, wB, m && !wB, gB)}${flag}</div>`;
}
function fmtChanged(iso, tz) {
  if (!iso) return DASH;
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }); }
  catch (e) { return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
}

// state + data the page hands in
const S = { city: null, kind: 'main', from: null, open: null, draws: null, prog: null, board: null, tz: undefined, el: null };
function cities() { return S.draws ? Object.values(S.draws.tournaments || {}).filter(t => t.main && t.main.status === 'posted').map(t => t.city).sort() : []; }
function drawOf(city) { return Object.values((S.draws && S.draws.tournaments) || {}).find(t => t.city === city) || null; }
function entryOf(city) { const t = S.prog && S.prog.tournaments; if (!t) return null; return t[city] || Object.values(t).find(e => e.feedName === city) || null; }
function boardOf(city) { return (S.board || []).filter(m => String(m.tour || '').replace(/^ATP /, '') === city && !m.finalScore); }

function statsPanel(c) {
  const m = c.match.raw, ws = typeof window !== 'undefined' && window.WueSheet;
  const row = (s) => {
    const W = s.winners, UE = s.unforcedErrors, dr = ws && ws.dominanceRatio ? ws.dominanceRatio(s.servicePoints, s.returnPoints) : null;
    const f = v => v == null ? DASH : v;
    return `<tr><td class="dv-st-name">${esc(s.name)}</td><td>${f(W)}</td><td>${f(UE)}</td><td>${W != null && UE ? (W / UE).toFixed(2) : DASH}</td><td>${dr != null ? dr.toFixed(2) : DASH}</td></tr>`;
  };
  return `<div class="dv-stats" role="region" aria-label="Match stats"><div class="dv-stats-head"><span>Match stats · ${esc(c.round)}</span>`
    + `<button type="button" class="dv-x" aria-label="Close" onclick="DrawView.openStats(null)">×</button></div>`
    + `<table><thead><tr><th></th><th>W</th><th>UE</th><th>W/UE</th><th>Dominance</th></tr></thead><tbody>${row(m.p1)}${row(m.p2)}</tbody></table>`
    + (m.hasStats === false ? '<div class="dv-note">The feed sent no stat sheet for this match.</div>' : '') + '</div>';
}

function render() {
  const el = S.el; if (!el) return;
  const list = cities();
  if (!list.length) { el.innerHTML = '<div class="dv-empty">No official draw is posted for this week yet.</div>'; return; }
  if (!S.city || !list.includes(S.city)) S.city = list[0];
  const d = drawOf(S.city), e = entryOf(S.city);
  const M = model({ draw: d, entry: e, upcoming: boardOf(S.city), kind: S.kind });
  const seg = typeof window !== 'undefined' && typeof window.sfSegHtml === 'function' ? window.sfSegHtml : null;
  const chips = (items, label) => seg ? seg(items, { label, wrap: true }) : items.map(i => `<button onclick="${i.onclick}">${i.label}</button>`).join('');
  const head = `<div class="dv-head">`
    + chips(list.map(c => ({ label: esc(c), on: c === S.city, onclick: `DrawView.set('city','${esc(c)}')` })), 'Tournament')
    + chips([['main', 'Main draw'], ['qualifying', 'Qualifying']].map(([v, l]) => ({ label: l, on: S.kind === v, disabled: v === 'qualifying' && !(d.qualifying && d.qualifying.status === 'posted'), onclick: `DrawView.set('kind','${v}')` })), 'Draw')
    + `</div>`;
  if (!M) { el.innerHTML = head + '<div class="dv-empty">This draw is not posted yet.</div>'; return; }
  const names = M.rounds.map(r => r.name);
  if (!S.from || !names.includes(S.from)) S.from = names[0];
  const pick = names.slice(0, Math.max(1, names.length - 1));
  const picker = `<div class="dv-from"><span class="dv-cap">From</span>${chips(pick.map(n => ({ label: n, on: n === S.from, onclick: `DrawView.set('from','${n}')` })), 'From round')}</div>`;
  const vis = M.rounds.slice(names.indexOf(S.from));
  const cols = vis.map((r, ci) => `<div class="dv-col${ci === vis.length - 1 ? ' dv-col--last' : ''}"><div class="dv-colhead"><span>${esc(r.name)}</span><span class="dv-count">${r.done} of ${r.total}</span></div>`
    + `<div class="dv-cells">${r.cells.map(c => `<div class="dv-cell${c.j % 2 ? ' dv-cell--b' : ' dv-cell--a'}">${cardHtml(c, S.tz, M.kind)}</div>`).join('')}</div></div>`).join('');
  const opened = S.open && M.rounds.flatMap(r => r.cells).find(c => c.match && c.match.eventKey === S.open);
  el.innerHTML = head + picker
    + `<div class="dv-stale">Draw updated: ${esc(fmtChanged(M.changedAt, S.tz))}</div>`
    + (opened ? statsPanel(opened) : '')
    + `<div class="dv-scroll"><div class="dv-bracket" style="--dv-cols:${vis.length};--dv-rows:${vis[0].cells.length}">${cols}</div></div>`;
}

const DrawView = {
  model, mainRoundNames, qualRoundNames, shortName, meetRound,
  mount(el, data) { S.el = el; Object.assign(S, data || {}); render(); },
  set(k, v) { S[k] = v; if (k !== 'open') S.open = null; if (k === 'city' || k === 'kind') S.from = null; render(); },
  openStats(ev) { S.open = ev; render(); },
};
if (typeof module !== 'undefined' && module.exports) module.exports = DrawView;
if (typeof window !== 'undefined') window.DrawView = DrawView;
}());
