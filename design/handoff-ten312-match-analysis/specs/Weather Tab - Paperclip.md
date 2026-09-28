# Weather tab — Match analysis (handoff for Paperclip)

Locked 2026-09-26. Source of truth: `Match Analysis Weather LOCKED.dc.html` (working copies `Match Analysis v4.dc.html` / `Match Analysis Weather v5.dc.html`). Not yet in `Stennisfy Website.html`.
The LOCKED file opens on the Odds tab; click Weather in the left menu. The STATE switcher at the top flips between the five designed states.

Reference renders (sample data; preview is a small 924×540 window, so each state is split into scrolled slices of the content column). All in `handoff/weather/`:
- State c · match day red (default): `weather-c-1-top.png` (switcher, week strip), `weather-c-2-match-time.png` (legend, verdict, lead tile), `weather-c-3-tiles.png` (lead metrics, effect, compact tiles).
- State a · calm week: `weather-a-1-match-time.png`, `weather-a-2-tiles.png` (no lead, four equal tiles).
- State b · one problem day: `weather-b-1-top.png` (red Saturday), `weather-b-2-match-time.png`.
- State d · indoor: `weather-d-indoor.png`.
- State e · unavailable: `weather-e-1-top.png`, `weather-e-2-match-time.png`, `weather-e-3-tiles.png`.
For the live version at any width, open `Match Analysis Weather LOCKED.dc.html`, click Weather in the left menu and use the STATE switcher.

All values below are exact. The verbatim markup and logic are at the end.

## Global
- Fonts: Hanken Grotesk (UI text), IBM Plex Mono (all numbers, dates, captions, tags).
- Text colours: primary #E7E9EE · secondary #AAB3C8 · muted #8B96B5 · dim #5B6880 · faint #4B5672.
- Card surface #0E1019, border 1.25px rgba(255,255,255,0.06). Lead tile surface #131623.
- **Severity scale (the only colours carrying meaning):** neutral #5B6880 · amber (WATCH) #E8A84E · red (CONCERN) #E0616F. Labels: NO CONCERN / WATCH / CONCERN / UNAVAILABLE.
- **Cut-offs are not decided.** Every severity in the mock is a placeholder; the "THRESHOLDS TBD — MICHAEL" chip must stay until they are.
- Match-time accent: #6AAEFF (MATCH badge, match-day card border, "Mon Jul 20 · 18:00" header).
- On the website the 12a runtime recolour applies on top (Soft ink palette, 1.25px hairlines).

## 0 · State switcher (mock/review only)
Row, gap 8px, wrap, margin-bottom 18px.
- "STATE" label: mono 9.5px/600, letter-spacing .14em, #5B6880.
- Five pills "a · Calm week", "b · One problem day", "c · Match day red", "d · Indoor", "e · Unavailable": padding 5px 10px, radius 6px, 12px, nowrap. Selected 700 #E7E9EE, bg rgba(91,155,255,0.14), border 1px rgba(91,155,255,0.45). Unselected 500 #8B96B5, transparent, border rgba(255,255,255,0.1).
- Right: "THRESHOLDS TBD — MICHAEL" chip, mono 9.5px/600 .14em #E8A84E, padding 4px 8px, radius 6px, border 1px dashed rgba(232,168,78,0.45); tooltip "Severity cut-offs are not decided yet. Neutral / amber / red states here are placeholders."
- In production the switcher is removed; the state comes from the data. The chip stays until thresholds are set.

## 1 · Week strip header
Row, baseline, space-between, wrap, gap 8px 16px, margin-bottom 12px.
- Left: "TOURNAMENT WEEK · MON–SUN" 11px, .14em, uppercase, #5B6880, then "Jul 20 – Jul 26" mono 12px #4B5672 (gap 12px).
- Right: freshness "Forecast updated 2h ago · [source]" mono 11.5px #5B6880. Unavailable: "Forecast unavailable · last successful update — · [source]" in #8B96B5.
- Unavailable only: banner below, padding 11px 14px, radius 10px, bg #0E1019, border 1.25px dashed rgba(255,255,255,0.14), 13px #AAB3C8, prefixed "UNAVAILABLE" mono 9.5px/700 .14em #8B96B5: "No forecast returned for this venue. Values show as dashes until the feed is back."

