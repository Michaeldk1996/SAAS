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
  // ring = a border ('2px solid …', inside the size) or SH_A / SH_B ('sh …': a 0 0 0 Npx ring outside it, as Form draws)
  function av(name, key, size, ring, fs) {
    const sh = ring && ring.indexOf('sh ') === 0;
    return '<span class="ma2-av" style="--s:' + size + 'px; --ring:' + (sh ? '0 solid transparent' : (ring || ('1px solid ' + W(14)))) + '; --rsh:' + (sh ? '0 0 0 ' + ring.slice(3) : 'none') + '; --fs:' + (fs || 12) + 'px;">'
      + (typeof aAvatarHtml === 'function' ? aAvatarHtml(name, key) : '') + '</span>';
  }
  const RING_A = w => (w || 1.5) + 'px solid var(--ma2-blue)', RING_B = w => (w || 1.5) + 'px solid var(--ma2-text)';
  const SH_A = w => 'sh ' + (w || 2) + 'px var(--ma2-blue)', SH_B = w => 'sh ' + (w || 2) + 'px var(--ma2-text)';
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
  // the site switch track; items {label, on, onclick, title}; o.inset = the picked edge as an inset ring (Odds), else a 1px border
  function track(items, o) {
    o = o || {};
    return '<div class="ma2-track" style="display:inline-flex; flex-wrap:wrap; gap:' + (o.gap || 2) + 'px; background:var(--ma2-track); border:1px solid ' + W(10) + '; border-radius:10px; padding:3px;">'
      + items.map(t => '<span class="seg ma2-seg"' + (t.title ? (o.aotip ? ' data-aotip="' + esc(esc(t.title)) + '"' : ' title="' + esc(t.title) + '"') : '') + ' role="button" tabindex="0" onclick="' + t.onclick + '"'
        + ' style="padding:' + (o.pad || '6px 12px') + '; border-radius:7px; font-size:12.5px; white-space:nowrap; cursor:pointer; font-weight:' + (t.on ? 700 : 600) + '; color:' + (t.on ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; background:' + (t.on ? 'var(--ma2-lifted)' : 'transparent') + '; ' + (o.inset ? 'box-shadow:inset 0 0 0 1px ' : 'border:1px solid ') + (t.on ? W(14) : 'transparent') + ';">' + esc(t.label) + '</span>').join('')
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
    return '<div class="ma2-pop-ov ma-pop-overlay" onclick="if(event.target===this){' + o.onClose + '}" style="position:fixed; inset:0 0 0 var(--sf-side, 0px); z-index:90; background:var(--ma2-scrim-2); display:flex; align-items:center; justify-content:center; padding:24px;">'
      + '<div data-ovpop="" class="ma2-pop" style="width:100%; max-width:' + (o.max || 860) + 'px; border-radius:16px; background:var(--ma2-card); border:1px solid ' + W(8) + '; box-shadow:var(--ma2-shadow-pop); padding:' + (o.pad || '24px 24px 16px') + '; display:flex; flex-direction:column; gap:18px; max-height:calc(100vh - 48px); overflow-y:auto; box-sizing:border-box;">'
      + '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px;"><div style="display:flex; align-items:center; gap:12px; min-width:0;">' + (o.avatar || '')
      + '<div style="display:flex; flex-direction:column; gap:5px; min-width:0;"><span style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="font-size:18px; font-weight:800; color:var(--ma2-text);">' + esc(o.title) + '</span>' + (o.help ? help(o.help) : '') + (o.chip || '') + '</span>'
      + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(o.sub || '') + '</span></div></div>'
      + '<span class="seg ma2-btn ma-pop-x" role="button" tabindex="0" onclick="' + o.onClose + '" style="height:30px; padding:0 12px; display:flex; align-items:center; border-radius:8px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; color:var(--ma2-text); cursor:pointer; font-size:12.5px; font-weight:700; flex:none;">Close</span></div>'
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
      { label: 'No-vig', on: novig, onclick: 'aOddsSetMode(true)', title: 'Margin stripped: prices and probabilities sum to 100%' }], { inset: true, aotip: true }) + '</div>';   // odds.md Q23: the shared tooltip

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
    const body = '<div>' + track(tabs, { inset: true }) + '</div><div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(360px,100%), 1fr)); gap:12px;">'
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

  // ===================================================================================================
  // MARKET EDGE (LOCKED 2026-11-22): Match winner = Price sensitivity + Return at flat 1% stake; Derived lines = Cover
  // rate by price band + Derived lines at today's price; opened boxes = the shared shell. Data = meModels (MarketEdgeCore
  // playerModel over the profile's priced rows, ruling B); every rate through the D2 gate (maRate / maGateBar).
  // "1% stake" = the live flat 1u: one unit = 1% of bankroll, so the figure is the same number, printed with %.
  const ME_W = 'color-mix(in srgb, var(--ma2-white) ', G6 = W(6);
  const meGrey = 'var(--ma2-grey)', meQuiet = 'var(--ma2-quiet)';
  const meUc = (v, dp) => { const f = Math.pow(10, dp == null ? 1 : dp), r = Math.round(Math.abs(v) * f + 1e-7); return !r ? meGrey : v > 0 ? 'var(--ma2-green)' : 'var(--ma2-red)'; };
  const SCOPES = [['l52', 'Last 52 weeks'], ['l24', 'Last 24 months'], ['career', 'Career']];
  const scopeLbl = S => (SCOPES.find(x => x[0] === S.meScope) || SCOPES[2])[1];
  const scopeTrack = S => track(SCOPES.map(t => ({ label: t[1], on: S.meScope === t[0], onclick: "meSet({meScope:'" + t[0] + "'})" })), { gap: 3 });
  const colHead = (cols, labels, rightFrom) => '<div style="display:grid; grid-template-columns:' + cols + '; gap:0 10px; align-items:center; padding:9px 18px; border-top:1px solid ' + G6 + '; border-bottom:1px solid ' + G6 + '; font-size:11.5px; font-weight:600; color:' + meGrey + '; white-space:nowrap;">'
    + labels.map((l, i) => '<span' + (i >= rightFrom ? ' style="text-align:right;"' : '') + '>' + l + '</span>').join('') + '</div>';
  const groupHead = t => '<span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); padding:14px 18px 6px;">' + t + '</span>';
  const meBar = (w, tick, col) => '<span style="position:relative; height:6px; background:' + W(7) + '; border-radius:3px; min-width:0;"><span style="position:absolute; left:0; top:0; bottom:0; width:' + Math.max(0, Math.min(100, w)).toFixed(1) + '%; background:' + col + '; border-radius:3px;"></span>'
    + (tick == null ? '' : '<span class="me-tick" style="position:absolute; left:' + Math.min(100, Math.max(0, tick)).toFixed(1) + '%; top:-3px; bottom:-3px; width:2px; background:var(--ma2-grey); border-radius:1px;"></span>') + '</span>';
  const meNoHist = M => '<div style="padding:12px 18px; font-size:12.5px; color:' + meGrey + ';">' + (M.state === 'loading' ? 'Loading…' : M.state === 'none' ? 'No history on file for this player.' : 'History unavailable — reopen the tab to retry.') + '</div>';
  const meMsg = t => '<div class="me-noprice" style="padding:28px 0; text-align:center; font-size:12.5px; color:' + meGrey + ';">' + t + '</div>';
  function mePlayerBox(E, i, sub, rightLbl, rightVal, rightFs, body) {
    const name = i ? E.m.p2 : E.m.p1, key = i ? E.m.p2Key : E.m.p1Key;
    return '<div class="me-pbox" data-side="' + (i ? 'b' : 'a') + '" style="background:var(--ma2-inner); border:1px solid ' + G6 + '; border-radius:12px; padding-bottom:8px; display:flex; flex-direction:column; min-width:0;">'
      + '<div style="display:flex; align-items:center; gap:12px; padding:18px 18px 16px;">' + av(name, key, 40, i ? RING_B(2) : RING_A(2), 12)
      + '<span style="display:flex; flex-direction:column; gap:3px; min-width:0; flex:1;"><span style="font-size:15px; font-weight:800; color:var(--ma2-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(name) + '</span><span style="font-size:12.5px; color:' + meGrey + ';">' + sub + '</span></span>'
      + '<span style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex:none;"><span style="font-size:11.5px; font-weight:600; color:' + meGrey + ';">' + rightLbl + '</span><span style="' + MONO + ' font-size:' + rightFs + 'px; font-weight:700; color:var(--ma2-white); white-space:nowrap;">' + rightVal + '</span></span></div>'
      + body + '</div>';
  }
  const RATE = (k, n, o) => (typeof maRateHtml === 'function' ? maRateHtml(k, n, o) : '');
  const BCOLS = 'minmax(92px,1fr) minmax(90px,1.4fr) 48px 56px 56px';
  function meBandsBox(E, i, M) {
    const k = i ? 'b' : 'a', core = root.MarketEdgeCore;
    let body;
    if (M.state !== 'ready') body = meNoHist(M);
    else body = [['fav', 'As favourite'], ['dog', 'As underdog']].map(g => groupHead(g[1]) + M.bands.filter(b => b.gk === g[0]).map(b => {
      const today = b.i === M.tb, n = b.n, click = n > 0;
      const bar = maGateBar(b.w, n, 'var(--ma2-text)'), edge = b.won == null || b.needs == null ? null : (b.won - b.needs) * 100;
      const lc = n ? 'var(--ma2-text)' : meQuiet;
      return '<div class="' + (click ? 'seg ma2-row me-row' : 'me-row-empty') + '"' + (click ? ' onclick="meSet({meBand:\'' + k + b.i + '\'})"' : '') + ' data-me-band="' + k + b.i + '"'
        + ' title="' + esc(today ? 'Today’s price band' : n ? b.w + ' won of ' + n : 'No priced matches') + '" style="display:grid; grid-template-columns:' + BCOLS + '; gap:0 10px; align-items:center; margin:0 8px; padding:8px 10px; border-radius:8px; background:' + (today ? 'var(--ma2-lifted)' : 'transparent') + '; box-shadow:inset 0 0 0 1px ' + (today ? W(14) : 'transparent') + '; cursor:' + (click ? 'pointer' : 'default') + ';">'
        + '<span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + lc + '; white-space:nowrap;">' + b.label + '</span>'
        + meBar(bar.w, n && b.needs != null ? b.needs * 100 : null, bar.color)
        + '<span style="' + MONO + ' font-size:12.5px; font-weight:700; text-align:right; color:' + lc + ';">' + RATE(b.w, n, { text: b.won == null ? null : Math.round(b.won * 100) + '%', nopct: DASH, note: 'title' }) + '</span>'
        + '<span class="me-edge" style="' + MONO + ' font-size:12px; font-weight:700; text-align:right; white-space:nowrap;">' + RATE(b.w, n, { text: edge == null ? null : meSg(edge, 1, 'pp'), nopct: DASH, note: 'title', color: edge == null ? meGrey : meUc(edge, 1) }) + '</span>'
        + '<span class="me-units" style="' + MONO + ' font-size:12px; font-weight:700; text-align:right; white-space:nowrap;">' + RATE(b.w, n, { text: n ? meSg(b.units, 1, '%') : null, nopct: DASH, note: 'title', color: n ? meUc(b.units, 1) : meGrey }) + '</span></div>';
    }).join('')).join('');
    const nP = M.state === 'ready' && M.priced ? M.priced.length : null, nB = nP ? M.priced.filter(r => r.book === 'B').length : 0;   // founder 2026-10-30: "12 of 174 on Bet365"
    return mePlayerBox(E, i, nP == null ? (M.state === 'loading' ? 'Loading…' : DASH) : nP.toLocaleString('en-US') + ' priced matches' + (nB ? ' · ' + nB.toLocaleString('en-US') + ' of ' + nP.toLocaleString('en-US') + ' on Bet365' : ''), 'Today', M.today == null ? DASH : M.today.toFixed(2), 20,
      colHead(BCOLS, ['Price band', 'Won against needed', 'Won', 'Edge', '1% stake'], 2) + body);
  }
  function meBookSplit(MM) {
    const ok = MM.filter(M => M.state === 'ready');
    if (!ok.length) return '';
    const P = ok.reduce((s, M) => s + M.book.P, 0), B = ok.reduce((s, M) => s + M.book.B, 0), A = ok.reduce((s, M) => s + (M.book.A || 0), 0);
    const last = ok.map(M => M.lastDate).filter(Boolean).sort().pop();   // modal-market-edge.md: the split + the latest match in scope
    return ' Closing prices: Pinnacle ' + P + (A ? ', Pinnacle (approx.) ' + A + ' (a snapshot, not a confirmed close)' : '') + ', Bet365 ' + B + (B ? ' (no Pinnacle close)' : '') + '. Latest match: ' + (last ? fhLongDate(last) : DASH) + '.';
  }
  function mePriceCard(E, MM) {
    const S = E.S, core = root.MarketEdgeCore;
    const tip = 'The bar is his win rate in the band, the grey tick is the win rate needed to break even at the band’s average price, and Edge is the gap between them. 1% stake is the return from backing him with 1% of bankroll on every match in the band. The lifted row is today’s price band; click a band for every match priced in it. ' + core.RET_SETTLE_NOTE + meBookSplit(MM);
    return card(cardHead('Price sensitivity', tip, 'Win rate against the break-even rate in each closing price band · ' + scopeLbl(S), '<div style="margin-left:auto;">' + scopeTrack(S) + '</div>')
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(460px,100%),1fr)); gap:16px; align-items:start;">' + meBandsBox(E, 0, MM[0]) + meBandsBox(E, 1, MM[1]) + '</div>', ' data-lfcard="" class="me-card me-price"');
  }
  function meChartCard(E, MM) {
    const S = E.S, core = root.MarketEdgeCore, names = [E.m.p1, E.m.p2];
    const ready = MM.every(M => M.state !== 'loading') && MM.some(M => M.state === 'ready');
    const ser0 = M => (M.state === 'ready' ? M.series : []);
    const C = ready ? core.chartModel(ser0(MM[0]), ser0(MM[1]), S.meScope) : null;
    const col = ['var(--ma2-blue)', 'var(--ma2-text)'];
    const legend = [0, 1].map(i => {
      const M = MM[i], has = M.state === 'ready' && M.priced.length > 0;
      const nTxt = M.state === 'ready' ? M.priced.length.toLocaleString('en-US') + ' priced' : M.state === 'loading' ? '' : DASH;
      return '<span style="display:flex; align-items:center; gap:8px;"><span style="width:16px; height:3px; border-radius:2px; background:' + col[i] + ';"></span><span style="font-size:13px; font-weight:700; color:var(--ma2-text);">' + esc(names[i]) + '</span><span style="' + MONO + ' font-size:10.5px; color:' + meQuiet + ';">' + nTxt + '</span>'
        + (has ? '<span style="' + MONO + ' font-size:14px; font-weight:700; color:' + meUc(M.units, 1) + ';">' + meSg(M.units, 1, 'u') + '</span>' : '') + '</span>';
    }).join('');
    let plot;
    if (!C) plot = '<div style="height:300px; display:flex; align-items:center; padding-left:64px; font-size:12.5px; color:' + meGrey + ';">' + (MM.some(M => M.state === 'loading') ? 'Loading…' : '') + '</div>';
    else {
      const H = C.H, pct = y => (y / H * 100).toFixed(2) + '%';
      const yl = C.grid.map(g => '<span style="position:absolute; right:0; top:' + pct(g.y) + '; transform:translateY(-50%); ' + MONO + ' font-size:11.5px; font-weight:500; color:' + meGrey + ';">' + (g.v === 0 ? '0' : meSg(g.v, 0, 'u')) + '</span>').join('');
      const ser = [C.a, C.b], order = [1, 0].filter(i => ser[i]);
      const pts = s => s.pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      const svg = '<svg class="me-chart-svg" viewBox="0 0 1000 200" preserveAspectRatio="none" style="width:100%; height:100%; display:block; overflow:visible;">'
        + '<rect x="0" y="' + C.zeroY.toFixed(1) + '" width="1000" height="' + Math.max(0, H - C.zeroY).toFixed(1) + '" style="fill:' + W(1.4) + '"></rect>'
        + C.grid.map(g => '<line x1="0" y1="' + g.y.toFixed(1) + '" x2="1000" y2="' + g.y.toFixed(1) + '" style="stroke:' + W(12) + '" stroke-dasharray="2 6" stroke-width="1" vector-effect="non-scaling-stroke"></line>').join('')
        + C.ticks.map(t => '<line x1="' + t.x.toFixed(1) + '" y1="0" x2="' + t.x.toFixed(1) + '" y2="200" style="stroke:' + W(4.5) + '" stroke-width="1" vector-effect="non-scaling-stroke"></line>').join('')
        + '<line x1="0" y1="' + C.zeroY.toFixed(1) + '" x2="1000" y2="' + C.zeroY.toFixed(1) + '" style="stroke:' + W(40) + '" stroke-width="1.5" vector-effect="non-scaling-stroke"></line>'
        + order.map(i => '<polyline data-me-series="' + (i ? 'b' : 'a') + '" points="' + pts(ser[i]) + '" fill="none" style="stroke:' + col[i] + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>').join('') + '</svg>';
      const ends = order.map(i => { const s = ser[i], p = s.pts[s.pts.length - 1], M = MM[i];
        return '<span style="position:absolute; left:calc(' + (p[0] / 10).toFixed(2) + '% - 4.5px); top:' + pct(p[1]) + '; width:9px; height:9px; margin-top:-4.5px; border-radius:50%; background:' + col[i] + '; box-shadow:0 0 0 3px var(--ma2-card);"></span>'
          + '<span style="position:absolute; left:calc(100% + 10px); top:' + pct(p[1]) + '; transform:translateY(-50%); ' + MONO + ' font-size:12px; font-weight:700; color:' + meUc(M.units, 1) + '; white-space:nowrap;">' + meSg(M.units, 1, 'u') + '</span>'; }).join('');
      const xl = C.ticks.map((t, k) => '<span style="position:absolute; left:' + (t.f * 100).toFixed(1) + '%; transform:' + (k === 0 ? 'none' : k === C.ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)') + '; ' + MONO + ' font-size:11.5px; color:' + meGrey + '; white-space:nowrap;">' + t.label + '</span>').join('');
      plot = '<div style="display:flex; gap:12px;"><div style="position:relative; width:52px; height:300px; flex:none;">' + yl + '</div>'
        + '<div style="position:relative; flex:1; min-width:0; height:300px; margin-right:60px;">' + svg
        + '<span style="position:absolute; left:8px; top:' + pct(C.zeroY) + '; transform:translateY(-50%); padding:2px 7px; border-radius:5px; background:var(--ma2-card); font-size:11.5px; font-weight:600; color:' + meGrey + ';">Break even</span>' + ends + '</div></div>'
        + '<div class="me-xlabels" style="margin:-6px 60px 0 64px; position:relative; height:16px;">' + xl + '</div>';
    }
    const tip = 'A flat 1% stake on every priced match, cumulative, oldest to newest, on one date axis shared by both players (a later career starts further right). The bright rule is break even. ' + core.RET_SETTLE_NOTE;
    return card('<div style="display:flex; align-items:flex-end; justify-content:space-between; gap:12px 20px; flex-wrap:wrap;">'
      + '<span style="display:flex; flex-direction:column; gap:5px; min-width:0;"><span style="display:flex; align-items:center; gap:10px;"><span style="font-size:18px; font-weight:800; color:var(--ma2-white);">Return at flat 1% stake</span>' + help(tip) + '</span>'
      + '<span style="font-size:12.5px; color:' + meGrey + '; line-height:1.4;">Cumulative return at closing odds, oldest to newest · ' + scopeLbl(S) + '</span></span>'
      + '<div style="display:flex; align-items:center; gap:22px; flex-wrap:wrap;">' + legend + '</div></div>' + plot, ' data-lfcard="" class="me-card me-chart"');
  }
  const COV_LINES = [0, 1, 3, 4, 5], COVCOLS = 'minmax(92px,1fr) minmax(90px,1.4fr) 48px 56px';
  function meCoverBox(E, i, M, li) {
    const k = i ? 'b' : 'a', core = root.MarketEdgeCore;
    const L = M.state === 'ready' ? M.lines : null, def = L ? L.rows[li] : null;
    let body = '', sub = M.state === 'loading' ? 'Loading…' : DASH, allRate = DASH, allW = null;
    if (M.state !== 'ready') body = meNoHist(M);
    else if (!def) body = meMsg(root.ME_NOPRICE_MSG || 'Derived lines need today’s price.');
    else {
      const all = L.all, aC = all.filter(def.fn).length, aR = maRate(aC, all.length, {});
      sub = esc(def.label); allRate = RATE(aC, all.length, { note: 'title', color: 'var(--ma2-white)' }) || DASH;
      allW = aR.mode === 'full' || aR.mode === 'small' ? aC / all.length * 100 : null;
      body = [['fav', 'As favourite'], ['dog', 'As underdog']].map(g => groupHead(g[1]) + core.BANDS.map((b, bi) => [b, bi]).filter(x => x[0].gk === g[0]).map(([b, bi]) => {
        const rs = all.filter(r => core.bandOf(r.price) === bi), n = rs.length, c = rs.filter(def.fn).length;
        const today = bi === L.tb, click = n > 0 && M.bands[bi] && M.bands[bi].n > 0, lc = n ? 'var(--ma2-text)' : meQuiet;
        const bar = maGateBar(c, n, 'var(--ma2-text)');
        return '<div class="' + (click ? 'seg ma2-row me-row' : 'me-row-empty') + '"' + (click ? ' onclick="meSet({meBand:\'' + k + bi + '\'})"' : '') + ' data-me-cov="' + k + bi + '" title="' + esc(today ? 'Today’s price band' : n ? c + ' covered of ' + n : 'No priced matches') + '"'
          + ' style="display:grid; grid-template-columns:' + COVCOLS + '; gap:0 10px; align-items:center; margin:0 8px; padding:8px 10px; border-radius:8px; background:' + (today ? 'var(--ma2-lifted)' : 'transparent') + '; box-shadow:inset 0 0 0 1px ' + (today ? W(14) : 'transparent') + '; cursor:' + (click ? 'pointer' : 'default') + ';">'
          + '<span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + lc + '; white-space:nowrap;">' + b.label + '</span>' + meBar(bar.w, allW, bar.color)
          + '<span style="' + MONO + ' font-size:12.5px; font-weight:700; text-align:right; color:' + lc + ';">' + (RATE(c, n, { nopct: DASH, note: 'title' }) || DASH) + '</span>'
          + '<span style="' + MONO + ' font-size:12px; color:' + meGrey + '; text-align:right; white-space:nowrap;">' + (n ? c + '/' + n : DASH) + '</span></div>';
      }).join('')).join('');
    }
    return mePlayerBox(E, i, sub, 'All matches', allRate, 20, colHead(COVCOLS, ['Price band', 'Covered against all', 'Covered', 'Matches'], 2) + body);
  }
  function meCoverCard(E, MM) {
    const S = E.S, core = root.MarketEdgeCore, fmt = core.matchFormat(E.m), noPrice = MM[0].today == null && MM[1].today == null;
    const li = COV_LINES[S.meCov || 0] != null ? COV_LINES[S.meCov || 0] : 0;
    const ref = MM.find(M => M.state === 'ready' && M.lines);
    const defs = core.lineDefs(ref ? ref.lines.fav : true, '');
    const lineTrack = '<div style="align-self:flex-start; max-width:100%;">' + track(COV_LINES.map((x, j) => ({ label: defs[x] ? defs[x][0] : '', on: x === li, onclick: 'meSet({meCov:' + j + '})' })), { gap: 3 }) + '</div>';
    const body = !fmt.bo3 ? '<div class="me-nobo3" data-me-format="' + (fmt.reason || 'unknown') + '">' + meMsg(root.ME_BO3_MSG || 'Derived lines cover best-of-3 matches only.') + '</div>'
      : noPrice ? meMsg('Derived lines need today’s price.')
      : lineTrack + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(460px,100%),1fr)); gap:16px; align-items:start;">' + meCoverBox(E, 0, MM[0], li) + meCoverBox(E, 1, MM[1], li) + '</div>';
    const tip = 'The bar is the share of matches priced in the band where the line covered, and the grey tick is the same line over all his priced matches. The lifted row is today’s price band. Click a band for its matches.';
    return card(cardHead('Cover rate by price band', tip, 'How often the picked line covered in each closing price band · ' + scopeLbl(S), '<div style="margin-left:auto;">' + scopeTrack(S) + '</div>') + body, ' data-lfcard="" class="me-card me-cover"');
  }
  const LCOLS = 'minmax(120px,1fr) minmax(90px,1.4fr) 52px 60px 52px';
  function meLinesBox(E, i, M) {
    const core = root.MarketEdgeCore, k = i ? 'b' : 'a';
    const L = M.state === 'ready' ? M.lines : null;
    const pxCtx = typeof fhLinePxCtx === 'function' ? fhLinePxCtx(E.m, () => { if (typeof _me !== 'undefined' && _me && _me.m === E.m) meRender(); }) : null;
    let body;
    if (M.state !== 'ready') body = meNoHist(M);
    else if (!L) body = meMsg('Derived lines need today’s price.');
    else {
      const fam = r => /wins match|wins set/i.test(r.label) ? 0 : /[+−-]\s?\d|handicap/i.test(r.label) && !/over|under|games$/i.test(r.label.replace(/[+−-]\s?\d+(\.\d+)?\s*games?/i, '')) ? 1 : 2;
      const groups = [['Result', []], ['Handicap', []], ['Totals & tiebreaks', []]];
      L.rows.forEach(r => groups[/wins match|wins set/i.test(r.label) ? 0 : /^(over|under)|tiebreak/i.test(r.label) ? 2 : 1][1].push(r));
      body = groups.filter(g => g[1].length).map(g => groupHead(g[0]) + g[1].map(r => {
        const aR = maRate(r.aC, r.aN, {}), bR = maRate(r.bC, r.bN, {});
        const d = r.diff, dSmall = aR.mode === 'small' || bR.mode === 'small';
        const bThin = !(r.bN >= core.ME_THIN_FLOOR);
        const bar = maGateBar(r.bC, r.bN, 'var(--ma2-text)');
        const pxTxt = pxCtx && typeof fhLinePxCell === 'function' ? String(fhLinePxCell({ name: r.label, px: r.px ? (r.px.who === 'self' ? Object.assign({}, r.px, { who: i ? 'B' : 'A' }) : r.px) : null }, pxCtx)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
        const tip = r.label + ': in band ' + r.bC + ' of ' + r.bN + ', all ' + r.aC + ' of ' + r.aN + (pxTxt ? ' · ' + pxTxt : '');
        return '<div class="seg ma2-row me-row" data-nopanel="" onclick="meSet({meLine:\'' + k + '|' + r.li + '\', meLineScope:\'all\'})" data-me-line="' + k + '|' + r.li + '" title="' + esc(tip) + '"'
          + ' style="display:grid; grid-template-columns:' + LCOLS + '; gap:0 10px; align-items:center; cursor:pointer; margin:0 8px; padding:8px 10px; border-radius:8px; background:transparent;">'
          + '<span style="font-size:12.5px; font-weight:600; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(r.label) + '</span>'
          + meBar(bar.w, aR.mode === 'full' || aR.mode === 'small' ? r.aC / r.aN * 100 : null, bar.color)
          + '<span style="' + MONO + ' font-size:12px; font-weight:400; color:' + meGrey + '; text-align:right; white-space:nowrap;">' + (RATE(r.aC, r.aN, { text: r.aPct == null ? null : r.aPct + '%', nopct: DASH, note: 'title', color: meGrey }) || DASH) + '</span>'
          + '<span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + (bThin ? meQuiet : 'var(--ma2-white)') + '; text-align:right; white-space:nowrap;">' + (bThin ? DASH : RATE(r.bC, r.bN, { text: r.bPct == null ? null : r.bPct + '%', nopct: DASH, note: 'title', color: 'var(--ma2-white)' })) + '</span>'
          + '<span style="' + MONO + ' font-size:12px; font-weight:700; text-align:right; white-space:nowrap; color:' + (d == null ? meGrey : dSmall ? meGrey : meUc(d, 0)) + ';">' + (d == null ? '' : meSg(d, 0, '')) + '</span></div>';
      }).join('')).join('');
    }
    const sub = L ? (L.inBand.length + ' in today’s band · ' + L.all.length + ' priced matches') : M.state === 'loading' ? 'Loading…' : DASH;
    return mePlayerBox(E, i, sub, 'Today’s band', L && L.tb >= 0 ? core.BANDS[L.tb].label : DASH, 15, colHead(LCOLS, ['Line', 'In band against all', 'All', 'In band', 'Diff'], 2) + body);
  }
  function meLinesCard(E, MM) {
    const S = E.S, core = root.MarketEdgeCore, fmt = core.matchFormat(E.m), noPrice = MM[0].today == null && MM[1].today == null;
    const body = !fmt.bo3 ? '<div class="me-nobo3" data-me-format="' + (fmt.reason || 'unknown') + '">' + meMsg('Derived lines cover best-of-3 matches only.') + '</div>'
      : noPrice ? meMsg('Derived lines need today’s price.')
      : '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(460px,100%),1fr)); gap:16px; align-items:start;">' + meLinesBox(E, 0, MM[0]) + meLinesBox(E, 1, MM[1]) + '</div>';
    const tip = 'The bar is the cover rate in today’s price band, the grey tick is the same line over all his priced matches, and Diff is the gap between them in points. Coverage comes from set scores, not settled line markets, so no yield is shown. Click a line for the matches behind it. Each row’s hover names today’s line price.';
    return card(cardHead('Derived lines at today’s price', tip, 'How often each line covered when he was priced in today’s band, against all his priced matches · ' + scopeLbl(S)) + body, ' data-lfcard="" class="me-card me-lines"');
  }
  function maMarketEdgeV2(m) {
    const E = meStateFor(m), S = E.S, MM = meModels(E);
    const view = track([['winner', 'Match winner'], ['lines', 'Derived lines']].map(t => ({ label: t[1], on: S.meView === t[0], onclick: "meSet({meView:'" + t[0] + "'})" })), { gap: 3 });
    const cards = S.meView === 'winner' ? mePriceCard(E, MM) + meChartCard(E, MM) : meCoverCard(E, MM) + meLinesCard(E, MM);
    const idNote = [0, 1].map(i => { const n = E.data && E.data[i] && E.data[i].idHidden; return n ? esc(i ? m.p2 : m.p1) + ': ' + n + ' ' + (n === 1 ? 'row' : 'rows') + ' hidden: identity unverified' : ''; }).filter(Boolean).join(' · ');
    return '<div class="me-pane" style="color:var(--ma2-text);"><div style="display:flex; flex-direction:column; gap:14px; max-width:1040px; margin:0 auto;">'
      + '<div style="display:flex; align-items:center; gap:10px 16px; flex-wrap:wrap;">' + view + '</div>' + cards
      + (idNote ? '<div class="me-id-hidden" style="font-size:12px; color:' + meGrey + ';">' + idNote + '</div>' : '') + '</div></div>';
  }
  // ---- the opened boxes (`me.pop` band, `me.linePop` line): one shared design ----
  const BAND_TCOLS = '58px 8px minmax(0,1.3fr) minmax(0,1fr) 32px minmax(0,0.9fr) 46px 42px 58px';
  const LINE_TCOLS = '58px 8px minmax(0,1.3fr) minmax(0,1fr) minmax(0,0.9fr) 46px 92px';
  function meListBox(rows, cols, labels, rightFrom, cell) {
    return '<div style="overflow-x:auto;"><div style="min-width:620px; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + G6 + '; padding-bottom:8px;">'
      + '<div style="display:grid; grid-template-columns:' + cols + '; gap:0 10px; align-items:center; padding:9px 18px; border-bottom:1px solid ' + G6 + '; margin-bottom:6px; font-size:11.5px; font-weight:600; color:' + meGrey + '; white-space:nowrap;">'
      + labels.map((l, i) => '<span' + (i >= rightFrom ? ' style="text-align:right;"' : '') + '>' + l + '</span>').join('') + '</div>'
      + rows.map(cell).join('') + '</div></div>';
  }
  const meRes = won => '<span style="width:8px; height:8px; border-radius:50%; background:' + (won ? 'var(--ma2-green)' : 'var(--ma2-red)') + ';"></span>';
  function meRowHtml(E, r, name, key, cols, cells) {
    E.rowMap[r.mid] = { r, name, key };
    const on = E.selMid === r.mid;
    return '<div class="seg ma2-row" data-me-row="' + r.mid + '" onclick="meOpenRow(\'' + r.mid + '\')" style="display:grid; grid-template-columns:' + cols + '; gap:0 10px; align-items:center; margin:0 8px; padding:8px 10px; border-radius:8px; background:' + (on ? 'var(--ma2-lifted)' : 'transparent') + '; cursor:pointer;">' + cells + '</div>';
  }
  const tcell = (t, st) => '<span style="' + (st || '') + ' white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + t + '</span>';
  const ME_SC = r => r.sets ? r.sets.map(x => x[0] + '–' + x[1]).join(' ') : DASH;
  function meBandPopV2(E, MM) {
    const k = E.S.meBand[0], i = k === 'b' ? 1 : 0, bi = +E.S.meBand.slice(1), M = MM[i];
    if (!M || M.state !== 'ready' || !M.bands[bi] || !M.bands[bi].n) return '';
    const b = M.bands[bi], core = root.MarketEdgeCore, name = i ? E.m.p2 : E.m.p1, key = String(i ? E.m.p2Key : E.m.p1Key);
    const idh = E.data && E.data[i] && E.data[i].idHidden;
    const sub = [b.gk === 'fav' ? 'As favourite' : 'As underdog', scopeLbl(E.S), 'closing odds', meBookNote(b.rows), idh ? idh + ' ' + (idh === 1 ? 'row' : 'rows') + ' hidden: identity unverified' : ''].filter(Boolean).join(' · ');
    const edge = b.won == null || b.needs == null ? null : (b.won - b.needs) * 100;
    const gate = (txt, col) => { const R = maRate(b.w, b.n, { text: txt, nopct: DASH }); return { t: R.txt, c: R.mode === 'full' ? col : meGrey }; };
    const won = gate(b.won == null ? null : (Math.round(b.won * 1000) / 10).toFixed(1) + '%', 'var(--ma2-text)'), ed = gate(edge == null ? null : meSg(edge, 1, 'pp'), edge == null ? meGrey : meUc(edge, 1)),
      un = gate(meSg(b.units, 1, '%'), meUc(b.units, 1));
    const tiles = '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr)); gap:8px;">'
      + tile('Record', b.w + '–' + b.l, b.n.toLocaleString('en-US') + ' priced', { left: true, bg: 'var(--ma2-inner)' })
      + tile('Won', won.t, 'needs ' + (b.needs == null ? DASH : (Math.round(b.needs * 1000) / 10).toFixed(1) + '%'), { left: true, bg: 'var(--ma2-inner)', color: won.c })
      + tile('Edge', ed.t, 'Won − needs', { left: true, bg: 'var(--ma2-inner)', color: ed.c })
      + tile('At flat 1% stake', un.t, 'yield ' + (b.yield == null ? DASH : meSg(b.yield * 100, 1, '%')), { left: true, bg: 'var(--ma2-inner)', color: un.c }) + '</div>'
      // D2 (modal-analysis.md): a greyed 5–9 figure carries its "small sample" note
      + (maRate(b.w, b.n, {}).mode === 'small' ? '<span style="font-size:11.5px; color:var(--ma2-grey);">Grey = small sample (5–9 matches) · n=' + b.n + '</span>' : '');
    const list = meListBox(b.rows, BAND_TCOLS, ['Date', '', 'Opponent', 'Event', 'Rd', 'Score', 'Price', 'Opp', 'P&amp;L'], 6, r => meRowHtml(E, r, name, key, BAND_TCOLS,
      tcell(meDMY(r.date), MONO + ' font-size:11.5px; color:' + meGrey + ';') + meRes(r.won) + tcell(esc(r.opp), 'font-size:12.5px; font-weight:600; color:var(--ma2-text);')
      + tcell(esc(typeof sfEventName === 'function' ? sfEventName(r.tourn) : r.tourn), 'font-size:12px; color:' + meGrey + ';') + tcell(esc(r.round || DASH), MONO + ' font-size:11.5px; color:' + meGrey + ';')
      + tcell(ME_SC(r), MONO + ' font-size:11.5px; color:var(--ma2-soft);') + '<span title="' + esc(fhSrcTitle(r)) + '" style="' + MONO + ' font-size:12px; font-weight:700; text-align:right; color:var(--ma2-text);">' + fhOdd(r.price) + '</span>'
      + '<span style="' + MONO + ' font-size:12px; text-align:right; color:' + meGrey + ';">' + fhOdd(r.oppPrice) + '</span>'
      + '<span style="' + MONO + ' font-size:12px; font-weight:700; text-align:right; color:' + meUc(core.plCents(r) / 100, 2) + ';">' + meSg(core.plCents(r) / 100, 2, '%') + '</span>'));
    const helpTxt = 'Every match with a closing price in this band, newest first. Flat 1% stake. Click a match for its stats. ' + core.RET_SETTLE_NOTE;
    return popShell({ onClose: 'meSet({meBand:null})', title: name + ' · priced ' + b.label, help: helpTxt, chip: bi === M.tb ? chip('Today’s band') : '', sub, body: tiles + list });
  }
  function meLinePopV2(E, MM) {
    const [k, liS] = E.S.meLine.split('|'), i = k === 'b' ? 1 : 0, li = +liS, M = MM[i];
    if (!M || M.state !== 'ready' || !M.lines || !M.lines.rows[li]) return '';
    const L = M.lines, row = L.rows[li], core = root.MarketEdgeCore, name = i ? E.m.p2 : E.m.p1, key = String(i ? E.m.p2Key : E.m.p1Key);
    const sc = E.S.meLineScope === 'band' ? 'band' : 'all';
    const list = (sc === 'band' ? L.inBand : L.all).slice().reverse();
    const n = list.length, cov = list.filter(row.fn).length, rateOk = n > 0 && n >= core.ME_THIN_FLOOR;
    const allN = L.all.length, allC = L.all.filter(row.fn).length, allOk = allN > 0 && allN >= core.ME_THIN_FLOOR;
    const allPct = allOk ? Math.round(allC / allN * 100) : null, rate = rateOk ? Math.round(cov / n * 100) : null;
    const vs = sc === 'band' && rate != null && allPct != null ? rate - allPct : null;
    const R = maRate(cov, n, { text: rate == null ? null : rate + '%', nopct: DASH });
    const seg = '<div style="align-self:flex-start;">' + track([['all', 'All matches'], ['band', 'In today’s band']].map(t => ({ label: t[1], on: sc === t[0], onclick: "meSet({meLineScope:'" + t[0] + "'})" })), { gap: 3 }) + '</div>';
    const tiles = '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr)); gap:8px;">'
      + tile('Matches', String(n), sc === 'band' ? 'Priced in band' : 'All priced', { left: true, bg: 'var(--ma2-inner)' })
      + tile('Covered', cov + ' of ' + n, (n - cov) + ' not covered', { left: true, bg: 'var(--ma2-inner)' })
      + tile('Rate', R.txt, sc === 'band' ? 'All matches ' + (allPct == null ? DASH : allPct + '%') : 'This line', { left: true, bg: 'var(--ma2-inner)', color: R.mode === 'full' ? 'var(--ma2-text)' : meGrey })
      + tile('Against all', vs == null ? DASH : meSg(vs, 0, 'pp'), 'In band − all', { left: true, bg: 'var(--ma2-inner)', color: vs == null ? meGrey : meUc(vs, 0) }) + '</div>';
    const sub = (sc === 'band' ? 'Priced ' + core.BANDS[L.tb].label + ' (today’s band)' : 'All priced matches') + ' · ' + scopeLbl(E.S) + ' · best of 3 · closing odds';
    const tbl = meListBox(list, LINE_TCOLS, ['Date', '', 'Opponent', 'Event', 'Score', 'Price', 'Line'], 5, r => { const c = row.fn(r);
      return meRowHtml(E, r, name, key, LINE_TCOLS, tcell(meDMY(r.date), MONO + ' font-size:11.5px; color:' + meGrey + ';') + meRes(r.won) + tcell(esc(r.opp), 'font-size:12.5px; font-weight:600; color:var(--ma2-text);')
        + tcell(esc(typeof sfEventName === 'function' ? sfEventName(r.tourn) : r.tourn), 'font-size:12px; color:' + meGrey + ';') + tcell(ME_SC(r), MONO + ' font-size:11.5px; color:var(--ma2-soft);')
        + '<span title="' + esc(fhSrcTitle(r)) + '" style="' + MONO + ' font-size:12px; font-weight:700; text-align:right; color:var(--ma2-text);">' + fhOdd(r.price) + '</span>'
        + '<span style="font-size:12px; font-weight:700; text-align:right; color:' + (c ? 'var(--ma2-green)' : 'var(--ma2-red)') + ';">' + (c ? 'Covered' : 'Not covered') + '</span>'); });
    return popShell({ onClose: 'meSet({meLine:null})', title: name + ' · ' + row.label, help: 'Coverage is read from set scores, not a settled line market. Dot = match result. Click a match for its stats.', sub, body: seg + tiles + tbl });
  }
  root.maMarketEdgeV2 = maMarketEdgeV2;
  root.maMeBandPopV2 = meBandPopV2;
  root.maMeLinePopV2 = meLinePopV2;

  // ===================================================================================================
  // FORM (LOCKED 2026-11-22): filter row → Form card (+ the 1a form data box) → Hot lines → Recent matches.
  // Data = fhFormPlayer (the live Form model: Form's own match list, the Database join's prices, the D2 gate, the live
  // hot-line rule fhScoreLines / FH_HOT_MIN_ELIGIBLE); every row opens the one Match Stats sheet (fhOpenSheet).
  const btn = (label, onclick, o) => { o = o || {};
    return '<span class="seg ma2-btn2"' + (onclick ? ' role="button" tabindex="0" onclick="' + onclick + '"' : '') + ' style="' + (o.style || '') + 'flex:none; height:34px; display:inline-flex; align-items:center; padding:0 14px; border-radius:9px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; font-size:12.5px; font-weight:600; color:' + (o.color || 'var(--ma2-text)') + '; white-space:nowrap; cursor:' + (onclick ? 'pointer' : 'default') + ';">' + esc(label) + '</span>'; };
  const vr = '<span style="flex:none; width:1px; height:16px; background:' + W(10) + ';"></span>';
  // Form's own head: title + scope on one line, the button at the right
  function headRow(title, helpText, scope, right) {
    return '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap;">' + esc(title) + '</span>'
      + (helpText ? help(helpText) : '') + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(scope) + '</span>' + (right ? '<span style="margin-left:auto; display:flex;">' + right + '</span>' : '') + '</div>';
  }
  const fcard = inner => '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px; display:flex; flex-direction:column; gap:18px; min-width:0;">' + inner + '</div>';
  const pbox = (inner, extra) => '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; display:flex; flex-direction:column; min-width:0;' + (extra || '') + '">' + inner + '</div>';
  const pid = P => '<div style="display:flex; align-items:center; gap:12px; min-width:0;">' + av(P.name, P.key, 40, P.idx ? SH_B() : SH_A(), 12)
    + '<div style="min-width:0; display:flex; flex-direction:column; gap:2px;">';
  function formBars(P) {
    const n = P.win.length, bars = P.win.slice().reverse().map((r, i) => {
      const c = r.won ? 'var(--ma2-green)' : 'var(--ma2-red)', lo = i < 2, hi = !lo && i > n - 3;
      const pos = lo ? 'left:0;' : hi ? 'right:0;' : 'left:50%; transform:translateX(-50%);';
      const px = r.price != null ? fhOdd(r.price) : DASH, elo = r.oppElo && r.oppElo.v != null ? 'Elo ' + r.oppElo.v : 'Elo ' + DASH;
      return '<div class="ma2-fbar" onclick="fhOpenSheet(\'' + esc(r.mid) + '\')" style="flex:1; min-width:0; position:relative; padding:4px 0; cursor:pointer;">'
        + '<div style="display:flex; flex-direction:column; align-items:center; gap:6px;"><div style="width:100%; height:6px; border-radius:3px; background:' + c + ';"></div>'
        + '<span title="' + esc(fhSrcTitle(r)) + '" style="' + MONO + ' font-size:9px; color:var(--ma2-grey); white-space:nowrap; height:11px;">' + (n > 12 ? '' : px) + '</span></div>'
        + '<div class="ma2-ftip" style="position:absolute; bottom:26px; ' + pos + ' z-index:30; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:10px; padding:10px 12px; flex-direction:column; gap:4px; align-items:flex-start; text-align:left; white-space:nowrap; box-shadow:0 12px 32px color-mix(in srgb, var(--ma2-ground) 55%, transparent); pointer-events:none;">'
        + '<span style="display:flex; align-items:baseline; gap:7px;"><span style="' + MONO + ' font-size:11.5px; font-weight:700; color:' + c + ';">' + (r.won ? 'W' : 'L') + '</span><span style="font-size:12.5px; font-weight:600; color:var(--ma2-text);">v ' + esc(fhOppFmt(r.opp)) + '</span>'
        + '<span class="fh-tip-elo" title="' + esc(fhEloText(r.oppElo)) + '" style="' + MONO + ' font-size:11px; color:var(--ma2-grey);">' + elo + '</span></span>'
        + '<span style="font-size:11.5px; color:var(--ma2-grey);">' + esc(r.tourn + ' · ' + r.round + ' · ' + fhDDMM(r.date)) + '</span>'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-soft);">' + esc(fhFormTipScore(r)) + '</span>'
        + '<span style="display:flex; align-items:baseline; gap:7px; font-size:11.5px; color:var(--ma2-grey);">Closing price<span style="' + MONO + ' font-weight:700; color:var(--ma2-text);">' + px + '</span></span></div></div>';
    });
    const empty = '<div aria-hidden="true" style="flex:1; min-width:0; padding:4px 0;"><div style="display:flex; flex-direction:column; align-items:center; gap:6px;"><div style="width:100%; height:6px; border-radius:3px; background:' + W(7) + ';"></div><span style="height:11px;"></span></div></div>';
    if (P.DWIN == null) while (bars.length < P.NWIN) bars.unshift(empty);
    if (!bars.length) bars.push(empty.replace('flex:1;', 'flex:1; visibility:hidden;'));
    return bars.join('');
  }
  function formBox(P) {
    const exp = P.mktOk ? P.expW.toFixed(1) : DASH, nC = P.mktOk ? P.np : P.n;
    const dW = P.mktOk ? signed(P.winsP - P.expW, 1) : DASH;
    const mktTip = [P.mktOk ? 'Against the market on ' + P.np + ' of ' + P.n + ' priced' : '', P.srcNote ? 'Closing odds: ' + P.srcNote : '', P.mktOk && typeof fhRetNote === 'function' ? fhRetNote() : ''].filter(Boolean).join(' · ');
    const thin = P.thin ? '<span style="font-size:12.5px; color:var(--ma2-grey);">' + esc((P.n === 0 ? 'No matches' : 'Only ' + P.cnt) + ' with these filters, too few for the market figures') + '</span>' : '';
    return '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding:20px; display:flex; flex-direction:column; gap:18px; min-width:0;">'
      + pid(P) + (typeof fhNameLink === 'function' ? fhNameLink(P.name, P.key, 'font-size:15px; font-weight:800; color:var(--ma2-text);') : '<span style="font-size:15px; font-weight:800;">' + esc(P.name) + '</span>')
      + '<span title="' + esc(P.cov || '') + '" style="font-size:12.5px; color:var(--ma2-grey);">Market expected ' + exp + ' wins in ' + nC + '</span></div>'
      + '<div style="flex:none; margin-left:auto; display:flex; flex-direction:column; align-items:flex-end; gap:1px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Record</span>'
      + '<span style="' + MONO + ' font-size:26px; font-weight:700; line-height:1.1; color:' + (P.n ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + '; white-space:nowrap;">' + (P.n ? P.wins + '–' + (P.n - P.wins) : DASH) + '</span></div></div>'
      + thin
      + '<div style="display:flex; flex-direction:column; gap:8px;"><div style="display:flex; gap:4px; width:100%;">' + formBars(P) + '</div>'
      + '<div style="display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:4px 12px;"><span' + (mktTip ? ' title="' + esc(mktTip) + '"' : '') + ' style="display:inline-flex; align-items:baseline; gap:7px; font-size:12.5px; color:var(--ma2-grey);">Against the market'
      + '<span data-ma-gate="' + (P.mktOk ? (P.mktSmall ? 'small' : 'full') : 'nopct') + '" style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + (!P.mktOk ? 'var(--ma2-quiet)' : P.mktSmall ? 'var(--ma2-grey)' : 'var(--ma2-text)') + ';">' + dW + '</span></span>'
      + '<span style="font-size:11.5px; color:var(--ma2-grey);">Oldest to newest</span></div></div></div>';
  }
  // 1a: one line per figure, the stronger figure white, the other grey, a missing one quiet; help = the row's hover title
  function formDataRows(A, B, defs) {
    const cmp = (x, y, dir) => { if (x.v == null || y.v == null) return null; const d = x.v - y.v; if (Math.abs(d) < 1e-9) return 'tie'; return (dir === 'high' ? d > 0 : d < 0) ? 'a' : 'b'; };
    const G = 'display:grid; grid-template-columns:minmax(0,1fr) minmax(110px,180px) minmax(0,1fr); gap:16px; align-items:baseline;';
    return defs.map(d => {
      const x = A.metrics[d[0]], y = B.metrics[d[0]], lead = cmp(x, y, d[3]);
      const col = (me, who) => me.v == null ? 'var(--ma2-quiet)' : me.small ? 'var(--ma2-grey)' : (lead && lead !== 'tie' && lead !== who) ? 'var(--ma2-grey)' : 'var(--ma2-text)';
      const note = me => '<span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">' + esc([me.aside, me.sub].filter(Boolean).join(' ')) + '</span>';
      const fig = (me, who) => '<span' + (me.small ? ' data-ma-gate="small"' : '') + (me.ret && typeof fhRetNote === 'function' ? ' title="' + esc(fhRetNote()) + '"' : '') + ' style="' + MONO + ' font-size:15px; font-weight:700; color:' + col(me, who) + '; white-space:nowrap;">' + esc(me.val) + '</span>';
      return '<div class="ma2-row" title="' + esc(d[2]) + '" style="' + G + ' margin:0 8px; padding:8px 10px; border-radius:8px;">'
        + '<span style="display:flex; align-items:baseline; justify-content:flex-end; flex-wrap:wrap-reverse; gap:2px 8px; min-width:0;">' + note(x) + fig(x, 'a') + '</span>'
        + '<span style="font-size:12.5px; font-weight:600; color:var(--ma2-soft); text-align:center;">' + esc(d[1]) + '</span>'
        + '<span style="display:flex; align-items:baseline; flex-wrap:wrap; gap:2px 8px; min-width:0;">' + fig(y, 'b') + note(y) + '</span></div>';
    }).join('');
  }
  function hotBox(P, S, m) {
    const H = P.hot, head = '<div style="display:flex; align-items:center; gap:12px; padding:18px 18px 16px; min-width:0;">' + av(P.name, P.key, 40, P.idx ? SH_B() : SH_A(), 12)
      + '<div style="min-width:0; display:flex; flex-direction:column; gap:2px;"><span style="font-size:15px; font-weight:800; color:var(--ma2-text);">' + esc(P.name) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(H.hdr.win + ' · ' + H.hdr.surf + ' · ' + H.hdr.role) + '</span></div></div>';
    if (!H.ok) return pbox(head + '<span style="padding:16px 18px 18px; border-top:1px solid ' + W(6) + '; font-size:13px; color:var(--ma2-grey);">' + esc(H.fewTxt) + '</span>', ' overflow-x:auto;');
    const rows = P.win.slice().reverse(), sc = H.sc, today = fhSurfName(m.surface);
    const cols = 'repeat(' + Math.max(1, rows.length) + ',minmax(22px,1fr))', GR = 'display:grid; grid-template-columns:minmax(130px,0.8fr) 96px minmax(234px,1.6fr); align-items:center; gap:12px;';
    const heads = rows.map(r => '<span class="seg" title="' + esc('v ' + fhOppFmt(r.opp) + ' · ' + r.tourn + ' · ' + r.round) + '" onclick="fhOpenSheet(\'' + esc(r.mid) + '\')" style="display:flex; flex-direction:column; align-items:center; gap:3px; cursor:pointer;">'
      + '<span style="width:6px; height:6px; border-radius:50%; background:' + (r.surface && r.surface === today ? 'var(--ma2-text)' : W(22)) + ';"></span>'
      + '<span style="' + MONO + ' font-size:9px; color:var(--ma2-grey); white-space:nowrap;">' + esc(fhTournCode(r.tournRaw || r.tourn)) + '</span><span style="' + MONO + ' font-size:9px; color:var(--ma2-grey); white-space:nowrap;">' + esc(fhDDMM(r.date)) + '</span></span>').join('');
    const topK = sc.scored.length ? sc.scored[0].k : -1, all = !!S.hotAll[P.idx];
    const line = (x, fam) => {
      const g = maGate(x.n).mode, pct = g === 'nopct' ? DASH : Math.round(x.c / x.n * 100) + '%';
      const dots = rows.map(r => { const e = fhEligible(r, x.L), c = e && x.L.cov(r), why = e ? '' : fhIneligibleWhy(r, x.L);
        const tip = 'v ' + fhOppFmt(r.opp) + ' · ' + r.tourn + ' · ' + fhScoreText(r, false) + ' · ' + (!e ? 'not eligible' + (why ? ' (' + why + ')' : '') : c ? 'covered' : 'not covered');
        return '<span style="display:flex; justify-content:center;"><span class="seg" title="' + esc(tip) + '" onclick="fhOpenSheet(\'' + esc(r.mid) + '\')" style="width:' + (e ? 10 : 6) + 'px; height:' + (e ? 10 : 6) + 'px; border-radius:50%; background:' + (!e ? W(8) : c ? 'var(--ma2-blue)' : 'transparent') + '; border:1.5px solid ' + (!e ? 'transparent' : 'var(--ma2-blue)') + '; box-sizing:border-box; cursor:pointer; flex:none;"></span></span>'; }).join('');
      return '<div class="ma2-row fhl fl-' + P.idx + '-' + x.k + '" style="' + GR + ' padding:11px 18px; border-top:1px solid ' + W(6) + '; cursor:default;">'
        + '<span style="display:flex; flex-direction:column; gap:3px; min-width:0;">' + (fam ? '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + esc(fam) + '</span>' : '')
        + '<span style="display:flex; align-items:center; flex-wrap:wrap; gap:6px 8px;"><span style="font-size:13.5px; font-weight:700; color:var(--ma2-text);">' + esc(x.name) + '</span>'
        + (x.k === topK ? '<span style="font-size:11px; font-weight:700; color:var(--ma2-text); background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:6px; padding:1px 7px; white-space:nowrap;">Most covered</span>' : '') + '</span></span>'
        + '<span style="display:flex; flex-direction:column; gap:2px; min-width:0;"><span style="display:flex; align-items:baseline; gap:7px; white-space:nowrap;">'
        + '<span data-ma-gate="' + g + '"' + (g === 'nopct' ? ' title="' + esc(x.n + ' eligible: too few for a rate') + '"' : g === 'small' ? ' title="small sample"' : '') + ' style="' + MONO + ' font-size:15px; font-weight:700; color:' + (g === 'full' ? 'var(--ma2-text)' : 'var(--ma2-grey)') + ';">' + pct + '</span>'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + x.c + ' of ' + x.n + '</span></span>'
        + (x.L.basis && x.n < rows.length ? '<span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">' + esc(x.L.basis) + '</span>' : '') + '</span>'
        + '<span style="display:grid; grid-template-columns:' + cols + '; align-items:center;">' + dots + '</span></div>';
    };
    const out = [];
    if (all) FH_HOT_FAM.forEach(f => { const ls = sc.scored.filter(x => fhFamOf(x.L.g) === f[0]); if (!ls.length) return;
      out.push('<span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); padding:12px 18px 8px; border-top:1px solid ' + W(6) + ';">' + f[1] + '</span>'); ls.forEach(x => out.push(line(x, ''))); });
    else FH_HOT_FAM.forEach(f => { const b = sc.scored.find(x => fhFamOf(x.L.g) === f[0]); if (b) out.push(line(b, f[1])); });
    const shown = all ? sc.scored.length : out.length, more = sc.scored.length > shown || all;
    return pbox(head + '<div style="' + GR + ' padding:9px 18px; border-top:1px solid ' + W(6) + ';"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Line</span><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Covered</span><div style="display:grid; grid-template-columns:' + cols + ';">' + heads + '</div></div>'
      + out.join('') + (more ? '<div style="display:flex; padding:12px 18px 16px; border-top:1px solid ' + W(6) + ';">' + btn(all ? 'Best line per family' : 'Show all lines (' + sc.scored.length + ')', "fhFormToggle('hotAll'," + P.idx + ')') + '</div>' : ''), ' overflow-x:auto;');
  }
  const FL_COLS = 'grid-template-columns:44px 8px minmax(78px,1.1fr) 28px 44px minmax(86px,1.3fr) 38px 38px; gap:0 8px; align-items:center;';
  function recentBox(P, S) {
    const used = '<div style="display:flex; align-items:center; gap:10px; padding:8px 18px;"><span style="flex:1; height:1px; background:' + W(6) + ';"></span><span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">Used in the form figures above</span><span style="flex:1; height:1px; background:' + W(6) + ';"></span></div>';
    const covMap = P.hot.sc ? P.hot.sc.covMap : {};
    const row = r => {
      const wo = !!r.wo, c = r.won == null || r.unconfirmed ? 'var(--ma2-quiet)' : r.won ? 'var(--ma2-green)' : 'var(--ma2-red)';
      const sets = wo || r.pS == null ? '–' : r.pS + '–' + r.oS;
      const scores = wo ? '–' : String(fhFormSetScores(r)).split(', ').map((x, i, a) => '<span style="white-space:nowrap;">' + esc(x) + (i < a.length - 1 ? ',' : '') + '</span>').join(' ');
      const mark = !wo && typeof fhPxMark === 'function' ? fhPxMark(r) : '';
      const sel = !!(typeof _fh !== 'undefined' && _fh && _fh.sheet === r.mid);
      return '<div class="fh-fm fm' + P.idx + ' ' + (covMap[r.mid] || []).map(k => 'fc-' + P.idx + '-' + k).join(' ') + '" style="transition:opacity .12s; padding:0 8px;">'
        + '<div class="seg ' + (wo ? 'fh-wo' : 'ma2-row fh-frow') + '"' + (wo ? ' data-fh-wo="1"' : ' data-fh-mid="' + esc(r.mid) + '" onclick="fhOpenSheet(\'' + esc(r.mid) + '\')" title="Open the match stats"')
        + ' style="display:grid; ' + FL_COLS + ' padding:8px 10px; border-radius:8px; background:' + (sel ? 'var(--ma2-lifted)' : 'transparent') + '; cursor:' + (wo ? 'default' : 'pointer') + ';">'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + esc(fhDDMM(r.date) + '.') + (wo ? '<span title="Walkover: not a match played, counted in no record" style="display:block; font-size:10px; font-weight:700;">WO</span>' : '') + '</span>'
        + '<span style="width:8px; height:8px; border-radius:50%; background:' + (r.unconfirmed ? 'transparent' : c) + ';"></span>'
        + '<span title="' + esc(fhFullName(r.opp, r.oppKey)) + '" style="font-size:12.5px; font-weight:600; color:var(--ma2-text); overflow-wrap:anywhere; min-width:0;">' + esc(fhOppFmt(r.opp)) + '</span>'
        + '<span style="' + MONO + ' font-size:11px; color:var(--ma2-grey);">' + esc(r.round || DASH) + '</span>'
        + '<span style="justify-self:start; ' + MONO + ' font-size:11.5px; font-weight:700; color:' + (sets === '–' ? 'var(--ma2-quiet)' : c) + '; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:6px; padding:1px 6px; white-space:nowrap;">' + sets + '</span>'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-soft); line-height:1.35;">' + scores + '</span>'
        + '<span title="' + esc(wo ? '' : fhSrcTitle(r)) + '" style="position:relative; ' + MONO + ' font-size:12px; color:' + (r.price == null || wo ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; text-align:right;">' + (wo || r.price == null ? DASH : fhOdd(r.price))
        + (mark ? '<span aria-hidden="true" style="position:absolute; top:-3px; right:-8px; font-size:7px; font-weight:700; color:var(--ma2-grey);">' + mark + '</span>' : '') + '</span>'
        + '<span title="' + esc(wo ? '' : fhSrcTitle(r)) + '" style="' + MONO + ' font-size:12px; color:' + (r.oppPrice == null || wo ? 'var(--ma2-quiet)' : 'var(--ma2-grey)') + '; text-align:right;">' + (wo || r.oppPrice == null ? DASH : fhOdd(r.oppPrice)) + '</span></div></div>';
    };
    const body = P.entries.map(e => e.isDiv ? used
      : e.isHead ? '<div style="display:flex; align-items:baseline; gap:10px; padding:10px 18px 4px;"><span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); white-space:nowrap;">' + esc(e.tourn) + '</span><span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">' + esc(e.meta) + '</span></div>'
      : row(e.r)).join('');
    const empty = P.list.length === 0 ? '<div style="padding:28px 18px; text-align:center; font-size:12.5px; color:var(--ma2-grey);">' + (P.noSource ? 'No recent matches on record.' : 'No matches with these filters.') + '</div>' : '';
    const n = P.list.length, more = n > P.NWIN, open = !!S.more[P.idx];
    const foot = n > 0 ? '<div style="margin-top:auto; padding-top:8px;"><div style="display:flex; justify-content:center; padding:12px 18px 16px; border-top:1px solid ' + W(6) + ';">'
      + btn(!more ? 'All matches shown' : open ? 'Show fewer' : 'Show ' + (n - P.NWIN) + ' more matches', more ? "fhFormToggle('more'," + P.idx + ')' : '', { color: more ? 'var(--ma2-text)' : 'var(--ma2-grey)' }) + '</div></div>' : '';
    const hd = '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">';
    return '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; display:flex; flex-direction:column; min-width:0; overflow:clip;">'
      + '<div style="display:flex; align-items:center; gap:12px; padding:18px 18px 16px; min-width:0;">' + av(P.name, P.key, 40, P.idx ? SH_B() : SH_A(), 12)
      + '<div style="min-width:0; display:flex; flex-direction:column; gap:2px;"><span style="font-size:15px; font-weight:800; color:var(--ma2-text);">' + esc(P.name) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + P.shown.length + ' on record' + (P.DWIN == null ? '' : ' · last ' + P.DWIN + ' days') + '</span></div></div>'
      + '<div style="display:grid; ' + FL_COLS + ' padding:9px 18px; border-top:1px solid ' + W(6) + '; border-bottom:1px solid ' + W(6) + '; margin-bottom:4px;">' + hd + 'Date</span><span></span>' + hd + 'Opponent</span>' + hd + 'Rd</span>' + hd + 'Sets</span>' + hd + 'Score</span><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); text-align:right;">Price</span><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); text-align:right;">Opp</span></div>'
      + empty + body + (P.divEnd ? used : '') + foot + '</div>';
  }
  function maFormV2(m) {
    if (typeof fhEnsureStyles === 'function') fhEnsureStyles();
    const F = fhStateFor(m), S = F.form;
    if (!m._fhFormData) {
      fhEnsureFormData(m).then(() => { if (_fh && _fh.m === m) { const el = document.getElementById('aSectionForm'); if (el) el.innerHTML = buildFormSection(m); } });
      return '<div class="acomingsoon">Loading recent form…</div>';
    }
    if (![0, 1].some(i => (((m._fhFormRows || [])[i]) || (i ? m.p2RecentFormMatches : m.p1RecentFormMatches) || []).length))
      return '<div class="acomingsoon">No recent matches on record for either player.</div>';
    const A = fhFormPlayer(m, 0, S), B = fhFormPlayer(m, 1, S);
    if ([A, B].some(P => !P.thin && P.np < P.n)) [A, B].forEach(P => { if (!P.thin) ['medP', 'medO', 'flat'].forEach(k => { if (!P.metrics[k].sub) P.metrics[k].sub = P.pricedCap; }); });
    if ([A, B].some(P => !P.thin && P.ke < P.n)) [A, B].forEach(P => { if (!P.thin && !P.metrics.oppElo.sub) P.metrics.oppElo.sub = P.eloCap; });
    const tr = (list, cur, key) => track(list.map(t => ({ label: t[1], on: cur === t[0], onclick: 'fhForm({' + key + ':' + (typeof t[0] === 'number' ? t[0] : "'" + t[0] + "'") + '})' })), { gap: 3 });
    const filters = '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px;">'
      + tr([['all', 'All'], ['Clay', 'Clay'], ['Hard', 'Hard'], ['Grass', 'Grass']], S.surf, 'surf') + vr
      + tr([['all', 'All'], ['fav', 'As favourite'], ['dog', 'As underdog']], S.role, 'role') + vr
      + '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">' + tr([['n', 'Matches'], ['d', 'Days']], S.wmode, 'wmode')
      + (S.wmode === 'n' ? tr([5, 10, 15, 20].map(k => [k, 'Last ' + k]), S.n, 'n') : tr([10, 20, 30, 60].map(k => [k, k + ' days']), S.days, 'days')) + '</div></div>';
    const WLBL = A.WLBL, role = S.role === 'fav' ? ' · as favourite' : S.role === 'dog' ? ' · as underdog' : '';
    const lastLabel = WLBL + ' · ' + (S.surf === 'all' ? 'all surfaces' : S.surf) + role;
    const eloHelp = S.wmode === 'n' ? 'now v oldest of last ' + S.n : 'now v oldest in ' + S.days + ' days';
    const lastRows = [['medP', 'Median odd', 'his closing odd', 'low'], ['medO', 'Median opp odd', "opponents' closing odd", 'low'], ['oppElo', 'Opposition Elo', 'avg opponent Elo rating', 'high'],
      ['flat', 'Flat 1% stake', 'Return backing him every match', 'high'], ['elo', 'Elo change', eloHelp, 'high']];
    const fatRows = [['load', 'Load', 'matches in 28 days', 'low'], ['m714', 'Matches 7d / 14d', 'last 7 and 14 days', 'low']];
    const G3 = 'display:grid; grid-template-columns:minmax(0,1fr) minmax(110px,180px) minmax(0,1fr); gap:16px; align-items:center;';
    const half = (P, right) => '<span style="display:flex; align-items:center; ' + (right ? '' : 'justify-content:flex-end; ') + 'gap:9px; min-width:0;">'
      + (right ? av(P.name, P.key, 26, SH_B(), 9.5) : '') + '<span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(P.name) + '</span>' + (right ? '' : av(P.name, P.key, 26, SH_A(), 9.5)) + '</span>';
    const data = S.card ? '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding-bottom:8px; display:flex; flex-direction:column; min-width:0;">'
      + '<div style="' + G3 + ' padding:12px 18px; border-bottom:1px solid ' + W(6) + '; margin-bottom:6px;">' + half(A, false) + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); text-align:center; text-wrap:balance;">' + esc(lastLabel) + '</span>' + half(B, true) + '</div>'
      + formDataRows(A, B, lastRows)
      + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); text-align:center; margin-top:6px; padding:9px 18px; border-top:1px solid ' + W(6) + '; border-bottom:1px solid ' + W(6) + '; margin-bottom:6px;">Fatigue · all matches to ' + esc(fhDDMM(m.date)) + ', any surface</span>'
      + formDataRows(A, B, fatRows) + '</div>' : '';
    const formCard = fcard(headRow('Form', '', lastLabel, btn(S.card ? 'Hide form data' : 'Show form data', 'fhForm({card:' + !S.card + '})'))
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr)); gap:10px;">' + formBox(A) + formBox(B) + '</div>' + data);
    const hotSub = "Each player's own " + WLBL.toLowerCase() + (S.wmode === 'n' ? ' matches' : '') + ', best covered line in each market';
    const hotCard = fcard(headRow('Hot lines', 'One dot per match, oldest to newest. Filled = covered, hollow = not covered, small grey = not eligible. Hover a line to find its matches, click a dot for the match.', hotSub,
      btn(S.hot ? 'Hide hot lines' : 'Show hot lines', 'fhForm({hot:' + !S.hot + '})')) + (S.hot ? hotBox(A, S, m) + hotBox(B, S, m) : ''));
    const recCard = fcard('<div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap;">Recent matches</span><span style="font-size:12.5px; color:var(--ma2-grey);">Newest first · click a match for its stats</span></div>'
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(400px,100%),1fr)); gap:10px; align-items:stretch;">' + recentBox(A, S) + recentBox(B, S) + '</div>');
    return '<div class="fh-fwrap" style="display:flex; flex-direction:column; gap:14px; width:100%; max-width:1040px; margin:0 auto; font-size:14px; line-height:normal; color:var(--ma2-text);">' + filters + formCard + hotCard + recCard + '</div>';
  }
  root.maFormV2 = maFormV2;

  // ===================================================================================================
  // HEAD TO HEAD (LOCKED 2026-11-22): record card (+ Include Challenger & ITF, surface track, tiles + opened panel) →
  // Price range (1a) → Hot lines (Line · Today · Covered · dots · ›, a row opens its history) → Meetings.
  // Data = fhMeetings (H2HCore.joinMeetings: ATP's official population; the tick box adds Challenger / ITF meetings),
  // the Database join's prices, fhHotModel (the live hot-line rule), bet105 line prices (LinePrices).
  const L_H2 = 'minmax(150px,0.8fr) 56px 84px minmax(234px,1.6fr) 10px';
  const M_H2 = '52px minmax(0,1.4fr) 36px 56px minmax(0,1.3fr) 46px 46px 8px';
  const hd = (t, x) => '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);' + (x || '') + '">' + t + '</span>';
  const chev = (rot) => '<span style="color:var(--ma2-quiet); font-size:14px; display:inline-block; transition:transform .2s;' + (rot ? ' transform:rotate(90deg);' : '') + '">›</span>';
  function h2LinePx(L, m, repaint) {
    const ctx = fhLinePxCtx(m, repaint || (() => { if (_fh && _fh.m === m && aBuilt(m, 'h2h')) fhH2h({}); }));
    if (!ctx || typeof LinePrices === 'undefined' || !L.px) return { txt: DASH, price: null, title: L.px ? 'No line price' : 'No bet105 market for this line' };
    const px = L.px, side = px.side || (px.who === 'A' ? ctx.aKey : px.who === 'B' ? ctx.bKey : null);
    const r = LinePrices.linePrice(ctx.ek, side, px.mk, px.line, { date: ctx.date, started: !!ctx.started });
    if (r.state === 'loading') { LinePrices.load(ctx.date, ctx.ek).then(() => { if (ctx.repaint) ctx.repaint(); }); return { txt: DASH, price: null, title: 'Loading' }; }
    const title = LinePrices.hoverLines(r, L.name).join('\n');
    if (r.state === 'ok') return { txt: LinePrices.fmtOdd(r.price), price: r.price, title, age: r.ageMin };   // odds.md: every priced cell shows its age
    if (r.state === 'close') return { txt: 'Close ' + LinePrices.fmtOdd(r.price), price: r.price, title };
    return { txt: DASH, price: null, title };
  }
  function h2How(L, r) {
    const p = L.px || {}, B = p.who === 'B';
    if (!r.sets) return DASH;
    if (L.g === 'tot') return r.tot + ' games';
    if (L.g === 'gh') return signed(B ? -r.diff : r.diff, 0) + ' games';
    if (L.g === 'sh') return (B ? r.oS + '–' + r.pS : r.pS + '–' + r.oS) + ' sets';
    if (L.need === 'set1') return 'Set 1 ' + (B ? r.sets[0][1] + '-' + r.sets[0][0] : r.sets[0][0] + '-' + r.sets[0][1]);
    if (/Tiebreak/.test(L.name)) return r.tbN ? r.tbN + (r.tbN === 1 ? ' tiebreak' : ' tiebreaks') : 'No tiebreak';
    return r.sets.length + ' sets played';
  }
  function maH2HV2(m) {
    if (typeof fhEnsureStyles === 'function') fhEnsureStyles();
    const F0 = fhStateFor(m), S = F0.h2h, A = m.p1, B = m.p2, aS = fhSurname(A), bS = fhSurname(B);
    const wrap = inner => '<div class="fh-h2wrap h2wrap" style="display:flex; flex-direction:column; gap:14px; width:100%; max-width:1040px; margin:0 auto; container-type:inline-size; font-size:14px; line-height:normal; color:var(--ma2-text);">' + inner + '</div>';
    if (m._fhH2hFailed) return wrap(fcard(headRow('Head to head record', '', 'Head-to-head could not load')
      + '<span style="font-size:13px; color:var(--ma2-grey);">Match history for ' + esc(m._fhH2hFailed.join(' and ')) + ' did not load, so the meetings are not known yet.</span>'
      + '<div>' + btn('Retry', 'fhH2hRetry()') + '</div>'));
    if (!m._fhH2hData) {
      fhEnsureH2hData(m).then(() => { if (_fh && _fh.m === m) fhH2h({}); });
      return wrap('<div style="display:flex; flex-direction:column; gap:14px;">' + [230, 190, 260].map(h => '<div style="height:' + h + 'px; border-radius:16px; background:' + W(4) + ';"></div>').join('')
        + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); text-align:center;">Loading head to head…</span></div>');
    }
    const CH = !!S.ch, E = fhMeetings(m, CH), nCh = CH ? E.filter(r => r.level === 'CH/ITF').length : fhMeetings(m, true).length - E.length;
    const chBox = '<span class="seg" role="button" tabindex="0" onclick="fhH2h({ch:' + !CH + ',hotOpen:null,stat:null})" title="Also count their meetings on the Challenger and ITF tours" style="margin-left:auto; display:inline-flex; align-items:center; gap:9px; font-size:12.5px; font-weight:' + (CH ? 700 : 600) + '; color:' + (CH ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; white-space:nowrap; cursor:pointer;">'
      + '<span style="flex:none; width:16px; height:16px; border-radius:5px; box-sizing:border-box; background:' + (CH ? 'var(--ma2-lifted)' : 'var(--ma2-track)') + '; border:1px solid ' + W(CH ? 22 : 14) + '; display:flex; align-items:center; justify-content:center;">'
      + (CH ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.2l2 2 4-4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>' : '') + '</span>Include Challenger &amp; ITF'
      + '<span style="' + MONO + ' font-size:10.5px; font-weight:400; color:var(--ma2-quiet);">' + nCh + '</span></span>';
    const recScope = CH ? 'ATP, Challenger and ITF meetings' : 'ATP tour meetings';
    if (!E.length) {
      if (!m._styleMeetLoaded) Promise.all([ensureStyleMeetings(m), ensurePsMatrix()]).then(() => { if (_fh && _fh.m === m) fhH2h({}); }).catch(() => {});
      const tiles = fhNoMeetingCards(m).map(r => '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:11px; padding:13px 6px 12px; display:flex; flex-direction:column; align-items:center; text-align:center; gap:7px;">'
        + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span style="font-weight:700; color:var(--ma2-text);">' + esc(r.who) + '</span> ' + esc(r.vs) + '</span>'
        + '<span style="' + MONO + ' font-size:20px; font-weight:700; line-height:1; color:' + (r.dash ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + ';">' + esc(r.rec) + '</span>'
        + '<span style="font-size:11.5px; color:var(--ma2-grey);">' + (r.metaHtml != null ? r.metaHtml : esc(r.meta)) + '</span></div>').join('');
      return wrap(fcard('<div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text);">Head to head record</span><span style="font-size:12.5px; color:var(--ma2-grey);">No previous meetings</span>' + chBox + '</div>'
        + '<span style="font-size:13px; color:var(--ma2-grey); line-height:1.55; max-width:720px; text-wrap:pretty;">' + esc(A) + ' and ' + esc(B) + ' have no meeting on record. The closest guide is how each has done against the other\'s playing style over the last 52 weeks. ' + esc(fhH2hScopeNote(m)) + '</span>'
        + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px;">' + tiles + '</div>'
        + '<span style="font-size:12.5px; color:var(--ma2-grey);">The full record against each style is on the Playing style tab.</span>'));
    }
    E.forEach(r => { F0.sheetMap[r.mid] = { r, aName: A, aKey: m.p1Key, bName: B, bKey: m.p2Key }; });
    const played = E.filter(r => !r.wo), SURF = S.surf, FL = E.filter(r => SURF === 'all' || r.surface === SURF), F = FL.filter(r => !r.wo);
    const surfTrack = '<div style="display:inline-flex; flex-wrap:wrap; gap:3px; background:var(--ma2-track); border:1px solid ' + W(10) + '; border-radius:10px; padding:3px;">'
      + [['all', 'All'], ['Hard', 'Hard'], ['Clay', 'Clay'], ['Grass', 'Grass']].map(t => {
        const n = played.filter(r => t[0] === 'all' || r.surface === t[0]).length, off = !E.some(r => t[0] === 'all' || r.surface === t[0]), on = SURF === t[0];
        return '<span class="' + (off ? '' : 'seg ma2-seg') + '"' + (off ? '' : ' role="button" tabindex="0" onclick="fhH2h({surf:\'' + t[0] + '\',allLines:false,stat:null,hotOpen:null})"')
          + ' style="display:inline-flex; align-items:baseline; gap:6px; padding:6px 12px; border-radius:7px; font-size:12.5px; font-weight:' + (on ? 700 : 600) + '; color:' + (off ? 'var(--ma2-quiet)' : on ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; background:' + (on ? 'var(--ma2-lifted)' : 'transparent') + '; border:1px solid ' + (on ? W(14) : 'transparent') + '; cursor:' + (off ? 'default' : 'pointer') + '; white-space:nowrap;">'
          + t[1] + '<span style="' + MONO + ' font-size:10.5px; color:var(--ma2-quiet);">' + n + '</span></span>'; }).join('') + '</div>';
    // record box
    const ra = F.filter(r => r.won).length, rb = F.length - ra, side = ra > rb ? 'a' : rb > ra ? 'b' : 'level';
    const small = F.length && maGate(F.length).mode !== 'full' ? ' · small sample' : '';
    const recHalf = (name, key, wins, right) => '<div style="display:flex; align-items:center; ' + (right ? 'justify-content:flex-end; ' : '') + 'gap:13px; min-width:0;">'
      + (right ? '' : av(name, key, 46, SH_A(), 12)) + '<div style="min-width:0; display:flex; flex-direction:column; ' + (right ? 'align-items:flex-end; ' : '') + 'gap:3px;"><span style="font-size:16px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(name) + '</span>'
      + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + wins + (wins === 1 ? ' win' : ' wins') + '</span></div>' + (right ? av(name, key, 46, SH_B(), 12) : '') + '</div>';
    const dots = F.map(r => '<span title="' + esc(r.tourn + ' ' + String(r.date).slice(0, 4) + ' · ' + (r.won ? aS : bS) + ' won') + '" style="flex:none; width:10px; height:10px; border-radius:50%; background:' + (r.won ? 'var(--ma2-blue)' : 'var(--ma2-text)') + ';"></span>').join('');
    const recBox = '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding:24px 24px 0; display:flex; flex-direction:column; gap:22px;">'
      + '<div style="display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:18px;">' + recHalf(A, m.p1Key, ra, false)
      + '<div style="display:flex; flex-direction:column; align-items:center; gap:7px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + (SURF === 'all' ? 'Overall' : 'On ' + SURF.toLowerCase()) + '</span>'
      + '<span style="' + MONO + ' font-size:42px; font-weight:700; line-height:1; white-space:nowrap; color:var(--ma2-text);">' + ra + '<span style="color:var(--ma2-grey);"> – </span>' + rb + '</span>'
      + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + F.length + (F.length === 1 ? ' meeting' : ' meetings') + small + '</span></div>' + recHalf(B, m.p2Key, rb, true) + '</div>'
      + '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px 16px; margin:0 -24px; padding:12px 24px 14px; border-top:1px solid ' + W(6) + ';"><div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px;">' + dots + '</div>'
      + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + (!F.length ? 'No meetings' : side === 'level' ? 'Level' : (side === 'a' ? aS : bS) + ' leads') + '</span>'
      + (FL.length ? btn('Show meetings', 'fhH2hToList()', { style: 'margin-left:auto; ' }) : '') + '</div></div>';
    // tiles + opened panel
    const withGames = F.filter(r => r.sets), withTally = F.filter(r => r.pS != null);
    let sA = 0, sB = 0, tA = 0, tB = 0;
    withTally.forEach(r => { if (r.done) r.done.forEach(x => { if (x[0] > x[1]) sA++; else if (x[1] > x[0]) sB++; }); else { sA += r.pS; sB += r.oS; } });
    withGames.forEach(r => r.done.forEach(x => { if (Math.max(x[0], x[1]) === 7 && Math.min(x[0], x[1]) === 6) { if (x[0] > x[1]) tA++; else tB++; } }));
    const dec = F.filter(r => r.decider), dA = dec.filter(r => r.won).length, pre = F.length === 1 ? 'n=1 · ' : '';
    const gCov = withGames.length < F.length ? ' · ' + withGames.length + ' of ' + F.length + ' with set scores' : '', sCov = withTally.length < F.length ? ' · ' + withTally.length + ' of ' + F.length + ' with a score' : '';
    const stats = [
      { key: 'sets', label: 'Sets won', val: withTally.length ? sA + '–' + sB : DASH, sub: pre + (sA + sB) + ' completed sets' + sCov },
      { key: 'tb', label: 'Tiebreaks', val: withGames.length ? tA + '–' + tB : DASH, sub: pre + (tA + tB) + ' played' + gCov },
      { key: 'dec', label: 'Deciding sets', val: dec.length ? dA + '–' + (dec.length - dA) : DASH, sub: pre + dec.length + ' went the distance' + sCov }];
    const tilesHtml = F.length ? '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px;">' + stats.map(c => { const on = S.stat === c.key;
      return '<div class="seg ma2-tile" role="button" tabindex="0" onclick="fhH2h({stat:' + (on ? 'null' : "'" + c.key + "'") + '})" title="Show the meetings behind this figure" style="background:' + (on ? 'var(--ma2-lifted)' : 'var(--ma2-inner)') + '; border:1px solid ' + W(on ? 22 : 6) + '; border-radius:11px; padding:13px 6px 12px; display:flex; flex-direction:column; align-items:center; text-align:center; gap:7px; cursor:pointer;">'
        + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + c.label + '</span><span style="' + MONO + ' font-size:20px; font-weight:700; line-height:1; color:' + (c.val === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; white-space:nowrap;">' + c.val + '</span>'
        + '<span style="font-size:11.5px; color:var(--ma2-grey);">' + esc(c.sub) + '</span></div>'; }).join('') + '</div>' : '';
    const newest = F.slice().reverse(), rowsP = [];
    const pRow = (r, aw, val, meta) => ({ r, aw, val, meta });
    if (S.stat === 'sets') newest.filter(r => r.pS != null).forEach(r => rowsP.push(pRow(r, r.pS === r.oS ? null : r.pS > r.oS, r.pS + '–' + r.oS, r.sets ? r.sets.map(fhSetTxt).join(', ') + (r.ret ? ' ret.' : '') : 'Set scores not on record')));
    if (S.stat === 'tb') newest.forEach(r => (r.done || []).forEach((x, k) => { if (Math.max(x[0], x[1]) === 7 && Math.min(x[0], x[1]) === 6) { const aw = x[0] > x[1]; rowsP.push(pRow(r, aw, x[2] != null ? Math.max(7, x[2] + 2) + '–' + x[2] : DASH, 'Set ' + (k + 1) + ' · ' + fhSetTxt(x))); } }));
    if (S.stat === 'dec') newest.filter(r => r.decider).forEach(r => { const x = r.sets ? r.sets[r.sets.length - 1] : null, aw = x ? x[0] > x[1] : r.won;
      rowsP.push(pRow(r, aw, x ? Math.max(x[0], x[1]) + '–' + Math.min(x[0], x[1]) : DASH, 'Set ' + (r.pS + r.oS) + (r.bo ? ' of ' + r.bo : '') + (x ? ' · ' + fhSetTxt(x) : ''))); });
    let panel = '';
    if (S.stat && F.length) {
      const isSets = S.stat === 'sets', last = isSets ? '90px' : '136px', G = 'display:grid; grid-template-columns:58px minmax(0,1fr) minmax(0,1.3fr) ' + last + '; gap:0 12px; align-items:center;';
      const unit = S.stat === 'sets' ? ['meeting', 'meetings'] : S.stat === 'tb' ? ['tiebreak', 'tiebreaks'] : ['deciding set', 'deciding sets'];
      const head = '<div style="' + G + ' margin:0 -8px 4px; padding:9px 18px; border-top:1px solid ' + W(6) + '; border-bottom:1px solid ' + W(6) + ';">' + hd('Date') + hd('Event')
        + hd(isSets ? 'Set scores' : S.stat === 'tb' ? 'Tiebreak' : 'Deciding set', ' text-align:' + (isSets ? 'left' : 'center') + ';')
        + (isSets ? '<span style="display:grid; grid-template-columns:1fr 1fr; align-items:center;">' + ['a', 'b'].map(k => '<span style="justify-self:center;">' + avIni(k === 'a' ? A : B, 26, '1px solid ' + W(14), 9.5) + '</span>').join('') + '</span>' : hd('Won by', ' text-align:center;')) + '</div>';
      const metaW = rowsP.reduce((mx, x) => Math.max(mx, String(x.meta).length), 0);
      const rows = rowsP.map(x => { const r = x.r, who = x.aw == null ? null : x.aw ? 'a' : 'b';
        const last2 = isSets ? '<span style="flex:1; display:grid; grid-template-columns:1fr 1fr; align-items:center;">' + String(x.val).split('–').map((v, i) => { const dim = who && who !== (i ? 'b' : 'a');
            return '<span style="' + MONO + ' font-size:13.5px; font-weight:' + (dim ? 400 : 700) + '; color:' + (dim ? 'var(--ma2-grey)' : 'var(--ma2-text)') + '; text-align:center;">' + esc(v || DASH) + '</span>'; }).join('') + '</span>'
          : avIni(who === 'a' ? A : B, 22, '1px solid ' + W(14), 8.5) + '<span style="font-size:12.5px; color:var(--ma2-soft); overflow:hidden; text-overflow:ellipsis;">' + esc(who === 'a' ? aS : bS) + '</span><span style="margin-left:auto; ' + MONO + ' font-size:12.5px; font-weight:700; color:' + (x.val === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + ';">' + esc(x.val) + '</span>';
        return '<div class="seg ma2-row" role="button" tabindex="0" onclick="fhOpenSheet(\'' + esc(r.mid) + '\')" title="Open the match stats" style="' + G + ' padding:8px 10px; border-radius:8px; cursor:pointer;">'
          + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">' + esc(fhDDMM(r.date) + '.' + String(r.date).slice(2, 4)) + '</span>'
          + '<span style="font-size:12.5px; font-weight:600; color:var(--ma2-text); overflow-wrap:anywhere;">' + esc(r.tourn) + '</span>'
          + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-soft); line-height:1.45; text-align:left; width:' + (isSets ? 'auto' : metaW + 'ch') + '; max-width:100%; justify-self:' + (isSets ? 'stretch' : 'center') + ';">' + esc(x.meta) + '</span>'
          + '<span style="display:flex; align-items:center; justify-content:' + (isSets ? 'flex-end' : 'flex-start') + '; gap:8px; white-space:nowrap; min-width:0;">' + last2 + '</span></div>'; }).join('');
      panel = '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding:16px 8px 8px; display:flex; flex-direction:column; gap:8px;">'
        + '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px 10px; padding:0 10px 6px;"><span style="font-size:14px; font-weight:700; color:var(--ma2-text);">' + stats.find(c => c.key === S.stat).label + '</span>'
        + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + rowsP.length + ' ' + unit[rowsP.length === 1 ? 0 : 1] + ' · newest first</span>'
        + '<span class="seg ma2-quietlink" role="button" tabindex="0" onclick="fhH2h({stat:null})" style="margin-left:auto; font-size:12.5px; font-weight:600; color:var(--ma2-grey); cursor:pointer;">Close</span></div>'
        + (rowsP.length ? '<div style="display:flex; flex-direction:column;">' + head + rows + '</div>'
          : '<span style="padding:8px 10px 10px; font-size:13px; color:var(--ma2-grey);">' + (S.stat === 'tb' ? 'No tiebreak in these meetings.' : S.stat === 'dec' ? 'No meeting went the distance.' : 'No set scores on record for these meetings.') + '</span>') + '</div>';
    }
    const recCard = fcard('<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap;">Head to head record</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + recScope + '</span>' + chBox + surfTrack + '</div>'
      + recBox + (FL.length && !F.length ? '' : !FL.length ? '<span style="font-size:13px; color:var(--ma2-grey);">No meetings on ' + esc(SURF.toLowerCase()) + '.</span>' : tilesHtml + panel));
    if (!F.length) return wrap(recCard + (FL.length ? h2List(m, FL, F, S, aS, bS) : ''));
    return wrap(recCard + h2Price(m, F) + h2Hot(m, F, S, aS, bS) + h2List(m, FL, F, S, aS, bS));
  }
  function h2Price(m, F) {
    const PR = F.filter(r => r.price != null), nP = PR.length, today = fhTodayPair(m);
    const evLbl = r => r.tourn.replace(' Masters', '') + " '" + String(r.date).slice(2, 4);
    const ret = typeof fhRetNote === 'function' ? fhRetNote() : '';
    const sides = [0, 1].map(i => {
      const isA = !i, name = isA ? m.p1 : m.p2, key = isA ? m.p1Key : m.p2Key, get = r => isA ? r.price : r.oppPrice, tv = today ? (isA ? today.price : today.oppPrice) : null;
      const headL = '<div style="display:flex; align-items:center; gap:12px; min-width:0;">' + av(name, key, 40, isA ? SH_A() : SH_B(), 12) + '<div style="min-width:0; display:flex; flex-direction:column; gap:2px;"><span style="font-size:15px; font-weight:800; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(name) + '</span>';
      const todayR = '<div style="flex:none; margin-left:auto; display:flex; flex-direction:column; align-items:flex-end; gap:1px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Today</span><span' + (tv == null ? ' title="' + esc(FH_TODAY_NONE) + '"' : '') + ' style="' + MONO + ' font-size:26px; font-weight:700; line-height:1.1; color:' + (tv == null ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; white-space:nowrap;">' + (tv == null ? DASH : tv.toFixed(2)) + '</span></div></div>';
      if (!nP) return pbox2(headL + '<span style="font-size:12.5px; color:var(--ma2-grey);">No priced meeting yet</span></div>' + todayR);
      const so = PR.slice().sort((x, y) => get(x) - get(y)), lo = so[0], hi = so[so.length - 1], avgV = fhPriceAvg(PR, isA);
      if (nP === 1) return pbox2(headL + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + (tv == null ? 'No price today' : '') + '</span></div>' + todayR
        + '<div class="seg" onclick="fhOpenSheet(\'' + esc(lo.mid) + '\')" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; cursor:pointer;"><span style="' + MONO + ' font-size:24px; font-weight:700; line-height:1; color:var(--ma2-text);">' + get(lo).toFixed(2) + '</span>'
        + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(evLbl(lo)) + '</span><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:6px; padding:2px 8px; white-space:nowrap;">1 priced meeting</span></div>');
      const d = tv == null ? null : tv - avgV;
      const note = d == null ? 'No price today' : Math.abs(d) < 0.005 ? 'Level with his average' : Math.abs(d).toFixed(2) + (d < 0 ? ' below' : ' above') + ' his average';
      const span = (get(hi) - get(lo)) || 1, pc = v => Math.max(0, Math.min(100, (v - get(lo)) / span * 100)).toFixed(1) + '%';
      const bar = '<div style="position:relative; height:14px; margin:0 7px;"><span style="position:absolute; left:-7px; right:-7px; top:4px; height:6px; border-radius:3px; background:' + W(7) + ';"></span>'
        + '<span title="Average ' + avgV.toFixed(2) + ' (' + esc(FH_PRICE_AVG_LABEL) + ')" style="position:absolute; left:' + pc(avgV) + '; top:0; width:1px; height:14px; background:var(--ma2-grey);"></span>'
        + (tv == null ? '' : '<span title="Today ' + tv.toFixed(2) + '" style="position:absolute; left:' + pc(tv) + '; top:0; width:14px; height:14px; margin-left:-7px; border-radius:50%; background:var(--ma2-text); box-shadow:0 0 0 3px var(--ma2-inner);"></span>') + '</div>';
      const list = PR.slice().reverse().map(r => { const ext = r.mid === lo.mid || r.mid === hi.mid;
        return '<div style="display:grid; grid-template-columns:minmax(0,1fr) auto 48px; gap:10px; align-items:baseline; padding:5px 0; border-top:1px solid ' + W(6) + ';"><span style="display:flex; align-items:baseline; gap:6px; min-width:0;"><span style="font-size:12px; color:var(--ma2-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(r.tourn + ' ' + String(r.date).slice(0, 4) + ' · ' + r.round) + '</span>' + fhB365Tag(r, true) + '</span>'
          + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + (r.mid === lo.mid ? 'Lowest' : r.mid === hi.mid ? 'Highest' : '') + '</span>'
          + '<span style="' + MONO + ' font-size:12.5px; font-weight:' + (ext ? 700 : 400) + '; color:' + (ext ? 'var(--ma2-text)' : 'var(--ma2-soft)') + '; text-align:right;">' + get(r).toFixed(2) + '</span></div>'; }).join('');
      const pop = '<div class="ma2-ftip" style="position:absolute; top:calc(100% + 8px); left:-8px; right:-8px; z-index:30; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:10px; box-shadow:0 12px 32px color-mix(in srgb, var(--ma2-ground) 55%, transparent); padding:12px 14px 10px; flex-direction:column;">'
        + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); padding-bottom:7px;">' + esc(name) + ' · every priced close</span>' + list
        + '<div style="display:flex; justify-content:space-between; padding-top:7px; border-top:1px solid ' + W(6) + '; font-size:11.5px; color:var(--ma2-grey);"><span>Average, margin removed</span><span style="' + MONO + ' font-weight:700; color:var(--ma2-text);">' + avgV.toFixed(2) + '</span></div></div>';
      const fig = (v, lbl, al, mid) => '<div class="seg"' + (mid ? ' onclick="fhOpenSheet(\'' + esc(mid) + '\')"' : '') + ' style="display:flex; flex-direction:column; align-items:' + al + '; text-align:' + (al === 'flex-end' ? 'right' : al === 'center' ? 'center' : 'left') + '; gap:2px; min-width:0;' + (mid ? ' cursor:pointer;' : '') + '">'
        + '<span style="' + MONO + ' font-size:15px; font-weight:700; color:var(--ma2-text);">' + v + '</span><span style="font-size:11.5px; font-weight:600; line-height:1.35; color:var(--ma2-grey); text-wrap:balance;">' + esc(lbl) + '</span></div>';
      // modal-form-h2h.md: a range from fewer than FH_PRICE_THIN priced meetings carries an n=k chip
      const thin = nP < FH_PRICE_THIN ? ' <span title="Range built from ' + nP + ' priced meetings" style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:6px; padding:2px 8px; white-space:nowrap;">n=' + nP + '</span>' : '';
      return pbox2(headL + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(note) + thin + '</span></div>' + todayR
        + '<div style="display:flex; flex-direction:column; gap:10px;">' + bar + '<div class="ma2-fbar" style="position:relative; display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; align-items:start;">' + pop
        + fig(get(lo).toFixed(2), 'Lowest · ' + evLbl(lo), 'flex-start', lo.mid) + fig(avgV.toFixed(2), 'Average', 'center', null) + fig(get(hi).toFixed(2), 'Highest · ' + evLbl(hi), 'flex-end', hi.mid) + '</div></div>');
    });
    return fcard('<div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap;">Price range</span>'
      + '<span' + (nP && ret ? ' title="' + esc(ret) + '"' : '') + ' style="font-size:12.5px; color:var(--ma2-grey);">Closing odds' + (nP ? ' · ' + esc(fhPriceRangeSource(PR, nP > 1 ? today : null)) : '') + '</span>'
      + '<span style="margin-left:auto; font-size:12.5px; color:var(--ma2-grey); white-space:nowrap;">' + nP + ' of ' + F.length + ' meetings priced</span></div>'
      + (nP ? '' : '<span style="font-size:13px; color:var(--ma2-grey);">No closing odds on record for these meetings</span>')
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr)); gap:10px;">' + sides.join('') + '</div>');
  }
  const pbox2 = inner => '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding:20px; display:flex; flex-direction:column; gap:18px; min-width:0;">' + inner + '</div>';
  function h2Hot(m, F, S, aS, bS) {
    const HM = fhHotModel(F, fhH2hLineDefs(aS, bS), m), sc = HM.sc;
    const head = fcardHead => fcard('<div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap;">Hot lines</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(fhHotSub(HM, "Best covered line in each market, with today's price")) + '</span></div>' + fcardHead);
    if (HM.mode === 'none') return head('<span style="font-size:13px; color:var(--ma2-grey);">' + esc(HM.note || '') + '</span>');
    const results = HM.mode === 'results', today = fhSurfName(m.surface), cols = 'repeat(' + Math.max(1, F.length) + ',minmax(0,1fr))';
    const meets = F.map(r => '<span class="seg" title="' + esc(r.tourn + ' ' + String(r.date).slice(0, 4) + ' · ' + r.round) + '" onclick="fhOpenSheet(\'' + esc(r.mid) + '\')" style="display:flex; flex-direction:column; align-items:center; gap:3px; cursor:pointer;">'
      + '<span style="width:6px; height:6px; border-radius:50%; background:' + (r.surface && r.surface === today ? 'var(--ma2-text)' : W(22)) + ';"></span><span style="' + MONO + ' font-size:9px; color:var(--ma2-grey); white-space:nowrap;">' + esc(fhTournCode(r.tournRaw || r.tourn)) + '</span><span style="' + MONO + ' font-size:9px; color:var(--ma2-grey);">\'' + esc(String(r.date).slice(2, 4)) + '</span></span>').join('');
    const topK = !results && sc.scored.length ? sc.scored[0].k : -1, GR = 'display:grid; grid-template-columns:' + L_H2 + '; align-items:center; gap:12px;';
    const line = (x, fam) => {
      const open = S.hotOpen === x.k, px = h2LinePx(x.L, m), g = results ? 'nopct' : maGate(x.n).mode, rate = x.c / x.n * 100;
      const pct = results || g === 'nopct' ? DASH : Math.round(rate) + '%';
      const dts = F.map(r => { const e = fhEligible(r, x.L), c = e && x.L.cov(r), why = e ? '' : fhIneligibleWhy(r, x.L);
        return '<span style="display:flex; justify-content:center;"><span class="seg" title="' + esc(r.tourn + ' ' + String(r.date).slice(0, 4) + ' · ' + (!e ? 'not eligible' + (why ? ' (' + why + ')' : '') : c ? 'covered' : 'not covered')) + '" onclick="event.stopPropagation(); fhOpenSheet(\'' + esc(r.mid) + '\')" style="width:' + (e ? 10 : 6) + 'px; height:' + (e ? 10 : 6) + 'px; border-radius:50%; background:' + (!e ? W(8) : c ? 'var(--ma2-blue)' : 'transparent') + '; border:1.5px solid ' + (!e ? 'transparent' : 'var(--ma2-blue)') + '; box-sizing:border-box; cursor:pointer; flex:none;"></span></span>'; }).join('');
      const be = px.price ? 100 / px.price : null;
      let out = '<div class="seg ma2-row h2hg h2hl hl-' + x.k + '" role="button" tabindex="0" onclick="fhH2h({hotOpen:' + (open ? 'null' : x.k) + '})" title="Show every meeting on this line" style="' + GR + ' padding:11px 18px; margin:0 -18px; border-top:1px solid ' + W(6) + '; background:' + (open ? 'var(--ma2-lifted)' : 'transparent') + '; cursor:pointer;">'
        + '<span style="display:flex; flex-direction:column; gap:3px; min-width:0;">' + (fam ? '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + esc(fam) + '</span>' : '')
        + '<span style="display:flex; align-items:center; flex-wrap:wrap; gap:6px 8px;"><span style="font-size:13.5px; font-weight:700; color:var(--ma2-text);">' + esc(x.name) + '</span>'
        + (x.k === topK ? '<span style="font-size:11px; font-weight:700; color:var(--ma2-text); background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:6px; padding:1px 7px; white-space:nowrap;">Most covered</span>' : '') + '</span></span>'
        + '<span style="justify-self:start; display:flex; flex-direction:column; gap:2px;">' + '<span title="' + esc(px.title + (be ? '\nNeeds ' + Math.round(be) + '% to break even' : '')) + '" style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + (px.price ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + '; background:var(--ma2-track); border:1px solid ' + W(14) + '; border-radius:6px; padding:2px 7px; white-space:nowrap;">' + esc(px.txt) + '</span>' + (px.age != null ? '<span style="' + MONO + ' font-size:10.5px; color:var(--ma2-grey); white-space:nowrap;">' + px.age + 'm ago</span>' : '') + '</span>'
        + '<span style="display:flex; flex-direction:column; gap:2px; min-width:0;"><span style="display:flex; align-items:baseline; gap:7px; white-space:nowrap;"><span data-ma-gate="' + g + '"' + (results ? ' title="Results only: fewer than ' + FH_HOT_MIN_ELIGIBLE + ' comparable meetings"' : g === 'nopct' ? ' title="' + esc(x.n + ' eligible: too few for a rate') + '"' : '') + ' style="' + MONO + ' font-size:15px; font-weight:700; color:' + (g === 'full' ? 'var(--ma2-text)' : 'var(--ma2-grey)') + ';">' + pct + '</span>'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + x.c + ' of ' + x.n + '</span></span>' + (x.L.basis && x.n < F.length ? '<span style="font-size:11.5px; color:var(--ma2-grey);">' + esc(x.L.basis) + '</span>' : '') + '</span>'
        + '<span style="display:grid; grid-template-columns:' + cols + '; align-items:center;">' + dts + '</span>' + chev(open) + '</div>';
      if (open) {
        const edge = be != null && g !== 'nopct' && !results ? Math.round(rate - be) : null;
        const t = (k, v, c, sub) => '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:11px; padding:13px 6px 12px; display:flex; flex-direction:column; align-items:center; text-align:center; gap:7px; min-width:0;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + k + '</span><span style="' + MONO + ' font-size:20px; font-weight:700; line-height:1; color:' + c + '; white-space:nowrap;">' + v + '</span><span style="font-size:11.5px; color:var(--ma2-grey);">' + esc(sub) + '</span></div>';
        const DG = 'display:grid; grid-template-columns:62px minmax(0,1.3fr) minmax(0,1fr) 110px 100px 8px; gap:0 12px; align-items:center; margin:0 -18px; padding:9px 18px; border-top:1px solid ' + W(6) + ';';
        const det = F.slice().reverse().map(r => { const e = fhEligible(r, x.L), c = e && x.L.cov(r), why = e ? '' : fhIneligibleWhy(r, x.L);
          return '<div class="seg ma2-row h2dg" role="button" tabindex="0" onclick="fhOpenSheet(\'' + esc(r.mid) + '\')" title="Open the match stats" style="' + DG + ' cursor:pointer;">'
            + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + esc(fhDDMM(r.date) + '.' + String(r.date).slice(2, 4)) + '</span>'
            + '<span style="display:flex; align-items:baseline; gap:8px; min-width:0;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-text); overflow-wrap:anywhere;">' + esc(r.tourn) + '</span><span class="h2hide" style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">' + esc(r.surface || '') + '</span></span>'
            + '<span class="h2hide" style="' + MONO + ' font-size:11.5px; color:var(--ma2-soft);">' + esc(fhH2hSetScores(r)) + '</span>'
            + '<span style="' + MONO + ' font-size:12px; font-weight:700; color:' + (e ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; white-space:nowrap;">' + esc(e ? h2How(x.L, r) : (why || 'Not eligible')) + '</span>'
            + '<span style="justify-self:end; font-size:11.5px; font-weight:700; color:' + (!e ? 'var(--ma2-grey)' : c ? 'var(--ma2-green)' : 'var(--ma2-red)') + '; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:6px; padding:2px 8px; white-space:nowrap;">' + (!e ? 'Not eligible' : c ? 'Covered' : 'Not covered') + '</span>'
            + chev(false) + '</div>'; }).join('');
        out += '<div style="margin:0 -18px; padding:16px 18px 0; border-top:1px solid ' + W(6) + '; background:var(--ma2-card); display:flex; flex-direction:column; gap:14px;">'
          + '<div style="display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 12px;"><span style="font-size:14px; font-weight:700; color:var(--ma2-text);">' + esc(x.name) + ' · history</span><span style="font-size:12.5px; color:var(--ma2-grey);">'
          + esc('Covered in ' + x.c + ' of ' + x.n + (x.n === 1 ? ' meeting' : ' meetings') + (x.n < F.length ? ' · ' + (F.length - x.n) + ' not eligible' : '') + ' · newest first') + '</span></div>'
          + '<div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px;">'
          + t('Covered', pct, g === 'full' ? 'var(--ma2-text)' : 'var(--ma2-grey)', x.c + ' of ' + x.n + ' meetings')
          + t('Today’s price', px.price ? esc(px.txt) : DASH, px.price ? 'var(--ma2-text)' : 'var(--ma2-quiet)', be != null ? 'needs ' + Math.round(be) + '% to break even' : 'no price for this line')
          + t('Against the price', edge == null ? DASH : signed(edge, 0) + '%', edge == null ? 'var(--ma2-quiet)' : edge > 0 ? 'var(--ma2-green)' : edge < 0 ? 'var(--ma2-red)' : 'var(--ma2-grey)', 'covered rate minus break-even') + '</div>'
          + '<div style="display:flex; flex-direction:column;"><div class="h2dg" style="' + DG + '">' + hd('Date') + hd('Meeting') + hd('Score') + hd('On this line') + hd('Result', ' text-align:right;') + '<span></span></div>' + det + '</div></div>';
      }
      return out;
    };
    const out = [];
    if (S.allLines || results) FH_HOT_FAM.forEach(f => { const ls = sc.scored.filter(x => fhFamOf(x.L.g) === f[0]); if (!ls.length) return;
      out.push('<span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); margin:0 -18px; padding:12px 18px 8px; border-top:1px solid ' + W(6) + ';">' + f[1] + '</span>'); ls.forEach(x => out.push(line(x, ''))); });
    else FH_HOT_FAM.forEach(f => { const b = sc.scored.find(x => fhFamOf(x.L.g) === f[0]); if (b) out.push(line(b, f[1])); });
    const shown = S.allLines || results ? sc.scored.length : out.length, more = !results && (sc.scored.length > shown || S.allLines);
    return head('<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding:0 18px; display:flex; flex-direction:column; overflow:hidden;">'
      + '<div class="h2hg" style="' + GR + ' margin:0 -18px; padding:9px 18px;">' + hd('Line') + hd('Today', '" title="Today\'s price for this line') + hd('Covered') + '<div style="display:grid; grid-template-columns:' + cols + ';">' + meets + '</div><span></span></div>' + out.join('') + '</div>'
      + '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px 16px; flex-wrap:wrap;"><span style="flex:1 1 320px; font-size:12.5px; line-height:1.5; color:var(--ma2-grey); text-wrap:pretty;">One dot per meeting, oldest → newest · filled = covered · empty = not covered · small grey = not eligible · click a line for its history</span>'
      + (more ? btn(S.allLines ? 'Best line per family' : 'Show all lines (' + sc.scored.length + ')', 'fhH2h({allLines:' + !S.allLines + ',hotOpen:null})') : '') + '</div>');
  }
  function h2List(m, FL, F, S, aS, bS) {
    const years = [];
    FL.slice().reverse().forEach(r => { const y = String(r.date).slice(0, 4); if (!years.length || years[years.length - 1].y !== y) years.push({ y, rs: [] }); years[years.length - 1].rs.push(r); });
    const G = 'display:grid; grid-template-columns:' + M_H2 + '; gap:0 10px; align-items:center; padding:9px 20px;';
    const row = r => { const c = r.wo ? 'var(--ma2-quiet)' : r.won ? 'var(--ma2-green)' : 'var(--ma2-red)', meta = psTourMeta(r.tournRaw);
      const surf = r.surface ? (r.surface === 'Hard' && meta && meta.indoor ? 'Indoor hard' : r.surface) : '';
      const sets = r.wo ? 'w/o' : r.pS == null ? DASH : r.pS + '–' + r.oS, mark = typeof fhPxMark === 'function' ? fhPxMark(r) : '';
      const sel = !!(_fh && _fh.sheet === r.mid);
      return '<div class="h2m"><div class="seg ma2-row h2mg" role="button" tabindex="0"' + (r.wo ? '' : ' onclick="fhOpenSheet(\'' + esc(r.mid) + '\')" title="Open the match stats"') + ' style="' + G + ' border-top:1px solid ' + W(6) + '; background:' + (sel ? 'var(--ma2-lifted)' : 'transparent') + '; cursor:' + (r.wo ? 'default' : 'pointer') + ';">'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + esc(fhDDMM(r.date) + '.') + '</span>'
        + '<span style="display:flex; align-items:baseline; flex-wrap:wrap; gap:0 8px; min-width:0;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-text); overflow-wrap:anywhere;" title="' + esc(r.tourn + ' ' + String(r.date).slice(0, 4) + ' · v ' + fhFullName(r.opp, r.oppKey)) + '">' + esc(r.tourn) + '</span><span class="h2hide" style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">' + esc([surf, r.level].filter(Boolean).join(' · ')) + '</span></span>'
        + '<span class="h2hide" style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + esc(r.round || DASH) + '</span>'
        + '<span style="justify-self:start; ' + MONO + ' font-size:11.5px; font-weight:700; color:' + c + '; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:6px; padding:2px 7px; white-space:nowrap;">' + sets + '</span>'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-soft); line-height:1.35;">' + String(fhH2hSetScores(r)).split(', ').map((s2, i, a) => '<span style="white-space:nowrap;">' + esc(s2) + (i < a.length - 1 ? ',' : '') + '</span>').join(' ') + '</span>'
        + '<span title="' + esc(fhH2hSrcTitle(r)) + '" style="position:relative; ' + MONO + ' font-size:11.5px; color:' + (r.price == null ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; text-align:right;">' + (r.price == null ? DASH : fhOdd(r.price)) + (mark ? '<span aria-hidden="true" style="position:absolute; top:-3px; right:-8px; font-size:7px; font-weight:700; color:var(--ma2-grey);">' + mark + '</span>' : '') + '</span>'
        + '<span title="' + esc(fhH2hSrcTitle(r)) + '" style="' + MONO + ' font-size:11.5px; color:' + (r.oppPrice == null ? 'var(--ma2-quiet)' : 'var(--ma2-grey)') + '; text-align:right;">' + (r.oppPrice == null ? DASH : fhOdd(r.oppPrice)) + '</span>'
        + (r.wo ? '<span></span>' : chev(false)) + '</div></div>'; };
    const body = years.map(Y => { const pl = Y.rs.filter(r => !r.wo), w = pl.filter(r => r.won).length, nW = Y.rs.length - pl.length;
      return '<div style="display:flex; align-items:baseline; gap:10px; padding:12px 20px 8px; border-top:1px solid ' + W(6) + ';"><span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); white-space:nowrap;">' + Y.y + '</span><span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">'
        + esc(w + '–' + (pl.length - w) + ' · ' + pl.length + (pl.length === 1 ? ' meeting' : ' meetings') + (nW ? ' · ' + nW + ' w/o' : '')) + '</span></div>' + Y.rs.map(row).join(''); }).join('');
    const ra = F.filter(r => r.won).length, rb = F.length - ra, nWo = FL.length - F.length;
    const lead = !F.length ? '' : ra === rb ? ' · level ' + ra + '–' + rb : ' · ' + (ra > rb ? aS : bS) + ' leads ' + Math.max(ra, rb) + '–' + Math.min(ra, rb);
    const ini = (name, key) => '<span style="justify-self:end;" title="' + esc(name) + '’s closing price">' + avIni(name, 26, '1px solid ' + W(14), 9.5) + '</span>';
    return '<div id="fhH2hList" style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px; display:flex; flex-direction:column; gap:18px; min-width:0; scroll-margin-top:12px;">'
      + '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap;">Meetings</span><span style="font-size:12.5px; color:var(--ma2-grey);">'
      + esc(F.length + ' on record' + (S.surf === 'all' ? '' : ' · ' + S.surf.toLowerCase()) + lead + (nWo ? ' · ' + nWo + ' w/o not counted' : '')) + '</span>'
      + '<span style="margin-left:auto; display:flex;">' + help('Newest first. The result is shown from ' + aS + '\'s side. The two columns under the avatars are each player\'s closing price. Click a meeting for its match stats.' + (fhH2hGapNote(m) || '')) + '</span></div>'
      + '<div style="border:1px solid ' + W(6) + '; border-radius:12px; overflow:clip; background:var(--ma2-inner); display:flex; flex-direction:column;">'
      + '<div class="h2mg" style="' + G + '">' + hd('Date') + hd('Event') + '<span class="h2hide" style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Rd</span>' + hd('Sets') + hd('Score') + ini(m.p1, m.p1Key) + ini(m.p2, m.p2Key) + '<span></span></div>' + body + '</div></div>';
  }
  root.maH2HV2 = maH2HV2;

  // ===================================================================================================
  // PLAYING STYLE (LOCKED 2026-11-21): Playing style card (radar 1a + comparison list) → Record against each style
  // (Filters panel: six groups; two player boxes; two match lists). Data: the DNA file (dna-apitennis-ratings.json,
  // via mdnaRadarFor + its raw nodes), the style-meetings shards (ps2Record), the Database join's prices; filter
  // attributes: event tier / indoor (psTourMeta), our court-speed class (COURT_CONDITIONS → courtSpeedCategory),
  // opponent rank + best-of from the Tennis Abstract per-match file (splits-matches, joined on date + opponent + result).
  const PS_FILT = { rw: 'career', rs: 'all', sp: 'all', lv: 'all', rk: 'all', fm: 'all' };
  const psPlural = l => /(er|ist|ner)$/i.test(l) ? l + 's' : l + ' players';
  function psSt(m) { const S = ps2StateFor(m); Object.keys(PS_FILT).forEach(k => { if (S[k] === undefined) S[k] = PS_FILT[k]; }); return S; }
  function psNode(key, surface, scope) { const rec = typeof _mdna !== 'undefined' && _mdna && _mdna.byKey ? _mdna.byKey[String(key)] : null; const sf = rec && rec.surfaces && rec.surfaces[surface]; return sf ? (sf[scope] || null) : null; }
  function psDnaCard(m, S) {
    const D = ps2DnaModel(m, S), surf = D.surface || 'All', WIN = D.W;
    const tr = track(Object.keys(PS2_WIN).map(k => ({ label: PS2_WIN[k].label, on: S.win === k, onclick: "ps2Set({win:'" + k + "'})" })), { gap: 3, pad: '6px 14px' });
    const help0 = 'Blue line: ' + m.p1 + '. White line: ' + m.p2 + '. The shape shows where each player stands against the tour on five ratings (percentile). The rows give the raw figures: the line leans toward the better player and the number on it is the difference.';
    const head = '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;"><span style="display:flex; align-items:center; gap:6px 12px; flex-wrap:wrap;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text);">Playing style</span>'
      + '<span style="font-size:12.5px; color:var(--ma2-grey); white-space:nowrap;">' + esc((surf === 'All' ? 'All surfaces' : surf) + ' · ' + WIN.label) + '</span>' + tr + '</span>' + help(help0) + '</div>';
    if (D.loading) return fcard(head + '<span style="font-size:13px; color:var(--ma2-grey);">Loading the playing style ratings…</span>');
    const CX = 210, CY = 150, RR = 105, ang = i => (-90 + i * 72) * Math.PI / 180;
    const pt = (i, v) => (CX + RR * v * Math.cos(ang(i))).toFixed(1) + ',' + (CY + RR * v * Math.sin(ang(i))).toFixed(1);
    const fmtR = (v, dp) => v == null ? DASH : Number(v).toFixed(dp);
    const shapeA = D.a.d.ok, shapeB = D.b.d.ok;
    const axes = PS2_AXES.map((ax, i) => { const c = Math.cos(ang(i)), sn = Math.sin(ang(i)), side = i === 1 || i === 4;
      const lp = (((side ? (c > 0 ? 365 : 55) : CX + (RR + 12) * c) - 55) / 310 * 100).toFixed(2) + '%', tp = ((side ? 52 : CY + (RR + 12) * sn + (sn < -0.9 ? -4 : sn > 0.5 ? 6 : 0)) / 270 * 100).toFixed(2) + '%';
      const tx = 'translate(' + (Math.abs(c) < 0.2 ? '-50%' : (c > 0) !== side ? '0' : '-100%') + ', ' + (sn < -0.9 ? '-80%' : '-50%') + ')', al = Math.abs(c) < 0.2 ? 'center' : (c > 0) !== side ? 'flex-start' : 'flex-end';
      const up = ps2UpDashed(WIN, ax), tip = up ? PS2_UP_SINCE_TIP : typeof ps2AxisTip === 'function' ? ps2AxisTip(D, i) : '';
      return '<span' + (tip ? ' title="' + esc(tip) + '"' : '') + ' style="position:absolute; left:' + lp + '; top:' + tp + '; transform:' + tx + '; display:flex; flex-direction:column; align-items:' + al + '; gap:3px;">'
        + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">' + esc((ax.short || ax.label) + (/elo/i.test(ax.key || ax.label) ? ' · current' : '')) + '</span><span style="' + MONO + ' font-size:11.5px; font-weight:700; white-space:nowrap;"><span style="color:var(--ma2-blue);">' + fmtR(D.a.vals[i].raw, ax.dp) + '</span><span style="color:var(--ma2-grey); font-weight:400;"> · </span><span style="color:var(--ma2-text);">' + fmtR(D.b.vals[i].raw, ax.dp) + '</span></span></span>'; }).join('');
    const poly = (P, ok) => ok ? PS2_AXES.map((ax, i) => P.vals[i].pct == null ? null : pt(i, P.vals[i].pct / 100)).filter(Boolean).join(' ') : null;   // Q14: no point for an axis with no figure
    const dots = (P, ok, a) => ok ? PS2_AXES.map((ax, i) => P.vals[i].pct == null ? '' : (q => '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="3.5" ' + (a ? 'fill="var(--ma2-blue)"' : 'fill="var(--ma2-card)" stroke="var(--ma2-text)" stroke-width="1.5"') + '></circle>')(pt(i, P.vals[i].pct / 100).split(','))).join('') : '';
    const pA = poly(D.a, shapeA), pB = poly(D.b, shapeB);
    const svg = '<svg viewBox="55 0 310 270" style="display:block; width:100%; height:auto; overflow:visible;">'
      + '<circle cx="210" cy="150" r="105" fill="' + W(1.5) + '" stroke="' + W(10) + '" stroke-width="1"></circle>' + [78.75, 52.5, 26.25].map(r => '<circle cx="210" cy="150" r="' + r + '" fill="none" stroke="' + W(6) + '" stroke-width="1" stroke-dasharray="2 4"></circle>').join('')
      + PS2_AXES.map((ax, i) => '<line x1="210" y1="150" x2="' + (CX + RR * Math.cos(ang(i))).toFixed(1) + '" y2="' + (CY + RR * Math.sin(ang(i))).toFixed(1) + '" stroke="' + W(6) + '" stroke-width="1"></line>').join('')
      + (pB ? '<polygon points="' + pB + '" fill="color-mix(in srgb, var(--ma2-text) 7%, transparent)" stroke="var(--ma2-text)" stroke-width="1.5" stroke-linejoin="round"></polygon>' : '')
      + (pA ? '<polygon points="' + pA + '" fill="color-mix(in srgb, var(--ma2-blue) 16%, transparent)" stroke="var(--ma2-blue)" stroke-width="2" stroke-linejoin="round"></polygon>' : '')
      + dots(D.b, shapeB, false) + dots(D.a, shapeA, true) + '</svg>';
    const why = [[D.a, shapeA], [D.b, shapeB]].filter(x => !x[1]).map(x => fhSurname(x[0].name) + ': ' + (x[0].d.inPool === false ? 'no rating on file' : 'fewer than ' + MDNA_FLOOR + ' matches ' + WIN.lc + ' on ' + (surf === 'All' ? 'all surfaces' : surf.toLowerCase()) + (x[0].d.matches != null ? ' (' + x[0].d.matches + ')' : '')));
    // the comparison list: the DNA file's raw figures (rating nodes + their components), same surface and window
    const nA = psNode(m.p1Key, surf, WIN.scope), nB = psNode(m.p2Key, surf, WIN.scope);
    const g = (n, path) => { let v = n; for (const k of path) v = v == null ? null : v[k]; return v == null ? null : +v; };
    const rows = [
      ['Ratings', 'Elo on ' + (surf === 'All' ? 'all surfaces' : surf.toLowerCase()), D.a.vals[4].raw, D.b.vals[4].raw, 0],
      ['', 'Dominance ratio', D.a.vals[3].raw, D.b.vals[3].raw, 2], ['', 'Serve rating', D.a.vals[0].raw, D.b.vals[0].raw, 0], ['', 'Return rating', D.a.vals[1].raw, D.b.vals[1].raw, 1],
      ['', 'Under pressure', D.a.vals[2].raw, D.b.vals[2].raw, 1],
      ['Serve', '1st serve in', g(nA, ['serve', 'firstInPct']), g(nB, ['serve', 'firstInPct']), 3], ['', '1st serve points won', g(nA, ['serve', 'firstWonPct']), g(nB, ['serve', 'firstWonPct']), 3],
      ['', '2nd serve points won', g(nA, ['serve', 'secondWonPct']), g(nB, ['serve', 'secondWonPct']), 3], ['', 'Service games held', g(nA, ['serve', 'holdPct']), g(nB, ['serve', 'holdPct']), 3],
      ['Return', 'Return games won', g(nA, ['return', 'returnGamesWonPct']), g(nB, ['return', 'returnGamesWonPct']), 3]];
    const fmtC = (v, k) => v == null ? DASH : k === 0 ? String(Math.round(v)) : k === 2 ? v.toFixed(2) : k === 3 ? v.toFixed(1) + '%' : v.toFixed(1);
    const cmp = rows.map(r => { const x = r[2], y = r[3], both = x != null && y != null, ld = !both || x === y ? 0 : x > y ? 1 : -1, d = both ? Math.abs(x - y) : 0, w = ld ? Math.min(46, 14 + d / Math.max(x, y) * 400) : 0;
      const lc = ld > 0 ? 'var(--ma2-blue)' : ld < 0 ? 'var(--ma2-text)' : 'var(--ma2-grey)', gap = !both ? DASH : ld ? (r[4] === 0 ? String(Math.round(d)) : r[4] === 2 ? d.toFixed(2) : d.toFixed(1)) : 'Level';
      const col = v => v == null ? 'var(--ma2-quiet)' : 'var(--ma2-text)';   // CLAUDE.md: never highlight the better stat
      return '<div>' + (r[0] ? '<div style="padding:12px 0 6px; font-size:11.5px; font-weight:600; color:var(--ma2-grey); text-align:center;">' + r[0] + '</div>' : '')
        + '<div style="display:grid; grid-template-columns:66px minmax(0,1fr) 66px; align-items:center; gap:16px; padding:10px 0; border-top:1px solid ' + W(6) + ';">'
        + '<span style="' + MONO + ' font-size:16px; font-weight:' + (ld > 0 ? 800 : 500) + '; color:' + col(x, 1) + ';">' + fmtC(x, r[4]) + '</span>'
        + '<div style="display:flex; flex-direction:column; align-items:center; gap:7px; min-width:0;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-soft); white-space:nowrap;">' + esc(r[1]) + '</span>'
        + '<div style="position:relative; width:100%; height:4px; border-radius:2px; background:' + W(7) + ';"><span style="position:absolute; top:0; height:4px; border-radius:2px; left:' + (ld > 0 ? 50 - w : 50) + '%; width:' + w + '%; background:' + lc + ';"></span>'
        + '<span style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); ' + MONO + ' font-size:10.5px; font-weight:700; color:' + lc + '; background:var(--ma2-lifted); box-shadow:0 0 0 1px ' + W(14) + '; border-radius:6px; padding:0 6px; white-space:nowrap;">' + gap + '</span></div></div>'
        + '<span style="text-align:right; ' + MONO + ' font-size:16px; font-weight:' + (ld < 0 ? 800 : 500) + '; color:' + col(y, -1) + ';">' + fmtC(y, r[4]) + '</span></div></div>'; }).join('');
    const names = '<div style="display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:12px; padding:2px 2px 14px;">'
      + '<div style="display:flex; align-items:center; gap:10px; min-width:0;">' + av(m.p1, m.p1Key, 40, RING_A(2), 11.5) + '<span style="font-size:15px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(m.p1) + '</span></div>'
      + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">vs</span>'
      + '<div style="display:flex; align-items:center; justify-content:flex-end; gap:10px; min-width:0;"><span style="font-size:15px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(m.p2) + '</span>' + av(m.p2, m.p2Key, 40, RING_B(2), 11.5) + '</div></div>';
    return fcard(head + '<div style="display:flex; flex-wrap:wrap; gap:18px 32px; align-items:center;">'
      + '<div style="flex:1 1 340px; min-width:0; max-width:500px; margin:0 auto;"><div style="box-sizing:border-box; padding:8px 10px;"><div style="position:relative; width:100%;">' + axes + svg + '</div></div>'
      + (why.length ? '<span style="display:block; font-size:11.5px; color:var(--ma2-grey); text-align:center; padding-top:6px;">No shape · ' + esc(why.join(' · ')) + '</span>' : '') + '</div>'
      + '<div style="flex:1.05 1 330px; min-width:0;">' + names + cmp + '</div></div>');
  }
  // one row's filter attributes (cached on the row)
  function psAttrs(r, tm) {
    if (r._psA && (r._psA.tm || !tm)) return r._psA;   // recomputed once the Tennis Abstract file lands
    const meta = typeof psTourMeta === 'function' ? psTourMeta(r.tournament) : null, surf = String(r.surface || '').toLowerCase();
    const rk = typeof sfEventKey === 'function' ? sfEventKey(r.tournament) : null, cc = rk && typeof COURT_CONDITIONS !== 'undefined' ? COURT_CONDITIONS[rk] : null;
    const tier = meta && /^(Grand Slam|Masters 1000|ATP 500|ATP 250)$/.test(meta.tier) ? meta.tier : null;
    const d0 = fhDayNum(r.date), opp = String(r.opponent || '').toLowerCase();
    const ta = tm ? tm.find(x => String(x.o || '').toLowerCase() === opp && (x.wl === 'W') === !!r.won && (d => d0 != null && d0 - d >= -1 && d0 - d <= 16)(fhDayNum(String(x.d).slice(0, 4) + '-' + String(x.d).slice(4, 6) + '-' + String(x.d).slice(6, 8)))) : null;
    return (r._psA = { day: d0, surf: surf === 'hard' ? (meta ? (meta.indoor ? 'Indoor hard' : 'Hard') : null) : surf ? surf.charAt(0).toUpperCase() + surf.slice(1) : null,
      speed: cc && typeof courtSpeedCategory === 'function' ? courtSpeedCategory(cc.speed) : null, tier, rank: ta && ta.orank != null ? +ta.orank : null,
      bo: ta && ta.bo ? +ta.bo : tier === 'Grand Slam' ? 5 : tier ? 3 : null, joined: !!ta, tm: !!tm });
  }
  function psFilter(rows, S, ref, tm) {
    let miss = 0;
    const out = rows.filter(r => { const a = psAttrs(r, tm);
      if (S.rw === 'w52' && !(a.day != null && ref - a.day >= 0 && ref - a.day <= 364)) return false;
      const need = [[S.rs !== 'all', a.surf, v => v === S.rs], [S.sp !== 'all', a.speed, v => v === S.sp], [S.lv !== 'all', a.tier, v => v === S.lv],
        [S.rk !== 'all', a.rank, v => v <= +S.rk], [S.fm !== 'all', a.bo, v => v === +S.fm]];
      for (const [on, v, ok] of need) { if (!on) continue; if (v == null) { miss++; return false; } if (!ok(v)) return false; }
      return true; });
    out.miss = miss; return out;
  }
  function psRecordCard(m, S) {
    const ref = fhRefDay(m), tms = [m.p1Key, m.p2Key].map(k => (typeof _splitsMatchesShards !== 'undefined' && _splitsMatchesShards[String(k)]) ? (_splitsMatchesShards[String(k)].matches || null) : null);
    [m.p1Key, m.p2Key].forEach((k, i) => { if (k != null && typeof loadSplitsMatches === 'function' && !(typeof _splitsMatchesShards !== 'undefined' && String(k) in _splitsMatchesShards)) loadSplitsMatches(k).then(() => ps2Set({})); });
    const RR = [ps2Record(m, 0), ps2Record(m, 1)];
    const nF = Object.keys(PS_FILT).filter(k => S[k] !== PS_FILT[k]).length;
    const grp = (label, key, opts) => '<div style="display:flex; flex-direction:column; align-items:flex-start; gap:8px; min-width:0;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + label + '</span>'
      + track(opts.map(o => ({ label: o[1], on: S[key] === o[0], onclick: 'ps2Set({' + key + ":'" + o[0] + "',moreA:false,moreB:false})" })), { gap: 3 }) + '</div>';
    let missAll = 0;
    const boxes = [], lists = [];
    RR.forEach((R, i) => {
      const name = i ? m.p2 : m.p1, key = i ? m.p2Key : m.p1Key, ring = i ? RING_B(2) : RING_A(2), vs = R.oppLab ? psPlural(R.oppLab) : 'his opponent’s style';
      const headP = '<div style="display:flex; align-items:center; justify-content:center; gap:12px; min-width:0;">' + av(name, key, 40, ring, 11.5) + '<div style="min-width:0; display:flex; flex-direction:column; gap:2px;"><span style="font-size:15px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(name) + '</span><span style="font-size:12.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">against ' + esc(vs) + '</span></div></div>';
      const tileP = (l, v, c, note) => '<div style="display:flex; flex-direction:column; align-items:center; text-align:center; gap:7px; background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:11px; padding:13px 6px 12px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + l + '</span><span style="' + MONO + ' font-size:20px; font-weight:700; line-height:1; white-space:nowrap; color:' + (c || 'var(--ma2-white)') + ';">' + v + '</span>' + (note ? '<span style="font-size:11px; color:var(--ma2-grey); white-space:nowrap;">' + note + '</span>' : '') + '</div>';
      let rec = DASH, rate = DASH, rateC = 'var(--ma2-quiet)', od = DASH, oc = 'var(--ma2-grey)', gL = 50, gW = 0, avgTxt, list = [];
      if (R.state !== 'ready') avgTxt = R.state === 'loading' ? 'Loading career meetings…' : R.self ? fhSurname(name) + '’s playing style is not classified' : 'Playing style not classified';
      else {
        const all = psFilter(R.listRows || R.rows, S, ref, tms[i]); missAll += all.miss; list = all;
        const pl = all.filter(r => !ps2IsWalkover(r)), w = pl.filter(r => r.won).length, n = pl.length;
        const others = []; const vsAll = (i ? m.p2StyleMeetings : m.p1StyleMeetings) || {};
        Object.keys(vsAll).forEach(l => { if (l !== R.oppLab) psFilter(vsAll[l] || [], S, ref, tms[i]).forEach(r => { if (!ps2IsWalkover(r)) others.push(r); }); });
        const ow = others.filter(r => r.won).length, on = others.length;
        if (!n) avgTxt = 'No matches for these filters';
        else {
          rec = w + '–' + (n - w); const g = maGate(n).mode, og = maGate(on).mode;
          rate = g === 'nopct' ? DASH : Math.round(w / n * 100) + '%'; rateC = g === 'full' ? 'var(--ma2-white)' : 'var(--ma2-grey)';
          const oR = og === 'full' || og === 'small' ? Math.round(ow / on * 100) : null;   // n = 0 is 'none': never NaN
          if (g !== 'nopct' && oR != null) { const dd = Math.round(w / n * 100) - oR, gw = Math.min(46, Math.abs(dd) / 40 * 46);
            od = dd === 0 ? '0 pts' : (dd > 0 ? '+' : '−') + Math.abs(dd) + ' pts'; oc = dd > 0 ? 'var(--ma2-green)' : dd < 0 ? 'var(--ma2-red)' : 'var(--ma2-grey)'; gL = dd >= 0 ? 50 : 50 - gw; gW = gw; }
          avgTxt = oR == null ? (on ? 'Only ' + on + ' matches against other styles' : 'No matches against other styles') : 'He wins ' + oR + '% against all other styles';
        }
      }
      boxes.push('<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:12px; padding:20px; display:flex; flex-direction:column; gap:16px; min-width:0;">' + headP
        + '<div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr); gap:8px;">' + tileP('Record', rec, rec === DASH ? 'var(--ma2-quiet)' : null) + tileP('Win rate', rate, rateC, rec !== DASH && maGate(+rec.split('–')[0] + +rec.split('–')[1]).mode === 'small' ? 'small sample' : '') + tileP('Vs other styles', od, od === DASH ? 'var(--ma2-quiet)' : oc) + '</div>'
        + '<div style="display:flex; flex-direction:column; gap:9px;"><span style="position:relative; display:block; height:14px;"><span style="position:absolute; left:0; right:0; top:4px; height:6px; border-radius:3px; background:' + W(7) + ';"></span>'
        + '<span style="position:absolute; top:4px; height:6px; border-radius:3px; background:' + oc + '; left:' + gL.toFixed(1) + '%; width:' + gW.toFixed(1) + '%;"></span><span style="position:absolute; left:50%; top:0; width:1.5px; margin-left:-0.75px; height:14px; background:var(--ma2-soft);"></span></span>'
        + '<span style="font-size:12.5px; color:var(--ma2-grey); text-align:center;">' + esc(avgTxt) + '</span></div></div>');
      lists.push(psList(m, i, R, list, S, vs));
    });
    const scope = [S.rw === 'w52' ? 'Last 52 weeks' : 'Career', S.rs === 'all' ? 'all surfaces' : S.rs, S.sp === 'all' ? 'all court speeds' : S.sp.toLowerCase() + ' courts', S.lv === 'all' ? '' : S.lv, S.rk === 'all' ? '' : 'opponents in the top ' + S.rk, S.fm === 'all' ? '' : 'best of ' + S.fm].filter(Boolean).join(' · ');
    const lines = '<span style="display:flex; flex-direction:column; align-items:center; gap:3px;"><span style="width:14px; height:1.5px; border-radius:1px; background:var(--ma2-soft);"></span><span style="width:10px; height:1.5px; border-radius:1px; background:var(--ma2-soft);"></span><span style="width:6px; height:1.5px; border-radius:1px; background:var(--ma2-soft);"></span></span>';
    const fbtn = '<span class="seg ma2-btn2" role="button" tabindex="0" onclick="ps2Set({filt:' + !S.filt + '})" title="Filters" style="flex:none; margin-left:auto; display:flex; align-items:center; gap:9px; height:34px; box-sizing:border-box; padding:0 13px; border-radius:9px; border:1px solid ' + W(S.filt ? 22 : 14) + '; background:var(--ma2-lifted); font-size:12.5px; font-weight:600; color:var(--ma2-white); cursor:pointer;">' + lines + 'Filters'
      + (nF ? '<span style="' + MONO + ' font-size:10.5px; font-weight:700; color:var(--ma2-ground); background:var(--ma2-text); border-radius:6px; padding:1px 6px;">' + nF + '</span>' : '') + '</span>';
    const sum = (nF ? nF + (nF === 1 ? ' filter set' : ' filters set') + ' · applies to both players' : 'No filters set · every career match') + (missAll ? ' · ' + missAll + (missAll === 1 ? ' match' : ' matches') + ' with no data for a filter left out' : '');
    const panel = S.filt ? '<div style="display:flex; flex-direction:column; background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px;"><div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(400px,100%),1fr)); gap:16px 28px; padding:18px;">'
      + grp('Window', 'rw', [['w52', 'Last 52 weeks'], ['career', 'Career']]) + grp('Surface', 'rs', [['all', 'All'], ['Hard', 'Hard'], ['Indoor hard', 'Indoor hard'], ['Clay', 'Clay'], ['Grass', 'Grass']])
      + grp('Court speed', 'sp', [['all', 'All'], ['Slow', 'Slow'], ['Medium', 'Medium'], ['Fast', 'Fast']]) + grp('Tournament level', 'lv', [['all', 'All'], ['Grand Slam', 'Grand Slam'], ['Masters 1000', 'Masters 1000'], ['ATP 500', 'ATP 500'], ['ATP 250', 'ATP 250']])
      + grp('Opponent ranking', 'rk', [['all', 'All'], ['10', 'Top 10'], ['50', 'Top 50'], ['100', 'Top 100']]) + grp('Format', 'fm', [['all', 'All'], ['3', 'Best of 3'], ['5', 'Best of 5']]) + '</div>'
      + '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px 12px; padding:12px 18px 14px; border-top:1px solid ' + W(6) + ';"><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(sum) + '</span><span style="margin-left:auto; display:flex; align-items:center; gap:8px;">'
      + btn('Reset filters', nF ? "ps2Set({rw:'career',rs:'all',sp:'all',lv:'all',rk:'all',fm:'all',moreA:false,moreB:false})" : '', { color: nF ? 'var(--ma2-white)' : 'var(--ma2-grey)' }) + btn('Done', 'ps2Set({filt:false})', { color: 'var(--ma2-white)' }) + '</span></div></div>' : '';
    return fcard('<div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap;">Record against each style</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(scope) + '</span>' + fbtn + '</div>'
      + panel + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr)); gap:14px; align-items:stretch;">' + boxes.join('') + '</div>'
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(440px,100%),1fr)); gap:14px; align-items:stretch;">' + lists.join('') + '</div>');
  }
  const PS_G = 'display:grid; grid-template-columns:44px minmax(0,0.8fr) minmax(0,1.7fr) 46px 34px 34px 8px; gap:0 8px; align-items:center; padding:9px 20px;';
  function psList(m, i, R, rows, S, vs) {
    const name = i ? m.p2 : m.p1, key = i ? m.p2Key : m.p1Key, more = !!S[i ? 'moreB' : 'moreA'];
    const ready = R.state === 'ready', total = rows.length, vis = more ? rows : rows.slice(0, PS2_ROWS_SHOWN), rest = total - PS2_ROWS_SHOWN;
    const jst = typeof _sfDbJoinSt !== 'undefined' ? _sfDbJoinSt : null;
    if (jst == null && typeof sfDbPxLoad === 'function') sfDbPxLoad().then(() => ps2Set({})).catch(() => {});
    const px = jst === 'ready' && typeof sfDbPxRows === 'function' ? sfDbPxRows(key, name, vis.map(r => ({ date: ps2IsWalkover(r) ? null : r.date, won: !!r.won, round: psRoundAbbr(r.round) || null, opp: r.opponent }))) : vis.map(() => null);
    const cell = (k, s2) => { if (jst !== 'ready' && jst !== 'failed') return ''; const d = px[k]; return d ? fhOdd(s2 ? d.oppPrice : d.price) : DASH; };
    let body = '';
    psGroupMeetings(vis).forEach(gp => {
      const meta = psTourMeta(gp.tournament), surf = gp.rows[0].surface, sd = surf ? surf.charAt(0).toUpperCase() + surf.slice(1) : '';
      body += '<div style="display:flex; align-items:baseline; gap:9px; padding:13px 20px 6px; border-top:1px solid ' + W(6) + '; min-width:0;"><span style="font-size:12.5px; font-weight:700; color:var(--ma2-white); white-space:nowrap;">' + esc(gp.tournament) + '</span><span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc([gp.year, sd, meta && meta.tier].filter(Boolean).join(' · ')) + '</span></div>';
      gp.rows.forEach(r => { const k = vis.indexOf(r), wo = ps2IsWalkover(r), x = wo ? null : ps2Meeting(r), c = r.won ? 'var(--ma2-green)' : 'var(--ma2-red)';
        const opp = typeof fhOppFmt === 'function' ? (n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : n; })(r.opponent) : r.opponent;
        const click = wo ? '' : maRowOnclick({ key, name, ek: null, date: r.date, opp: r.opponent, fallback: { date: r.date, tourn: r.tournament, surface: sd || null, round: psRoundAbbr(r.round) || null, won: !!r.won, sets: x.gs.length ? x.gs : null, ret: x.ret,
          price: px[k] ? px[k].price : null, oppPrice: px[k] ? px[k].oppPrice : null } });
        body += '<div class="seg ma2-row"' + click + (wo ? '' : ' title="Open the match statistics"') + ' style="' + PS_G + ' cursor:' + (wo ? 'default' : 'pointer') + ';">'
          + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + esc(psFmtMeetDate(r.date)) + (wo ? '<span title="Walkover: not a match played, counted in no record" style="display:block; font-size:10px; font-weight:700;">WO</span>' : '') + '</span>'
          + '<span title="' + esc(r.opponent) + '" style="font-size:12.5px; font-weight:600; color:var(--ma2-text); overflow-wrap:anywhere; min-width:0;">' + esc(opp) + '</span>'
          + '<span title="' + esc(wo ? 'Walkover' : x.scores + (x.ret ? ' ret.' : '')) + '" style="' + MONO + ' font-size:11.5px; color:var(--ma2-soft); line-height:1.35;">' + (wo ? '–' : x.scores.split(', ').map((t, j, a) => '<span style="white-space:nowrap;">' + esc(t) + (j < a.length - 1 ? ',' : '') + '</span>').join(' ') + (x.ret ? ' ret.' : '')) + '</span>'
          + '<span style="justify-self:center; ' + MONO + ' font-size:11.5px; font-weight:700; color:' + (wo ? 'var(--ma2-quiet)' : c) + '; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:6px; padding:1px 7px; white-space:nowrap;">' + (wo ? '–' : x.pS + '–' + x.oS) + '</span>'
          + '<span' + (!wo && px[k] && typeof fhSrcTitle === 'function' ? ' title="' + esc(fhSrcTitle(px[k])) + '"' : '') + ' style="' + MONO + ' font-size:11.5px; color:var(--ma2-text); text-align:right;">' + (wo ? DASH : cell(k, false)) + '</span>'
          + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey); text-align:right;">' + (wo ? DASH : cell(k, true)) + '</span>'
          + '<span style="color:var(--ma2-quiet); font-size:14px; font-weight:700;">' + (wo ? '' : '›') + '</span></div>'; });
    });
    const woN = rows.filter(ps2IsWalkover).length;
    const chipT = !ready ? '' : 'Showing ' + vis.length + ' of ' + total + (woN ? ' · ' + woN + ' w/o' : '');
    const hd2 = '<div style="' + PS_G + ' border-top:1px solid ' + W(6) + '; font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span>Date</span><span>Opponent</span><span>Score</span><span style="text-align:center;">Sets</span><span title="His closing price" style="text-align:right;">Price</span><span title="The opponent\'s closing price" style="text-align:right;">Opp.</span><span></span></div>';
    const empty = !ready ? '<div style="padding:26px 20px; text-align:center; font-size:12.5px; color:var(--ma2-grey); border-top:1px solid ' + W(6) + ';">' + esc(R.state === 'loading' ? 'Loading career meetings…' : 'Playing style not classified') + '</div>'
      : !total ? '<div style="padding:26px 20px; text-align:center; font-size:12.5px; color:var(--ma2-grey); border-top:1px solid ' + W(6) + ';">No matches for these filters.</div>' : '';
    const ml = rest > 0 ? (more ? 'Show fewer' : 'Show ' + rest + ' more matches') : 'All matches shown';
    return '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; min-width:0;">'
      + '<div style="display:flex; align-items:center; gap:12px; padding:18px 20px 16px; min-width:0;">' + av(name, key, 40, i ? RING_B(2) : RING_A(2), 11.5)
      + '<div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;"><span style="font-size:15px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(name) + '</span><span style="font-size:12.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc((S.rw === 'w52' ? 'Last 52 weeks' : 'Career') + ' matches against ' + vs) + '</span></div>'
      + (chipT ? '<span style="flex:none; font-size:11.5px; font-weight:600; color:var(--ma2-soft); background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:8px; padding:4px 10px; white-space:nowrap;">' + esc(chipT) + '</span>' : '') + '</div>'
      + hd2 + '<div style="display:flex; flex-direction:column;">' + body + '</div>' + empty
      + '<div style="margin-top:auto; display:flex; justify-content:center; padding:12px 20px 16px; border-top:1px solid ' + W(6) + ';">' + btn(ml, rest > 0 ? 'ps2Set({' + (i ? 'moreB' : 'moreA') + ':' + !more + '})' : '', { color: rest > 0 ? 'var(--ma2-white)' : 'var(--ma2-grey)' }) + '</div></div>';
  }
  function maStyleV2(m) {
    const S = psSt(m);
    if (!m._ps2Loaded && !Object.keys((typeof playerStyles !== 'undefined' && playerStyles && playerStyles.byKey) || {}).length) return '<div class="acomingsoon">Loading playing styles…</div>';
    return '<div style="display:flex; flex-direction:column; gap:14px; max-width:1040px; margin:0 auto; font-size:14px; line-height:normal; color:var(--ma2-text);">' + psDnaCard(m, S) + psRecordCard(m, S) + '</div>';
  }
  root.maStyleV2 = maStyleV2;

  // ===================================================================================================
  // PROGRESSION (LOCKED 2026-11-22): "Facing" round track → Road to the <round> (one box per player, three tiles, rows,
  // this match last) → Round by round (round track, measures menu, summary box, metric boxes two per line).
  // Data = pgModel (career-history at this event, main draw only, this match excluded; box scores through the house
  // formulas; pooled averages; draw average from tournament-progression.json). The design's "Sample" chip never ships.
  const PG_SH = { dominance: 'Dominance', serveRating: 'Serve rating', returnRating: 'Return rating', firstServe: '1st serve %', firstServeWon: '1st serve won', secondServeWon: '2nd serve won', wue: 'W / UE', winners: 'Winners', pressure: 'Pressure points' };
  root.ma2PgPick = i => { if (typeof _pg !== 'undefined' && _pg) { _pg.hi = i; pgRender(); } };
  root.ma2PgMenu = () => { if (typeof _pg !== 'undefined' && _pg) { _pg.menu = !_pg.menu; pgRender(); } };
  function pgFacing(P, hi) {
    if (!P.facing) return '';
    const opp = c => (c.r ? fhSurname(c.r.opp) || c.r.opp : DASH);
    const what = (p, c) => p.short + (c.r ? (c.r.wo ? ' walkover v ' : c.r.won ? ' beat ' : ' lost to ') + c.r.opp : ' no result on record for this round');
    const items = (P.isEmpty ? [] : P.labels.map((l, j) => ({ label: l + ' · ' + opp(P.roads[0].cells[j]) + ' / ' + opp(P.roads[1].cells[j]), on: hi === j,
      title: l + ': ' + what(P.roads[0], P.roads[0].cells[j]) + ' · ' + what(P.roads[1], P.roads[1].cells[j]), onclick: 'pgHi(' + j + ')' })))
      .concat([{ label: P.facing, on: hi == null, title: P.facing + ' · this match', onclick: hi == null ? '' : 'ma2PgPick(null)' }]);
    return '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-grey);">Facing</span>' + track(items, { gap: 3 }) + '</div>';
  }
  const PG_RG = 'display:grid; grid-template-columns:34px minmax(0,1.5fr) minmax(80px,1fr) 44px 44px 40px; gap:10px; align-items:center;';
  function pgRoadBox(m, P, p, k, hi) {
    const ring = k ? SH_B() : SH_A(), aHead = aHeaderOdds(m);
    const ok = v => Number.isFinite(+v) && +v >= 1.01 ? +v : null, today = ok(k ? aHead.p2 : aHead.p1), oth = ok(k ? aHead.p1 : aHead.p2);
    const styleOf = (name, key) => { const s = ppStyleFor(name, key); return s && s.archetype_label ? s.archetype_label : null; };
    const real = p.cells.filter(c => c.r && !c.r.wo), sw = real.reduce((a, c) => a + (c.r.pS || 0), 0), sl = real.reduce((a, c) => a + (c.r.oS || 0), 0);
    const dr = pgPool(real.map(c => c.r.pg ? c.r.pg.dominance : null), { key: 'dominance', kind: 'ratio' });
    const priced = real.filter(c => c.r.price != null), avgP = priced.length ? priced.reduce((a, c) => a + c.r.price, 0) / priced.length : null;
    const tl = (l, v, n) => '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:11px; padding:13px 6px 12px; display:flex; flex-direction:column; align-items:center; gap:3px; text-align:center; min-width:0;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + l + '</span><span style="' + MONO + ' font-size:20px; font-weight:700; line-height:1.15; color:' + (v === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + ';">' + v + '</span><span style="font-size:11.5px; color:var(--ma2-grey);">' + esc(n) + '</span></div>';
    const fav = (own, opp) => own != null && opp != null ? own <= opp : null;
    const prc = (v, isFav, r) => '<span' + (r ? ' title="' + esc(v == null ? (typeof sfNoPriceReason === 'function' ? sfNoPriceReason(r) : 'No closing price on record') : fhSrcTitle(r)) + '"' : '') + ' style="text-align:right; ' + MONO + ' font-size:12px; font-weight:' + (isFav ? 700 : 500) + '; color:' + (v == null ? 'var(--ma2-quiet)' : isFav ? 'var(--ma2-text)' : 'var(--ma2-grey)') + ';">' + (v == null ? DASH : fhOdd(v)) + '</span>';
    const rows = p.cells.map((c, i) => {
      const lifted = hi === i;
      if (c.bye || c.missing) return '<div title="' + esc(c.rd + (c.bye ? ' · bye' : ' · no match on record for ' + p.name + ' in this round')) + '" style="' + PG_RG + ' margin:0 8px; padding:8px 10px; border:1px solid transparent; border-radius:8px; background:' + (lifted ? 'var(--ma2-lifted)' : 'transparent') + ';">'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-quiet);">' + c.rd + '</span><span style="display:flex; flex-direction:column; gap:1px;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-quiet);">' + (c.bye ? 'Bye' : DASH) + '</span><span style="font-size:11.5px; color:var(--ma2-quiet);">' + (c.bye ? 'No match played' : 'No record of this round') + '</span></span>'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-quiet);">' + DASH + '</span><span></span><span></span><span></span></div>';
      const r = c.r, sty = styleOf(r.opp, r.oppKey), f = fav(r.price, r.oppPrice), d = r.pg && r.pg.dominance && r.pg.dominance.v != null ? r.pg.dominance.v.toFixed(2) : DASH;
      const sc = r.wo ? 'w/o' : r.sets ? r.sets.map(x => x[0] + '-' + x[1]).join(', ') + (r.ret ? ' ret.' : '') : DASH;
      const click = maRowOnclick({ key: p.key, name: p.name, opp: r.opp, ek: r.ek, date: r.date, round: c.rd, fallback: { date: r.date, tourn: r.tourn, surface: r.surface, round: r.round, won: r.won, result: r.result, sets: r.sets, wo: r.wo, ret: r.ret } });
      return '<div class="seg ma2-row"' + click + ' title="' + esc(c.rd + ' · ' + (r.wo ? 'walkover v' : r.won ? 'beat' : 'lost to') + ' ' + r.opp + (r.wo ? '' : ' ' + sc) + ' · click for match stats') + '" style="' + PG_RG + ' margin:0 8px; padding:8px 10px; border-radius:8px; border:1px solid transparent; background:' + (lifted ? 'var(--ma2-lifted)' : 'transparent') + '; cursor:pointer;">'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + c.rd + '</span>'
        + '<span style="min-width:0; display:flex; flex-direction:column; gap:1px;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-text); overflow-wrap:anywhere;">' + esc(r.opp) + '</span><span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"' + (sty ? '' : ' title="No playing style on file"') + '>' + esc(sty || DASH) + '</span></span>'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-soft); line-height:1.35;">' + esc(sc) + '</span>'
        + (r.wo ? '<span style="text-align:right; color:var(--ma2-quiet);">' + DASH + '</span><span style="text-align:right; color:var(--ma2-quiet);">' + DASH + '</span>' : prc(r.price, f === true, r) + prc(r.oppPrice, f === false, r))
        + '<span style="text-align:right; ' + MONO + ' font-size:12.5px; font-weight:700; color:' + (d === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + ';">' + d + '</span></div>';
    }).join('');
    const opp = k ? m.p1 : m.p2, osty = styleOf(opp, k ? m.p1Key : m.p2Key), nf = fav(today, oth);
    const now = '<div data-pgnow="true" title="' + esc(P.facing + ' · this match') + '" style="' + PG_RG + ' margin:0 8px; padding:8px 10px; border-radius:8px; background:var(--ma2-lifted); border:1px solid ' + W(14) + ';">'
      + '<span style="' + MONO + ' font-size:11.5px; font-weight:700; color:var(--ma2-text);">' + P.facing + '</span>'
      + '<span style="min-width:0; display:flex; flex-direction:column; gap:1px;"><span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); overflow-wrap:anywhere;">' + esc(opp) + '</span><span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(osty || DASH) + '</span></span>'
      + '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">This match</span>' + prc(today, nf === true) + prc(oth, nf === false)
      + '<span style="text-align:right; ' + MONO + ' font-size:12px; color:var(--ma2-quiet);">' + DASH + '</span></div>';
    return '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding-bottom:8px; display:flex; flex-direction:column; min-width:0;">'
      + '<div style="display:flex; align-items:center; gap:12px; min-width:0; padding:18px 18px 16px;">' + av(p.name, p.key, 40, ring, 12)
      + '<div style="min-width:0; display:flex; flex-direction:column; gap:2px;"><span style="font-size:15px; font-weight:800; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(p.name) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(p.rec) + '</span></div>'
      + '<div style="flex:none; margin-left:auto; display:flex; flex-direction:column; align-items:flex-end; gap:1px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Today</span><span style="' + MONO + ' font-size:20px; font-weight:700; line-height:1.1; color:' + (today == null ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + ';">' + (today == null ? DASH : today.toFixed(2)) + '</span></div></div>'
      + '<div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; padding:0 18px 16px;">'
      + tl('Sets dropped', real.length ? String(sl) : DASH, 'of ' + (sw + sl) + ' played') + tl('Average DR', dr.v == null ? DASH : dr.v.toFixed(2), dr.n + (dr.n === 1 ? ' match' : ' matches'))
      + tl('Average price', avgP == null ? DASH : avgP.toFixed(2), priced.length < real.length ? priced.length + ' of ' + real.length + ' priced' : 'Closing price') + '</div>'
      + '<div style="' + PG_RG + ' padding:9px 18px; border-top:1px solid ' + W(6) + '; border-bottom:1px solid ' + W(6) + '; margin-bottom:6px; font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span>Rd</span><span>Opponent</span><span>Score</span><span style="text-align:right;">Price</span><span style="text-align:right;">Opp</span><span style="text-align:right;" title="Dominance ratio">DR</span></div>'
      + rows + now + '</div>';
  }
  function maProgressionV2(m) {
    const st = pgState(m);
    if (!m._pg) { pgEnsureData(m).then(() => { if (_pg && _pg.m === m) pgRender(); }); return '<div class="acomingsoon">Loading tournament progression…</div>'; }
    const P = pgModel(m), ev = typeof sfEventName === 'function' ? sfEventName(P.tourn) : P.tourn;
    const wrap = inner => '<div style="display:flex; flex-direction:column; gap:14px; width:100%; max-width:1040px; margin:0 auto; font-size:14px; line-height:normal; color:var(--ma2-text);">' + inner + '</div>';
    if (P.isEmpty) return wrap(pgFacing(P, null) + '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:56px 24px; display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center;">'
      + '<span style="font-size:18px; font-weight:800; color:var(--ma2-text);">' + esc(P.emptyTitle) + '</span><span style="font-size:12.5px; color:var(--ma2-grey); max-width:460px; line-height:1.6; text-wrap:pretty;">' + esc(P.emptyBody) + '</span></div>');
    const n = P.n, hi = st.hi != null && st.hi < n ? st.hi : null;
    const road = fcard('<div style="display:flex; flex-direction:column; gap:4px;"><div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text);">Road to the ' + esc(P.long) + '</span>'
      + help('Every match each player played at this tournament on the way to this one, with the closing prices and his dominance ratio. Click a match for its match stats.') + '</div><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(ev + ' · ' + P.sub) + '</span></div>'
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(400px,100%),1fr)); gap:10px;">' + P.roads.map((p, k) => pgRoadBox(m, P, p, k, hi)).join('') + '</div>');
    // round by round
    const sel = st.met, shown = P.metrics.filter(x => !sel || sel[x.mt.key]);
    const fmtD = (d, mt) => mt.kind === 'num' ? String(Math.round(d)) : mt.kind === 'ratio' ? d.toFixed(2) : d.toFixed(1) + ' pts';
    const leadOf = x => { const a = hi != null ? (x.series[0][hi] || {}).v : x.avg[0].v, b = hi != null ? (x.series[1][hi] || {}).v : x.avg[1].v;
      if (a == null || b == null) return { s: 0, txt: 'No comparison', who: '' };
      const d = a - b; return d === 0 ? { s: 0, txt: 'level', who: 'Both' } : { s: d > 0 ? 1 : -1, txt: 'leads by ' + fmtD(Math.abs(d), x.mt), who: d > 0 ? P.aS : P.bS }; };
    const leads = shown.map(leadOf), sa = leads.filter(l => l.s > 0).length, sb = leads.filter(l => l.s < 0).length;
    const cols = '132px repeat(' + n + ',minmax(44px,1fr)) 60px', minW = 192 + n * 44 + (n + 1) * 6;
    const roundTr = track([{ label: 'All rounds', on: hi == null, onclick: 'ma2PgPick(null)' }].concat(P.labels.map((l, i) => ({ label: l, on: hi === i, onclick: 'ma2PgPick(' + i + ')' }))), { gap: 3 });
    const menu = st.menu ? '<div onclick="ma2PgMenu()" style="position:fixed; inset:0; z-index:40;"></div><div style="position:absolute; top:40px; right:0; z-index:41; min-width:230px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:12px; padding:6px; display:flex; flex-direction:column; box-shadow:0 12px 32px color-mix(in srgb, var(--ma2-ground) 55%, transparent);">'
      + PG_METRICS.map(mt => { const on = !sel || !!sel[mt.key];
        return '<span class="seg ma2-row" role="button" tabindex="0" onclick="pgMet(\'' + mt.key + '\')" style="display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:8px; font-size:12.5px; font-weight:' + (on ? 700 : 600) + '; color:' + (on ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; cursor:pointer; white-space:nowrap;">'
          + '<span style="flex:none; width:16px; height:16px; border-radius:5px; box-sizing:border-box; background:' + (on ? 'var(--ma2-lifted)' : 'var(--ma2-track)') + '; border:1px solid ' + W(on ? 22 : 14) + '; display:flex; align-items:center; justify-content:center;"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--ma2-white)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity:' + (on ? 1 : 0) + ';"><path d="M2 5.2l2 2 4-4.4"></path></svg></span>' + esc(mt.name) + '</span>'; }).join('')
      + (sel ? '<span class="seg ma2-quietlink" role="button" tabindex="0" onclick="pgMetReset()" style="margin-top:4px; padding:10px 10px 6px; border-top:1px solid ' + W(6) + '; font-size:12.5px; font-weight:600; color:var(--ma2-grey); cursor:pointer;">Show all measures</span>' : '') + '</div>' : '';
    const metBtn = '<div style="position:relative; margin-left:auto; flex:none;"><span class="seg ma2-btn2" role="button" tabindex="0" onclick="ma2PgMenu()" style="height:34px; display:inline-flex; align-items:center; gap:8px; padding:0 12px 0 14px; border-radius:9px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; font-size:12.5px; font-weight:600; color:var(--ma2-text); white-space:nowrap; cursor:pointer;">'
      + (sel ? Object.keys(sel).length + ' of ' + PG_METRICS.length + ' measures' : 'All ' + PG_METRICS.length + ' measures') + '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--ma2-grey)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5l3 3 3-3"></path></svg></span>' + menu + '</div>';
    const sumBox = '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding:18px 20px; display:flex; flex-direction:column; gap:16px; min-width:0;"><div style="display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:16px;">'
      + '<div style="display:flex; align-items:center; gap:10px; min-width:0;">' + av(m.p1, m.p1Key, 32, SH_A(), 10.5) + '<span style="font-size:14px; font-weight:700; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0;">' + esc(P.aS) + '</span></div>'
      + '<div style="display:flex; flex-direction:column; align-items:center; gap:2px; text-align:center;"><span style="display:flex; align-items:baseline; gap:10px; ' + MONO + ' font-size:26px; font-weight:700; line-height:1.1;"><span style="color:' + (sa >= sb ? 'var(--ma2-text)' : 'var(--ma2-grey)') + ';">' + sa + '</span><span style="color:var(--ma2-quiet);">–</span><span style="color:' + (sb >= sa ? 'var(--ma2-text)' : 'var(--ma2-grey)') + ';">' + sb + '</span></span>'
      + '<span style="font-size:11.5px; color:var(--ma2-grey);">' + esc('Better figure in ' + shown.length + (shown.length === 1 ? ' measure' : ' measures') + (hi == null ? ' · average of all rounds' : ' · ' + P.labels[hi] + ' only')) + '</span></div>'
      + '<div style="display:flex; align-items:center; justify-content:flex-end; gap:10px; min-width:0;"><span style="font-size:14px; font-weight:700; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0;">' + esc(P.bS) + '</span>' + av(m.p2, m.p2Key, 32, SH_B(), 10.5) + '</div></div>'
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(92px,1fr)); gap:10px 6px;">' + shown.map((x, i) => '<div title="' + esc(x.mt.name + ' · ' + (leads[i].who ? leads[i].who + ' ' : '') + leads[i].txt) + '" style="display:flex; flex-direction:column; gap:7px; min-width:0;"><span style="height:6px; border-radius:3px; background:' + (leads[i].s > 0 ? 'var(--ma2-blue)' : leads[i].s < 0 ? 'var(--ma2-text)' : W(7)) + ';"></span><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(PG_SH[x.mt.key] || x.mt.name) + '</span></div>').join('') + '</div></div>';
    const boxes = shown.map((x, xi) => {
      const L = leads[xi], mt = x.mt;
      const head = '<div style="display:grid; grid-template-columns:' + cols + '; gap:6px; align-items:center; padding:9px 18px; border-top:1px solid ' + W(6) + '; border-bottom:1px solid ' + W(6) + '; margin-bottom:8px; font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span>Player</span>'
        + P.labels.map((l, i) => '<span class="seg ma2-seg" role="button" tabindex="0" onclick="ma2PgPick(' + (hi === i ? 'null' : i) + ')" title="Pick out this round" style="text-align:center; color:' + (hi === i ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; cursor:pointer;">' + l + '</span>').join('')
        + '<span style="text-align:right; padding-left:10px; border-left:1px solid ' + W(6) + ';">Avg</span></div>';
      const prow = (k) => { const p = P.roads[k], ser = x.series[k], oth = x.series[1 - k];
        const cells = ser.map((v, i) => { const f = pgFig(v, mt), c = p.cells[i];
          if (f.none) return '<span title="' + esc(c && c.r ? (c.r.pg ? 'No figure in this match’s box score' : 'No box score on file for this match') : c && c.bye ? 'Bye' : 'No record of this round') + '" style="display:flex; align-items:center; justify-content:center; height:30px; border-radius:7px; ' + MONO + ' font-size:12px; color:var(--ma2-quiet);">' + DASH + '</span>';
          const o = oth[i], lead = !o || o.v == null || v.v >= o.v, dim = hi != null && hi !== i;
          const r = c.r, click = maRowOnclick({ key: p.key, name: p.name, opp: r.opp, ek: r.ek, date: r.date, round: c.rd, fallback: { date: r.date, tourn: r.tourn, surface: r.surface, round: r.round, won: r.won, result: r.result, sets: r.sets, wo: r.wo, ret: r.ret } });
          const sc = r.sets ? r.sets.map(q => q[0] + '-' + q[1]).join(' ') : '';
          return '<span class="seg ma2-fbar"' + click + (f.small ? ' title="small sample' + (f.count ? f.count : '') + '"' : f.count ? ' title="' + esc(f.count.trim()) + '"' : '') + ' style="position:relative; display:flex; align-items:center; justify-content:center; height:30px; box-sizing:border-box; border-radius:7px; background:' + (lead && !dim ? 'var(--ma2-lifted)' : 'transparent') + '; border:1px solid ' + (lead && !dim ? W(14) : 'transparent') + '; ' + MONO + ' font-size:12px; font-weight:' + (lead ? 700 : 400) + '; color:' + (f.small ? 'var(--ma2-grey)' : dim ? (lead ? 'var(--ma2-grey)' : 'var(--ma2-quiet)') : lead ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; cursor:pointer;">' + esc(f.t)
            + '<span class="ma2-ftip" style="position:absolute; bottom:32px; left:50%; transform:translateX(-50%); z-index:30; align-items:baseline; gap:8px; padding:6px 10px; border-radius:8px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; box-shadow:0 12px 32px color-mix(in srgb, var(--ma2-ground) 55%, transparent); white-space:nowrap; font-family:\'Hanken Grotesk\',sans-serif; font-size:12.5px; font-weight:600; color:var(--ma2-text);">v ' + esc(r.opp) + '<span style="' + MONO + ' font-size:11.5px; font-weight:400; color:var(--ma2-grey);">' + esc(sc) + '</span></span></span>'; }).join('');
        const af = pgFig(x.avg[k], mt), nV = ser.filter(v => v && v.v != null).length, isLead = L.s === 0 ? true : (k === 0 ? L.s > 0 : L.s < 0);
        return '<div style="display:grid; grid-template-columns:' + cols + '; gap:6px; align-items:center; padding:4px 18px;"><span style="display:flex; align-items:center; gap:8px; min-width:0;">' + av(p.name, p.key, 22, k ? 'sh 1.5px var(--ma2-text)' : 'sh 1.5px var(--ma2-blue)', 8.5)
          + '<span style="font-size:12.5px; font-weight:600; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(p.short) + '</span></span>' + cells
          + '<span style="display:flex; align-items:center; justify-content:flex-end; gap:2px; height:30px; padding-left:10px; border-left:1px solid ' + W(6) + '; white-space:nowrap;"><span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + (af.none ? 'var(--ma2-quiet)' : af.small || !isLead ? 'var(--ma2-grey)' : 'var(--ma2-text)') + ';">' + esc(af.t) + '</span>'
          + (nV < n ? '<span style="' + MONO + ' font-size:10px; color:var(--ma2-grey);">(' + nV + ')</span>' : '') + '</span></div>'; };
      const fc = x.f.map(d => { const f = mt.noDraw ? { t: DASH } : pgDrawFig(d, mt); return '<span title="' + esc(mt.noDraw ? PG_DRAW_PRESSURE_TIP : P.draw ? '' : PG_NO_DRAW) + '" style="text-align:center; ' + MONO + ' font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">' + esc(f.t) + '</span>'; }).join('');
      const fa = mt.noDraw || !x.fAvg ? { t: DASH } : pgDrawFig(x.fAvg, mt);
      return '<div data-pgcard="metric" style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding-bottom:10px; min-width:0; display:flex; flex-direction:column;">'
        + '<div style="display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:2px 10px; padding:14px 18px 12px;"><span style="font-size:14px; font-weight:700; color:var(--ma2-text);">' + esc(mt.name) + '</span><span title="' + esc(mt.kind === 'pct' ? 'Percentage points' : mt.kind === 'ratio' ? 'Ratio' : 'Rating points') + '" style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;"><span style="font-weight:600; color:var(--ma2-soft);">' + esc(L.who) + '</span> ' + esc(L.txt) + '</span></div>'
        + '<div style="overflow-x:auto;"><div style="min-width:' + minW + 'px;">' + head + prow(0) + prow(1)
        + '<div style="display:grid; grid-template-columns:' + cols + '; gap:6px; align-items:center; margin-top:8px; padding:10px 18px 0; border-top:1px solid ' + W(6) + ';"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">Draw average</span>' + fc
        + '<span title="' + esc(mt.noDraw ? PG_DRAW_PRESSURE_TIP : '') + '" style="text-align:right; padding-left:10px; border-left:1px solid ' + W(6) + '; ' + MONO + ' font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">' + esc(fa.t) + '</span></div></div></div></div>';
    }).join('');
    const rbr = fcard('<div style="display:flex; flex-direction:column; gap:4px;"><div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text);">Round by round</span>'
      + help('The lifted figure is the better of the two players in that round. Draw average = every player still in the draw at that round. Hover a figure to see the opponent, click it for the match stats. Pick a round to compare that round only.') + '</div>'
      + '<span style="font-size:12.5px; color:var(--ma2-grey);">Each player\'s figures in every round played here, against the draw average</span></div>'
      + '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px;">' + roundTr + metBtn + '</div>' + sumBox
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr)); gap:10px;">' + boxes + '</div>'
      // modal-progression.md D2 / G15: the small-sample footnote under the cards whenever a 5–9 figure is greyed
      + (shown.some(x => x.series.some(ser => ser.some(v => v && pgFig(v, x.mt).small)) || [0, 1].some(k => pgFig(x.avg[k], x.mt).small))
        ? '<span class="pg-foot" style="font-size:11.5px; color:var(--ma2-grey);">Grey = small sample (5–9): hover a figure for its count.</span>' : ''));
    return wrap(pgFacing(P, hi) + road + rbr);
  }
  root.maProgressionV2 = maProgressionV2;

  // ===================================================================================================
  // TOURNAMENT (LOCKED 2026-11-21): head card (+ "Show court speed & market": court speed card with the CPI switch on
  // Masters 1000, ROI favourites / underdogs → the Database ROI box, favourite reliability) → record card (career; "On
  // similar courts" = every event with the same surface + our speed class). Data: trModelFor (the pipeline's history at
  // the event, priced on the one Database join), tournament-market.json, court-speed-history.json (the Tournaments page's
  // yearly readings + CPI), career-history for the similar-courts record.
  const CSH = { d: undefined, p: null };
  function cshLoad() {
    if (CSH.d !== undefined || CSH.p) return;
    CSH.p = fetch('./court-speed-history.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(d => { CSH.d = d && d.ta ? d : null; CSH.p = null; if (typeof _tr !== 'undefined' && _tr) trRender(); });
  }
  const CPI_EV = ['Indian Wells', 'Miami', 'Monte Carlo', 'Madrid', 'Rome', 'Canadian Open', 'Cincinnati', 'Shanghai', 'Paris'];
  const cpiBand = v => (v < 30 ? 'Slow' : v < 35 ? 'Medium-slow' : v < 40 ? 'Medium' : v < 45 ? 'Medium-fast' : 'Fast');
  function cpiSeriesOf(key) {
    const d = CSH.d && CSH.d.cpi; if (!d || !key) return null;
    const k = key === 'Montreal' || key === 'Toronto' ? 'Canadian Open' : key;
    if (CPI_EV.indexOf(k) < 0) return null;
    const out = {}; (k === 'Canadian Open' ? [d.Montreal, d.Toronto] : [d[k]]).forEach(o => Object.entries(o || {}).forEach(([y, v]) => { if (v != null) out[y] = +v; }));
    return Object.keys(out).length ? out : null;
  }
  const catOf = k => (typeof TOURNAMENT_CATALOG !== 'undefined' ? TOURNAMENT_CATALOG.find(t => t.name === k) : null);
  function evClass(name) {
    const k = typeof sfEventKey === 'function' ? sfEventKey(name) : null, cc = k && typeof COURT_CONDITIONS !== 'undefined' ? COURT_CONDITIONS[k] : null, c = k ? catOf(k) : null;
    const surf = c ? (c.surface === 'hard' ? (c.indoor ? 'Indoor hard' : 'Hard') : c.surface.charAt(0).toUpperCase() + c.surface.slice(1)) : null;
    return { key: k, surf, cls: cc && cc.speed != null ? courtSpeedCategory(cc.speed) : null };
  }
  function trSimilar(m, i, cls0) {
    const key = i ? m.p2Key : m.p1Key, name = i ? m.p2 : m.p1, ch = (key != null && _careerHistoryShards[String(key)]) || null;
    if (!ch) return null;
    const ownEk = String(eventKeyOfMatch(m) || ''), rows = [];
    ch.forEach((x, j) => { if (!x || x.level !== 'atp' || x.qualifying || /^qualif/i.test(String(x.round || ''))) return;
      const c = evClass(x.tournament); if (!c.key || c.surf !== cls0.surf || c.cls !== cls0.cls) return;
      if (ownEk && String(x.eventKey) === ownEk && !m.finalScore) return;
      const r = meRowFromCareer(x, null, String(key), name, j); r.evKey = c.key; rows.push(r); });
    if (typeof trDbJoinPx === 'function') trDbJoinPx(name, ch)(rows);
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const eds = [], ix = {};
    rows.forEach(r => { const y = String(r.date).slice(0, 4), k = r.evKey + '|' + y; if (!ix[k]) { ix[k] = { ev: r.evKey, year: y, rows: [] }; eds.push(ix[k]); } ix[k].rows.push(r); });
    eds.forEach(e => { const pl = e.rows.filter(r => !r.wo), last = e.rows[0];
      e.won = pl.filter(r => r.won).length; e.lost = pl.length - e.won;
      e.result = !last ? '' : last.wo ? (last.round || '') + ' · w/o' : last.won ? (last.round === 'F' ? 'Won' : 'Won ' + (last.round || '') + ', no later match on record') : (TR_RESULT[last.round] || last.round || ''); });
    const core = window.MarketEdgeCore, all = rows, priced = core ? all.filter(core.inWinner) : [];
    const W = eds.reduce((s, e) => s + e.won, 0), L = eds.reduce((s, e) => s + e.lost, 0);
    let best = null; eds.forEach(e => { const last = e.rows[0], code = e.result === 'Won' ? 'Won' : last && !last.won && !last.wo ? last.round : null;
      if (code && TR_BEST_RANK[code] && (!best || TR_BEST_RANK[code] > TR_BEST_RANK[best.code])) best = { code, year: e.year, ev: e.ev }; });
    let sW = 0, sT = 0; all.forEach(r => { if (r.pS != null && !r.wo) { sW += r.pS; sT += r.pS + r.oS; } });
    return { name, key, eds, W, L, n: W + L, best, sW, sT, all, priced, units: priced.reduce((s, r) => s + core.plCents(r), 0) / 100, state: _sfDbJoinSt === 'ready' ? 'ready' : _sfDbJoinSt === 'failed' ? 'failed' : 'loading', names: [...new Set(eds.map(e => e.ev))] };
  }
  const TR_G = 'display:grid; grid-template-columns:52px minmax(0,1fr) 34px minmax(0,1.1fr) 56px 44px 44px 8px; gap:0 10px; align-items:center;';
  const SHORTR = { Won: 'Won', F: 'F', SF: 'SF', QF: 'QF', R16: 'R16', R32: 'R32', R64: 'R64', R128: 'R128' };
  function trBox(m, P, i, grp, clean, S) {
    const F = fhStateFor(m), more = !!S.recMoreAll, shown = more ? P.eds : P.eds.slice(0, TR_LIM);
    P.all.forEach(r => { F.sheetMap[r.mid] = { r, aName: P.name, aKey: P.key, bName: r.opp, bKey: r.oppKey }; });
    const g = maGate(P.n).mode, pct = !P.n ? 'no matches' : g === 'nopct' ? P.n + (P.n === 1 ? ' match' : ' matches') : Math.round(P.W / P.n * 100) + '% of ' + P.n + ' won';
    const first = P.eds.length ? P.eds[P.eds.length - 1].year : null;
    const sub = (grp ? 'On similar courts' : 'At ' + clean) + (first ? ' · since ' + first : '');
    const loading = P.state === 'loading' || P.state === 'idle', np = P.priced.length;
    const lpx = trLastPlayed(P), lp = lpx ? { e: { year: lpx.year } } : null, lr = lpx && lpx.row;   // h2h.md fix 1: the newest edition WITH a row
    const tile = (cap, v, sb, col, tip) => { const val = '<span style="' + MONO + ' font-size:17px; font-weight:700; line-height:1; color:' + (col || (v === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)')) + '; white-space:nowrap;">' + v + '</span>';
      return '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:11px; padding:13px 6px 12px; display:flex; flex-direction:column; align-items:center; text-align:center; gap:6px; min-width:0;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">' + cap + '</span>'
        + (tip ? maTipHtml('<span tabindex="0" style="display:inline-flex;">' + val + '</span>', tip, { wrap: 280, popStyle: 'bottom:calc(100% + 8px); left:auto; right:0; transform:none;' }) : val)
        + '<span title="' + esc(sb) + '" style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;">' + esc(sb) + '</span></div>'; };
    const core = window.MarketEdgeCore;
    // modal-analysis.md Tournament tab → Prices: the book split, matches after the archive's last day, vs market (D6)
    const nb = P.priced.filter(r => r.book === 'B').length, na = P.priced.filter(r => r.book === 'A' && r.src !== 'oth').length, nAfter = P.all.filter(r => r.pxAfter).length;
    const backTip = '<span style="' + MONO + ' font-size:11px; line-height:1.5;">' + np + ' of ' + P.all.length + ' matches priced · flat 1u at the closing price (the Database join): Pinnacle'
      + (na ? ', Pinnacle (approx.) snapshot where no close (' + na + ')' : '') + (nb ? ', Bet365 where missing (' + nb + ')' : '') + '.'
      + (nAfter ? ' ' + nAfter + ' after its last match (' + esc(trDayWords(P.dbEnd)) + ') not priced yet.' : '')
      + (np >= TR_VS_MKT_MIN ? ' vs market = win rate minus the market’s de-vigged implied win rate.' : ' vs market needs ' + TR_VS_MKT_MIN + ' priced matches.')
      + ' ' + esc(core ? core.RET_SETTLE_NOTE : '') + '</span>';
    const vmTxt = np >= TR_VS_MKT_MIN && P.vm != null ? meSg(P.vm, 1, 'pt') + ' vs market' + (maGate(np).mode === 'small' ? ' · small sample' : '') : '';
    const tiles = '<div style="display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; padding:0 18px 18px;">'
      + tile('Best result', P.best ? (SHORTR[P.best.code] || P.best.code) : DASH, P.best ? (grp && P.best.ev ? (typeof sfEventName === 'function' ? sfEventName(P.best.ev) : P.best.ev) + ' ' : '') + P.best.year : (P.eds.length ? 'no finished edition' : DASH))
      + tile('Sets won', P.sT ? P.sW + '–' + (P.sT - P.sW) : DASH, P.sT ? (maGate(P.sT).mode === 'nopct' ? P.sT + ' sets' : Math.round(P.sW / P.sT * 100) + '% of sets') : DASH)
      + tile('Last played', lp ? lp.e.year : DASH, lr ? (lr.wo ? 'walkover ' : lr.won ? 'won ' : 'lost ') + (lr.round || '') + ' v ' + fhSurname(lr.opp) : DASH)
      + (loading ? tile('Backing', DASH, 'loading prices') : P.state === 'failed' ? tile('Backing', DASH, 'prices unavailable')
        : tile('Backing', np ? signed(P.units, 1) + 'u' : DASH, vmTxt || (np ? 'flat 1u · ' + np + (np === 1 ? ' bet' : ' bets') : 'none priced'), np ? (P.units > 0 ? 'var(--ma2-green)' : P.units < 0 ? 'var(--ma2-red)' : 'var(--ma2-text)') : null, backTip)) + '</div>';
    let rows = '';
    shown.forEach(e => {
      const evName = grp ? (typeof sfEventName === 'function' ? sfEventName(e.ev) : e.ev) : clean;
      const c = grp ? evClass(e.ev) : null;
      rows += '<div style="display:flex; align-items:baseline; gap:9px; padding:14px 8px 7px; min-width:0; border-top:1px solid ' + W(6) + ';"><span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); white-space:nowrap;">' + esc(evName + ' ' + e.year) + '</span>'
        + '<span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc((c ? c.surf + ' · ' + c.cls + ' · ' : '') + (e.rows.length ? e.result + ' · ' + e.won + '–' + e.lost : 'Withdrawal')) + '</span></div>';
      e.rows.forEach(r => { const sel = !!(_fh && _fh.sheet === r.mid), wl = r.wo ? 'var(--ma2-quiet)' : r.won ? 'var(--ma2-green)' : 'var(--ma2-red)', mark = typeof fhPxMark === 'function' ? fhPxMark(r) : '';
        const px = v => r.pxPend ? '' : v == null ? DASH : fhOdd(v), pt = typeof trPxTitle === 'function' ? trPxTitle(r) : '';
        rows += '<div class="seg ma2-row"' + (r.wo ? '' : ' onclick="fhOpenSheet(\'' + esc(r.mid) + '\')" title="Open the match statistics"') + ' style="' + TR_G + ' padding:8px; border-top:1px solid ' + W(6) + '; background:' + (sel ? 'var(--ma2-lifted)' : 'transparent') + '; cursor:' + (r.wo ? 'default' : 'pointer') + ';">'
          + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + esc(fhDDMM(r.date) + '.') + (r.wo ? '<span title="Walkover: not a match played, counted in no record" style="display:block; font-size:10px; font-weight:700;">WO</span>' : '') + '</span>'
          + '<span title="' + esc(r.opp || '') + '" style="font-size:13px; font-weight:600; color:var(--ma2-text); overflow-wrap:anywhere; min-width:0;">' + esc(r.opp || DASH) + '</span>'
          + '<span style="' + MONO + ' font-size:11px; color:var(--ma2-grey);">' + esc(r.round || DASH) + '</span>'
          + '<span title="' + esc(fhH2hSetScores(r)) + '" style="' + MONO + ' font-size:11.5px; color:var(--ma2-soft); line-height:1.35;">' + String(fhH2hSetScores(r)).split(', ').map((x, j, a) => '<span style="white-space:nowrap;">' + esc(x) + (j < a.length - 1 ? ',' : '') + '</span>').join(' ') + '</span>'
          + '<span style="justify-self:center; ' + MONO + ' font-size:11.5px; font-weight:700; color:' + wl + '; background:var(--ma2-lifted); box-shadow:inset 0 0 0 1px ' + W(14) + '; border-radius:6px; padding:2px 8px; white-space:nowrap;">' + (r.wo || r.pS == null ? DASH : r.pS + '–' + r.oS) + '</span>'
          + '<span title="' + esc(pt) + '" style="position:relative; ' + MONO + ' font-size:11.5px; color:' + (r.price == null ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; text-align:right;">' + (r.wo ? DASH : px(r.price)) + (mark && !r.wo ? '<span aria-hidden="true" style="position:absolute; top:-3px; right:-8px; font-size:7px; font-weight:700; color:var(--ma2-grey);">' + mark + '</span>' : '') + '</span>'
          + '<span title="' + esc(pt) + '" style="' + MONO + ' font-size:11.5px; color:' + (r.oppPrice == null ? 'var(--ma2-quiet)' : 'var(--ma2-grey)') + '; text-align:right;">' + (r.wo ? DASH : px(r.oppPrice)) + '</span>'
          + '<span style="color:var(--ma2-quiet); font-size:14px;">' + (r.wo ? '' : '›') + '</span></div>'; });
    });
    const rest = P.eds.length - TR_LIM, any = S._restAny, unit = grp ? ['tournament', 'tournaments'] : ['edition', 'editions'];
    const ml = rest > 0 ? (more ? 'Show fewer' : 'Show ' + rest + ' earlier ' + unit[rest === 1 ? 0 : 1]) : 'All ' + unit[1] + ' shown';
    const empty = !P.eds.length ? '<div style="padding:22px; text-align:center; font-size:12.5px; color:var(--ma2-grey); border-top:1px solid ' + W(6) + ';">' + (grp ? 'No main-draw match on similar courts on record.' : P.hasHist ? 'No main-draw match at this event on record.' : 'No main-draw record at ' + esc(clean) + ' on file.') + '</div>' : '';
    return '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; display:flex; flex-direction:column; min-width:0; overflow:hidden;">'
      + '<div style="display:flex; align-items:center; gap:12px; padding:18px 18px 16px; min-width:0;">' + av(P.name, P.key, 38, '1px solid ' + W(14), 12.5)
      + '<div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;">' + fhNameLink(P.name, P.key, 'font-size:15px; font-weight:800; letter-spacing:-0.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;') + '<span title="' + esc(sub) + '" style="font-size:12.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(sub) + '</span></div>'
      + '<div style="flex:none; display:flex; flex-direction:column; align-items:flex-end; gap:3px;"><span style="' + MONO + ' font-size:24px; font-weight:700; line-height:1; color:' + (P.n ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + ';">' + (P.n ? P.W + '–' + P.L : DASH) + '</span><span' + (g === 'small' ? ' title="small sample · n=' + P.n + '"' : '') + ' style="font-size:12.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">' + esc(pct) + '</span></div></div>'
      + tiles + (P.eds.length ? '<div style="' + TR_G + ' padding:9px 18px; border-top:1px solid ' + W(6) + '; font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span>Date</span><span>Opponent</span><span>Rd</span><span>Score</span><span style="text-align:center;">Sets</span><span title="His closing price" style="text-align:right;">Price</span><span title="The opponent\'s closing price" style="text-align:right;">Opp.</span><span></span></div>'
        + '<div style="padding:0 10px 8px; display:flex; flex-direction:column;">' + rows + '</div>'
        // trSrcLine: counts the B marks actually drawn (folded editions excluded) — never a mark the reader cannot see
        + ((n => n ? '<div class="tr-srcline" style="padding:0 18px 10px; text-align:center; ' + MONO + ' font-size:10.5px; color:var(--ma2-grey);">Closing odds · Pinnacle, Bet365 where missing (' + n + ') · B = Bet365</div>' : '')((rows.match(/font-size:7px; font-weight:700; color:var\(--ma2-grey\);">B</g) || []).length)) : empty)
      + '<div style="margin-top:auto; display:flex; justify-content:center; padding:12px 18px 16px; border-top:1px solid ' + W(6) + ';">' + btn(any ? (more ? 'Show fewer' : rest > 0 ? ml : 'All ' + unit[1] + ' shown') : ml, any ? 'trSet({recMoreAll:' + !more + '})' : '', { color: any && (rest > 0 || more) ? 'var(--ma2-text)' : 'var(--ma2-grey)' }) + '</div></div>';
  }
  function maTournamentV2(m) {
    const E = trStateFor(m), S = E.S; cshLoad();
    // one source with the Tournaments page: the page's court-conditions row (its category = courtSpeedCategory of its speed
    // index, N4), else the match's pipeline copy (a frozen draw-store card can carry last season's row)
    const clean = trName(m), key = trKeyOf(m), cc = key && typeof COURT_CONDITIONS !== 'undefined' ? COURT_CONDITIONS[key] : null;
    const cs = cc ? Object.assign({}, cc, { category: courtSpeedCategory(cc.speed) }) : m.courtSpeed, mkt = trMarketFor(key), surf = fhSurfName(m.surface) || 'Hard';
    const loc = m.venue ? [m.venue.city, m.venue.country].filter(Boolean).join(', ') : '';
    const cat = catOf(key), indoor = cat ? !!cat.indoor : /indoor/i.test(String(m.surface || ''));
    const surfLbl = surf === 'Hard' && indoor ? 'Indoor hard' : surf;
    const ta = CSH.d && key ? CSH.d.ta[key] || null : null, taYs = ta ? Object.keys(ta).filter(y => ta[y] != null && +y >= 2020).sort() : [];   // the Tournaments page's window (2020–2026)
    const speedV = taYs.length ? +ta[taYs[taYs.length - 1]] : cs && cs.abstractSpeed != null ? +cs.abstractSpeed : null;
    const isM = m.venue && /1000/.test(String(m.venue.category || '')) || (cat && /1000/.test(String(cat.category || '')));
    const cpi = isM ? cpiSeriesOf(key) : null, cpiYs = cpi ? Object.keys(cpi).sort() : [], cpiNow = cpiYs.length ? cpi[cpiYs[cpiYs.length - 1]] : null;
    const dashT = t => '<span title="' + esc(t) + '" style="color:var(--ma2-quiet);">' + DASH + '</span>';
    const meta = [['Category', m.venue && m.venue.category ? esc(m.venue.category) : dashT('No category on record')],
      ['Court speed', speedV != null ? speedV.toFixed(2) + (cs && cs.category ? ' · ' + esc(cs.category) : '') : dashT(trSpeedNote(m))]]
      .concat(cpi ? [['CPI', cpiNow.toFixed(1) + ' · ' + cpiBand(cpiNow)]] : [])
      .concat([['Altitude', cs && cs.altitude != null ? Number(cs.altitude).toLocaleString('en-US') + ' m' : dashT(trSpeedNote(m))], ['Hold rate', trHoldHtml(m, 'tr-hold')], ['Round', trRoundWords(m) ? esc(trRoundWords(m)) : dashT('No round on record')]]);
    const note = cs && cs.category && typeof speedDescription === 'function' ? speedDescription(cs.category, String(m.surface || '').toLowerCase().includes('clay') ? 'clay' : String(m.surface || '').toLowerCase().includes('grass') ? 'grass' : 'hard') : '';
    const head = '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px; display:flex; flex-direction:column; gap:18px;">'
      + '<div style="display:flex; align-items:center; gap:14px 16px; flex-wrap:wrap;"><span style="flex:none; width:48px; height:48px; border-radius:12px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; display:flex; align-items:center; justify-content:center; ' + MONO + ' font-size:18px; font-weight:700; color:var(--ma2-text);">' + esc((clean[0] || 'T').toUpperCase()) + '</span>'
      + '<div style="flex:1 1 200px; min-width:0; display:flex; flex-direction:column; gap:3px;"><span style="font-size:20px; font-weight:800; letter-spacing:-0.01em;">' + esc(clean) + '</span><span style="font-size:13px; color:var(--ma2-grey);">' + esc([loc || DASH, surfLbl].join(' · ')) + '</span></div>'
      + '<div style="display:flex; gap:14px 28px; flex-wrap:wrap;">' + meta.map(x => '<div style="display:flex; flex-direction:column; gap:5px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">' + x[0] + '</span><span style="' + MONO + ' font-size:13.5px; font-weight:700; color:var(--ma2-text); white-space:nowrap;">' + x[1] + '</span></div>').join('') + '</div></div>'
      + '<div style="display:flex; align-items:center; justify-content:space-between; gap:14px 24px; flex-wrap:wrap; padding-top:18px; border-top:1px solid ' + W(6) + ';"><div style="flex:1 1 420px; min-width:0; font-size:13px; color:var(--ma2-grey); line-height:1.6; text-wrap:pretty; max-width:720px;">' + esc(note) + '</div>'
      + '<span class="seg ma2-btn2" role="button" tabindex="0" onclick="trSet({more:' + !S.more + '})" style="height:34px; padding:0 14px; display:inline-flex; align-items:center; gap:8px; border-radius:9px; background:var(--ma2-lifted); font-size:12.5px; font-weight:600; color:var(--ma2-text); cursor:pointer; white-space:nowrap; border:1px solid ' + W(14) + ';">'
      + (S.more ? 'Hide court speed & market' : 'Show court speed & market') + '<svg width="10" height="10" viewBox="0 0 10 10" style="transform:' + (S.more ? 'rotate(180deg)' : 'none') + '; color:var(--ma2-grey);"><path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"></path></svg></span></div></div>';
    let market = '';
    if (S.more) {
      const useCpi = !!(cpi && S.metric === 'cpi');
      const series = useCpi ? cpiYs.map(y => ({ y, v: cpi[y] })) : taYs.length ? taYs.map(y => ({ y, v: +ta[y] })) : TR_SPEED_YEARS.map(y => ({ y: String(y), v: cs && cs['as' + y] != null ? +cs['as' + y] : null })).filter(p => p.v != null);
      const big = useCpi ? cpiNow : speedV, band = useCpi ? (cpiNow != null ? cpiBand(cpiNow) : DASH) : cs && cs.category ? cs.category : DASH;
      const reg = typeof tourxConditionRegistry === 'function' ? tourxConditionRegistry().map(t => t.abstractSpeed) : [];
      const pos = big == null ? null : useCpi ? Math.max(0, Math.min(100, (big - 25) / 25 * 100)) : typeof tourxKnobPct === 'function' ? tourxKnobPct(big, reg) : null;
      const vals = series.map(p => p.v), mn = vals.length ? Math.min(...vals) : 0, sp = vals.length ? (Math.max(...vals) - mn) || 1 : 1;
      const X = i => 26 + i * (308 / Math.max(1, series.length - 1)), Y = v => 66 - (v - mn) / sp * 26;
      let word = DASH, delta = '';
      if (series.length > 1) { const d = +(series[series.length - 1].v - series[0].v).toFixed(2), yrs = +series[series.length - 1].y - +series[0].y, thr = useCpi ? 1 : 0.03;
        word = Math.abs(d) < thr ? 'Holding steady' : d > 0 ? 'Trending faster' : 'Trending slower'; delta = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(useCpi ? 1 : 2) + ' over ' + yrs + ' yr' + (yrs === 1 ? '' : 's'); }
      const pts = series.map((p, i) => ({ x: X(i), y: Y(p.v), v: p.v, yr: p.y }));
      // defect brief 2026-10-24 item 6: a season with no reading breaks the line (and its fill)
      const segs = []; pts.forEach((p, i) => { if (!i || +p.yr - +pts[i - 1].yr > 1) segs.push([]); segs[segs.length - 1].push(p); });
      const runs = segs.filter(g => g.length > 1);
      const poly = runs.map(g => g.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' '));
      const area = runs.map(g => 'M' + g[0].x.toFixed(1) + ',104 L' + g.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' L') + ' L' + g[g.length - 1].x.toFixed(1) + ',104 Z').join(' ');
      const tabs = cpi ? '<div style="display:inline-flex; gap:2px; background:var(--ma2-track); border:1px solid ' + W(10) + '; border-radius:8px; padding:2px; margin-bottom:18px;">'
        + [['speed', 'Court speed', 'Tennis Abstract court speed'], ['cpi', 'CPI', 'Court Pace Index, courtspeed.com']].map(t => { const on = (S.metric || 'speed') === t[0];
          return '<span class="seg ma2-seg" role="button" tabindex="0" onclick="trSet({metric:\'' + t[0] + '\'})" title="' + t[2] + '" style="padding:4px 10px; border-radius:6px; font-size:11.5px; font-weight:' + (on ? 700 : 600) + '; color:' + (on ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; background:' + (on ? 'var(--ma2-lifted)' : 'transparent') + '; box-shadow:inset 0 0 0 1px ' + (on ? W(14) : 'transparent') + '; cursor:pointer; white-space:nowrap;">' + t[1] + '</span>'; }).join('') + '</div>' : '';
      const speedCard = '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px; display:flex; flex-wrap:wrap; align-items:center; gap:22px 36px;">'
        + '<div style="flex:1 1 260px; min-width:0;">' + tabs + '<div style="display:flex; align-items:baseline; gap:14px;"><span style="' + MONO + ' font-size:40px; font-weight:700; line-height:1; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; color:' + (big == null ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + ';">' + (big == null ? DASH : big.toFixed(useCpi ? 1 : 2)) + '</span>'
        + '<span style="font-size:13px; color:var(--ma2-grey);">' + (useCpi ? 'Court Pace Index' : 'abstract court speed') + ' · <span style="color:var(--ma2-text); font-weight:700;">' + esc(band) + '</span></span></div>'
        + '<div style="position:relative; height:6px; border-radius:3px; background:' + W(7) + '; margin-top:20px;">' + (pos == null ? '' : '<span style="position:absolute; top:50%; left:' + pos + '%; width:14px; height:14px; box-sizing:border-box; border-radius:50%; background:var(--ma2-text); border:3px solid var(--ma2-card); transform:translate(-50%,-50%);"></span>') + '</div>'
        + '<div style="display:flex; justify-content:space-between; margin-top:11px; font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span>Slow</span><span>Medium</span><span>Fast</span></div>' + (big == null ? '<div style="font-size:11.5px; color:var(--ma2-grey); margin-top:9px;">' + esc(trSpeedNote(m)) + '</div>' : '') + '</div>'
        + '<div style="flex:1 1 360px; min-width:0;"><div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + (useCpi ? 'Court Pace Index' : 'Abstract court speed') + (series.length ? ' · ' + series[0].y + (series.length > 1 ? '–' + series[series.length - 1].y : '') : '') + '</span>'
        + '<span style="display:flex; align-items:baseline; gap:10px;"><span style="font-size:12.5px; font-weight:700; color:' + (series.length > 1 ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + ';">' + word + '</span><span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + delta + '</span></span></div>'
        + '<div style="position:relative; height:104px; margin-top:6px;"><svg viewBox="0 0 360 104" preserveAspectRatio="none" width="100%" height="100%" style="position:absolute; inset:0; display:block;" fill="none"><defs><linearGradient id="ma2TrFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ma2-white)" stop-opacity="0.10"></stop><stop offset="1" stop-color="var(--ma2-white)" stop-opacity="0"></stop></linearGradient></defs>'
        + (area ? '<path d="' + area + '" fill="url(#ma2TrFill)"></path>' : '') + poly.map(pl => '<polyline points="' + pl + '" fill="none" stroke="var(--ma2-text)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>').join('') + '</svg>'
        + pts.map(p => { const l = (p.x / 360 * 100).toFixed(2) + '%', t = p.y.toFixed(1) + 'px';
          return '<span style="position:absolute; left:' + l + '; top:' + t + '; width:8px; height:8px; box-sizing:border-box; border-radius:50%; background:var(--ma2-card); border:1.75px solid var(--ma2-text); transform:translate(-50%,-50%);"></span>'
            + '<span style="position:absolute; left:' + l + '; top:' + t + '; transform:translate(-50%,calc(-100% - 11px)); ' + MONO + ' font-size:11.5px; font-weight:700; color:var(--ma2-text); white-space:nowrap;">' + p.v.toFixed(useCpi ? 1 : 2) + '</span>'
            + '<span style="position:absolute; left:' + l + '; bottom:0; transform:translateX(-50%); ' + MONO + ' font-size:11px; color:var(--ma2-grey);">' + p.yr + '</span>'; }).join('')
        + (!pts.length ? '<span style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:12.5px; color:var(--ma2-grey);">No yearly readings on record</span>' : '') + '</div></div></div>';
      const g = maGate(mkt ? mkt.n : null).mode, rateOk = !!mkt && (g === 'full' || g === 'small'), openable = !!(mkt && mkt.archiveNames && mkt.archiveNames.length);
      const roi = (label, side, v, avg) => { const has = rateOk && v != null && avg != null, d = has ? v - avg : 0;
        const cmp = has ? (Math.abs(d) < 1 ? 'in line with tour average' : (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1) + 'pp vs tour avg') + (g === 'small' ? ' · small sample' : '') : mkt ? 'Not enough settled matches here for a yield.' : 'No settled prices for this event on record.';
        return '<div class="' + (openable ? 'seg ma2-tile ' : '') + 'tr-roi" data-tr="roi-' + side + '"' + (openable ? ' role="button" tabindex="0" onclick="trSet({roi:\'' + side + '\'})"' : '') + ' style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:22px 24px; display:flex; flex-direction:column;' + (openable ? ' cursor:pointer;' : '') + '">'
          + '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px;"><span style="font-size:14px; font-weight:700; color:var(--ma2-white);">' + label + '</span>' + (openable ? '<span style="color:var(--ma2-grey);">›</span>' : '') + '</div>'
          + '<div style="display:flex; align-items:baseline; gap:9px; margin-top:16px;"><span style="' + MONO + ' font-size:26px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; color:' + (!has ? 'var(--ma2-quiet)' : g === 'small' ? 'var(--ma2-grey)' : 'var(--ma2-text)') + ';">' + (has ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%' : DASH) + '</span><span style="font-size:11.5px; color:var(--ma2-grey);">flat-stake yield</span></div>'
          + '<div style="font-size:12.5px; color:var(--ma2-grey); margin-top:8px;">' + esc(cmp) + '</div></div>'; };
      const relHas = rateOk && mkt.favRel != null, rv = relHas ? mkt.favRel : null, ra = relHas ? mkt.baseline.favRel : null, rd = relHas ? rv - ra : 0;
      const rel = '<div class="tr-rel" style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:22px 24px;"><div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px;"><span style="font-size:14px; font-weight:700; color:var(--ma2-white);">Favourite reliability</span>'
        + '<span style="display:inline-flex; align-items:baseline; gap:8px;"><span style="' + MONO + ' font-size:16px; font-weight:700; font-variant-numeric:tabular-nums; color:' + (relHas ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + ';">' + (relHas ? rv + '%' : DASH) + '</span><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + (relHas ? (rd >= 3 ? 'Reliable' : rd <= -3 ? 'Upset-prone' : 'Moderate') : '') + '</span></span></div>'
        + '<div style="height:6px; border-radius:3px; background:' + W(7) + '; overflow:hidden; margin-top:16px;"><span style="display:block; height:100%; width:' + (relHas ? rv : 0) + '%; background:var(--ma2-blue); border-radius:3px;"></span></div>'
        + '<div style="font-size:12.5px; line-height:1.6; color:var(--ma2-grey); margin-top:12px; text-wrap:pretty;">' + (relHas ? 'Favourites win ' + rv + '% of matches here versus ' + ra + '% across the tour — ' + (rd >= 3 ? 'clearly above average, so chalk tends to hold and backing favourites is a stronger play than usual.' : rd <= -3 ? 'below average, so this is an upset-prone draw where underdogs return more value than the tour norm.' : 'broadly in line with the tour, so no strong lean toward favourites or underdogs.') + (mkt && mkt.nRel ? ' (' + mkt.nRel + ' matches)' : '') : mkt ? 'Not enough settled matches here to measure favourite reliability.' : 'No settled prices for this event on record.') + '</div></div>';
      market = '<div style="display:flex; flex-direction:column; gap:14px;">' + speedCard + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px;">'
        + roi('ROI backing favourites', 'fav', mkt && mkt.roiFav, mkt && mkt.baseline.roiFav) + roi('ROI backing underdogs', 'dog', mkt && mkt.roiDog, mkt && mkt.baseline.roiDog) + rel + '</div></div>';
    }
    // record
    const grp = !!S.sim, c0 = evClass(trClean(m)), cls0 = { surf: c0.surf || surfLbl, cls: c0.cls || (cs && cs.category) || null };
    const P = grp ? [trSimilar(m, 0, cls0), trSimilar(m, 1, cls0)] : [trModelFor(m, 0), trModelFor(m, 1)];
    if (grp && P.some(x => !x)) { [m.p1Key, m.p2Key].forEach(k => { if (k != null) Promise.resolve(loadCareerHistory(k)).then(() => trRender()).catch(() => {}); }); }
    S._restAny = P.some(x => x && x.eds.length > TR_LIM);
    const names = grp ? [...new Set([].concat(...P.filter(Boolean).map(x => x.names)))].map(k => typeof sfEventName === 'function' ? sfEventName(k) : k) : [];
    const scope = 'Career · main draw' + (grp ? ' · ' + (cls0.cls || DASH) + ' ' + String(cls0.surf).toLowerCase() + ' · ' + (names.length ? names.length + (names.length === 1 ? ' tournament: ' : ' tournaments: ') + names.slice(0, 5).join(', ') + (names.length > 5 ? ' and ' + (names.length - 5) + ' more' : '') : 'no tournaments on record') : '');
    const sim = '<span class="seg ma2-seg" role="button" tabindex="0" onclick="trSet({sim:' + !grp + ',recMoreAll:false})" title="' + esc(cls0.cls ? 'His record on every ' + cls0.cls.toLowerCase() + ' ' + String(cls0.surf).toLowerCase() + ' court, by our court-speed class' : 'No speed class for this event') + '" style="flex:none; display:inline-flex; align-items:center; gap:9px; font-size:12.5px; font-weight:' + (grp ? 700 : 600) + '; color:' + (grp ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; cursor:pointer; white-space:nowrap;">'
      + '<span style="width:16px; height:16px; box-sizing:border-box; border-radius:5px; background:' + (grp ? 'var(--ma2-lifted)' : 'var(--ma2-track)') + '; border:1px solid ' + W(grp ? 22 : 14) + '; display:flex; align-items:center; justify-content:center;"><svg width="10" height="10" viewBox="0 0 10 10" style="opacity:' + (grp ? 1 : 0) + ';"><path d="M2 5.2 4.2 7.4 8 3" stroke="var(--ma2-text)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"></path></svg></span>On similar courts</span>';
    const boxes = P.map((x, i) => x ? trBox(m, x, i, grp, clean, S) : '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding:28px; text-align:center; font-size:12.5px; color:var(--ma2-grey);">Loading match history…</div>').join('');
    const rec = '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px; display:flex; flex-direction:column; gap:18px;">'
      + '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px 14px;"><div style="flex:1 1 260px; min-width:0; display:flex; flex-direction:column; gap:4px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-text);">' + esc(grp ? 'Record on similar courts' : 'Record at ' + clean) + '</span><span style="font-size:12.5px; color:var(--ma2-grey); text-wrap:pretty;">' + esc(scope) + '</span></div>' + sim + '</div>'
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(440px,100%),1fr)); gap:14px; align-items:stretch;">' + boxes + '</div></div>';
    return '<div class="tr" style="max-width:1100px; margin:0 auto; display:flex; flex-direction:column; gap:14px; font-size:16px; line-height:normal; color:var(--ma2-text);">' + head + market + rec + '</div>';
  }
  root.maTournamentV2 = maTournamentV2;

  // One court-speed figure for every tab (Tournament, Weather, Key factors): the page's court-conditions row, its latest
  // Tennis Abstract reading from court-speed-history.json (the Tournaments page's number), our 3-band class (N4);
  // else the match's pipeline copy.
  function ma2CourtSpeed(m) {
    cshLoad();
    const key = typeof trKeyOf === 'function' ? trKeyOf(m) : null, cc = key && typeof COURT_CONDITIONS !== 'undefined' ? COURT_CONDITIONS[key] : null;
    if (cc) { const ta = CSH.d && CSH.d.ta[key], ys = ta ? Object.keys(ta).filter(y => ta[y] != null && +y >= 2020).sort() : [];
      return { v: ys.length ? +ta[ys[ys.length - 1]] : cc.abstractSpeed != null ? +cc.abstractSpeed : null, label: courtSpeedCategory(cc.speed), idx: cc.speed != null ? +cc.speed : null, key }; }
    const cs = m && m.courtSpeed; return cs ? { v: cs.abstractSpeed != null ? +cs.abstractSpeed : null, label: cs.category || '', idx: cs.speed != null ? +cs.speed : null, key } : null;
  }
  root.ma2CourtSpeed = ma2CourtSpeed;
  // ===================================================================================================
  // WEATHER (LOCKED 2026-11-23): At match time (factor boxes Wind · Heat · Rain by severity, then Court speed) →
  // Tournament week (day boxes; a picked day opens inside the card). Data = wxModel (Open-Meteo files, venue time, archive
  // for started matches, WX_CONFIG cut-offs). Severity stays the grey ladder (R4) until the founder rules on the design's red.
  const WX_SEV = { r: ['Concern', 'var(--ma2-text)'], a: ['Watch', 'var(--ma2-soft)'], n: ['No concern', 'var(--ma2-grey)'], u: ['Unavailable', 'var(--ma2-quiet)'] };
  root.ma2WxPick = i => { if (typeof _aWx !== 'undefined' && _aWx) { _aWx.sel = i; renderWeatherSection(); } };
  function wxBox(f, lead, o) {
    o = o || {}; const S = WX_SEV[f.sev] || WX_SEV.u;
    return '<div class="' + (o.click ? 'seg ma2-tile' : '') + '"' + (o.click ? ' role="button" tabindex="0" onclick="' + o.click + '"' : '') + (o.tip ? ' title="' + esc(o.tip) + '"' : '') + ' style="display:flex; flex-direction:column; gap:14px; padding:' + (o.small ? '16px' : '18px') + '; border-radius:' + (o.small ? 11 : 12) + 'px; background:' + (lead ? 'var(--ma2-lifted)' : 'var(--ma2-inner)') + '; border:1px solid ' + W(lead ? 14 : 6) + '; cursor:' + (o.click ? 'pointer' : 'default') + '; min-width:0;">'
      + '<div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px;"><span style="font-size:14px; font-weight:700; color:var(--ma2-text);">' + esc(f.name) + '</span><span style="font-size:11.5px; font-weight:700; color:' + (f.statC || S[1]) + '; white-space:nowrap;">' + esc(f.stat != null ? f.stat : S[0]) + '</span></div>'
      + (o.small ? '<span style="display:flex; align-items:baseline; gap:7px; flex-wrap:wrap;"><span style="' + MONO + ' font-size:22px; font-weight:700; line-height:1; color:' + (f.fig === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + ';">' + esc(f.fig) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(f.unit || '') + '</span></span>'
        : '<div style="display:flex; flex-direction:column; gap:6px;"><span style="display:flex; align-items:baseline; gap:8px; flex-wrap:wrap;"><span style="' + MONO + ' font-size:26px; font-weight:700; line-height:1; letter-spacing:-0.02em; color:' + (f.fig === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + ';">' + esc(f.fig) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(f.unit || '') + '</span></span>'
          + '<span style="font-size:11.5px; line-height:1.35; color:var(--ma2-grey); min-height:31px;">' + esc(f.detail || '') + '</span></div>')
      + '<span style="flex:1; padding-top:14px; border-top:1px solid ' + W(6) + '; font-size:12.5px; line-height:1.5; color:var(--ma2-grey); text-wrap:pretty;">' + esc(f.effect || '') + '</span></div>';
  }
  // modal-weather.md (TEN-380): a fresh forecast prints no freshness line; only unavailable, archived or 6–24 h stale do
  const wxFreshLine = vm => vm.fresh && (vm.unavail || vm.archived || vm.fresh.tone === 'amber') ? vm.fresh.text : '';
  function maWeatherV2(m, entry, file, nowMs, arch) {
    const CP = WX_COPY, vm = wxModel(m, entry, file, nowMs, wxForced(), arch);
    const wrap = inner => '<div class="wx-tab" style="max-width:1040px; margin:0 auto; display:flex; flex-direction:column; gap:14px; font-size:14px; line-height:normal; color:var(--ma2-text);">' + inner + '</div>';
    const hq = (t, tip, scope, right) => '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px 16px; flex-wrap:wrap;"><div style="display:flex; flex-direction:column; gap:5px; min-width:0;"><span style="display:flex; align-items:center; gap:8px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em;">' + t + '</span>' + help(tip) + '</span>'
      + '<span style="display:flex; align-items:baseline; gap:4px 8px; flex-wrap:wrap; font-size:12.5px; color:var(--ma2-grey);">' + scope + '</span></div>' + (right || '') + '</div>';
    const chipDot = (txt, c) => '<span style="display:inline-flex; align-items:center; gap:8px; height:30px; padding:0 12px; border-radius:8px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; font-size:12.5px; font-weight:600; color:var(--ma2-text); white-space:nowrap;"><span style="flex:none; width:8px; height:8px; border-radius:50%; background:' + c + ';"></span>' + esc(txt) + '</span>';
    if (vm.indoor) return wrap('<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:56px 24px; display:flex; flex-direction:column; gap:10px; align-items:center; text-align:center;">'
      + '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--ma2-grey)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>'
      + '<span style="font-size:18px; font-weight:800;">Indoor event, weather is not a factor</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(CP.indoorSub) + '</span></div>');
    const lead = vm.lead, cs = ma2CourtSpeed(m);
    const short = vm.unavail || vm.verdictSev === 'u' ? 'Forecast unavailable' : lead ? lead.name + ' is the main factor' : /Missing/.test(vm.verdict) ? vm.verdict : 'No weather concern';   // a partial read names what is missing (modal-weather.md)
    const fresh = wxFreshLine(vm);
    const scope = '<span style="white-space:nowrap;">' + esc(vm.atHead) + '</span>' + (fresh ? '<span style="color:var(--ma2-quiet);">·</span><span style="white-space:nowrap;">' + esc(fresh) + '</span>' : '') + (vm.mayStartLater ? '<span style="color:var(--ma2-quiet);">·</span><span>' + esc(CP.mayStartLater) + '</span>' : '');
    const facts = vm.factors.map(f => ({ name: f.name, sev: f.sev, fig: f.big, unit: f.unit, detail: f.detail === '—' ? '' : f.detail, effect: f.effect, id: f.id }));
    const P = vm.pace, sp = cs && cs.v != null ? cs.v.toFixed(2) : DASH;
    const paceF = { name: 'Court speed', stat: P.sevL ? P.sevL.charAt(0) + P.sevL.slice(1).toLowerCase() : '', statC: 'var(--ma2-text)', fig: vm.unavail ? DASH : sp, unit: cs && cs.label ? cs.label : '', detail: P.detail, effect: P.effect };
    const match = '<div data-wxcard="match" style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px; display:flex; flex-direction:column; gap:18px;">'
      + hq('At match time', 'Forecast for the hour the match starts. Factors are ordered by how much they should affect play. Court speed comes from the Tournament tab.', scope, chipDot(short, lead ? WX_SEV[lead.sev][1] : 'var(--ma2-grey)'))
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%,210px), 1fr)); gap:12px;">' + facts.map(f => wxBox(f, lead && f.id === lead.id)).join('')
      + wxBox(paceF, false, { click: "aGoTab('tournament')", tip: 'Open the Tournament tab' }) + '</div></div>';
    const unav = vm.unavail ? '<div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; padding:14px 18px; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + W(6) + '; font-size:12.5px; color:var(--ma2-grey);"><span style="font-weight:700; color:var(--ma2-text);">Forecast unavailable</span><span>' + esc(CP.banner) + '</span></div>' : '';
    const sel = typeof _aWx !== 'undefined' && _aWx && _aWx.sel != null && _aWx.sel < vm.days.length ? _aWx.sel : null;
    const day = (d, i) => { const top = d.flags && d.flags[0], v = d.unavail || d.reason === 'u' ? 'u' : top ? top.sev : 'n';
      const reason = d.unavail || d.reason === 'u' ? 'Unavailable' : top ? top.text : 'No concern';
      const deg = x => x == null ? DASH : x + '°', picked = sel === i;
      const icon = d.icon ? wIcon(d.icon, 26, 'var(--ma2-grey)') : '<span style="' + MONO + ' font-size:18px; color:var(--ma2-quiet); height:26px; line-height:26px;">' + DASH + '</span>';
      const tag = d.isMatch ? (vm.badge.replace(/^MATCH · /, 'Match ').replace('TBC', 'time TBC')) : d.lowConf ? 'Low confidence' : '';
      // modal-weather.md Q22 + archive: the day's Max values, its window, source and fetch time on the shared tooltip
      let tip = '';
      if (!d.unavail) { const TP = CP.tip, CF = WX_CONFIG, ag = d.agg || {}, u = (x, sx) => x == null ? DASH : x + sx;
        const L = [[TP.gusts, u(ag.gusts, ' km/h')], [TP.wind, u(ag.wind, ' km/h')], [TP.feels, u(ag.feels, '°')], [TP.rain, u(ag.rain, '%')], [TP.mm, ag.mm == null ? DASH : ag.mm.toFixed(1) + ' mm'],
          [TP.window, wxFmt(TP.windowVal, { from: String(CF.window.fromHour).padStart(2, '0'), to: String(CF.window.toHour).padStart(2, '0') })]];
        if (d.past || vm.archived) L.push([TP.values, TP.pastVal]);
        L.push([TP.source, vm.source], [TP.fetched, wxStamp(d.fetchedMs, vm.zone)]);
        tip = ' data-aotip="' + esc(aOddsTipHtml(d.dow + ' ' + d.label, L)) + '"'; }
      return '<div class="seg ma2-row" data-wxday="" data-date="' + d.date + '"' + tip + ' role="button" tabindex="0" onclick="ma2WxPick(' + (picked ? 'null' : i) + ')" style="display:flex; flex-direction:column; align-items:center; gap:10px; padding:14px 8px 12px; border-radius:12px; background:' + (picked ? 'var(--ma2-lifted)' : 'var(--ma2-inner)') + '; border:1px solid ' + W(picked || d.isMatch ? 14 : 6) + '; min-width:0; cursor:pointer;">'
        + '<span style="display:flex; align-items:baseline; gap:6px;"><span style="font-size:12.5px; font-weight:700; color:var(--ma2-text);">' + d.dow + '</span><span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + d.label + '</span></span>' + icon
        + '<span style="display:flex; align-items:baseline; gap:6px; ' + MONO + '"><span style="font-size:15px; font-weight:700; color:var(--ma2-text);">' + deg(d.hi) + '</span><span style="font-size:12px; color:var(--ma2-grey);">' + deg(d.lo) + '</span></span>'
        + '<div style="width:100%; padding-top:10px; border-top:1px solid ' + W(6) + '; display:flex; align-items:center; justify-content:center; gap:6px; min-height:42px; box-sizing:border-box;"><span style="flex:none; width:8px; height:8px; border-radius:50%; background:' + WX_SEV[v][1] + ';"></span>'
        + '<span style="font-size:11.5px; line-height:1.35; font-weight:' + (top ? 700 : 500) + '; color:' + (top ? 'var(--ma2-text)' : 'var(--ma2-grey)') + '; text-align:center;">' + esc(reason) + '</span>'
        + (d.flags && d.flags.length > 1 ? '<span tabindex="0" data-aotip="' + esc(esc(d.flags.slice(1).map(x => x.text).join(' · '))) + '" style="flex:none; ' + MONO + ' font-size:10.5px; font-weight:700; color:var(--ma2-soft); padding:1px 5px; border-radius:6px; background:var(--ma2-lifted); border:1px solid ' + W(14) + ';">+' + (d.flags.length - 1) + '</span>' : '') + '</div>'
        + '<span style="font-size:11.5px; font-weight:600; line-height:15px; color:' + (d.isMatch ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + '; min-height:15px; white-space:nowrap;">' + esc(tag) + '</span></div>'; };
    let open = '';
    if (sel != null) {
      const d = vm.days[sel], a = d.agg || {}, sevOf = (k, v) => d.unavail ? 'u' : wxSev(k, v);
      const ef = (id, sv) => sv === 'u' ? '' : (sv === 'r' || sv === 'a') ? CP.effect[id].hot : CP.effect[id].calm;
      const F = [{ id: 'wind', name: 'Wind', sev: sevOf('gusts', a.gusts), fig: a.gusts == null ? DASH : String(a.gusts), unit: 'km/h gusts' },
        { id: 'heat', name: 'Heat', sev: sevOf('feels', a.feels), fig: a.feels == null ? DASH : a.feels + '°', unit: 'feels like' },
        { id: 'rain', name: 'Rain', sev: sevOf('rain', a.rain), fig: a.rain == null ? DASH : a.rain + '%', unit: 'chance' }].map(f => Object.assign(f, { effect: ef(f.id, f.sev) }))
        .sort((x, y) => wxRank(y.sev) - wxRank(x.sev));
      // no humidity cut-offs are ruled (WX_CONFIG has none): the figure only, no status, no effect sentence
      const hum = { name: 'Humidity', stat: '', fig: a.hum == null ? DASH : a.hum + '%', unit: 'average', effect: '' };
      const dl = F[0] && wxRank(F[0].sev) > 0 ? F[0] : null;
      const nav = (to, dir) => '<span class="seg" role="button" tabindex="0"' + (to == null ? '' : ' onclick="ma2WxPick(' + to + ')"') + ' title="' + (to == null ? '' : dir === 'p' ? 'Previous day' : 'Next day') + '" style="flex:none; width:30px; height:30px; box-sizing:border-box; border-radius:8px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; display:inline-flex; align-items:center; justify-content:center; color:' + (to == null ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; cursor:' + (to == null ? 'default' : 'pointer') + ';"><svg width="10" height="10" viewBox="0 0 10 10"><path d="' + (dir === 'p' ? 'M6.5 2 3.5 5 6.5 8' : 'M3.5 2 6.5 5 3.5 8') + '" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"></path></svg></span>';
      const sub = (d.isMatch ? 'Match day · ' : '') + 'Hours ' + String(WX_CONFIG.window.fromHour).padStart(2, '0') + ':00–' + String(WX_CONFIG.window.toHour).padStart(2, '0') + ':00 venue time' + (d.lowConf ? ' · low confidence' : '') + (d.past || vm.archived ? ' · forecast, not observed' : '');
      open = '<div data-wxcard="day" style="display:flex; flex-direction:column; gap:16px; padding:18px; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + W(6) + ';">'
        + '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px 16px; flex-wrap:wrap;"><span style="display:flex; align-items:center; gap:12px; min-width:0;">' + (d.icon ? wIcon(d.icon, 30, 'var(--ma2-grey)') : '') + '<span style="display:flex; flex-direction:column; gap:3px;"><span style="font-size:15px; font-weight:800; color:var(--ma2-text);">' + esc(d.dow + ' ' + d.label) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(sub) + '</span></span></span>'
        + '<span style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' + chipDot(d.unavail ? 'Forecast unavailable' : dl ? dl.name + ' is the main factor' : 'No weather concern', dl ? WX_SEV[dl.sev][1] : 'var(--ma2-grey)')
        + '<span style="display:flex; align-items:center; gap:4px;">' + nav(sel > 0 ? sel - 1 : null, 'p') + nav(sel < vm.days.length - 1 ? sel + 1 : null, 'n') + '</span>'
        + '<span class="seg ma2-btn2" role="button" tabindex="0" onclick="ma2WxPick(null)" style="height:30px; padding:0 12px; display:inline-flex; align-items:center; border-radius:8px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; font-size:12.5px; font-weight:600; color:var(--ma2-text); cursor:pointer;">Close</span></span></div>'
        + '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap:12px;">' + F.map(f => wxBox(f, dl && f.id === dl.id, { small: true })).join('') + wxBox(hum, false, { small: true }) + '</div></div>';
    }
    const week = '<div data-wxcard="week" style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px; display:flex; flex-direction:column; gap:18px;">'
      + hq('Tournament week', 'Pick a day to open its forecast. Days ' + WX_CONFIG.lowConfFromOffset + ' or more ahead carry a lower confidence. Times are ' + (vm.venueZone ? 'venue local time' : 'your time zone') + '.', esc(vm.range + ' · ' + (vm.venueZone ? CP.venueTimeNote : CP.viewerTimeNote)))
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(116px, 1fr)); gap:8px;">' + vm.days.map(day).join('') + '</div>' + open + '</div>';
    return wrap(unav + match + week);
  }
  root.maWeatherV2 = maWeatherV2;

  // ===================================================================================================
  // OVERVIEW (LOCKED 2026-11-23): "Level" track → per player: Career card · This season card · Record by season card →
  // the matches box. Counts = the player profile's own Career record (PlayerProfileV2._internals: careerTierCells,
  // tierGridCells, rateText, drillScope — founder 2026-10-21); Indoors is its own surface; "Surface not known" shows only
  // for a player with matches that have no surface on record (founder 2026-11-23).
  const OV_S = [['clay', 'Clay'], ['hard', 'Hard'], ['indoors', 'Indoors'], ['grass', 'Grass']];
  const OVL = 'display:grid; grid-template-columns:64px minmax(60px,1fr) 76px 48px 10px; gap:12px; align-items:center;';
  const enRec = c => c && (c.won + c.lost) ? c.won + '–' + c.lost : DASH;
  function ovList(i, cells, api, o) {
    o = o || {}; const barC = i ? 'var(--ma2-text)' : 'var(--ma2-blue)';
    const rows = o.surfs.map(([k, l]) => { const c = cells ? cells[k] : null, n = c ? c.won + c.lost : 0, g = maGate(n).mode;
      const pct = n && g !== 'nopct' ? api.rateText(c.won, c.lost) : DASH, w = n && g !== 'nopct' ? Math.max(0, Math.min(100, c.won / n * 100)) : 0;
      const tick = o.tick && o.tick[k] != null ? '<span title="Career win rate ' + o.tick[k].toFixed(1) + '%" style="position:absolute; left:' + o.tick[k].toFixed(1) + '%; top:-4px; bottom:-4px; width:1px; background:var(--ma2-grey);"></span>' : '';
      const cid = o.cid ? o.cid(k) : null, can = cid && n > 0 && o.can;
      return '<div class="' + (o.cid ? 'seg ma2-row' : '') + '"' + (can ? ' role="button" tabindex="0" onclick="ovOpenCell(\'' + cid + '\')"' : '') + (g === 'small' ? ' title="small sample · n=' + n + '"' : '') + ' style="' + OVL + ' padding:8px 10px; margin:0 8px;' + (o.cid ? ' border-radius:8px; background:' + (can && _ov.cell === cid ? 'var(--ma2-lifted)' : 'transparent') + '; cursor:' + (can ? 'pointer' : 'default') + ';' : '') + '">'
        + '<span style="font-size:12.5px; font-weight:600; color:var(--ma2-text); white-space:nowrap;">' + l + '</span>'
        + '<span style="position:relative; height:6px; border-radius:3px; background:' + W(7) + ';"><span style="position:absolute; left:0; top:0; bottom:0; border-radius:3px; width:' + w.toFixed(1) + '%; background:' + (g === 'small' ? 'var(--ma2-grey)' : barC) + ';"></span>' + tick + '</span>'
        + '<span style="' + MONO + ' font-size:12px; color:var(--ma2-grey); white-space:nowrap; text-align:right;">' + enRec(c) + '</span>'
        + '<span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + (!n || g === 'nopct' ? 'var(--ma2-quiet)' : g === 'small' ? 'var(--ma2-grey)' : 'var(--ma2-text)') + '; text-align:right;">' + pct + '</span>'
        + '<span style="font-size:13px; color:var(--ma2-grey); text-align:center;">' + (can ? '›' : '') + '</span></div>'; }).join('');
    return '<div style="display:flex; flex-direction:column; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + W(6) + '; padding-bottom:8px;">'
      + '<div style="' + OVL + ' padding:9px 18px; border-bottom:1px solid ' + W(6) + '; margin-bottom:8px; font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span>Surface</span><span>Win rate</span><span style="text-align:right;">Record</span><span style="text-align:right;">Won</span><span></span></div>' + rows + '</div>';
  }
  function ovCol(i, name, pk, rows, real, tier, api) {
    const cc = real.length ? api.careerTierCells({ careerByYear: real }, tier) : null, cr = cc ? cc.total : null, cn = cr ? cr.won + cr.lost : 0;
    const resid = cr ? OV_S.reduce((t, [s]) => t - (cc[s] ? cc[s].won + cc[s].lost : 0), cn) : 0;
    const unk = cc && cc.unknown && cc.unknown.won + cc.unknown.lost > 0 || resid > 0;
    const surfs = OV_S.concat(unk ? [['unknown', 'Not known']] : []);
    const g = maGate(cn).mode, pct = cn && g !== 'nopct' ? api.rateText(cr.won, cr.lost) : DASH;
    const tierW = tier === 'atp' ? 'ATP' : tier === 'chitf' ? 'Challenger & ITF' : 'All levels';
    const recPair = (rec, rate, big) => '<span style="display:flex; align-items:baseline; gap:10px; ' + MONO + '"><span style="font-size:' + (big ? 26 : 20) + 'px; font-weight:700; line-height:1; color:' + (rec === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; white-space:nowrap;">' + rec + '</span><span style="font-size:' + (big ? 14 : 13) + 'px; color:var(--ma2-grey);">' + rate + '</span></span>';
    const titleBlock = (t, tip, sub) => '<span style="display:flex; flex-direction:column; gap:5px;"><span style="display:flex; align-items:center; gap:8px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em;">' + t + '</span>' + help(tip) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(sub) + '</span></span>';
    const row = (l, r) => '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px 16px; flex-wrap:wrap;">' + l + (r || '') + '</div>';
    const career = fcard(row('<span style="display:flex; align-items:center; gap:12px; min-width:0;">' + av(name, pk, 40, i ? RING_B(1.5) : RING_A(1.5), 12.5)
      + '<span style="display:flex; flex-direction:column; gap:3px; min-width:0;"><span style="font-size:15px; font-weight:800; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(name) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc('Career · ' + cn + (cn === 1 ? ' match' : ' matches')) + '</span></span></span>', recPair(enRec(cr), pct, true))
      + ovList(i, cc, api, { surfs })
      // modal-overview.md (founder 2026-11-23): the card footnote counts the matches with no surface on record
      + (unk ? (nU => '<span style="font-size:11.5px; color:var(--ma2-grey);">' + nU + (nU === 1 ? ' match' : ' matches') + ' with no surface on record</span>')(cc.unknown && cc.unknown.won + cc.unknown.lost > 0 ? cc.unknown.won + cc.unknown.lost : resid) : ''));
    const yr = String(new Date().getFullYear()), sr = real.find(r => String(r.year) === yr) || null, sg = sr ? api.tierGridCells(sr, tier) : null;
    const st = sg ? sg.total : null, sn = st ? st.won + st.lost : 0, sgm = maGate(sn).mode;
    const tick = {}; surfs.forEach(([k]) => { const c = cc && cc[k], n = c ? c.won + c.lost : 0; if (n && maGate(n).mode !== 'nopct') tick[k] = c.won / n * 100; });
    const season = fcard(row(titleBlock('This season', 'Bar = ' + yr + ' win rate. Tick = career win rate on that surface. Pick a surface to open its matches.', yr + ' against his career win rate'), recPair(enRec(st), sn && sgm !== 'nopct' ? api.rateText(st.won, st.lost) : DASH, false))
      + ovList(i, sg, api, { surfs, tick, cid: k => i + '|season|' + k, can: pk != null && ovListable(sr) }));
    const cols = [['total', 'Total']].concat(surfs.map(x => [x[0], x[1]]));
    const G = 'display:grid; grid-template-columns:minmax(72px,1.1fr) repeat(' + (cols.length) + ',minmax(0,1fr)); gap:0 12px; align-items:center;';
    const cell = (r, k, gcells, bold) => { const c = gcells[k] || null, n = c ? c.won + c.lost : 0, cid = i + '|' + r.year + '|' + k, can = n > 0 && pk != null && ovListable(r), on = can && _ov.cell === cid;
      const why = n > 0 && pk == null ? OV_NO_KEY : n > 0 && !ovListable(r) ? OV_NO_LIST : !n && tier !== 'all' && r.allTier === false && !r[tier] ? OV_NO_SPLIT : '';
      return '<span class="' + (can ? 'seg ma2-row' : '') + '"' + (can ? ' role="button" tabindex="0" onclick="ovOpenCell(\'' + cid + '\')"' : '') + (why ? ' title="' + esc(why) + '"' : '') + ' style="' + MONO + ' font-size:12.5px; width:fit-content; border-radius:8px; padding:5px 8px; margin-left:-8px; white-space:nowrap; font-weight:' + (bold ? 700 : 400) + '; color:' + (n || bold ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + '; background:' + (on ? 'var(--ma2-lifted)' : 'transparent') + '; cursor:' + (can ? 'pointer' : 'default') + ';">' + enRec(c) + '</span>'; };
    const body = rows.length ? rows.map(r => {
      if (r._placeholder) return '<div style="' + G + ' padding:8px 18px;"><span style="' + MONO + ' font-size:12.5px; color:var(--ma2-quiet);">' + esc(r.year) + '</span><span style="grid-column:2 / -1; font-size:12.5px; color:var(--ma2-quiet);">' + (r._placeholder === 'future' ? 'No matches yet' : 'Not yet on tour') + '</span></div>';
      const gc = api.tierGridCells(r, tier), atp = r.allTier === false && r.atp ? '<span title="Only ATP-level records are available for this season" style="font-family:\'Hanken Grotesk\',sans-serif; font-size:10.5px; font-weight:700; color:var(--ma2-soft); background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:5px; padding:0 5px;">ATP</span>' : '';
      return '<div style="' + G + ' padding:2px 18px;"><span style="' + MONO + ' font-size:12.5px; font-weight:700; color:var(--ma2-text); display:flex; align-items:center; gap:6px;">' + esc(r.year) + atp + '</span>' + cols.map(([k]) => cell(r, k, gc, k === 'total')).join('') + '</div>'; }).join('')
      : '<div style="padding:8px 18px; font-size:12.5px; color:var(--ma2-quiet);">No career record on file for this player.</div>';
    const foot = '<div style="' + G + ' padding:12px 18px; margin-top:6px; border-top:1px solid ' + W(12) + ';"><span style="font-size:12.5px; font-weight:700; color:var(--ma2-text);">Career</span>' + cols.map(([k]) => '<span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + (cc && cc[k] && cc[k].won + cc[k].lost ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + ';">' + enRec(cc ? cc[k] : null) + '</span>').join('') + '</div>';
    const table = fcard(titleBlock('Record by season', 'Pick a figure to open its matches. Recent seasons include ATP, Challenger and ITF; ATP marks older seasons where only ATP-level records are available.' + (unk ? ' Not known = matches with no surface on record, so every season sums to its total.' : ''), tierW + ' · wins and losses')
      + '<div style="display:flex; flex-direction:column; border-radius:12px; background:var(--ma2-inner); border:1px solid ' + W(6) + '; overflow:hidden;"><div style="overflow-x:auto;"><div style="min-width:' + (90 + cols.length * 64) + 'px;">'
      + '<div style="' + G + ' padding:9px 18px; border-bottom:1px solid ' + W(6) + '; margin-bottom:6px; font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span>Year</span>' + cols.map(c => '<span>' + c[1] + '</span>').join('') + '</div>' + body + foot + '</div></div></div>');
    return '<div style="display:flex; flex-direction:column; gap:14px; min-width:0;">' + career + season + table + '</div>';
  }
  function maOverviewV2(m) {
    const S = ovStateFor(m), y1 = ovCareerByYear(m.p1Key), y2 = ovCareerByYear(m.p2Key);
    if ([[m.p1Key, y1], [m.p2Key, y2]].some(([k, y]) => !y && k != null && !_ovProfileSettled.has(String(k)))) return '<div class="acomingsoon">Loading career records…</div>';
    if (!y1 && !y2) return '<div class="acomingsoon">Year-by-year records need the stats source — not connected for this match.</div>';
    const api = ovRecApi(); if (!api) return '<div class="acomingsoon">Career records come from the player profile, which is switched off on this page.</div>';
    const [r1, r2] = alignYearlyPair(y1 || [], y2 || []);
    [m.p1Key, m.p2Key].forEach(k => { if (k != null) { loadCareerHistory(k); fhLoadCloses(k); } });
    if (typeof sfDbPxLoad === 'function') sfDbPxLoad();
    const lvl = '<div style="display:flex; align-items:center; gap:8px 12px; flex-wrap:wrap;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-grey);">Level</span>' + track(OV_TIERS.map(([t, l]) => ({ label: l, on: S.tier === t, onclick: "setOverviewTier('" + t + "')" })), { gap: 2, pad: '5px 12px' }) + '</div>';
    return '<div class="ov-pane" style="display:flex; flex-direction:column; gap:14px; width:100%; max-width:1240px; margin:0 auto; font-size:14px; line-height:normal; color:var(--ma2-text);">' + lvl
      + '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr)); gap:14px; align-items:start;">' + ovCol(0, m.p1, m.p1Key, y1 ? r1 : [], y1 || [], S.tier, api) + ovCol(1, m.p2, m.p2Key, y2 ? r2 : [], y2 || [], S.tier, api) + '</div></div>';
  }
  const OVP = '58px 8px minmax(0,1.2fr) minmax(0,1fr) 34px 44px minmax(0,1.1fr) 46px 42px';
  function maOvPopV2(M) {
    const surfLbl = M.surf === 'total' ? 'All surfaces' : M.surf === 'unknown' ? 'Surface not known' : (OV_S.find(x => x[0] === M.surf) || [0, M.surf])[1];
    const tierLbl = M.tier === 'atp' ? 'ATP' : M.tier === 'chitf' ? 'Challenger & ITF' : 'All levels', title = M.name + ' · ' + surfLbl + ' · ' + M.year;
    const avatar = av(M.name, M.key, 40, M.i ? SH_B() : SH_A(), 12);
    const helpT = 'Every match behind this record, newest first. Price = his closing price, Opp = the opponent\'s. Click a match for its stats.';
    if (M.state !== 'ready') return popShell({ onClose: 'ovCloseCell()', title, help: helpT, sub: tierLbl, avatar, body: '<div style="padding:28px 16px; text-align:center; font-size:12.5px; color:var(--ma2-grey);">' + (M.state === 'loading' ? 'Loading matches…' : 'The match list did not load. Close this and open the count again.') + '</div>' });
    const rows = M.rows, n = rows.length, w = rows.filter(r => r.won).length, C4 = window.MarketEdgeCore;
    const priced = rows.filter(r => r.price != null && !(C4 && C4.retSettlement && ['void', 'no-sets'].indexOf(C4.retSettlement(r)) >= 0)), np = priced.length;
    const pl = priced.reduce((a, r) => a + (r.won ? r.price - 1 : -1), 0), avg = np ? priced.reduce((a, r) => a + r.price, 0) / np : null, g = maGate(n).mode, gp = maGate(np).mode;
    const tiles = '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr)); gap:8px;">'
      + tile('Record', n ? w + '–' + (n - w) : DASH, n + (n === 1 ? ' match' : ' matches'), { left: true, bg: 'var(--ma2-inner)' })
      + tile('Win rate', n && g !== 'nopct' ? (w / n * 100).toFixed(1) + '%' : DASH, g === 'small' ? 'small sample · n=' + n : 'Of ' + n, { left: true, bg: 'var(--ma2-inner)', color: g === 'small' ? 'var(--ma2-grey)' : null })
      + tile('Average price', avg == null ? DASH : avg.toFixed(2), np + ' of ' + n + ' priced', { left: true, bg: 'var(--ma2-inner)' })
      + '<span title="' + esc('Flat 1% stake at the closing price on ' + np + ' priced of ' + n + ' matches.' + (np ? ' Prices: ' + fhSourceNote(priced) + '.' : '') + ' ' + (C4 ? C4.RET_SETTLE_NOTE : '')) + '" style="display:flex;">'
      + tile('At flat 1% stake', np && gp !== 'nopct' ? signed(pl, 1) + '%' : DASH, 'Total return', { left: true, bg: 'var(--ma2-inner)', color: !np || gp === 'nopct' ? null : gp === 'small' ? 'var(--ma2-grey)' : pl > 0 ? 'var(--ma2-green)' : pl < 0 ? 'var(--ma2-red)' : null }).replace('<div style="', '<div style="flex:1; ') + '</span></div>';
    const listed = (M.listed || []).map(d => ({ wo: !!d.wo, unconf: !!d.unconf, date: d.date, opp: d.opp, tourn: d.event, round: d.round, surface: d.surface }));
    const all = rows.map(r => ({ r })).concat(listed.map(d => ({ d }))).sort((a, b) => String((b.r || b.d).date || '').localeCompare(String((a.r || a.d).date || '')));
    _ov.rows = {}; rows.forEach(r => { _ov.rows[r.mid] = r; });
    const GR = 'display:grid; grid-template-columns:' + OVP + '; gap:0 10px; align-items:center;';
    const body = all.map(x => { if (x.d) { const d = x.d;
        return '<div style="' + GR + ' padding:8px 18px; border-top:1px solid ' + W(6) + ';"><span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + esc(fhDDMM(d.date) + '.') + (d.wo ? '<span style="display:block; font-size:10px; font-weight:700;" title="Walkover: not a match played, counted in no record">WO</span>' : '') + '</span><span></span><span style="font-size:12.5px; font-weight:600; color:var(--ma2-text);">' + esc(d.opp || DASH) + '</span><span style="font-size:12px; color:var(--ma2-grey);">' + esc(d.tourn || DASH) + '</span><span style="' + MONO + ' font-size:11px; color:var(--ma2-grey);">' + esc(d.round || DASH) + '</span><span style="color:var(--ma2-quiet);">–</span><span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + (d.unconf ? 'unconfirmed, not counted' : '–') + '</span><span style="text-align:right; color:var(--ma2-quiet);">' + DASH + '</span><span style="text-align:right; color:var(--ma2-quiet);">' + DASH + '</span></div>'; }
      const r = x.r, c = r.won ? 'var(--ma2-green)' : 'var(--ma2-red)', sc = r.sets ? esc(r.sets.map(q => q[0] + '-' + q[1]).join(', ')) + (r.ret ? '<span style="color:' + (r.won ? 'var(--ma2-soft)' : 'var(--ma2-red)') + ';"> ret.</span>' : '') : DASH;   // modal-overview.md DF L1997
      return '<div class="seg ma2-row" role="button" tabindex="0" onclick="ovOpenRow(\'' + r.mid + '\')" title="Open the match stats" style="' + GR + ' padding:8px 18px; border-top:1px solid ' + W(6) + '; background:' + (_ov.sel === r.mid ? 'var(--ma2-lifted)' : 'transparent') + '; cursor:pointer;">'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey);">' + esc(fhDDMM(r.date) + '.' + String(r.date).slice(2, 4)) + '</span><span style="width:8px; height:8px; border-radius:50%; background:' + c + ';"></span>'
        + '<span style="font-size:12.5px; font-weight:600; color:var(--ma2-text); overflow-wrap:anywhere;">' + esc(r.opp || DASH) + '</span><span style="font-size:12px; color:var(--ma2-grey); overflow-wrap:anywhere;">' + esc((r.tourn || DASH) + (M.surf === 'total' && r.surface ? ' · ' + r.surface : '')) + '</span>'
        + '<span style="' + MONO + ' font-size:11px; color:var(--ma2-grey);">' + esc(r.round || DASH) + '</span>'
        + '<span style="justify-self:start; ' + MONO + ' font-size:11.5px; font-weight:700; color:' + c + '; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:6px; padding:1px 6px; white-space:nowrap;">' + (r.pS != null ? r.pS + '–' + r.oS : DASH) + '</span>'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-soft); line-height:1.35;">' + sc + '</span>'
        + '<span title="' + esc(r.book === 'B' ? (fhB365Approx(r) ? (r.src === 'atb' ? FH_B365_AT_HOVER : r.src === 'teb' ? FH_B365_TE_HOVER : FH_B365_APPROX_HOVER) : fhSrcTitle(r) + ' (no Pinnacle close for this match)') : fhSrcTitle(r)) + '" style="' + MONO + ' font-size:12px; font-weight:700; color:' + (r.price == null ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; text-align:right;">' + (r.price == null ? DASH : fhOdd(r.price)) + '</span>'
        + '<span style="' + MONO + ' font-size:12px; color:' + (r.oppPrice == null ? 'var(--ma2-quiet)' : 'var(--ma2-grey)') + '; text-align:right;">' + (r.oppPrice == null ? DASH : fhOdd(r.oppPrice)) + '</span></div>'; }).join('');
    const list = '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; overflow:hidden;"><div style="' + GR + ' padding:9px 18px; font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span>Date</span><span></span><span>Opponent</span><span>Event</span><span>Rd</span><span>Sets</span><span>Score</span><span style="text-align:right;">Price</span><span style="text-align:right;">Opp</span></div>'
      + (all.length ? body : '<div style="padding:28px 16px; text-align:center; font-size:12.5px; color:var(--ma2-grey); border-top:1px solid ' + W(6) + ';">No matches on file for this selection.</div>') + '</div>';
    return popShell({ onClose: 'ovCloseCell()', title, help: helpT, sub: tierLbl + ' · ' + n + (n === 1 ? ' match' : ' matches') + ', newest first', avatar, body: tiles + list });
  }
  root.maOverviewV2 = maOverviewV2;
  root.maOvPopV2 = maOvPopV2;

  // ---------------------------------------------------------------- News (design 2026-11-21, LOCKED)
  // The News page's own items (newsWireItems: outlet articles; newsTickerItems: our match reports + quotes), scoped to the
  // two players by player key, inside the feed's 5-day window (A_NEWS_WINDOW_DAYS). Tour News is not shown here (design).
  // An outlet article carries the feed's batch stamp, not the outlet's time (news.md): its time column stays empty, the
  // hover says "Added to feed …"; our own items carry their real time.
  const NW = { id: null, view: 'compact', cat: '', more: {} };
  const NCATS = ['Match Reports', 'Quotes', 'Withdrawals & Injuries'];
  const nAgo = ts => { if (!isFinite(ts)) return ''; const h = (Date.now() - ts) / 36e5; return h < 1 ? 'Now' : h < 24 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'; };
  function newsItemsFor(m) {
    const ok = typeof aNewsFeedOk === 'function' && aNewsFeedOk();
    const all = (ok ? newsWireItems() : []).concat(typeof newsTickerItems === 'function' ? newsTickerItems() : []);
    const since = Date.now() - A_NEWS_WINDOW_DAYS * 864e5, ka = String(m.p1Key), kb = String(m.p2Key), seen = new Set();
    return all.filter(x => x.cat !== 'Tour News' && isFinite(x.ts) && x.ts >= since)
      .map(x => Object.assign(x, { hasA: m.p1Key != null && x.players.some(p => String(p.key) === ka), hasB: m.p2Key != null && x.players.some(p => String(p.key) === kb) }))
      .filter(x => x.hasA || x.hasB).sort((a, b) => b.ts - a.ts)
      // one story, one line (TEN-380): an outlet article re-written under the same first five words shows once, newest
      .filter(x => { if (x.kind !== 'wire') return true; const k = (x.hasA ? 'a' : 'b') + aNewsStoryKey(x.title); if (k.length < 2) return true; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  const nAv = (p, size, fs, ml) => '<span style="flex:none; margin-left:' + (ml || 0) + 'px; border-radius:50%; box-shadow:0 0 0 2px var(--ma2-card);">' + av(p.name, p.key, size, '1px solid ' + W(14), fs) + '</span>';
  const nAvs = (ps, size, fs) => '<span style="display:flex; align-items:center; flex:none;">' + ps.slice(0, 3).map((p, i) => nAv(p, size, fs, i ? -7 : 0)).join('') + '</span>';
  function nMsBox(x, compact) {
    const ms = x.ms, A = x.players[0] || { name: ms.a }, B = x.players[1] || { name: ms.b };
    const rows = ms.rows.map(r => { const [label, a, b, k, low] = r, aL = low ? a < b : a > b, bL = low ? b < a : b > a, hi = Math.max(Math.abs(a), Math.abs(b)) || 1, d = Math.abs(a - b);
      const lw = (12 + d / hi * 88).toFixed(1) + '%', diff = d === 0 ? 'Level' : k === '%' ? Math.round(d) + ' pts' : k === '0' ? String(Math.round(d)) : d.toFixed(k === '1' ? 1 : 2);
      const fig = (v, lead, right) => '<span style="' + MONO + ' font-size:13.5px; font-weight:' + (lead ? 700 : 500) + '; color:' + (lead ? 'var(--ma2-text)' : 'var(--ma2-grey)') + ';' + (right ? ' text-align:right;' : '') + '">' + newsFigFmt(v, k) + '</span>';
      return '<div style="column-span:' + (k === 'dr' ? 'all' : 'none') + '; break-inside:avoid; display:flex; flex-direction:column; padding-bottom:10px;"><div style="display:grid; grid-template-columns:1fr auto 1fr; gap:8px; align-items:baseline;">' + fig(a, aL) + '<span style="font-size:12px; font-weight:600; color:var(--ma2-grey); text-align:center; white-space:nowrap;">' + esc(label) + '</span>' + fig(b, bL, true) + '</div>'
        + '<div style="display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; height:18px;"><span style="height:4px; border-radius:2px 0 0 2px; background:' + W(7) + '; display:flex; justify-content:flex-end;"><span style="width:' + (aL ? lw : '0%') + '; background:var(--ma2-blue); border-radius:2px 0 0 2px;"></span></span>'
        + '<span style="' + MONO + ' font-size:11px; font-weight:700; line-height:16px; color:var(--ma2-text); background:var(--ma2-lifted); box-shadow:0 0 0 1px ' + W(14) + '; border-radius:8px; padding:0 7px; white-space:nowrap;">' + diff + '</span>'
        + '<span style="height:4px; border-radius:0 2px 2px 0; background:' + W(7) + '; display:flex;"><span style="width:' + (bL ? lw : '0%') + '; background:var(--ma2-blue); border-radius:0 2px 2px 0;"></span></span></div></div>'; }).join('');
    const sets = (ms.sets || []).map(t => '<span>' + esc(t[0]) + '<span style="color:var(--ma2-grey); font-weight:500;">-' + esc(t[1]) + '</span></span>').join('');
    return '<span class="mndiv" style="flex:none; align-self:stretch; width:1px; background:' + W(6) + ';"></span><div style="flex:' + (compact ? '1.6 1 320px; max-width:540px' : '2 1 340px; max-width:560px') + '; min-width:0; box-sizing:border-box; background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:11px; padding:2px 22px 14px; display:flex; flex-direction:column; align-self:stretch;">'
      + '<div style="display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:8px; align-items:center; min-height:66px; border-bottom:1px solid ' + W(6) + ';">'
      + '<span style="display:flex; align-items:center; gap:8px; min-width:0;">' + av(A.name, A.key, 32, '1px solid ' + W(14), 11) + '<span style="display:flex; flex-direction:column; gap:2px; min-width:0;"><span style="font-size:14px; font-weight:700; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(A.name) + '</span><span style="font-size:11.5px; font-weight:600; color:var(--news-green);">Won</span></span></span>'
      + '<span style="display:flex; align-items:baseline; gap:10px; white-space:nowrap; ' + MONO + ' font-size:18px; font-weight:700; color:var(--ma2-text);">' + sets + '</span>'
      + '<span style="display:flex; align-items:center; justify-content:flex-end; gap:8px; min-width:0;"><span style="font-size:14px; font-weight:600; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0;">' + esc(B.name) + '</span>' + av(B.name, B.key, 32, '1px solid ' + W(14), 11) + '</span></div>'
      + '<div style="columns:190px 2; column-gap:28px; padding-top:12px; flex:1;">' + rows + '</div></div>';
  }
  function nMore(x) {
    const q = x.quotes || [], isQ = q.length > 0, body = x.bodyParas || [], open = !!NW.more[x.id];
    const has = isQ ? q.length > 3 : body.length > (x.ms && x.ms.rows.length > 6 ? 7 : 5);
    return { isQ, has, paras: isQ ? [] : (has && !open ? body.slice(0, 4) : body), quotes: open ? q : q.slice(0, 3),
      label: open ? 'Show less' : isQ ? 'Show ' + (q.length - 3) + ' more ' + (q.length - 3 === 1 ? 'topic' : 'topics') : 'Read more',
      btn: function () { return this.has ? '<span class="seg ma2-ulink" data-id="' + esc(x.id) + '" onclick="event.stopPropagation();ma2NewsMore(this.dataset.id)" style="align-self:flex-start; font-size:13px; font-weight:600; color:var(--ma2-blue); cursor:pointer;">' + this.label + '</span>' : ''; } };
  }
  const nMeta = x => x.quotes ? x.quotes.length + (x.quotes.length === 1 ? ' topic' : ' topics') : (x.score || '');
  const nHM = ts => isFinite(ts) && typeof newsFmtTime === 'function' ? newsFmtTime(ts) : '';
  const nWho = x => x.ms && x.ms.a && x.ms.b ? [x.players[0] || { name: x.ms.a }, x.players[1] || { name: x.ms.b }] : x.players;
  const nTime = x => x.kind === 'wire' ? '' : nHM(x.ts);
  function nReading(x) {
    const mo = nMore(x), who = nWho(x), sub = [nTime(x), mo.isQ ? '' : x.cat, nMeta(x), x.tour].filter(Boolean).join(' · ');
    const head = '<div style="display:flex; align-items:center; gap:11px; min-width:0; padding-bottom:16px; border-bottom:1px solid ' + W(6) + ';">' + nAvs(who, 30, 10.5)
      + '<div style="display:flex; align-items:baseline; flex-wrap:wrap; gap:2px 10px; min-width:0;"><span style="font-size:14.5px; font-weight:700; color:var(--ma2-text); text-wrap:pretty;">' + esc(who.map(p => p.name).join(' · ')) + '</span><span title="' + esc(newsAddedLabel(x)) + '" style="font-size:12px; color:var(--ma2-grey); text-wrap:pretty;">' + esc(sub) + '</span></div></div>';
    const quotes = q => q.map(z => '<div style="display:flex; flex-direction:column; gap:4px;"><span style="font-size:13px; font-weight:700; line-height:24px; color:var(--ma2-grey);">' + esc(z.topic) + '</span><div style="font-size:16.5px; line-height:1.8; color:var(--ma2-text); text-wrap:pretty;">' + esc(z.text) + '</div></div>').join('');
    const body = mo.isQ
      ? '<div style="min-width:0; max-width:980px; display:flex; flex-direction:column; gap:18px; padding-top:18px;">' + quotes(mo.quotes) + mo.btn() + '</div>'
      : '<div style="display:flex; flex-wrap:wrap; gap:24px 28px; align-items:flex-start; padding-top:18px;"><div style="flex:1 1 300px; min-width:0; max-width:' + (x.ms ? 'none' : '980px') + '; display:flex; flex-direction:column; gap:12px;">'
        + '<div style="font-size:18px; font-weight:800; letter-spacing:-0.005em; color:var(--ma2-text); line-height:1.35; text-wrap:pretty;">' + esc(x.title) + '</div>'
        + mo.paras.map(t => '<div style="font-size:' + (x.ms ? '14.5px' : '15.5px') + '; color:var(--ma2-soft); line-height:1.7; text-wrap:pretty;">' + esc(t) + '</div>').join('') + mo.btn() + '</div>' + (x.ms ? nMsBox(x, false) : '') + '</div>';
    return '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:22px 24px 24px; display:flex; flex-direction:column;">' + head + body + '</div>';
  }
  function nCompact(x) {
    const open = (typeof _aNewsOpen !== 'undefined' ? _aNewsOpen : '') === x.id, who = nWho(x), p0 = x.players[0];
    const name = '<span style="display:flex; align-items:center; gap:9px; min-width:0;">' + nAvs(who, 24, 9.5) + '<span class="mnname" style="font-size:13.5px; font-weight:700; color:var(--ma2-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(p0 ? p0.name : '') + '</span></span>';
    const inj = x.cat === 'Withdrawals & Injuries';
    const attrs = ' data-id="' + esc(x.id) + '" role="button" tabindex="0" aria-expanded="' + open + '" onclick="ma2NewsRow(this.dataset.id)" onkeydown="if(event.key===\'Enter\'&&event.target===this)ma2NewsRow(this.dataset.id)"';
    if (!open) {
      const kind = inj ? 'Injury' : [x.cat === 'Match Reports' ? 'Report' : x.cat, nMeta(x)].filter(Boolean).join(' · ');
      const ago = x.kind === 'wire' ? '' : nAgo(x.ts);
      return '<div class="mnrow"' + attrs + ' style="display:flex; flex-direction:column; padding:0 16px; cursor:pointer;"><div class="mngrid" style="display:grid; grid-template-columns:170px minmax(0,1fr) 140px 54px 8px; gap:14px; align-items:center; min-height:54px;">' + name
        + '<span title="' + esc(newsAddedLabel(x)) + '" style="font-size:14px; font-weight:500; color:var(--ma2-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(x.title) + '</span>'
        + '<span style="font-size:' + (inj ? '11px' : '12px') + '; font-weight:' + (inj ? 700 : 400) + '; color:' + (inj ? 'var(--ma2-red)' : 'var(--ma2-grey)') + '; background:' + (inj ? 'color-mix(in srgb, var(--ma2-red) 12%, transparent)' : 'transparent') + '; border-radius:6px; padding:' + (inj ? '3px 8px' : '0') + '; justify-self:end; white-space:nowrap;">' + esc(kind) + '</span>'
        + '<span title="' + esc(newsAddedLabel(x)) + '" style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey); text-align:right; white-space:nowrap;">' + esc(ago) + '</span>'
        + '<span style="font-size:15px; font-weight:700; color:var(--ma2-grey); line-height:1;">›</span></div></div>';
    }
    const mo = nMore(x), ms = !!x.ms;
    const inner = mo.paras.map(t => '<div style="font-size:14px; color:var(--ma2-soft); line-height:1.7; text-wrap:pretty; max-width:800px;">' + esc(t) + '</div>').join('')
      + (mo.isQ ? '<div style="display:flex; flex-direction:column; gap:18px; max-width:800px;">' + mo.quotes.map(z => '<div style="display:flex; flex-direction:column; gap:4px;"><span style="font-size:13px; font-weight:700; line-height:24px; color:var(--ma2-grey);">' + esc(z.topic) + '</span><div style="font-size:15.5px; line-height:1.7; color:var(--ma2-text); text-wrap:pretty;">' + esc(z.text) + '</div></div>').join('') + '</div>' : '')
      + mo.btn()
      + '<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:4px;">' + (x.cat ? '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-soft); background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:8px; padding:4px 10px; white-space:nowrap;">' + esc(x.cat) + '</span>' : '') + '<span style="font-size:12.5px; color:var(--ma2-grey);">' + esc([x.source, x.tour].filter(Boolean).join(' · ')) + '</span></div>';
    return '<div class="mnrow mnopen"' + attrs + ' style="display:flex; flex-direction:column; padding:0 16px; cursor:pointer;">'
      + '<div class="mnhead" style="display:grid; grid-template-columns:170px minmax(0,1fr) 8px; gap:14px; align-items:start; padding:15px 0 0;">' + name
      + '<span style="font-size:15px; font-weight:700; color:var(--ma2-text); line-height:1.4; text-wrap:pretty; padding-top:2px;">' + esc(x.title) + '</span><span style="font-size:15px; font-weight:700; color:var(--ma2-grey); line-height:1; transform:rotate(90deg); padding-top:5px;">›</span></div>'
      + '<div class="' + (ms ? '' : 'mnindl') + '" style="height:1px; background:' + W(6) + '; margin:' + (ms ? '14px 0' : '14px 0 14px 184px') + ';"></div>'
      + '<div class="' + (ms ? '' : 'mnindb') + '" style="display:flex; flex-wrap:wrap; gap:20px 26px; align-items:flex-start; padding:' + (ms ? '0 0 16px 0' : '0 0 16px 184px') + ';"><div style="flex:1 1 280px; min-width:0; display:flex; flex-direction:column; gap:10px;">' + inner + '</div>' + (ms ? nMsBox(x, true) : '') + '</div></div>';
  }
  function nTabs(items) {
    return '<div style="display:inline-flex; flex-wrap:wrap; gap:3px; background:var(--ma2-track); border:1px solid ' + W(10) + '; border-radius:10px; padding:3px;">' + items.map(t =>
      '<span class="seg ma2-seg" role="button" tabindex="0" onclick="' + t.onclick + '" style="display:inline-flex; align-items:baseline; gap:6px; padding:6px 13px; border-radius:7px; font-size:12.5px; white-space:nowrap; cursor:pointer; font-weight:' + (t.on ? 700 : 600) + '; color:' + (t.on ? 'var(--ma2-white)' : 'var(--ma2-grey)') + '; background:' + (t.on ? 'var(--ma2-lifted)' : 'transparent') + '; border:1px solid ' + (t.on ? W(14) : 'transparent') + ';">' + esc(t.label)
      + (t.n != null ? '<span style="' + MONO + ' font-size:10.5px; font-weight:600; color:var(--ma2-quiet);">' + t.n + '</span>' : '') + '</span>').join('') + '</div>';
  }
  const nBox = (t, d) => '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px; display:flex; flex-direction:column; gap:6px;"><span style="font-size:15px; font-weight:700; color:var(--ma2-text);">' + t + '</span><span style="font-size:13px; color:var(--ma2-grey);">' + d + '</span></div>';
  function maNewsV2(m) {
    if (NW.id !== m.id) { NW.id = m.id; NW.view = 'compact'; NW.cat = ''; NW.more = {}; }
    const filt = typeof _aNewsFilter !== 'undefined' ? _aNewsFilter : 'all';
    const wrap = inner => '<div class="ma2-news" style="display:flex; flex-direction:column; gap:12px; container-type:inline-size; font-family:\'Hanken Grotesk\',sans-serif; font-size:16px; line-height:normal;">' + inner + '</div>';
    const st = typeof _aNewsState !== 'undefined' ? _aNewsState : 'load';
    if (st === 'load') return wrap(nBox('Loading news…', ''));
    const items = newsItemsFor(m), pool = items.filter(x => filt === 'p1' ? x.hasA : filt === 'p2' ? x.hasB : true);
    // no figure without a count (modal-analysis.md): each tile's count names its population on hover
    const tot = ((typeof aNewsFeedOk === 'function' && aNewsFeedOk() ? newsWireItems() : []).concat(typeof newsTickerItems === 'function' ? newsTickerItems() : []))
      .filter(x => x.cat !== 'Tour News' && isFinite(x.ts) && x.ts >= Date.now() - A_NEWS_WINDOW_DAYS * 864e5).length;
    const tiles = [['p1', m.p1, m.p1Key, 'hasA'], ['p2', m.p2, m.p2Key, 'hasB']].map(([f, nm, key, k]) => {
      const list = items.filter(x => x[k]), injx = list.find(x => x.cat === 'Withdrawals & Injuries'), on = filt === f;
      const sub = list.length ? list.length + (list.length === 1 ? ' article' : ' articles') + (list[0].kind === 'wire' ? '' : ' · latest ' + nAgo(list[0].ts).toLowerCase()) : 'No news in the last ' + A_NEWS_WINDOW_DAYS + ' days';
      const stt = injx ? 'Injury note' + (injx.kind === 'wire' ? '' : ' · ' + nAgo(injx.ts).toLowerCase()) : 'No injury news';
      return '<div class="seg ma2-tile" role="button" tabindex="0" onclick="ma2NewsPlayer(\'' + f + '\')" title="' + esc(on ? 'Show both players' : 'Show only ' + nm) + '" style="display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; min-width:0; background:var(--ma2-card); border:1px solid ' + (on ? W(22) : W(6)) + '; border-radius:16px; padding:16px 20px; cursor:pointer;">'
        + av(nm, key, 36, '1px solid ' + W(14), 11.5)
        + '<span style="display:flex; flex-direction:column; gap:3px; min-width:0; flex:1 1 150px;"><span style="font-size:14px; font-weight:700; color:var(--ma2-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(nm) + '</span><span title="' + esc(list.length + ' of ' + tot + ' articles in the news feed, last ' + A_NEWS_WINDOW_DAYS + ' days') + '" style="font-size:12px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(sub) + '</span></span>'
        + '<span style="flex:none; font-size:' + (injx ? '11px' : '12px') + '; font-weight:' + (injx ? 700 : 400) + '; color:' + (injx ? 'var(--ma2-red)' : 'var(--ma2-grey)') + '; background:' + (injx ? 'color-mix(in srgb, var(--ma2-red) 12%, transparent)' : 'transparent') + '; border-radius:6px; padding:' + (injx ? '3px 8px' : '0') + '; white-space:nowrap;">' + stt + '</span></div>'; }).join('');
    const cTabs = nTabs([{ label: 'All', on: !NW.cat, n: pool.length, onclick: "ma2NewsCat('')" }].concat(NCATS.map(c => ({ label: c, on: NW.cat === c, n: pool.filter(x => x.cat === c).length, onclick: "ma2NewsCat('" + c.replace(/&/g, '&amp;') + "')" }))));
    const vTabs = nTabs([['reading', 'Reading'], ['compact', 'Compact']].map(([v, l]) => ({ label: l, on: NW.view === v, onclick: "ma2NewsView('" + v + "')" })));
    let body;
    if (st === 'unavailable' && !items.length) body = nBox('News feed unavailable.', 'Last checked <span style="' + MONO + '">' + esc(new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: newsTz() })) + '</span>.');
    else {
      const feed = pool.filter(x => !NW.cat || x.cat === NW.cat), whoN = filt === 'p1' ? m.p1 : filt === 'p2' ? m.p2 : m.p1 + ' or ' + m.p2;
      if (!feed.length) body = nBox(esc(NW.cat ? 'No ' + NW.cat + ' articles for ' + whoN + '.' : 'No recent news for ' + whoN + '.'), NW.cat ? 'Pick another category.' : 'Only articles about the two players of this match are shown here.');
      else {
        const days = []; feed.forEach(x => { const k = newsFmtDateKey(x.ts); let g = days[days.length - 1]; if (!g || g.k !== k) { g = { k, ts: x.ts, items: [] }; days.push(g); } g.items.push(x); });
        const dayLbl = ts => { try { return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: newsTz() }); } catch (e) { return new Date(ts).toLocaleDateString('en-GB'); } };
        body = days.map(g => '<div style="display:flex; align-items:center; gap:12px; margin-top:8px;"><span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); white-space:nowrap;">' + esc(dayLbl(g.ts)) + '</span><span style="font-size:12px; color:var(--ma2-grey); white-space:nowrap;">' + g.items.length + (g.items.length === 1 ? ' article' : ' articles') + '</span><span style="flex:1; height:1px; background:' + W(6) + ';"></span></div>'
          + (NW.view === 'reading' ? g.items.map(nReading).join('') : '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; display:flex; flex-direction:column; padding:6px 10px;">' + g.items.map(nCompact).join('') + '</div>')).join('');
      }
    }
    return wrap('<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:8px;">' + tiles + '</div>'
      + '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px;">' + cTabs + '<span style="flex:1;"></span>' + vTabs + '</div>' + body);
  }
  const nRe = () => { if (typeof renderNewsSection === 'function') renderNewsSection(); };
  root.ma2NewsPlayer = f => { _aNewsFilter = _aNewsFilter === f ? 'all' : f; _aNewsOpen = ''; nRe(); };
  root.ma2NewsCat = c => { NW.cat = NW.cat === c ? '' : c; _aNewsOpen = ''; nRe(); };
  root.ma2NewsView = v => { NW.view = v; nRe(); };
  root.ma2NewsRow = id => { _aNewsOpen = _aNewsOpen === id ? '' : id; nRe(); };
  root.ma2NewsMore = id => { NW.more[id] = !NW.more[id]; nRe(); };
  root.maNewsV2 = maNewsV2;

  // ---------------------------------------------------------------- Key factors (design 2026-11-23)
  // One wrapping flex row (gap 14, max 1240); every box a clickable card that opens its tab (the Model box: the Model page).
  // Each box reads the tab it opens; nothing inside a box opens anything else (founder Q18).
  const KF_BASIS = { f: '100%', h: 'min(100%,440px)', s: 'min(100%,304px)' };
  function kfBox(o) {
    const go = o.go || "aGoTab('" + o.tab + "')";
    return '<div class="seg ma2-tile kf2-box" data-kf="' + (o.key || o.tab) + '" role="button" tabindex="0" onclick="' + go + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + go + '}"'
      + (o.aria ? ' aria-label="' + esc(o.aria) + '"' : '') + ' style="order:' + o.order + '; flex:1 1 ' + KF_BASIS[o.size] + '; min-width:0; box-sizing:border-box; background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px; display:flex; flex-direction:column; gap:18px; cursor:pointer;">'
      + '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><div style="display:flex; flex-direction:column; gap:5px; min-width:0;"><span style="display:flex; align-items:center; gap:8px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--ma2-white); white-space:nowrap;">' + esc(o.title) + '</span>' + (o.help ? help(o.help) : '') + '</span>'
      + '<span style="font-size:12.5px; color:var(--ma2-grey); line-height:1.4; text-wrap:pretty;">' + o.scope + '</span></div>'
      + '<span style="flex:none; width:26px; height:26px; border-radius:8px; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; display:inline-flex; align-items:center; justify-content:center; font-size:14px; color:var(--ma2-grey);">›</span></div>'
      + o.body + '</div>';
  }
  const kfNote = t => '<span style="font-size:12.5px; color:var(--ma2-grey); line-height:1.5;">' + esc(t) + '</span>';
  const kfAv = (m, i, size, fs) => av(i ? m.p2 : m.p1, i ? m.p2Key : m.p1Key, size, i ? RING_B(1.5) : RING_A(1.5), fs);
  const kfPP = g => g == null || !isFinite(g) ? { t: DASH, c: 'var(--ma2-quiet)' } : (() => { const r = Math.round(g * 10) / 10; return { t: (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(1) + 'pp', c: r > 0 ? 'var(--ma2-green)' : r < 0 ? 'var(--ma2-red)' : 'var(--ma2-grey)' }; })();

  // Stennisfy Model = the Model page's own run and rules (brief item a): model-output.json (else the draw store's copy), the
  // run's adjusted fair odds, the page's verdict (edgeVerdicts: the run's flags, 3% sharp / 5% soft, prediction market),
  // its best soft book (edgeBestSoft: no Pinnacle, no exchange) and its sharp tile (edgeSharp: Pinnacle, else Bet365).
  function kfModelBox(m) {
    const ds = typeof _drawMatchStore !== 'undefined' && _drawMatchStore && _drawMatchStore.matches && _drawMatchStore.matches[m.id];
    const e = (typeof modelOutput !== 'undefined' && modelOutput && modelOutput.matches ? modelOutput.matches[m.id] : null) || (ds && ds.model) || null;
    const ok = !!(e && e.ok), fair = ok && e.stage3 ? e.stage3.fair || {} : {}, net = ok && e.stage2 && e.stage2.totalDeltaP1 != null ? e.stage2.totalDeltaP1 * 100 : null;
    const vd = ok ? edgeVerdicts(e, m) : null, sharp = ok ? edgeSharp(m) : null, surf = fhSurfName(m.surface);
    const netTxt = net == null ? DASH : Math.round(Math.abs(net) * 10) === 0 ? '0.0pp' : '+' + Math.abs(net).toFixed(1) + 'pp';
    const scope = 'Adjusted model price against the market' + (surf ? ' · ' + esc(surf) : '') + ' · net adjustment <span style="' + MONO + ' color:var(--ma2-text);">' + netTxt + '</span>' + (net != null && Math.round(Math.abs(net) * 10) ? ' toward ' + esc(net > 0 ? m.p1 : m.p2) : '');
    const col = i => {
      const s = i ? 'p2' : 'p1', f = fair[s] || {}, prob = f.prob != null ? f.prob : null, soft = ok ? edgeBestSoft(m, s) : null;
      const pinNow = sharp && sharp.now ? sharp.now[s] : null, pinOpen = sharp && sharp.open ? sharp.open[s] : null;
      const fc = vd ? (vd[s].c === 'pos' ? 'var(--ma2-green)' : vd[s].c === 'neg' ? 'var(--ma2-red)' : 'var(--ma2-grey)') : 'var(--ma2-quiet)';
      const sg = kfPP(soft ? edgeGapOf(prob, soft.price) : null), pg = kfPP(pinNow != null ? edgeGapOf(prob, pinNow) : null), mv = oddsMove(pinOpen, pinNow);
      const tileP = (lbl, g, fig, sub) => '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:11px; padding:13px 14px 12px; display:flex; flex-direction:column; gap:6px; min-width:0;"><span style="display:flex; align-items:baseline; justify-content:space-between; gap:6px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">' + esc(lbl) + '</span><span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + g.c + ';">' + g.t + '</span></span>'
        + '<span style="' + MONO + ' font-size:20px; font-weight:700; line-height:1.1; color:' + (fig === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + ';">' + fig + '</span><span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + sub + '</span></div>';
      return '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding:20px; display:flex; flex-direction:column; gap:16px; min-width:0;">'
        + '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px 16px; flex-wrap:wrap;"><span style="display:flex; align-items:center; gap:12px; min-width:0;">' + kfAv(m, i, 40, 12.5)
        + '<span style="display:flex; flex-direction:column; gap:4px; min-width:0; align-items:flex-start;"><span style="font-size:15px; font-weight:800; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;">' + esc(i ? m.p2 : m.p1) + '</span>'
        + (vd ? '<span style="font-size:12px; font-weight:700; color:' + fc + '; background:var(--ma2-lifted); border:1px solid ' + W(14) + '; border-radius:8px; padding:3px 9px; white-space:nowrap;">' + esc(vd[s].t) + '</span>' : '') + '</span></span>'
        + '<span style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Adjusted fair odd' + (prob != null ? ' · ' + (prob * 100).toFixed(1) + '%' : '') + '</span><span style="' + MONO + ' font-size:26px; font-weight:700; line-height:1.1; color:' + (f.odds != null ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + ';">' + (f.odds != null ? Number(f.odds).toFixed(2) : DASH) + '</span></span></div>'
        + '<div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px;">'
        + tileP('Best soft book', sg, soft ? mxOddsTxt(soft.price) : DASH, soft ? 'At ' + esc(soft.name) : DASH)
        + tileP(sharp ? sharp.name : 'Pinnacle', pg, pinNow != null ? mxOddsTxt(pinNow) : DASH, pinOpen != null ? 'Open ' + mxOddsTxt(pinOpen) + (pinNow != null ? ' · <span style="color:' + mv.c + '; font-weight:700;">' + mv.t + '</span>' : '') : DASH)
        + '</div></div>';
    };
    const body = ok ? '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr)); gap:14px;">' + col(0) + col(1) + '</div>'
      : kfNote('The model has not published an adjusted fair price for this match yet.');
    const idA = String(m.id == null ? '' : m.id).replace(/'/g, "\\'");
    return kfBox({ key: 'model', go: "openEdgeModelFromMatch('" + idA + "')", aria: 'Open the Stennisfy Model for this match', order: 1, size: 'f', title: 'Stennisfy Model',
      help: 'Gap = adjusted fair probability minus the probability implied by the bookmaker price. Pinnacle shows its opening odd and the price now.', scope, body });
  }

  // Odds = the Odds tab's one book (kfOddsBook: the card's book, its open, now, series and vig-free pair). No Soft avg column:
  // removed by founder Q12, question open (STEP1 report 3).
  function kfOddsBox(m) {
    const loading = !m.oddsMovement && !m._oddsLoaded, X = loading ? null : kfOddsBook(m), row = X && X.row, books = X ? X.D.rows.filter(r => !r.noData).length : 0;
    const G = 'display:grid; grid-template-columns:minmax(0,1fr) 44px 56px 52px 44px; gap:10px; align-items:center;';
    const spark = (pts, i) => { const P = typeof aOddsDispSeries === 'function' ? aOddsDispSeries(pts || []) : []; if (P.length < 2 || (row.gaps && row.gaps.length)) return '<span></span>';
      const v = P.map(q => q[1]), mn = Math.min.apply(null, v), rg = (Math.max.apply(null, v) - mn) || 1, t0 = P[0][0], sp = (P[P.length - 1][0] - t0) || 1;
      return '<svg viewBox="0 0 64 20" width="56" height="20" preserveAspectRatio="none" style="display:block;"><polyline points="' + P.map(q => (2 + (q[0] - t0) / sp * 60).toFixed(1) + ',' + (17 - (q[1] - mn) / rg * 14).toFixed(1)).join(' ') + '" fill="none" stroke="' + (i ? 'var(--ma2-text)' : 'var(--ma2-blue)') + '" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline></svg>'; };
    const hd = l => '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); text-align:right; white-space:nowrap;">' + l + '</span>';
    const fairOf = x => row && row.nv && row.nv[x] && row.nv[x].length ? aOddsFmt(row.nv[x][row.nv[x].length - 1][1]) : DASH;
    const line = i => { const x = i ? 'b' : 'a', o = row && row[x + 'Open'] != null ? aOddsFmt(row[x + 'Open']) : DASH, n = row && row[x + 'Now'] != null ? aOddsFmt(row[x + 'Now']) : DASH;
      return '<div style="' + G + ' padding:14px 0; flex:1;"><span style="display:flex; align-items:center; gap:8px; min-width:0;">' + kfAv(m, i, 22, 9) + '<span style="font-size:13.5px; font-weight:700; color:var(--ma2-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(i ? m.p2 : m.p1) + '</span></span>'
        + '<span style="' + MONO + ' font-size:12.5px; color:var(--ma2-grey); text-align:right;">' + o + '</span>' + (row ? spark((row.series || {})[x], i) : '<span></span>')
        + '<span style="' + MONO + ' font-size:18px; font-weight:700; color:' + (n === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; text-align:right;">' + n + '</span>'
        + '<span style="' + MONO + ' font-size:12.5px; color:var(--ma2-soft); text-align:right;">' + fairOf(x) + '</span></div>'; };
    const body = '<div style="display:flex; flex-direction:column; flex:1;"><div style="' + G + ' padding-bottom:9px; border-bottom:1px solid ' + W(6) + ';"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Player</span>' + hd('Open') + '<span></span>' + hd('Now') + hd('Fair') + '</div>'
      + line(0) + line(1) + '</div>' + (loading ? kfNote('Loading bookmaker odds…') : !row ? kfNote(X.D.hasSeries ? 'No recent prices: every book on file was last checked over an hour ago.' : 'No prices in the feed for this match yet.') : '');
    const scope = loading ? 'Match winner · loading' : row ? 'Match winner · ' + esc(row.name) + ' price, ' + books + ' bookmaker' + (books === 1 ? '' : 's') + ' compared' : 'Match winner · no prices';
    return kfBox({ tab: 'odds', order: 2, size: 'h', title: 'Odds', scope, body });
  }

  // Playing style DNA = the Playing style tab's five axes (ps2DnaModel, last 52 weeks, true percentiles, the 10-match floor;
  // N10). Mirrored 6px bars blue / white (design); the stronger figure white, the other grey (design, conflict noted).
  function kfDnaBox(m) {
    const D = ps2DnaModel(m, { win: 'w52' }); let nA = 0, nB = 0, k = 0;
    const pc = v => (v.pct == null ? null : Math.max(0, Math.min(100, v.pct)));
    const rows = PS2_AXES.map((ax, i) => {
      const a = pc(D.a.vals[i]), b = pc(D.b.vals[i]), ra = a == null ? null : Math.round(a), rb = b == null ? null : Math.round(b);
      if (ra != null && rb != null) { k++; if (ra > rb) nA++; else if (rb > ra) nB++; }
      const col = x => x == null ? 'var(--ma2-quiet)' : 'var(--ma2-text)';   // CLAUDE.md: never highlight the better stat
      const fig = (x, o, right) => '<span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + col(x, o) + '; min-width:22px;' + (right ? ' text-align:right;' : '') + '">' + (x == null ? DASH : x) + '</span>';
      const bar = (x, right, c) => '<div style="flex:1; height:6px; border-radius:3px; background:' + W(7) + ';' + (right ? '' : ' display:flex; justify-content:flex-end;') + '"><div style="width:' + (x == null ? 0 : x) + '%; height:6px; border-radius:3px; background:' + c + ';"></div></div>';
      return '<div title="' + esc(ps2AxisTip(D, i)) + '" style="display:grid; grid-template-columns:minmax(0,1fr) 108px minmax(0,1fr); gap:12px; align-items:center;">'
        + '<div style="display:flex; align-items:center; gap:10px;">' + fig(ra, rb) + bar(a, false, 'var(--ma2-blue)') + '</div>'
        + '<span style="font-size:12.5px; font-weight:600; color:var(--ma2-soft); text-align:center; white-space:nowrap;">' + esc(ax.short || ax.label) + '</span>'
        + '<div style="display:flex; align-items:center; gap:10px;">' + bar(b, true, 'var(--ma2-text)') + fig(rb, ra, true) + '</div></div>'; }).join('');
    const why = x => (!x.d.inPool ? fhSurname(x.name) + ': no api-tennis rating on record.' : !x.d.ok ? fhSurname(x.name) + ': ' + (x.d.matches || 0) + ' ' + D.surface + ' ' + (x.d.matches === 1 ? 'match' : 'matches') + ' in the last 52 weeks, below the ' + MDNA_FLOOR + '-match floor.' : '');
    const ws = [why(D.a), why(D.b)].filter(Boolean).join(' ');
    const scope = D.loading ? 'Loading DNA…' : !k ? esc(ws || 'No axis both players carry.') : (nA === nB ? 'Axes split ' + nA + '–' + nB : esc(fhSurname(nA > nB ? m.p1 : m.p2)) + ' leads ' + Math.max(nA, nB) + ' of ' + k + ' axes') + ' · last 52 weeks' + (ws ? ' · ' + esc(ws) : '');
    const name = (i, rev) => '<span style="display:flex; align-items:center; gap:8px; min-width:0;' + (rev ? ' flex-direction:row-reverse;' : '') + '">' + kfAv(m, i, 22, 9) + '<span style="font-size:13.5px; font-weight:700; color:var(--ma2-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(i ? m.p2 : m.p1) + '</span></span>';
    const body = '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">' + name(0) + name(1, true) + '</div><div style="display:flex; flex-direction:column; gap:12px;">' + rows + '</div>';
    return kfBox({ tab: 'style', key: 'dna', order: 3, size: 'h', title: 'Playing style DNA', help: 'Where each player stands on tour over the last 52 weeks, 0 to 100. A higher figure is better.', scope, body });
  }

  // Market edge = the tab's own models (meStateFor / meModels, the tab's scope), per player: today's price (the header's)
  // and its band; the band's record, won vs needs, edge, flat 1% stake (the tab's gate, n < 5 dashed, 5–9 grey); the
  // derived lines at today's price as plain rows (design: no wash on the top lines).
  const kfTile = (label, fig, figC, sub) => '<div style="background:var(--ma2-card); border:1px solid ' + W(6) + '; border-radius:11px; padding:13px 14px 12px; display:flex; flex-direction:column; gap:6px; min-width:0;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">' + label + '</span>'
    + '<span style="' + MONO + ' font-size:20px; font-weight:700; line-height:1.1; color:' + figC + ';">' + fig + '</span><span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + sub + '</span></div>';
  function kfMeBox(m) {
    const E = meStateFor(m), MM = meModels(E), core = root.MarketEdgeCore, fmt = core ? core.matchFormat(m) : { bo3: false };
    const col = i => {
      const M = MM[i], ready = M.state === 'ready', b = ready && M.tb >= 0 ? M.bands[M.tb] : null;
      const gate = (txt, c) => { if (!b) return { t: DASH, c: meGrey }; const R = maRate(b.w, b.n, { text: txt, nopct: DASH }); return { t: R.txt, c: R.mode === 'full' ? c : meGrey }; };
      const edge = b && b.won != null && b.needs != null ? (b.won - b.needs) * 100 : null;
      const won = gate(b && b.won != null ? (Math.round(b.won * 1000) / 10).toFixed(1) + '%' : null, 'var(--ma2-text)');
      const ed = gate(edge == null ? null : meSg(edge, 1, 'pp'), edge == null ? meGrey : meUc(edge, 1)), un = b && b.n ? gate(meSg(b.units, 1, '%'), meUc(b.units, 1)) : { t: DASH, c: meGrey };
      const tiles = '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(104px,1fr)); gap:10px;">'
        + kfTile('Record', b ? b.w + '–' + b.l : DASH, b ? 'var(--ma2-text)' : meGrey, b ? b.n.toLocaleString('en-US') + ' priced' : '&nbsp;')
        + kfTile('Won', won.t, won.c, 'Needs ' + (b && b.needs != null ? (Math.round(b.needs * 1000) / 10).toFixed(1) + '%' : DASH))
        + kfTile('Edge', ed.t, ed.c, 'Won − needs')
        + kfTile('At flat 1% stake', un.t, un.c, 'Yield ' + (b && b.yield != null ? meSg(b.yield * 100, 1, '%') : DASH)) + '</div>';
      const G = 'display:grid; grid-template-columns:minmax(0,1fr) 52px 64px 56px; gap:10px; align-items:baseline;', L = ready ? M.lines : null;
      const lines = !fmt.bo3 ? kfNote(ME_BO3_MSG) : M.today == null ? kfNote(ME_NOPRICE_MSG)
        : !ready ? kfNote(M.state === 'loading' ? 'Loading…' : M.state === 'none' ? 'No history on file for this player.' : 'History unavailable — reopen the tab to retry.')
        : !L ? kfNote(ME_NOPRICE_MSG)
        : '<div style="display:flex; flex-direction:column;"><div style="' + G + ' padding:0 0 9px; border-bottom:1px solid ' + W(6) + '; margin-bottom:6px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Derived line</span>'
          + ['All', 'In band', 'Diff'].map(h => '<span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); text-align:right; white-space:nowrap;">' + h + '</span>').join('') + '</div>'
          + L.rows.map(r => { const d = r.diff, aR = maRate(r.aC, r.aN, {}), bR = maRate(r.bC, r.bN, {}), sm = aR.mode === 'small' || bR.mode === 'small';
            return '<div style="' + G + ' padding:6px 0;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(r.label) + '</span>'
              + '<span style="' + MONO + ' font-size:12px; text-align:right;">' + maRateHtml(r.aC, r.aN, { text: r.aPct == null ? null : r.aPct + '%', nopct: DASH, note: false, color: 'var(--ma2-grey)' }) + '</span>'
              + '<span style="' + MONO + ' font-size:12.5px; font-weight:700; text-align:right;">' + maRateHtml(r.bC, r.bN, { text: r.bPct == null ? null : r.bPct + '%', nopct: DASH, note: false, color: 'var(--ma2-text)' }) + '</span>'
              + '<span style="' + MONO + ' font-size:12px; font-weight:700; text-align:right; color:' + (d == null ? meGrey : sm ? meGrey : meUc(d, 0)) + ';">' + (d == null ? '' : meSg(d, 0, '')) + '</span></div>'; }).join('') + '</div>';
      const band = ready && M.tb >= 0 && core ? core.BANDS[M.tb].label : DASH;
      return '<div style="background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding:20px; display:flex; flex-direction:column; gap:16px; min-width:0;">'
        + '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px 16px; flex-wrap:wrap;"><span style="display:flex; align-items:center; gap:12px; min-width:0;">' + kfAv(m, i, 40, 12.5)
        + '<span style="display:flex; flex-direction:column; gap:4px; min-width:0; align-items:flex-start;"><span style="font-size:15px; font-weight:800; color:var(--ma2-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;">' + esc(i ? m.p2 : m.p1) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">Price band ' + esc(band) + '</span></span></span>'
        + '<span style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Today</span><span style="' + MONO + ' font-size:20px; font-weight:700; line-height:1.1; color:' + (M.today != null ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + ';">' + (M.today != null ? M.today.toFixed(2) : DASH) + '</span></span></div>'
        + tiles + lines + '</div>';
    };
    return kfBox({ tab: 'marketedge', order: 4, size: 'f', title: 'Market edge',
      help: 'Won = share of matches won in this price band. Needs = the share the price asks for. Edge = won minus needs. Derived lines compare the cover rate in the band with all matches. ' + (core ? core.RET_SETTLE_NOTE : ''),
      scope: "His record in today's price band · " + esc(scopeLbl(E.S)) + ' · closing odds', body: '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr)); gap:14px;">' + col(0) + col(1) + '</div>' });
  }

  // Small boxes: two plain columns, each led by the 22px ringed avatar + name.
  const kfWho = (m, i) => '<span style="display:flex; align-items:center; gap:8px; min-width:0;">' + kfAv(m, i, 22, 9) + '<span style="font-size:13.5px; font-weight:700; color:var(--ma2-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(i ? m.p2 : m.p1) + '</span></span>';
  const kfCols = (a, b) => '<div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:20px; flex:1;">' + a + b + '</div>';
  const kfStat = (label, val, c, tip) => '<div' + (tip ? ' title="' + esc(tip) + '"' : '') + ' style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;"><span style="font-size:12.5px; color:var(--ma2-grey); white-space:nowrap;">' + label + '</span><span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + c + ';">' + val + '</span></div>';
  // Recent form = the Form tab's default view (today's surface, last 10, all roles; fhFormPlayer), its v market / expected
  // wins (FH_THIN gate) and the best hot line per family.
  function kfFormBox(m) {
    const surf = fhSurfName(m.surface), scope = 'Last 10' + (surf ? ' · ' + esc(surf.toLowerCase()) : '');
    if (!m._fhFormData) return kfBox({ tab: 'form', order: 5, size: 's', title: 'Recent form', scope, body: kfNote('Loading recent matches…') });
    const st = Object.assign({}, fhStateFor(m).form, { surf: surf || 'all', role: 'all', wmode: 'n', n: 10 });
    const side = i => {
      const P = fhFormPlayer(m, i, st), n = P.n, sur = fhSurname(i ? m.p2 : m.p1);
      const bars = P.win.slice().reverse().map(r => '<div title="' + esc((r.won ? 'Won' : 'Lost') + ' v ' + (r.opp || '') + (r.price != null ? ' · ' + fhOdd(r.price) : '')) + '" style="flex:1; height:6px; border-radius:3px; background:' + (r.won ? 'var(--ma2-green)' : 'var(--ma2-red)') + '; min-width:0;"></div>');
      while (bars.length < P.NWIN) bars.unshift('<div style="flex:1; height:6px; border-radius:3px; background:' + W(7) + '; min-width:0;"></div>');
      const d = P.mktOk ? P.winsP - P.expW : null, mc = c => (!P.mktOk ? 'var(--ma2-quiet)' : P.mktSmall ? 'var(--ma2-grey)' : c);
      const mtip = P.mktOk ? 'Against the market and expected wins on ' + P.np + ' of ' + n + ' priced (closing odds).' : n ? 'Fewer than ' + FH_THIN + ' priced matches: no market figure.' : '';
      let hot;
      if (P.hot.ok) hot = FH_HOT_FAM.map(f => P.hot.sc.scored.find(x => fhFamOf(x.L.g) === f[0])).filter(Boolean).map(x => {
        const lbl = x.name.indexOf(sur + ' ') === 0 ? x.name.slice(sur.length + 1) : x.name;
        return '<div title="' + esc(x.name + ': ' + x.c + ' of ' + x.n + (x.L.basis ? ' · ' + x.L.basis : '')) + '" style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px; align-items:baseline;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(lbl.charAt(0).toUpperCase() + lbl.slice(1)) + '</span><span style="' + MONO + ' font-size:12.5px; font-weight:700;">' + maRateHtml(x.c, x.n, { nopct: x.c + '/' + x.n, note: false, color: 'var(--ma2-text)' }) + '</span></div>'; }).join('');
      else hot = '<span style="font-size:11.5px; color:var(--ma2-quiet); line-height:1.4;">' + esc(P.hot.fewTxt) + '</span>';
      return '<div style="display:flex; flex-direction:column; gap:14px; min-width:0;">' + kfWho(m, i)
        + '<div style="display:flex; flex-direction:column; gap:4px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Record</span><span style="' + MONO + ' font-size:22px; font-weight:700; line-height:1.1; color:' + (n ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + ';">' + (n ? P.wins + '–' + (n - P.wins) : DASH) + '</span></div>'
        + '<div style="display:flex; gap:3px;">' + bars.join('') + '</div>'
        + '<div style="display:flex; flex-direction:column; gap:8px;">' + kfStat('Against market', d == null ? DASH : fhSigned(d, 1), mc(d == null ? 'var(--ma2-quiet)' : meUc(d, 1)), mtip) + kfStat('Expected wins', P.mktOk ? P.expW.toFixed(1) : DASH, mc('var(--ma2-text)'), mtip) + '</div>'
        + '<div style="display:flex; flex-direction:column; gap:8px; padding-top:14px; margin-top:auto; border-top:1px solid ' + W(6) + ';"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Hot lines</span>' + hot + '</div></div>';
    };
    return kfBox({ tab: 'form', order: 5, size: 's', title: 'Recent form', scope, body: kfCols(side(0), side(1)) });
  }

  // Playing style = the Playing style tab's record against the opponent's style (ps2Record: career, walkovers out, the D2
  // gate on the rate), its tug from the centre (wins green / losses red) and his last 3 meetings with that style.
  function kfStyleBox(m) {
    const side = i => {
      const R = ps2Record(m, i), ready = R.state === 'ready', n = ready ? R.n : 0, g = maGate(n).mode, shown = g === 'full' || g === 'small';
      const vs = R.oppLab ? 'vs ' + ps2Plural(R.oppLab) : R.state === 'loading' ? 'Loading…' : 'Style not classified';
      const tw = shown && R.w > R.l ? (R.w - R.l) / n * 50 : 0, tl = shown && R.l > R.w ? (R.l - R.w) / n * 50 : 0;
      const tt = !ready || !n ? DASH : R.w === R.l ? 'Level' : R.w > R.l ? '+' + (R.w - R.l) + ' ' + (R.w - R.l === 1 ? 'win' : 'wins') : '+' + (R.l - R.w) + ' ' + (R.l - R.w === 1 ? 'loss' : 'losses');
      const tc = !ready || !n || R.w === R.l ? 'var(--ma2-grey)' : g === 'small' ? 'var(--ma2-grey)' : R.w > R.l ? 'var(--ma2-green)' : 'var(--ma2-red)';
      const rows = ready && n ? R.rows.slice().sort((x, y) => String(y.date || '').localeCompare(String(x.date || ''))).slice(0, 3).map(r => { const x = ps2Meeting(r);
        return '<div title="' + esc([r.tournament || r.event || '', r.score || ''].filter(Boolean).join(' · ')) + '" style="display:grid; grid-template-columns:8px minmax(0,1fr) auto; gap:8px; align-items:center;"><span style="width:8px; height:8px; border-radius:50%; background:' + (r.won ? 'var(--ma2-green)' : 'var(--ma2-red)') + ';"></span><span style="font-size:12.5px; font-weight:600; color:var(--ma2-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(r.opponent ? String(r.opponent).replace(/^([A-Za-zÀ-ÿ])[^\s.]*\.?\s+(?=\S)/, '$1. ') : DASH) + '</span><span style="' + MONO + ' font-size:12px; font-weight:700; color:var(--ma2-text); white-space:nowrap;">' + (x.pS + x.oS ? x.pS + '–' + x.oS : DASH) + '</span></div>'; }).join('')
        : '<span style="font-size:11.5px; color:var(--ma2-quiet);">' + (R.state === 'loading' ? 'Loading…' : R.state === 'unclassified' ? 'Not classified' : 'No career meeting') + '</span>';
      const tip = ready ? fhSurname(i ? m.p2 : m.p1) + ' ' + vs + ': ' + (n ? R.w + '–' + R.l + ' in ' + n + ' career ' + (n === 1 ? 'meeting' : 'meetings') : 'no career meeting') + ' on record, walkovers excluded.' : '';
      return '<div style="display:flex; flex-direction:column; gap:14px; min-width:0;"><div style="display:flex; flex-direction:column; gap:6px; min-width:0;">' + kfWho(m, i) + '<span title="' + esc(vs) + '" style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(vs) + '</span></div>'
        + '<div title="' + esc(tip) + '" style="display:flex; align-items:baseline; gap:8px;"><span style="' + MONO + ' font-size:22px; font-weight:700; line-height:1.1; color:' + (!shown ? 'var(--ma2-quiet)' : g === 'small' ? 'var(--ma2-grey)' : 'var(--ma2-text)') + ';">' + (shown ? Math.round(R.w / n * 100) + '%' : DASH) + '</span>' + (ready && n ? '<span style="' + MONO + ' font-size:12px; color:var(--ma2-grey);">' + R.w + '–' + R.l + '</span>' : '') + '</div>'
        + '<div style="display:flex; flex-direction:column; gap:7px;"><div style="position:relative; height:6px; border-radius:3px; background:' + W(7) + ';"><span style="position:absolute; right:50%; top:0; bottom:0; width:' + tw + '%; background:var(--ma2-green); border-radius:3px 0 0 3px;"></span><span style="position:absolute; left:50%; top:0; bottom:0; width:' + tl + '%; background:var(--ma2-red); border-radius:0 3px 3px 0;"></span><span style="position:absolute; left:50%; top:-3px; bottom:-3px; width:1px; background:var(--ma2-grey);"></span></div>'
        + '<div style="display:grid; grid-template-columns:1fr auto 1fr; font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span>Won</span><span style="' + MONO + ' font-size:11.5px; font-weight:700; color:' + tc + ';">' + tt + '</span><span style="text-align:right;">Lost</span></div></div>'
        + '<div style="display:flex; flex-direction:column; gap:8px; padding-top:14px; margin-top:auto; border-top:1px solid ' + W(6) + ';"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Last 3 against this style</span>' + rows + '</div></div>';
    };
    return kfBox({ tab: 'style', order: 6, size: 's', title: 'Playing style', scope: "Record against the opponent's style", body: kfCols(side(0), side(1)) });
  }

  // Tournament = the Tournament tab's figures: the event's ONE name and tier, surface · the event hold rate (trHoldHtml,
  // founder Q9), court speed from our one source (ma2CourtSpeed: knob on the 0–100 index), the Tournaments page's yields
  // (trMarketFor through the event's gate), and the record here per player (trModelOf; "first appearance", Q25).
  function kfTourBox(m) {
    const clean = trClean(m), catHit = TOURNAMENT_CATALOG.find(t => t.name.toLowerCase() === clean.toLowerCase());
    const tier = (m.venue && m.venue.category) || (catHit && catHit.category) || '', surf = fhSurfName(m.surface);
    const cs = ma2CourtSpeed(m), idx = cs && cs.idx != null && isFinite(cs.idx) ? Math.max(0, Math.min(100, cs.idx)) : null;
    const tn = trName(m), scope = esc(tier && tier.toLowerCase() !== tn.toLowerCase() ? tn + ' · ' + tier : tn) + ' · ' + (surf ? esc(surf) + ' · ' : '') + 'hold ' + trHoldHtml(m, 'kf-hold');
    const speed = '<div style="display:flex; align-items:center; gap:14px;"><span style="' + MONO + ' font-size:26px; font-weight:700; line-height:1.1; color:' + (cs && cs.v != null ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + ';">' + (cs && cs.v != null ? cs.v.toFixed(2) : DASH) + '</span>'
      + '<div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:8px;"><div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">Court speed</span><span style="font-size:12.5px; font-weight:700; color:var(--ma2-text); white-space:nowrap;">' + esc(cs && cs.label || DASH) + '</span></div>'
      + '<div style="position:relative; height:6px; border-radius:3px; background:' + W(7) + ';">' + (idx == null ? '' : '<span style="display:block; height:100%; width:' + idx + '%; background:var(--ma2-text); border-radius:3px;"></span><span style="position:absolute; top:50%; left:' + idx + '%; width:12px; height:12px; box-sizing:border-box; border-radius:50%; background:var(--ma2-text); border:2px solid var(--ma2-card); transform:translate(-50%,-50%);"></span>') + '</div>'
      + '<div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--ma2-grey);"><span>Slow</span><span>Fast</span></div></div></div>';
    const mk = trMarketFor(trKeyOf(m)), g = maGate(mk ? mk.n : null).mode, ok = !!mk && (g === 'full' || g === 'small');
    const pending = !mk && typeof tourxMarketData !== 'undefined' && !tourxMarketData && !tourxMarketFailed;
    const why = pending ? 'Loading' : mk ? 'Too few settled' : 'No settled prices';
    const roi = (label, v, avg) => { const has = ok && v != null && avg != null, d = has ? v - avg : 0, sc = has ? meUc(v, 1) : 'var(--ma2-quiet)';
      const left = has ? (Math.abs(d) < 1 ? '<span style="color:var(--ma2-grey); font-weight:700;">in line</span> with tour' : '<span style="color:' + meUc(d, 1) + '; font-weight:700;">' + (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1) + 'pp</span> tour') : esc(why);
      return '<div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;"><span style="font-size:12.5px; color:var(--ma2-grey);">' + label + '</span><span style="white-space:nowrap;"><span style="font-size:11.5px; color:var(--ma2-grey); margin-right:8px;">' + left + '</span>'
        + '<span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + (g === 'small' && has ? 'var(--ma2-grey)' : sc === meGrey ? 'var(--ma2-text)' : sc) + ';">' + (has ? meSg(v, 1, '%') : DASH) + '</span></span></div>'; };
    const relHas = ok && mk.favRel != null;
    const market = '<div style="display:flex; flex-direction:column; gap:9px; padding-top:16px; border-top:1px solid ' + W(6) + ';">'
      + '<div' + (relHas ? ' title="' + esc('Favourites win ' + mk.favRel + '% of matches here (n = ' + (mk.nRel != null ? mk.nRel : mk.n) + ')' + (mk.baseline && mk.baseline.favRel != null ? ' versus ' + mk.baseline.favRel + '% across the tour.' : '.')) + '"' : '') + ' style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;"><span style="font-size:12.5px; color:var(--ma2-grey);">Favourites win</span><span style="' + MONO + ' font-size:12.5px; font-weight:700; color:' + (relHas ? (g === 'small' ? 'var(--ma2-grey)' : 'var(--ma2-text)') : 'var(--ma2-quiet)') + ';">' + (relHas ? mk.favRel + '%' : DASH) + '</span></div>'
      + roi('Return on favourites', mk && mk.roiFav, mk && mk.baseline && mk.baseline.roiFav) + roi('Return on underdogs', mk && mk.roiDog, mk && mk.baseline && mk.baseline.roiDog) + '</div>';
    const names = [clean].concat(trArchiveNames(mk)), yr = String(m.date || '').slice(0, 4);
    const T = [0, 1].map(i => trModelOf(i ? m.p2TournamentHistory : m.p1TournamentHistory, { ch: null, cl: null, fix: recordFixFor(i ? m.p2Key : m.p1Key) }, i ? m.p2Key : m.p1Key, i ? m.p2 : m.p1, clean, names, yr, 'idle'));
    const hist = [m.p1TournamentHistory, m.p2TournamentHistory], first = i => !hist[i] || !T[i].n;
    const cell = (i, v) => first(i) ? DASH : v;
    const row = (lbl, a, b) => '<div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:baseline; gap:10px;"><span style="' + MONO + ' font-size:13px; font-weight:700; color:' + (first(0) ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; white-space:nowrap;">' + a + '</span><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">' + lbl + '</span><span style="' + MONO + ' font-size:13px; font-weight:700; color:' + (first(1) ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + '; text-align:right; white-space:nowrap;">' + b + '</span></div>';
    const best = t => t.best ? esc(t.best.code) + ' ' + t.best.year : DASH;
    const sets = t => t.sT ? maRateHtml(t.sW, t.sT, { nopct: t.sW + '/' + t.sT, note: false, color: 'var(--ma2-text)' }) : DASH;
    const notes = [0, 1].filter(first).map(i => fhSurname(i ? m.p2 : m.p1) + ' · ' + (hist[i] ? 'no main-draw match' : 'first appearance'));
    const name = (i, rev) => '<span style="display:flex; align-items:center; gap:8px; min-width:0;' + (rev ? ' flex-direction:row-reverse;' : '') + '">' + kfAv(m, i, 22, 9) + '<span style="font-size:13.5px; font-weight:700; color:var(--ma2-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(i ? m.p2 : m.p1) + '</span></span>';
    const rec = '<div style="display:flex; flex-direction:column; gap:9px; padding-top:16px; margin-top:auto; border-top:1px solid ' + W(6) + ';"><div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">' + name(0) + name(1, true) + '</div>'
      + row('Record', cell(0, T[0].W + '–' + T[0].L), cell(1, T[1].W + '–' + T[1].L)) + row('Best', cell(0, best(T[0])), cell(1, best(T[1]))) + row('Sets', cell(0, sets(T[0])), cell(1, sets(T[1])))
      + (notes.length ? '<span style="font-size:11.5px; color:var(--ma2-quiet);">' + esc(notes.join(' · ')) + '</span>' : '') + '</div>';
    return kfBox({ tab: 'tournament', order: 7, size: 's', title: 'Tournament', scope, body: speed + market + rec });
  }

  // Head to head = the H2H tab's ATP-official meetings (fhMeetings; walkovers out, a retirement counts), its tallies, the
  // record on today's surface and its hot lines (fhHotModel: the best line per family, or results at 1–2 meetings). The
  // leader's figure white, the other grey; one split bar blue | white. The bet105 line price rides in each line's hover.
  function kfH2hBox(m) {
    const surf = fhSurfName(m.surface), name = (i, rev) => '<span style="display:flex; align-items:center; gap:8px; min-width:0;' + (rev ? ' flex-direction:row-reverse;' : '') + '">' + kfAv(m, i, 22, 9) + '<span style="font-size:13.5px; font-weight:700; color:var(--ma2-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(i ? m.p2 : m.p1) + '</span></span>';
    const names = '<div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">' + name(0) + name(1, true) + '</div>';
    if (m._fhH2hFailed) return kfBox({ tab: 'h2h', order: 8, size: 's', title: 'Head to head', scope: 'Not loaded', body: names + kfNote('Head-to-head could not load: match history for ' + m._fhH2hFailed.join(' and ') + ' did not load.') + '<span class="seg" onclick="event.stopPropagation();fhH2hRetry()" style="font-size:12.5px; font-weight:700; color:var(--ma2-blue); cursor:pointer;">Retry</span>' });
    if (!m._fhH2hData) return kfBox({ tab: 'h2h', order: 8, size: 's', title: 'Head to head', scope: 'Loading', body: names + kfNote('Loading head-to-head…') });
    const counted = fhMeetings(m).filter(r => !r.wo && (FH_H2H_RET_COUNTS || !r.ret)), a = counted.filter(r => r.won).length, n = counted.length, b = n - a;
    const A = fhSurname(m.p1), B = fhSurname(m.p2), cl = () => 'var(--ma2-text)';   // CLAUDE.md: both players' figures one colour
    const big = (v, c) => '<span style="' + MONO + ' font-size:26px; font-weight:700; line-height:1.1; color:' + c + ';">' + v + '</span>';
    const score = '<div style="display:grid; grid-template-columns:auto 1fr auto; gap:14px; align-items:center;">' + big(a, n ? cl(a, b) : 'var(--ma2-quiet)')
      + '<div style="display:flex; flex-direction:column; gap:7px; align-items:center; min-width:0;"><div style="display:flex; gap:2px; width:100%; height:6px; border-radius:3px; background:' + W(7) + '; overflow:hidden;">' + (n ? '<span style="width:' + (a / n * 100).toFixed(1) + '%; background:var(--ma2-blue);"></span><span style="flex:1; background:var(--ma2-text);"></span>' : '') + '</div>'
      + '<span style="font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">' + esc(!n ? 'No meeting on record' : a === b ? 'Level' : '+' + Math.abs(a - b) + ' ' + (a > b ? A : B)) + '</span></div>' + big(b, n ? cl(b, a) : 'var(--ma2-quiet)') + '</div>';
    const T = kfH2hTallies(counted), S = surf ? counted.filter(r => r.surface === surf) : null, sa = S ? S.filter(r => r.won).length : 0;
    const vr = (lbl, p) => { const x = p ? p[0] : null, y = p ? p[1] : null;
      return '<div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:baseline; gap:10px;"><span style="' + MONO + ' font-size:13px; font-weight:700; color:' + (p ? cl(x, y) : 'var(--ma2-quiet)') + '; white-space:nowrap;">' + (p ? x : DASH) + '</span><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">' + esc(lbl) + '</span><span style="' + MONO + ' font-size:13px; font-weight:700; color:' + (p ? cl(y, x) : 'var(--ma2-quiet)') + '; text-align:right; white-space:nowrap;">' + (p ? y : DASH) + '</span></div>'; };
    const rows = '<div style="display:flex; flex-direction:column; gap:9px; padding-top:16px; border-top:1px solid ' + W(6) + ';">' + vr('Sets won', T.sets) + vr('Tiebreaks', T.tb) + vr('Deciding sets', T.dec)
      + vr(surf ? 'On ' + surf.toLowerCase() : 'On this surface', S && n ? [sa, S.length - sa] : null) + '</div>';
    const HM = fhHotModel(counted, fhH2hLineDefs(A, B), m), sc = HM.sc, rep = () => { if (_fh && _fh.m === m && aBuilt(m, 'key')) aPaint('aSectionKey', buildKeyFactorsSection(m)); };
    const picks = HM.mode === 'none' ? [] : HM.mode === 'results' ? Object.keys(KF_HOT_FAM).flatMap(f => sc.scored.filter(x => fhFamOf(x.L.g) === f)) : Object.keys(KF_HOT_FAM).map(f => sc.scored.find(x => fhFamOf(x.L.g) === f)).filter(Boolean);
    const hot = picks.length ? picks.map(x => { const lp = h2LinePx(x.L, m, rep);
      return '<div title="' + esc(KF_HOT_FAM[fhFamOf(x.L.g)] + (lp.price != null ? ' · bet105 ' + lp.txt : '') + (lp.title ? '\n' + lp.title : '')) + '" style="display:grid; grid-template-columns:minmax(0,1fr) auto 38px; gap:10px; align-items:baseline;"><span style="font-size:12.5px; font-weight:600; color:var(--ma2-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(x.name) + '</span>'
        + '<span style="' + MONO + ' font-size:11.5px; color:var(--ma2-grey); white-space:nowrap;">' + x.c + ' of ' + x.n + '</span><span style="' + MONO + ' font-size:12.5px; font-weight:700; text-align:right;">' + (HM.mode === 'results' ? '' : maRateHtml(x.c, x.n, { nopct: '', note: false, color: 'var(--ma2-text)' })) + '</span></div>'; }).join('')
      : '<span style="font-size:11.5px; color:var(--ma2-quiet);">' + esc(n ? HM.note : 'No meetings') + '</span>';
    const hotBox = '<div style="display:flex; flex-direction:column; gap:8px; padding-top:16px; margin-top:auto; border-top:1px solid ' + W(6) + ';"><div style="display:flex; justify-content:space-between; gap:8px;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Hot lines</span><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">Covered</span></div>' + hot + '</div>';
    return kfBox({ tab: 'h2h', order: 8, size: 's', title: 'Head to head', scope: esc(n ? n + (n === 1 ? ' meeting' : ' meetings') + ' · ATP-official count' : 'No meeting on record'), body: names + score + rows + hotBox });
  }

  // Progression = the Progression tab's model (pgModel): each player's road here (wins, sets) and his pooled figure per
  // metric (pgFig through the gate); the stronger figure white, the other grey; the draw average in the row's hover.
  function kfProgBox(m) {
    if (!m._pg) return kfBox({ tab: 'progression', order: 9, size: 's', title: 'Progression', scope: 'This tournament · loading', body: kfNote('Loading tournament progression…') });
    const P = pgModel(m), meta = P.isEmpty ? '' : 'average of ' + (P.labels.length > 1 ? P.labels[0] + '–' + P.labels[P.labels.length - 1] : P.labels[0]);
    const who = k => { const road = P.isEmpty ? null : P.roads[k], real = road ? road.cells.filter(c => c.r && !c.r.wo) : [];
      const w = real.filter(c => c.r.won).length, sw = real.reduce((t, c) => t + (c.r.pS || 0), 0), sl = real.reduce((t, c) => t + (c.r.oS || 0), 0);
      const sub = !road ? 'No rounds yet' : real.length ? w + (w === 1 ? ' win' : ' wins') + ' · sets ' + sw + '–' + sl : 'No round on record';
      return '<span style="display:flex; flex-direction:column; gap:5px; min-width:0;' + (k ? ' align-items:flex-end; text-align:right;' : '') + '"><span style="display:flex; align-items:center; gap:8px; min-width:0;' + (k ? ' flex-direction:row-reverse;' : '') + '">' + kfAv(m, k, 22, 9) + '<span style="font-size:13.5px; font-weight:700; color:var(--ma2-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(k ? m.p2 : m.p1) + '</span></span><span style="font-size:11.5px; color:var(--ma2-grey);">' + esc(sub) + '</span></span>'; };
    let body = '<div style="display:flex; justify-content:space-between; gap:12px;">' + who(0) + who(1) + '</div>';
    if (P.isEmpty) body += '<span style="font-size:12.5px; color:var(--ma2-quiet); line-height:1.4;">No rounds played yet. The figures start after the first round.</span>';
    else body += '<div style="display:flex; flex-direction:column; gap:9px; padding-top:16px; border-top:1px solid ' + W(6) + ';">' + PG_METRICS.map((mt, i) => {
      const x = P.metrics[i], fa = pgFig(x.avg[0], mt), fb = pgFig(x.avg[1], mt), na = parseFloat(String(fa.t).replace('−', '-')), nb = parseFloat(String(fb.t).replace('−', '-'));
      const c = f => f.none || f.t === DASH ? 'var(--ma2-quiet)' : f.small ? 'var(--ma2-grey)' : 'var(--ma2-text)';   // the gate's grey only; never the better stat
      const dr = mt.noDraw ? DASH : pgDrawFig(x.fAvg, mt).t;
      return '<div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:baseline; gap:10px;"><span style="' + MONO + ' font-size:13px; font-weight:700; color:' + c(fa, na, nb) + '; white-space:nowrap;">' + fa.t + '</span>'
        + '<span title="' + esc('Draw average ' + dr) + '" style="font-size:11.5px; font-weight:600; color:var(--ma2-grey); white-space:nowrap;">' + esc(KF_PG_SHORT[mt.key] || mt.name) + '</span>'
        + '<span style="' + MONO + ' font-size:13px; font-weight:700; color:' + c(fb, nb, na) + '; text-align:right; white-space:nowrap;">' + fb.t + '</span></div>'; }).join('') + '</div>';
    return kfBox({ tab: 'progression', order: 9, size: 's', title: 'Progression', scope: 'This tournament' + (meta ? ' · ' + esc(meta) : ''), body });
  }
  // News = the News tab's own items (newsItemsFor: outlet articles, our reports and quotes, the 5-day window), newest
  // first, six shown: who + the day label over the headline. No dot (removed 2026-10-04; re-adding is an open question).
  function kfNewsBox(m) {
    const st = aNewsFeedOk() ? 'ok' : m._kfNews === 'unavailable' ? 'unavailable' : 'load';
    if (st === 'load') return kfBox({ tab: 'news', order: 10, size: 's', title: 'News', scope: 'Loading', body: kfNote('Loading news…') });
    const items = newsItemsFor(m), N = items.length;
    const scope = N + (N === 1 ? ' article' : ' articles') + ' · last ' + A_NEWS_WINDOW_DAYS + ' days';
    if (!N) return kfBox({ tab: 'news', order: 10, size: 's', title: 'News', scope, body: kfNote(st === 'unavailable' ? 'News feed unavailable.' : 'No recent news for ' + m.p1 + ' or ' + m.p2 + '.') });
    let prev = '';
    const rows = items.slice(0, 6).map(x => { const d = kfNewsDay(x.ts), lbl = d === prev ? '' : d; prev = d;
      const who = x.hasA && x.hasB ? 'Both' : x.hasA ? m.p1 : m.p2;
      return '<div style="display:grid; grid-template-columns:8px minmax(0,1fr); gap:10px; align-items:baseline;"><span></span><div style="display:flex; flex-direction:column; gap:3px; min-width:0;"><span style="font-size:11.5px; font-weight:600; color:var(--ma2-grey);">' + esc(who) + ' <span style="color:var(--ma2-quiet); font-weight:500;">' + esc(lbl) + '</span></span>'
        + '<span style="font-size:12.5px; color:var(--ma2-text); line-height:1.4; text-wrap:pretty;">' + esc(x.title) + '</span></div></div>'; }).join('');
    return kfBox({ tab: 'news', order: 10, size: 's', title: 'News', scope, body: '<div style="display:flex; flex-direction:column; gap:14px; flex:1; justify-content:space-between;">' + rows + '</div>' });
  }

  // Weather at match time = the Weather tab's model (wxModel at the match hour): temperature, the match day's sky, the
  // verdict; factor boxes as the tab (the main factor lifted) + Court speed from the one source. Indoor = one plain line.
  function kfWxBox(m) {
    const CP = WX_COPY, X = m._kfWx, vm = X ? wxModel(m, X.entry, X.file, Date.now(), wxForced(), X.arch) : null;
    const sky = vm && vm.days ? (vm.days.find(d => d.isMatch) || {}).icon : '', at = vm && !vm.indoor && !vm.unavail ? vm.at : null;
    const scope = !vm ? 'Loading' : vm.indoor ? 'Indoor event' : esc(vm.atHead) + (wxFreshLine(vm) ? ' · ' + esc(wxFreshLine(vm)) : '');
    const verdict = !vm ? CP.loading : vm.indoor ? CP.indoorTitle : vm.verdict;
    const left = '<div style="flex:1 1 220px; max-width:300px; display:flex; flex-direction:column; gap:10px; justify-content:center; min-width:0;"><div style="display:flex; align-items:baseline; gap:10px;"><span style="' + MONO + ' font-size:26px; font-weight:700; line-height:1.1; color:' + (at && at.temp != null ? 'var(--ma2-text)' : 'var(--ma2-quiet)') + ';">' + (at && at.temp != null ? at.temp + '°' : DASH) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(sky ? KF_WX_SKY[sky] || '' : '') + '</span></div>'
      + '<span style="font-size:13.5px; font-weight:600; color:var(--ma2-text); line-height:1.4; text-wrap:pretty;">' + esc(verdict) + '</span></div>';
    let right;
    if (!vm || vm.indoor || vm.unavail) right = '<div style="flex:999 1 420px; display:flex; align-items:center; justify-content:center; background:var(--ma2-inner); border:1px solid ' + W(6) + '; border-radius:12px; padding:18px; font-size:12.5px; color:var(--ma2-grey); text-align:center;">' + esc(!vm ? 'Loading the forecast…' : vm.indoor ? 'Indoor event, weather is not a factor.' : 'Forecast unavailable.') + '</div>';
    else {
      const cs = ma2CourtSpeed(m), lead = vm.lead;
      const box = (name, sev, sevC, fig, unit, sub, lifted) => '<div style="background:' + (lifted ? 'var(--ma2-lifted)' : 'var(--ma2-inner)') + '; border:1px solid ' + W(lifted ? 14 : 6) + '; border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:12px; min-width:0;">'
        + '<div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px;"><span style="font-size:14px; font-weight:700; color:var(--ma2-white); white-space:nowrap;">' + esc(name) + '</span><span style="font-size:11.5px; font-weight:700; color:' + sevC + '; white-space:nowrap;">' + esc(sev) + '</span></div>'
        + '<div style="display:flex; align-items:baseline; gap:6px; white-space:nowrap;"><span style="' + MONO + ' font-size:22px; font-weight:700; line-height:1.1; color:' + (fig === DASH ? 'var(--ma2-quiet)' : 'var(--ma2-text)') + ';">' + esc(fig) + '</span><span style="font-size:12.5px; color:var(--ma2-grey);">' + esc(unit || '') + '</span></div>'
        + '<span style="font-size:11.5px; color:var(--ma2-grey); line-height:1.4;">' + esc(sub || '') + '</span></div>';
      const facs = vm.factors.map(f => { const S = WX_SEV[f.sev] || WX_SEV.u; return box(f.name, S[0], S[1], f.big, f.unit, f.detail === DASH ? '' : f.detail, lead && f.id === lead.id); });
      const P = vm.pace; facs.push(box('Court speed', P.sevL ? P.sevL.charAt(0) + P.sevL.slice(1).toLowerCase() : '', 'var(--ma2-text)', cs && cs.v != null ? cs.v.toFixed(2) : DASH, cs && cs.label || '', P.detail ? P.detail.charAt(0).toUpperCase() + P.detail.slice(1) : '', false));
      right = '<div style="flex:999 1 420px; min-width:0; display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr)); gap:12px;">' + facs.join('') + '</div>';
    }
    return kfBox({ tab: 'weather', order: 11, size: 'f', title: 'Weather at match time', scope, body: '<div style="display:flex; flex-wrap:wrap; gap:14px 24px; align-items:stretch;">' + left + right + '</div>' });
  }
  function maKeyFactorsV2(m) {
    return '<div class="kf2" style="max-width:1240px; margin:0 auto; line-height:normal; font-family:\'Hanken Grotesk\',sans-serif; font-size:16px; color:var(--ma2-text);"><div style="display:flex; flex-wrap:wrap; gap:14px; align-items:stretch;">'
      + [kfModelBox, kfOddsBox, kfDnaBox, kfMeBox, kfFormBox, kfStyleBox, kfTourBox, kfH2hBox, kfProgBox, kfNewsBox, kfWxBox].map(f => f(m)).join('') + '</div></div>';
  }
  root.maKeyFactorsV2 = maKeyFactorsV2;

  root.MA2 = { av, SH_A, SH_B, avIni, ini, help, cardHead, card, track, chip, tile, popShell, signed, RING_A, RING_B, W, MONO, DASH, esc };
  root.maOddsV2 = oddsBuild;
})(typeof window !== 'undefined' ? window : globalThis);
