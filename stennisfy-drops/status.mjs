// TEN-294 — match status for the drops feed (founder comment bef04c62 + card 518c56f0, 2026-09-26).
// Rules: .claude/rules/drops.md ("Match status is api-tennis's", "Three views", "A row's prices stop at the
// live start"). Evidence: TEN-297 doc `status-feasibility`.
//
// Status is api-tennis's, never a vendor's `pending` (Superbet reported 21 of 27 in-play alerts as pending):
//   liveAt      our 10-second live poller's first live sighting (public.live_flip_log), joined on both players
//               (surname + first initial when both carry one) + a start within 24 h + exactly one candidate;
//   in play     on the current live board (public.live_snapshot), or went live and api-tennis get_fixtures by
//               event_key is not terminal (or has not answered yet);
//   finished    api-tennis event_status Finished / Retired / Walk Over (the word wins over event_live);
//   not started no live sighting and the start has not passed (or api-tennis shows it not started);
//   unknown     no single api-tennis fixture: labelled, never passed off as a status.
// THE CUT. Every price at or after the cut is in play and is removed from the row, its chart series and its
// strip; nothing is invented to replace it. The cut is the live sighting; without one, the scheduled start
// once it has passed (api-tennis's when a fixture is joined) — an unknown row is cut too (review of ba48b81d:
// an uncut unknown row showed an in-play 1.01 as its drop).
//
// Pure functions here; the api-tennis calls live in createApiTennis (server.mjs wires both).

export const TERMINAL = /^(finished|retired|walk ?over)$/i;
const VOID = /^(cancel+ed|postponed|abandoned)$/i;
const LIVEISH = /^(set \d|interrupted|suspended|\d+$)/i;
const H = 3600e3;
export const JOIN_WINDOW_MS = 24 * H;          // founder-ruled join window (drops.md)
export const MISSED_FLIP_AFTER_MS = 30 * 60e3; // a start this far past with no live sighting -> ask api-tennis
export const KEY_TTL_MS = 120e3;               // re-ask a non-terminal event_key at most every 2 min
export const MISS_TTL_MS = 10 * 60e3;          // an empty or failed answer is not asked again for 10 min
export const DAY_TTL_MS = 15 * 60e3;           // a fixtures-by-day list (today / yesterday) is kept 15 min
export const OLD_DAY_TTL_MS = 6 * H;           // older days only change by late corrections
export const KEYS_PER_READ = 20;               // a restart resolves in one read
export const VENDOR_EARLIER_MAX_MS = 3 * H;    // a vendor start earlier than api-tennis's by more is a wrong start

// the SQL's drops_api.nk(): surname part of "Last, First", its last token, lower-case, a-z only
export function nk(n) {
  let s = String(n == null ? '' : n);
  if (s.includes(',')) s = s.split(',')[0];
  s = s.trim().replace(/^.*\s/, '').toLowerCase();
  return s.replace(/[^a-z]/g, '');
}
// first initial: "Martin Damm" / "M. Damm" -> m; "Damm, Martin" -> m; none -> ''
export function initial(n) {
  let s = String(n == null ? '' : n).trim();
  if (s.includes(',')) s = s.split(',').slice(1).join(',').trim();
  else if (!/\s/.test(s)) return '';
  const c = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z]/);
  return c ? c[0] : '';
}
// every given name's initial: "Adolfo Daniel Vallejo" -> {a, d}; "D. Vallejo" -> {d}; "Vallejo" -> {}
export function initials(n) {
  let s = String(n == null ? '' : n).trim();
  if (s.includes(',')) s = s.split(',').slice(1).join(' ');
  else s = s.split(/\s+/).slice(0, -1).join(' ');
  return new Set((s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z]+/g) || []).map((t) => t[0]));
}
const sameS = (x, y) => { const a = nk(x); return !!a && a === nk(y); };
// initials agree unless both names carry some and none are shared
const sameI = (x, y) => { const i = initials(x), j = initials(y); return !i.size || !j.size || [...i].some((c) => j.has(c)); };
// Surnames join. Initials: a tie between surname candidates is broken by both players agreeing (strict); a lone
// candidate is refused only when BOTH players' initials conflict — one conflict is a middle-name quirk
// (api-tennis lists Adolfo Daniel Vallejo as "D. Vallejo": second review of 36b4a518)
export function samePair(a1, a2, b1, b2, strict) {
  const orient = (x1, x2, y1, y2) => sameS(x1, y1) && sameS(x2, y2) &&
    (strict ? sameI(x1, y1) && sameI(x2, y2) : sameI(x1, y1) || sameI(x2, y2));
  return orient(a1, a2, b1, b2) || orient(a1, a2, b2, b1);
}
// surname-pair bucket (a cheap pre-filter; same-surname pairs allowed — samePair decides)
export function spKey(a, b) { const x = nk(a), y = nk(b); return !x || !y ? null : x < y ? x + '|' + y : y + '|' + x; }

