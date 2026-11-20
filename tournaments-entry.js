// Tournaments tab — Entry list (design_handoff_tournaments_2026-11-20 `Entry Lists.dc.html`; README §2 + the change log's
// "OPEN EVENT = ONE RINGED BLOCK", "ATP · CHALLENGER · ITF FILTER, DEFAULT ATP", "ENTRY LIST REFINED"). Owner: the TTEntry
// builder. The data layer stays window.EntryListsTab (the two-shard merge, the week set, the roster rank / name join); this
// module only renders it.
// Data rules kept (tournaments.md "Entry list"): a count we never fetched is "—", a real 0 stays 0; a rank the list does
// not print falls back to the current ATP ranking (hover says so), else "—"; a player with no country reads "—"; a name
// links to the profile, and its photo shows, only on a trusted key (linkKey); the meta line prints "published —" (no
// shard holds the list's publication date); ATP rows print the city key (never tourxEventName). Levels are the shard's
// own tiers (levelGroup): no mock row is ever drawn — a level with no event that week shows the empty state.
(function(){
  var S = { week: null, picked: false, q: '', opened: {}, openInit: {}, levels: { atp: true }, tabs: {} };
  var mounted = null;   // the #tourxEntry element we render into
  var LOGOS = null, logosP = null;   // tournament-logos/index.json `logos` map, loaded once

  var R = '.tabpage[data-page="tournaments"] ';
  var W = function(a){ return 'color-mix(in srgb, var(--tt-white) ' + a + '%, transparent)'; };
  var H = "'Hanken Grotesk',sans-serif", M = "'IBM Plex Mono',monospace";
  var TRACK = 'display:inline-flex; flex-wrap:wrap; gap:3px; background:var(--tt-inset); border:1px solid ' + W(6) + '; border-radius:10px; padding:3px;';
  var CSS = [
    R + '.tt-entry-root{ max-width:1360px; box-sizing:border-box; padding:22px 24px 26px; display:flex; flex-direction:column; gap:16px; font-family:' + H + '; color:var(--tt-text); line-height:normal; font-size:16px; -webkit-font-smoothing:antialiased; }',
    R + '.tt-entry-head{ display:flex; align-items:center; justify-content:space-between; gap:16px 28px; flex-wrap:wrap; }',
    R + '.tt-entry-titlebox{ display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; min-width:0; }',
    R + '.tt-entry-title{ font-size:24px; font-weight:800; letter-spacing:-0.015em; line-height:1.1; }',
    R + '.tt-entry-count{ font-size:13px; color:var(--tt-muted); }',
    R + '.tt-entry-search{ display:flex; align-items:center; gap:10px; box-sizing:border-box; width:300px; max-width:100%; height:38px; padding:0 13px; background:var(--tt-inset); border:1px solid ' + W(6) + '; border-radius:10px; cursor:text; }',
    R + '.tt-entry-search:focus-within{ background:var(--tt-lifted); border-color:' + W(14) + '; }',
    R + '.tt-entry-search svg{ flex:none; }',
    R + '.tt-entry-search input{ flex:1; min-width:0; background:transparent; border:0; outline:none; padding:0; margin:0; color:var(--tt-text); font-family:' + H + '; font-size:13.5px; font-weight:500; }',
    R + '.tt-entry-search input::placeholder{ color:var(--tt-muted); opacity:1; }',
    R + '.tt-entry-clear{ cursor:pointer; display:flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:6px; flex:none; }',
    R + '.tt-entry-clear:hover{ background:var(--tt-hover); }',
    R + '.tt-entry-clear[hidden]{ display:none; }',
    R + '.tt-entry-switches{ display:flex; align-items:center; justify-content:space-between; gap:12px 16px; flex-wrap:wrap; }',
    R + '.tt-entry-track{ ' + TRACK + ' }',
    R + '.tt-entry-seg{ cursor:pointer; display:flex; align-items:baseline; gap:9px; padding:6px 14px; border-radius:8px; background:transparent; border:1px solid transparent; transition:background .14s ease, color .14s ease; }',
    R + '.tt-entry-seg.on{ background:var(--tt-lifted); border-color:' + W(14) + '; }',
    R + '.tt-entry-slabel{ font-size:12.5px; font-weight:700; color:var(--tt-muted); white-space:nowrap; }',
    R + '.tt-entry-seg.on .tt-entry-slabel{ color:var(--tt-white); }',
    R + '.tt-entry-scount{ font-family:' + M + '; font-size:11px; font-weight:600; color:var(--tt-muted); white-space:nowrap; }',
    R + '.tt-entry-card{ background:var(--tt-card); border:1px solid ' + W(6) + '; border-radius:16px; padding-bottom:10px; }',
    R + '.tt-entry-grid{ display:grid; grid-template-columns:minmax(0,1fr) 84px 84px 84px 96px; gap:0 12px; }',
    R + '.tt-entry-ghead{ align-items:baseline; padding:22px 24px 12px; }',
    R + '.tt-entry-tier{ display:flex; align-items:baseline; gap:12px; min-width:0; }',
    R + '.tt-entry-tiername{ font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--tt-white); white-space:nowrap; }',
    R + '.tt-entry-tiermeta{ font-size:13px; color:var(--tt-muted); white-space:nowrap; }',
    // small labels 11.5/600 grey, never caps (BRIEF-COMMON; the export draws caps 10.5 here)
    R + '.tt-entry-lab{ font-size:11.5px; font-weight:600; color:var(--tt-muted); text-align:right; white-space:nowrap; }',
    R + '.tt-entry-wrap{ margin:0 14px; border-radius:12px; }',
    R + '.tt-entry-wrap.open{ margin:6px 14px; box-shadow:inset 0 0 0 1px ' + W(12) + '; }',
    R + '.tt-entry-ev{ align-items:center; min-height:60px; box-sizing:border-box; padding:10px; border-top:1px solid ' + W(6) + '; transition:background .12s ease; cursor:default; }',
    R + '.tt-entry-wrap.open .tt-entry-ev{ border-top-color:transparent; }',
    R + '.tt-entry-ev.can{ cursor:pointer; }',
    R + '.tt-entry-ev:hover{ background:var(--tt-hover); border-radius:10px; }',
    R + '.tt-entry-evleft{ min-width:0; display:flex; align-items:center; gap:12px; }',
    R + '.tt-entry-logo{ position:relative; flex:none; width:32px; height:32px; border-radius:9px; background:var(--tt-lifted); box-shadow:inset 0 0 0 1px ' + W(14) + '; display:flex; align-items:center; justify-content:center; font-family:' + M + '; font-size:10px; font-weight:700; color:var(--tt-soft); overflow:hidden; }',
    R + '.tt-entry-logo img{ position:absolute; inset:5px; width:22px; height:22px; object-fit:contain; background:var(--tt-lifted); }',
    R + '.tt-entry-evtext{ min-width:0; display:flex; flex-direction:column; gap:3px; }',
    R + '.tt-entry-evname{ font-size:14.5px; font-weight:700; color:var(--tt-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    R + '.tt-entry-ev.pending .tt-entry-evname{ color:var(--tt-soft); }',
    R + '.tt-entry-evmeta{ font-size:12px; color:var(--tt-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    R + '.tt-entry-n{ font-family:' + M + '; font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; text-align:right; color:var(--tt-white); }',
    R + '.tt-entry-n.none{ color:var(--tt-muted); }',
    R + '.tt-entry-cue{ justify-self:end; display:flex; align-items:center; gap:8px; font-size:12px; font-weight:600; color:var(--tt-muted); white-space:nowrap; }',
    R + '.tt-entry-cue svg{ transition:transform .16s ease; }',
    R + '.tt-entry-ev.open .tt-entry-cue svg{ transform:rotate(90deg); }',
    R + '.tt-entry-panel{ border-top:1px solid ' + W(6) + '; padding:16px 18px 12px; display:flex; flex-direction:column; gap:14px; }',
    R + '.tt-entry-tabrow{ display:flex; align-items:center; justify-content:space-between; gap:10px 16px; flex-wrap:wrap; }',
    R + '.tt-entry-tabnote{ font-size:12.5px; color:var(--tt-muted); white-space:nowrap; }',
    R + '.tt-entry-sec{ min-width:0; }',
    R + '.tt-entry-sechead{ display:flex; align-items:baseline; gap:10px; padding-bottom:10px; }',
    R + '.tt-entry-sectitle{ font-size:14px; font-weight:700; color:var(--tt-white); white-space:nowrap; }',
    R + '.tt-entry-secnote{ font-size:12px; color:var(--tt-muted); white-space:nowrap; }',
    R + '.tt-entry-cols{ columns:300px 2; column-gap:36px; }',
    R + '.tt-entry-prow{ break-inside:avoid; display:grid; grid-template-columns:22px 26px minmax(0,1fr) 34px 48px; gap:0 10px; align-items:center; height:42px; padding:0 8px; border-top:1px solid ' + W(6) + '; }',
    R + '.tt-entry-prow:hover{ background:var(--tt-hover); border-radius:8px; }',
    R + '.tt-entry-pno{ text-align:right; font-family:' + M + '; font-size:11px; font-variant-numeric:tabular-nums; color:var(--tt-muted); }',
    R + '.tt-entry-av{ position:relative; width:26px; height:26px; border-radius:50%; background:var(--tt-lifted); box-shadow:inset 0 0 0 1px ' + W(10) + '; display:flex; align-items:center; justify-content:center; font-size:9.5px; font-weight:700; color:var(--tt-soft); overflow:hidden; }',
    R + '.tt-entry-av.bye{ background:transparent; box-shadow:none; }',
    R + '.tt-entry-pname{ font-size:13.5px; font-weight:600; color:var(--tt-white); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }',
    R + '.tt-entry-pname a{ color:var(--tt-white); text-decoration:none; cursor:pointer; }',
    R + '.tt-entry-pname a:hover{ text-decoration:underline; }',
    R + '.tt-entry-pname.bye{ color:var(--tt-muted); }',
    R + '.tt-entry-pnat{ text-align:right; font-family:' + M + '; font-size:11px; color:var(--tt-muted); }',
    R + '.tt-entry-prank{ text-align:right; font-family:' + M + '; font-size:13px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--tt-white); }',
    R + '.tt-entry-prank.none{ color:var(--tt-muted); font-weight:600; }',
    R + '.tt-entry-empty{ background:var(--tt-card); border:1px solid ' + W(6) + '; border-radius:16px; padding:24px; max-width:560px; }',
    R + '.tt-entry-emptyt{ font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--tt-white); }',
    R + '.tt-entry-emptyn{ margin:8px 0 0; font-size:13.5px; line-height:1.65; color:var(--tt-soft); text-wrap:pretty; }',
    R + '.tt-entry-clearbtn{ cursor:pointer; display:inline-flex; align-items:center; height:34px; box-sizing:border-box; margin-top:16px; padding:0 13px; border-radius:9px; background:var(--tt-lifted); border:1px solid ' + W(14) + '; font-size:12.5px; font-weight:700; color:var(--tt-white); }',
    R + '.tt-entry-clearbtn:hover{ background:var(--tt-hover); }',
    R + '.tt-entry-foot{ margin:0; font-size:12px; color:var(--tt-muted); }',
    R + '.tt-entry-wait{ font-size:13px; color:var(--tt-muted); }'
  ].join('\n');

  var FOOT = 'Acceptance order, not seeding. Ranks are the ATP singles ranking when the list was published.';
  var MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var LEVELS = [['atp', 'ATP'], ['ch', 'Challenger'], ['itf', 'ITF']];
  var CHEV = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--tt-blue)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2 L6.5 5 L3.5 8"></path></svg>';
  var LENS = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--tt-muted)" stroke-width="1.6" stroke-linecap="round"><circle cx="6" cy="6" r="4.4"></circle><path d="M9.4 9.4 L12.6 12.6"></path></svg>';
  var XMARK = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--tt-soft)" stroke-width="1.6" stroke-linecap="round"><path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5"></path></svg>';

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
  function loadLogos(){
    if (LOGOS || logosP || typeof fetch !== 'function') return;
    logosP = fetch('./tournament-logos/index.json', { cache: 'no-cache' }).then(function(r){ return r.ok ? r.json() : {}; })
      .catch(function(){ return {}; }).then(function(j){ LOGOS = (j && j.logos) || {}; repaint(); });
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
  // Level of a row, from the data layer's own tier group (Challenger / ITF; every other group is the ATP tour).
  function levelOf(t){ var g = EL().levelGroup(t.tier); return g === 'Challenger' ? 'ch' : g === 'ITF' ? 'itf' : 'atp'; }

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
  // Logo tile: the event's file from tournament-logos/index.json (ATP-tour rows only — the map is keyed by ATP event
  // names, so "M15 Antalya" must not borrow the ATP 250's logo); else the design's three-letter code.
  function logoHtml(t){
    var nm = eventName(t), code = fold(nm.replace(/^M\d+\s+/, '')).replace(/[^a-z]/g, '').slice(0, 3).toUpperCase();
    var f = levelOf(t) === 'atp' && LOGOS ? LOGOS[nm] : null;
    return '<span class="tt-entry-logo">' + esc(code)
      + (f ? '<img src="./tournament-logos/' + esc(f) + '" alt="' + esc(nm) + ' logo" loading="lazy" onerror="this.remove()">' : '') + '</span>';
  }
  function countKey(title){ var s = fold(title); return /qual/.test(s) ? 'Q' : /alt|reserve/.test(s) ? 'ALT' : /main/.test(s) ? 'MD' : null; }
  function initials(nm){ var w = String(nm || '').replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean); return w.length ? (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() : ''; }

  function segHtml(on, attr, val, label, count){
    return '<span class="tt-entry-seg' + (on ? ' on' : '') + '" role="tab" aria-selected="' + on + '" ' + attr + '="' + esc(val) + '">'
      + '<span class="tt-entry-slabel">' + esc(label) + '</span><span class="tt-entry-scount">' + (count == null ? '—' : count) + '</span></span>';
  }

  function playerRow(el, p, i){
    if (p.status === 'BYE') return '<div class="tt-entry-prow"><span class="tt-entry-pno"></span><span class="tt-entry-av bye"></span><span class="tt-entry-pname bye">Bye</span><span class="tt-entry-pnat"></span><span class="tt-entry-prank"></span></div>';
    var nm = el.displayName(p), st = el.fmtStatus(p.status, p.seed), rk = el.rankOf(p), key = el.linkKey(p);
    var tip = esc(nm + (st ? ' · ' + st : ''));
    var inner = key ? '<a data-ttentry-profile="' + esc(key) + '" title="' + tip + '">' + esc(nm) + '</a>' : '<span title="' + tip + '">' + esc(nm) + '</span>';
    // photo by the trusted key only (player-photos.md); initials stay under it as the fallback
    var ph = key && typeof playerPhotoImg === 'function' ? playerPhotoImg(key, nm) : '';
    return '<div class="tt-entry-prow">'
      + '<span class="tt-entry-pno">' + (i + 1) + '</span>'
      + '<span class="tt-entry-av">' + esc(initials(nm)) + ph + '</span>'
      + '<span class="tt-entry-pname">' + inner + '</span>'
      + '<span class="tt-entry-pnat">' + esc(p.country || '—') + '</span>'
      + '<span class="tt-entry-prank' + (rk ? '' : ' none') + '"' + (rk && rk.src === 'atp' ? ' title="Current ATP ranking (the list prints none)"' : '') + '>'
        + (rk ? '#' + rk.rank : '—') + '</span>'
      + '</div>';
  }

  function panelHtml(el, t, id, hit){
    var cols = (t.sections || []).map(function(sec){
      var all = (sec.players || []).map(function(p, i){ return { p: p, i: i }; });
      var rows = hit ? all.filter(function(x){ return hit(x.p); }) : all;
      var ck = countKey(sec.title), tot = (t.counts && ck && t.counts[ck] != null) ? t.counts[ck] : null;
      var n = (sec.players || []).length;
      var note = hit ? (rows.length === 1 ? '1 match' : rows.length + ' matches')
        : (tot != null && n < tot ? 'first ' + n + ' of ' + tot : (tot != null ? tot : n) + ' players');
      return { title: sentence(sec.title), total: tot != null ? tot : n, note: note, rows: rows };
    }).filter(function(c){ return c.rows.length > 0; });
    var cur = Math.min(S.tabs[id] || 0, cols.length - 1);
    var sec = function(c, head){
      return '<div class="tt-entry-sec">'
        + (head ? '<div class="tt-entry-sechead"><span class="tt-entry-sectitle">' + esc(c.title) + '</span><span class="tt-entry-secnote">' + esc(c.note) + '</span></div>' : '')
        + '<div class="tt-entry-cols">' + c.rows.map(function(x){ return playerRow(el, x.p, x.i); }).join('') + '</div></div>';
    };
    var body;
    if (hit) body = cols.map(function(c){ return sec(c, true); }).join('');     // searching: every list with a hit, stacked
    else if (cols.length > 1) body = '<div class="tt-entry-tabrow"><div class="tt-entry-track" role="tablist" aria-label="Lists">'
        + cols.map(function(c, i){ return segHtml(i === cur, 'data-ttentry-tab', id + '#' + i, c.title, c.total); }).join('')
        + '</div><span class="tt-entry-tabnote">' + esc(cap1(cols[cur].note)) + '</span></div>' + sec(cols[cur], false);
    else body = cols.length ? sec(cols[0], true) : '';
    return '<div class="tt-entry-panel">' + body + '</div>';
  }

  function eventHtml(el, t, searching, hit){
    var has = el.hasList(t), id = el.eventId(t), open = has && (searching || !!S.opened[id]);
    var c = t.counts || {};
    // a row we never fetched dashes all three counts (the shard is not trusted to be self-consistent); a real 0 stays 0
    var cell = function(v){ v = has ? v : null; return '<span class="tt-entry-n' + (v == null ? ' none' : '') + '">' + (v == null ? '—' : esc(v)) + '</span>'; };
    var meta = [monDay(t.startDate || t.weekStart), t.surface ? cap1(t.surface) : null, 'published —'].filter(Boolean).join(' · ');
    var cls = 'tt-entry-grid tt-entry-ev' + (has ? '' : ' pending') + (open ? ' open' : '') + (has && !searching ? ' can' : '');
    return '<div class="tt-entry-wrap' + (open ? ' open' : '') + '">'
      + '<div class="' + cls + '"' + (has && !searching ? ' data-ttentry-ev="' + esc(id) + '"' : '')
        + (has ? '' : ' title="Player names are not loaded for this event yet"') + '>'
      + '<span class="tt-entry-evleft">' + logoHtml(t) + '<span class="tt-entry-evtext"><span class="tt-entry-evname">' + esc(eventName(t)) + '</span>'
        + '<span class="tt-entry-evmeta" title="No source holds the date this list was published">' + esc(meta) + '</span></span></span>'
      + cell(c.MD) + cell(c.Q) + cell(c.ALT)
      + '<span class="tt-entry-cue">' + (has ? CHEV : '<span>Names pending</span>') + '</span>'
      + '</div>'
      + (open ? panelHtml(el, t, id, searching ? hit : null) : '')
      + '</div>';
  }

  function groupsHtml(el, list, searching, hit){
    var by = {};
    list.forEach(function(t){ var g = el.levelGroup(t.tier); (by[g] = by[g] || []).push(t); });
    // GROUP_ORDER already runs ATP tiers, then Challenger, then ITF (the design's level order)
    return el.GROUP_ORDER.filter(function(g){ return by[g] && by[g].length; }).map(function(g){
      var evs = by[g].slice().sort(function(a, b){
        var ap = a.status === 'pending' ? 1 : 0, bp = b.status === 'pending' ? 1 : 0;
        if (ap !== bp) return ap - bp;
        if (searching && a.weekStart !== b.weekStart) return a.weekStart < b.weekStart ? -1 : 1;
        return eventName(a).localeCompare(eventName(b));
      });
      return '<div class="tt-entry-card">'
        + '<div class="tt-entry-grid tt-entry-ghead"><span class="tt-entry-tier"><span class="tt-entry-tiername">' + esc(g) + '</span><span class="tt-entry-tiermeta">' + evs.length + (evs.length === 1 ? ' event' : ' events') + '</span></span>'
          + '<span class="tt-entry-lab">Main draw</span><span class="tt-entry-lab">Qualifying</span><span class="tt-entry-lab">Alternates</span><span></span></div>'
        + evs.map(function(t){ return eventHtml(el, t, searching, hit); }).join('')
        + '</div>';
    }).join('');
  }

  function emptyHtml(title, note, clear){
    return '<div class="tt-entry-empty"><div class="tt-entry-emptyt">' + esc(title) + '</div><p class="tt-entry-emptyn">' + esc(note) + '</p>'
      + (clear ? '<span class="tt-entry-clearbtn" data-ttentry-clear>Clear search</span>' : '') + '</div>';
  }

  // The view for the current model: { count, countTitle, weeks (both switches), body, searching }. Exposed for the test.
  function view(m){
    var el = EL(), q = fold(S.q.trim()), searching = q.length > 0;
    if (!S.picked || m.weeks.indexOf(S.week) < 0) S.week = m.defaultWeek;
    var hit = function(p){ return !!p && p.status !== 'BYE' && (fold(p.name).indexOf(q) >= 0 || fold(el.displayName(p)).indexOf(q) >= 0); };
    var inWeek = function(t){ return t.weekStart === S.week; };
    var shown;
    if (searching) shown = m.tournaments.filter(function(t){ return m.weeks.indexOf(t.weekStart) >= 0
      && (t.sections || []).some(function(s){ return (s.players || []).some(hit); }); });
    else {
      shown = m.tournaments.filter(function(t){ return inWeek(t) && S.levels[levelOf(t)]; });
      // first visit to a week + level set: its first event with names opens (the design's default shows an open list)
      var ik = S.week + '|' + LEVELS.filter(function(l){ return S.levels[l[0]]; }).map(function(l){ return l[0]; }).join(',');
      if (!S.openInit[ik]){
        S.openInit[ik] = 1;
        var first = null;
        el.GROUP_ORDER.some(function(g){
          first = shown.filter(function(t){ return el.levelGroup(t.tier) === g && el.hasList(t) && t.status !== 'pending'; })
            .sort(function(a, b){ return eventName(a).localeCompare(eventName(b)); })[0] || null;
          return !!first;
        });
        if (first) S.opened[el.eventId(first)] = true;
      }
    }
    var nLists = shown.filter(el.hasList).length;
    var count = searching ? (shown.length === 1 ? 'Entered in 1 event' : 'Entered in ' + shown.length + ' events') + ' · all weeks'
      : shown.length + (shown.length === 1 ? ' event' : ' events') + ' · ' + nLists + ' with names loaded';
    var countTitle = 'Events shown for the week and levels picked; with names loaded = events whose acceptance list is in the build.'
      + (m.advMeta && m.advMeta.fetchStatus === 'stale' ? ' The advance source could not be refreshed: these are the last lists fetched (' + (m.advMeta.generatedAt || 'unknown') + ').' : '')
      // B9 (kept through the rebuild): the draw sheets' CONTENT last changed (sourcePublished), never our fetch time alone.
      + (m.drawMeta && m.drawMeta.sourcePublished ? ' Draw sheets: content last changed ' + fmtWhen(m.drawMeta.sourcePublished)
          + (m.drawMeta.generatedAt ? ', checked ' + fmtWhen(m.drawMeta.generatedAt) : '') + '.' : '');
    var dim = ' style="opacity:' + (searching ? 0.55 : 1) + ';"';
    var weeksHtml = '<div class="tt-entry-switches">'
      + '<div class="tt-entry-track" role="tablist" aria-label="Entry list weeks"' + dim + '>'
      + m.weeks.map(function(k){ return segHtml(!searching && k === S.week, 'data-ttentry-week', k, weekLabel(k), el.weekEventCount(k)); }).join('') + '</div>'
      + '<div class="tt-entry-track" role="tablist" aria-label="Levels" title="Levels shown. At least one stays on."' + dim + '>'
      + LEVELS.map(function(l){
          var n = m.tournaments.filter(function(t){ return inWeek(t) && levelOf(t) === l[0]; }).length;
          return segHtml(!searching && !!S.levels[l[0]], 'data-ttentry-level', l[0], l[1], n);
        }).join('') + '</div></div>';
    var body = groupsHtml(el, shown, searching, hit);
    if (!shown.length) body = searching
      ? emptyHtml('No player found', 'Nobody matching “' + S.q.trim() + '” is on a loaded list. Events still waiting for their player names are not searched.', true)
      : emptyHtml('No events at this level this week', 'Nothing is listed for ' + weekLabel(S.week) + ' at the levels switched on. Turn on another level or pick another week.', false);
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
      body.innerHTML = m && m.failed ? emptyHtml('Entry lists unavailable', 'The entry-list data could not be loaded. This is an error, not an empty schedule. Try again in a minute.', false)
        : '<div class="tt-entry-wait">Loading entry lists…</div>';
      return;
    }
    var v = view(m);
    cnt.textContent = v.count; cnt.title = v.countTitle;
    wk.innerHTML = v.weeks;
    body.innerHTML = v.body;
  }

  function clearQ(){ S.q = ''; var inp = mounted && mounted.querySelector('[data-ttentry-q]'); if (inp) inp.value = ''; }
  // ATP · Challenger · ITF: multi-select, at least one stays on; while searching a click clears the search and shows that
  // level only (the design's rule).
  function toggleLevel(k){
    if (S.q.trim()){ clearQ(); S.levels = {}; S.levels[k] = true; return; }
    var nx = Object.assign({}, S.levels); nx[k] = !nx[k];
    if (LEVELS.some(function(l){ return nx[l[0]]; })) S.levels = nx;
  }
  function onClick(e){
    var t = e.target, a;
    if ((a = t.closest('[data-ttentry-profile]'))){ e.preventDefault(); e.stopPropagation(); if (typeof sfGoToProfile === 'function') sfGoToProfile(a.getAttribute('data-ttentry-profile')); return; }
    if ((a = t.closest('[data-ttentry-clear]'))){ e.preventDefault(); clearQ(); paint(); return; }
    if ((a = t.closest('[data-ttentry-week]'))){ S.week = a.getAttribute('data-ttentry-week'); S.picked = true; clearQ(); paint(); return; }
    if ((a = t.closest('[data-ttentry-level]'))){ toggleLevel(a.getAttribute('data-ttentry-level')); paint(); return; }
    if ((a = t.closest('[data-ttentry-tab]'))){ var v = a.getAttribute('data-ttentry-tab'), j = v.lastIndexOf('#'); S.tabs[v.slice(0, j)] = +v.slice(j + 1); paint(); return; }
    if ((a = t.closest('[data-ttentry-ev]'))){ var id = a.getAttribute('data-ttentry-ev'); S.opened[id] = !S.opened[id]; paint(); }
  }
  function onInput(e){ if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-ttentry-q')){ S.q = e.target.value; paint(); } }

  function render(el){
    if (!el) return;
    injectCss(); loadLogos();
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

  window.TTEntry = { render: render, repaint: repaint, _view: view, _state: S, _toggleLevel: toggleLevel, _weekLabel: weekLabel, _eventName: eventName,
    _setLogos: function(x){ LOGOS = x; }, CSS: CSS, FOOT: FOOT };
})();
