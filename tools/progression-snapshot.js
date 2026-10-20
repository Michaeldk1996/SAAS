// Prints buildTournamentProgression output for pinned fixtures (ruling 3 before/after proof). Usage:
//   node tools/progression-snapshot.js <repo-root-to-load-bsp-pipeline-from> <fixtures.json>
const path = require('path');
const [root, fx] = process.argv.slice(2);
const FIX = require(path.resolve(fx)).fixtures;
process.env.API_TENNIS_KEY = process.env.API_TENNIS_KEY || 'snapshot';
global.fetch = async () => ({ json: async () => ({ success: 1, result: JSON.parse(JSON.stringify(FIX)) }) });
const P = require(path.join(path.resolve(root), 'bsp-pipeline.js'));
(async () => {
  const out = {};
  for (const t of ['ATP Almaty', 'ATP Brussels', 'ATP Lyon', 'ATP Estoril']) out[t] = await P.buildTournamentProgression(t);
  process.stdout.write(JSON.stringify(out));
})();
