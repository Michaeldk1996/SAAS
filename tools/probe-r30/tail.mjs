await new Promise(r => setTimeout(r, 4000));
const result = await E(`(async () => {
  if (typeof loadPlayerProfiles === 'function' && !Object.keys(playerProfiles || {}).length) await loadPlayerProfiles().catch(() => null);
  const idx = await loadCareerHistoryIndex();
  const nameOf = k => (playerProfiles && playerProfiles[k] && playerProfiles[k].name) || (idx[k] && (idx[k].name || idx[k].n)) || '';
  const pi = typeof playerIndex !== 'undefined' && playerIndex ? playerIndex : null;
  const all = Object.keys(idx || {}).map(k => [k, nameOf(k)]);
  const want = [['federer', '2017-03', 'kyrgios'], ['kyrgios', '2017-03', 'federer'], ['rublev', '2021-02', 'fucsovics'], ['fucsovics', '2021-02', 'rublev'],
    ['rublev', '2025-0', 'monfils'], ['monfils', '2025-0', 'rublev'], ['wawrinka', '2014-01', 'pospisil'], ['pospisil', '2014-01', 'wawrinka']];
  const out = [];
  for (const [me, ym, opp] of want) {
    const ks = all.filter(([k, n]) => String(n).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').endsWith(me));
    for (const [k, n] of ks) {
      const career = await loadCareerHistory(k).catch(() => null);
      const rows = (career || []).filter(x => String(x.date).startsWith(ym) && String(x.opponent || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').includes(opp));
      const prof = await (typeof ensurePlayerProfile === 'function' ? ensurePlayerProfile(k).catch(() => null) : null);
      const p = (playerProfiles && playerProfiles[k]) || prof || null;
      const yr = ym.slice(0, 4), cby = p && p.careerByYear ? (Array.isArray(p.careerByYear) ? p.careerByYear.find(y => String(y.year) === yr) : p.careerByYear[yr]) : null;
      out.push({ me, k, n, rows, careerByYear: cby || null, profileKeys: p ? Object.keys(p).slice(0, 40) : null });
    }
  }
  return out;
})()`).catch(e => fail('probe threw: ' + e.message));
ch.kill('SIGKILL'); if (!LIVE) server.close();
const s = JSON.stringify(result);
for (let i = 0; i < s.length; i += 20000) console.log('### v' + String(i / 20000).padStart(3, '0') + ' ' + s.slice(i, i + 20000));
process.exit(0);
