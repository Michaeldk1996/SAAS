'use strict';
// fetch-edition.js <tournament_key> <season> <out.json> — one api-tennis get_fixtures call: every ATP-singles
// (event_type_key 265) fixture of one tournament_key over its whole season, slimmed (no statistics / point-by-point /
// scores / logos). Exit 1 on any failure, so the builder dashes the event instead of resolving a partial edition.
const fs = require('fs');
const [,, tk, season, out] = process.argv;
const KEY = process.env.API_TENNIS_KEY;
if (!KEY || !tk || !season || !out) { console.error('usage: API_TENNIS_KEY=… node fetch-edition.js <tournament_key> <season> <out.json>'); process.exit(1); }
(async () => {
  const url = `https://api.api-tennis.com/tennis/?method=get_fixtures&event_type_key=265&tournament_key=${encodeURIComponent(tk)}&date_start=${season}-01-01&date_stop=${season}-12-31&APIkey=${KEY}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      const j = await res.json();
      if (String(j.success) !== '1' && !Array.isArray(j.result)) throw new Error('api-tennis answered without success');
      const result = (j.result || []).map((f) => { const { statistics, pointbypoint, scores, event_first_player_logo, event_second_player_logo, ...rest } = f; return rest; });
      const tmp = out + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify({ tournamentKey: Number(tk), season: Number(season), fetchedAt: new Date().toISOString(), result }));
      fs.renameSync(tmp, out);
      console.error(`  fixtures ${tk}/${season}: ${result.length}`);
      return;
    } catch (e) {
      console.error(`  fixtures ${tk}/${season} attempt ${attempt}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  process.exit(1);
})();
