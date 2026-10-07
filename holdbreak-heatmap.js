// holdbreak-heatmap.js — the ONE hold/break heatmap engine.
// =============================================================================
// TEN-206 §5.9 / founder ruling 7 (2026-09-16): "we already built a hold/break
// heatmap for live bets. Reuse that same data source and logic for the pre-match
// heatmap in Playing profile. Don't build a second engine."
//
// This file IS that engine, lifted verbatim out of the live-tab IIFE in
// bsp-consult-dashboard.html (which now delegates here) so the Live tab and the
// Player Profile cannot drift apart. The extraction is locked by
// tools/test-holdbreak-engine.js, which replays the PRE-extraction source out of
// git and asserts deep equality over every player × metric × best-of.
//
// SOURCE: holdbreak.json, the nightly 24-month rollup built by build-holdbreak.js
// from apitennis-holdbreak-cache point-by-point. Founder rulings already encoded
// in that shard (TEN-107, 2026-09-01/02): window = 24 months, axis = SIX
// single-ordinal rows (the server's service-game ordinal within the set, 7th+
// folded into row 6), sets split S1..S5.
//   players[key].serve[surface][set][ordinal]  = {pct,n,won(,bpSavedPct,bpFaced)} → HOLD
//   players[key].return[surface][set][ordinal] = same shape                       → BREAK
//
// Sums are exact: numerators and denominators are summed, never an average of
// percentages. Every band decision is taken on the PRINTED integer, so the
// colour and the figure can never disagree.
//
// Sample gates (README §9, same ladder as the rest of the profile):
//   n = 0      → em dash, "no matches on record". Never a 0%.
//   n = 1–4    → the raw count only (won/n), no percentage, neutral background.
//   n = 5–9    → rate shown, smaller + greyed, "small sample · n=X" (TEN-384 fix item 9).
//   n >= 10    → full rate.
// Nothing is ever estimated or defaulted.
// =============================================================================
(function (root) {
  'use strict';

  const BUCKETS = [['Game 1-2','1st svc game'],['Game 3-4','2nd svc game'],['Game 5-6','3rd svc game'],
                   ['Game 7-8','4th svc game'],['Game 9-10','5th svc game'],['Game 11-12+','6th+ svc game']];
  // holdbreak.json keys its six buckets '1'–'6' on the same axis and the same
  // boundaries as the design's six rows (the server's service-game ordinal within
  // the set, 7th+ folded into row 6). Same order, so index i ↔ id String(i+1).
  const HB_SETS = ['1','2','3','4','5'];

  // ── The cell colour (founder TEN-376 U3, built in TEN-384) ──────────────────
  // A set cell is coloured by its GAP to the pair's own ALL-SETS rate, not by an
  // absolute hold/break threshold: green from +3 pts, red from −3 pts, neutral
  // within. The gap is taken on the two PRINTED integers (the cell's "77%" and the
  // all-sets "81%"), so the colour, the figure and the "−4 pts" sub can never
  // disagree. A cell whose pair has no all-sets rate cannot have a gap → neutral.
  // n 5–9 keeps its gap colour as a muted wash (8% fill, 16% edge); n ≥ 10 is the
  // full tint (16% fill, 36% edge). The all-sets cell itself is never tinted.
  // The old absolute band (85/70 hold, 30/18 break) is retired: it painted Hold and
  // Break on two different scales and said nothing about where in the set a player
  // is better or worse than himself, which is the question the grid asks.
  const GAP_PTS = 3;
  function gapBand(pctInt, gPctInt, small){
    const d = (gPctInt===null || gPctInt===undefined) ? null : (pctInt - gPctInt);
    if(d!==null && d>=GAP_PTS) return small
      ? { bg:'color-mix(in srgb, var(--viz-up) 8%, transparent)', bd:'color-mix(in srgb, var(--viz-up) 16%, transparent)', color:'var(--viz-up)', tag:'up' }
      : { bg:'color-mix(in srgb, var(--viz-up) 16%, transparent)', bd:'color-mix(in srgb, var(--viz-up) 36%, transparent)', color:'var(--viz-up)', tag:'up' };
    if(d!==null && d<=-GAP_PTS) return small
      ? { bg:'color-mix(in srgb, var(--viz-down) 8%, transparent)', bd:'color-mix(in srgb, var(--viz-down) 16%, transparent)', color:'var(--viz-down)', tag:'down' }
      : { bg:'color-mix(in srgb, var(--viz-down) 16%, transparent)', bd:'color-mix(in srgb, var(--viz-down) 36%, transparent)', color:'var(--viz-down)', tag:'down' };
    return small
      ? { bg:'color-mix(in srgb, var(--text) 2%, transparent)', bd:'var(--line)', color:'var(--text)', tag:'even' }
      : { bg:'color-mix(in srgb, var(--text) 3%, transparent)', bd:'var(--line)', color:'var(--text)', tag:'even' };
  }
  // "+7 pts" / "−4 pts" / "0 pts" — true minus (U+2212), never a hyphen.
  function gapText(d){
    if(d===null || d===undefined) return '';
    return (d>0?'+':d<0?'\u2212':'')+Math.abs(d)+' pts';
  }

  function hbSum(cells){
    let won=0,n=0,any=false;
    for(const c of cells){ if(c && c.n && c.won!=null){ won+=c.won; n+=c.n; any=true; } }
    return { won, n, pct: (any && n) ? (won/n)*100 : null };
  }

  // heatFor(HB, pkey, metric, bo, surface)
  //   HB      — the parsed holdbreak.json shard (or null when it has not loaded)
  //   pkey    — player key, matched against holdbreak.players
  //   metric  — 'HOLD' (serve panel) | 'BREAK' (return panel)
  //   bo      — best-of, 3 or 5; sets the format cannot reach render as
  //             "set not played in this format", which is NOT missing data
  //   surface — shard surface node: 'all' (default) | 'hard' | 'clay' | 'grass'.
  //             The Live tab always passes 'all'; the profile page follows its
  //             own surface filter. An absent surface node yields dashes, never
  //             a silent fall back to 'all' (that would mislabel the figure).
  function heatFor(HB, pkey, metric, bo, surface){
    const surf = surface || 'all';
    const pd = (HB && HB.players) ? HB.players[String(pkey)] : null;
    const side = pd ? (metric==='HOLD' ? pd.serve : pd.return) : null;
    const node = side ? side[surf] : null;
    const DEAD = { pct:'—', frac:'', bg:'color-mix(in srgb, var(--text) 2%, transparent)', bd:'var(--line)', color:'var(--text-label)', size:'13px', opacity:1, tipHead:'', tipRate:'—', tipNote:'no matches on record' };
    const maxSet = bo===3?3:5;

    const rows = BUCKETS.map((b,bi)=>{
      const id = String(bi+1);
      const rowCells = HB_SETS.map(s => (node && node[s]) ? node[s][id] : null);
      const g = hbSum(rowCells);
      const gPctInt = g.pct===null ? null : Math.round(g.pct);
      const cells = [1,2,3,4,5].map(si=>{
        const head = b[0]+' · Set '+si;
        // A set the format cannot reach is not missing data — it is impossible.
        if(si>maxSet) return Object.assign({},DEAD,{tipHead:head, tipNote:'set not played in this format'});
        const c = rowCells[si-1];
        const den = (c && c.n!=null) ? c.n : 0;
        const num = (c && c.won!=null) ? c.won : null;
        // n=0 (or no numerator at all) → em dash. Never a 0%.
        if(!den || num===null) return Object.assign({},DEAD,{tipHead:head});
        // n<5 → the raw count only, neutral background, NO percentage: too few
        // service games for a rate to mean anything (§7 sample gates).
        if(den<5) return { pct:num+'/'+den, frac:'raw', bg:'color-mix(in srgb, var(--text) 3%, transparent)', bd:'var(--edge-7)', color:'var(--text-label)', size:'11px', opacity:1, tipHead:head, tipRate:num+'/'+den, tipNote:'too few matches for a rate' };
        const rate = num/den;
        const pctInt = Math.round(rate*100);
        const small = den<10;                         // n 5–9 → smaller, greyed, muted gap wash
        const bd2 = gapBand(pctInt, gPctInt, small);
        const dPts = gPctInt===null ? null : (pctInt - gPctInt);
        return {
          pct:pctInt+'%', frac:num+'/'+den,
          bg:bd2.bg, bd:bd2.bd, tag:bd2.tag, gap:dPts,
          color:small?'var(--text-label)':bd2.color,
          size:small?'12px':'15px', opacity:small?0.72:1,
          tipHead:head,
          tipRate:pctInt+'%  ·  '+num+'/'+den,
          tipNote:(dPts===null?'no all-sets rate for this pair':gapText(dPts)+' vs this pair’s all-sets '+gPctInt+'%')+(small?' · small sample · n='+den:''),
        };
      });
      return {
        bucket:b[0], sub:b[1],
        gPct: gPctInt===null ? '—' : gPctInt+'%',
        gFrac: g.pct===null ? '' : g.won+'/'+g.n,
        gColor: g.pct===null ? 'var(--text-label)' : 'var(--text)',
        cells,
      };
    });

    // The pill is the player's weighted global across every bucket and set — the
    // same numerator/denominator sum, not an average of the row percentages.
    const all=[];
    for(const s of HB_SETS) for(let bi=0;bi<BUCKETS.length;bi++) all.push((node && node[s]) ? node[s][String(bi+1)] : null);
    const agg = hbSum(all);
    return { rows, globalLabel: metric+' '+(agg.pct===null ? '—' : agg.pct.toFixed(1)+'%') };
  }

  // Provenance for whatever surface renders the grid. The founder's ruling 7:
  // "where a player's matches lack the per-game data, the heatmap states its
  // match count, like the Situational rows." `matches` is the number of this
  // player's matches the point-by-point parse actually reached — it is NOT his
  // career match count, and the two must never be presented as the same figure.
  function coverageFor(HB, pkey){
    const meta = (HB && HB.meta) || null;
    const pd = (HB && HB.players) ? HB.players[String(pkey)] : null;
    return {
      held: !!pd,
      matches: pd && pd.matches != null ? pd.matches : null,
      svcGames: pd && pd.svcGames != null ? pd.svcGames : null,
      windowMonths: meta ? meta.windowMonths : null,
      from: meta && meta.coverage ? meta.coverage.from : null,
      to: meta && meta.coverage ? meta.coverage.to : null,
      sampleFloor: meta && meta.sampleFloor != null ? meta.sampleFloor : null,
      rosterPlayers: meta && meta.players != null ? meta.players : null,
    };
  }

  root.HoldBreakHeatmap = { BUCKETS, HB_SETS, GAP_PTS, gapBand, gapText, hbSum, heatFor, coverageFor };
})(typeof window !== 'undefined' ? window : globalThis);