// api-tennis times: our own calls ask for UTC (&timezone=UTC); the live poller's sightings carry the API's
// default zone (Europe/Berlin), used only inside the 24 h join window, where an hour does not matter
export function apiStartMs(date, time, utc) {
  const t = Date.parse(`${date}T${/^\d\d:\d\d$/.test(String(time)) ? time : '00:00'}:00${utc ? 'Z' : '+02:00'}`);
  return Number.isFinite(t) ? t : null;
}
const ms = (x) => { const t = Date.parse(x); return Number.isFinite(t) ? t : null; };

// api-tennis fixture -> our status word
export function classifyFixture(f) {
  const st = String(f && f.event_status || '').trim();
  if (TERMINAL.test(st)) return 'finished';
  if (VOID.test(st)) return 'unknown';
  if (String(f && f.event_live) === '1' || /^(set \d|interrupted|suspended)/i.test(st)) return 'in_play';
  const fr = String(f && f.event_final_result || '-').trim();
  if (fr && fr !== '-' && !/^0\s*-\s*0$/.test(fr) && LIVEISH.test(st)) return 'in_play';   // "2" with a set score: started
  return 'not_started';
}

function unique(cands, key) {
  const by = new Map();
  cands.forEach((c) => by.set(String(key(c)), c));
  return by.size === 1 ? [...by.values()][0] : by.size > 1 ? 'ambiguous' : null;
}
// exactly one candidate on surnames + a start within 24 h; two or more -> the initials decide, else ambiguous
function pick(row, cands, p1, p2, key) {
  const u = unique(cands, key);
  if (u !== 'ambiguous') return u;
  return unique(cands.filter((c) => samePair(row.playerA, row.playerB, p1(c), p2(c), true)), key) || 'ambiguous';
}
export function matchFlip(row, flips) {
  const st = ms(row.scheduledStart);
  const c = (flips || []).filter((f) => samePair(row.playerA, row.playerB, f.p1, f.p2) &&
    (st == null || Math.abs(apiStartMs(f.date, f.time, false) - st) < JOIN_WINDOW_MS));
  return pick(row, c, (f) => f.p1, (f) => f.p2, (f) => f.eventKey);
}
export function matchFixture(row, fixtures) {
  const st = ms(row.scheduledStart);
  const c = (fixtures || []).filter((f) => !/\//.test(String(f.event_first_player) + String(f.event_second_player)) &&
    samePair(row.playerA, row.playerB, f.event_first_player, f.event_second_player) &&
    (st == null || Math.abs(apiStartMs(f.event_date, f.event_time, f.utc) - st) < JOIN_WINDOW_MS));
  return pick(row, c, (f) => f.event_first_player, (f) => f.event_second_player, (f) => f.event_key);
}

