await new Promise(r => setTimeout(r, 4000));
const result = await E(`(async () => {
  const bi = await fetch('./build-info.json?t=' + Date.now()).then(r => r.json()).catch(() => null);
  await sfDbJoinLoad();
  if (typeof loadPlayerProfiles === 'function' && !Object.keys(playerProfiles || {}).length) await loadPlayerProfiles().catch(() => null);
  const idx = await loadCareerHistoryIndex();
  const db = _sfDbJoin, J = window.H2HPage.priceJoin;
  const nameOf = k => (playerProfiles && playerProfiles[k] && playerProfiles[k].name) || (idx[k] && (idx[k].name || idx[k].n)) || '';
  let priced = 0, rows = 0, meRows = 0, meMiss = 0; const two = [];
  for (const k of Object.keys(idx || {})) { const career = await loadCareerHistory(k).catch(() => null), name = nameOf(k);
    if (!Array.isArray(career) || !career.length || !name) continue;
    const cl = await fhLoadCloses(k).catch(() => null), ms = await meLoadProfileShard(k);
    const sel = career.filter(x => x && !x.walkover);
    const js = sel.map(x => ({ date: x.date, won: !!x.won, round: null, opp: x.opponent }));
    J(js, { full: name }, null, db, null, career);
    js.forEach((x, i) => { rows++; if (x.price != null) priced++;
      if ((k === '1094' && sel[i].date === '2006-05-29') || (k === '2845' && sel[i].date === '2007-04-15')) two.push([name, sel[i].date, sel[i].opponent, x.price, x.oppPrice, x.book]); });
    if (ms && ms.matches && ms.matches.length) meWinnerRows(ms, meRowsFor(career, cl, k, name), k, name).forEach(r => { meRows++; if (r.tournRaw == null) meMiss++; });
  }
  const mj = await fetch('./matches.json?t=' + Date.now()).then(r => r.json()).catch(() => null);
  const cards = Array.isArray(mj) ? mj : (mj && mj.matches) || [];
  const q = { cards: cards.length, qualifyingBool: cards.filter(c => typeof c.qualifying === 'boolean').length, qualifyingTrue: cards.filter(c => c.qualifying === true).length, round: cards.filter(c => c.tournamentRound).length };
  return { q, commit: bi && bi.commit, data: bi && bi.data, aliases: Object.keys(db.aliases || {}).length, delPotro: (db.aliases || {})['Del Potro J.M.'], rows, priced, meRows, meMiss, two };
})()`).catch(e => fail('probe threw: ' + e.message));
ch.kill('SIGKILL'); if (!LIVE) server.close();
console.log('### v000 ' + JSON.stringify(result));
process.exit(0);
