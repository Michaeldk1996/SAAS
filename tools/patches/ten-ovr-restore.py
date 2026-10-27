#!/usr/bin/env python3
# Founder brief 2026-10-26 item 1: the Tournaments Overview goes back to its pre-f255dca34 build (court speed hero, slider,
# rank, Altitude / 1st serve / Service hold tiles, Conditions read, speed trend) and the round-2 blocks move, unchanged, to a
# new "Stats" tab. Replayable: every step checks the RESULT state, so a second run is a no-op.
import sys, pathlib

F = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'bsp-consult-dashboard.html')
s = F.read_text()

def step(name, old, new, done_marker):
    global s
    if done_marker in s:
        print('skip (already applied):', name); return
    n = s.count(old)
    if n != 1:
        sys.exit(f'FAIL {name}: anchor found {n} times')
    s = s.replace(old, new)
    print('applied:', name)

# 1 · the two round-2 catalog events with no court-speed sheet row are listed on the Overview (speed = dash)
step('catalog listUnrated',
  "{ name: 'Lyon (France)', category: 'ATP 250', surface: 'hard', indoor: true, country: 'FR', tournamentKeys: ['14763'], firstEdition: 2026, pointsKey: 'lyon' },\n  { name: 'Brussels', category: 'ATP 250', surface: 'hard', indoor: true, country: 'BE', tournamentKeys: ['3669'] },",
  "{ name: 'Lyon (France)', category: 'ATP 250', surface: 'hard', indoor: true, country: 'FR', tournamentKeys: ['14763'], firstEdition: 2026, pointsKey: 'lyon', listUnrated: true },\n  { name: 'Brussels', category: 'ATP 250', surface: 'hard', indoor: true, country: 'BE', tournamentKeys: ['3669'], listUnrated: true },",
  "pointsKey: 'lyon', listUnrated: true")

# 2 · the page header names court speed again
step('header sub',
  '<p class="sfh__sub">Conditions and market yields for every event on the calendar.</p>',
  '<p class="sfh__sub">Court speed, conditions and market yields for every event on the calendar.</p>',
  '<p class="sfh__sub">Court speed, conditions and market yields for every event on the calendar.</p>')

# 3 · Events counts the Overview's own list
step('head stats',
  "  // round 2 (founder 2026-10-25): Events counts the page's own list (every catalog event, tpPageEvents), not the\n  // court-speed registry it no longer lists by.\n  const listed = typeof tpPageEvents === 'function' ? tpPageEvents() : reg;\n",
  "  // Founder 2026-10-26: Events counts the Overview's own list (the court-speed registry plus the listUnrated events).\n  const listed = typeof tourxOverviewEvents === 'function' ? tourxOverviewEvents() : reg;\n",
  "const listed = typeof tourxOverviewEvents === 'function' ? tourxOverviewEvents() : reg;")

# 4 · repaint hooks also repaint the Stats tab (it shares the Overview mount)
step('quotes repaint',
  "tourxQuotes = (j && j.tournaments) || {}; if (tourxState.section === 'overview') renderTourxOverview();",
  "tourxQuotes = (j && j.tournaments) || {}; if (tourxState.section === 'overview' || tourxState.section === 'stats') renderTourxOverview();",
  "tourxQuotes = (j && j.tournaments) || {}; if (tourxState.section === 'overview' || tourxState.section === 'stats')")
step('market repaint',
  "tourxFetchMarket().then(d => { if (d && tourxState.section === 'overview') renderTourxOverview(); });",
  "tourxFetchMarket().then(d => { if (d && (tourxState.section === 'overview' || tourxState.section === 'stats')) renderTourxOverview(); });",
  "if (d && (tourxState.section === 'overview' || tourxState.section === 'stats')) renderTourxOverview();")

# 5 · the Stats tab, next to the others; it reuses the Overview mount (same rail, its own right-hand panel)
step('tab rail',
  "    .concat([['reports', 'Reports']]);\n  if (tourxState.section === 'entry'",
  "    .concat([['reports', 'Reports']])\n    .concat([['stats', 'Stats']]);   // founder 2026-10-26: How it plays, Favourites vs underdogs, Points to defend\n  if (tourxState.section === 'entry'",
  ".concat([['stats', 'Stats']]);")
