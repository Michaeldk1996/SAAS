// Dropping Odds archive (founder 2026-11-28; design "Biggest moves of the past days", LOCKED 2026-11-27).
// Turns drops_archive.records (tools/drops-archive.sql: one finished, flagged selection with its recorded pre-match series)
// into the figures the page draws. Nothing is stored that can be computed; nothing is computed that was not recorded.
// The readings follow the live page (drops-page.js, .claude/rules/drops.md): prices at 2 dp, half away from zero; the sharp
// reading is Bet105 without its margin (each Bet105 tick paired with the other side's last Bet105 price at or before it,
// fair = 1 + own / other; the archive holds no Pinnacle series); soft = the average of the soft books with two prices.
// A close is the last price before the VERIFIED start only (records.start_at); with none it is null, never a snapshot.

export const SOFT_BOOKS = ['Superbet', 'Napoleon Sports BE'];
const r1 = (x) => Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-9) / 10;
const r2 = (x) => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;

// [[at, price], …] -> [{t, v}] sorted, real prices only
export function pts(list) {
  return (list || []).map((p) => ({ t: Date.parse(p[0]), v: Number(p[1]) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v >= 1.01).sort((a, b) => a.t - b.t);
}
// Bet105 without its margin (the live page's noMargin): one point per tick once both sides have posted
export function noMargin(own, other) {
  const ev = own.map((p) => ({ t: p.t, s: p.v })).concat(other.map((p) => ({ t: p.t, o: p.v }))).sort((a, b) => a.t - b.t);
  let s = null, o = null; const out = [];
  for (const e of ev) {
    if (e.s != null) s = e.s; if (e.o != null) o = e.o;
    if (s == null || o == null) continue;
    const v = 1 + s / o, last = out[out.length - 1];
    if (last && last.t === e.t) { last.v = v; continue; }
    if (last && r2(last.v) === r2(v)) continue;
    out.push({ t: e.t, v });
  }
  return out;
}
// the largest single step down from one recorded price to the next (on the 2 dp prices)
export function bigStep(series) {
  let best = null;
  for (let i = 1; i < series.length; i++) {
    const a = r2(series[i - 1].v), b = r2(series[i].v);
    if (b < a && (!best || (a - b) / a > best.p)) best = { p: (a - b) / a, from: a, to: b, t: series[i].t, fromT: series[i - 1].t };
  }
  return best;
}
// the drawn line: recorded prices only, at most `max` points, always keeping the first, the last and the biggest step's two
export function thin(series, step, max = 24) {
  if (series.length <= max) return series;
  const keep = new Set([0, series.length - 1]);
  if (step) series.forEach((p, i) => { if (p.t === step.t || p.t === step.fromT) keep.add(i); });
  const room = max - keep.size, every = (series.length - 2) / Math.max(1, room);
  for (let k = 1; k <= room; k++) keep.add(Math.min(series.length - 2, Math.round(k * every)));
  return series.filter((_, i) => keep.has(i));
}
// the soft line: at each soft tick, the average of the soft books' last prices (books with two prices, once both posted)
export function softAvgSeries(lists) {
  const ev = lists.flatMap((l, i) => l.map((p) => ({ t: p.t, i, v: p.v }))).sort((a, b) => a.t - b.t);
  const last = new Array(lists.length).fill(null), out = [];
  for (const e of ev) {
    last[e.i] = e.v;
    if (last.some((x) => x == null)) continue;
    const v = r2(last.reduce((a, x) => a + r2(x), 0) / last.length), z = out[out.length - 1];
    if (z && z.t === e.t) { z.v = v; continue; }
    if (z && z.v === v) continue;
    out.push({ t: e.t, v });
  }
  return out;
}
// one book's reading: first recorded price, close (verified start only), biggest step
function bookReading(series, verified) {
  if (!series.length) return null;
  const f = series[0], z = series[series.length - 1];
  return { o: r2(f.v), oAt: f.t, c: verified ? r2(z.v) : null, cAt: verified ? z.t : null, n: r2(z.v), step: bigStep(series), two: series.length > 1, series };
}
const ms = (t) => (t == null ? null : new Date(t).toISOString());
function out(rd) {
  if (!rd) return null;
  const last = rd.c != null ? rd.c : rd.n;
  return { o: rd.o, oAt: ms(rd.oAt), c: rd.c, cAt: ms(rd.cAt), n: last, drop: r1((rd.o - last) / rd.o * 100), pts: r1(r1(100 / last) - r1(100 / rd.o)),
    mv: rd.step ? { from: rd.step.from, to: rd.step.to, at: ms(rd.step.t), fromAt: ms(rd.step.fromT), pct: r1(rd.step.p * 100) } : null,
    line: rd.series ? thin(rd.series, rd.step).map((p) => [ms(p.t), r2(p.v)]) : [] };
}
// the score from the side's point of view, from api-tennis's per-set scores ("6-4  7-6" style); null when not sent
export function scoreOf(fixture, sideFirst) {
  const sets = fixture && Array.isArray(fixture.scores) ? fixture.scores : null;
  if (!sets || !sets.length) return null;
  const g = (x) => { const n = parseInt(String(x), 10); return Number.isFinite(n) ? n : null; };
  const s = sets.map((x) => { const a = g(x.score_first), b = g(x.score_second); return a == null || b == null ? null : sideFirst ? a + '-' + b : b + '-' + a; });
  if (s.some((x) => x == null)) return null;
  return s.join('  ') + (/retired/i.test(String(fixture.event_status || '')) ? ' ret.' : '');
}
// one record -> the archive row the page reads
export function summarise(rec, fixture) {
  const books = rec.books || {}, verified = !!rec.start_at;
  const own = (b) => pts(books[b] && books[b].side), oth = (b) => pts(books[b] && books[b].other);
  const sharp = bookReading(noMargin(own('Bet105'), oth('Bet105')), verified);
  const soft = SOFT_BOOKS.map((b) => ({ b, r: bookReading(own(b), verified) })).filter((x) => x.r && x.r.two);
  let softR = null;
  if (soft.length) {
    const avg = (k) => (soft.some((x) => x.r[k] == null) ? null : r2(soft.reduce((a, x) => a + x.r[k], 0) / soft.length));
    const best = soft.reduce((m, x) => (x.r.step && (!m || x.r.step.p > m.r.step.p) ? x : m), null);
    softR = { o: avg('o'), oAt: Math.min(...soft.map((x) => x.r.oAt)), c: avg('c'), cAt: verified ? Math.max(...soft.map((x) => x.r.cAt)) : null, n: avg('n'),
      step: best ? best.r.step : null, two: true, book: soft.length === 1 ? soft[0].b : 'avg', series: softAvgSeries(soft.map((x) => x.r.series)) };
  }
  const sh = sharp && sharp.two ? out(sharp) : null, so = softR ? out(softR) : null;
  if (so) so.book = softR.book;
  const lagMin = sh && so && sh.mv && so.mv ? Math.round((Date.parse(so.mv.at) - Date.parse(sh.mv.at)) / 60000) : null;
  return { key: rec.key, eventKey: rec.event_key, playerA: rec.player_a, playerB: rec.player_b, side: rec.side,
    opp: rec.side_first ? rec.player_b : rec.player_a, tier: tierOf(rec.event_type), event: rec.tournament || null, round: rec.round || null,
    scheduledAt: rec.scheduled_at || null, startAt: rec.start_at || null, won: rec.side_first === rec.winner_first, status: rec.status,
    score: scoreOf(fixture, rec.side_first), sharp: sh, soft: so, lagMin: lagMin != null && lagMin >= 0 ? lagMin : null };
}
export function tierOf(t) {
  t = String(t || '');
  if (/^atp/i.test(t)) return 'ATP';
  if (/challenger/i.test(t)) return 'Challenger';
  if (/itf/i.test(t)) return 'ITF';
  return null;
}

// The archive's own loop: one database read every ARCHIVE_READ_MS (an archive needs no faster clock), scores fetched once
// per match from api-tennis (a decided match does not change), served as one gzipped body. A failed read keeps the last
// good body with its true time; before the first good read /archive.json answers 503, never an empty list.
export const ARCHIVE_READ_MS = 10 * 60e3;
export const SCORE_KEYS_PER_READ = 60;
export function createArchiveService({ readArchive, fetchFixture = null, now = () => Date.now(), log = () => {}, gzip = (b) => b }) {
  const st = { body: null, gz: null, etag: null, at: null, fixtures: new Map(), timer: null, stopped: false, lastError: null };
  async function readOnce() {
    try {
      const recs = await readArchive();
      if (!Array.isArray(recs)) throw new Error('archive shape');
      if (fetchFixture) {
        const want = recs.map((r) => String(r.event_key)).filter((k) => !st.fixtures.has(k)).slice(0, SCORE_KEYS_PER_READ);
        await Promise.all(want.map(async (k) => { try { const f = await fetchFixture(k); if (f) st.fixtures.set(k, f); } catch (e) { /* next read */ } }));
      }
      const rows = recs.map((r) => summarise(r, st.fixtures.get(String(r.event_key)) || null));
      st.at = now();
      const body = Buffer.from(JSON.stringify({ schema: 1, generatedAt: new Date(st.at).toISOString(), days: 90, rows }));
      st.body = body; st.gz = gzip(body); st.etag = '"' + body.length.toString(36) + '-' + st.at.toString(36) + '"'; st.lastError = null;
    } catch (e) { st.lastError = 'archive_read'; log('archive read failed: ' + String(e && e.message || e).slice(0, 200)); }
  }
  function schedule() { if (st.stopped) return; st.timer = setTimeout(async () => { await readOnce(); schedule(); }, ARCHIVE_READ_MS); }
  return { state: st, readOnce, start: async () => { await readOnce(); schedule(); }, stop: () => { st.stopped = true; clearTimeout(st.timer); } };
}
