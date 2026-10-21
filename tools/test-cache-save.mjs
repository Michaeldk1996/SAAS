// Founder ruling 2026-10-21 (A2): per-run cache key + explicit, gated save — the fix for the ~290 profiles every run
// re-built once the day's immutable key was taken. Checks the decision rule, the workflow wiring, and the atomic write.
// Run: node tools/test-cache-save.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { execFileSync } from 'child_process';
import { decide, MIN_BUILT, MAX_PER_DAY } from './cache-save-decision.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${d}` : ''}`); } };
console.log('Pipeline caches: per-run key, saved only when worth an entry');

// ── the decision ──
check('the day\'s first run saves (nothing to restore today otherwise)', decide({ stats: { opponentsBuilt: 0 }, todayCount: 0 }).save === true);
check(`a run that built ${MIN_BUILT}+ opponents saves (20 Oct: 286–296 per run were lost)`, decide({ stats: { opponentsBuilt: 291 }, todayCount: 2 }).save === true);
check(`a run that built < ${MIN_BUILT} does not (the steady state: 0–6 a run)`, decide({ stats: { opponentsBuilt: 6 }, todayCount: 1 }).save === false);
check(`safety valve: ${MAX_PER_DAY} entries today → no save, whatever was built`, decide({ stats: { opponentsBuilt: 400 }, todayCount: MAX_PER_DAY }).save === false && /safety valve/.test(decide({ stats: { opponentsBuilt: 400 }, todayCount: MAX_PER_DAY }).reason));
check('an unknown entry count (the API did not answer) never saves blind', decide({ stats: { opponentsBuilt: 400 }, todayCount: NaN }).save === false);
check('no stats file from this run → no save after the first', decide({ stats: null, todayCount: 1 }).save === false);
const cli = (stats, today) => {
  const f = path.join(fs.mkdtempSync(path.join((process.env.TMPDIR || '/tmp'), 'cachesave-')), 's.json');
  if (stats) fs.writeFileSync(f, JSON.stringify(stats));
  return execFileSync('node', [path.join(ROOT, 'tools', 'cache-save-decision.mjs'), '--stats', f, '--today', today], { encoding: 'utf8' });
};
check('CLI prints save=/reason= lines for $GITHUB_OUTPUT', /^save=true\nreason=built 291/m.test(cli({ opponentsBuilt: 291 }, '3')) && /^save=false$/m.test(cli(null, '')));

// ── the workflow ──
const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
const step = (name) => { const i = y.indexOf(`- name: ${name}\n`); if (i < 0) return ''; const j = y.indexOf('\n      - name: ', i + 10); return y.slice(i, j < 0 ? undefined : j); };
const restore = step('Restore pipeline caches'), decideStep = step('Decide whether to save pipeline caches'), save = step('Save pipeline caches');
const KEY = 'bsp-caches-v${{ steps.schema.outputs.v }}-${{ steps.cacheday.outputs.day }}-${{ github.run_id }}-${{ github.run_attempt }}';
check('restore: actions/cache/restore (no implicit end-of-job save) with the per-run key', /uses: actions\/cache\/restore@v4/.test(restore) && restore.includes(`key: ${KEY}`));
check('restore-keys: today\'s newest first, then the schema\'s newest — never another schema', /restore-keys: \|\n\s+bsp-caches-v\$\{\{ steps\.schema\.outputs\.v \}\}-\$\{\{ steps\.cacheday\.outputs\.day \}\}-\n\s+bsp-caches-v\$\{\{ steps\.schema\.outputs\.v \}\}-\n/.test(restore));
check('save: actions/cache/save with the same per-run key, only on success and a "save=true" decision', /uses: actions\/cache\/save@v4/.test(save) && save.includes(`key: ${KEY}`) && save.includes("if: success() && steps.cachesave.outputs.save == 'true'"));
const paths = (s) => (/path: \|\n((?:\s{12}\S.*\n)+)/.exec(s + '\n') || [])[1];
check('restore and save cache the same files (9 paths)', paths(restore) && paths(restore) === paths(save) && paths(restore).trim().split('\n').length === 9, `${paths(restore)} | ${paths(save)}`);
check('the decision counts today\'s entries by key prefix and feeds tools/cache-save-decision.mjs', decideStep.includes('actions/caches?key=$PREFIX') && decideStep.includes('node tools/cache-save-decision.mjs --stats profile-build-stats.json --today "$TODAY"') && decideStep.includes('if: success()'));
const iUpload = y.indexOf('- name: Upload the built site for publish.yml (site-data)'), iSave = y.indexOf('- name: Save pipeline caches');
check('the save runs AFTER the site-data upload (a save never holds a publish back)', iUpload > 0 && iSave > iUpload);
check('the job may read the cache list (permissions: actions: read)', /\npermissions:\n(?:\s+.*\n)*?\s+actions: read/.test(y));
check('no actions/cache@v4 left on the bsp-caches entry (its implicit save would re-take the key)', !/uses: actions\/cache@v4\n\s+with:\n\s+path: \|\n\s+player-profiles-cache\.json/.test(y));

// ── the pipeline ──
const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
check('the profile cache is written atomically (temp + rename), never a bare writeFileSync', /writeJsonAtomic\(PLAYER_PROFILE_CACHE_PATH, \{ fetchedAt/.test(src) && !/fs\.writeFileSync\(PLAYER_PROFILE_CACHE_PATH/.test(src));
check('the run writes profile-build-stats.json {opponentsBuilt} for the decision', /writeJsonAtomic\('profile-build-stats\.json', \{ builtAt: [^}]*opponentsBuilt: built/.test(src));
check('profile-build-stats.json is gitignored (a per-run output, never committed)', fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').includes('profile-build-stats.json'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
