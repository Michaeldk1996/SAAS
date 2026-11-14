/* sharp-drops-page.js — Sharp drop alerts (founder 2026-11-14; rules .claude/rules/sharp-drops.md).
 * Beta: admins only (isBspAdmin), opened through #sharp — no rail row yet. Built on the site tokens; to be redrawn by
 * Claude Design. Three blocks:
 *   1. Telegram — the member's link code (saved on his account) and the bot's link state (written by the member sync).
 *   2. Settings — levels, drop, price, time before the start, move shape, books, daily cap, quiet hours; saved to
 *      users/{uid}.sharpDrops through BSP.updateProfile, cleaned by SharpDropsCore (the engine's own filter).
 *   3. Record — every alert of the last 60 days from public.sharp_feed (graded on the Oddspapi Pinnacle close),
 *      filtered by the settings on screen. Nothing here computes a price: every figure is the engine's row, or a dash.
 */
(function () {
  'use strict';
  var C = window.SharpDropsCore;
  if (!C) return;
  var BOT_NAME = '';                 // the bot's @username once the members' bot exists; '' = the drop bot (beta)
  var DASH = '—', REFRESH_MS = 60000;
  var S = { active: false, feed: null, failed: false, draft: null, saved: null, status: '', timer: null, fixture: null };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function root() { return document.getElementById('sharpRoot'); }
  function user() { return window.BSP && BSP.currentUser ? BSP.currentUser() : null; }
  function isAdmin() { return S.fixture ? true : (typeof window.isBspAdmin === 'function' && window.isBspAdmin()); }
  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }
  function px(v) { return v == null || !isFinite(v) ? DASH : Number(v).toFixed(2); }
  function sgn(v, d, u) { if (v == null || !isFinite(v)) return DASH; var n = Number(v); return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(d) + (u || ''); }
  function when(iso) {
    var d = new Date(iso); if (isNaN(d)) return DASH;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function stored() { var u = user(); return (S.fixture && S.fixture.user) || (u && u.sharpDrops) || null; }
  function draft() {
    if (!S.draft) { var sd = stored(); S.draft = C.normalize(sd && sd.settings); S.saved = JSON.stringify(S.draft); }
    return S.draft;
  }
  function code() { var sd = stored(); return sd && sd.linkCode ? sd.linkCode : null; }

  // ── data ────────────────────────────────────────────────────────────────────
  function load() {
    if (S.fixture) { S.feed = S.fixture.feed; render(); return Promise.resolve(); }
    var url = (window.SUPABASE_URL || '').replace(/\/$/, ''), key = window.SUPABASE_ANON_KEY || '';
    if (!url || url.indexOf('__') === 0 || !key) { S.failed = true; render(); return Promise.resolve(); }
    return fetch(url + '/rest/v1/rpc/sharp_feed', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ p_days: 60 }) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { S.feed = j; S.failed = false; render(); })
      .catch(function () { S.failed = true; render(); });
  }
  // the first visit makes the link code and saves the founder's default rule with it
  function ensureCode() {
    if (S.fixture || code() || !user() || !window.BSP || S._making) return;
    S._making = true;
    BSP.updateProfile({ sharpDrops: { settings: draft(), linkCode: C.newCode(), tz: tz() } })
      .then(function () { S._making = false; render(); }, function () { S._making = false; S.status = 'Could not create your link code. Reload to try again.'; render(); });
  }
  function save() {
    if (S.fixture) { S.saved = JSON.stringify(S.draft); S.status = 'Saved.'; render(); return; }
    if (!window.BSP) return;
    S.status = 'Saving…'; render();
    BSP.updateProfile({ sharpDrops: { settings: S.draft, linkCode: code() || C.newCode(), tz: tz() } })
      .then(function () { S.saved = JSON.stringify(S.draft); S.status = 'Saved. Alerts follow these settings within 10 minutes.'; render(); },
            function () { S.status = 'Could not save. Check your connection and try again.'; render(); });
  }

  // ── render ──────────────────────────────────────────────────────────────────
  function seg(name, items, cur) {
    return '<div class="sd-seg" role="group" data-seg="' + name + '">' + items.map(function (it) {
      return '<button type="button" data-v="' + esc(it.id) + '" aria-pressed="' + (it.id === cur) + '">' + esc(it.label) + '</button>';
    }).join('') + '</div>';
  }
  function bandId(list, min, max) { var b = list.find(function (x) { return x.min === min && x.max === max; }); return b ? b.id : null; }
  function header(rows) {
    var g = rows.filter(function (r) { return r.result === 'W' || r.result === 'L'; });
    var w = g.filter(function (r) { return r.result === 'W'; }).length, pl = g.reduce(function (s, r) { return s + Number(r.pl || 0); }, 0);
    var ed = rows.filter(function (r) { return r.edge != null; });
    var stats = [
      ['Alerts', String(rows.length)],
      ['Won · Lost', g.length ? w + ' · ' + (g.length - w) : DASH],
      ['ROI at Bet105', g.length ? sgn(100 * pl / g.length, 1, '%') : DASH],
      ['Edge vs close', ed.length ? sgn(ed.reduce(function (s, r) { return s + Number(r.edge); }, 0) / ed.length, 1, '%') : DASH],
      ['Updated', S.feed && S.feed.generatedAt ? new Date(S.feed.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : DASH]
    ];
    return '<div class="sfh sd-head"><div class="sfh__text"><h1 class="sfh__title">Sharp drops</h1>'
      + '<p class="sfh__sub">Fast Bet105 drops before a match, sent to your Telegram, graded on the Pinnacle close'
      + '<span class="sfh__tail"> · Beta · your settings, last 60 days</span></p></div>'
      + '<div class="sfh__stats">' + stats.map(function (s) {
        return '<div class="sfh__stat"><span class="sfh__l">' + s[0] + '</span><span class="sfh__v' + (s[1] === DASH ? ' sfh__v--none' : '') + '">' + esc(s[1]) + '</span></div>';
      }).join('') + '</div></div>';
  }
  function telegramCard() {
    var sd = stored(), tg = (sd && sd.telegram) || {}, c = code();
    var state = tg.linked ? (tg.paused ? 'Paused: send /start to the bot to resume.' : 'Linked. Alerts that match your settings reach this chat.')
                          : 'Not linked yet.';
    var bot = BOT_NAME ? '<a class="sd-link" href="https://t.me/' + esc(BOT_NAME) + '" target="_blank" rel="noopener">@' + esc(BOT_NAME) + '</a>' : 'the Stennisfy alerts bot';
    return '<section class="sd-card" aria-label="Telegram"><div class="sd-cap">Telegram</div>'
      + '<p class="sd-state' + (tg.linked && !tg.paused ? ' is-on' : '') + '">' + esc(state) + '</p>'
      + (tg.linked ? '' : '<p class="sd-note">Open ' + bot + ' in Telegram and send this message once:</p>'
         + '<div class="sd-code"><code id="sdCode">' + (c ? '/start ' + esc(c) : 'Creating your code…') + '</code>'
         + (c ? '<button type="button" class="sd-btn sd-btn--quiet" data-act="copy">Copy</button>' : '') + '</div>'
         + '<p class="sd-note">Linking takes up to 10 minutes. Send /stop to the bot to pause alerts.</p>')
      + '</section>';
  }
  function settingsCard() {
    var s = draft(), dirty = JSON.stringify(s) !== S.saved;
    var levels = C.LEVELS.map(function (l) {
      return '<button type="button" class="sd-chip" data-level="' + esc(l.code) + '" aria-pressed="' + (s.levels.indexOf(l.code) >= 0) + '">' + esc(l.label) + '</button>';
    }).join('');
    var books = C.BOOKS.map(function (b) {
      return '<button type="button" class="sd-chip" data-book="' + esc(b.name) + '" aria-pressed="' + (s.books.indexOf(b.name) >= 0) + '"'
        + (b.live ? '' : ' disabled title="No feed yet"') + '>' + esc(b.name) + (b.live ? (b.note ? ' <small>' + esc(b.note) + '</small>' : '') : ' <small>soon</small>') + '</button>';
    }).join('');
    return '<section class="sd-card sd-set" aria-label="Alert settings">'
      + '<div class="sd-row sd-row--top"><div class="sd-cap">Your alerts</div>'
      + '<label class="sd-toggle"><input id="sdOn" type="checkbox"' + (s.enabled ? ' checked' : '') + '> Alerts on</label></div>'
      + '<div class="sd-field"><span class="sd-cap">Levels</span><div class="sd-chips">' + levels + '</div></div>'
      + '<div class="sd-field"><span class="sd-cap">Price drop within 5 minutes</span>' + seg('drop', C.DROP_BANDS, bandId(C.DROP_BANDS, s.dropMin, s.dropMax))
      + '<span class="sd-note">Drops over 6% usually come back before the start.</span></div>'
      + '<div class="sd-field"><span class="sd-cap">Bet105 price after the drop</span>' + seg('price', C.PRICE_BANDS, bandId(C.PRICE_BANDS, s.priceMin, s.priceMax)) + '</div>'
      + '<div class="sd-field"><span class="sd-cap">How long before the start</span>'
      + seg('window', C.WINDOWS.map(function (w) { return { id: String(w), label: w < 60 ? w + ' min' : (w / 60) + ' h' }; }), String(s.windowMin)) + '</div>'
      + '<div class="sd-field"><span class="sd-cap">Move shape</span>' + seg('shape', [{ id: 'any', label: 'Any' }, { id: 'steps', label: '2+ steps only' }], s.stepsOnly ? 'steps' : 'any')
      + '<span class="sd-note">A single jump wins less often than its price implies.</span></div>'
      + '<div class="sd-field"><span class="sd-cap">Books in the alert</span><div class="sd-chips">' + books + '</div></div>'
      + '<div class="sd-grid2"><div class="sd-field"><label class="sd-cap" for="sdCap">Alerts per day</label>'
      + '<input id="sdCap" class="sd-input" type="number" min="0" max="100" value="' + s.dailyCap + '"><span class="sd-note">0 = no limit</span></div>'
      + '<div class="sd-field"><span class="sd-cap">Quiet hours</span><div class="sd-row">'
      + '<input id="sdQFrom" class="sd-input" type="time" value="' + esc(s.quietFrom) + '" aria-label="Quiet from">'
      + '<span class="sd-note">to</span><input id="sdQTo" class="sd-input" type="time" value="' + esc(s.quietTo) + '" aria-label="Quiet until"></div>'
      + '<span class="sd-note">Your time zone (' + esc(tz()) + ')</span></div></div>'
      + '<div class="sd-row sd-row--save"><button type="button" class="sd-btn" data-act="save"' + (dirty ? '' : ' disabled') + '>Save settings</button>'
      + '<button type="button" class="sd-btn sd-btn--quiet" data-act="default">Use the default rule</button>'
      + '<span class="sd-note" role="status">' + esc(S.status) + '</span></div></section>';
  }
  function recordCard(rows) {
    var body;
    if (S.failed && !S.feed) body = '<p class="sd-empty">The record could not load. It retries every minute.</p>';
    else if (!S.feed) body = '<p class="sd-empty">Loading the record…</p>';
    else if (!rows.length) body = '<p class="sd-empty">No alerts match these settings in the last 60 days yet.</p>';
    else body = '<div class="sd-scroll"><table class="sd-table"><thead><tr><th>Alert</th><th>Level</th><th>Backed</th><th>Event</th>'
      + '<th class="n">Bet105</th><th class="n">Drop</th><th class="n">Bet at</th><th class="n">Kalshi</th><th class="n">Close</th>'
      + '<th class="n">Edge</th><th>Result</th><th class="n">P&amp;L</th></tr></thead><tbody>' + rows.slice(0, 100).map(function (r) {
        var lv = (C.LEVELS.find(function (l) { return l.code === r.level; }) || { label: r.level }).label;
        var res = r.result === 'W' || r.result === 'L' ? '<span class="sd-res sd-res--' + r.result + '">' + r.result + '</span>'
                : '<span class="sd-muted">' + esc(r.result || 'pending') + '</span>';
        return '<tr><td class="n">' + when(r.at) + '<div class="sd-muted">' + esc(r.mins) + ' min before</div></td><td>' + esc(lv) + '</td>'
          + '<td>' + esc(r.player) + '<div class="sd-muted">v ' + esc(r.opponent) + '</div></td><td class="sd-muted">' + esc(r.tournament || DASH) + '</td>'
          + '<td class="n">' + px(r.before) + ' → ' + px(r.price) + '</td><td class="n sd-neg">−' + Number(r.drop).toFixed(1) + '%</td>'
          + '<td class="n">' + px(r.betAt) + '</td><td class="n">' + px(r.kalshi) + '</td><td class="n">' + px(r.close) + '</td>'
          + '<td class="n ' + (r.edge > 0 ? 'sd-pos' : r.edge < 0 ? 'sd-neg' : '') + '">' + sgn(r.edge, 1, '%') + '</td><td>' + res + '</td>'
          + '<td class="n ' + (r.pl > 0 ? 'sd-pos' : r.pl < 0 ? 'sd-neg' : '') + '">' + sgn(r.pl, 2, 'u') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      + (rows.length > 100 ? '<p class="sd-note">Showing the newest 100 of ' + rows.length + '.</p>' : '');
    return '<section class="sd-card sd-rec" aria-label="Record"><div class="sd-cap">Record · your settings</div>'
      + '<p class="sd-note">Every alert stays in the record, winners and losers. Close = the Pinnacle closing price (Oddspapi); '
      + 'edge = the bet-at price against it; P&amp;L = 1 unit at the Bet105 price at the alert.</p>' + body + '</section>';
  }
  function render() {
    var el = root(); if (!el) return;
    if (!isAdmin()) { el.innerHTML = '<div class="sd-page"><div class="sd-card"><p class="sd-empty">Sharp drops is in beta and not open yet.</p></div></div>'; return; }
    var s = draft();
    var rows = ((S.feed && S.feed.alerts) || []).filter(function (r) {
      return C.passes({ level: r.level, drop: Number(r.drop), price: Number(r.price), mins: Number(r.mins), steps: Number(r.steps) }, s);
    });
    el.innerHTML = '<div class="sd-page">' + header(rows) + '<div class="sd-cols">' + telegramCard() + settingsCard() + '</div>' + recordCard(rows) + '</div>';
    ensureCode();
  }

  // ── events ──────────────────────────────────────────────────────────────────
  function onClick(e) {
    var b = e.target.closest('button'); if (!b || !root().contains(b) || b.disabled) return;
    var s = draft(), segEl = b.closest('[data-seg]');
    if (segEl) {
      var v = b.dataset.v, k = segEl.dataset.seg;
      if (k === 'drop') { var d = C.DROP_BANDS.find(function (x) { return x.id === v; }); s.dropMin = d.min; s.dropMax = d.max; }
      if (k === 'price') { var p = C.PRICE_BANDS.find(function (x) { return x.id === v; }); s.priceMin = p.min; s.priceMax = p.max; }
      if (k === 'window') s.windowMin = Number(v);
      if (k === 'shape') s.stepsOnly = v === 'steps';
    } else if (b.dataset.level) {
      var i = s.levels.indexOf(b.dataset.level);
      if (i >= 0 && s.levels.length > 1) s.levels.splice(i, 1); else if (i < 0) s.levels.push(b.dataset.level);
    } else if (b.dataset.book) {
      var j = s.books.indexOf(b.dataset.book);
      if (j >= 0 && s.books.length > 1) s.books.splice(j, 1); else if (j < 0) s.books.push(b.dataset.book);
    } else if (b.dataset.act === 'save') { save(); return; }
    else if (b.dataset.act === 'default') { S.draft = C.normalize({}); S.draft.enabled = s.enabled; }
    else if (b.dataset.act === 'copy') {
      var txt = '/start ' + code();
      var done = function () { S.status = 'Copied.'; render(); };
      try { navigator.clipboard.writeText(txt).then(done, function () { selectCode(); }); } catch (x) { selectCode(); }
      return;
    } else return;
    S.status = ''; render();
  }
  function selectCode() { var c = document.getElementById('sdCode'); if (!c) return; var r = document.createRange(); r.selectNodeContents(c); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  function onChange(e) {
    var s = draft(), t = e.target;
    if (t.id === 'sdOn') s.enabled = t.checked;
    else if (t.id === 'sdCap') s.dailyCap = Math.max(0, Math.min(100, Math.round(Number(t.value) || 0)));
    else if (t.id === 'sdQFrom') s.quietFrom = t.value || '';
    else if (t.id === 'sdQTo') s.quietTo = t.value || '';
    else return;
    S.status = ''; render();
  }
  function setActive(on) {
    S.active = on;
    if (on) { render(); load(); if (!S.timer && !S.fixture) S.timer = setInterval(function () { if (S.active && !document.hidden) load(); }, REFRESH_MS); }
  }
  function applyHash() {
    if (location.hash !== '#sharp') { if (S.active) setActive(false); return; }
    if (typeof window.sfActivateTabRaw === 'function') window.sfActivateTabRaw('sharp', '#sharp');
    else document.querySelectorAll('.tabpage').forEach(function (p) { p.classList.toggle('active', p.dataset.page === 'sharp'); });
    setActive(true);
  }
  function wire() {
    var el = root(); if (!el || el._sdWired) return; el._sdWired = true;
    el.addEventListener('click', onClick); el.addEventListener('change', onChange);
  }
  if (window.BSP && BSP.onAuthChange) BSP.onAuthChange(function () { S.draft = null; if (S.active) render(); });
  // tests inject a fixture: { user: {settings, linkCode, telegram}, feed: {generatedAt, alerts} }
  function inject(fx) { S.fixture = fx; S.draft = null; S.feed = fx.feed; if (S.timer) { clearInterval(S.timer); S.timer = null; } wire(); render(); }
  window.SharpDropsPage = { setActive: setActive, render: render, _inject: inject, _state: S };
  function boot() { wire(); applyHash(); }
  window.addEventListener('hashchange', applyHash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