// One row's status. ctx: { flips, board: Map(eventKey -> {status, live}), byKey: Map(eventKey -> fixture),
// fixtures: [..] (by-day lists, or null), now }
export function resolveMatch(row, ctx) {
  const now = ctx.now, vendorStart = ms(row.scheduledStart);
  const out = { status: 'unknown', eventKey: null, liveAt: null, apiStatus: null, cutAt: null, cutKind: null, via: null };
  // an unknown row whose scheduled start has passed is cut there: never un-cut in-play prices
  const unknownCut = (via) => ({ ...out, via, ...(vendorStart != null && vendorStart <= now ? { cutAt: new Date(vendorStart).toISOString(), cutKind: 'scheduled' } : {}) });
  const flip = matchFlip(row, ctx.flips);
  if (flip === 'ambiguous') return unknownCut('ambiguous live sighting');
  if (flip) {
    const ek = String(flip.eventKey), b = ctx.board && ctx.board.get(ek), f = ctx.byKey && ctx.byKey.get(ek);
    out.eventKey = ek; out.liveAt = flip.liveAt; out.cutAt = flip.liveAt; out.cutKind = 'live';
    const fin = !!f && classifyFixture(f) === 'finished';
    if (f) { out.apiStatus = f.event_status || null; out.status = fin ? 'finished' : 'in_play'; out.via = 'api-tennis event'; }
    // a fresh board says "live" or "finished"; it never overrides an api-tennis Finished (a stale entry)
    if (b && !fin) { out.apiStatus = b.status || out.apiStatus; out.status = TERMINAL.test(String(b.status)) ? 'finished' : 'in_play'; out.via = 'live board'; }
    if (!f && !b) { out.status = 'in_play'; out.via = 'went live, not yet confirmed finished'; }
    return out;
  }
  // no live sighting
  if (vendorStart == null) return { ...out, via: 'no scheduled start' };
  if (now < vendorStart) return { ...out, status: 'not_started', via: 'no live sighting' };
  // the start has passed with no live sighting: api-tennis's fixture decides; in the first 30 min, without a
  // fixture, trust the 10-second poller (it has not seen the match go live)
  const fx = ctx.fixtures ? matchFixture(row, ctx.fixtures) : null;
  const grace = now - vendorStart < MISSED_FLIP_AFTER_MS;
  if (!fx || fx === 'ambiguous') {
    if (grace) return { ...out, status: 'not_started', via: 'no live sighting yet' };
    return unknownCut(!ctx.fixtures ? 'start passed, api-tennis not read yet' : fx ? 'ambiguous fixture' : 'no api-tennis fixture');
  }
  const c = classifyFixture(fx), apiStart = apiStartMs(fx.event_date, fx.event_time, fx.utc);
  if (c === 'unknown') return { ...unknownCut('api-tennis: ' + fx.event_status), eventKey: String(fx.event_key), apiStatus: fx.event_status || null };
  out.eventKey = String(fx.event_key); out.apiStatus = fx.event_status || null; out.status = c; out.via = 'api-tennis fixture (live sighting missed)';
  if (c !== 'not_started') {
    // api-tennis's start; the vendor's only when it is earlier by a plausible margin (a start hours off is a wrong start)
    const cut = apiStart == null ? vendorStart
      : vendorStart < apiStart && apiStart - vendorStart <= VENDOR_EARLIER_MAX_MS ? vendorStart : apiStart;
    out.cutAt = new Date(cut).toISOString(); out.cutKind = 'scheduled';
  }
  return out;
}

// What the server must ask api-tennis for this cycle: event keys (awaited, small) and whole days (fetched
// in the background, one day per call).
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
export function apiNeeds(rows, ctx, cache) {
  const keys = new Set(), days = new Set();
  for (const r of rows) {
    const flip = matchFlip(r, ctx.flips);
    if (flip && flip !== 'ambiguous') {
      const ek = String(flip.eventKey), c = cache.keys.get(ek);
      if (ctx.board && ctx.board.has(ek)) continue;                            // live now: the board says so
      if (c && (c.fixture ? TERMINAL.test(String(c.fixture.event_status)) || ctx.now - c.at < KEY_TTL_MS : ctx.now - c.at < MISS_TTL_MS)) continue;
      keys.add(ek);
      continue;
    }
    const st = ms(r.scheduledStart);
    if (flip || st == null || ctx.now < st) continue;
    // a vendor start runs hours late or a little early: the start's day and both neighbours
    days.add(dayOf(st - 24 * H)); days.add(dayOf(st)); days.add(dayOf(st + 24 * H));
  }
  return { keys: [...keys].slice(0, KEYS_PER_READ), days: [...days].sort() };
}

