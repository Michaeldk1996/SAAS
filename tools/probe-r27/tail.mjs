await new Promise(r => setTimeout(r, 4000));
const result = await E(`(async () => {
  await sfDbJoinLoad();
  if (typeof loadPlayerProfiles === 'function' && !Object.keys(playerProfiles || {}).length) await loadPlayerProfiles().catch(() => null);
  const idx = await loadCareerHistoryIndex();
  const db = _sfDbJoin, J = window.H2HPage.priceJoin;
  const nameOf = k => (playerProfiles && playerProfiles[k] && playerProfiles[k].name) || (idx[k] && (idx[k].name || idx[k].n)) || '';
  const dn = s => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / 864e5;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[-'.]/g, ' ').replace(/\\s+/g, ' ').trim();
  const lvl = x => { const q = !!x.qualifying || /qualif/i.test(String(x.round || '')); return (x.level === 'atp' ? 'ATP' : x.level === 'chitf' || x.level === 'ch' ? 'Challenger/ITF' : String(x.level || '?')) + (q ? ' qualifying' : ' main draw'); };
  const ME = { rows: 0, miss: [] };
  const B = { capRows: 0, byLevel: {}, ex: [] };
  const bump = (L, k) => { const o = B.byLevel[L] = B.byLevel[L] || { rows: 0, joinedBefore: 0, joinedAfter: 0, shownBefore: 0, shownAfter: 0, master: 0 }; o[k]++; };
  const keys = Object.keys(idx || {});
  for (const k of keys) {
    const career = await loadCareerHistory(k).catch(() => null), name = nameOf(k);
    if (!Array.isArray(career) || !career.length || !name) continue;
    const cl = await fhLoadCloses(k).catch(() => null);
    // --- Market edge rows with no career match: full detail + nearby career rows
    const ms = await meLoadProfileShard(k);
    if (ms && ms.matches && ms.matches.length) {
      const w = meWinnerRows(ms, meRowsFor(career, cl, k, name), k, name);
      for (const r of w) { ME.rows++; if (r.tournRaw != null) continue;
        const d0 = dn(r.date);
        const near = career.filter(x => !x.walkover && !!x.won === !!r.won && dn(x.date) - d0 >= -16 && dn(x.date) - d0 <= 3)
          .map(x => [x.date, x.opponent, x.oppKey != null ? String(x.oppKey) : null, x.round, x.tournament]);
        const tdRow = cl && (cl.rows || []).find(x => x.date === r.date && x.opp === r.opp);
        ME.miss.push([k, name, r.date, r.opp, r.won ? 1 : 0, r.tourn, tdRow ? tdRow.oppKey : 'no-td-row', near]); }
    }
    // --- Bet365 captures with no event key: does a career row pick it today, and after the key repair?
    if (!cl || !cl.cap) continue;
    const bcaps = cl.cap.filter(c => c.B && c.ek == null);
    for (const c of bcaps) {
      B.capRows++;
      const cand = career.filter(x => !x.walkover && x.oppKey != null && String(x.oppKey) === c.oppKey && x.eventKey != null && Math.abs(dn(x.date) - dn(c.date)) <= 1);
      const L = cand.length === 1 ? lvl(cand[0]) : cand.length ? 'ambiguous' : 'no keyed career row';
      bump(L, 'rows');
      if (cand.length !== 1) continue;
      const x = cand[0];
      if (sfMasterClass(x)) bump(L, 'master');
      const pick0 = fhCloseFor(cl, x.date, x.opponent, x.won, x.oppKey, x.eventKey);
      const usesIt = p => p && p.book === 'B' && p.src === 'cap' && p.price === c.B[0];
      const capJoined = (cc) => { const pool = cc.filter(y => y.B); const e = String(x.eventKey); const byEk = pool.filter(y => y.ek === e);
        const hits = byEk.length ? byEk : pool.filter(y => y.oppKey === String(x.oppKey) && Math.abs(dn(y.date) - dn(x.date)) <= 1 && !(y.ek && y.ek !== e)); return hits.length === 1 && hits[0] === (cc === cl.cap ? c : cc.__c); };
      if (capJoined(cl.cap)) bump(L, 'joinedBefore');
      if (usesIt(pick0)) bump(L, 'shownBefore');
      const saved = c.ek; c.ek = String(x.eventKey);
      const pick1 = fhCloseFor(cl, x.date, x.opponent, x.won, x.oppKey, x.eventKey);
      const cc = cl.cap; cc.__c = c; if (capJoined(cc)) bump(L, 'joinedAfter'); c.ek = saved;
      if (usesIt(pick1)) bump(L, 'shownAfter');
      if (B.ex.length < 12 && !capJoined(cl.cap)) B.ex.push([k, name, c.date, c.oppKey, x.date, x.opponent, x.round]);
    }
  }
  // --- the two pre-2010 same-day misses
  const two = [];
  for (const [k, d, opp] of [[null, '2006', 'Wang'], [null, '2007', 'Stepanek']]) {}
  const sur = s => norm(s).split(' ')[0];
  const find = (who, opp, yr) => { const out = []; db.names.forEach((nm, i) => { if (!nm) return; const a = sur(nm[0]), b = sur(nm[1]);
    if ([a, b].includes(who) && [a, b].includes(opp) && String(db.rows[i][0]).startsWith(yr)) out.push([db.rows[i], nm, db.meta.rounds && db.meta.rounds[db.rows[i][3]], db.meta.tournaments ? db.meta.tournaments[db.rows[i][1]] : db.rows[i][1]]); }); return out; };
  for (const [k, yr, opp, me] of [['', '2006', 'wang', 'gasquet'], ['', '2007', 'stepanek', 'monfils']]) {
    const key = Object.keys(idx).find(q => norm(nameOf(q)).endsWith(me));
    const career = key ? await loadCareerHistory(key).catch(() => null) : null;
    const rows = (career || []).filter(x => String(x.date).startsWith(yr) && norm(x.opponent).includes(opp)).map(x => [x.date, x.opponent, x.oppKey, x.round, x.tournament, x.won]);
    two.push({ me, key, name: key && nameOf(key), career: rows, db: find(me, opp, yr), aliases: db.aliases ? Object.entries(db.aliases).filter(([a]) => norm(a).includes(opp)) : null });
  }
  return { me: ME, b365: B, two, dbMetaKeys: Object.keys(db.meta || {}) };
})()`).catch(e => fail('probe threw: ' + e.message));
ch.kill('SIGKILL'); if (!LIVE) server.close();
const s = JSON.stringify(result);
for (let i = 0; i < s.length; i += 20000) console.log('### v' + String(i / 20000).padStart(3, '0') + ' ' + s.slice(i, i + 20000));
process.exit(0);
