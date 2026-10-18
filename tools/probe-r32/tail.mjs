await new Promise(r => setTimeout(r, 4000));
const result = await E(`(async () => {
  await sfDbJoinLoad();
  if (typeof loadPlayerProfiles === 'function' && !Object.keys(playerProfiles || {}).length) await loadPlayerProfiles().catch(() => null);
  const idx = await loadCareerHistoryIndex();
  const nameOf = k => (playerProfiles && playerProfiles[k] && playerProfiles[k].name) || (idx[k] && (idx[k].name || idx[k].n)) || '';
  const dn = s => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / 864e5;
  const cause = {}, ex = {}, perPlayer = {}; let total = 0;
  const add = (c, e) => { cause[c] = (cause[c] || 0) + 1; (ex[c] = ex[c] || []).length < 8 && ex[c].push(e); };
  let p1056 = null;
  for (const k of Object.keys(idx || {})) {
    const career = await loadCareerHistory(k).catch(() => null), name = nameOf(k);
    if (!Array.isArray(career) || !career.length || !name) continue;
    const ms = await meLoadProfileShard(k); if (!ms || !ms.matches || !ms.matches.length) continue;
    const cl = await fhLoadCloses(k).catch(() => null);
    const rows = meRowsFor(career, cl, k, name), w = meWinnerRows(ms, rows, k, name);
    const last = career.reduce((a, x) => (x.date > a ? x.date : a), '');
    if (k === '1056') { const ys = {}; career.forEach(x => { const y = String(x.date).slice(0, 4); ys[y] = ys[y] || { n: 0, src: {} }; ys[y].n++; ys[y].src[x.src || (x.eventKey != null ? 'fixtures' : 'archive')] = (ys[y].src[x.src || (x.eventKey != null ? 'fixtures' : 'archive')] || 0) + 1; });
      const ym = {}; ms.matches.forEach(x => { const y = String(x.date).slice(0, 4); ym[y] = (ym[y] || 0) + 1; });
      p1056 = { name, profile: playerProfiles && playerProfiles[k] ? { country: playerProfiles[k].country, age: playerProfiles[k].age } : null, careerRows: career.length, careerByYear: ys, marketEdgeByYear: ym, idx: idx[k] }; }
    for (const r of w) { if (r.tournRaw != null) continue; total++; perPlayer[k + ' ' + name] = (perPlayer[k + ' ' + name] || 0) + 1;
      const d0 = dn(r.date), e = [k, name, r.date, r.opp, r.won ? 'W' : 'L', r.tourn];
      if (r.date > last) { add('played after the career history\\'s last match (' + 'not yet in career-history)', e); continue; }
      const near = career.filter(x => !x.walkover && dn(x.date) - d0 >= -16 && dn(x.date) - d0 <= 3);
      const sameRes = near.filter(x => !!x.won === !!r.won);
      const nk = fhNameKey(r.opp);
      const byName = sameRes.filter(x => { const a = fhNameKey(x.opponent); return a === nk || (a.length >= 4 && nk.length >= 4 && (a.startsWith(nk) || nk.startsWith(a))); });
      if (byName.length > 1) { add('two or more career rows fit (two meetings at one event / same name)', e.concat([byName.map(x => x.date + ' ' + x.round)])); continue; }
      if (byName.length === 1) { const c = byName[0]; const claimed = rows.some(x => x !== c && x.tdKey && x.tdKey === r.date + '|' + r.opp + '|' + (r.won ? 1 : 0));
        add(claimed ? 'the career row was claimed by another Tennis-Data row (two claimants)' : 'career row fits but did not join (outside the closes window / closes row missing)', e.concat([[c.date, c.opponent, c.round, c.tournament]])); continue; }
      const otherRes = near.filter(x => !!x.won !== !!r.won && fhNameKey(x.opponent) === nk);
      if (otherRes.length) { add('career row has the opposite result', e.concat([otherRes.map(x => x.date + ' ' + x.result)])); continue; }
      if (!near.length) { add('no career row at all in the event window (match missing from career-history)', e); continue; }
      add('career rows nearby but none with this opponent (match missing, or the opponent spelled another way)', e.concat([near.slice(0, 4).map(x => x.date + ' ' + x.opponent)]));
    }
  }
  return { total, cause, ex, perPlayer: Object.entries(perPlayer).sort((a, b) => b[1] - a[1]).slice(0, 15), p1056 };
})()`).catch(e => fail('probe threw: ' + e.message));
ch.kill('SIGKILL'); if (!LIVE) server.close();
const s = JSON.stringify(result);
for (let i = 0; i < s.length; i += 20000) console.log('### v' + String(i / 20000).padStart(3, '0') + ' ' + s.slice(i, i + 20000));
process.exit(0);
