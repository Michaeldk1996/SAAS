/* picks-core.js — the Picks page's figures, as pure functions (no DOM, no fetch).
 *
 * Built from the Claude Design export `design_handoff_picks` (LOCKED 2026-10-27): SPEC.md §11 and the logic class of
 * `Picks LOCKED 2026-10-27.dc.html` (fair · clv · units → pl_pct · f2 · pct · u · sgnC · recFor · card). Everything a
 * member sees on the page except the pick, the stake and the note is computed here from recorded prices, or is a dash.
 * clv and pl_pct are recomputed on read; a stored value is never trusted (README "never accepted from a client").
 *
 * Loaded by the dashboard as a classic script (window.PicksCore) and by node tests (module.exports).
 * Tests: tools/test-picks-core.mjs (demo-data fixtures + the synthetic ledger in tools/fixtures/).
 */
(function (root) {
  'use strict';

  var DASH = '—', MINUS = '−', EN = '–', MID = '·';
  // the stored `date` field (schema, README) is the match's Europe/Brussels day; what a member SEES — every time and
  // which day a pick belongs to — reads the site's member zone (founder 2026-10-30, override 2: stennisfy.tz, else the
  // browser's zone — the Today's Matches rule), never Brussels
  var STORE_TZ = 'Europe/Brussels';
  function viewTz() {
    try { var ls = root && root.localStorage, t = ls && ls.getItem('stennisfy.tz'); return (t && String(t).trim()) || undefined; }
    catch (e) { return undefined; }
  }
  var THIN_N = 20;                       // SPEC §11: fewer than 20 settled in the period → dashes + n=N · thin
  var SETTLED = { won: 1, lost: 1, void: 1 };

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function price(v) { var n = num(v); return n != null && n > 1 ? n : null; }

  // ── SPEC §11 computations ────────────────────────────────────────────────────────────────────────────────────────
  // margin-removed chance of the picked side, from the picked and the other side's price
  function fair(p, q) {
    p = price(p); q = price(q);
    if (p == null || q == null) return null;
    return (1 / p) / ((1 / p) + (1 / q));
  }
  // posted × fair(close, opp_close) − 1; null (a dash) when either close leg is missing
  function clv(posted, close, oppClose) {
    var f = fair(close, oppClose), pp = price(posted);
    return f == null || pp == null ? null : pp * f - 1;
  }
  // profit in % of bankroll: won → stake × (posted − 1) · lost → −stake · void → 0. Unsettled → null.
  function plPct(status, posted, stake) {
    var s = num(stake), pp = price(posted);
    if (status === 'void') return 0;
    if (s == null) return null;
    if (status === 'won') return pp == null ? null : s * (pp - 1);
    if (status === 'lost') return -s;
    return null;
  }
  // Stennisfy fair odds = 1 ÷ model chance (the picked side's %), 2 dp in display; null when no model run
  function modelFair(modelPct) {
    var m = num(modelPct);
    return m == null || !(m > 0) || m > 100 ? null : 1 / (m / 100);
  }
  function isSettled(p) { return !!(p && SETTLED[p.status]); }
  function isOutright(p) { return !!p && p.kind === 'outright'; }
  // Close is "—" until the match is live (SPEC §11 / README): a posted card never shows one, whatever the row holds.
  function closeOf(p) { return p && p.status !== 'posted' && !isOutright(p) ? price(p.close_price) : null; }
  function oppCloseOf(p) { return p && p.status !== 'posted' && !isOutright(p) ? price(p.opp_close_price) : null; }
  function clvOf(p) { return isOutright(p) ? null : clv(p.posted_price, closeOf(p), oppCloseOf(p)); }
  function plOf(p) { return isSettled(p) ? plPct(p.status, p.posted_price, p.stake) : null; }
  // FAV = the side with the lower CURRENT price (now vs opp_now). null when either is missing or they are equal.
  function favSide(p) {
    if (!p || isOutright(p) || !p.player_b) return null;
    var mine = price(p.now_price), opp = price(p.opp_now_price);
    if (mine == null || opp == null || mine === opp) return null;
    var other = p.selection === 'a' ? 'b' : 'a';
    return mine < opp ? p.selection : other;
  }
  // Trail segment: later < earlier → green · > → red · = → 28% white · either missing → 14% white. Colours are
  // tokens.css references (the site's one colour file): --pos / --neg, and white washes as color-mix of --text.
  var SEG = { down: 'var(--pos)', up: 'var(--neg)', flat: 'color-mix(in srgb, var(--text) 28%, transparent)',
    none: 'color-mix(in srgb, var(--text) 14%, transparent)' };
  function trailKind(from, to) {
    from = price(from); to = price(to);
    if (from == null || to == null) return 'none';
    return to < from ? 'down' : to > from ? 'up' : 'flat';
  }
  function trailColour(from, to) { return SEG[trailKind(from, to)]; }
  // Settled = three stops Open → Posted → Close; posted / live = four, Now labelled "Last" once live. `four` forces
  // four stops on a settled pick (the mobile card, board 1j), where Now is the frozen Last.
  function trail(p, four) {
    if (isOutright(p)) return null;
    var open = price(p.open_price), posted = price(p.posted_price), now = price(p.now_price), close = closeOf(p);
    if (isSettled(p) && !four) {
      return { stops: 3, open: open, posted: posted, close: close,
        segs: [SEG.none, trailColour(posted, close)] };
    }
    return { stops: 4, open: open, posted: posted, now: now, close: close, nowLabel: p.status === 'posted' ? 'Now' : 'Last',
      segs: [SEG.none, trailColour(posted, now), trailColour(now, close)] };
  }

  // ── formats (SPEC §11) ───────────────────────────────────────────────────────────────────────────────────────────
  function f2(x) { var n = num(x); return n == null ? DASH : n.toFixed(2); }
  function sign(v) { return v > 0 ? '+' : v < 0 ? MINUS : ''; }
  // a ratio as a signed one-decimal percent: 0.0122 → "+1.2%"
  function pct(x) {
    var n = num(x); if (n == null) return DASH;
    var v = n * 100, r = Math.abs(v).toFixed(1);
    return (r === '0.0' ? '' : sign(v)) + r + '%';
  }
  // a % of bankroll figure: sign + up to dp decimals, trailing zeros trimmed — 0.88 → "+0.88%", −1 → "−1%"
  function u(x, dp) {
    var n = num(x); if (n == null) return DASH;
    var s = Math.abs(n).toFixed(dp == null ? 2 : dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return (s === '0' ? '' : sign(n)) + s + '%';
  }
  function stakeText(x) { var n = num(x); return n == null ? DASH : u(n).replace('+', ''); }
  function sgnColour(x) { var n = num(x); return n == null || n === 0 ? 'var(--text-label)' : n > 0 ? 'var(--pos)' : 'var(--neg)'; }
  function sgnKind(x) { var n = num(x); return n == null || n === 0 ? 'zero' : n > 0 ? 'pos' : 'neg'; }

  // ── clocks: the member zone for everything shown, Brussels for the stored day ──────────────────────────────────
  var _fmt = {};
  function fmt(key, opts, tz) {
    var k = key + '|' + (tz || '');
    if (!_fmt[k]) {
      try { _fmt[k] = new Intl.DateTimeFormat('en-GB', Object.assign(tz ? { timeZone: tz } : {}, opts)); }
      catch (e) { _fmt[k] = new Intl.DateTimeFormat('en-GB', opts); }   // a bad stored zone falls back to the browser's
    }
    return _fmt[k];
  }
  function parts(d, key, opts, tz) {
    var o = {}; fmt(key, opts, tz).formatToParts(d).forEach(function (x) { o[x.type] = x.value; }); return o;
  }
  function toDate(iso) { if (!iso) return null; var d = new Date(iso); return isNaN(d) ? null : d; }
  // "09:41" in the member zone; "—" when absent
  function hhmm(iso) {
    var d = toDate(iso); if (!d) return DASH;
    var o = parts(d, 'hm', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, viewTz());
    return o.hour + ':' + o.minute;
  }
  function ymd(iso, tz) {
    var d = toDate(iso); if (!d) return null;
    var o = parts(d, 'ymd', { year: 'numeric', month: '2-digit', day: '2-digit' }, tz);
    return o.year + '-' + o.month + '-' + o.day;
  }
  // the Brussels calendar day of an instant, YYYY-MM-DD — the stored `date` field only (drawer writes, store queries)
  function brusselsDay(iso) { return ymd(iso, STORE_TZ); }
  // the member-zone calendar day of an instant
  function viewDay(iso) { return ymd(iso, viewTz()); }
  // the day a pick belongs to on screen: the member-zone day of its start (as Today's Matches); a pick with no start
  // instant (an outright) keeps its stored day. A fixture pins its own days (useStoredDay).
  var _storedDay = false;
  function useStoredDay(on) { _storedDay = !!on; }
  function pickDay(p) {
    if (!p) return null;
    if (!_storedDay && p.scheduled_at) { var d = viewDay(p.scheduled_at); if (d) return d; }
    return p.date || null;
  }
  // the stored days a member-zone day can hold (the member zone is at most a day either side of Brussels)
  function storedDaysAround(day) { return [addDays(day, -1), day, addDays(day, 1)]; }
  // calendar arithmetic on YYYY-MM-DD (a civil date, no zone)
  function dayUTC(day) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  function addDays(day, n) { var t = dayUTC(day); if (t == null) return null; return new Date(t + n * 864e5).toISOString().slice(0, 10); }
  function daysBetween(a, b) { var x = dayUTC(a), y = dayUTC(b); return x == null || y == null ? null : Math.round((y - x) / 864e5); }
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // "Mon 26" (the strip's label for a day that is not today)
  function dayLabel(day) { var t = dayUTC(day); if (t == null) return DASH; var d = new Date(t); return WD[d.getUTCDay()] + ' ' + d.getUTCDate(); }
  // "27 Oct" (ledger date) · "16 Nov" (settles)
  function dayMonth(day) { var t = dayUTC(day); if (t == null) return DASH; var d = new Date(t); return String(d.getUTCDate()).padStart(2, '0') + ' ' + MON[d.getUTCMonth()]; }
  function dayMonthShort(day) { var t = dayUTC(day); if (t == null) return DASH; var d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; }

  // ── copy ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  function surname(name) {
    var t = String(name || '').trim().split(/\s+/).filter(Boolean);
    while (t.length > 1 && /^[A-Z][a-z]?\.$/.test(t[0])) t.shift();
    return t.join(' ');
  }
  function pickedPlayer(p) { return p && (p.selection === 'b' ? p.player_b : p.player_a); }
  // SPEC §4: Match winner → "{Surname} to win" · Games handicap → "{Surname} +2.5 games" · Total games → "Over 22.5
  // games" · Outright → "{Surname} · {market_text}"
  function betLine(p) {
    if (!p) return DASH;
    var pl = pickedPlayer(p), sn = surname(pl && pl.name);
    if (isOutright(p)) return sn + ' ' + MID + ' ' + (p.market_text || DASH);
    if (p.market === 'Match winner') return sn + ' to win';
    if (p.market === 'Games handicap') return sn + ' ' + (p.line || DASH) + ' games';
    if (p.market === 'Total games') return (p.line || DASH) + ' games';
    // every other market — the drawer's other chips and a typed market (stored market 'Other' + market_text) — reads
    // "{Surname} · {market}" (founder 2026-10-30, override 2: never a dash); a line, when one was typed, follows
    return sn + ' ' + MID + ' ' + marketLabel(p) + (p.line ? ' ' + p.line : '');
  }
  // the market's own name: a typed market's text ("Tiebreak"), else the chip name ("Set betting")
  function marketLabel(p) {
    if (!p) return DASH;
    if (p.market === 'Other') return String(p.market_text || '').trim() || 'Other';
    return p.market || DASH;
  }
  // the line tag on the picked side (handicap / totals): "+2.5 games" · "Over 22.5"
  function lineTag(p) {
    if (!p || !p.line || isOutright(p)) return '';
    return p.market === 'Games handicap' ? p.line + ' games' : p.market === 'Total games' ? p.line : '';
  }
  var TYPE = { 'Match winner': 'WINNER', 'Games handicap': 'HANDICAP', 'Total games': 'TOTALS', 'Outright': 'OUTRIGHT' };
  // any other market's tag = its own name in caps ("TIEBREAK", "SET BETTING"); the tag box truncates it to fit
  function typeTag(p) { return isOutright(p) ? 'OUTRIGHT' : TYPE[p && p.market] || (p ? marketLabel(p).toUpperCase() : DASH); }
  // posted / live → "POSTED hh:mm" (a live card still shows POSTED, SPEC §5.1); won / lost / void words
  function statusChip(p) {
    if (!p) return { text: DASH, kind: 'posted' };
    if (p.status === 'won') return { text: 'WON', kind: 'won' };
    if (p.status === 'lost') return { text: 'LOST', kind: 'lost' };
    if (p.status === 'void') return { text: 'VOID', kind: 'void' };
    return { text: 'POSTED ' + hhmm(p.posted_at), kind: 'posted' };
  }
  // the P/L in the card header, settled only: "+1.02%" · "−1%" · "0%" (void)
  function plText(p) {
    if (!isSettled(p)) return '';
    if (p.status === 'void') return '0%';
    return u(plOf(p));
  }
  // void note tail: " · ret. 2-3 set 1 · void (Pinnacle rule)" when the first set was not completed
  function voidTail(p) {
    var s = p && p.result && p.result.sets && p.result.sets[0];
    if (!s || !(p.result.retired && p.result.sets.length === 1)) return '';
    return ' ' + MID + ' ret. ' + s.a + '-' + s.b + ' set 1 ' + MID + ' void (Pinnacle rule)';
  }

  // ── settled score block (Today's Matches Completed grammar; set cells coloured PER SET) ─────────────────────────
  // A retired set has no winner: both cells lost-style. A set with a tiebreak shows its score on the tiebreak winner's
  // cell only. The sets-won tile counts completed sets only.
  function scoreSide(p, side) {
    var r = p && p.result; if (!r || !Array.isArray(r.sets) || !r.sets.length) return null;
    var other = side === 'a' ? 'b' : 'a', last = r.sets.length - 1;
    var cells = r.sets.map(function (s, i) {
      var mine = +s[side], theirs = +s[other];
      var retiredSet = !!r.retired && i === last;
      var won = !retiredSet && isFinite(mine) && isFinite(theirs) && mine > theirs;
      return { v: s[side] == null ? DASH : String(s[side]), won: won, tb: s.tb != null && s.tb !== '' && s.tb_side === side ? String(s.tb) : '' };
    });
    return { setsWon: cells.filter(function (c) { return c.won; }).length, cells: cells };
  }
  function winnerSide(p) {
    if (!p || isOutright(p)) return null;
    var other = p.selection === 'a' ? 'b' : 'a';
    return p.status === 'won' ? p.selection : p.status === 'lost' ? other : null;
  }
  // ledger score from the picked side's view: "6-4 7-6" (+ " ret." when retired)
  function scoreText(p) {
    var r = p && p.result; if (!r || !Array.isArray(r.sets) || !r.sets.length) return DASH;
    var me = p.selection === 'b' ? 'b' : 'a', them = me === 'a' ? 'b' : 'a';
    return r.sets.map(function (s) { return s[me] + '-' + s[them]; }).join(' ') + (r.retired ? ' ret.' : '');
  }

  // ── the day: which picks belong to a (tab, day) ─────────────────────────────────────────────────────────────────
  // Upcoming (10-30 lock) = every open pick (posted · live) from `today` on, by day then posted time; Completed = every
  // settled pick of the last 30 days (`today` included), newest day first. Drafts are never shown.
  function upcoming(rows, today) {
    return (rows || []).filter(function (p) { return p && (p.status === 'posted' || p.status === 'live') && pickDay(p) >= today; })
      .sort(function (a, b) { var x = pickDay(a), y = pickDay(b); return x < y ? -1 : x > y ? 1 : String(a.posted_at || '') < String(b.posted_at || '') ? -1 : 1; });
  }
  function history(rows, today) {
    return (rows || []).filter(function (p) { var age = daysBetween(pickDay(p), today); return isSettled(p) && age != null && age >= 0 && age <= 30; })
      .sort(function (a, b) { var x = pickDay(a), y = pickDay(b); return x > y ? -1 : x < y ? 1 : String(a.posted_at || '') < String(b.posted_at || '') ? -1 : 1; });
  }
  // the Upcoming header (CHANGES 10-30 §2): Bets today · Match · Outright · Staked Σ stake · If all land Σ stake × (posted − 1)
  function todayStats(picks) {
    var n = picks.length, or = picks.filter(isOutright).length, stake = 0, land = 0;
    picks.forEach(function (p) { var s = num(p.stake) || 0, x = num(p.posted_price); stake += s; if (x != null) land += s * (x - 1); });
    return [{ label: 'Bets today', value: String(n), kind: 'lead' }, { label: 'Match', value: String(n - or), kind: 'soft' },
      { label: 'Outright', value: String(or), kind: 'soft' }, { label: 'Staked', value: n ? u(stake, 1).replace('+', '') : DASH, kind: n ? 'soft' : 'none' },
      { label: 'If all land', value: n ? u(land, 1) : DASH, kind: n ? 'pos' : 'none' }];
  }
  // Upcoming = posted / live picks of that day; Completed = settled picks of that day. Drafts are never shown.
  function picksFor(rows, tab, day) {
    return (rows || []).filter(function (p) {
      if (!p || p.status === 'draft' || pickDay(p) !== day) return false;
      return tab === 'completed' ? isSettled(p) : (p.status === 'posted' || p.status === 'live');
    });
  }
  // the four empty-panel strings (SPEC §6)
  function emptyState(tab, day, today) {
    if (tab === 'upcoming') return { title: 'No open bets right now', sub: 'Posted picks stay here until their match ends, then move to Completed.' };   // reference 10-30
    if (tab === 'completed' && day === today) return { title: 'No bets settled yet today.', sub: 'Today’s picks are under Upcoming until their match ends.' };
    if (day > today) return { title: 'No bets posted yet for ' + dayLabel(day) + '.', sub: '' };
    return { title: 'No bets this day.', sub: '' };
  }
  // the bets box head (SPEC §4); shown only when the day has more than one pick
  function betsBox(picks, tab, day, today) {
    var n = picks.length, label = day === today ? 'Today' : dayLabel(day);
    var stake = picks.reduce(function (a, p) { return a + (num(p.stake) || 0); }, 0);
    var staked = stakeText(stake) + ' staked';
    if (tab === 'completed') {
      var w = picks.filter(function (p) { return p.status === 'won'; }).length;
      var l = picks.filter(function (p) { return p.status === 'lost'; }).length;
      var v = picks.filter(function (p) { return p.status === 'void'; }).length;
      return { show: n > 1, title: label + ' ' + MID + ' settled ' + MID + ' ' + n + (n === 1 ? ' bet' : ' bets'),
        meta: w + EN + l + (v ? ' ' + MID + ' ' + v + ' void' : '') + ' ' + MID + ' ' + staked };
    }
    var or = picks.filter(isOutright).length;
    return { show: n > 1, title: label + ' ' + MID + ' ' + n + (n === 1 ? ' bet' : ' bets'),
      meta: staked + ' ' + MID + ' ' + or + ' outright ' + MID + ' posted time ' + MID + ' line @ bet105 price ' + MID + ' stake' };
  }
  // where a pick is played: "Vienna Open R32 · 20:30"; outrights: the event
  function whereText(p) {
    if (isOutright(p)) return p.event || DASH;
    return (p.tournament || DASH) + ' ' + (p.round || DASH) + ' ' + MID + ' ' + hhmm(p.scheduled_at);
  }

  // ── Record (strip + ledger) ─────────────────────────────────────────────────────────────────────────────────────
  // Settled rows (won · lost · void) whose day is within the period of `today`: 30 d / 90 d = age in days ≤ 30 / 90;
  // Season = 1 January to today (member zone since 2026-10-30; founder ruling 2026-10-27). W–L excludes voids; Profit Σ pl_pct; ROI =
  // Σ pl_pct ÷ Σ stake over WON + LOST rows only — a void stake is returned, so it is not in the denominator (founder
  // ruling 2026-10-27); Avg CLV over rows with a close. n < 20 → every stat "—" and Settled "n=N · thin".
  var PERIODS = {
    '30d': { label: '30 d', title: 'Last 30 d', days: 30, hover: 'Settled picks from the last 30 days, today included' },
    '90d': { label: '90 d', title: 'Last 90 d', days: 90, hover: 'Settled picks from the last 90 days, today included' },
    season: { label: 'Season', title: 'Season', days: null, hover: '1 January to today' } };
  function inPeriod(p, period, today) {
    var age = daysBetween(pickDay(p), today);
    if (age == null || age < 0) return false;
    var def = PERIODS[period]; if (!def) return false;
    return def.days == null ? String(pickDay(p)).slice(0, 4) === String(today).slice(0, 4) : age <= def.days;
  }
  function record(rows, period, today) {
    var set = (rows || []).filter(function (p) { return isSettled(p) && inPeriod(p, period, today); });
    var n = set.length, thin = n < THIN_N;
    var w = set.filter(function (p) { return p.status === 'won'; }).length, l = set.filter(function (p) { return p.status === 'lost'; }).length;
    var profit = 0, stake = 0, withC = 0, clvSum = 0;
    set.forEach(function (p) {
      var pl = plOf(p); if (pl != null) profit += pl;
      if (p.status !== 'void') stake += num(p.stake) || 0;   // ROI denominator: won + lost only
      var c = clvOf(p); if (c != null) { withC++; clvSum += c; }
    });
    var roi = stake ? profit / stake : null, avgClv = withC ? clvSum / withC : null;
    var def = PERIODS[period] || PERIODS['30d'];
    return {
      period: period, title: def.title, n: n, thin: thin, rows: set, w: w, l: l, profit: n ? profit : null, roi: roi, avgClv: avgClv, withClose: withC,
      stats: thin
        ? [{ label: 'Record', value: DASH, kind: 'plain' }, { label: 'Profit', value: DASH, kind: 'plain' }, { label: 'ROI', value: DASH, kind: 'plain' }, { label: 'Avg CLV', value: DASH, kind: 'plain' }]
        : [{ label: 'Record', value: w + EN + l, kind: 'plain' }, { label: 'Profit', value: u(profit, 1), kind: sgnKind(profit) },
           { label: 'ROI', value: pct(roi), kind: sgnKind(roi) }, { label: 'Avg CLV', value: pct(avgClv), kind: sgnKind(avgClv) }],
      settledText: thin ? 'n=' + n + ' ' + MID + ' thin' : String(n)
    };
  }
  function ledgerRow(p) {
    var pl = pickedPlayer(p), c = clvOf(p), x = plOf(p);
    return {
      id: p.id, date: pickDay(p), dateText: dayMonth(pickDay(p)),
      match: isOutright(p) ? (pl && pl.name) || DASH : (p.player_a && p.player_a.name) + ' v ' + (p.player_b && p.player_b.name),
      event: isOutright(p) ? (p.event || DASH) : (p.tournament || DASH) + ' ' + MID + ' ' + (p.round || DASH),
      pick: (pl && pl.name) || DASH, market: isOutright(p) ? (p.market_text || 'Outright') : marketLabel(p) + (p.line ? ' ' + p.line : ''),
      posted: price(p.posted_price), close: closeOf(p), clv: c, status: p.status,
      result: (p.status === 'won' ? 'W' : p.status === 'lost' ? 'L' : 'V') + ' ' + MID + ' ' + scoreText(p),
      pl: x
    };
  }
  // sort keys (reference SORTK): date · match · pick · posted · close · clv · result · pl. Default date desc; a missing
  // value sorts last whatever the direction.
  var SORTK = {
    date: function (r) { return r.date; }, match: function (r) { return r.match; }, pick: function (r) { return r.pick; },
    posted: function (r) { return r.posted; }, close: function (r) { return r.close; }, clv: function (r) { return r.clv; },
    result: function (r) { return r.status; }, pl: function (r) { return r.pl; }
  };
  function sortLedger(rows, key, dir) {
    var k = SORTK[key] || SORTK.date, d = dir === 1 ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var x = k(a), y = k(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      var c = x < y ? -1 : x > y ? 1 : 0;
      if (c === 0 && key !== 'date') c = a.date < b.date ? 1 : a.date > b.date ? -1 : 0;   // ties: newest first
      return c * d;
    });
  }
  // clicking the same head flips; a new head sorts descending
  function nextSort(cur, key) { return cur && cur.key === key ? { key: key, dir: -cur.dir } : { key: key, dir: -1 }; }

  var api = {
    DASH: DASH, MINUS: MINUS, EN: EN, THIN_N: THIN_N, PERIODS: PERIODS, SEG: SEG,
    fair: fair, clv: clv, plPct: plPct, modelFair: modelFair, isSettled: isSettled, isOutright: isOutright,
    closeOf: closeOf, oppCloseOf: oppCloseOf, clvOf: clvOf, plOf: plOf, favSide: favSide,
    trailKind: trailKind, trailColour: trailColour, trail: trail,
    f2: f2, pct: pct, u: u, stakeText: stakeText, sgnColour: sgnColour, sgnKind: sgnKind,
    hhmm: hhmm, brusselsDay: brusselsDay, viewDay: viewDay, viewTz: viewTz, pickDay: pickDay, useStoredDay: useStoredDay, storedDaysAround: storedDaysAround, addDays: addDays, daysBetween: daysBetween, dayLabel: dayLabel, dayMonth: dayMonth, dayMonthShort: dayMonthShort,
    surname: surname, pickedPlayer: pickedPlayer, betLine: betLine, lineTag: lineTag, typeTag: typeTag, statusChip: statusChip,
    plText: plText, voidTail: voidTail, scoreSide: scoreSide, winnerSide: winnerSide, scoreText: scoreText,
    marketLabel: marketLabel, upcoming: upcoming, history: history, todayStats: todayStats,
    picksFor: picksFor, emptyState: emptyState, betsBox: betsBox, whereText: whereText,
    inPeriod: inPeriod, record: record, ledgerRow: ledgerRow, sortLedger: sortLedger, nextSort: nextSort
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PicksCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
