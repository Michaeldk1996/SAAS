const result = await E(`(async () => {
  await sfDbJoinLoad();
  if (typeof loadPlayerProfiles === 'function' && !Object.keys(playerProfiles || {}).length) await loadPlayerProfiles().catch(() => null);
  const idx = await loadCareerHistoryIndex();
  const db = _sfDbJoin, J = window.H2HPage.priceJoin;
  const nameOf = k => (playerProfiles && playerProfiles[k] && playerProfiles[k].name) || (idx[k] && (idx[k].name || idx[k].n)) || '';
  const dn = s => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / 864e5;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/-/g, ' ');
  const ourSur = n => norm(n).replace(/^([a-z]{1,3}\\.\\s*)+/, '').trim().split(/\\s+/)[0];
  const tdSur = n => norm(n).trim().split(/\\s+/)[0];
  // --- 1. the 9 started matches, read back from every side we hold
  const want = [['2012-06-17','2167','Nalbandian',true],['2019-05-16','430','Kyrgios',true],['2019-05-16','2984','Ruud',false],
    ['2019-09-08','1093','Nadal',false],['2020-09-06','434','Djokovic',true],['2020-09-06','1905','Carreno',false],
    ['2021-04-21','1091','Zapata',false],['2023-05-24','1759','Ymer',true],['2023-05-24','1976','Fils',false],
    ['2024-03-01','1895','Rublev',true],['2024-03-01','2847','Bublik',false],['2024-08-02','2973','Shapovalov',true],['2024-08-02','431','Shelton',false],
    ['2026-10-05','1093','Djokovic',false]];
  const back = [];
  for (const [d, k, opp, won] of want) {
    const career = await loadCareerHistory(k).catch(() => null), name = nameOf(k);
    const cl = await fhLoadCloses(k).catch(() => null);
    const rows = (career || []).filter(x => { const dd = dn(x.date) - dn(d); return dd >= -16 && dd <= 3 && !!x.won === won && new RegExp(opp, 'i').test(x.opponent || ''); });
    const js = rows.map(x => ({ date: x.date, won: !!x.won, round: null, opp: x.opponent }));
    J(js, { full: name }, null, db, null, career);
    const tab = rows.map(x => { try { const t = meRowFromCareer(x, cl, k, name, career.indexOf(x)); return [t.price, t.oppPrice, t.price != null ? fhSrcTitle(t) : null]; } catch (e) { return 'err ' + e.message; } });
    back.push({ td: d, k, name, opp, rows: rows.map(x => [x.date, x.opponent, x.round, x.tournament, x.eventKey != null ? 'keyed' : 'archive']), join: js.map(x => [x.price, x.oppPrice, x.book]), tab });
  }
  // --- 2. where the start-dated convention breaks a join: every ATP main-draw played career row of every player
  const sur = new Map();   // surname -> [db row index]
  db.names.forEach((nm, i) => { if (!nm) return; for (const n of nm) { const s = tdSur(n); if (!sur.has(s)) sur.set(s, []); sur.get(s).push(i); } });
  const rowDay = i => { const v = db.rows[i][0]; return Date.UTC(Math.floor(v / 10000), Math.floor(v / 100) % 100 - 1, v % 100) / 864e5; };
  const A = { players: 0, rows: { archive: 0, keyed: 0 }, priced: { archive: 0, keyed: 0 }, unpricedWithCand: { archive: 0, keyed: 0 },
    candOffset: {}, ex: [], me: { rows: 0, noCareer: { pre2021: 0, from2021: 0 }, tot: { pre2021: 0, from2021: 0 }, ex: [] } };
  const keys = Object.keys(idx || {});
  for (const k of keys) {
    const career = await loadCareerHistory(k).catch(() => null), name = nameOf(k);
    if (!Array.isArray(career) || !career.length || !name) continue;
    A.players++;
    const sel = career.filter(x => x && x.level === 'atp' && !x.walkover && !x.qualifying && !/^qualif/i.test(String(x.round || '')));
    const js = sel.map(x => ({ date: x.date, won: !!x.won, round: null, opp: x.opponent }));
    J(js, { full: name }, null, db, null, career);
    const me = ourSur(name);
    sel.forEach((x, i) => {
      const kind = x.eventKey != null ? 'keyed' : 'archive';
      A.rows[kind]++;
      if (js[i].price != null) { A.priced[kind]++; return; }
      const o = ourSur(x.opponent), d0 = dn(x.date);
      const c = (sur.get(o) || []).filter(j => { const nm = db.names[j]; const mine = x.won ? nm[0] : nm[1], theirs = x.won ? nm[1] : nm[0];
        const dd = rowDay(j) - d0; return tdSur(mine) === me && tdSur(theirs) === o && dd >= -20 && dd <= 30; });
      if (!c.length) return;
      A.unpricedWithCand[kind]++;
      const off = Math.round(rowDay(c[0]) - d0), b = off < -3 ? '<-3' : off > 16 ? '>16' : off < -1 || off > 1 ? 'in-window(' + (off < 0 ? '-' : '+') + ')' : '±1';
      const key = kind + ' ' + b; A.candOffset[key] = (A.candOffset[key] || 0) + 1;
      if (A.ex.length < 60) A.ex.push([kind, name, x.date, x.opponent, x.round, x.tournament, off, db.meta.rounds[db.rows[c[0]][3]], c.length]);
    });
    const ms = await meLoadProfileShard(k);
    if (ms && ms.matches && ms.matches.length) {
      const cl = await fhLoadCloses(k).catch(() => null);
      const w = meWinnerRows(ms, meRowsFor(career, cl, k, name), k, name);
      for (const r of w) { const b = String(r.date) < '2021' ? 'pre2021' : 'from2021'; A.me.tot[b]++; A.me.rows++;
        if (r.tournRaw == null) { A.me.noCareer[b]++; if (A.me.ex.length < 30) A.me.ex.push([name, r.date, r.opp, r.tourn]); } }
    }
  }
  return { started: db.meta && db.meta.started, back, audit: A };
})()`).catch(e => fail('probe threw: ' + e.message));
ch.kill('SIGKILL'); if (!LIVE) server.close();
console.log('### v ' + JSON.stringify(result));
process.exit(0);
