// TEN-294 — match status for the drops feed (founder comment bef04c62 + card 518c56f0, 2026-09-26).
// Rules: .claude/rules/drops.md ("Match status is api-tennis's", "Three views", "A row's prices stop at the
// live start"). Evidence: TEN-297 doc `status-feasibility`.
//
// Status is api-tennis's, never a vendor's `pending` (Superbet reported 21 of 27 in-play alerts as pending):
//   liveAt      our 10-second live poller's first live sighting (public.live_flip_log), joined on both surname
//               keys + a start within 24 h + exactly one candidate;
//   in play     on the current live board (public.live_snapshot), or went live and api-tennis get_fixtures by
//               event_key is not terminal (or has not answered yet);
//   finished    api-tennis event_status Finished / Retired / Walk Over (the word wins over event_live);
//   not started no live sighting, and api-tennis does not show it started;
//   unknown     no single api-tennis fixture: labelled, never passed off as a status.
// Every price at or after the cut (liveAt, else the earlier scheduled start) is in play and is removed from
// the row, its chart series and its strip; nothing is invented to replace it.
//
// Pure functions here; the api-tennis calls live in createApiTennis (server.mjs wires both).

export const TERMINAL = /^(finished|retired|walk ?over)$/i;
const LIVEISH = /^(set \d|interrupted|suspended|\d+$)/i;
const H = 3600e3;
export const JOIN_WINDOW_MS = 24 * H;          // founder-ruled join window (drops.md)
export const MISSED_FLIP_AFTER_MS = 30 * 60e3; // a start this far past with no live sighting -> ask api-tennis
export const KEY_TTL_MS = 120e3;               // re-ask a non-terminal event_key at most every 2 min
export const DATE_TTL_MS = 15 * 60e3;          // a fixtures-by-date list is kept 15 min

// the SQL's drops_api.nk(): surname part of "Last, First", its last token, lower-case, a-z only
export function nk(n) {
  let s = String(n == null ? '' : n);
  if (s.includes(',')) s = s.split(',')[0];
  s = s.trim().replace(/^.*\s/, '').toLowerCase();
  return s.replace(/[^a-z]/g, '');
}
export function pairKey(a, b) {
  const x = nk(a), y = nk(b);
  return !x || !y || x === y ? null : x < y ? x + '|' + y : y + '|' + x;
}
// api-tennis dates/times are wall-clock UTC+2 (measured, memory apitennis-event-time-is-scheduled-only)
export function apiScheduledMs(date, time) {
  const t = Date.parse(`${date}T${/^\d\d:\d\d$/.test(String(time)) ? time : '00:00'}:00+02:00`);
  return Number.isFinite(t) ? t : null;
}
const ms = (x) => { const t = Date.parse(x); return Number.isFinite(t) ? t : null; };

// api-tennis fixture -> our status word
export function classifyFixture(f) {
  const st = String(f && f.event_status || '').trim();
  if (TERMINAL.test(st)) return 'finished';
  if (String(f && f.event_live) === '1' || /^(set \d|interrupted|suspended)/i.test(st)) return 'in_play';
  const fr = String(f && f.event_final_result || '-').trim();
  if (fr && fr !== '-' && !/^0\s*-\s*0$/.test(fr) && LIVEISH.test(st)) return 'in_play';   // "2" with a set score: started
  return 'not_started';
}

// exactly one candidate on both surname keys and a start within 24 h of the row's
function unique(cands, key) {
  const by = new Map();
  cands.forEach((c) => by.set(String(key(c)), c));
  return by.size === 1 ? [...by.values()][0] : by.size > 1 ? 'ambiguous' : null;
}
export function matchFlip(row, flips) {
  const pk = pairKey(row.playerA, row.playerB), st = ms(row.scheduledStart);
  if (!pk) return null;
  const c = (flips || []).filter((f) => pairKey(f.p1, f.p2) === pk &&
    (st == null || Math.abs(apiScheduledMs(f.date, f.time) - st) < JOIN_WINDOW_MS));
  return unique(c, (f) => f.eventKey);
}
export function matchFixture(row, fixtures) {
  const pk = pairKey(row.playerA, row.playerB), st = ms(row.scheduledStart);
  if (!pk) return null;
  const c = (fixtures || []).filter((f) => !/\//.test(String(f.event_first_player) + String(f.event_second_player)) &&
    pairKey(f.event_first_player, f.event_second_player) === pk &&
    (st == null || Math.abs(apiScheduledMs(f.event_date, f.event_time) - st) < JOIN_WINDOW_MS));
  return unique(c, (f) => f.event_key);
}