step('section display',
  "  ov.style.display = sec === 'overview' ? '' : 'none';",
  "  ov.style.display = sec === 'overview' || sec === 'stats' ? '' : 'none';",
  "ov.style.display = sec === 'overview' || sec === 'stats' ? '' : 'none';")
step('section render',
  "  if (sec === 'overview') renderTourxOverview();\n  else if (sec === 'entry')",
  "  if (sec === 'overview' || sec === 'stats') renderTourxOverview();\n  else if (sec === 'entry')",
  "if (sec === 'overview' || sec === 'stats') renderTourxOverview();")
step('right panel by section',
  '<div class="tourx-ovright">${tourxConditionsPanelHtml()}</div>',
  '<div class="tourx-ovright">${tourxState.section === \'stats\' ? tpStatsPanelHtml() : tourxConditionsPanelHtml()}</div>',
  "tourxState.section === 'stats' ? tpStatsPanelHtml() : tourxConditionsPanelHtml()")

# 6 · the rail: the pre-round-2 list (speed figure, fastest first); unrated listed events sort last with a dash
step('rail list',
  """  const reg = tpPageEvents();   // round 2: every catalog event (court speed no longer decides who is listed)""",
  """  const reg = tourxOverviewEvents();""",
  "  const reg = tourxOverviewEvents();\n  const q = tourxState.tsQ")
step('rail sort',
  """  const byLabel = (a, b) => tpEventLabel(a.name).localeCompare(tpEventLabel(b.name));
  const week = reg.filter(t => weekNames.has(t.name) && match(t)).sort(byLabel);
  const season = reg.filter(t => !weekNames.has(t.name) && match(t)).sort(byLabel);""",
  """  const bySpeed = (a, b) => (b.abstractSpeed == null ? -1 : b.abstractSpeed) - (a.abstractSpeed == null ? -1 : a.abstractSpeed);
  const week = reg.filter(t => weekNames.has(t.name) && match(t)).sort(bySpeed);
  const season = reg.filter(t => !weekNames.has(t.name) && match(t)).sort(bySpeed);""",
  "const bySpeed = (a, b) =>")
step('rail speed figure',
  """-webkit-line-clamp:2;line-height:1.3;">${typeof tourxEventName === 'function' ? tourxEventName(t.name) : t.name}</span>
      </div>`;""",
  """-webkit-line-clamp:2;line-height:1.3;">${typeof tourxEventName === 'function' ? tourxEventName(t.name) : t.name}</span>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;color:${t.abstractSpeed == null ? 'var(--text-label)' : 'var(--text)'};flex:none;">${t.abstractSpeed == null ? '—' : t.abstractSpeed.toFixed(2)}</span>
      </div>`;""",
  "${t.abstractSpeed == null ? '—' : t.abstractSpeed.toFixed(2)}</span>")
step('rail empty text',
  'No tournaments to show.</div>`;',
  'No rated tournaments to show.</div>`;',
  'No rated tournaments to show.</div>`;')
step('resolve',
  "  const c = tpPageEvents().find(t => t.name === name);   // round 2: every catalog event",
  "  const c = tourxOverviewEvents().find(t => t.name === name);",
  "  const c = tourxOverviewEvents().find(t => t.name === name);")

# 7 · the Overview panel, as before f255dca34 (hero, tiles, Conditions read, speed trend); an unrated event prints dashes
OLD_PANEL_HEAD = """  const MONO = "'IBM Plex Mono',monospace";
  const EY = `font-family:var(--font-words); font-size:10.5px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);`;"""
step('panel as',
  OLD_PANEL_HEAD,
  """  const MONO = "'IBM Plex Mono',monospace";
  const as = c.abstractSpeed == null ? null : c.abstractSpeed;   // null = no court-speed sheet row (Brussels, Lyon (France)): dashes
  const EY = `font-family:var(--font-words); font-size:10.5px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);`;""",
  "  const as = c.abstractSpeed == null ? null : c.abstractSpeed;")
