// Tournaments → Reports (design_handoff_tournaments_tab, prototype `Tournament Reports.dc.html` isReports section,
// founder rulings 2026-11-15). Owner: the TTReports builder. Sets window.TTReports = { render(el) }.
//
// One filter card (Tournament + "?" · Report · Quarter · Reached · Round / Rounds through · Players · Metrics; on
// Head-to-head: Tournament · Report · Players with two pickers + Swap), then Round comparison (metric cards ranked per
// quarter), Player progression (heat matrices ranked per quarter) or the Head-to-head result card, and the match sheet.
//
// Data (feasibility table, inventory v5-6 §4) — every figure is ours or a dash:
//   · tournament-progression.json through the page's tourxBuildTournament (per-round metrics, opponents, results), the
//     raw rounds for an unrounded Pressure points, and `matches[]` (winner, set scores, point counts: exact Dominance,
//     Winners / UE per point, the deepest round each player reached).
//   · Quarters ONLY from the official draw: WueSheet.playerQuarter(WueSheet.cachedDraw(name), playerKey). A player with
//     no draw quarter is grouped under "Quarter —" (founder 2026-11-15), never a guessed quarter.
//   · Quarter winner = the quarter's player who won his quarter-final; a dash while it is unplayed.
//   · Round avg / Field avg = mean of the rows shown (design, founder 2026-11-15). Every player of the round, losers
//     included, is ranked inside his quarter (founder 2026-11-15; reverses the 2026-10-24 winners-only ruling).
//   · H2H 52-week hover: dna-apitennis-ratings.json players[key].surfaces.All.last52 for six stats; "—" for Pressure
//     points, Winners / pt, UE / pt and W/UE (no source, no approximation).
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MONO = "'IBM Plex Mono',monospace";
  const DASH = '—';
  const W = p => `color-mix(in srgb, var(--tt-white) ${p}%, transparent)`;
  const P = '.tabpage[data-page="tournaments"]';

  // The ten stats, order and names (README / DECISIONS 2026-11-15 "STATS SET"). key = the tourxBuildTournament key.
  const METRICS = [
    { key: 'serveRating',          label: 'Serve rating',                    short: 'Serve rating',    kind: 'rating' },
    { key: 'firstServePct',        label: '1st serve %',                     short: '1st serve %',     kind: 'pct' },
    { key: 'firstServeWonPct',     label: '1st serve points won',            short: '1st serve won',   kind: 'pct' },
    { key: 'secondServeWonPct',    label: '2nd serve points won',            short: '2nd serve won',   kind: 'pct' },
    { key: 'returnRating',         label: 'Return rating',                   short: 'Return rating',   kind: 'rating' },
    { key: 'dominanceRatio',       label: 'Dominance ratio',                 short: 'Dominance',       kind: 'ratio' },
    { key: 'pressurePct',          label: 'Pressure points',                 short: 'Pressure',        kind: 'pct' },
    { key: 'winnersPct',           label: 'Winners (per point)',             short: 'Winners',         kind: 'pp' },
    { key: 'unforcedErrorsPct',    label: 'Unforced errors (per point)',     short: 'Unforced errors', kind: 'pp', sub: 'lower is better', lower: true },
    { key: 'winnersUnforcedRatio', label: 'Winners / unforced errors ratio', short: 'W/UE ratio',      kind: 'ratio' },
  ];
  const BOX_ORDER = METRICS.map(m => m.key);
  const HELP = {
    round: "Players are ranked inside each quarter. The blue bar is the best of the round, the dashed line is the others' average. Click a bar for the match.",
    player: 'Players are ranked inside each quarter by their average. The highlighted cell is the best of that round. Click a cell for the match.',
    h2h: 'Whole-tournament averages for both players. The line leans from the centre toward the better player. Hover a figure for his last 52 weeks.',
  };
  const REACHED = { R128: 'Round of 128', R64: 'Round of 64', R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', F: 'Final' };

  // ---------------------------------------------------------------------------------------------- formatting
  function fmt(v, kind) {
    if (v == null || !isFinite(v)) return DASH;
    if (kind === 'rating') return String(Math.round(v));
    if (kind === 'pct') return Number(v).toFixed(1) + '%';
    return Number(v).toFixed(2);                                   // ratio, per point (0.19, never %)
  }
  // Heat cells drop the "%" (prototype fmtC); one decimal (≤ 5 rounds) or whole (> 5 rounds, the 26px cells).
  function fmtCell(v, kind, many) {
    if (v == null) return DASH;
    if (kind === 'pct') return many ? String(Math.round(v)) : Number(v).toFixed(1);
    return fmt(v, kind);
  }
  function fmtAvg(v, kind, many) {
    if (v == null) return DASH;
    if (kind === 'pct') return (many ? String(Math.round(v)) : Number(v).toFixed(1)) + '%';
    return fmt(v, kind);
  }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const mean = vs => vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  // Surname = the feed name minus its leading initials ("A. De Minaur" → "De Minaur", "T. A. Tirante" → "Tirante").
  function surname(n) {
    const w = String(n || '').trim().split(/\s+/).filter(Boolean);
    let i = 0; while (i < w.length - 1 && /\.$/.test(w[i])) i++;
    return i > 0 ? w.slice(i).join(' ') : (w[w.length - 1] || '');
  }

  // ---------------------------------------------------------------------------------------------- data model
  // build(env) → the report model of one tournament. env = { T (tourxBuildTournament output), raw (the
  // tournament-progression.json entry), quarterOf(playerKey) → 1–4 | null, setsToWin, year, surface, roundOutcome,
  // playerScore } (the last two = the page's tourxRoundOutcome / tourxPlayerScore, used only with no match row).
  function build(env) {
    const T = env.T, raw = env.raw || {};
    const labels = (T.roundLabels && T.roundLabels.length === T.rounds.length) ? T.roundLabels : T.rounds.slice();
    const matches = Array.isArray(T.matches) ? T.matches : [];
    const rawRound = {};
    (raw.players || []).forEach(p => (p.rounds || []).forEach(r => { if (r && r.round) rawRound[p.name + '|' + r.round] = r.metrics || null; }));
    const sideOf = (m, key) => (key && m.p1 && String(m.p1.playerKey) === key) ? 1 : (key && m.p2 && String(m.p2.playerKey) === key) ? 2 : 0;
    const matchOf = (key, i) => key ? matches.find(m => m.round === T.rounds[i] && sideOf(m, key)) || null : null;
    const players = T.players.map(p => {
      const key = p.playerKey != null && p.playerKey !== '' ? String(p.playerKey) : null;
      const vals = {};
      METRICS.forEach(m => { vals[m.key] = T.rounds.map((_, i) => { const v = p.data[m.key] ? p.data[m.key][i] : null; return v == null ? null : Number(v); }); });
      const own = T.rounds.map((_, i) => matchOf(key, i));
      T.rounds.forEach((rd, i) => {
        const mt = own[i], side = mt ? sideOf(mt, key) : 0, me = side === 1 ? mt.p1 : side === 2 ? mt.p2 : null;
        const has = METRICS.some(m => vals[m.key][i] != null);
        // Exact Dominance from the match's point counts: return points won % ÷ service points lost %.
        if (has && me && me.returnPoints && me.servicePoints && me.returnPoints.total > 0 && me.servicePoints.total > 0) {
          const lost = 1 - me.servicePoints.won / me.servicePoints.total;
          vals.dominanceRatio[i] = lost > 0 ? (me.returnPoints.won / me.returnPoints.total) / lost : null;
        }
        // Winners / unforced errors per point: the match's counts when it carries them, else the feed's % ÷ 100.
        const tp = has && me && me.totalPoints > 0 ? me.totalPoints : null;
        if (tp && me.winners != null) vals.winnersPct[i] = me.winners / tp;
        else if (vals.winnersPct[i] != null) vals.winnersPct[i] = vals.winnersPct[i] / 100;
        if (tp && me.unforcedErrors != null) vals.unforcedErrorsPct[i] = me.unforcedErrors / tp;
        else if (vals.unforcedErrorsPct[i] != null) vals.unforcedErrorsPct[i] = vals.unforcedErrorsPct[i] / 100;
        // Pressure points, unrounded: (own BP saved + converted) ÷ all break points; 0 break points → a dash.
        const mine = rawRound[p.name + '|' + rd], opp = p.opponents[i] ? rawRound[p.opponents[i] + '|' + rd] : null;
        if (mine && opp && mine.bpConv && opp.bpConv) {
          const den = opp.bpConv.total + mine.bpConv.total;
          vals.pressurePct[i] = den > 0 ? ((opp.bpConv.total - opp.bpConv.won) + mine.bpConv.won) / den * 100 : null;
        } else vals.pressurePct[i] = null;
      });
      // Deepest round he reached = his deepest match row (stat-less matches included); champion = won the final.
      let reachedIdx = -1, champion = false;
      matches.forEach(m => { const s = sideOf(m, key); if (!s) return; const i = T.rounds.indexOf(m.round); if (i > reachedIdx) reachedIdx = i; if (i === T.rounds.length - 1 && m.winner === s) champion = true; });
      T.rounds.forEach((_, i) => { if (p.opponents[i] && i > reachedIdx) reachedIdx = i; });
      const outcome = i => {                                         // true won · false lost · null unknown
        const mt = own[i], s = mt ? sideOf(mt, key) : 0;
        if (mt && (mt.winner === 1 || mt.winner === 2)) return mt.winner === s;
        return env.roundOutcome ? env.roundOutcome(p, i) : null;
      };
      const score = i => {                                           // "2–1" oriented to him, a completed match only
        const mt = own[i], s = mt ? sideOf(mt, key) : 0, won = outcome(i);
        if (won == null) return null;
        if (mt && Array.isArray(mt.score) && mt.score.length) {
          if (!env.setsToWin) return null;
          let a = 0, b = 0; mt.score.forEach(st => { const x = st[s === 1 ? 0 : 1], y = st[s === 1 ? 1 : 0]; if (x > y) a++; else if (y > x) b++; });
          return (Math.max(a, b) === env.setsToWin && (won ? a > b : b > a)) ? a + '–' + b : null;
        }
        return env.playerScore ? env.playerScore(p.results && p.results[i], won, env.setsToWin) : null;
      };
      return { name: p.name, key, last: surname(p.name), q: env.quarterOf ? env.quarterOf(key) : null, vals, opponents: p.opponents,
        played: T.rounds.map((_, i) => METRICS.some(m => vals[m.key][i] != null)), reachedIdx, champion, outcome, score };
    });
    const reachedLabel = p => p.champion ? 'Champion' : (REACHED[labels[p.reachedIdx]] || labels[p.reachedIdx] || DASH);
    // Quarter winner: the quarter's player who won his quarter-final (a dash while it is unplayed).
    const qfIdx = labels.indexOf('QF');
    const qWinner = q => {
      if (qfIdx < 0 || !env.quarterOf) return null;
      for (const m of matches) {
        if (m.round !== T.rounds[qfIdx] || !(m.winner === 1 || m.winner === 2)) continue;
        const w = m.winner === 1 ? m.p1 : m.p2;
        if (w && w.playerKey != null && env.quarterOf(String(w.playerKey)) === q) return surname(w.name);
      }
      return null;
    };
    return { name: T.name, labels, rounds: T.rounds, players, reachedLabel, qWinner, year: env.year || '', surface: env.surface || '' };
  }

  // ---------------------------------------------------------------------------------------------- state
  const S = { tour: null, view: 'round', qSel: null, rcRound: null, rcSel: null, rcMetricSel: null, rcAddOpen: false, rcQ: '',
    ppMin: 0, ppRound: null, ppSel: null, ppFocus: null, ppMetricSel: null, ppAddOpen: false, ppQ: '',
    h2hA: null, h2hB: null, h2hOpen: null, sheet: null, dna: null };
  let host = null, model = null;
  const QORDER = q => (q == null ? 5 : q);
  const qLabel = q => 'Quarter ' + (q == null ? DASH : q);
  const qTag = q => 'Q' + (q == null ? DASH : q);
  const pillCls = on => 'tt-rp-pill' + (on ? ' on' : '');
  const rcIdxOf = M => S.rcRound == null ? Math.max(0, M.labels.indexOf('QF')) : Math.min(S.rcRound, M.labels.length - 1);
  const ppMinOf = M => Math.min(S.ppMin || 0, M.labels.length - 1);

  // ---------------------------------------------------------------------------------------------- views
  function metricPicker(stateKey) {
    const raw = S[stateKey];
    const on = Array.isArray(raw) && raw.length ? BOX_ORDER.filter(k => raw.includes(k)) : BOX_ORDER.slice();
    const chips = BOX_ORDER.map(k => { const m = METRICS.find(x => x.key === k); return `<span class="tt-rp-mchip${on.includes(k) ? ' on' : ''}" data-act="metric" data-k="${k}" data-s="${stateKey}">${esc(m.short)}</span>`; }).join('');
    return { keys: on, html: chips + (on.length < BOX_ORDER.length ? `<span class="tt-rp-link" data-act="metric-reset" data-s="${stateKey}">All metrics</span>` : '') };
  }
  // Round comparison pool: every player with a box score in the round (winners and losers), inside the quarter filter.
  function roundPool(M, rIdx) {
    return M.players.filter(p => p.played[rIdx] && (S.qSel == null || p.q === S.qSel)).sort((a, b) => QORDER(a.q) - QORDER(b.q));
  }
  function ppPool(M) {
    const min = ppMinOf(M);
    return M.players.filter(p => (S.qSel == null || p.q === S.qSel) && p.reachedIdx >= min);
  }
  function rcSelected(M) {
    const pool = roundPool(M, rcIdxOf(M));
    return Array.isArray(S.rcSel) ? pool.filter(p => S.rcSel.includes(p.name)) : pool;
  }
  function ppSelected(M) {
    const pool = ppPool(M), names = pool.map(p => p.name);
    let sel = Array.isArray(S.ppSel) ? S.ppSel.filter(n => names.includes(n)) : [];
    if (!sel.length) sel = names.slice();
    return pool.filter(p => sel.includes(p.name)).sort((a, b) => QORDER(a.q) - QORDER(b.q));
  }
  const tipOf = (M, p, i) => {
    const won = p.outcome(i), sc = p.score(i);
    return [p.name + ' vs ' + (p.opponents[i] || DASH), M.labels[i], won == null ? '' : (won ? 'won' : 'lost') + (sc ? ' ' + sc : '')].filter(Boolean).join(' · ');
  };

  function roundCards(M, rIdx, shown, keys) {
    return keys.map(k => {
      const m = METRICS.find(x => x.key === k), lower = !!m.lower;
      const withV = shown.map(p => ({ p, v: p.vals[k][rIdx] })).filter(e => e.v != null);
      const noV = shown.filter(p => p.vals[k][rIdx] == null).map(p => ({ p, v: null }));
      withV.sort((a, b) => lower ? a.v - b.v : b.v - a.v);
      const sorted = withV.concat(noV), vals = withV.map(e => e.v), avg = mean(vals);
      const lo = vals.length ? Math.min.apply(null, vals) : 0, hi = vals.length ? Math.max.apply(null, vals) : 1;
      const spread = (hi - lo) || Math.max(0.01, Math.abs(hi) * 0.08);
      const dMin = lo - spread * 0.10, dMax = hi + spread * 0.10;
      const pct = v => Math.max(4, Math.min(100, (lower ? (dMax - v) : (v - dMin)) / (dMax - dMin) * 100));
      const rows = sorted.map((e, i) => {
        const others = vals.filter((_, j) => j !== i);
        return { e, best: i === 0 && e.v != null, v: e.v, oAvg: e.v == null ? null : (others.length ? mean(others) : e.v) };
      });
      const groups = [1, 2, 3, 4, null].map(q => {
        const rs = rows.filter(r => r.e.p.q === q);
        let rank = 0;
        rs.forEach((r, j) => { r.rank = r.v == null ? '' : String(++rank); r.lead = r.best || (j === 0 && r.v != null); });
        return { q, rs };
      }).filter(g => g.rs.length);
      const body = groups.map(g => `<div class="tt-rp-qblock"><div class="tt-rp-qhead">${esc(qLabel(g.q))}</div>${g.rs.map(r => {
        const barC = r.best ? 'var(--tt-blue)' : r.lead ? W(36) : W(16);
        const bar = r.v == null ? '' : `<div class="tt-rp-rbar" style="width:${pct(r.v)}%;background:${barC};"></div>`;
        const avgL = r.v == null ? '' : `<div class="tt-rp-ravg" style="left:${pct(r.oAvg)}%;"></div>`;
        const open = r.v == null ? '' : ` data-act="sheet" data-p="${esc(r.e.p.name)}" data-i="${rIdx}"`;
        return `<div class="tt-rp-rrow"><span class="tt-rp-rrank">${r.rank}</span>`
          + `<a class="tt-rp-plink tt-rp-rname" href="#" data-act="profile" data-key="${esc(r.e.p.key || '')}" title="${esc(r.e.p.name)}" style="font-weight:${r.lead ? 700 : 600};">${esc(r.e.p.last)}</a>`
          + `<div class="tt-rp-rcell${r.v == null ? '' : ' live'}"${open}><div class="tt-rp-rtrack">${bar}${avgL}</div>${r.v == null ? '' : `<span class="tt-rp-rmeta">${esc(tipOf(M, r.e.p, rIdx))}</span>`}</div>`
          + `<span class="tt-rp-rval" style="color:${r.lead ? 'var(--text)' : 'var(--text-label)'};">${fmt(r.v, m.kind)}</span></div>`;
      }).join('')}</div>`).join('');
      const n = vals.length;
      return `<div class="tt-rp-mcard" data-metric="${k}"><div class="tt-rp-mhead"><span class="tt-rp-mlabel">${esc(m.label)}${m.sub ? ` <span class="tt-rp-msub">${esc(m.sub)}</span>` : ''}</span>`
        + `<span class="tt-rp-ravgl" title="Mean of the ${n} player${n === 1 ? '' : 's'} shown in ${esc(M.labels[rIdx])}">Round avg <b>${fmt(avg, m.kind)}</b></span></div>${body}</div>`;
    }).join('');
  }

  function heatHtml(M, rowsIn, shownIdx, m) {
    const lower = !!m.lower, nR = shownIdx.length, many = nR > 5;
    const cellMin = many ? 26 : 30, cols = `78px repeat(${nR},minmax(${cellMin}px,1fr)) 60px`;
    const minW = 78 + 60 + nR * cellMin + (nR + 1) * 3;
    const rows = rowsIn.map(p => ({ p, vals: shownIdx.map(i => p.vals[m.key][i]) }));
    rows.forEach(r => { const vs = r.vals.filter(v => v != null); r.avg = vs.length ? mean(vs) : null; });
    const byAvg = (a, b) => (a.avg == null && b.avg == null) ? 0 : a.avg == null ? 1 : b.avg == null ? -1 : (lower ? a.avg - b.avg : b.avg - a.avg);
    rows.sort((a, b) => QORDER(a.p.q) - QORDER(b.p.q) || byAvg(a, b));
    let pq, rk = 0; rows.forEach(r => { rk = r.p.q === pq ? rk + 1 : 1; pq = r.p.q; r.rank = rk; });
    // Best of each round = card-wide, on the printed value, ties all lit (a column with one value lights nothing).
    const best = shownIdx.map((_, c) => { const vs = rows.map(r => r.vals[c]).filter(v => v != null); if (vs.length < 2) return null; return fmtCell((lower ? Math.min : Math.max).apply(null, vs), m.kind, many); });
    const anyFocus = rows.some(r => r.p.name === S.ppFocus);
    let html = `<div class="tt-rp-hgrid" style="grid-template-columns:${cols};margin-bottom:6px;"><div></div>`
      + shownIdx.map(i => `<div class="tt-rp-hround${many ? ' many' : ''}">${esc(M.labels[i])}</div>`).join('') + `<div class="tt-rp-havgh">Avg</div></div>`;
    rows.forEach((r, si) => {
      const focused = r.p.name === S.ppFocus, dim = anyFocus && !focused;
      if (si === 0 || rows[si - 1].p.q !== r.p.q) html += `<div class="tt-rp-hq" style="margin:${si ? '10px 0 5px' : '2px 0 5px'};">${esc(qLabel(r.p.q))}</div>`;
      html += `<div class="tt-rp-hgrid tt-rp-hrow" style="grid-template-columns:${cols};">`
        + `<div class="tt-rp-hname" data-act="focus" data-p="${esc(r.p.name)}" title="Focus ${esc(r.p.last)}" style="opacity:${dim ? 0.5 : 1};"><span class="tt-rp-hrank">${r.rank}</span><span class="tt-rp-hsur${focused ? ' focus' : ''}">${esc(r.p.last)}</span></div>`
        + r.vals.map((v, c) => {
          if (v == null) return `<div><div class="tt-rp-hcell none" style="opacity:${dim ? 0.26 : 1};">${DASH}</div></div>`;
          const t = fmtCell(v, m.kind, many), lead = best[c] != null && t === best[c], i = shownIdx[c];
          return `<div><div class="tt-rp-hcell live${lead ? ' lead' : ''}" data-act="sheet" data-p="${esc(r.p.name)}" data-i="${i}" data-meta="${esc(tipOf(M, r.p, i))}" title="Open match stats" style="opacity:${dim ? 0.26 : 1};">${t}</div></div>`;
        }).join('')
        + `<div><div class="tt-rp-havg" style="opacity:${dim ? 0.26 : 1};">${r.avg == null ? `<span class="tt-rp-hdash">${DASH}</span>` : `<span>${fmtAvg(r.avg, m.kind, many)}</span>`}</div></div></div>`;
    });
    if (rows.length >= 2) {
      const field = shownIdx.map((_, c) => { const vs = rows.map(r => r.vals[c]).filter(v => v != null); return vs.length ? mean(vs) : null; });
      const fv = field.filter(v => v != null);
      html += `<div class="tt-rp-hgrid tt-rp-hfield" style="grid-template-columns:${cols};"><div class="tt-rp-hfl" title="Mean of the ${rows.length} players shown">Field avg</div>`
        + field.map(v => `<div class="tt-rp-hfc">${fmtCell(v, m.kind, many)}</div>`).join('')
        + `<div class="tt-rp-hfa">${fv.length ? fmtAvg(mean(fv), m.kind, many) : DASH}</div></div>`;
    }
    return `<div class="tt-rp-hscroll"><div style="min-width:${minW}px;">${html}</div></div>`;
  }

  // The six 52-week stats DNA carries (All surfaces, last52); Pressure, Winners/pt, UE/pt and W/UE have no source.
  const DNA_PATH = { serveRating: ['serve', 'rating'], firstServePct: ['serve', 'firstInPct'], firstServeWonPct: ['serve', 'firstWonPct'],
    secondServeWonPct: ['serve', 'secondWonPct'], returnRating: ['return', 'rating'], dominanceRatio: ['dominanceRatio', 'rating'] };
  function dna52(dnaByKey, key, mk) {
    const path = DNA_PATH[mk]; if (!path || !dnaByKey || !key) return null;
    const rec = dnaByKey[String(key)]; const l = rec && rec.surfaces && rec.surfaces.All && rec.surfaces.All.last52;
    const v = l && l[path[0]] ? l[path[0]][path[1]] : null;
    if (v == null || !isFinite(v)) return null;
    const n = l.sample && l.sample.matches;
    return { v: Number(v), n: n == null ? DASH : n, from: rec.last52From || DASH, to: rec.latestMatch || DASH };
  }
  function h2hRow(M, a, b, m, dna) {
    const lower = !!m.lower;
    const tv = p => { const vs = p.vals[m.key].filter(v => v != null); return { v: vs.length ? mean(vs) : null, n: vs.length }; };
    const A = tv(a), B = tv(b), fa = fmt(A.v, m.kind), fb = fmt(B.v, m.kind);
    const differ = A.v != null && B.v != null && fa !== fb;               // ties on the printed value lean nowhere
    const aLead = differ && (lower ? A.v < B.v : A.v > B.v), bLead = differ && !aLead;
    const lw = (aLead || bLead) ? Math.round(Math.min(46, 8 + Math.abs(A.v - B.v) / (Math.max(Math.abs(A.v), Math.abs(B.v)) || 1) * 190)) : 0;
    const tip = (p, x) => {
      const y = dna52(dna, p.key, m.key);
      const here = x.v == null ? '' : ` · here: mean of ${x.n} match${x.n === 1 ? '' : 'es'} at ${M.name}${M.year ? ' ' + M.year : ''}`;
      if (!y) return 'His last 52 weeks: ' + DASH + here;
      let g = '';
      if (x.v != null) {
        const d = x.v - y.v, z = m.kind === 'rating' ? Math.round(d) : m.kind === 'pct' ? Math.round(d * 10) / 10 : Math.round(d * 100) / 100;
        g = ' (' + (z > 0 ? '+' : z < 0 ? '−' : '') + (m.kind === 'rating' ? Math.abs(z) : Math.abs(z).toFixed(m.kind === 'pct' ? 1 : 2)) + ' here)';
      }
      return 'His last 52 weeks: ' + fmt(y.v, m.kind) + g + ` · ${y.n} matches, ATP main tour, ${y.from} to ${y.to}` + here;
    };
    const lead = aLead ? `left:${50 - lw}%;width:${lw}%;background:var(--tt-blue);` : bLead ? `left:50%;width:${lw}%;background:var(--text);` : 'left:50%;width:0%;';
    const fig = (t, on, r, ttl) => `<span class="tt-rp-hhfig${r ? ' r' : ''}" title="${esc(ttl)}" style="font-weight:${on ? 800 : 500};color:${on ? 'var(--tt-white)' : 'var(--text-label)'};">${t}</span>`;
    return `<div class="tt-rp-hhrow" data-metric="${m.key}">${fig(fa, aLead, false, tip(a, A))}`
      + `<div class="tt-rp-hhmid"><span class="tt-rp-hhlabel">${esc(m.label)}</span><div class="tt-rp-hhline"><span class="tt-rp-hhlead" style="${lead}"></span><span class="tt-rp-hhtick"></span></div></div>`
      + `${fig(fb, bLead, true, tip(b, B))}</div>`;
  }

  function sheetHtml(M) {
    const sh = S.sheet; if (!sh) return '';
    const p = M.players.find(x => x.name === sh.player); if (!p) return '';
    const i = sh.i, oppName = p.opponents[i] || null, o = oppName ? M.players.find(x => x.name === oppName) : null;
    const won = p.outcome(i), sc = p.score(i);
    const meta = [M.name + (M.year ? ' ' + M.year : ''), M.labels[i], M.surface, won == null ? '' : p.last + ' ' + (won ? 'won' : 'lost') + (sc ? ' ' + sc : '')].filter(Boolean).join(' · ');
    const rows = METRICS.map(m => {
      const a = p.vals[m.key][i], b = o ? o.vals[m.key][i] : null, fa = fmt(a, m.kind), fb = fmt(b, m.kind);
      const differ = a != null && b != null && fa !== fb;
      const aW = differ && (m.lower ? a < b : a > b), bW = differ && !aW;
      const cell = (t, w) => `<span class="tt-rp-sv${w ? ' better' : ''}">${t}</span>`;
      return `<div class="tt-rp-srow"><span class="tt-rp-slabel">${esc(m.label)}</span>${cell(fa, aW)}${cell(fb, bW)}</div>`;
    }).join('');
    return `<div class="tt-rp-scrim" data-act="sheet-close-scrim"><div class="tt-rp-sheet" role="dialog" aria-modal="true" aria-label="Match stats: ${esc(p.name)} v ${esc(oppName || DASH)}">`
      + `<div class="tt-rp-shead"><span style="flex:1;min-width:0;"><span class="tt-rp-stitle">${esc(p.name)} <span style="color:var(--text-label);">v</span> ${esc(oppName || DASH)}</span><span class="tt-rp-smeta">${esc(meta)}</span></span>`
      + `<span class="tt-rp-sclose" data-act="sheet-close" title="Close" aria-label="Close">✕</span></div>`
      + `<div class="tt-rp-scols"><span class="tt-rp-scap">Metric</span><span class="tt-rp-scap r">${esc(p.last)}</span><span class="tt-rp-scap r">${esc(oppName ? surname(oppName) : DASH)}</span></div>`
      + `<div class="tt-rp-sbody">${rows}</div></div></div>`;
  }

  const ROW = (label, inner, opts) => `<div class="tt-rp-frow${opts && opts.start ? ' start' : ''}"><span class="tt-rp-flabel">${label}</span><div class="tt-rp-fval"${opts && opts.gap ? ` style="gap:${opts.gap};"` : ''}>${inner}</div></div>`;
  function chipHtml(p, focused, which) {
    return `<span class="tt-rp-chip${focused ? ' focus' : ''}"><span class="tt-rp-chipname" data-act="${which === 'pp' ? 'focus' : 'noop'}" data-p="${esc(p.name)}"><span class="tt-rp-chipq">${esc(qTag(p.q))}</span>${esc(p.last)}</span>`
      + `<span class="tt-rp-chipx" data-act="remove" data-s="${which}" data-p="${esc(p.name)}" title="Remove">✕</span></span>`;
  }
  function h2hOrder(M) { return M.players.slice().sort((a, b) => (b.champion - a.champion) || (b.reachedIdx - a.reachedIdx)); }
  function h2hPair(M) {
    const order = h2hOrder(M), has = n => order.some(p => p.name === n);
    const A = has(S.h2hA) ? S.h2hA : (order[0] && order[0].name);
    const B = has(S.h2hB) && S.h2hB !== A ? S.h2hB : ((order.find(p => p.name !== A) || {}).name);
    return [A, B];
  }

  function viewHtml(M, available) {
    const view = S.view, nRounds = M.labels.length;
    const tours = available.map(n => `<span class="tt-rp-pill tour${n === M.name ? ' on' : ''}" data-act="tour" data-v="${esc(n)}">${esc(n)} <span class="tt-rp-pfig">${esc(M.year)}</span></span>`).join('')
      + `<span class="tt-rp-help" title="${esc(HELP[view])}">?</span>`;
    const reports = [['round', 'Round comparison'], ['player', 'Player progression'], ['h2h', 'Head-to-head']]
      .map(([v, l]) => `<span class="tt-rp-pill rep${view === v ? ' on' : ''}" data-act="view" data-v="${v}">${l}</span>`).join('');
    let filter = ROW('Tournament', tours) + ROW('Report', reports);
    let body = '';
    if (view !== 'h2h') {
      const qp = [[null, 'All quarters', M.players.length + ' players']].concat([1, 2, 3, 4].map(q => [q, 'Quarter ' + q, M.qWinner(q) || DASH]))
        .map(([q, l, f]) => `<span class="${pillCls(q === S.qSel)}" data-act="quarter" data-v="${q == null ? '' : q}">${esc(l)} <span class="tt-rp-pfig">${esc(f)}</span></span>`).join('');
      filter += ROW('Quarter', qp);
      const isPP = view === 'player', which = isPP ? 'pp' : 'rc';
      let pool, shown, roundsHtml, roundNote, metrics, emptyNote;
      if (isPP) {
        const ppMin = ppMinOf(M);
        filter += ROW('Reached', [[0, 'Any round']].concat(M.labels.map((r, i) => [i, r]).slice(-3))
          .map(([i, l]) => `<span class="${pillCls(i === ppMin)}" data-act="ppmin" data-v="${i}">${esc(l)}</span>`).join(''));
        pool = ppPool(M); shown = ppSelected(M);
        const ppIdx = S.ppRound == null ? nRounds - 1 : Math.min(S.ppRound, nRounds - 1);
        roundsHtml = M.labels.map((r, i) => `<span class="tt-rp-rpill${i === ppIdx ? ' on' : ''}" data-act="pprnd" data-v="${i}">${esc(r)}</span>`).join('');
        roundNote = ppIdx === nRounds - 1 ? 'Every round played' : 'Up to the ' + M.labels[ppIdx];
        emptyNote = 'No players match.';
        metrics = metricPicker('ppMetricSel');
        const shownIdx = M.labels.map((_, i) => i).slice(0, ppIdx + 1);
        body = `<div class="tt-rp-body">${shown.length ? `<div class="tt-rp-ppgrid">${metrics.keys.map(k => { const m = METRICS.find(x => x.key === k);
          return `<div class="tt-rp-ppcard" data-metric="${k}"><div class="tt-rp-pptitle">${esc(m.label)}${m.sub ? ` <span class="tt-rp-msub">${esc(m.sub)}</span>` : ''}</div><div style="width:100%;">${heatHtml(M, shown, shownIdx, m)}</div></div>`; }).join('')}</div>`
          : `<div class="tt-rp-empty">No player from ${S.qSel ? 'Quarter ' + S.qSel : 'this draw'} reached the ${esc(M.labels[ppMin])}. Pick an earlier round or another quarter.</div>`}</div>`;
      } else {
        const rIdx = rcIdxOf(M);
        pool = roundPool(M, rIdx); shown = rcSelected(M);
        roundsHtml = M.labels.map((r, i) => `<span class="tt-rp-rpill${i === rIdx ? ' on' : ''}" data-act="rcrnd" data-v="${i}">${esc(r)}</span>`).join('');
        roundNote = shown.length + ' of ' + pool.length + ' players shown';
        emptyNote = (S.rcQ || '').trim() ? 'No player matches that search.' : 'Every player who reached ' + M.labels[rIdx] + ' is already shown.';
        metrics = metricPicker('rcMetricSel');
        body = `<div class="tt-rp-body">${shown.length ? '' : `<div class="tt-rp-empty">${pool.length ? 'No player selected. Add a player or press Show all.' : 'No player from ' + (S.qSel ? 'Quarter ' + S.qSel : 'this draw') + ' played the ' + esc(M.labels[rIdx]) + '. Pick an earlier round or another quarter.'}</div>`}`
          + `<div class="tt-rp-rcgrid">${shown.length ? roundCards(M, rIdx, shown, metrics.keys) : ''}</div></div>`;
      }
      filter += ROW(isPP ? 'Rounds through' : 'Round', `<div class="tt-rp-rpills">${roundsHtml}</div><span class="tt-rp-rnote">${esc(roundNote)}</span>`, { gap: '6px 12px' });
      const addOpen = isPP ? S.ppAddOpen : S.rcAddOpen, q = isPP ? S.ppQ : S.rcQ, ql = (q || '').trim().toLowerCase();
      const options = pool.filter(p => !shown.includes(p) && (!ql || p.name.toLowerCase().includes(ql)));
      const canAdd = shown.length < pool.length;
      const add = canAdd ? `<span class="tt-rp-addwrap"><span class="tt-rp-add" data-act="add-toggle" data-s="${which}"><span class="tt-rp-addplus">+</span> Add player</span>${addOpen ? `<div class="tt-rp-menu tt-rp-addmenu"><input class="tt-rp-search" data-s="${which}" value="${esc(q || '')}" placeholder="Search players…"><div class="tt-rp-mlist">${options.map(p => `<div class="tt-rp-mopt" data-act="add" data-s="${which}" data-p="${esc(p.name)}"><span class="tt-rp-moq">${esc(qTag(p.q))}</span><span class="tt-rp-mon">${esc(p.last)}</span><span class="tt-rp-mor">${esc(M.reachedLabel(p))}</span></div>`).join('')}${options.length ? '' : `<div class="tt-rp-mempty">${esc(emptyNote)}</div>`}</div></div>` : ''}</span>` : '';
      filter += ROW('Players', shown.map(p => chipHtml(p, isPP && S.ppFocus === p.name, which)).join('') + add
        + (shown.length < pool.length ? `<span class="tt-rp-link" data-act="show-all" data-s="${which}">Show all</span>` : ''), { start: true });
      filter += ROW('Metrics', metrics.html, { start: true });
    } else {
      const order = h2hOrder(M), [A, B] = h2hPair(M);
      const pick = (which, sel, other, dot, slot) => {
        const sp = order.find(p => p.name === sel), open = S.h2hOpen === which;
        const opts = order.map(p => `<div class="tt-rp-hopt${p.name === sel ? ' on' : ''}${p.name === other ? ' off' : ''}" data-act="${p.name === other ? 'noop' : 'h2hpick'}" data-w="${which}" data-p="${esc(p.name)}"><span class="tt-rp-hon">${esc(p.name)}</span><span class="tt-rp-mor">${esc(M.reachedLabel(p))}</span></div>`).join('');
        return `<div class="tt-rp-pick"><div class="tt-rp-picker${open ? ' open' : ''}" data-act="h2htoggle" data-w="${which}" title="${slot}"><span class="tt-rp-dot" style="background:${dot};"></span>`
          + `<span class="tt-rp-pname">${esc(sp ? sp.name : 'Select')}</span><span class="tt-rp-preach">${esc(sp ? M.reachedLabel(sp) : '')}</span>`
          + `<span class="tt-rp-chev" style="transform:rotate(${open ? 180 : 0}deg);"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg></span></div>`
          + (open ? `<div class="tt-rp-menu tt-rp-hmenu">${opts}</div>` : '') + `</div>`;
      };
      filter += `<div class="tt-rp-frow"><span class="tt-rp-flabel">Players</span><div class="tt-rp-fval" style="gap:10px;">${pick('A', A, B, 'var(--tt-blue)', 'Player one')}${pick('B', B, A, 'var(--text)', 'Player two')}<span class="tt-rp-link" data-act="swap">Swap</span></div></div>`;
      const pa = order.find(p => p.name === A), pb = order.find(p => p.name === B);
      if (pa && pb) {
        const dna = S.dna && S.dna.byKey || null;
        body = `<div class="tt-rp-h2hwrap"><div class="tt-rp-h2h"><div class="tt-rp-h2hhead">`
          + `<span class="tt-rp-h2hside"><span class="tt-rp-dot" style="background:var(--tt-blue);"></span><a class="tt-rp-plink tt-rp-h2hname" href="#" data-act="profile" data-key="${esc(pa.key || '')}">${esc(pa.name)}</a></span>`
          + `<span class="tt-rp-h2hside r"><a class="tt-rp-plink tt-rp-h2hname" href="#" data-act="profile" data-key="${esc(pb.key || '')}">${esc(pb.name)}</a><span class="tt-rp-dot" style="background:var(--text);"></span></span></div>`
          + METRICS.map(m => h2hRow(M, pa, pb, m, dna)).join('')
          + `<div class="tt-rp-h2hfoot"><div class="tt-rp-h2hleft"><div class="tt-rp-h2hctx">These figures cover ${esc(M.name)}${M.year ? ' ' + esc(M.year) : ''} only</div><div class="tt-rp-h2hnote">Past meetings, surfaces and full-season numbers are on the Head to Head page.</div></div>`
          + `<a class="tt-rp-full" href="#" data-act="full-h2h" data-a="${esc(pa.key || '')}" data-b="${esc(pb.key || '')}">Open the full head to head ›</a></div></div></div>`;
      }
    }
    return `<div class="tt-rp-wrap"><div class="tt-rp-filter">${filter}</div>${body}${sheetHtml(M)}</div>`;
  }

  // ---------------------------------------------------------------------------------------------- environment
  function liveEnv(name) {
    const prog = typeof tournamentProgression !== 'undefined' ? tournamentProgression : null;
    const raw = prog && prog.tournaments ? prog.tournaments[name] : null;
    const T = raw && typeof tourxBuildTournament === 'function' ? tourxBuildTournament(name) : null;
    if (!T) return null;
    const WS = typeof WueSheet !== 'undefined' ? WueSheet : null;
    const draw = WS && WS.cachedDraw ? WS.cachedDraw(name) : null;
    const cat = typeof TOURNAMENT_CATALOG !== 'undefined' ? TOURNAMENT_CATALOG.find(t => t.name === name) : null;
    return { T, raw, quarterOf: draw && WS.playerQuarter ? (k => WS.playerQuarter(draw, k)) : (() => null),
      setsToWin: typeof tourxSetsToWin === 'function' ? tourxSetsToWin(T) : null,
      year: typeof tourxReportYear === 'function' ? tourxReportYear() : '', surface: cat && cat.surface ? String(cat.surface).toLowerCase() : '',
      roundOutcome: typeof tourxRoundOutcome === 'function' ? tourxRoundOutcome : null, playerScore: typeof tourxPlayerScore === 'function' ? tourxPlayerScore : null };
  }
  let drawsAsked = false, dnaAsked = false;
  const EMPTY = '<div class="tt-rp-wrap"><div class="tt-rp-empty">No tournament reports available yet. Round-by-round data is published here as events complete.</div></div>';
  function render(el) {
    host = el || host; if (!host) return;
    injectCss(); bind(host);
    const prog = typeof tournamentProgression !== 'undefined' ? tournamentProgression : null;
    const available = prog && prog.tournaments ? Object.keys(prog.tournaments) : [];
    if (!available.length) { host.innerHTML = EMPTY; return; }
    const ts = typeof tourxState !== 'undefined' ? tourxState : null;
    if (ts && ts.tour && available.includes(ts.tour) && ts.tour !== S.tour) {      // "View report →" from the Overview
      resetPicks(); S.tour = ts.tour; if (['round', 'player', 'h2h'].includes(ts.view)) S.view = ts.view;
    }
    if (!S.tour || !available.includes(S.tour)) S.tour = available[0];
    if (ts) { ts.tour = S.tour; ts.view = S.view; }
    if (!drawsAsked && typeof WueSheet !== 'undefined' && WueSheet.prefetchDraws) { drawsAsked = true; WueSheet.prefetchDraws().then(() => rerender()); }
    if (!dnaAsked && typeof ensureMatchDna === 'function') { dnaAsked = true; ensureMatchDna().then(d => { S.dna = d; if (S.view === 'h2h') rerender(); }); }
    const env = liveEnv(S.tour);
    if (!env) { host.innerHTML = EMPTY; return; }
    model = build(env);
    host.innerHTML = viewHtml(model, available);
    const inp = host.querySelector('.tt-rp-search');
    if (inp) { inp.focus(); const v = inp.value; inp.setSelectionRange(v.length, v.length); }
  }
  function rerender() { if (host && host.isConnected && host.offsetParent !== null) render(host); }
  function resetPicks() { Object.assign(S, { qSel: null, rcRound: null, rcSel: null, rcAddOpen: false, rcQ: '', ppMin: 0, ppRound: null, ppSel: null, ppFocus: null, ppAddOpen: false, ppQ: '', h2hA: null, h2hB: null, h2hOpen: null, sheet: null }); }

  // ---------------------------------------------------------------------------------------------- events
  // act(a, data) applies one click to the state (exported for the test); returns false when nothing changed.
  function act(a, d) {
    const M = model, pp = d.s === 'pp';
    switch (a) {
      case 'tour': resetPicks(); S.tour = d.v; if (typeof tourxState !== 'undefined') tourxState.tour = S.tour; return true;
      case 'view': S.view = d.v; S.h2hOpen = null; S.rcAddOpen = S.ppAddOpen = false; return true;
      case 'quarter': S.qSel = d.v ? +d.v : null; Object.assign(S, { rcSel: null, ppSel: null, ppFocus: null, rcAddOpen: false, ppAddOpen: false }); return true;
      case 'ppmin': S.ppMin = +d.v; S.ppSel = null; return true;
      case 'pprnd': S.ppRound = +d.v; return true;
      case 'rcrnd': S.rcRound = +d.v; return true;
      case 'metric': {
        const raw = S[d.s], on = Array.isArray(raw) && raw.length ? BOX_ORDER.filter(x => raw.includes(x)) : BOX_ORDER.slice();
        const next = on.includes(d.k) ? on.filter(x => x !== d.k) : BOX_ORDER.filter(x => on.includes(x) || x === d.k);
        S[d.s] = next.length ? next : [d.k]; return true;
      }
      case 'metric-reset': S[d.s] = null; return true;
      case 'focus': S.ppFocus = S.ppFocus === d.p ? null : d.p; return true;
      case 'remove':
        if (pp) { S.ppSel = ppSelected(M).map(p => p.name).filter(n => n !== d.p); if (S.ppFocus === d.p) S.ppFocus = null; }
        else S.rcSel = rcSelected(M).map(p => p.name).filter(n => n !== d.p);
        return true;
      case 'add-toggle': if (pp) { S.ppAddOpen = !S.ppAddOpen; S.ppQ = ''; } else { S.rcAddOpen = !S.rcAddOpen; S.rcQ = ''; } return true;
      case 'add':
        if (pp) { S.ppSel = ppSelected(M).map(p => p.name).concat(d.p); S.ppAddOpen = false; S.ppQ = ''; }
        else { S.rcSel = rcSelected(M).map(p => p.name).concat(d.p); S.rcAddOpen = false; S.rcQ = ''; }
        return true;
      case 'show-all': if (pp) { S.ppSel = null; S.ppAddOpen = false; S.ppQ = ''; } else { S.rcSel = null; S.rcAddOpen = false; S.rcQ = ''; } return true;
      case 'h2htoggle': S.h2hOpen = S.h2hOpen === d.w ? null : d.w; return true;
      case 'h2hpick': { const [A, B] = h2hPair(M); if (d.w === 'A') { S.h2hA = d.p; S.h2hB = B; } else { S.h2hA = A; S.h2hB = d.p; } S.h2hOpen = null; return true; }
      case 'swap': { const [A, B] = h2hPair(M); S.h2hA = B; S.h2hB = A; S.h2hOpen = null; return true; }
      case 'sheet': S.sheet = { player: d.p, i: +d.i }; return true;
      case 'sheet-close': case 'sheet-close-scrim': S.sheet = null; return true;
      default: return false;
    }
  }
  // "Open the full head to head ›" — founder brief ruling 7: the live receiver + the session hand-over.
  function goFullH2H(ka, kb) {
    const ctry = k => { const pr = (typeof playerProfiles !== 'undefined' && playerProfiles) ? playerProfiles[k] : null; return (pr && (pr.country || pr.countryCode)) || ''; };
    try { sessionStorage.setItem('stn_h2h_pair', JSON.stringify([ka, kb, ctry(ka), ctry(kb)])); } catch (err) { /* storage blocked */ }
    if (typeof root.sfGoToH2H === 'function') root.sfGoToH2H(ka, kb);
  }
  let tipEl = null, bound = false;
  function bind(el) {
    if (el.dataset.ttRpBound) return;
    el.dataset.ttRpBound = '1';
    el.addEventListener('click', e => {
      const t = e.target.closest && e.target.closest('[data-act]'); if (!t || !el.contains(t)) return;
      const a = t.dataset.act;
      if (a === 'sheet-close-scrim' && e.target !== t) return;
      if (a === 'profile') { e.preventDefault(); const k = t.dataset.key; if (k && typeof psOpenProfile === 'function') psOpenProfile(k); return; }
      if (a === 'full-h2h') { e.preventDefault(); goFullH2H(t.dataset.a, t.dataset.b); return; }
      if (a === 'sheet') hideTip();
      if (act(a, t.dataset)) render(el);
    });
    el.addEventListener('input', e => {
      const t = e.target; if (!t.classList || !t.classList.contains('tt-rp-search')) return;
      if (t.dataset.s === 'pp') S.ppQ = t.value; else S.rcQ = t.value;
      render(el);
    });
    // Heat cell hover: the fixed match chip above the cell (below when the cell is near the top), clamped 150px in.
    el.addEventListener('mouseover', e => { const c = e.target.closest && e.target.closest('.tt-rp-hcell.live'); if (c) showTip(c); });
    el.addEventListener('mouseout', e => { const c = e.target.closest && e.target.closest('.tt-rp-hcell.live'); if (c && !c.contains(e.relatedTarget)) hideTip(); });
    if (bound) return; bound = true;
    document.addEventListener('click', e => {
      if (!host || !host.isConnected) return;
      const inside = sel => e.target.closest && e.target.closest(sel);
      let changed = false;
      if ((S.rcAddOpen || S.ppAddOpen) && !inside('.tt-rp-addwrap')) { S.rcAddOpen = S.ppAddOpen = false; changed = true; }
      if (S.h2hOpen && !inside('.tt-rp-pick')) { S.h2hOpen = null; changed = true; }
      if (changed) render(host);
    });
    (root.sfEscLayers = root.sfEscLayers || []).push({ id: 'tt-reports-sheet', z: 90, isOpen: () => !!S.sheet, close: closeSheet });
    (root.sfOverlayClosers = root.sfOverlayClosers || []).push(closeSheet);
  }
  function closeSheet() { if (!S.sheet) return; S.sheet = null; if (host) render(host); }
  function showTip(cell) {
    const meta = cell.getAttribute('data-meta'); if (!meta) return;
    if (!tipEl) { tipEl = document.createElement('span'); tipEl.className = 'tt-rp-ftip'; }
    cell.appendChild(tipEl);
    const r = cell.getBoundingClientRect(), vw = window.innerWidth, below = r.top < 74;
    tipEl.textContent = meta;
    tipEl.style.left = Math.max(150, Math.min(vw - 150, r.left + r.width / 2)) + 'px';
    tipEl.style.top = (below ? r.bottom + 8 : r.top - 8) + 'px';
    tipEl.style.transform = below ? 'translate(-50%,0)' : 'translate(-50%,-100%)';
  }
  function hideTip() { if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl); }

  // ---------------------------------------------------------------------------------------------- styles
  function injectCss() {
    if (document.getElementById('tt-reports-css')) return;
    const st = document.createElement('style'); st.id = 'tt-reports-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const caps = 'font-size:10.5px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:var(--text-label);';
  const CSS = `
${P} .tt-rp-wrap{ max-width:1500px; margin:0 auto; padding:18px 24px 40px; font-family:'Hanken Grotesk',sans-serif; font-size:16px; line-height:normal; color:var(--text); -webkit-font-smoothing:antialiased; }
${P} .tt-rp-wrap *, ${P} .tt-rp-wrap *::before, ${P} .tt-rp-wrap *::after{ box-sizing:border-box; }
${P} .tt-rp-filter{ border:1.25px solid ${W(6)}; border-radius:14px; background:var(--card); padding:4px 18px; }
${P} .tt-rp-frow{ display:grid; grid-template-columns:104px minmax(0,1fr); gap:14px; align-items:center; padding:12px 0; border-top:1px solid ${W(6)}; }
${P} .tt-rp-frow:first-child{ border-top:none; }
${P} .tt-rp-frow.start{ align-items:start; }
${P} .tt-rp-flabel{ ${caps} }
${P} .tt-rp-frow.start .tt-rp-flabel{ padding-top:9px; }
${P} .tt-rp-fval{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-width:0; }
${P} .tt-rp-pill{ display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; color:var(--text-label); background:transparent; border:1px solid ${W(8)}; border-radius:9px; padding:7px 12px; cursor:pointer; white-space:nowrap; }
${P} .tt-rp-pill.on{ color:var(--text); background:var(--selected); border-color:${W(16)}; font-weight:700; }
${P} .tt-rp-pill.tour.on{ font-weight:600; }
${P} .tt-rp-pill.rep{ padding:7px 14px; border-color:transparent; }
${P} .tt-rp-pill.rep.on{ border-color:${W(16)}; }
${P} .tt-rp-pfig{ font-family:${MONO}; font-size:11px; font-weight:500; color:var(--text-label); }
${P} .tt-rp-help{ margin-left:auto; flex:none; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; border:1px solid ${W(16)}; color:var(--text-label); font-size:12px; font-weight:700; cursor:help; }
${P} .tt-rp-help:hover{ color:var(--text); border-color:${W(30)}; }
${P} .tt-rp-rpills{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
${P} .tt-rp-rpill{ font-size:12px; font-weight:600; font-family:${MONO}; color:var(--text-label); background:transparent; border:1px solid transparent; border-radius:9px; padding:7px 12px; cursor:pointer; white-space:nowrap; }
${P} .tt-rp-rpill.on{ font-weight:700; color:var(--text); background:var(--selected); border-color:${W(16)}; }
${P} .tt-rp-rnote{ font-size:11.5px; color:var(--text-label); }
${P} .tt-rp-chip{ display:inline-flex; align-items:center; gap:8px; white-space:nowrap; background:${W(4)}; border:1px solid ${W(15)}; border-radius:9px; padding:6px 6px 6px 10px; font-size:12.5px; font-weight:600; color:var(--text); }
${P} .tt-rp-chip.focus{ background:${W(9)}; border-color:${W(35)}; }
${P} .tt-rp-chipname{ display:inline-flex; align-items:center; gap:8px; cursor:pointer; }
${P} .tt-rp-chipq{ font-family:${MONO}; font-size:10px; font-weight:600; color:var(--text-label); }
${P} .tt-rp-chipx{ display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:5px; color:var(--text-label); font-family:${MONO}; font-size:11px; cursor:pointer; }
${P} .tt-rp-chipx:hover{ background:${W(10)}; color:var(--text); }
${P} .tt-rp-addwrap{ position:relative; }
${P} .tt-rp-add{ display:inline-flex; align-items:center; gap:7px; border:1px dashed ${W(20)}; border-radius:9px; padding:6px 12px; font-size:12.5px; font-weight:600; color:var(--text-label); cursor:pointer; }
${P} .tt-rp-add:hover{ border-color:${W(30)}; color:var(--text); }
${P} .tt-rp-addplus{ font-family:${MONO}; font-size:14px; line-height:1; }
${P} .tt-rp-link{ font-size:12px; font-weight:600; color:var(--tt-blue); padding:7px 6px; cursor:pointer; }
${P} .tt-rp-menu{ position:absolute; top:calc(100% + 6px); z-index:30; background:var(--card); border:1px solid ${W(10)}; border-radius:10px; padding:4px; box-shadow:var(--tt-shadow-menu); }
${P} .tt-rp-addmenu{ left:0; width:260px; }
${P} .tt-rp-search{ width:100%; background:var(--inner); border:1px solid transparent; border-radius:8px; padding:7px 10px; outline:none; color:var(--text); font-size:12.5px; font-family:inherit; margin-bottom:6px; }
${P} .tt-rp-mlist{ max-height:212px; overflow:auto; scrollbar-width:thin; display:flex; flex-direction:column; }
${P} .tt-rp-mopt{ display:flex; align-items:center; gap:10px; padding:6px 9px; border-radius:7px; cursor:pointer; }
${P} .tt-rp-mopt:hover{ background:var(--inner); }
${P} .tt-rp-moq{ flex:none; font-size:10px; color:var(--text-label); font-family:${MONO}; }
${P} .tt-rp-mon{ flex:1; font-size:12.5px; font-weight:600; color:var(--text); }
${P} .tt-rp-mor{ flex:none; font-size:10px; color:var(--text-label); }
${P} .tt-rp-mempty{ padding:10px 12px; font-size:12px; line-height:1.5; color:var(--text-label); text-align:center; }
${P} .tt-rp-mchip{ font-size:12px; font-weight:600; color:var(--text-label); background:transparent; border:1px solid ${W(8)}; border-radius:9px; padding:6px 11px; cursor:pointer; white-space:nowrap; }
${P} .tt-rp-mchip.on{ font-weight:700; color:var(--text); background:var(--selected); border-color:${W(16)}; }
${P} .tt-rp-pick{ flex:1 1 200px; max-width:320px; min-width:0; position:relative; }
${P} .tt-rp-picker{ display:flex; align-items:center; gap:10px; height:40px; background:var(--inner); border:1px solid ${W(6)}; border-radius:9px; padding:0 12px; cursor:pointer; }
${P} .tt-rp-picker.open{ border-color:${W(16)}; }
${P} .tt-rp-picker:hover{ border-color:${W(30)}; }
${P} .tt-rp-dot{ width:9px; height:9px; border-radius:50%; flex:none; }
${P} .tt-rp-pname{ flex:1; min-width:0; font-size:13.5px; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
${P} .tt-rp-preach{ flex:none; font-size:11px; color:var(--text-label); white-space:nowrap; }
${P} .tt-rp-chev{ flex:none; display:inline-flex; color:var(--text-label); transition:transform 0.15s; }
${P} .tt-rp-hmenu{ left:0; right:0; max-height:280px; overflow:auto; }
${P} .tt-rp-hopt{ display:flex; align-items:center; gap:10px; padding:7px 9px; border-radius:7px; background:transparent; cursor:pointer; }
${P} .tt-rp-hopt:hover{ background:var(--inner); }
${P} .tt-rp-hopt.on{ background:${W(6)}; }
${P} .tt-rp-hopt.off{ opacity:0.35; }
${P} .tt-rp-hon{ flex:1; font-size:12.5px; font-weight:600; color:var(--tt-soft-2); }
${P} .tt-rp-hopt.on .tt-rp-hon{ color:var(--text); }
${P} .tt-rp-body{ margin-top:22px; }
${P} .tt-rp-empty{ border:1.25px dashed ${W(12)}; border-radius:12px; padding:26px; text-align:center; font-size:13.5px; color:var(--text-label); }
${P} .tt-rp-rcgrid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }
${P} .tt-rp-mcard{ border:1.25px solid ${W(6)}; border-radius:12px; background:var(--card); padding:14px 15px 12px; min-width:0; }
${P} .tt-rp-mhead{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding-bottom:11px; border-bottom:1px solid ${W(6)}; min-width:0; }
${P} .tt-rp-mlabel{ ${caps} white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
${P} .tt-rp-msub{ text-transform:none; letter-spacing:0; font-weight:500; }
${P} .tt-rp-ravgl{ font-size:10.5px; color:var(--text-label); font-family:${MONO}; flex:none; white-space:nowrap; }
${P} .tt-rp-ravgl b{ color:var(--tt-soft-2); }
${P} .tt-rp-qblock{ margin-top:12px; display:flex; flex-direction:column; gap:6px; }
${P} .tt-rp-qhead{ font-size:10px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:var(--text-label); }
${P} .tt-rp-rrow{ display:grid; grid-template-columns:12px minmax(0,92px) minmax(0,1fr) 44px; align-items:center; gap:8px; }
${P} .tt-rp-rrank{ font-family:${MONO}; font-size:10.5px; font-weight:600; color:var(--text-label); }
${P} .tt-rp-rname{ font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
${P} .tt-rp-plink{ cursor:pointer; color:var(--text); text-decoration:none; }
${P} .tt-rp-plink:hover{ color:var(--text); text-decoration:underline; }
${P} .tt-rp-rcell{ position:relative; height:18px; }
${P} .tt-rp-rcell.live{ cursor:pointer; }
${P} .tt-rp-rtrack{ position:absolute; inset:0; background:${W(4)}; border-radius:5px; overflow:hidden; }
${P} .tt-rp-rbar{ position:absolute; left:0; top:0; bottom:0; border-radius:5px; }
${P} .tt-rp-ravg{ position:absolute; top:-2px; bottom:-2px; width:0; border-left:1.5px dashed ${W(35)}; }
${P} .tt-rp-rcell.live:hover .tt-rp-rbar{ filter:brightness(1.25); }
${P} .tt-rp-rmeta{ display:none; position:absolute; bottom:calc(100% + 6px); left:50%; transform:translateX(-50%); z-index:8; white-space:nowrap; background:var(--selected); border:1px solid ${W(16)}; border-radius:8px; padding:6px 10px; font-family:${MONO}; font-size:10.5px; font-weight:600; color:var(--tt-tip-text); box-shadow:var(--tt-shadow-tip); pointer-events:none; }
${P} .tt-rp-rcell.live:hover .tt-rp-rmeta{ display:block; }
${P} .tt-rp-rval{ text-align:right; font-size:11px; font-weight:700; font-family:${MONO}; }
${P} .tt-rp-ppgrid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(330px,1fr)); gap:14px; }
${P} .tt-rp-ppcard{ border:1.25px solid ${W(6)}; border-radius:12px; background:var(--card); padding:14px; min-width:0; }
${P} .tt-rp-pptitle{ ${caps} white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-bottom:11px; margin-bottom:10px; border-bottom:1px solid ${W(6)}; }
${P} .tt-rp-hscroll{ overflow-x:auto; }
${P} .tt-rp-hgrid{ display:grid; gap:3px; }
${P} .tt-rp-hrow{ margin-bottom:4px; align-items:center; }
${P} .tt-rp-hround{ text-align:center; font-size:10px; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-label); font-weight:700; }
${P} .tt-rp-hround.many{ font-size:9px; letter-spacing:0.02em; }
${P} .tt-rp-havgh{ text-align:right; padding-right:4px; padding-left:10px; ${caps} }
${P} .tt-rp-hq{ padding-left:4px; font-size:10px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:var(--text-label); }
${P} .tt-rp-hname{ display:flex; align-items:center; gap:6px; min-width:0; padding-left:4px; cursor:pointer; }
${P} .tt-rp-hrank{ font-family:${MONO}; font-size:10.5px; font-weight:600; color:var(--text-label); flex:none; width:11px; }
${P} .tt-rp-hsur{ font-size:11.5px; font-weight:600; color:var(--tt-soft-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
${P} .tt-rp-hsur.focus{ font-weight:700; color:var(--text); }
${P} .tt-rp-hcell{ position:relative; display:flex; align-items:center; justify-content:center; height:28px; border-radius:6px; font-family:${MONO}; font-size:10.5px; font-weight:400; color:var(--tt-a3); background:${W(3)}; }
${P} .tt-rp-hcell.lead{ background:${W(15)}; box-shadow:inset 0 0 0 1px ${W(18)}; font-weight:700; color:var(--tt-white); }
${P} .tt-rp-hcell.live{ cursor:pointer; }
${P} .tt-rp-hcell.live:hover{ background:${W(18)}; }
${P} .tt-rp-hcell.none{ background:transparent; font-size:11px; color:var(--text-label); border-radius:0; }
${P} .tt-rp-havg{ display:flex; align-items:baseline; justify-content:flex-end; gap:2px; height:28px; border-left:1px solid ${W(9)}; padding-left:4px; }
${P} .tt-rp-havg span{ align-self:center; font-family:${MONO}; font-weight:700; font-size:10.5px; color:var(--text); font-variant-numeric:tabular-nums; }
${P} .tt-rp-havg .tt-rp-hdash{ font-weight:400; font-size:11px; color:var(--text-label); }
${P} .tt-rp-hfield{ margin-top:8px; padding-top:8px; border-top:1px solid ${W(7)}; align-items:center; }
${P} .tt-rp-hfl{ padding-left:4px; ${caps} white-space:nowrap; }
${P} .tt-rp-hfc{ text-align:center; font-family:${MONO}; font-weight:500; font-size:11px; color:var(--text-label); }
${P} .tt-rp-hfa{ display:flex; align-items:center; justify-content:flex-end; height:100%; padding-right:4px; padding-left:10px; border-left:1px solid ${W(9)}; font-family:${MONO}; font-weight:500; font-size:11px; color:var(--text-label); font-variant-numeric:tabular-nums; }
${P} .tt-rp-ftip{ position:fixed; z-index:999; max-width:min(320px, 92vw); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:var(--selected); border:1px solid ${W(16)}; border-radius:8px; padding:6px 10px; font-family:${MONO}; font-size:10.5px; font-weight:600; letter-spacing:0.02em; color:var(--tt-tip-text); box-shadow:var(--tt-shadow-tip); pointer-events:none; }
${P} .tt-rp-h2hwrap{ margin-top:14px; }
${P} .tt-rp-h2h{ background:var(--card); border:1.25px solid ${W(6)}; border-radius:16px; padding:30px 44px 22px; }
${P} .tt-rp-h2hhead{ display:flex; align-items:center; justify-content:space-between; gap:20px; padding-bottom:22px; border-bottom:1px solid ${W(10)}; }
${P} .tt-rp-h2hside{ display:flex; align-items:center; gap:10px; min-width:0; }
${P} .tt-rp-h2hside.r{ justify-content:flex-end; text-align:right; }
${P} .tt-rp-h2hname{ font-size:20px; font-weight:800; letter-spacing:-0.01em; }
${P} .tt-rp-hhrow{ display:grid; grid-template-columns:86px minmax(0,1fr) 86px; gap:22px; align-items:center; padding:15px 0; }
${P} .tt-rp-hhfig{ font-family:${MONO}; font-size:18px; }
${P} .tt-rp-hhfig.r{ text-align:right; }
${P} .tt-rp-hhmid{ display:flex; flex-direction:column; gap:9px; }
${P} .tt-rp-hhlabel{ text-align:center; font-size:13px; color:var(--text-soft); }
${P} .tt-rp-hhline{ position:relative; height:4px; border-radius:2px; background:${W(6)}; }
${P} .tt-rp-hhlead{ position:absolute; top:0; bottom:0; border-radius:2px; }
${P} .tt-rp-hhtick{ position:absolute; left:50%; top:-4px; width:2px; height:12px; margin-left:-1px; background:var(--text); }
${P} .tt-rp-h2hfoot{ margin-top:10px; padding-top:20px; border-top:1px solid ${W(10)}; display:flex; align-items:center; justify-content:space-between; gap:14px 24px; flex-wrap:wrap; }
${P} .tt-rp-h2hleft{ min-width:0; flex:1 1 280px; }
${P} .tt-rp-h2hctx{ font-size:13.5px; font-weight:700; color:var(--text); }
${P} .tt-rp-h2hnote{ font-size:12.5px; color:var(--text-label); margin-top:4px; line-height:1.5; }
${P} .tt-rp-full{ flex:none; display:inline-flex; align-items:center; gap:8px; height:38px; padding:0 16px; border-radius:9px; background:var(--tt-blue); color:var(--tt-white); font-size:13px; font-weight:700; white-space:nowrap; text-decoration:none; }
${P} .tt-rp-full:hover{ background:var(--tt-blue-btn); color:var(--tt-white); }
${P} .tt-rp-scrim{ position:fixed; inset:0; z-index:90; background:var(--tt-scrim); display:flex; align-items:flex-start; justify-content:center; overflow-y:auto; padding:40px 22px 60px; }
${P} .tt-rp-sheet{ width:100%; max-width:640px; background:var(--selected); border:1px solid ${W(16)}; border-radius:14px; box-shadow:var(--tt-shadow-overlay); overflow:hidden; }
${P} .tt-rp-shead{ display:flex; align-items:flex-start; gap:14px; padding:20px 22px 16px; border-bottom:1px solid ${W(8)}; }
${P} .tt-rp-stitle{ display:block; font-size:17px; font-weight:800; letter-spacing:-0.01em; }
${P} .tt-rp-smeta{ display:block; margin-top:7px; font-family:${MONO}; font-size:11px; letter-spacing:0.06em; color:var(--text-label); }
${P} .tt-rp-sclose{ flex:none; display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:9px; background:${W(5)}; border:1px solid ${W(9)}; color:var(--text-label); cursor:pointer; font-family:${MONO}; font-size:13px; }
${P} .tt-rp-sclose:hover{ color:var(--text); }
${P} .tt-rp-scols{ display:grid; grid-template-columns:minmax(0,1fr) 88px 88px; gap:12px; padding:12px 22px 10px; border-bottom:1px solid ${W(6)}; }
${P} .tt-rp-scap{ font-family:'Hanken Grotesk',sans-serif; ${caps} }
${P} .tt-rp-scap.r{ text-align:right; }
${P} .tt-rp-sbody{ padding:2px 22px 20px; }
${P} .tt-rp-srow{ display:grid; grid-template-columns:minmax(0,1fr) 88px 88px; gap:12px; padding:11px 0; border-bottom:1px solid ${W(5)}; }
${P} .tt-rp-slabel{ font-size:13px; font-weight:600; color:var(--text-soft); }
${P} .tt-rp-sv{ text-align:right; font-family:${MONO}; font-size:13.5px; font-weight:500; font-variant-numeric:tabular-nums; color:var(--text-label); }
${P} .tt-rp-sv.better{ font-weight:700; color:var(--text); }
`;

  root.TTReports = { render, _internals: { build, act, viewHtml: (M, av) => viewHtml(M, av), setModel: M => { model = M; }, state: S, reset: resetPicks,
    fmt, fmtCell, fmtAvg, surname, dna52, METRICS, HELP, CSS } };
})();
