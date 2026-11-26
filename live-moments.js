/* Live page key moments — ONE implementation, run by the page (live-page renderer, <script src>) and by the live poller
 * (supabase/functions/live-poller, a byte-identical copy imported for its side effect). Founder 2026-11-26 (option B):
 * the poller writes each live match's major moments into the live feed, so every card lists them without the page
 * loading every point log; the match view decodes the same log with the same code. Pure: no I/O, no DOM.
 *
 *   LiveMoments.ctxOf(fixture)          -> { sets, serving, bo, nSets }   (an api-tennis livescore row)
 *   LiveMoments.build(ctx, pointbypoint, { bpSavedMajor }) -> { P, gCells, gw, ml }   (ml = game moments, newest first)
 *   LiveMoments.feedMoments(fixture, opts) -> the major game moments, compact, for the feed
 *
 * Rules (.claude/rules/live.md): a moment is a service game with a break point; it is named for the player who did it
 * and carries the score when that game started; major (reaches the card) = a break of serve or bpSavedMajor+ break
 * points saved in one game (founder 2026-11-26: 2). The point log is read as received: a garbled tail keeps its
 * reachable prefix, then walks to the winner's game point; a break point is read off the score, never the feed's flag.
 */
(function (root) {
  'use strict';
  const EN = '–', D = '—';
  // founder 2026-11-26: 2+ break points saved in one game is a major moment (was the prototype's 3)
  const BP_SAVED_MAJOR = 2;
  const SLAM_RE = /australian open|roland garros|french open|wimbledon|us open/i;
  const setNo = s => +String(s || '').replace(/[^0-9]/g, '') || 0;
  function parseSets(f) {
    const sc = Array.isArray(f.scores) ? f.scores.slice().sort((a, b) => setNo(a.score_set) - setNo(b.score_set)) : [];
    const g = v => { const m = /^(\d+)/.exec(String(v == null ? '' : v)); return m ? +m[1] : 0; };
    const sets = sc.map(s => [g(s.score_first), g(s.score_second)]);
    return sets.length ? sets : [[0, 0]];
  }
  // a Grand Slam main draw is best of five; everything else (Slam qualifying, Challengers) best of three
  function bestOf(f) {
    const isChal = /challenger/i.test(String(f.event_type_type || ''));
    const qual = /true|1/i.test(String(f.event_qualification || ''));
    return !isChal && !qual && SLAM_RE.test(String(f.tournament_name || '')) ? 5 : 3;
  }
  const setDone = st => (Math.max(st[0], st[1]) >= 6 && Math.abs(st[0] - st[1]) >= 2) || (Math.max(st[0], st[1]) === 7 && Math.min(st[0], st[1]) >= 5);
  function ctxOf(f) {
    const sets = parseSets(f), bo = bestOf(f), sv = String(f.event_serve || '');
    // the feed can keep a finished set as the last entry for a poll or two after it ends (measured: "6–4", status
    // "Set 1", the point score already in set 2): a decided set is never the set in play, so the next one starts at 0–0
    const wonBy = s => sets.filter(st => setDone(st) && st[s] > st[1 - s]).length, need = bo === 5 ? 3 : 2;
    if (setDone(sets[sets.length - 1]) && wonBy(0) < need && wonBy(1) < need) sets.push([0, 0]);
    return { sets, nSets: sets.length, bo, serving: /first/i.test(sv) ? 0 : /second/i.test(sv) ? 1 : null };
  }

  const PT = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4, 'AD': 4 };
  const ptState = s => { const p = String(s || '').split('-').map(x => PT[x.trim().toUpperCase()]); return p.length === 2 && p[0] != null && p[1] != null ? p : null; };
  // the side a point went to, from one score to the next (0:0 → 15:0 = A; 40:40 → A:40 = A; A:40 → 40:40 = B)
  function stepWinner(a, b) {
    for (const s of [0, 1]) {
      const me = a[s], op = a[1 - s], n = [a[0], a[1]];
      if (me <= 2 && op <= 3) n[s] = me + 1; else if (me === 3 && op === 3) n[s] = 4; else if (me === 3 && op === 4) n[1 - s] = 3; else continue;
      if (n[0] === b[0] && n[1] === b[1]) return s;
    }
    return null;
  }
  // the receiver is one point from the game: he is on 40 with the server on 30 or less, or on advantage
  const bpState = (st, srv) => { if (!st) return false; const r = st[1 - srv], s = st[srv]; return r === 4 || (r === 3 && s <= 2); };
  const side = v => /first/i.test(String(v || '')) ? 0 : /second/i.test(String(v || '')) ? 1 : null;
  const tbRow = g => /tiebreak/i.test(String(g.set_number || '')) || (!(g.points || []).some(p => /15|30|40|A/.test(String(p.score || ''))) && /^\s*\d+\s*-\s*\d+\s*$/.test(String(g.score || '')) && !(g.points || []).length);
  const tbSummary = g => /^\s*(7\s*-\s*6|6\s*-\s*7)\s*$/.test(String(g.score || '')) && !(g.points || []).some(p => /15|30|40|A/.test(String(p.score || '')));
  const decided = g => g.serve_winner != null || g.serve_lost != null;

  function build(m, raw, opts) {
    const P = [], gCells = [], gw = {};
    const bySet = {};
    (Array.isArray(raw) ? raw : []).forEach(g => { const n = setNo(g.set_number) || 1; (bySet[n] = bySet[n] || []).push(g); });
    Object.keys(bySet).map(Number).sort((a, b) => a - b).forEach(n => {
      const si = n - 1, list = bySet[n].slice().sort((a, b) => (+a.number_game || 0) - (+b.number_game || 0));
      gw[si] = gw[si] || [0, 0];
      const games = list.filter(g => !tbRow(g) && !tbSummary(g));
      const tbs = list.filter(g => tbRow(g)).map(g => ({ g, sc: /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(g.score || '')) })).filter(x => x.sc)
        .map(x => ({ g: x.g, a: +x.sc[1], b: +x.sc[2] })).sort((x, y) => (x.a + x.b) - (y.a + y.b));
      games.forEach(g => {
        const done = decided(g);
        const srv = side(g.player_served); if (srv == null && done) return;
        const winner = done ? (g.serve_winner != null ? side(g.serve_winner) : (side(g.serve_lost) === 0 ? 1 : 0)) : null;
        const chips = (g.points || []).map(p => ({ p, st: ptState(p.score) })).filter(x => x.st);
        // the feed's garbled tails: keep the reachable prefix, then walk to the winner's game point
        const kept = []; let prev = [0, 0], i = 0;
        if (chips.length && stepWinner(prev, chips[0].st) == null) { prev = chips[0].st; kept.push(chips[0]); i = 1; }
        while (i < chips.length && stepWinner(prev, chips[i].st) != null) { prev = chips[i].st; kept.push(chips[i]); i++; }
        const gp = st => { if (winner == null) return true; const me = st[winner], op = st[1 - winner]; return me === 4 || (me === 3 && op <= 2); };
        for (; i < chips.length && !gp(prev); i++) if (stepWinner(prev, chips[i].st) != null) { prev = chips[i].st; kept.push(chips[i]); }
        const sIdx = srv == null ? (m.serving == null ? 0 : m.serving) : srv, ga = gw[si][0], gb = gw[si][1], start = P.length;
        let pre = [0, 0], bp = 0;
        const pushPt = (w, isBp) => { if (isBp) bp++;
          const after = done && P.length - start === kept.length ? (ga + (winner === 0 ? 1 : 0)) + EN + (gb + (winner === 1 ? 1 : 0)) : ga + EN + gb;
          P.push({ g: gCells.length, bp: isBp, sw: w === sIdx, as: sIdx === 0, aWon: w === 0, si, gs: after }); };
        kept.forEach(x => { const w = stepWinner(pre, x.st); pushPt(w, bpState(pre, sIdx)); pre = x.st; });
        if (done) pushPt(winner, bpState(pre, sIdx));
        const cell = { gi: gCells.length, g0: [ga, gb], aServ: sIdx === 0, brk: done ? winner !== sIdx : false, bp, start, end: P.length, si, part: !done };
        if (done) gw[si][winner]++;
        cell.gs = gw[si][0] + EN + gw[si][1];
        gCells.push(cell);
      });
      if (tbs.length) {
        const start = P.length; let prev = [0, 0];
        tbs.forEach(t => { const w = t.a > prev[0] ? 0 : t.b > prev[1] ? 1 : null; const s = side(t.g.player_served);
          if (w != null) P.push({ g: gCells.length, bp: false, sw: s == null ? null : w === s, as: s === 0, aWon: w === 0, si, gs: gw[si][0] + EN + gw[si][1], tb: true });
          prev = [t.a, t.b]; });
        const last = tbs[tbs.length - 1], over = Math.max(last.a, last.b) >= 7 && Math.abs(last.a - last.b) >= 2;
        const cell = { gi: gCells.length, g0: gw[si].slice(), aServ: null, brk: false, bp: 0, start, end: P.length, si, tb: true, part: !over };
        if (over) gw[si][last.a > last.b ? 0 : 1]++;
        cell.gs = gw[si][0] + EN + gw[si][1];
        gCells.push(cell);
      }
    });
    return { P, gCells, gw, ml: moments(m, P, gCells, opts) };
  }
  // one line per service game with a break point: the score when that game started, named for the player who did it
  function moments(m, P, gCells, opts) {
    const major = (opts && opts.bpSavedMajor) || BP_SAVED_MAJOR;
    const NW = ['', 'a break point', 'two break points', 'three break points'], needS = m.bo === 5 ? 3 : 2;
    const ml = gCells.filter(c => c.bp > 0 && !c.tb).map(c => {
      const srv = c.aServ ? 0 : 1, ret = 1 - srv, saved = P.slice(c.start, c.end).filter(p => p.bp && p.sw).length;
      const r1 = c.g0[ret] + 1, s1 = c.g0[srv], won = (m.sets || []).slice(0, c.si).filter(st => st[ret] > st[1 - ret]).length, who = c.brk ? ret : srv;
      if (c.part && !c.brk && !saved) return null;
      const t = c.brk ? (r1 >= 6 && r1 - s1 >= 2 ? 'Broke for the set' : r1 >= 5 && r1 > s1 ? (won + 1 >= needS ? 'Broke, serving for match' : 'Broke, serving for set') : 'Broke serve')
        : 'Saved ' + (NW[saved] || saved + ' break points');
      return { key: 'g' + c.gi, ord: c.si * 100 + c.g0[0] + c.g0[1], si: c.si, at: 'S' + (c.si + 1) + ' ' + c.g0[0] + EN + c.g0[1], atFull: 'Set ' + (c.si + 1) + ', at ' + c.g0[0] + EN + c.g0[1],
        t, side: who, tone: null, px: null, brk: c.brk, major: c.brk || saved >= major };
    }).filter(Boolean);
    ml.sort((x, y) => y.ord - x.ord);
    return ml;
  }
  // the feed's copy: major moments only, the fields a card draws
  function feedMoments(f, opts) {
    const pbp = f && f.pointbypoint;
    if (!Array.isArray(pbp) || !pbp.length) return [];
    return build(ctxOf(f), pbp, opts).ml.filter(e => e.major)
      .map(e => ({ key: e.key, ord: e.ord, si: e.si, at: e.at, atFull: e.atFull, t: e.t, side: e.side, brk: e.brk }));
  }

  const API = { BP_SAVED_MAJOR, EN, D, SLAM_RE, setNo, parseSets, bestOf, setDone, ctxOf, ptState, stepWinner, bpState, side, tbRow, tbSummary, decided, build, moments, feedMoments };
  root.LiveMoments = API;
  if (typeof module === 'object' && module && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