step('panel hero',
  """      <div style="font-size:13px;color:var(--text-label);margin-top:6px;">${c.category} · ${tourxCap(c.surface)} court${c.indoor === true ? ' · Indoor' : c.indoor === false ? ' · Outdoor' : ''}</div>
    </div>`;
""",
  """      <div style="font-size:13px;color:var(--text-label);margin-top:6px;">${c.category} · ${tourxCap(c.surface)} court</div>
    </div>`;

  // ---- court-speed hero (§1.2) -------------------------------------------
  // FOUNDER RULING 2026-09-19: the band word is courtSpeedCategory()'s, not the
  // README's four bands. c.speedCat IS that function's output, and the Conditions
  // read below is generated from the same value - one function, one word.
  // Founder 2026-10-26: restored as it was before round 2; the label credits Tennis Abstract on hover.
  const bandWord = c.speedCat || '—';
  const knob = as == null ? null : tourxKnobPct(as, tourxConditionRegistry().map(t => t.abstractSpeed));
  const asTip = `Abstract court speed: Tennis Abstract's court-speed rating (tennisabstract.com)${c.abstractSpeedYear ? `, ${c.abstractSpeedYear} reading` : ''}.${as == null ? ' No reading for this event.' : ''}`;
  const hero = `<div>
      <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;">
        <span style="font-family:${MONO};font-size:52px;font-weight:700;line-height:0.9;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;color:${as == null ? 'var(--text-label)' : 'var(--text)'};">${as == null ? '—' : as.toFixed(2)}</span>
        <span class="tourx-as-label" tabindex="0" title="${asTip}" style="font-size:13px;color:var(--text-label);cursor:help;">abstract court speed · <span style="color:var(--text);font-weight:600;">${bandWord}</span></span>
      </div>
      <!-- TEN-401 ticket item 4 (override, closes the step-1 court-speed scale item): an 8px track at 6% white, no
           gradient; a white knob with a 3px card-tone ring and nothing else. -->
      <div onclick="tourxOpenSpeedPanel()" title="Compare every rated event" style="position:relative;margin-top:18px;height:8px;border-radius:5px;background:var(--track);cursor:pointer;">
        ${knob == null ? '' : `<span style="position:absolute;top:50%;left:${knob}%;width:16px;height:16px;border-radius:50%;background:var(--text);border:3px solid var(--card);transform:translate(-50%,-50%);"></span>`}
      </div>
      <div style="margin-top:9px;display:flex;justify-content:space-between;font-size:10.5px;letter-spacing:0.10em;text-transform:uppercase; font-weight:700;color:var(--text-label);"><span>Slow</span><span>Medium</span><span>Fast</span></div>
      ${as == null ? '' : tourxRankLineHtml(as)}
    </div>`;
""",
  "  // ---- court-speed hero (§1.2) ----")
step('panel tiles',
  """      ${tile('Altitude', c.altitude != null ? c.altitude + ' m' : null)}
    </div>`;
""",
  """      ${tile('Altitude', c.altitude != null ? c.altitude + ' m' : null)}
      ${tile('1st serve point won', c.firstServeWon != null ? c.firstServeWon + '%' : null)}
      ${tile('Service hold', c.serviceHold != null ? c.serviceHold + '%' : null)}
    </div>`;

  // ---- conditions read (§1.2) --------------------------------------------
  // generated from the court-speed reading; no reading → a dash, never prose without its number
  const read = `<div style="${CARD}border-radius:12px;padding:16px 18px;">
      <div style="${EY}margin-bottom:11px;">Conditions read</div>
      <p style="margin:0;font-size:13.5px;line-height:1.7;color:${as == null ? 'var(--text-label)' : 'var(--text)'};text-wrap:pretty;">${as == null ? '—' : tourxConditionsProse(c.surface, c.speedCat, as, tourxBounce(c.surface, c.altitude, c.speedCat))}</p>
    </div>`;
""",
  "  // ---- conditions read (§1.2) ----")
