// Tournaments tab rebuild (design_handoff_tournaments_tab, founder 2026-11-15). Owner: the TTEntry builder.
// Entry list section = `Entry Lists.dc.html` (LOCKED 2026-11-15, embedded) on real data. The data layer stays
// window.EntryListsTab (the two-shard merge, the week set, the roster rank / name join); this module only renders it.
// Design rulings applied (founder 2026-11-15, "design wins"): the head count is the SELECTED week's; the meta line prints
// "published —" (no shard holds the list's publication date); ATP rows print the city key as the design does (never
// tourxEventName); no tier chip / status tags on screen (the status rides in the name's hover). Data rules kept: a count
// we never fetched is "—", a real 0 stays 0; a rank the list does not print falls back to the current ATP ranking
// (hover says so), else "—"; a player with no country reads "—"; a name links to the profile only on a trusted key.
(function(){
  var S = { week: null, picked: false, q: '', opened: {}, openInit: {} };
  var mounted = null;   // the #tourxEntry element we render into

  var R = '.tabpage[data-page="tournaments"] ';
  var W = function(a){ return 'color-mix(in srgb, var(--tt-white) ' + a + '%, transparent)'; };
  var H = "'Hanken Grotesk',sans-serif", M = "'IBM Plex Mono',monospace";
  var CSS = [
    R + '.tt-entry-root{ max-width:1360px; box-sizing:border-box; padding:22px 24px 26px; display:flex; flex-direction:column; gap:16px; font-family:' + H + '; color:var(--text); line-height:normal; font-size:16px; -webkit-font-smoothing:antialiased; }',
    R + '.tt-entry-head{ display:flex; align-items:center; justify-content:space-between; gap:16px 28px; flex-wrap:wrap; }',
    R + '.tt-entry-titlebox{ display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; min-width:0; }',
    R + '.tt-entry-title{ font-size:24px; font-weight:800; letter-spacing:-0.015em; line-height:1.1; }',
    R + '.tt-entry-count{ font-size:13px; color:var(--text-label); }',
    R + '.tt-entry-search{ display:flex; align-items:center; gap:10px; box-sizing:border-box; width:300px; max-width:100%; height:40px; padding:0 14px; background:var(--inner); border:1px solid ' + W(10) + '; border-radius:10px; cursor:text; }',
    R + '.tt-entry-search:focus-within{ border-color:color-mix(in srgb, var(--tt-blue) 60%, transparent); }',
    R + '.tt-entry-search svg{ flex:none; }',
    R + '.tt-entry-search input{ flex:1; min-width:0; background:transparent; border:0; outline:none; padding:1px 2px; margin:0; color:var(--text); font-family:' + H + '; font-size:13.5px; font-weight:500; }',
    R + '.tt-entry-search input::placeholder{ color:var(--text-label); opacity:1; }',
    R + '.tt-entry-clear{ cursor:pointer; display:flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:6px; flex:none; }',
    R + '.tt-entry-clear:hover{ background:' + W(8) + '; }',
    R + '.tt-entry-clear[hidden]{ display:none; }',
    R + '.tt-entry-weeks{ display:inline-flex; align-self:flex-start; flex-wrap:wrap; gap:3px; background:var(--inner); border:1px solid ' + W(6) + '; border-radius:10px; padding:3px; }',
    R + '.tt-entry-week{ cursor:pointer; display:flex; align-items:baseline; gap:9px; padding:8px 14px; border-radius:8px; background:transparent; border:1px solid transparent; transition:background .14s ease, color .14s ease; }',
    R + '.tt-entry-week.on{ background:var(--selected); border-color:' + W(16) + '; }',
    R + '.tt-entry-wlabel{ font-size:12.5px; font-weight:700; color:var(--text-label); white-space:nowrap; }',
    R + '.tt-entry-week.on .tt-entry-wlabel{ color:var(--tt-white); }',
    R + '.tt-entry-wcount{ font-family:' + M + '; font-size:11px; color:var(--text-label); white-space:nowrap; }',
    R + '.tt-entry-card{ background:var(--card); border:1.25px solid ' + W(6) + '; border-radius:16px; overflow:hidden; }',
    R + '.tt-entry-grid{ display:grid; grid-template-columns:minmax(0,1fr) 84px 84px 84px 96px; gap:0 12px; }',
    R + '.tt-entry-ghead{ align-items:baseline; padding:20px 24px 14px; }',
    R + '.tt-entry-tier{ display:flex; align-items:baseline; gap:12px; min-width:0; }',
    R + '.tt-entry-tiername{ font-size:17px; font-weight:700; white-space:nowrap; }',
    R + '.tt-entry-tiermeta{ font-size:12.5px; color:var(--text-label); white-space:nowrap; }',
    R + '.tt-entry-caps{ font-size:10.5px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:var(--text-label); text-align:right; }',
    R + '.tt-entry-ev{ align-items:center; min-height:60px; box-sizing:border-box; padding:10px 24px; border-top:1px solid ' + W(6) + '; background:transparent; transition:background .12s ease; cursor:default; }',
    R + '.tt-entry-ev.can{ cursor:pointer; }',
    R + '.tt-entry-ev:hover{ box-shadow:inset 0 0 0 999px ' + W(2.2) + '; }',
    R + '.tt-entry-evtext{ min-width:0; display:flex; flex-direction:column; gap:4px; }',
    R + '.tt-entry-evname{ font-size:14px; font-weight:700; letter-spacing:-0.005em; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    R + '.tt-entry-ev.pending .tt-entry-evname{ color:var(--text-soft); }',
    R + '.tt-entry-evmeta{ font-size:12px; color:var(--text-label); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    R + '.tt-entry-n{ font-family:' + M + '; font-size:14px; font-weight:600; font-variant-numeric:tabular-nums; text-align:right; color:var(--text-soft); }',
    R + '.tt-entry-n.none{ color:var(--text-label); }',
    R + '.tt-entry-cue{ justify-self:end; display:flex; align-items:center; gap:8px; font-size:12px; font-weight:600; color:var(--text-soft); white-space:nowrap; }',
    R + '.tt-entry-ev.pending .tt-entry-cue{ color:var(--text-label); }',
    R + '.tt-entry-ev.open .tt-entry-cue{ color:var(--link); }',
    R + '.tt-entry-cue svg{ transition:transform .16s ease; }',
    R + '.tt-entry-ev.open .tt-entry-cue svg{ transform:rotate(180deg); }',
    R + '.tt-entry-panel{ display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); border-top:1px solid ' + W(6) + '; }',
    R + '.tt-entry-col{ padding:20px 24px 22px; min-width:0; border-left:1px solid ' + W(6) + '; }',
    R + '.tt-entry-col:first-child{ border-left-color:transparent; }',
    R + '.tt-entry-coltop{ display:flex; align-items:baseline; gap:10px; padding-bottom:12px; }',
    R + '.tt-entry-coltitle{ font-size:13.5px; font-weight:700; white-space:nowrap; }',
    R + '.tt-entry-colnote{ font-size:12px; color:var(--text-label); white-space:nowrap; }',
    R + '.tt-entry-pgrid{ display:grid; grid-template-columns:26px minmax(0,1fr) 40px 52px; gap:0 12px; }',
    R + '.tt-entry-phead{ padding:0 8px 8px; margin:0 -8px; border-bottom:1px solid ' + W(10) + '; }',
    R + '.tt-entry-phead span{ font-size:10px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:var(--text-label); }',
    R + '.tt-entry-phead .r{ text-align:right; }',
    R + '.tt-entry-rows{ display:flex; flex-direction:column; padding-top:4px; }',
    R + '.tt-entry-prow{ align-items:center; padding:7px 8px; margin:0 -8px; border-radius:6px; }',
    R + '.tt-entry-prow:hover{ background:' + W(3) + '; }',
    R + '.tt-entry-pno{ text-align:right; font-family:' + M + '; font-size:11px; font-variant-numeric:tabular-nums; color:var(--text-label); }',
    R + '.tt-entry-pname{ font-size:13.5px; font-weight:600; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }',
    R + '.tt-entry-pname a{ color:var(--text); text-decoration:none; cursor:pointer; }',
    R + '.tt-entry-pname a:hover{ text-decoration:underline; }',
    R + '.tt-entry-pname.bye{ color:var(--text-label); }',
    R + '.tt-entry-pnat{ text-align:right; font-family:' + M + '; font-size:10.5px; letter-spacing:0.06em; color:var(--text-label); }',
    R + '.tt-entry-prank{ text-align:right; font-family:' + M + '; font-size:12.5px; font-weight:600; font-variant-numeric:tabular-nums; color:var(--text-soft); }',
    R + '.tt-entry-prank.none{ color:var(--text-label); }',
    R + '.tt-entry-empty{ background:var(--card); border:1.25px solid ' + W(6) + '; border-radius:16px; padding:28px 24px; max-width:560px; }',
    R + '.tt-entry-emptyt{ font-size:17px; font-weight:700; }',
    R + '.tt-entry-emptyn{ margin:9px 0 0; font-size:13px; line-height:1.6; color:var(--text-label); text-wrap:pretty; }',
    R + '.tt-entry-clearbtn{ cursor:pointer; display:inline-flex; margin-top:16px; padding:7px 13px; border-radius:8px; border:1px solid ' + W(16) + '; font-size:12.5px; font-weight:700; color:var(--text); }',
    R + '.tt-entry-clearbtn:hover{ background:' + W(5) + '; }',
    R + '.tt-entry-foot{ margin:0; font-size:12px; color:var(--text-label); }',
    R + '.tt-entry-wait{ font-size:13px; color:var(--text-label); }'
  ].join('\n');

  var FOOT = 'Acceptance order, not seeding. Ranks are the ATP singles ranking when the list was published.';
  var MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var CHEV = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5 L5 6.5 L8 3.5"></path></svg>';
  var LENS = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-label)" stroke-width="1.6" stroke-linecap="round"><circle cx="6" cy="6" r="4.4"></circle><path d="M9.4 9.4 L12.6 12.6"></path></svg>';
  var XMARK = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-soft)" stroke-width="1.6" stroke-linecap="round"><path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5"></path></svg>';

  // Member zone (stennisfy.tz via newsTz, else the browser's): "15 Nov, 09:12".
  function fmtWhen(v){
    var d = new Date(v); if (isNaN(d)) return String(v);
    var o = { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false };
    try { var tz = typeof newsTz === 'function' ? newsTz() : undefined; if (tz) o.timeZone = tz; } catch (e) {}
    return d.toLocaleString('en-GB', o);
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function fold(s){ return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function EL(){ return window.EntryListsTab || null; }
  function injectCss(){
    if (document.getElementById('tt-entry-css')) return;
    var st = document.createElement('style'); st.id = 'tt-entry-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  // "16 Nov – 22 Nov" — the design's week label (day + month on both sides, en dash, plain text).
  function weekLabel(k){
    var p = String(k).split('-'), mon = new Date(+p[0], +p[1] - 1, +p[2]), sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return mon.getDate() + ' ' + MONS[mon.getMonth()] + ' – ' + sun.getDate() + ' ' + MONS[sun.getMonth()];
  }
  function monDay(iso){
    if (!iso) return null;
    var d = new Date(String(iso).length === 10 ? iso + 'T00:00:00Z' : iso);
    return isNaN(d.getTime()) ? null : MONS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }
  function cap1(s){ s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function sentence(s){ s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

  // ATP-tour rows print the city key as the design does ("Beijing", "Paris"; founder 2026-11-15 ruling 1, not
  // tourxEventName). A Challenger / ITF row keeps the shard's own words ("Helsinki (CH 125)").
  function eventName(t){
    var tier = String(t.tier || '');
    if (/^(atp|grand slam)/i.test(tier) && !/challenger/i.test(tier)){
      var k = null;
      try { if (typeof sfEventKey === 'function') k = sfEventKey(t.name, t.city) || (t.city ? sfEventKey(t.city) : null); } catch (e) { k = null; }
      return k || t.city || t.name || '—';
    }
    return t.name || t.city || '—';
  }
  function countKey(title){ var s = fold(title); return /qual/.test(s) ? 'Q' : /alt|reserve/.test(s) ? 'ALT' : /main/.test(s) ? 'MD' : null; }

  function weekModel(m){
    var el = EL(), weeks = m.weeks;
    if (!S.picked || weeks.indexOf(S.week) < 0) S.week = m.defaultWeek;
    return weeks.map(function(k){ return { key: k, label: weekLabel(k), count: el.weekEventCount(k) }; });
  }

  function playerRow(el, p, i){
    var isBye = p.status === 'BYE';
    if (isBye) return '<div class="tt-entry-pgrid tt-entry-prow"><span class="tt-entry-pno"></span><span class="tt-entry-pname bye">Bye</span><span class="tt-entry-pnat"></span><span class="tt-entry-prank"></span></div>';
    var nm = el.displayName(p), st = el.fmtStatus(p.status, p.seed), rk = el.rankOf(p), key = el.linkKey(p);
    var tip = esc(nm + (st ? ' · ' + st : ''));
    var inner = key ? '<a data-ttentry-profile="' + esc(key) + '" title="' + tip + '">' + esc(nm) + '</a>' : '<span title="' + tip + '">' + esc(nm) + '</span>';
    return '<div class="tt-entry-pgrid tt-entry-prow">'
      + '<span class="tt-entry-pno">' + (i + 1) + '</span>'
      + '<span class="tt-entry-pname">' + inner + '</span>'
      + '<span class="tt-entry-pnat">' + esc(p.country || '—') + '</span>'
      + '<span class="tt-entry-prank' + (rk ? '' : ' none') + '"' + (rk && rk.src === 'atp' ? ' title="Current ATP ranking (the list prints none)"' : '') + '>'
        + (rk ? '#' + rk.rank : '—') + '</span>'
      + '</div>';
  }

  function columnsHtml(el, t, hit){
    var cols = (t.sections || []).map(function(sec){
      var all = (sec.players || []).map(function(p, i){ return { p: p, i: i }; });
      var rows = hit ? all.filter(function(x){ return hit(x.p); }) : all;
      var ck = countKey(sec.title), tot = (t.counts && ck && t.counts[ck] != null) ? t.counts[ck] : null;
      var n = (sec.players || []).length;
      var note = hit ? (rows.length === 1 ? '1 match' : rows.length + ' matches')
        : (tot != null && n < tot ? 'first ' + n + ' of ' + tot : (tot != null ? tot : n) + ' players');
      return { title: sentence(sec.title), note: note, rows: rows };
    }).filter(function(c){ return c.rows.length > 0; });
    return '<div class="tt-entry-panel">' + cols.map(function(c){
      return '<div class="tt-entry-col">'
        + '<div class="tt-entry-coltop"><span class="tt-entry-coltitle">' + esc(c.title) + '</span><span class="tt-entry-colnote">' + esc(c.note) + '</span></div>'
        + '<div class="tt-entry-pgrid tt-entry-phead"><span class="r">No.</span><span>Player</span><span></span><span class="r">Rank</span></div>'
        + '<div class="tt-entry-rows">' + c.rows.map(function(x){ return playerRow(el, x.p, x.i); }).join('') + '</div>'
        + '</div>';
    }).join('') + '</div>';
  }

  function eventHtml(el, t, searching, hit){
    var has = el.hasList(t), id = el.eventId(t), open = has && (searching || !!S.opened[id]);
    var c = t.counts || {};
    // a row we never fetched dashes all three counts (the shard is not trusted to be self-consistent); a real 0 stays 0
    var cell = function(v){ v = has ? v : null; return '<span class="tt-entry-n' + (v == null ? ' none' : '') + '">' + (v == null ? '—' : esc(v)) + '</span>'; };
    var meta = [monDay(t.startDate || t.weekStart), t.surface ? cap1(t.surface) : null, 'published —'].filter(Boolean).join(' · ');
    var cls = 'tt-entry-grid tt-entry-ev' + (has ? '' : ' pending') + (open ? ' open' : '') + (has && !searching ? ' can' : '');
    return '<div class="' + cls + '"' + (has && !searching ? ' data-ttentry-ev="' + esc(id) + '"' : '')
        + (has ? '' : ' title="Player names are not loaded for this event yet"') + '>'
      + '<span class="tt-entry-evtext"><span class="tt-entry-evname">' + esc(eventName(t)) + '</span><span class="tt-entry-evmeta">' + esc(meta) + '</span></span>'
      + cell(c.MD) + cell(c.Q) + cell(c.ALT)
      + '<span class="tt-entry-cue"><span>' + (!has ? 'Names pending' : open ? 'Hide' : 'Players') + '</span>' + (has ? CHEV : '') + '</span>'
      + '</div>'
      + (open ? columnsHtml(el, t, searching ? hit : null) : '');
  }

  function groupsHtml(el, list, searching, hit){
    var by = {};
    list.forEach(function(t){ var g = el.levelGroup(t.tier); (by[g] = by[g] || []).push(t); });
    return el.GROUP_ORDER.filter(function(g){ return by[g] && by[g].length; }).map(function(g){
      var evs = by[g].slice().sort(function(a, b){
        var ap = a.status === 'pending' ? 1 : 0, bp = b.status === 'pending' ? 1 : 0;
        if (ap !== bp) return ap - bp;
        if (searching && a.weekStart !== b.weekStart) return a.weekStart < b.weekStart ? -1 : 1;
        return eventName(a).localeCompare(eventName(b));
      });
      return '<div class="tt-entry-card">'
        + '<div class="tt-entry-grid tt-entry-ghead"><span class="tt-entry-tier"><span class="tt-entry-tiername">' + esc(g) + '</span><span class="tt-entry-tiermeta">' + evs.length + (evs.length === 1 ? ' event' : ' events') + '</span></span>'
          + '<span class="tt-entry-caps">Main draw</span><span class="tt-entry-caps">Qualifying</span><span class="tt-entry-caps">Alternates</span><span></span></div>'
        + evs.map(function(t){ return eventHtml(el, t, searching, hit); }).join('')
        + '</div>';
    }).join('');
  }

  function emptyHtml(title, note, clear){
    return '<div class="tt-entry-empty"><div class="tt-entry-emptyt">' + esc(title) + '</div><p class="tt-entry-emptyn">' + esc(note) + '</p>'
      + (clear ? '<span class="tt-entry-clearbtn" data-ttentry-clear>Clear search</span>' : '') + '</div>';
  }

  // The view for the current model: { count, countTitle, weeks, body } (HTML / text strings). Exposed for the test.
  function view(m){
    var el = EL(), q = fold(S.q.trim()), searching = q.length > 0;
    var weeks = weekModel(m);
    var hit = function(p){ return !!p && p.status !== 'BYE' && (fold(p.name).indexOf(q) >= 0 || fold(el.displayName(p)).indexOf(q) >= 0); };
    var shown;
    if (searching) shown = m.tournaments.filter(function(t){ return weeks.some(function(w){ return w.key === t.weekStart; })
      && (t.sections || []).some(function(s){ return (s.players || []).some(hit); }); });
    else {
      shown = m.tournaments.filter(function(t){ return t.weekStart === S.week; });
      // first visit to a week: its first event with names opens (the design's default state shows an open list)
      if (!S.openInit[S.week]){
        S.openInit[S.week] = 1;
        var first = null;
        el.GROUP_ORDER.some(function(g){
          first = shown.filter(function(t){ return el.levelGroup(t.tier) === g && el.hasList(t) && t.status !== 'pending'; })
            .sort(function(a, b){ return eventName(a).localeCompare(eventName(b)); })[0] || null;
          return !!first;
        });
        if (first) S.opened[el.eventId(first)] = true;
      }
    }
    var wk = weeks.filter(function(w){ return w.key === S.week; })[0];
    var nEv = wk ? wk.count : null, nLists = shown.filter(el.hasList).length;
    var count = searching ? (shown.length === 1 ? 'Entered in 1 event' : 'Entered in ' + shown.length + ' events') + ' · all weeks'
      : (nEv == null ? '—' : nEv) + (nEv === 1 ? ' event' : ' events') + ' · ' + nLists + (nLists === 1 ? ' list' : ' lists') + ' loaded';
    var countTitle = 'Events = every ATP-tour event that week; lists loaded = events whose acceptance list is in the build.'
      + (m.advMeta && m.advMeta.fetchStatus === 'stale' ? ' The advance source could not be refreshed: these are the last lists fetched (' + (m.advMeta.generatedAt || 'unknown') + ').' : '')
      // B9 (kept through the rebuild): the draw sheets' CONTENT last changed (sourcePublished), never our fetch time alone.
      + (m.drawMeta && m.drawMeta.sourcePublished ? ' Draw sheets: content last changed ' + fmtWhen(m.drawMeta.sourcePublished)
          + (m.drawMeta.generatedAt ? ', checked ' + fmtWhen(m.drawMeta.generatedAt) : '') + '.' : '');
    var weeksHtml = '<div class="tt-entry-weeks" role="tablist" aria-label="Entry list weeks" style="opacity:' + (searching ? 0.55 : 1) + ';">'
      + weeks.map(function(w){
          var on = !searching && w.key === S.week;
          return '<span class="tt-entry-week' + (on ? ' on' : '') + '" role="tab" aria-selected="' + on + '" data-ttentry-week="' + esc(w.key) + '">'
            + '<span class="tt-entry-wlabel">' + esc(w.label) + '</span><span class="tt-entry-wcount">' + (w.count == null ? '—' : w.count) + '</span></span>';
        }).join('') + '</div>';
    var body = groupsHtml(el, shown, searching, hit);
    if (!shown.length) body = searching
      ? emptyHtml('No player found', 'Nobody matching “' + S.q.trim() + '” is on a loaded list. Events still waiting for their player names are not searched.', true)
      : emptyHtml('No lists loaded for this week', 'The ATP has ' + (nEv == null ? '—' : nEv) + (nEv === 1 ? ' event' : ' events') + ' in ' + (wk ? wk.label : '—') + '. Their acceptance lists are not in the build yet — once they are loaded they appear here, grouped by tier.', false);
    return { count: count, countTitle: countTitle, weeks: weeksHtml, body: body, searching: searching };
  }

  function shell(){
    return '<div class="tt-entry-root">'
      + '<div class="tt-entry-head"><div class="tt-entry-titlebox"><span class="tt-entry-title">Entry lists</span><span class="tt-entry-count" data-ttentry-count>—</span></div>'
      + '<label class="tt-entry-search">' + LENS + '<input type="text" data-ttentry-q placeholder="Find a player in every list" autocomplete="off" spellcheck="false" value="' + esc(S.q) + '">'
      + '<span class="tt-entry-clear" title="Clear" data-ttentry-clear' + (S.q.trim() ? '' : ' hidden') + '>' + XMARK + '</span></label></div>'
      + '<div data-ttentry-weeks style="display:contents;"></div><div data-ttentry-body style="display:contents;"></div>'
      + '<p class="tt-entry-foot">' + FOOT + '</p></div>';
  }

  function paint(){
    if (!mounted) return;
    var el = EL(), cnt = mounted.querySelector('[data-ttentry-count]'), wk = mounted.querySelector('[data-ttentry-weeks]'), body = mounted.querySelector('[data-ttentry-body]');
    var clr = mounted.querySelector('.tt-entry-clear');
    if (clr) clr.hidden = !S.q.trim();
    var m = el && el.model ? el.model() : null;
    if (!m || !m.loaded){
      cnt.textContent = '—'; cnt.removeAttribute('title'); wk.innerHTML = '';
      body.innerHTML = m && m.failed ? emptyHtml('Entry lists unavailable', 'The entry-list data could not be loaded. This is an error, not an empty schedule — try again in a minute.', false)
        : '<div class="tt-entry-wait">Loading entry lists…</div>';
      return;
    }
    var v = view(m);
    cnt.textContent = v.count; cnt.title = v.countTitle;
    wk.innerHTML = v.weeks;
    body.innerHTML = v.body;
  }

  function clearQ(){ S.q = ''; var inp = mounted && mounted.querySelector('[data-ttentry-q]'); if (inp) inp.value = ''; }
  function onClick(e){
    var t = e.target, a;
    if ((a = t.closest('[data-ttentry-profile]'))){ e.preventDefault(); e.stopPropagation(); if (typeof sfGoToProfile === 'function') sfGoToProfile(a.getAttribute('data-ttentry-profile')); return; }
    if ((a = t.closest('[data-ttentry-clear]'))){ e.preventDefault(); clearQ(); paint(); return; }
    if ((a = t.closest('[data-ttentry-week]'))){ S.week = a.getAttribute('data-ttentry-week'); S.picked = true; clearQ(); paint(); return; }
    if ((a = t.closest('[data-ttentry-ev]'))){ var id = a.getAttribute('data-ttentry-ev'); S.opened[id] = !S.opened[id]; paint(); }
  }
  function onInput(e){ if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-ttentry-q')){ S.q = e.target.value; paint(); } }

  function render(el){
    if (!el) return;
    injectCss();
    if (mounted !== el || !el.querySelector('.tt-entry-root')){
      mounted = el;
      el.innerHTML = shell();
      if (!el._ttEntryWired){ el._ttEntryWired = true; el.addEventListener('click', onClick); el.addEventListener('input', onInput); }
    }
    paint();
    var L = EL(), m = L && L.model ? L.model() : null;
    if (L && L.load && !(m && m.loaded)) L.load().then(function(){ if (mounted === el) paint(); });
  }
  // the data layer calls this when the ATP standings land (ranks / cut names re-join)
  function repaint(){ if (mounted && mounted.isConnected && mounted.querySelector('.tt-entry-root')) paint(); }

  window.TTEntry = { render: render, repaint: repaint, _view: view, _state: S, _weekLabel: weekLabel, _eventName: eventName, CSS: CSS, FOOT: FOOT };
})();
