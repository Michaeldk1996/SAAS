/* TEN-270 item 6 — the price-history box; TEN-377 README §6.1 — its "Odds movement" layout
 * (design 1a, OFFICIAL VERSION 1). Opened by hovering a player's price (tap on touch devices):
 * the price on an Upcoming card, the Open or Close on a Completed card (founder TEN-377 Q2).
 * Layout, top to bottom:
 *   row 1    "Odds movement" (caps) · the card's book
 *   row 2    open → now (Completed: open → the book's close) · change % (signed, true minus) · "N moves"
 *            Completed: "Pinnacle close 1.84" (TEN-295) on one mono line under it
 *            one grey note line (founder Q3): "Updated 14:05 · bet365 · refreshed every 15 min ·
 *            recorded from 28 Sep" — no status dot
 *   ledger   newest first, scrolls (max 236px): DD.MM. HH:MM · price · move vs the previous
 *            price, signed 3 dp (+0.014 / −0.002, ±0.000), --pos / --neg; the latest row is
 *            washed; gap rows ("no data from – to") where a recorder was down
 *   Opening  pinned under the ledger: the card's existing Open (first sighting wins) + its time
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

  function ms(v) { if (typeof v === 'number') return isFinite(v) ? v : null; const t = v ? Date.parse(v) : NaN; return isFinite(t) ? t : null; }

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

  // Row 2's "now": the newest real price — the card face's price, unless the recorded history
  // holds a later tick (the card face can lag the recorder), in which case that tick.
  function nowOf(card, ch) {
    const last = ch.length ? ch[ch.length - 1] : null;
    // Completed: the book's close — the card state's, unless a later pre-start tick is recorded
    // (rows are already cut at the start), so row 2 always equals the closing tick on top.
    const face = card.completed ? card.bookClose : card.now;
    const faceAt = ms(card.completed ? card.updatedAt : card.nowAt);
    if (last && (face == null || faceAt == null || last.at > faceAt)) return last.price;
    return face != null ? face : null;
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
      // "Updated" = the newest clock we hold: the card state's, or a later recorded tick.
      book: card.book, live: !!card.live,
      updatedAt: (ch.length && (ms(card.updatedAt) == null || ch[ch.length - 1].at > ms(card.updatedAt))) ? ch[ch.length - 1].at : (card.updatedAt ?? null),
      close: card.completed ? (card.close || null) : null,
      rows: rowsDesc, recordedFrom, open: card.open || null, historyAvailable: !!card.historyAvailable,
      note: card.note || null, emptyNote: card.emptyNote || null,
      now: nowOf(card, ch), completed: !!card.completed, pctOk: card.pctOk !== false,
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
  function fmtParts(t, o) {
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tzOf() }, o)).formatToParts(new Date(t))) parts[p.type] = p.value;
    return parts;
  }
  function fmtHM(t) {
    if (t == null) return '—';
    const p = fmtParts(t, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
  }
  function fmtDay(t) {
    if (t == null) return '—';
    const p = fmtParts(t, { day: 'numeric', month: 'numeric' });   // "28 Sep" (en-GB would print "Sept")
    return `${p.day} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(p.month) - 1]}`;
  }
  function fmtPrice(p) {
    if (p == null || !isFinite(p)) return '—';
    return (typeof mxOddsTxt === 'function') ? mxOddsTxt(p) : Number(p).toFixed(2);
  }
  // README §6.1: a move is signed to 3 dp with a TRUE minus; no change is ±0.000.
  function fmtDelta(d) {
    if (d == null) return '';
    if (d === 0) return '±0.000';
    return (d > 0 ? '+' : '−') + Math.abs(d).toFixed(3);
  }
  // Open → now as a signed percentage, one decimal (README §6.1 "change %").
  function fmtPct(open, now) {
    if (open == null || now == null || !(open > 0)) return null;
    const v = Math.round((now / open - 1) * 1000) / 10;
    return { text: (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%', dir: v > 0 ? 'pos' : v < 0 ? 'neg' : '' };
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // `state` (optional): 'loading' | 'failed' | 'notyet' — the ledger says so and no move count
  // is shown (a count is only stated for history that was actually read).
  function html(mdl, state) {
    const book = esc(mdl.book || '—');
    const op = mdl.open && mdl.open.price != null ? mdl.open.price : null;
    const now = mdl.now != null ? mdl.now : null;
    // The % is a calculation: never from a vendor-pinned open (TEN-198), an older close (TEN-253)
    // or two books (one book per fixture) — the prices still show, the % does not.
    const pct = mdl.pctOk ? fmtPct(op, now) : null;
    const moves = mdl.rows.filter(r => !r.gap).length;
    const counted = mdl.historyAvailable && !state;
    const mono = t => `<span class="phb-mono">${esc(t)}</span>`;
    let h = `<div class="phb-r1"><span class="phb-cap">Odds movement</span><span class="phb-book">${book}</span></div>`;
    h += `<div class="phb-hd"><div class="phb-r2"><span class="phb-open">${esc(fmtPrice(op))}</span><span class="phb-arr">→</span>`
       + `<b class="phb-now">${esc(fmtPrice(now))}</b>`
       + (pct ? `<span class="phb-pct${pct.dir ? ' ' + pct.dir : ''}">${pct.text}</span>` : '')
       + (counted ? `<span class="phb-n">${moves} move${moves === 1 ? '' : 's'}</span>` : '') + `</div>`;
    // TEN-295 / founder Q2: Completed carries Pinnacle's close as one mono line (dash when none).
    if (mdl.completed) h += `<div class="phb-pin">Pinnacle close <b>${esc(fmtPrice(mdl.close ? mdl.close.price : null))}</b></div>`;
    const notes = [];
    if (mdl.updatedAt != null && ms(mdl.updatedAt) != null) notes.push(`Updated ${mono(fmtHM(ms(mdl.updatedAt)))}`);
    if (mdl.note) notes.push(esc(mdl.note));
    if (mdl.recordedFrom != null) notes.push(`recorded from ${mono(fmtDay(mdl.recordedFrom))}`);
    if (notes.length) h += `<div class="phb-src">${notes.join(' · ')}</div>`;
    h += `</div><div class="phb-list">`;
    const say = t => `<div class="phb-note">${esc(t)}</div>`;
    if (!mdl.historyAvailable) h += say('No price history for this book');
    else if (state === 'loading') h += say('Loading price history…');
    else if (state === 'failed') h += say('Price history unavailable');
    else if (state === 'notyet') h += say('No price history yet');
    else {
      if (!mdl.rows.length) h += say(mdl.emptyNote || 'No price change recorded');
      let first = true;
      for (const r of mdl.rows) {
        if (r.gap) { h += `<div class="phb-gap">No data ${mono(fmtWhen(r.from) + ' – ' + fmtWhen(r.to))}</div>`; continue; }
        const cls = r.delta == null || r.delta === 0 ? '' : (r.delta > 0 ? ' pos' : ' neg');
        h += `<div class="phb-row${first ? ' phb-latest' : ''}"><span class="phb-when">${esc(fmtWhen(r.at))}</span>`
           + `<b class="phb-px">${esc(fmtPrice(r.price))}</b>`
           + `<span class="phb-d${cls}">${esc(fmtDelta(r.delta))}</span></div>`;
        first = false;
      }
    }
    h += `</div>`;
    if (mdl.open) h += `<div class="phb-opening"><span class="phb-when"><span class="phb-cap">Opening</span><span>${esc(fmtWhen(ms(mdl.open.at)))}</span></span>`
                     + `<b class="phb-px">${esc(fmtPrice(op))}</b><span></span></div>`;
    return h;
  }

  // ── page wiring ───────────────────────────────────────────────────────────
  // A price cell on a match card -> (card, side). The row class says the side:
  // .mc-row.a is p1, .mc-row.b is p2.
  // Upcoming: the price; Completed: the Open or the Close (founder TEN-377 Q2).
  const PRICE_SEL = '.mc-drifted__open, .mc-drifted__now, .mc-oddswrap, .mc-px__open, .mc-px__close';
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
    // TEN-295 (founder 2026-09-27, card f09c2fd5): the Closing odds row is PINNACLE's close,
    // named by its source — not the card book's; the header and the list stay the card's book.
    const pc = completed && typeof _mcPinClose === 'function' ? _mcPinClose(m) : null;
    const close = completed ? { price: pc ? (pc[who] ?? null) : null,
                                at: pc ? (pc[who + 'At'] || null) : null,
                                source: pc ? pc.source : null } : null;
    const live = !completed && !!(pair && pair.src === 'stream' && pair.live);
    const updatedAt = completed ? (side ? side.closeTs || null : null) : (pair && pair.at) || null;
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
    // The card face's current price (same resolver); row 2 uses it unless the history holds a later tick.
    const now = pair && pair[who] != null && Number(pair[who]) >= 1.01 ? Number(pair[who]) : null;
    const bookClose = completed && side && side.close != null && Number(side.close) >= 1.01 ? Number(side.close) : null;
    // Whether open → now/close may be measured as a %: same rules as the card's own Move.
    const vendorOpen = typeof _openPinIsVendor === 'function' && _openPinIsVendor(m);
    const olderClose = completed && typeof _mcCloseW60 === 'function' && !_mcCloseW60(m);
    const crossBook = !completed && pair && pair.book && bk && String(pair.book).toLowerCase() !== bk;
    const pctOk = !(vendorOpen || olderClose || crossBook);
    return { book: bookName, bookKey: bk, open, close, completed, live, updatedAt, now, nowAt: (pair && pair.at) || null, bookClose, pctOk,
             startAt: (o && o.startTs) || null,
             historyAvailable: source != null, source,
             // Founder 2026-09-25: completed bet365 cards carry the SAME source line as upcoming.
             note: (source === 'shard' || source === 'archive') ? BET365_NOTE : null };
  }
  const BET365_NOTE = 'bet365 · refreshed every 15 min';   // founder TEN-377 Q3 note-line wording
  const ARCHIVE_NO_START = 'Start time unknown — history not shown';

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

  let box = null, hideTimer = null, current = null, onCell = null;
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
  // README §6.1: 312px wide, right edge 6px past the price's right edge; 8px BELOW the price,
  // or 8px ABOVE it when less than 420px of viewport remains under it.
  const BELOW_MIN_PX = 420, GAP_PX = 8, OVERHANG_PX = 6;
  function placeAt(r, w, h, vw, vh) {
    const left = Math.max(8, Math.min(r.right + OVERHANG_PX - w, vw - w - 8));
    const below = vh - r.bottom >= BELOW_MIN_PX;
    const top = below ? r.bottom + GAP_PX : Math.max(8, r.top - GAP_PX - h);
    return { left, top, below };
  }
  function place(target) {
    const r = target.getBoundingClientRect(), b = ensureBox();
    b.style.visibility = 'hidden'; b.hidden = false;
    const p = placeAt(r, b.offsetWidth, b.offsetHeight, innerWidth, innerHeight);
    b.style.left = p.left + 'px'; b.style.top = p.top + 'px'; b.style.visibility = '';
    b.dataset.at = p.below ? 'below' : 'above';
    if (onCell && onCell !== target) onCell.classList.remove('phb-on');
    onCell = target; target.classList.add('phb-on');
  }
  // Stays open while the pointer is over the price or the pop-up; closes 140 ms after leaving both.
  const HIDE_MS = 140;
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, HIDE_MS); }
  function hide() { if (box) box.hidden = true; current = null; if (onCell) { onCell.classList.remove('phb-on'); onCell = null; } }

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
    b.innerHTML = html(model(card, [], []), 'loading');
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
      // Re-find the SAME cell (a Completed row has two triggers: Open and Close).
      const cls = [...target.classList].find(c => PRICE_SEL.includes('.' + c));
      target = (again && again.querySelector(cls ? '.' + cls : PRICE_SEL)) || null;
      if (!target) { hide(); return; }
    }
    if (arch) {
      b.innerHTML = arch.failed ? html(model(arch.card, [], []), 'failed') : html(model(arch.card, arch.rows, []));
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
      b.innerHTML = html(model(card, rows, []), !shard ? 'failed' : (!hasSeries ? 'notyet' : undefined));
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
                          : html(model(Object.assign({}, card, { historyAvailable: true }), [], []), 'failed');
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
      if (onCell === t && box && !box.hidden) return;   // still on the open price
      hoverTimer = setTimeout(() => open(t), 0);
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

  const api = { archiveRows, loadArchive, ARCHIVE_NO_START, sideRows, shardRows, fetchShard, changesOnly, gapRows, model, html, fmtWhen, fmtDelta, fmtPct, placeAt, cardData, stats, PRICE_SEL, _open: open };
  if (typeof window !== 'undefined') window.PriceHistoryBox = Object.assign(window.PriceHistoryBox || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
