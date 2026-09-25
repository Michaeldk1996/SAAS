/* TEN-270 item 6 — the price-history box (founder 2026-09-24, rulings answered).
 *
 * One box, opened from a player's price on a match card (hover; tap on touch
 * devices). Replaces the old one-line native tooltip. Layout, top to bottom:
 *   header   the card's book, "● live" only while the stream is connected and
 *            writing for this card, otherwise "last updated [time]"
 *   Closing odds (completed cards only) — the card's existing Close
 *   changes  newest first: DD.MM. HH:MM · price · change vs the previous price,
 *            coloured with the "Biggest market move" classes (.mc-drift.pos up,
 *            .neg down); gap rows ("no data from–to") where a recorder was down
 *   "History recorded from …" when the recorded history starts after the Open
 *   Opening odds — the card's existing Open (first sighting wins), with book
 *
 * Never interpolates: a row is shown only for a recorded price; a missing value
 * is a dash. History loads on open, for that one card only (price_history RPC),
 * and is cached for the page session.
 */
(function () {
  'use strict';

  // ── pure logic (exported for tests) ────────────────────────────────────────
  const GAP_MIN_S = 120;             // stream: rows exist only for gaps over the queue TTL
  const HIST_TOLERANCE_MS = 5 * 60e3; // one sweep interval: "recorded from" only past this

  function ms(v) { const t = v ? Date.parse(v) : NaN; return isFinite(t) ? t : null; }

  // RPC payload -> this player's rows [{at, price}], one timeline, deduped on
  // (Kibl time, price); poller sides are named via the fixture's player names.
  function sideRows(payload, sideKey, nameKey) {
    if (!payload) return [];
    const out = new Map();
    const add = (at, price) => {
      const t = ms(at), p = Number(price);
      if (t == null || !(p >= 1.01)) return;
      out.set(t + '|' + p.toFixed(3), { at: t, price: p });
    };
    for (const r of payload.stream || []) if (r && r.side === sideKey) add(r.at, r.price);
    const fx = new Map();
    for (const f of payload.fixtures || []) {
      if (!f) continue;
      fx.set(String(f.fixture_id), { '1': nameKey(f.player1), '2': nameKey(f.player2) });
    }
    for (const r of payload.poller || []) {
      const names = r && fx.get(String(r.fixture_id));
      if (names && names[r.side] === sideKey) add(r.at, r.price);
    }
    return [...out.values()].sort((a, b) => a.at - b.at);
  }

  // bet365 on an UPCOMING card: the lazy odds shard's series (m.oddsMovement,
  // founder ruling 2026-09-24), [[ts, price]] per side in card orientation. Its
  // times are bet365's own tick times; the 15-min capture only sets how late a
  // move arrives.
  function shardRows(om, who) {
    const s = om && om.books && om.books.bet365 && om.books.bet365[who];
    const out = [];
    for (const pt of Array.isArray(s) ? s : []) {
      const t = ms(pt && pt[0]), p = Number(pt && pt[1]);
      if (t != null && p >= 1.01) out.push({ at: t, price: p });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // bet365 on a COMPLETED card: the post-match archive (bet365_history RPC,
  // founder 2026-09-24 "Completed matches: the archive history"). Rows are
  // bet365's own ticks in card orientation, already cut at the start by the
  // RPC; a suspended tick (active false) is not a price.
  function archiveRows(payload, who) {
    const out = [];
    for (const r of (payload && payload.rows) || []) {
      if (!r || r.side !== who || r.active === false) continue;
      const t = ms(r.at), p = Number(r.price);
      if (t != null && p >= 1.01) out.push({ at: t, price: p });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // Keep only real CHANGES: a re-insert at the same price is not a price change.
  function changesOnly(rows) {
    const out = [];
    for (const r of rows) if (!out.length || out[out.length - 1].price !== r.price) out.push(r);
    return out;
  }

  // Gap rows in the history's span: stream gaps over the TTL, poller sweep gaps.
  function gapRows(payload, fromMs, toMs) {
    const out = [];
    for (const g of [...((payload && payload.gaps) || []), ...((payload && payload.sweep_gaps) || [])]) {
      const a = ms(g && g.gap_from), b = ms(g && g.gap_to);
      if (a == null || b == null || b - a < GAP_MIN_S * 1000) continue;
      if (fromMs != null && b < fromMs) continue;
      if (toMs != null && a > toMs) continue;
      out.push({ gap: true, from: a, to: b });
    }
    return out;
  }

  // The box model. `card` = { book, open:{price, at}, close:{price, at}|null,
  // completed, live, updatedAt }; `rows` = this side's recorded rows (asc).
  function model(card, rows, gaps) {
    // History ends at the start: Kibl can insert a not-live row after the off
    // (Gaston–Shimabukuro 24.09: 2.20 at 05:07Z, started 05:06:01Z), and a row
    // after the Close would contradict the Close.
    const startAt = ms(card.startAt);
    if (startAt != null) {
      rows = rows.filter(r => r.at <= startAt);
      gaps = (gaps || []).filter(g => g.from < startAt).map(g => g.to > startAt ? Object.assign({}, g, { to: startAt }) : g);
    }
    const ch = changesOnly(rows);
    const openAt = card.open && ms(card.open.at);
    const items = ch.map((r, i) => {
      let prev = i > 0 ? ch[i - 1].price : null;
      // The first recorded change is measured from the Open when the Open came first.
      if (prev == null && card.open && card.open.price != null && openAt != null && openAt <= r.at
          && card.open.price !== r.price) prev = card.open.price;
      const delta = prev == null ? null : Math.round((r.price - prev) * 1000) / 1000;
      return { at: r.at, price: r.price, delta };
    });
    // The Open itself is its own bottom row, so a first row at the Open's price is
    // not a move and is not repeated, whenever it was sighted (a later first
    // sighting at the same price still isn't a change; "history recorded from"
    // below keeps its time).
    if (items.length && card.open && card.open.price != null && items[0].price === card.open.price) items.shift();
    const first = ch.length ? ch[0].at : null;
    const recordedFrom = (first != null && openAt != null && first - openAt > HIST_TOLERANCE_MS) ? first : null;
    const rowsDesc = [...items, ...gaps].sort((a, b) => (b.at ?? b.to) - (a.at ?? a.to));
    return {
      book: card.book, live: !!card.live, updatedAt: card.updatedAt ?? null,
      close: card.completed ? (card.close || null) : null,
      rows: rowsDesc, recordedFrom, open: card.open || null, historyAvailable: !!card.historyAvailable,
      note: card.note || null, emptyNote: card.emptyNote || null,
    };
  }

  // ── formatting ─────────────────────────────────────────────────────────────
  function tzOf() { try { return (typeof newsTz === 'function' && newsTz()) || undefined; } catch (e) { return undefined; } }
  function fmtWhen(t) {
    if (t == null) return '—';
    const d = new Date(t), tz = tzOf();
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit',
                                                        hour: '2-digit', minute: '2-digit', hour12: false })
                         .formatToParts(d)) parts[p.type] = p.value;
    return `${parts.day}.${parts.month}. ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  }
  function fmtPrice(p) {
    if (p == null || !isFinite(p)) return '—';
    return (typeof mxOddsTxt === 'function') ? mxOddsTxt(p) : Number(p).toFixed(2);
  }
  function fmtDelta(d) {
    if (d == null || d === 0) return '';
    const s = Math.abs(d).toFixed(Math.abs(d) < 0.1 && Math.round(Math.abs(d) * 1000) % 10 ? 3 : 2);
    return (d > 0 ? '+' : '−') + s;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function html(mdl) {
    const book = esc(mdl.book || '—');
    const head = mdl.live ? `<span class="phb-live">● live</span>`
               : `<span class="phb-upd">last updated ${esc(fmtWhen(mdl.updatedAt))}</span>`;
    let h = `<div class="phb-head"><span class="phb-book">${book}</span>${head}</div>`;
    if (mdl.note) h += `<div class="phb-note phb-src">${esc(mdl.note)}</div>`;
    if (mdl.close) {
      h += `<div class="phb-sec">Closing odds</div>`
         + `<div class="phb-row"><span class="phb-when">${esc(fmtWhen(ms(mdl.close.at)))}</span>`
         + `<b class="phb-px">${esc(fmtPrice(mdl.close.price))}</b><span class="phb-d"></span></div>`;
    }
    h += `<div class="phb-list">`;
    if (!mdl.historyAvailable) h += `<div class="phb-note">history not recorded for this book</div>`;
    else if (!mdl.rows.length) h += `<div class="phb-note">${esc(mdl.emptyNote || 'no price change recorded')}</div>`;
    for (const r of mdl.rows) {
      if (r.gap) { h += `<div class="phb-gap">no data ${esc(fmtWhen(r.from))} – ${esc(fmtWhen(r.to))}</div>`; continue; }
      const cls = r.delta == null || r.delta === 0 ? '' : (r.delta > 0 ? ' pos' : ' neg');
      h += `<div class="phb-row"><span class="phb-when">${esc(fmtWhen(r.at))}</span>`
         + `<b class="phb-px">${esc(fmtPrice(r.price))}</b>`
         + `<span class="phb-d mc-drift${cls}">${esc(fmtDelta(r.delta))}</span></div>`;
    }
    if (mdl.recordedFrom != null) h += `<div class="phb-note">history recorded from ${esc(fmtWhen(mdl.recordedFrom))}</div>`;
    h += `</div>`;
    if (mdl.open) {
      h += `<div class="phb-sec">Opening odds</div>`
         + `<div class="phb-row"><span class="phb-when">${esc(fmtWhen(ms(mdl.open.at)))}</span>`
         + `<b class="phb-px">${esc(fmtPrice(mdl.open.price))}</b><span class="phb-d phb-book2">${book}</span></div>`;
    }
    return h;
  }

  // ── page wiring ───────────────────────────────────────────────────────────
  // A price cell on a match card -> (card, side). The row class says the side:
  // .mc-row.a is p1, .mc-row.b is p2.
  const PRICE_SEL = '.mc-drifted__open, .mc-drifted__now, .mc-oddswrap, .mc-journey__open, .mc-journey__close';
  const cache = new Map();           // card_key -> {at, p}: Promise<payload|null>
  const CACHE_TTL_MS = 60e3;         // a live price can move: re-read after a minute (review finding 3)
  const stats = { fetches: 0, bytes: [], opens: 0 };

  function fetchHistory(cardKey, rpc) {
    rpc = rpc || 'price_history';
    const ck = rpc + '|' + cardKey;
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.p;
    const url = (window.SUPABASE_URL || '').replace(/\/$/, ''), key = window.SUPABASE_ANON_KEY || '';
    if (!url || url.startsWith('__') || !key || key.startsWith('__')) return Promise.resolve(null);
    const p = fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_card_key: cardKey }),
    }).then(r => r.ok ? r.text() : null)
      .then(t => { if (t == null) return null; stats.fetches++; stats.bytes.push(t.length); return JSON.parse(t); })
      .catch(() => null);
    cache.set(ck, { at: Date.now(), p });
    p.then(v => { if (v == null) cache.delete(ck); });  // a failure is retried next open
    return p;
  }

  // The odds shard, read by the box itself with the same 60 s TTL: the page's
  // ensureOddsMovement memoises for the whole session, so a page left open
  // would never show a newer 15-min capture (review finding 3). Resolves
  // {om} on success, null when the shard can't be read (never "no changes").
  const shardCache = new Map();
  function fetchShard(ek) {
    if (!ek) return Promise.resolve(null);
    const hit = shardCache.get(ek);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.p;
    const p = fetch(`./odds/${encodeURIComponent(ek)}.json`, { cache: 'no-cache' })
      .then(r => r.ok ? r.text() : (r.status === 404 ? '' : null))
      .then(t => {
        if (t == null) return null;
        stats.fetches++; stats.bytes.push(t.length);
        return { om: t ? JSON.parse(t) : null };     // 404: no shard yet = nothing recorded
      })
      .catch(() => null);
    shardCache.set(ek, { at: Date.now(), p });
    p.then(v => { if (v == null) shardCache.delete(ek); });
    return p;
  }

  function cardData(m, who) {
    const o = typeof _ocsOf === 'function' ? _ocsOf(m) : null;
    const pair = typeof _mcNowPair === 'function' ? _mcNowPair(m) : null;
    const completed = !!m.finalScore;
    const bookRaw = (o && o.book) || (pair && pair.book) || (m.openingOdds && m.openingOdds.bookmaker) || null;
    const bk = String(bookRaw || '').toLowerCase();
    const bookName = (typeof MC_BOOK_NAMES !== 'undefined' && MC_BOOK_NAMES[bk])
      || (typeof mxBookLabel === 'function' && bookRaw ? mxBookLabel(bookRaw) : bookRaw);
    const side = o ? o[who] : null;
    // The Open's time: the card state's, else the card's own openingOdds sighting
    // (the same fallback _openAnchorOf takes for the price) — never a shard time.
    const oo = m.openingOdds || null;
    const open = { price: typeof _openAnchorOf === 'function' ? _openAnchorOf(m, who) : (oo ? oo[who] ?? null : null),
                   at: side ? side.openTs || null : (oo && oo.seenAt) || null };
    const close = completed ? { price: typeof _mcCloseOf === 'function' ? _mcCloseOf(m, who) : null,
                                at: side ? side.closeTs || null : null } : null;
    const live = !completed && !!(pair && pair.src === 'stream' && pair.live);
    const updatedAt = completed ? (close && close.at) : (pair && pair.at) || null;
    // Bet105: the price_history RPC. bet365: the odds shard on UPCOMING cards only,
    // i.e. no result, not live, and before the card's start; the shard series is
    // not cut at the off, so an underway card would show in-play ticks as moves
    // (review finding 1). A completed bet365 card waits for the post-match
    // archive (ruled source) and never falls back to the shard.
    let startMs = NaN;
    try { startMs = typeof cardStartMs === 'function' ? cardStartMs(m) : NaN; } catch (e) { startMs = NaN; }
    const upcoming = !completed && !m.live && (!isFinite(startMs) || Date.now() < startMs);
    const source = bk === 'bet105' ? 'rpc'
      : (bk === 'bet365' ? (upcoming ? 'shard' : (completed ? 'archive' : null)) : null);
    return { book: bookName, bookKey: bk, open, close, completed, live, updatedAt,
             startAt: (o && o.startTs) || null,
             historyAvailable: source != null, source,
             // Founder 2026-09-25: completed bet365 cards carry the SAME source line as upcoming.
             note: (source === 'shard' || source === 'archive') ? BET365_NOTE : null };
  }
  const BET365_NOTE = 'change times from bet365 · refreshed every 15 min';
  const ARCHIVE_NO_START = 'start time unknown — history not shown';

  // A completed bet365 card from its bet365_history payload. `rpc()` resolves
  // the payload or null on failure. Returns { card, rows, failed }.
  async function loadArchive(card, who, rpc) {
    const p = await rpc();
    if (p == null) return { card, rows: [], failed: true };
    // Not archived, the database selects another book, or the card key is fed by
    // anything but exactly one oddspapi fixture: no archive source is present.
    if (!(Number(p.stored) > 0) || p.selected === false || Number(p.fixtures) !== 1) {
      return { card: Object.assign({}, card, { historyAvailable: false, note: null }), rows: [] };
    }
    // Archived, but no start to cut at: nothing can be shown as pre-match.
    if (!p.start_ts) return { card: Object.assign({}, card, { emptyNote: ARCHIVE_NO_START }), rows: [] };
    return { card, rows: archiveRows(p, who) };
  }

  let box = null, hideTimer = null, current = null;
  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'phb';
    box.setAttribute('role', 'dialog');
    box.hidden = true;
    // Inside the matches page so the "Biggest market move" colour classes apply as-is.
    (document.querySelector('[data-page="matches"]') || document.body).appendChild(box);
    box.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    box.addEventListener('mouseleave', () => scheduleHide());
    return box;
  }
  function place(target) {
    const r = target.getBoundingClientRect(), b = ensureBox();
    b.style.visibility = 'hidden'; b.hidden = false;
    const w = b.offsetWidth, h = b.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    b.style.left = left + 'px'; b.style.top = top + 'px'; b.style.visibility = '';
  }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 250); }
  function hide() { if (box) box.hidden = true; current = null; }

  async function open(target) {
    const el = target.closest('.match-card[data-id]'), row = target.closest('.mc-row');
    if (!el || !row) return;
    let all; try { all = matches; } catch (e) { return; }
    const m = (all || []).find(x => String(x.id) === el.dataset.id);
    if (!m) return;
    const who = row.classList.contains('b') ? 'p2' : 'p1';
    const token = {}; current = token; stats.opens++;
    const card = cardData(m, who);
    const b = ensureBox();
    b.dataset.card = el.dataset.id; b.dataset.side = who;
    b.innerHTML = html(model(card, [], [])).replace('no price change recorded', 'loading history…');
    place(target);
    if (!card.historyAvailable) { b.innerHTML = html(model(card, [], [])); place(target); return; }
    let payload = null, shard = null;
    let arch = null;
    if (card.source === 'shard') {
      shard = await fetchShard(typeof eventKeyOfMatch === 'function' ? eventKeyOfMatch(m) : null);
    } else if (card.source === 'archive') {
      arch = await loadArchive(card, who, () => fetchHistory(ocsKeyOf(m), 'bet365_history'));
    } else {
      payload = await fetchHistory(ocsKeyOf(m));
    }
    if (current !== token) return;
    // A repaint during the fetch replaces the price cell; find this card's cell
    // again so the box stays beside it (review finding 2).
    if (!target.isConnected) {
      const again = document.querySelector(`.match-card[data-id="${CSS.escape(el.dataset.id)}"] .mc-row.${who === 'p2' ? 'b' : 'a'}`);
      target = (again && again.querySelector(PRICE_SEL)) || null;
      if (!target) { hide(); return; }
    }
    if (arch) {
      b.innerHTML = arch.failed
        ? html(model(arch.card, [], [])).replace('no price change recorded', 'history unavailable — try again')
        : html(model(arch.card, arch.rows, []));
      place(target);
      return;
    }
    if (card.source === 'shard') {
      // A shard that could not be read is "unavailable", never "no change"
      // (review finding 2); a missing series (404 or no bet365 side) is
      // "not recorded yet".
      const rows = shard && shard.om ? shardRows(shard.om, who) : [];
      const hasSeries = !!(shard && shard.om && shard.om.books && shard.om.books.bet365
                           && Array.isArray(shard.om.books.bet365[who]));
      let h = html(model(card, rows, []));
      if (!shard) h = h.replace('no price change recorded', 'history unavailable — try again');
      else if (!hasSeries) h = h.replace('no price change recorded', 'history not recorded yet');
      b.innerHTML = h;
      place(target);
      return;
    }
    const rows = sideRows(payload, ocsNameKey(m[who]), ocsNameKey);
    // Gaps up to NOW on an upcoming card, up to the Close on a completed one: an
    // outage after the last change must still show (review finding 4).
    const endAt = card.completed ? (card.close && ms(card.close.at)) : Date.now();
    const gaps = gapRows(payload, rows.length ? rows[0].at : null,
                         endAt != null ? endAt : (rows.length ? rows[rows.length - 1].at : null));
    b.innerHTML = payload ? html(model(card, rows, gaps))
                          : html(model(Object.assign({}, card, { historyAvailable: true }), [], []))
                              .replace('no price change recorded', 'history unavailable — try again');
    place(target);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    const touch = () => typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
    let hoverTimer = null;
    document.addEventListener('mouseover', e => {
      if (touch()) return;
      const t = e.target && e.target.closest && e.target.closest(PRICE_SEL);
      if (!t) return;
      clearTimeout(hideTimer); clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => open(t), 150);
    });
    document.addEventListener('mouseout', e => {
      const t = e.target && e.target.closest && e.target.closest(PRICE_SEL);
      if (!t) return;
      clearTimeout(hoverTimer);
      if (!(e.relatedTarget && box && box.contains(e.relatedTarget))) scheduleHide();
    });
    // Touch: tap a price opens the box; tap anywhere outside it closes it. On a
    // pointer device a click (e.g. opening the match modal) closes it, so it
    // never sits above the modal (review finding 7).
    document.addEventListener('click', e => {
      const t = e.target && e.target.closest && e.target.closest(PRICE_SEL);
      if (t && touch()) { e.preventDefault(); e.stopPropagation(); open(t); return; }
      if (box && !box.hidden && !box.contains(e.target)) hide();
    }, true);
    // It is fixed-position, so it closes rather than drift off its card (finding 6).
    window.addEventListener('scroll', () => { if (box && !box.hidden) hide(); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  }

  const api = { archiveRows, loadArchive, ARCHIVE_NO_START, sideRows, shardRows, fetchShard, changesOnly, gapRows, model, html, fmtWhen, fmtDelta, cardData, stats, _open: open };
  if (typeof window !== 'undefined') window.PriceHistoryBox = Object.assign(window.PriceHistoryBox || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