// One row's status. ctx: { flips, board: Map(eventKey -> {status, live}), byKey: Map(eventKey -> fixture),
// fixtures: [..] (the by-date lists, or null when not fetched), now }
export function resolveMatch(row, ctx) {
  const now = ctx.now, vendorStart = ms(row.scheduledStart);
  const out = { status: 'unknown', eventKey: null, liveAt: null, apiStatus: null, cutAt: null, cutKind: null, via: null };
  const flip = matchFlip(row, ctx.flips);
  if (flip === 'ambiguous') return { ...out, via: 'ambiguous live sighting' };
  if (flip) {
    const ek = String(flip.eventKey), b = ctx.board && ctx.board.get(ek), f = ctx.byKey && ctx.byKey.get(ek);
    out.eventKey = ek; out.liveAt = flip.liveAt; out.cutAt = flip.liveAt; out.cutKind = 'live';
    if (f) { out.apiStatus = f.event_status || null; out.status = classifyFixture(f) === 'finished' ? 'finished' : 'in_play'; out.via = 'api-tennis event'; }
    if (b && !(f && out.status === 'finished')) { out.apiStatus = b.status || out.apiStatus; out.status = TERMINAL.test(String(b.status)) ? 'finished' : 'in_play'; out.via = 'live board'; }
    if (!f && !b) { out.status = 'in_play'; out.via = 'went live, not yet confirmed finished'; }
    return out;
  }
  // no live sighting
  if (vendorStart == null) return { ...out, via: 'no scheduled start' };
  if (now - vendorStart < MISSED_FLIP_AFTER_MS) return { ...out, status: 'not_started', via: 'no live sighting' };
  if (!ctx.fixtures) return { ...out, via: 'start passed, api-tennis not read' };
  const fx = matchFixture(row, ctx.fixtures);
  if (!fx || fx === 'ambiguous') return { ...out, via: fx ? 'ambiguous fixture' : 'no api-tennis fixture' };
  const c = classifyFixture(fx), apiStart = apiScheduledMs(fx.event_date, fx.event_time);
  out.eventKey = String(fx.event_key); out.apiStatus = fx.event_status || null; out.status = c; out.via = 'api-tennis fixture (live sighting missed)';
  if (c !== 'not_started') {
    out.cutAt = new Date(Math.min(vendorStart, apiStart == null ? Infinity : apiStart)).toISOString();
    out.cutKind = 'scheduled';
  }
  return out;
}

// What the server must ask api-tennis for this cycle.
export function apiNeeds(rows, ctx, cache) {
  const keys = new Set(); let dates = null;
  for (const r of rows) {
    const flip = matchFlip(r, ctx.flips);
    if (flip && flip !== 'ambiguous') {
      const ek = String(flip.eventKey), c = cache.keys.get(ek);
      if (ctx.board && ctx.board.has(ek)) continue;                            // live now: the board says so
      if (c && (TERMINAL.test(String(c.fixture.event_status)) || ctx.now - c.at < KEY_TTL_MS)) continue;
      keys.add(ek);
      continue;
    }
    const st = ms(r.scheduledStart);
    if (flip || st == null || ctx.now - st < MISSED_FLIP_AFTER_MS) continue;
    // api-tennis dates are UTC+2 wall-clock; a day either side covers the join window
    const d = new Date(st + 2 * H);
    const lo = new Date(d.getTime() - 24 * H).toISOString().slice(0, 10), hi = new Date(d.getTime() + 24 * H).toISOString().slice(0, 10);
    dates = dates ? [lo < dates[0] ? lo : dates[0], hi > dates[1] ? hi : dates[1]] : [lo, hi];
  }
  return { keys: [...keys], dates };
}

