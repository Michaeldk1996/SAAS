/* Match analysis rebuild — design_handoff_match_analysis_2026-11-23 (founder 2026-11-23, pixel for pixel).
   Shared parts of the new design (avatar, card head with "?", switch track, tile, column head, opened-box shell) and the
   rebuilt tab renderers. Data comes from the live data layer in bsp-consult-dashboard.html (aOddsRowsOf, …); nothing here
   computes a figure the live code does not already compute. Colours = the --ma2-* tokens (tokens.css). */
(function (root) {
  'use strict';
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const MONO = "font-family:'IBM Plex Mono',monospace;";
  const W = a => 'color-mix(in srgb, var(--ma2-white) ' + a + '%, transparent)';
  const DASH = '—';

  // ---- shared parts ----
  // Avatar = the player's photo (one resolver, aAvatarHtml), initials as the fallback; size, ring and initials size per place.
  function av(name, key, size, ring, fs) {
    return '<span class="ma2-av" style="--s:' + size + 'px; --ring:' + (ring || ('1px solid ' + W(14))) + '; --fs:' + (fs || 12) + 'px;">'
      + (typeof aAvatarHtml === 'function' ? aAvatarHtml(name, key) : '') + '</span>';
  }
  const RING_A = w => (w || 1.5) + 'px solid var(--ma2-blue)', RING_B = w => (w || 1.5) + 'px solid var(--ma2-text)';
  // initials only (the H2H meetings head, the opened tile panel): never a photo
  function ini(name) { return String(name || '').replace(/\./g, ' ').split(/[\s-]+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
  function avIni(name, size, ring, fs) {
    return '<span title="' + esc(name) + '" style="width:' + size + 'px; height:' + size + 'px; flex:none; box-sizing:border-box; border-radius:50%; background:var(--ma2-lifted); border:' + (ring || ('1px solid ' + W(14))) + '; display:flex; align-items:center; justify-content:center; ' + MONO + ' font-size:' + fs + 'px; font-weight:700; color:var(--ma2-text);">' + esc(ini(name)) + '</span>';
  }
  function help(text) {
    return '<span title="' + esc(text) + '" style="width:16px; height:16px; flex:none; border-radius:50%; border:1px solid ' + W(14) + '; color:var(--ma2-grey); font-size:10.5px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; cursor:help;">?</span>';
  }
  function cardHead(title, helpText, scope, right) {
    return '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px 16px; flex-wrap:wrap;"><div style="display:flex; flex-direction:column; gap:5px;">'
      + '<span style="display:flex; align-items:center; gap:8px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text);">' + esc(title) + '</span>' + (helpText ? help(helpText) : '') + '</span>'
      + (scope != null ? '<span style="font-size:12.5px; color:var(--ma2-grey);">' + scope + '</span>' : '') + '</div>' + (right || '') + '</div>';
  }
  function card(inner, attrs) {
    return '<div' + (attrs || '') + ' style="display:flex; flex-direction:column; gap:18px; background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px;">' + inner + '</div>';
  }
  // the site switch track; items {label, on, onclick, title}
  function track(items, o) {
    o = o || {};
    return '<div class="ma2-track" style="display:inline-flex; flex-wrap:wrap; gap:' + (o.gap || 2) + 'px; background:var(--ma2-track); border:1px solid ' + W(10) + '; border-radius:10px; padding:3px;">'
      + items.map(t => '<span class="seg ma2-seg"' + (t.title ? ' title="' + esc(t.title) + '"' : '') + ' role="button" tabindex="0" onclick="' + t.onclick + '"'
        + ' style="padding:' + (o.pad || '6px 12px') + '; border-radius:7px; font-size:12.5px; white-space:nowrap; cursor:pointer; font-weight:' + (t.on ? 700 : 600) + '; color:' + (t.on ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; background:' + (t.on ? 'var(--ma2-lifted)' : 'transparent') + '; box-shadow:inset 0 0 0 1px ' + (t.on ? W(14) : 'transparent') + ';">' + esc(t.label) + '</span>').join('')
      + '</div>';
  }
  function chip(text, title, extra) {
    return '<span' + (title ? ' title="' + esc(title) + '"' : '') + ' style="font-size:12px; font-weight:700; color:var(--ma2-text); background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:8px; padding:5px 10px; white-space:nowrap;' + (extra || '') + '">' + esc(text) + '</span>';
  }
  function tile(label, fig, note, o) {
    o = o || {};
    return '<div style="display:flex; flex-direction:column; align-items:' + (o.left ? 'flex-start' : 'center') + '; gap:' + (o.left ? 4 : 5) + 'px; padding:' + (o.left ? '13px 14px 12px' : '13px 6px 12px') + '; border-radius:11px; background:' + (o.bg || 'var(--ma2-card)') + '; border:1px solid ' + W(6) + '; min-width:0;' + (o.left ? '' : ' text-align:center;') + '">'
      + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + esc(label) + '</span>'
      + '<span style="' + MONO + ' font-size:20px; font-weight:700; line-height:1.1; color:' + (o.color || 'var(--ma2-text)') + ';">' + fig + '</span>'
      + '<span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;">' + esc(note == null ? '' : note) + '</span></div>';
  }
  // the opened-box shell (max 860 / 980), title + "?" + chip over a grey sub, 30px lifted Close
  function popShell(o) {
    return '<div class="ma2-pop-ov" onclick="if(event.target===this){' + o.onClose + '}" style="position:fixed; inset:0 0 0 var(--sf-side, 0px); z-index:90; background:var(--ma2-scrim-2); display:flex; align-items:center; justify-content:center; padding:24px;">'
      + '<div data-ovpop="" class="ma2-pop" style="width:100%; max-width:' + (o.max || 860) + 'px; border-radius:16px; background:var(--ma2-card); border:1px solid ' + W(8) + '; box-shadow:var(--ma2-shadow-pop); padding:' + (o.pad || '24px 24px 16px') + '; display:flex; flex-direction:column; gap:18px; max-height:calc(100vh - 48px); overflow-y:auto; box-sizing:border-box;">'
      + '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px;"><div style="display:flex; align-items:center; gap:12px; min-width:0;">' + (o.avatar || '')
      + '<div style="display:flex; flex-direction:column; gap:5px; min-width:0;"><span style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="font-size:18px; font-weight:800; color:var(--ma2-text);">' + esc(o.title) + '</span>' + (o.help ? help(o.help) : '') + (o.chip || '') + '</span>'
      + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(o.sub || '') + '</span></div></div>'
      + '<span class="seg ma2-btn" role="button" tabindex="0" onclick="' + o.onClose + '" style="height:30px; padding:0 12px; display:flex; align-items:center; border-radius:8px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; color:var(--ma2-text); cursor:pointer; font-size:12.5px; font-weight:700; flex:none;">Close</span></div>'
      + o.body + '</div></div>';
  }
  const signed = (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 1 : d);

  // ===================================================================================================
  // ODDS (LOCKED 2026-11-22): Market · No-vig → Best price → Bookmakers → All markets → price movement box.
  // Data = aOddsRowsOf (one row per bookmaker, plain names, AODDS_BOOKS groups); best price = highest live now per side;
  // STEAM = the live rule (AODDS_STEAM); All markets = recorded markets only (Q10), Match Winner = the card's one book.
  function oddsMove(o, n) {
    const mp = typeof aOddsMovePct === 'function' ? aOddsMovePct(o, n) : null;
    if (!mp) return { t: DASH, c: 'var(--ma2-quiet)' };
    return { t: (!mp.sign ? '' : mp.sign > 0 ? '+' : '−') + mp.abs.toFixed(1) + '%', c: !mp.sign ? 'var(--ma2-quiet)' : mp.sign > 0 ? 'var(--ma2-green)' : 'var(--ma2-red)' };
  }
  const fmt = v => (v == null ? DASH : aOddsFmt(v));
  const GRID = 'grid-template-columns:minmax(96px,0.9fr) minmax(0,1fr) minmax(0,1fr); gap:8px;';
  function priceBox(now, mv, foot, footVal, o) {
    o = o || {};
    return '<span class="ma2-pbox" style="display:flex; flex-direction:column; min-width:0; border-radius:8px; background:' + (o.best ? 'var(--ma2-lifted)' : 'transparent') + '; border:1px solid ' + (o.best ? W(14) : o.noEdge ? 'transparent' : W(8)) + ';">'
      + '<span style="display:flex; align-items:baseline; justify-content:space-between; gap:8px; padding:8px 12px 7px;"><span class="ma2-now" style="' + MONO + ' font-size:18px; font-weight:700; color:' + (now === DASH ? 'var(--ma2-quiet)' : o.nowC || 'var(--ma2-text)') + ';">' + now + '</span>'
      + '<span style="' + MONO + ' font-size:12.5px; font-weight:600; color:' + mv.c + '; white-space:nowrap;">' + (mv.t === DASH && now === DASH ? '' : mv.t) + '</span></span>'
      + '<span style="display:flex; align-items:baseline; justify-content:space-between; gap:4px 8px; flex-wrap:wrap; padding:6px 12px 7px; border-top:1px solid ' + W(6) + ';">'
      + (o.side != null ? '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + esc(o.side) + '</span><span style="display:flex; align-items:baseline; gap:6px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + foot + '</span><span style="' + MONO + ' font-size:12px; color:var(--ma2-soft);">' + footVal + '</span></span>'
        : '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">' + foot + '</span><span style="' + MONO + ' font-size:12px; color:var(--ma2-soft);">' + footVal + '</span>')
      + '</span></span>';
  }
  function colHeadAvatars(m, names) {
    const cell = (n, k, ring) => '<span style="display:flex; align-items:center; justify-content:center; gap:8px; min-width:0;"' + (names ? '' : ' title="' + esc(n) + '"') + '>' + av(n, k, 22, ring, 8.5)
      + (names ? '<span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(typeof fhSurname === 'function' ? fhSurname(n) : n) + '</span>' : '') + '</span>';
    return cell(m.p1, m.p1Key, RING_A()) + cell(m.p2, m.p2Key, RING_B());
  }
  function oddsBuild(m) {
    const A = typeof _aOdds !== 'undefined' ? _aOdds : {};
    const novig = !!A.novig;
    const D = aOddsRowsOf(m, { novig });
    const rows = D.rows.filter(r => !r.noData);
    const live = rows.filter(r => !r.stale);
    const loading = !m.oddsMovement && !m._oddsLoaded;
    const margin = r => r.margin == null ? null : r.margin * 100;
    const mLbl = r => novig ? 'Margin removed' : r.stale ? 'No recent data' : margin(r) == null ? 'Margin ' + DASH : 'Margin ' + margin(r).toFixed(1) + '%';
    const avg = xs => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;

    // top row: Market · No-vig (no "Sample" chip: the data is real)
    const top = '<div style="display:flex; align-items:center; gap:10px 14px; flex-wrap:wrap;">' + track([
      { label: 'Market', on: !novig, onclick: 'aOddsSetMode(false)', title: 'Prices as quoted, bookmaker margin included' },
      { label: 'No-vig', on: novig, onclick: 'aOddsSetMode(true)', title: 'Margin stripped: prices and probabilities sum to 100%' }]) + '</div>';

    // (1) Best price
    const best = ['a', 'b'].map((x, i) => {
      const name = i ? m.p2 : m.p1, key = i ? m.p2Key : m.p1Key;
      const bk = live.filter(r => r[x + 'Best'])[0] || null;
      const nows = live.map(r => r[x + 'Now']).filter(v => v != null).map(v => +aOddsFmt(v));
      const firstT = bk && bk.series && bk.series[x] && bk.series[x].length ? bk.series[x][0][0] : null;
      const mv = bk ? oddsMove(bk[x + 'Open'], bk[x + 'Now']) : { t: DASH, c: 'var(--ma2-quiet)' };
      return '<div class="ma2-best" data-side="' + x + '" style="display:flex; flex-direction:column; gap:16px; padding:20px; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + W(6) + '; min-width:0;">'
        + '<div style="display:flex; align-items:center; gap:12px;">' + av(name, key, 40, i ? RING_B(2) : RING_A(2), 12)
        + '<span style="display:flex; flex-direction:column; gap:3px; min-width:0; flex:1;"><span style="font-size:15px; font-weight:800; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(name) + '</span>'
        + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + (bk ? 'At ' + esc(bk.name) + ' · ' + esc(mLbl(bk).replace(/^Margin/, 'margin')) : 'No bookmaker price') + '</span></span>'
        + '<span style="display:flex; flex-direction:column; gap:4px; align-items:flex-end; flex:none;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Best price now</span>'
        + '<span style="' + MONO + ' font-size:26px; font-weight:700; color:' + (bk ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + '; line-height:1;">' + (bk ? fmt(bk[x + 'Now']) : DASH) + '</span></span></div>'
        + '<div style="display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px;">'
        + tile('Opening odd', bk ? fmt(bk[x + 'Open']) : DASH, firstT ? aOddsStamp(firstT) : '')
        + tile('Move', mv.t, 'Since opening', { color: mv.c })
        + tile('Average', nows.length ? avg(nows).toFixed(2) : DASH, nows.length ? 'All ' + nows.length + (nows.length === 1 ? ' book' : ' books') : '')
        + '</div></div>';
    }).join('');
    const nb = live.length;
    const bestCard = card(cardHead('Best price', 'Highest price on each side across all bookmakers, with the opening odd at that bookmaker and the average of all books.',
      esc('Match Winner · ' + nb + (nb === 1 ? ' book' : ' books') + ' · ' + (novig ? 'no-vig' : 'as quoted')))
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(300px,100%), 1fr)); gap:12px;">' + best + '</div>');

    // (2) Bookmakers: one box per group, rows with one price box per player, Average box
    const bkRow = r => {
      const on = A.mv === r.name;
      const cell = x => priceBox(r[x + 'Now'] == null ? DASH : fmt(r[x + 'Now']), oddsMove(r[x + 'Open'], r[x + 'Now']), 'Opening odd', fmt(r[x + 'Open']), { best: !!r[x + 'Best'], nowC: r[x + 'Best'] ? 'var(--ma2-text)' : 'var(--ma2-soft)' });
      return '<div class="seg ma2-row" data-bkrow="" data-book="' + esc(r.name) + '" data-src="' + esc(r.key || '') + '" role="button" tabindex="0" onclick="aOddsOpenMv(this.dataset.book)" data-aotip="' + esc(aOddsBookTip(r, D)) + '"'
        + ' style="display:grid; ' + GRID + ' align-items:center; margin:0 8px; padding:4px 10px; border-radius:10px; background:' + (on ? 'var(--ma2-lifted)' : 'transparent') + '; cursor:pointer;">'
        + '<span style="display:flex; flex-direction:column; gap:3px; min-width:0;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(r.name) + '</span>'
        + '<span class="ma2-margin" style="font-size:11.5px; color:var(--ma2-grey);">' + esc(mLbl(r)) + '</span></span>' + cell('a') + cell('b') + '</div>';
    };
    const groups = [['sharp', 'Sharp books', 'Low margin, first to move'], ['soft', 'Soft books', 'Higher margin, slower to move'], ['prediction', 'Prediction markets', '']].map(([g, head, desc]) => {
      const rs = rows.filter(r => r.group === g);
      if (!rs.length) return '';
      const ms = rs.map(margin).filter(v => v != null);
      const meta = rs.length + (rs.length === 1 ? ' book' : ' books') + (novig ? ' · margin removed' : ms.length ? ' · average margin ' + avg(ms).toFixed(1) + '%' : '');
      return '<div class="ma2-group" data-group="' + g + '" style="display:flex; flex-direction:column; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + W(6) + '; overflow:hidden; padding-bottom:10px;">'
        + '<div style="display:flex; align-items:baseline; justify-content:space-between; gap:4px 12px; flex-wrap:wrap; padding:14px 18px 12px;"><span style="display:flex; align-items:baseline; gap:4px 10px; flex-wrap:wrap;"><span style="font-size:14px; font-weight:800; color:var(--ma2-text);">' + head + '</span>'
        + (desc ? '<span style="font-size:12.5px; color:var(--ma2-grey);">' + desc + '</span>' : '') + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(meta) + '</span></div>'
        + '<div style="display:grid; ' + GRID + ' align-items:center; padding:9px 18px; margin-bottom:6px; border-top:1px solid ' + W(6) + '; border-bottom:1px solid ' + W(6) + ';"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Bookmaker</span>' + colHeadAvatars(m, true) + '</div>'
        + rs.map(bkRow).join('') + '</div>';
    }).join('');
    const avgBox = !rows.length ? '' : (() => {
      const ms = rows.map(margin).filter(v => v != null);
      const side = x => { const ops = live.map(r => r[x + 'Open']).filter(v => v != null).map(v => +aOddsFmt(v)), nws = live.map(r => r[x + 'Now']).filter(v => v != null).map(v => +aOddsFmt(v));
        const o = avg(ops), n = avg(nws); return priceBox(n == null ? DASH : n.toFixed(2), oddsMove(o, n), 'Opening odd', o == null ? DASH : o.toFixed(2), { noEdge: true }); };
      return '<div class="ma2-avg" style="display:grid; ' + GRID + ' align-items:center; padding:10px 18px; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + W(6) + ';">'
        + '<span style="display:flex; flex-direction:column; gap:3px; min-width:0;"><span style="font-size:12.5px; font-weight:700; color:var(--ma2-text);">Average</span><span style="font-size:11.5px; color:var(--ma2-grey);">' + (novig ? 'Margin removed' : ms.length ? 'Margin ' + avg(ms).toFixed(1) + '%' : 'Margin ' + DASH) + '</span></span>' + side('a') + side('b') + '</div>';
    })();
    const steam = D.steam ? chip(D.steam.text, 'Most books moved the same way since opening', ' margin-left:auto;') : '';
    const empty = '<div class="ma2-empty" style="padding:14px 18px; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + W(6) + '; font-size:12.5px; color:var(--ma2-grey);">' + (loading ? 'Loading bookmaker odds…' : 'No bookmaker has odds for this match yet.') + '</div>';
    const booksCard = card(cardHead('Bookmakers', 'Sharp books carry low margins and move first; soft books carry higher margins and adjust later. The lifted box is the best price on that side. A row opens that bookmaker’s price movement.',
      'Price now, move since opening and opening odd at each bookmaker', steam)
      + '<div style="display:flex; flex-direction:column; gap:12px;">' + (groups ? groups + avgBox : empty) + '</div>');

    // (3) All markets: recorded markets only (odds.md Q10); Match Winner = the card's one book (aOddsCardTile)
    const cardT = typeof aOddsCardTile === 'function' ? aOddsCardTile(m, D) : null;
    const mkts = (typeof AODDS_MARKET_TILES !== 'undefined' ? AODDS_MARKET_TILES : []).filter(t => t.recorded).map(t => {
      const mw = t.name === 'Match Winner';
      const sd = (typeof AODDS_SIDES !== 'undefined' ? AODDS_SIDES : {})[t.name] || [typeof fhSurname === 'function' ? fhSurname(m.p1) : m.p1, typeof fhSurname === 'function' ? fhSurname(m.p2) : m.p2];
      const px = i => mw && cardT && cardT.now[i] != null ? cardT.now[i].toFixed(2) : DASH;
      const op = i => mw && cardT && cardT.open[i] != null ? cardT.open[i].toFixed(2) : DASH;
      const mv = i => mw && cardT && !cardT.closed ? oddsMove(cardT.open[i], cardT.now[i]) : { t: DASH, c: 'var(--ma2-quiet)' };
      const quoted = mw ? (cardT ? (typeof mxBookLabel === 'function' ? mxBookLabel(cardT.book) : cardT.book) : 'Not offered') : 'Not offered';
      return '<div class="seg ma2-row" data-market="' + esc(t.name) + '" style="display:grid; ' + GRID + ' align-items:center; margin:0 8px; padding:4px 10px; border-radius:10px; cursor:default; background:transparent;">'
        + '<span style="display:flex; flex-direction:column; gap:3px; min-width:0;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-text);">' + esc(t.name) + '</span><span style="font-size:11.5px; color:var(--ma2-grey);">' + esc(quoted) + '</span></span>'
        + [0, 1].map(i => priceBox(px(i), mv(i), 'Open', op(i), { side: sd[i] })).join('') + '</div>';
    }).join('');
    const mktCard = card(cardHead('All markets', 'Price on each side with the move and the opening odd. Match Winner shows the match card’s own bookmaker, the same price as the card and the header; only markets we record are listed.',
      'Price on each side, with the move and the opening odd')
      + '<div style="display:flex; flex-direction:column; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + W(6) + '; padding-bottom:10px; overflow:hidden;">'
      + '<div style="display:grid; ' + GRID + ' align-items:center; padding:9px 18px; border-bottom:1px solid ' + W(6) + '; margin-bottom:6px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Market</span>' + colHeadAvatars(m, false) + '</div>'
      + mkts + '</div>');
    return '<div class="ma2-odds" style="max-width:1040px; display:flex; flex-direction:column; gap:14px; margin-bottom:24px;">' + top + bestCard + booksCard + mktCard + '</div>' + oddsMv(m, D, mLbl);
  }
  // price movement box (the shared opened-box shell, max 980): bookmaker track, two player boxes with chart + tiles
  function oddsMv(m, D, mLbl) {
    const A = typeof _aOdds !== 'undefined' ? _aOdds : {};
    const r = A.mv ? D.rows.find(x => x.name === A.mv && !x.noData) : null;
    if (!r) return '';
    const t0 = r.first, t1 = r.end;
    const panel = (x, name, key, i) => {
      const s = r.series[x];
      const open = s.length ? s[0] : null;
      let hi = null, lo = null;
      aOddsDispSeries(s).forEach(p => { if (!hi || p[1] > hi[1]) hi = p; if (!lo || p[1] < lo[1]) lo = p; });
      const shown = r.stale ? r[x + 'Last'] : r[x + 'Now'];
      const mv = r.stale ? { t: '', c: 'var(--ma2-grey)' } : oddsMove(r[x + 'Open'] != null ? r[x + 'Open'] : open && open[1], r[x + 'Now']);
      return '<div class="ma2-mvp" data-side="' + x + '" style="display:flex; flex-direction:column; gap:14px; padding:18px; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + W(6) + '; min-width:0;">'
        + '<div style="display:flex; align-items:center; gap:12px;">' + av(name, key, 40, i ? RING_B(2) : RING_A(2), 12)
        + '<span style="display:flex; flex-direction:column; gap:3px; min-width:0; flex:1;"><span style="font-size:15px; font-weight:800; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(name) + '</span>'
        + '<span style="font-size:12.5px; color:var(--ma2-grey);">Opening odd ' + (open ? aOddsFmt(open[1]) : DASH) + '</span></span>'
        + '<span style="display:flex; flex-direction:column; gap:2px; align-items:flex-end;"><span style="' + MONO + ' font-size:20px; font-weight:700; color:var(--ma2-text);">' + fmt(shown) + '</span>'
        + '<span style="' + MONO + ' font-size:12px; font-weight:700; color:' + mv.c + ';">' + (r.stale ? 'last seen ' + aOddsWhen(r.pulled != null ? r.pulled : r.checkedAt != null ? r.checkedAt : r.lastTick, D.nowMs) : mv.t) + '</span></span></div>'
        + aOddsMvChart(s, i ? 'var(--ma2-text)' : 'var(--ma2-blue)', t0, t1) + dayBands(t0, t1)
        + '<div style="display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px;">'
        + tile('Opening odd', open ? aOddsFmt(open[1]) : DASH, open ? aOddsStamp(open[0]) : '', { left: true })
        + tile('Highest', hi ? aOddsFmt(hi[1]) : DASH, hi ? aOddsStamp(hi[0]) : '', { left: true })
        + tile('Lowest', lo ? aOddsFmt(lo[1]) : DASH, lo ? aOddsStamp(lo[0]) : '', { left: true }) + '</div></div>';
    };
    const tabs = D.rows.filter(x => !x.noData).map(x => ({ label: x.name, on: x.name === r.name, onclick: "aOddsOpenMv('" + esc(x.name).replace(/'/g, "\\'") + "')" }));
    const grp = r.group === 'sharp' ? 'Sharp book' : r.group === 'prediction' ? 'Prediction market' : 'Soft book';
    const body = '<div>' + track(tabs) + '</div><div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(360px,100%), 1fr)); gap:12px;">'
      + panel('a', m.p1, m.p1Key, 0) + panel('b', m.p2, m.p2Key, 1) + '</div>';
    return popShell({ max: 980, pad: '24px 24px 20px', onClose: 'aOddsCloseMv()', title: r.name + ' price movement',
      sub: grp + ' · ' + mLbl(r).replace(/^Margin/, 'margin') + ' · decimal odds, ' + (D.novig ? 'no-vig' : 'as quoted') + ', since ' + aOddsStamp(r.first), body });
  }
  // a day band under the chart, one per member-zone calendar day; a band narrower than 14% carries no date label
  function dayBands(t0, t1) {
    const span = t1 - t0;
    if (!(span > 0)) return '';
    const cuts = []; let prev = aOddsDM(t0);
    for (let t = t0 + 3600e3; t < t1; t += 3600e3) {
      if (aOddsDM(t) === prev) continue;
      let lo = t - 3600e3, hi = t;
      while (hi - lo > 60e3) { const mid = (lo + hi) / 2; if (aOddsDM(mid) === prev) lo = mid; else hi = mid; }
      prev = aOddsDM(t); const f = (hi - t0) / span; if (f > 0.02 && f < 0.98) cuts.push(hi);
    }
    const edges = [t0].concat(cuts, [t1]);
    return '<div class="ma2-days" style="margin:-6px 2.5% 0 8.75%; display:flex; gap:6px;">' + edges.slice(0, -1).map((from, i) => {
      const w = (edges[i + 1] - from) / span * 100;
      return '<div style="width:' + w.toFixed(2) + '%; display:flex; flex-direction:column; gap:5px;"><span style="height:1px; background:' + W(10) + ';"></span>'
        + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); text-align:center; white-space:nowrap;">' + (w < 14 ? '' : esc(aOddsDM((from + edges[i + 1]) / 2))) + '</span></div>';
    }).join('') + '</div>';
  }

  root.MA2 = { av, avIni, ini, help, cardHead, card, track, chip, tile, popShell, signed, RING_A, RING_B, W, MONO, DASH, esc };
  root.maOddsV2 = oddsBuild;
})(typeof window !== 'undefined' ? window : globalThis);
