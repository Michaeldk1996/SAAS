await new Promise(r => setTimeout(r, 4000));
const PATCH = JSON.parse(readFileSync('tools/probe-r28/patch.json', 'utf8'));
const result = await E(`(async () => {
  const P = ${JSON.stringify(PATCH)};
  await sfDbJoinLoad();
  if (typeof loadPlayerProfiles === 'function' && !Object.keys(playerProfiles || {}).length) await loadPlayerProfiles().catch(() => null);
  const idx = await loadCareerHistoryIndex();
  const db = _sfDbJoin, J = window.H2HPage.priceJoin;
  const nameOf = k => (playerProfiles && playerProfiles[k] && playerProfiles[k].name) || (idx[k] && (idx[k].name || idx[k].n)) || '';
  const keys = Object.keys(idx || {});
  const data = [];
  for (const k of keys) { const career = await loadCareerHistory(k).catch(() => null), name = nameOf(k);
    if (!Array.isArray(career) || !career.length || !name) continue;
    data.push({ k, name, career, cl: await fhLoadCloses(k).catch(() => null), ms: await meLoadProfileShard(k) }); }
  const measure = () => { const priced = new Map(), meMiss = new Set(); let meRows = 0, rows = 0;
    for (const { k, name, career, cl, ms } of data) {
      const sel = career.filter(x => x && !x.walkover);
      const js = sel.map(x => ({ date: x.date, won: !!x.won, round: null, opp: x.opponent }));
      J(js, { full: name }, null, db, null, career);
      js.forEach((x, i) => { rows++; if (x.price != null) priced.set(k + '|' + sel[i].date + '|' + sel[i].opponent + '|' + (x.won ? 1 : 0), x.price + '/' + x.oppPrice + '/' + x.book); });
      if (ms && ms.matches && ms.matches.length) { const w = meWinnerRows(ms, meRowsFor(career, cl, k, name), k, name);
        w.forEach(r => { meRows++; if (r.tournRaw == null) meMiss.add(k + '|' + r.date + '|' + r.opp + '|' + (r.won ? 1 : 0)); }); }
    } return { priced, meMiss, meRows, rows }; };
  const A = measure();
  // the new table, built as build-database-yield.js builds it (names the store holds only)
  const held = new Set(); for (const nm of db.names) for (const n of nm || []) held.add(n);
  const prof = playerProfiles || {}, al = {};
  for (const [n, our] of Object.entries(P.page)) if (held.has(n)) al[n] = our;
  for (const [n, kk] of Object.entries(P.keyed)) { if (n.includes(',') || !held.has(n)) continue;
    const our = [prof[kk] && prof[kk].name, P.names[kk]].filter(Boolean); if (al[n]) our.unshift(...[].concat(al[n]));
    const all = [...new Set(our)]; if (all.length) al[n] = all.length === 1 ? all[0] : all; }
  const before = db.aliases; db.aliases = al; delete db._h2hKeys;
  window.eval(P.fn);
  const B = measure();
  const gained = [], lost = [], changed = [];
  for (const [k, v] of B.priced) { if (!A.priced.has(k)) gained.push(k + ' ' + v); else if (A.priced.get(k) !== v) changed.push(k + ' ' + A.priced.get(k) + ' -> ' + v); }
  for (const [k, v] of A.priced) if (!B.priced.has(k)) lost.push(k + ' ' + v);
  const meJoined = [...A.meMiss].filter(x => !B.meMiss.has(x)), meNewMiss = [...B.meMiss].filter(x => !A.meMiss.has(x));
  const aliasDiff = Object.keys(al).filter(n => JSON.stringify(al[n]) !== JSON.stringify(before[n])).map(n => [n, before[n] || null, al[n]]);
  return { rows: A.rows, pricedBefore: A.priced.size, pricedAfter: B.priced.size, gained, lost, changed,
    meRows: A.meRows, meMissBefore: A.meMiss.size, meMissAfter: B.meMiss.size, meJoined: meJoined.length, meNewMiss, meStill: [...B.meMiss].slice(0, 400), aliasDiff };
})()`).catch(e => fail('probe threw: ' + e.message));
ch.kill('SIGKILL'); if (!LIVE) server.close();
const s = JSON.stringify(result);
for (let i = 0; i < s.length; i += 20000) console.log('### v' + String(i / 20000).padStart(3, '0') + ' ' + s.slice(i, i + 20000));
process.exit(0);
