// Test helper (Match analysis rebuild 2026-11-23): returns the source of match-analysis-v2.js ready to be pasted into a
// test's `new Function` scope next to the sliced dashboard functions, so the rebuilt renderers resolve the live data layer
// lexically. The IIFE writes to `__MA2_ROOT` (an object the test passes in) instead of window, and `expose` lists the
// IIFE-local renderers (formBox, h2Price, …) the test reads — they are added to `__MA2_ROOT.__t`. Mutant runners point
// MA2_FILE (or the env var the caller names) at a mutated copy.
const fs = require('fs'), path = require('path');
function ma2Src(file, expose) {
  const src = fs.readFileSync(file || process.env.MA2_FILE || path.join(__dirname, '..', 'match-analysis-v2.js'), 'utf8');
  const tail = '})(typeof window !== \'undefined\' ? window : globalThis);';
  if (src.split(tail).length !== 2) throw new Error('ma2-test-load: the IIFE tail moved');
  const ex = (expose || []).length ? '  __MA2_ROOT.__t = { ' + expose.join(', ') + ' };\n' : '';
  return src.replace(tail, ex + '})(__MA2_ROOT);');
}
module.exports = { ma2Src };