// The cut: everything recorded at or after cutAt is in play.
function cutSeries(list, cut) { return (list || []).filter((p) => { const t = ms(p[0]); return t != null && t < cut; }); }
export function applyCut(row, line, m, siblings) {
  const out = { ...row, match: m };
  if (!m.cutAt) return out;
  const cut = ms(m.cutAt);
  const at = (x) => ms(x && x.at);
  const openAt = at(row.open);
  if (openAt != null && openAt >= cut) return null;                     // no pre-match price at all: not a pre-match row
  if (row.preDrop && (at(row.preDrop) == null || at(row.preDrop) >= cut)) out.preDrop = null;
  if (row.droppedTo && (at(row.droppedTo) == null || at(row.droppedTo) >= cut)) out.droppedTo = null;
  if (row.latest && at(row.latest) != null && at(row.latest) < cut) { out.latest = { ...row.latest, kind: 'last pre-match' }; return out; }
  // the latest recorded price before the cut: the book's own series, the alert's prices, the open
  const own = line && line.books && line.books[row.book];
  const cands = cutSeries(own && own.side, cut).map((p) => ({ at: p[0], price: String(p[1]) }))
    .concat([out.droppedTo, out.preDrop, row.open].concat(siblings || []).filter((x) => x && at(x) != null && at(x) < cut).map((x) => ({ at: x.at, price: String(x.price) })));
  cands.sort((a, b) => ms(a.at) - ms(b.at));
  const last = cands[cands.length - 1];
  out.latest = last ? { price: last.price, at: last.at, kind: 'last pre-match' } : null;
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

// One match, one status: rows of the same two players whose starts sit within 24 h share the best-evidenced
// resolution (a live sighting beats a schedule; finished > in play > not started > unknown), so one match is
// never in two views because two vendors disagree on its start.
const RANK = { unknown: 0, not_started: 1, in_play: 2, finished: 3 };
function better(a, b) {
  if (!b) return a;
  if ((a.cutKind === 'live') !== (b.cutKind === 'live')) return a.cutKind === 'live' ? a : b;
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] > RANK[b.status] ? a : b;
  return (ms(a.cutAt) ?? Infinity) <= (ms(b.cutAt) ?? Infinity) ? a : b;
}
export function withStatus(rows, lines, ctx) {
  const res = rows.map((r) => resolveMatch(r, ctx));
  // a row joins the group of the FIRST earlier row (the group's anchor) with the same players (initials agreeing
  // when both carry one), a start within 24 h, and no different event key — never chained through a third row
  const cluster = rows.map((_, i) => i);
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = rows[i], b = rows[j], ta = ms(a.scheduledStart), tb = ms(b.scheduledStart);
      const keysAgree = !res[i].eventKey || !res[j].eventKey || res[i].eventKey === res[j].eventKey;
      // both rows must name both players' given names: a bare "Wang v Zheng" never groups two matches
      const named = [a.playerA, a.playerB, b.playerA, b.playerB].every((n) => initials(n).size);
      if (named && keysAgree && samePair(a.playerA, a.playerB, b.playerA, b.playerB, true) && (ta == null || tb == null || Math.abs(ta - tb) < JOIN_WINDOW_MS)) { cluster[i] = j; break; }
    }
  }
  const best = new Map();
  res.forEach((m, i) => best.set(cluster[i], better(m, best.get(cluster[i]))));
  const lineByKey = new Map((lines || []).map((l) => [l.key, l]));
  const lineKey = (r) => { const pk = spKey(r.playerA, r.playerB); return pk ? pk + '|' + nk(r.side) : null; };
  // every recorded price of the same selection at the same book (all its alert rows) is a candidate for its
  // last pre-match price, so repeat alerts never disagree on it (second review of 36b4a518)
  const selPts = new Map();
  rows.forEach((r, i) => {
    const k = cluster[i] + '|' + nk(r.side) + '|' + r.book;
    const l = selPts.get(k) || [];
    [r.open, r.preDrop, r.droppedTo, r.latest].forEach((x) => { if (x && x.at && x.price != null) l.push(x); });
    selPts.set(k, l);
  });
  const cutByLine = new Map(), outRows = [];
  rows.forEach((r, i) => {
    const m = best.get(cluster[i]), lk = lineKey(r);
    if (lk && m.cutAt && !cutByLine.has(lk)) cutByLine.set(lk, m.cutAt);
    const x = applyCut(r, lineByKey.get(lk), m, selPts.get(cluster[i] + '|' + nk(r.side) + '|' + r.book));
    if (x) outRows.push(x);
  });
  // a line is cut with its selection's match; the other side of the same match shares the cut
  const cutByPair = new Map([...cutByLine].map(([k, v]) => [k.split('|').slice(0, 2).join('|'), v]));
  const outLines = (lines || []).map((l) => cutLine(l, cutByLine.get(l.key) || cutByPair.get(spKey(l.playerA, l.playerB))));
  return { rows: outRows, lines: outLines };
}

