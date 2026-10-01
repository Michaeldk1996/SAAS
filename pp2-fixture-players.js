// TEN-371 — the pre-publish gate's fixture players, by api-tennis player key.
//
// tools/test-pp2-reconcile.js looks these players up by KEY with no stand-in
// (founder ruling 2026-10-01), so the pipeline must guarantee each one has a
// current profile in every build: bsp-pipeline.js builds them first and outside
// the per-run build budget. One list, read by both, so the two cannot drift.
'use strict';
module.exports = Object.freeze({
  alcaraz: '2382',
  zverev: '1980',
  djokovic: '1905',
  schwartzman: '67',
});