step('panel order',
  "      ${title}${tpPointsDefendHtml(c)}${tpHowItPlaysHtml(c)}${tpFavDogHtml(c)}${tiles}${tourxQuotesCardHtml(c)}${tourxRoiPairHtml(c)}${tourxReliabilityHtml(c)}${tourxReportCtaHtml(c)}\n    </div>`;\n}\n",
  """      ${title}${hero}${tiles}${read}${tourxQuotesCardHtml(c)}${tourxSpeedSeriesHtml(c)}${tourxRoiPairHtml(c)}${tourxReliabilityHtml(c)}${tourxReportCtaHtml(c)}
    </div>`;
}
// Founder 2026-10-26: the Stats tab — the round-2 blocks, unchanged, under the same title (same rail, same selection).
function tpStatsPanelHtml(){
  const c = tourxResolveCondition(tourxState.tsSel);
  if (!c) return `<div style="padding:40px 26px;color:var(--text-label);font-size:14px;">Select a tournament to view its stats.</div>`;
  const title = `<div>
      <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap;"><span style="font-size:29px;font-weight:800;letter-spacing:-0.015em;color:var(--text);">${typeof tourxEventName === 'function' ? tourxEventName(c.name) : c.name}</span></div>
      <div style="font-size:13px;color:var(--text-label);margin-top:6px;">${c.category} · ${tourxCap(c.surface)} court${c.indoor === true ? ' · Indoor' : c.indoor === false ? ' · Outdoor' : ''}</div>
    </div>`;
  return `<div style="display:flex;flex-direction:column;gap:16px;min-width:0;padding-left:24px;">
      ${title}${tpHowItPlaysHtml(c)}${tpFavDogHtml(c)}${tpPointsDefendHtml(c)}
    </div>`;
}
""",
  "function tpStatsPanelHtml(){")

# 8 · the Overview's list: the court-speed registry (as before) plus catalog events flagged listUnrated (no reading)
step('overview events',
  "function tpEventLabel(name){",
  """function tourxOverviewEvents(){
  const reg = tourxConditionRegistry(), have = new Set(reg.map(t => t.name));
  const extra = TOURNAMENT_CATALOG.filter(t => t.listUnrated && !have.has(t.name))
    .map(t => Object.assign({ abstractSpeed: null, speedCat: null, altitude: null, firstServeWon: null, serviceHold: null }, t));
  return reg.concat(extra);
}
function tpEventLabel(name){""",
  "function tourxOverviewEvents(){")

# 9 · How it plays labels name their years (founder 2026-10-26)
step('hip this event label',
  "          <span>This event${pm && pn < floor ? ` · n ${pn}` : ''}</span>",
  "          <span>${pastLabel}${pm && pn < floor ? ` · n ${pn}` : ''}</span>",
  "<span>${pastLabel}${pm && pn < floor")
step('hip this year label',
  "<span>This year so far · n ${cn}</span>",
  "<span>${curLabel} · n ${cn}</span>",
  "<span>${curLabel} · n ${cn}</span>")
step('hip tooltip labels',
  "    const tip = [tipOf('This event', pm, pn), tipOf('ATP tour', bm, bn), cm ? tipOf(`${cur.years ? yrs(cur) : 'This year'} so far`, cm, cn) : null,",
  "    const tip = [tipOf(pastLabel, pm, pn), tipOf('ATP tour', bm, bn), cm ? tipOf(curLabel, cm, cn) : null,",
  "const tip = [tipOf(pastLabel, pm, pn)")
step('hip label defs',
  "  const past = e.past, cur = e.current;\n",
  "  const past = e.past, cur = e.current;\n"
  "  // founder 2026-10-26: \"This event\" → \"[year] edition\", \"This year so far\" → \"[year] so far\" (the years the rows hold)\n"
  "  const pastLabel = past && past.years && past.years.length ? `${yrs(past)} edition${past.years.length > 1 ? 's' : ''}` : 'Past editions';\n"
  "  const curLabel = `${cur && cur.years && cur.years.length ? yrs(cur) : new Date().getUTCFullYear()} so far`;\n",
  "const pastLabel = past && past.years")

F.write_text(s)
print('ok')