// The cut: everything recorded at or after cutAt is in play.
function cutSeries(list, cut) { return (list || []).filter((p) => { const t = ms(p[0]); return t != null && t < cut; }); }
export function applyCut(row, line, m) {
  const out = { ...row, match: m };
  if (!m.cutAt) return out;
  const cut = ms(m.cutAt);
  const openAt = ms(row.open && row.open.at);
  if (openAt != null && openAt >= cut) return null;                     // no pre-match price at all: not a pre-match row
  const at = (x) => ms(x && x.at);
  if (row.latest && at(row.latest) != null && at(row.latest) >= cut) {
    const own = line && line.books && line.books[row.book];
    const pre = cutSeries(own && own.side, cut);
    const last = pre[pre.length - 1];
    out.latest = last ? { price: String(last[1]), at: last[0], kind: 'last pre-match' }
      : row.open ? { price: row.open.price, at: row.open.at, kind: 'last pre-match' } : null;
  } else if (row.latest) out.latest = { ...row.latest, kind: 'last pre-match' };
  if (row.preDrop && at(row.preDrop) != null && at(row.preDrop) >= cut) out.preDrop = null;
  if (row.droppedTo && at(row.droppedTo) != null && at(row.droppedTo) >= cut) out.droppedTo = null;
  return out;
}
export function cutLine(line, cutAt) {
  if (!cutAt) return line;
  const cut = ms(cutAt), books = {};
  for (const [name, b] of Object.entries(line.books || {})) {
    const f = b.first && ms(b.first[0]);
    if (f != null && f >= cut) continue;                                 // first quoted in play: no pre-match price
    const side = cutSeries(b.side, cut);
    if (!side.length) continue;
    const seen = ms(b.lastSeen);
    books[name] = { ...b, side, other: cutSeries(b.other, cut), lastSeen: seen != null && seen > cut ? new Date(cut - 1).toISOString() : b.lastSeen };
  }
  return { ...line, books };
}

// rows + lines -> the served feed. Lines are cut at their match's cut (a line's pair = its rows' pair).
export function withStatus(rows, lines, ctx) {
  const lineByKey = new Map((lines || []).map((l) => [l.key, l]));
  const lineKey = (r) => { const pk = pairKey(r.playerA, r.playerB); return pk ? pk + '|' + nk(r.side) : null; };
  const cutByPair = new Map(), outRows = [];
  for (const r of rows) {
    const m = resolveMatch(r, ctx);
    const pk = pairKey(r.playerA, r.playerB);
    if (pk && m.cutAt && !cutByPair.has(pk)) cutByPair.set(pk, m.cutAt);
    const x = applyCut(r, lineByKey.get(lineKey(r)), m);
    if (x) outRows.push(x);
  }
  const outLines = (lines || []).map((l) => cutLine(l, cutByPair.get(pairKey(l.playerA, l.playerB))));
  return { rows: outRows, lines: outLines };
}

// api-tennis client with the caches (terminal answers are kept for the process's life). The key is never
// logged: errors are reported as a code.
export function createApiTennis({ key, fetchImpl = fetch, now = () => Date.now(), log = () => {} }) {
  const cache = { keys: new Map(), dates: null, calls: 0, errors: 0, lastError: null };
  const base = 'https://api.api-tennis.com/tennis/?method=get_fixtures&APIkey=' + encodeURIComponent(key || '');
  async function get(q) {
    cache.calls += 1;
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetchImpl(base + q, { signal: ac.signal });
      const j = await r.json();
      if (!j || String(j.success) !== '1' || !Array.isArray(j.result)) throw new Error('bad api-tennis answer');
      return j.result;
    } catch (e) {
      cache.errors += 1; cache.lastError = e && e.name === 'AbortError' ? 'timeout' : 'api_error';
      log(`api-tennis ${cache.lastError}`);
      return null;
    } finally { clearTimeout(t); }
  }
  async function fill(needs) {
    if (!key) return cache;
    const ks = needs.keys.slice(0, 8);                     // bounded per read; the rest next cycle
    await Promise.all(ks.map(async (ek) => {
      const res = await get('&event_key=' + encodeURIComponent(ek));
      const f = res && res.find((x) => String(x.event_key) === String(ek));
      if (f) cache.keys.set(String(ek), { at: now(), fixture: { event_key: f.event_key, event_status: f.event_status, event_live: f.event_live, event_final_result: f.event_final_result, event_date: f.event_date, event_time: f.event_time } });
    }));
    if (needs.dates) {
      const k = needs.dates.join('..');
      if (!cache.dates || cache.dates.k !== k || now() - cache.dates.at > DATE_TTL_MS) {
        const res = await get(`&date_start=${needs.dates[0]}&date_stop=${needs.dates[1]}`);
        if (res) cache.dates = { k, at: now(), list: res.map((f) => ({ event_key: f.event_key, event_status: f.event_status, event_live: f.event_live,
          event_final_result: f.event_final_result, event_date: f.event_date, event_time: f.event_time,
          event_first_player: f.event_first_player, event_second_player: f.event_second_player })) };
      }
    }
    return cache;
  }
  return { cache, fill, byKey: () => new Map([...cache.keys].map(([k, v]) => [k, v.fixture])), fixtures: () => (cache.dates ? cache.dates.list : null) };
}
