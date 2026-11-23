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
      + items.map(t => '<span class="seg ma2-seg"' + (t.title ? ' title="' + esc(t.title) + '"' : '') + ' role="button" tabindex="0" onclick="' + t.onclick + '"'
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
      { label: 'No-vig', on: novig, onclick: 'aOddsSetMode(true)', title: 'Margin stripped: prices and probabilities sum to 100%' }], { inset: true }) + '</div>';

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
    const nP = M.state === 'ready' && M.priced ? M.priced.length : null;
    return mePlayerBox(E, i, nP == null ? (M.state === 'loading' ? 'Loading…' : DASH) : nP.toLocaleString('en-US') + ' priced matches', 'Today', M.today == null ? DASH : M.today.toFixed(2), 20,
      colHead(BCOLS, ['Price band', 'Won against needed', 'Won', 'Edge', '1% stake'], 2) + body);
  }
  function meBookSplit(MM) {
    const ok = MM.filter(M => M.state === 'ready');
    if (!ok.length) return '';
    const P = ok.reduce((s, M) => s + M.book.P, 0), B = ok.reduce((s, M) => s + M.book.B, 0), A = ok.reduce((s, M) => s + (M.book.A || 0), 0);
    return ' Closing prices: Pinnacle ' + P + (A ? ', Pinnacle (approx.) ' + A + ' (a snapshot, not a confirmed close)' : '') + ', Bet365 ' + B + (B ? ' (no Pinnacle close)' : '') + '.';
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
      + tile('At flat 1% stake', un.t, 'yield ' + (b.yield == null ? DASH : meSg(b.yield * 100, 1, '%')), { left: true, bg: 'var(--ma2-inner)', color: un.c }) + '</div>';
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

  root.MA2 = { av, SH_A, SH_B, avIni, ini, help, cardHead, card, track, chip, tile, popShell, signed, RING_A, RING_B, W, MONO, DASH, esc };
  root.maOddsV2 = oddsBuild;
})(typeof window !== 'undefined' ? window : globalThis);