## 2 · Week strip (7 day cards)
Grid 7 × minmax(0,1fr), gap 8px, padding-top 10px (room for the MATCH badge).
Day card: relative, column, centred, gap 7px, padding 16px 8px 12px, radius 12px, bg #0E1019, border 1.25px rgba(255,255,255,0.06). **Match day** border rgba(106,174,255,0.75).
- Severity top edge: absolute top −1px, left/right 12px, height 3px, radius 0 0 3px 3px; amber/red for the day's worst flag, transparent otherwise.
- MATCH badge (match day only): "MATCH · 18:00", absolute top −10px centred, mono 8.5px/700 .12em, text #06070A on #6AAEFF, radius 4px, padding 2px 7px. The time must match the modal header.
- Day block (opacity 0.55 for days 4+ ahead, 1 otherwise): "Mon" 13.5px/700 + "Jul 20" mono 10.5px #5B6880 (baseline, gap 6px); icon 26px stroke #8B96B5 (sun / cloud / rain, see wIcon); hi "29°" mono 16px/700 + lo "21°" mono 11.5px #5B6880.
- Reason row: full width, min-height 34px, padding-top 9px, top border 1px rgba(255,255,255,0.05), centred, gap 6px: dot 7px (severity colour; neutral #5B6880; unavailable rgba(255,255,255,0.15)), reason text 11.5px, line-height 1.35, centred. Flagged day: worst flag text ("Gusts 38 km/h"), 700 #E7E9EE. Calm: "No concern", 500 #5B6880. Unavailable: "Unavailable".
- "+1" chip when a day has a second flag: mono 9.5px/700 #AAB3C8, padding 1px 4px, radius 3px, border 1px rgba(255,255,255,0.14); tooltip lists the other flags.
- Days 4+ ahead: "LOW CONFIDENCE" under the reason, mono 8.5px .12em #5B6880.
- Flags per day are sorted worst first; the day's colour is its worst flag.
- Unavailable: icon replaced by "—" mono 18px #5B6880; hi/lo "—".
- Legend below the grid (margin-top 10px, gap 16px, 11.5px #5B6880): three 7px dots "No concern" #5B6880 · "Watch" #E8A84E · "Concern" #E0616F, then "Days 4+ ahead are less reliable and shown dimmed."

## 3 · At match time
Header row (margin 28px 0 12px, baseline, space-between): "AT MATCH TIME" 11px .14em uppercase #5B6880; "Mon Jul 20 · 18:00" mono 12px #6AAEFF.

Verdict line: row, gap 12px, padding 15px 18px, radius 14px, bg #0E1019, border 1.25px rgba(255,255,255,0.06), margin-bottom 12px. Dot 10px in the lead factor's severity colour (neutral #5B6880 if none; unavailable rgba(255,255,255,0.15)). Text 17px/800, line-height 1.3:
- Lead exists: "Main factor at match time: Wind — gusts 38 km/h" (heat: "feels like 31°"; rain: "rain 44%").
- No lead: "No weather concern at match time."
- Unavailable: "Match-time forecast unavailable."
- No prose summary.

### 3a · With a lead factor (any factor amber/red)
Grid repeat(auto-fit, minmax(260px,1fr)), gap 10px: lead tile + stacked compact tiles.

**Lead tile** (the worst factor): relative, column, gap 14px, padding 22px 22px 18px, radius 16px, bg #131623, border 1.25px rgba(224,97,111,0.35) (red) / rgba(232,168,78,0.35) (amber), overflow hidden.
- Top bar: absolute, 3px, full width, severity colour.
- Head row (space-between): icon 26px in severity colour + name "WIND" 13px/800 .12em uppercase; right "CONCERN"/"WATCH" mono 10px/700 .14em in severity colour.
- Big value: "38" mono 46px/700, letter-spacing −0.02em, severity colour; unit "km/h gusts" 14px #AAB3C8 (gap 10px, baseline).
- Two metric boxes (grid 2 cols, gap 10px): padding 10px 12px, radius 10px, bg #0E1019, border 1px rgba(255,255,255,0.05); key mono 9px .14em #5B6880 ("GUSTS" / "AVERAGE", "TEMPERATURE" / "HUMIDITY", "CHANCE" / "AMOUNT"); value mono 16px/700. The headline metric (wind gusts, both heat metrics, rain chance) is in severity colour; the rest #E7E9EE.
- "EFFECT ON PLAY" block: top border 1px rgba(255,255,255,0.06), padding-top 12px, gap 5px; caption mono 9px .14em #5B6880; text 13px, line-height 1.5, #AAB3C8, text-wrap pretty.

**Compact tiles** (remaining factors, in severity order, then Conditions / pace last): column, gap 8px; each tile flex 1, row, gap 12px, padding 12px 16px, radius 12px, bg #0E1019, border 1.25px rgba(255,255,255,0.06), overflow hidden.
- Left severity bar: absolute left 0, top/bottom 10px, width 3px, radius 0 3px 3px 0; amber/red, else rgba(255,255,255,0.08).
- Text column (flex 1): name 12px/700 .1em uppercase (#E7E9EE when amber/red, #8B96B5 when neutral) + optional tag; detail 11.5px #5B6880, one line, ellipsis; effect 11.5px, line-height 1.45, #8B96B5.
- Value column (right-aligned, gap 3px): value mono 18px/700 (red #E0616F / amber #E8A84E / neutral #AAB3C8); severity label mono 9px .14em (severity colour, or #5B6880 neutral).

### 3b · No lead (all neutral)
Grid repeat(auto-fit, minmax(160px,1fr)), gap 8px; four equal tiles Wind · Heat · Rain · Conditions / pace. Tile: column, gap 8px, padding 14px 16px, radius 12px, bg #0E1019, border 1.25px rgba(255,255,255,0.06): name 12px/700 .1em uppercase #8B96B5 + 7px dot (right); value mono 20px/700 #AAB3C8; detail 11.5px #5B6880; effect 11.5px/1.45 #8B96B5; optional tag chip.

## 4 · Factors (data)
Order is by severity, worst first (red > amber > neutral); Conditions / pace is always last.

| Factor | Value shown | Unit (lead) | Detail line | Metrics |
|---|---|---|---|---|
| Wind | gusts, "38 km/h" | "km/h gusts" | "Average 22 km/h" | GUSTS · AVERAGE |
| Heat | feels-like, "31°" | "feels like" | "29° · 64% humidity" | TEMPERATURE · HUMIDITY |
| Rain | chance, "12%" | "chance" | "0.1 mm expected" | CHANCE · AMOUNT |
| Conditions / pace | court speed, "1.24" | — | "Court speed · Washington · hard court" | — |

Effect on play copy (verbatim):
- Heat, amber/red: "Hot air is thinner, so the ball travels faster and bounces higher. Serves gain pop, and long rallies drain stamina faster, especially late in the match." Calm: "Mild temperature. Ball speed and player stamina should be close to normal."
- Wind, amber/red: "Gusts push the ball off line and disrupt the ball toss. First-serve percentages and unforced errors usually suffer, and players rely more on margin and spin." Calm: "Light wind. Little effect on serve toss or ball flight."
- Rain, amber/red: "Rain can stop play, and delays break momentum. Damp air and balls play heavier and slower, which favours longer rallies." Calm: "Low chance of rain. Delays are unlikely."
- Conditions / pace: base court speed comes from the Tournament tab's court-speed data (`tournamentFor → market.speed / speedLabel`). Status label AS USUAL / PLAYS SLOWER (rain amber/red) / PLAYS QUICKER (heat amber/red, rain calm). Copy:
  - As usual: "Conditions should leave the court playing close to its usual 1.24 (Medium-fast)."
  - Otherwise: "Base court speed is 1.24 (Medium-fast). Today's damp air should make it play slower than that." / "…heat should make it play quicker than that." + " Wind adds variance on top." when wind is amber/red.
  - Tag "FROM TOURNAMENT": mono 8.5px .12em #8B96B5, padding 2px 5px, radius 3px, border 1px dashed rgba(255,255,255,0.2). Clicking the tile opens the Tournament tab.

## 5 · Indoor state
Replaces sections 1–3. Single panel: column, centred, gap 10px, padding 64px 24px, radius 16px, bg #0E1019, border 1.25px rgba(255,255,255,0.06). House icon 34px stroke #5B6880 (paths "M3 11l9-7 9 7" and "M5 10v10h14V10"); "Indoor event — weather not a factor." 20px/800; "Played under a roof. No week strip or match-time factors are shown." 13px #5B6880.

## 6 · Unavailable state
Week strip and tiles keep their layout with every value "—", dots rgba(255,255,255,0.15), severity labels UNAVAILABLE, no lead tile (all tiles equal), no effect text, banner + freshness line as in section 1.

## 7 · Sample data used in the mock
State c (default), match day Mon Jul 20 18:00:
- Week: Mon cloud 29/21 [red "Gusts 38 km/h", amber "Heat — high"] · Tue rain 24/18 [amber "Rain 44%"] · Wed sun 27/18 · Thu sun 28/19 · Fri cloud 26/18 · Sat cloud 25/17 · Sun sun 26/17.
- Match time: wind red 38 km/h gusts (avg 22) · heat amber feels 31° (29°, 64%) · rain neutral 12% (0.1 mm) · court speed 1.24 Medium-fast.
State b: Sat rain 21/15 [red "Rain 72%", amber "Gusts 31 km/h"]; match time all neutral. State a: all neutral.

---

## Verbatim markup (template)
```html
<sc-if value="{{ analysis.isWeather }}" hint-placeholder-val="{{ true }}">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:18px;">
              <span style="font-family:'IBM Plex Mono',monospace; font-size:9.5px; font-weight:600; letter-spacing:0.14em; color:#5b6880;">STATE</span>
              <sc-for list="{{ wx.states }}" as="st" hint-placeholder-count="5"><span class="seg" onClick="{{ st.onClick }}" style="padding:5px 10px; border-radius:6px; cursor:pointer; font-size:12px; white-space:nowrap; font-weight:{{ st.w }}; color:{{ st.c }}; background:{{ st.bg }}; border:1px solid {{ st.bd }};">{{ st.label }}</span></sc-for>
              <span title="Severity cut-offs are not decided yet. Neutral / amber / red states here are placeholders." style="margin-left:auto; font-family:'IBM Plex Mono',monospace; font-size:9.5px; font-weight:600; letter-spacing:0.14em; color:#e8a84e; padding:4px 8px; border-radius:6px; border:1px dashed rgba(232,168,78,0.45); white-space:nowrap;">THRESHOLDS TBD — MICHAEL</span>
            </div>

            <sc-if value="{{ wx.indoor }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; padding:64px 24px; border-radius:16px; background:#0E1019; border:1.25px solid rgba(255,255,255,0.06);">
                {{ wx.indoorIcon }}
                <span style="font-size:20px; font-weight:800;">Indoor event — weather not a factor.</span>
                <span style="font-size:13px; color:#5b6880;">{{ wx.indoorSub }}</span>
              </div>
            </sc-if>

            <sc-if value="{{ wx.outdoor }}" hint-placeholder-val="{{ true }}">
              <div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px 16px; flex-wrap:wrap; margin-bottom:12px;">
                <span style="display:flex; align-items:baseline; gap:12px;"><span style="font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#5b6880;">Tournament week · Mon–Sun</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:#4b5672;">Jul 20 – Jul 26</span></span>
                <span style="font-family:'IBM Plex Mono',monospace; font-size:11.5px; color:{{ wx.freshColor }};">{{ wx.fresh }}</span>
              </div>
              <sc-if value="{{ wx.unavail }}" hint-placeholder-val="{{ false }}">
                <div style="display:flex; align-items:center; gap:10px; padding:11px 14px; margin-bottom:12px; border-radius:10px; background:#0E1019; border:1.25px dashed rgba(255,255,255,0.14); font-size:13px; color:#aab3c8;"><span style="font-family:'IBM Plex Mono',monospace; font-size:9.5px; font-weight:700; letter-spacing:0.14em; color:#8b96b5;">UNAVAILABLE</span>No forecast returned for this venue. Values show as dashes until the feed is back.</div>
              </sc-if>
              <div style="display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); gap:8px; padding-top:10px;">
                <sc-for list="{{ wx.days }}" as="d" hint-placeholder-count="7">
                  <div style="position:relative; display:flex; flex-direction:column; align-items:center; gap:7px; padding:16px 8px 12px; border-radius:12px; background:#0E1019; border:1.25px solid {{ d.bd }}; min-width:0;">
                    <span style="position:absolute; top:-1px; left:12px; right:12px; height:3px; border-radius:0 0 3px 3px; background:{{ d.sevC }};"></span>
                    <sc-if value="{{ d.isMatch }}" hint-placeholder-val="{{ false }}"><span style="position:absolute; top:-10px; left:50%; transform:translateX(-50%); font-family:'IBM Plex Mono',monospace; font-size:8.5px; font-weight:700; letter-spacing:0.12em; color:#06070a; background:#6aaeff; border-radius:4px; padding:2px 7px; white-space:nowrap;">MATCH · 18:00</span></sc-if>
                    <div style="display:flex; flex-direction:column; align-items:center; gap:7px; opacity:{{ d.op }};">
                      <span style="display:flex; align-items:baseline; gap:6px;"><span style="font-size:13.5px; font-weight:700;">{{ d.dow }}</span><span style="font-family:'IBM Plex Mono',monospace; font-size:10.5px; color:#5b6880;">{{ d.date }}</span></span>
                      {{ d.icon }}
                      <span style="display:flex; align-items:baseline; gap:6px; font-family:'IBM Plex Mono',monospace;"><span style="font-size:16px; font-weight:700;">{{ d.hi }}</span><span style="font-size:11.5px; color:#5b6880;">{{ d.lo }}</span></span>
                    </div>
                    <div style="width:100%; min-height:34px; padding-top:9px; border-top:1px solid rgba(255,255,255,0.05); display:flex; align-items:flex-start; justify-content:center; gap:6px;">
                      <span style="width:7px; height:7px; border-radius:50%; background:{{ d.dotC }}; margin-top:4px; flex-shrink:0;"></span>
                      <span style="font-size:11.5px; line-height:1.35; font-weight:{{ d.rw }}; color:{{ d.rc }}; text-align:center;">{{ d.reason }}</span>
                      <sc-if value="{{ d.hasMore }}" hint-placeholder-val="{{ false }}"><span title="{{ d.moreTip }}" style="font-family:'IBM Plex Mono',monospace; font-size:9.5px; font-weight:700; color:#aab3c8; padding:1px 4px; border-radius:3px; border:1px solid rgba(255,255,255,0.14); flex-shrink:0;">+1</span></sc-if>
                    </div>
                    <sc-if value="{{ d.lowConf }}" hint-placeholder-val="{{ false }}"><span style="font-family:'IBM Plex Mono',monospace; font-size:8.5px; letter-spacing:0.12em; color:#5b6880;">LOW CONFIDENCE</span></sc-if>
                  </div>
                </sc-for>
              </div>
              <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-top:10px; font-size:11.5px; color:#5b6880;">
                <span style="display:flex; align-items:center; gap:6px;"><span style="width:7px; height:7px; border-radius:50%; background:#5b6880;"></span>No concern</span>
                <span style="display:flex; align-items:center; gap:6px;"><span style="width:7px; height:7px; border-radius:50%; background:#e8a84e;"></span>Watch</span>
                <span style="display:flex; align-items:center; gap:6px;"><span style="width:7px; height:7px; border-radius:50%; background:#e0616f;"></span>Concern</span>
                <span>Days 4+ ahead are less reliable and shown dimmed.</span>
              </div>

              <div style="display:flex; align-items:baseline; justify-content:space-between; gap:16px; margin:28px 0 12px;"><span style="font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#5b6880;">At match time</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:#6aaeff;">Mon Jul 20 · 18:00</span></div>
              <div style="display:flex; align-items:center; gap:12px; padding:15px 18px; margin-bottom:12px; border-radius:14px; background:#0E1019; border:1.25px solid rgba(255,255,255,0.06);">
                <span style="width:10px; height:10px; border-radius:50%; background:{{ wx.verdictC }}; flex-shrink:0;"></span>
                <span style="font-size:17px; font-weight:800; line-height:1.3;">{{ wx.verdict }}</span>
              </div>

              <sc-if value="{{ wx.hasLead }}" hint-placeholder-val="{{ true }}">
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:10px;">
                  <div style="position:relative; display:flex; flex-direction:column; gap:14px; padding:22px 22px 18px; border-radius:16px; background:#131623; border:1.25px solid {{ wx.lead.bd }}; overflow:hidden;">
                    <span style="position:absolute; top:0; left:0; right:0; height:3px; background:{{ wx.lead.sevC }};"></span>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;"><span style="display:flex; align-items:center; gap:10px;">{{ wx.lead.icon }}<span style="font-size:13px; font-weight:800; letter-spacing:0.12em; text-transform:uppercase;">{{ wx.lead.name }}</span></span><span style="font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:700; letter-spacing:0.14em; color:{{ wx.lead.sevC }};">{{ wx.lead.sevL }}</span></div>
                    <div style="display:flex; align-items:baseline; gap:10px;"><span style="font-family:'IBM Plex Mono',monospace; font-size:46px; font-weight:700; letter-spacing:-0.02em; color:{{ wx.lead.valC }};">{{ wx.lead.value }}</span><span style="font-size:14px; color:#aab3c8;">{{ wx.lead.unit }}</span></div>
                    <div style="display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px;">
                      <sc-for list="{{ wx.lead.metrics }}" as="m" hint-placeholder-count="2"><div style="display:flex; flex-direction:column; gap:4px; padding:10px 12px; border-radius:10px; background:#0E1019; border:1px solid rgba(255,255,255,0.05);"><span style="font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:0.14em; color:#5b6880;">{{ m.k }}</span><span style="font-family:'IBM Plex Mono',monospace; font-size:16px; font-weight:700; color:{{ m.c }};">{{ m.v }}</span></div></sc-for>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:5px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06);"><span style="font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:0.14em; color:#5b6880;">EFFECT ON PLAY</span><span style="font-size:13px; line-height:1.5; color:#aab3c8; text-wrap:pretty;">{{ wx.lead.effect }}</span></div>
                  </div>
                  <div style="display:flex; flex-direction:column; gap:8px;">
                    <sc-for list="{{ wx.rest }}" as="t" hint-placeholder-count="3">
                      <div style="position:relative; flex:1; display:flex; align-items:center; gap:12px; padding:12px 16px; border-radius:12px; background:#0E1019; border:1.25px {{ t.bs }} {{ t.bd }}; overflow:hidden;">
                        <span style="position:absolute; left:0; top:10px; bottom:10px; width:3px; border-radius:0 3px 3px 0; background:{{ t.sevC }};"></span>
                        <span style="display:flex; flex-direction:column; gap:3px; min-width:0; flex:1;"><span style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="font-size:12px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:{{ t.nameC }};">{{ t.name }}</span><sc-if value="{{ t.pending }}" hint-placeholder-val="{{ false }}"><span style="font-family:'IBM Plex Mono',monospace; font-size:8.5px; letter-spacing:0.12em; color:#8b96b5; padding:2px 5px; border-radius:3px; border:1px dashed rgba(255,255,255,0.2);">{{ t.tag }}</span></sc-if></span><span style="font-size:11.5px; color:#5b6880; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">{{ t.detail }}</span><span style="font-size:11.5px; line-height:1.45; color:#8b96b5; text-wrap:pretty;">{{ t.effect }}</span></span>
                        <span style="display:flex; flex-direction:column; align-items:flex-end; gap:3px; flex-shrink:0;"><span style="font-family:'IBM Plex Mono',monospace; font-size:18px; font-weight:700; color:{{ t.valC }};">{{ t.value }}</span><span style="font-family:'IBM Plex Mono',monospace; font-size:9px; letter-spacing:0.14em; color:{{ t.sevTxt }};">{{ t.sevL }}</span></span>
                      </div>
                    </sc-for>
                  </div>
                </div>
              </sc-if>
              <sc-if value="{{ wx.noLead }}" hint-placeholder-val="{{ false }}">
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:8px;">
                  <sc-for list="{{ wx.tiles }}" as="t" hint-placeholder-count="4">
                    <div style="display:flex; flex-direction:column; gap:8px; padding:14px 16px; border-radius:12px; background:#0E1019; border:1.25px {{ t.bs }} {{ t.bd }};">
                      <span style="display:flex; align-items:center; justify-content:space-between; gap:8px;"><span style="font-size:12px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#8b96b5;">{{ t.name }}</span><span style="width:7px; height:7px; border-radius:50%; background:{{ t.dotC }};"></span></span>
                      <span style="font-family:'IBM Plex Mono',monospace; font-size:20px; font-weight:700; color:{{ t.valC }};">{{ t.value }}</span>
                      <span style="font-size:11.5px; color:#5b6880;">{{ t.detail }}</span>
                      <span style="font-size:11.5px; line-height:1.45; color:#8b96b5; text-wrap:pretty;">{{ t.effect }}</span>
                      <sc-if value="{{ t.pending }}" hint-placeholder-val="{{ false }}"><span style="align-self:flex-start; font-family:'IBM Plex Mono',monospace; font-size:8.5px; letter-spacing:0.12em; color:#8b96b5; padding:2px 5px; border-radius:3px; border:1px dashed rgba(255,255,255,0.2);">{{ t.tag }}</span></sc-if>
                    </div>
                  </sc-for>
                </div>
              </sc-if>
            </sc-if>
          </sc-if>
```

## Verbatim logic (wxFor + wIcon)
```js
  wxFor(S, TR) {
    const el = React.createElement, N0 = '#5b6880', AM = '#e8a84e', RD = '#e0616f', DASH = '\u2014';
    const sevC = v => v === 'r' ? RD : v === 'a' ? AM : v === 'u' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.08)';
    const dotC = v => v === 'r' ? RD : v === 'a' ? AM : N0;
    const sevL = v => v === 'r' ? 'CONCERN' : v === 'a' ? 'WATCH' : v === 'u' ? 'UNAVAILABLE' : 'NO CONCERN';
    const rank = v => v === 'r' ? 2 : v === 'a' ? 1 : 0;
    const ST = [['a', 'a · Calm week'], ['b', 'b · One problem day'], ['c', 'c · Match day red'], ['d', 'd · Indoor'], ['e', 'e · Unavailable']];
    const cur = S.maWxState || 'c';
    const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], DATES = ['Jul 20', 'Jul 21', 'Jul 22', 'Jul 23', 'Jul 24', 'Jul 25', 'Jul 26'];
    const WEEK = {
      a: [['sun', 26, 17], ['sun', 27, 18], ['cloud', 25, 17], ['sun', 26, 16], ['cloud', 24, 16], ['sun', 25, 17], ['cloud', 24, 15]].map(d => d.concat([[]])),
      b: [['sun', 26, 17, []], ['cloud', 25, 17, []], ['sun', 27, 18, []], ['cloud', 24, 16, []], ['cloud', 23, 16, []], ['rain', 21, 15, [['r', 'Rain 72%'], ['a', 'Gusts 31 km/h']]], ['cloud', 23, 15, []]],
      c: [['cloud', 29, 21, [['r', 'Gusts 38 km/h'], ['a', 'Heat \u2014 high']]], ['rain', 24, 18, [['a', 'Rain 44%']]], ['sun', 27, 18, []], ['sun', 28, 19, []], ['cloud', 26, 18, []], ['cloud', 25, 17, []], ['sun', 26, 17, []]],
    };
    const MT = {
      a: { heat: ['n', '25\u00b0', 'feels like', [['TEMPERATURE', '24\u00b0'], ['HUMIDITY', '52%']]], wind: ['n', '14', 'km/h gusts', [['GUSTS', '14 km/h'], ['AVERAGE', '8 km/h']]], rain: ['n', '5%', 'chance', [['CHANCE', '5%'], ['AMOUNT', '0.0 mm']]] },
      b: { heat: ['n', '27\u00b0', 'feels like', [['TEMPERATURE', '26\u00b0'], ['HUMIDITY', '55%']]], wind: ['n', '16', 'km/h gusts', [['GUSTS', '16 km/h'], ['AVERAGE', '9 km/h']]], rain: ['n', '8%', 'chance', [['CHANCE', '8%'], ['AMOUNT', '0.0 mm']]] },
      c: { heat: ['a', '31\u00b0', 'feels like', [['TEMPERATURE', '29\u00b0'], ['HUMIDITY', '64%']]], wind: ['r', '38', 'km/h gusts', [['GUSTS', '38 km/h'], ['AVERAGE', '22 km/h']]], rain: ['n', '12%', 'chance', [['CHANCE', '12%'], ['AMOUNT', '0.1 mm']]] },
    };
    const unavail = cur === 'e', indoor = cur === 'd', key = unavail || indoor ? 'a' : cur;
    const icon = (k, c) => this.wIcon(k, 26, c || '#8b96b5');
    const days = DOW.map((dow, i) => {
      const w = WEEK[key][i], flags = unavail ? [] : w[3].slice().sort((x, y) => rank(y[0]) - rank(x[0])), top = flags[0], v = unavail ? 'u' : top ? top[0] : 'n', isMatch = i === 0, lowConf = i >= 3;
      return { dow, date: DATES[i], icon: unavail ? el('span', { style: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 18, color: '#5b6880', height: 26, lineHeight: '26px' } }, DASH) : icon(w[0]),
        hi: unavail ? DASH : w[1] + '\u00b0', lo: unavail ? DASH : w[2] + '\u00b0', isMatch, lowConf, op: lowConf ? 0.55 : 1,
        bd: isMatch ? 'rgba(106,174,255,0.75)' : 'rgba(255,255,255,0.06)', sevC: v === 'r' || v === 'a' ? sevC(v) : 'transparent', dotC: unavail ? 'rgba(255,255,255,0.15)' : dotC(v),
        reason: unavail ? 'Unavailable' : top ? top[1] : 'No concern', rw: top ? 700 : 500, rc: top ? '#e7e9ee' : '#5b6880',
        hasMore: flags.length > 1, moreTip: flags.slice(1).map(f => f[1]).join(', ') };
    });
    const m = MT[key], F = [
      { id: 'wind', name: 'Wind', ic: 'cloud', d: m.wind, detail: v => 'Average ' + v[3][1][1] },
      { id: 'heat', name: 'Heat', ic: 'sun', d: m.heat, detail: v => v[3][0][1] + ' \u00b7 ' + v[3][1][1] + ' humidity' },
      { id: 'rain', name: 'Rain', ic: 'rain', d: m.rain, detail: v => v[3][1][1] + ' expected' },
    ].map(f => { const v = unavail ? 'u' : f.d[0];
      const EFF = {
        heat: { hot: 'Hot air is thinner, so the ball travels faster and bounces higher. Serves gain pop, and long rallies drain stamina faster, especially late in the match.', calm: 'Mild temperature. Ball speed and player stamina should be close to normal.' },
        wind: { hot: 'Gusts push the ball off line and disrupt the ball toss. First-serve percentages and unforced errors usually suffer, and players rely more on margin and spin.', calm: 'Light wind. Little effect on serve toss or ball flight.' },
        rain: { hot: 'Rain can stop play, and delays break momentum. Damp air and balls play heavier and slower, which favours longer rallies.', calm: 'Low chance of rain. Delays are unlikely.' },
      };
      const effect = unavail ? '' : (v === 'r' || v === 'a' ? EFF[f.id].hot : EFF[f.id].calm);
      return { id: f.id, name: f.name, sev: v, rk: rank(v), sevC: v === 'r' || v === 'a' ? sevC(v) : 'rgba(255,255,255,0.08)', sevL: sevL(v), sevTxt: v === 'r' || v === 'a' ? sevC(v) : '#5b6880', dotC: unavail ? 'rgba(255,255,255,0.15)' : dotC(v),
        value: unavail ? DASH : f.d[1] + (f.id === 'wind' ? ' km/h' : ''), valC: v === 'r' ? RD : v === 'a' ? AM : unavail ? '#5b6880' : '#aab3c8', nameC: v === 'n' || v === 'u' ? '#8b96b5' : '#e7e9ee',
        detail: unavail ? DASH : f.detail(f.d), bs: 'solid', bd: 'rgba(255,255,255,0.06)', pending: false, icon: icon(f.ic, v === 'r' ? RD : v === 'a' ? AM : '#8b96b5'),
        effect, bigValue: f.d[1], unit: f.d[2], metrics: f.d[3].map(([k, val], mi) => ({ k, v: unavail ? DASH : val, c: (f.id === 'wind' && mi === 0) || (f.id === 'heat') || (f.id === 'rain' && mi === 0) ? (v === 'r' ? RD : v === 'a' ? AM : '#e7e9ee') : '#e7e9ee' })) }; });
    F.sort((x, y) => y.rk - x.rk);
    const mk = (TR && TR.market) || {}, spd = parseFloat(mk.speed), tName = (TR && TR.name) || 'this event', surf = String((TR && TR.surfaceLabel) || 'court').toLowerCase();
    const hotF = F.find(x => x.id === 'heat'), windF = F.find(x => x.id === 'wind'), rainF = F.find(x => x.id === 'rain'), on = x => x && (x.sev === 'r' || x.sev === 'a');
    const shift = on(rainF) ? 'slower' : on(hotF) ? 'quicker' : 'close to';
    const paceEff = isNaN(spd) ? '' : shift === 'close to' ? 'Conditions should leave the court playing close to its usual ' + spd.toFixed(2) + ' (' + mk.speedLabel + ').' : 'Base court speed is ' + spd.toFixed(2) + ' (' + mk.speedLabel + '). Today\'s ' + (shift === 'slower' ? 'damp air should make it play slower' : 'heat should make it play quicker') + ' than that.' + (on(windF) ? ' Wind adds variance on top.' : '');
    const pace = { id: 'pace', name: 'Conditions / pace', sev: 'n', sevC: 'rgba(255,255,255,0.08)', sevL: shift === 'close to' ? 'AS USUAL' : shift === 'slower' ? 'PLAYS SLOWER' : 'PLAYS QUICKER', sevTxt: '#8b96b5', dotC: '#5b6880', value: unavail || isNaN(spd) ? DASH : spd.toFixed(2), valC: '#aab3c8', nameC: '#e7e9ee', detail: 'Court speed · ' + tName + ' · ' + surf, effect: unavail ? '' : paceEff, bs: 'solid', bd: 'rgba(255,255,255,0.06)', pending: true, tag: 'FROM TOURNAMENT', onClick: () => this.setState({ maTab: 'Tournament' }) };
    const leadF = F[0].rk > 0 ? F[0] : null;
    const lead = leadF ? { name: leadF.name, icon: leadF.icon, sevC: leadF.sevC, sevL: leadF.sevL, value: leadF.bigValue, unit: leadF.unit, valC: leadF.valC, metrics: leadF.metrics, effect: leadF.effect, bd: leadF.sev === 'r' ? 'rgba(224,97,111,0.35)' : 'rgba(232,168,78,0.35)' } : null;
    const verdict = unavail ? 'Match-time forecast unavailable.' : leadF ? 'Main factor at match time: ' + leadF.name + ' \u2014 ' + (leadF.id === 'wind' ? 'gusts ' + leadF.bigValue + ' km/h' : leadF.id === 'heat' ? 'feels like ' + leadF.bigValue : 'rain ' + leadF.bigValue) : 'No weather concern at match time.';
    return {
      states: ST.map(([id, label]) => { const on = id === cur; return { label, w: on ? 700 : 500, c: on ? '#e7e9ee' : '#8b96b5', bg: on ? 'rgba(91,155,255,0.14)' : 'transparent', bd: on ? 'rgba(91,155,255,0.45)' : 'rgba(255,255,255,0.1)', onClick: () => this.setState({ maWxState: id }) }; }),
      indoor, outdoor: !indoor, unavail, indoorIcon: el('svg', { width: 34, height: 34, viewBox: '0 0 24 24', fill: 'none', stroke: '#5b6880', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }, [el('path', { key: 'r', d: 'M3 11l9-7 9 7' }), el('path', { key: 'w', d: 'M5 10v10h14V10' })]),
      indoorSub: 'Played under a roof. No week strip or match-time factors are shown.',
      fresh: unavail ? 'Forecast unavailable \u00b7 last successful update \u2014 \u00b7 [source]' : 'Forecast updated 2h ago \u00b7 [source]', freshColor: unavail ? '#8b96b5' : '#5b6880',
      days, verdict, verdictC: unavail ? 'rgba(255,255,255,0.15)' : leadF ? leadF.sevC : N0,
      hasLead: !!leadF, noLead: !leadF, lead: lead || { metrics: [] }, rest: leadF ? F.slice(1).concat([pace]) : [], tiles: leadF ? [] : F.concat([pace]),
    };
  }

  wIcon(type, size, color) {
    const el = React.createElement, s = size || 30;
    const svg = ch => el('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }, ch);
    if (type === 'rain') return svg([el('path', { key: 1, d: 'M6 14.5a4 4 0 010-8 5 5 0 019.6-1.5A3.5 3.5 0 0117 14.5H6z' }), el('path', { key: 2, d: 'M8 17.5l-1 2.5M12 17.5l-1 2.5M16 17.5l-1 2.5' })]);
    if (type === 'sun') return svg([el('circle', { key: 1, cx: 12, cy: 12, r: 4 }), el('path', { key: 2, d: 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4' })]);
    return svg([el('path', { key: 1, d: 'M6 16a4 4 0 010-8 5 5 0 019.6-1.5A3.5 3.5 0 0117 16H6z' })]);
  }

```