// api-tennis client with the caches (terminal answers kept for the process's life; empty / failed answers
// retried after MISS_TTL_MS). Days are fetched in the background and used from the next read. The key is
// never logged: errors are reported as a code.
export function createApiTennis({ key, fetchImpl = fetch, now = () => Date.now(), log = () => {} }) {
  const cache = { keys: new Map(), days: new Map(), inflight: new Set(), calls: 0, errors: 0, lastError: null };
  const base = 'https://api.api-tennis.com/tennis/?method=get_fixtures&timezone=UTC&APIkey=' + encodeURIComponent(key || '');
  async function get(q, timeoutMs) {
    cache.calls += 1;
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
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
  const slim = (f) => ({ event_key: f.event_key, event_status: f.event_status, event_live: f.event_live, event_final_result: f.event_final_result,
    event_date: f.event_date, event_time: f.event_time, event_first_player: f.event_first_player, event_second_player: f.event_second_player, utc: true });
  async function fill(needs) {
    if (!key) return cache;
    await Promise.all((needs.keys || []).slice(0, KEYS_PER_READ).map(async (ek) => {
      const res = await get('&event_key=' + encodeURIComponent(ek), 8000);
      const f = res && res.find((x) => String(x.event_key) === String(ek));
      cache.keys.set(String(ek), { at: now(), fixture: f ? slim(f) : null });
    }));
    const yday = dayOf(now() - 24 * H);
    for (const d of needs.days || []) {
      const c = cache.days.get(d), ttl = !c || !c.list ? MISS_TTL_MS : d >= yday ? DAY_TTL_MS : OLD_DAY_TTL_MS;
      if ((c && now() - c.at < ttl) || cache.inflight.has(d)) continue;
      cache.inflight.add(d);
      get(`&date_start=${d}&date_stop=${d}`, 45000).then((res) => {   // one day: ~2-6 MB; never awaited by the read
        cache.days.set(d, { at: now(), list: res ? res.map(slim) : null });
      }).finally(() => cache.inflight.delete(d));
    }
    // the 72 h window + margin: nothing older is ever asked for again
    for (const d of [...cache.days.keys()]) if (d < dayOf(now() - 5 * 24 * H)) cache.days.delete(d);
    for (const [k, v] of [...cache.keys]) if (now() - v.at > 5 * 24 * H) cache.keys.delete(k);
    return cache;
  }
  const fixtures = () => { const l = [...cache.days.values()].filter((c) => c.list); return l.length ? l.flatMap((c) => c.list) : null; };
  const byKey = () => new Map([...cache.keys].filter(([, v]) => v.fixture).map(([k, v]) => [k, v.fixture]));
  return { cache, fill, byKey, fixtures };
}
