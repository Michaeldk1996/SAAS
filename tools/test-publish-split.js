// Code / data split (founder 2026-10-12: "do not mix the data with it and wait so long; everything automatic").
//   gate.yml     — every npm test command once per code commit, sharded across GATE_SHARDS machines;
//   pipeline.yml — builds the data and uploads it as `site-data` after its data checks;
//   publish.yml  — the newest GATED code over the newest data (tools/publish-resolve.mjs + tools/publish-site.mjs).
// Every check below runs the real files; MUTANTS at the bottom must each turn a check red.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const SOURCES = {
  resolve: read('tools/publish-resolve.mjs'), site: read('tools/publish-site.mjs'), code: read('tools/site-code.sh'),
  gate: read('.github/workflows/gate.yml'), lane: read('tools/deploy-lane.mjs'), publish: read('.github/workflows/publish.yml'), pipeline: read('.github/workflows/pipeline.yml'),
};

async function load(src, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubsplit-'));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.writeFileSync(path.join(dir, 'tools', name), src);
  return import(path.join(dir, 'tools', name));
}
const steps = (yml) => yml.split('\n      - ').slice(1).map((b) => ({ name: (/^(?:name: |id: \w+\n\s+name: )?(.*)/.exec(b) || [])[1] || '', body: b }));

const SHA = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const CASES = {
  'resolve: CODE = the newest commit on main whose gate PASSED (a failed or newer ungated commit is skipped)': async (S) => {
    const M = await load(S.resolve, 'publish-resolve.mjs');
    const main = ['d4', 'c3', 'b2', 'a1'];   // newest first
    const runs = [{ head_sha: 'd4', conclusion: 'failure', id: 9 }, { head_sha: 'b2', conclusion: 'success', id: 7 }, { head_sha: 'a1', conclusion: 'success', id: 5 }];
    assert.deepStrictEqual(M.pickCode(main, runs), { codeSha: 'b2', gateRunId: 7 });
    assert.strictEqual(M.pickCode(main, [{ head_sha: 'zz', conclusion: 'success', id: 1 }]), null, 'a gated sha not on main is never published');
  },
  'resolve: DATA = the newest unexpired site-data artifact': async (S) => {
    const M = await load(S.resolve, 'publish-resolve.mjs');
    const A = (id, at, extra) => Object.assign({ id, name: 'site-data', expired: false, created_at: at, workflow_run: { id: id * 10, head_sha: 'h' + id } }, extra || {});
    const got = M.pickData([A(1, '2026-10-12T01:00:00Z'), A(3, '2026-10-12T03:00:00Z', { expired: true }), A(2, '2026-10-12T02:00:00Z'), A(4, '2026-10-12T04:00:00Z', { name: 'other' })]);
    assert.strictEqual(got.dataArtifactId, 2); assert.strictEqual(got.dataRunId, 20);
    assert.strictEqual(M.pickData([]), null);
  },
  'publish-site: the code files are the gated checkout\'s, the data is untouched, and the stamp names both': async (S) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubsplit-site-'));
    const site = path.join(dir, '_site');
    fs.mkdirSync(site);
    fs.writeFileSync(path.join(site, 'matches.json'), '[{"data":1}]');
    fs.writeFileSync(path.join(site, 'index.html'), 'OLD CODE');   // the pipeline's copy of older code
    fs.writeFileSync(path.join(site, 'build-info.json'), JSON.stringify({ commit: 'f'.repeat(40), runId: '123', builtAt: '2026-10-12T01:00:00Z' }));
    const tool = path.join(dir, 'tools'); fs.mkdirSync(tool);
    fs.writeFileSync(path.join(tool, 'publish-site.mjs'), S.site);
    // the TIP's list names a file the gated code does not have yet (21 Oct: draw-view.js vs gated e3cc5f0dd) — publish must
    // still succeed, because it copies with the gated checkout's own site-code.sh, never the tip's
    fs.writeFileSync(path.join(tool, 'site-code.sh'), S.code.replace('cp tokens.css theme.js "$SITE/"', 'cp tokens.css theme.js "$SITE/"\ncp not-in-the-gated-code-yet.js "$SITE/"'));
    const M = await import(path.join(tool, 'publish-site.mjs'));
    const info = M.publish({ code: ROOT, site, env: { CODE_SHA: SHA, DATA_RUN_ID: '123', SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'pk_test' } });
    const dash = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
    assert.ok(!dash.includes('OLD CODE'), 'the stale code copy is replaced');
    assert.strictEqual(dash.match(/<meta name="build-sha" content="([0-9a-f]{40})">/g).length, 1);
    assert.ok(dash.includes(`content="${SHA}"`));
    assert.ok(!/__SUPABASE_URL__|__SUPABASE_ANON_KEY__/.test(dash) && dash.includes('https://x.supabase.co'), 'the public Supabase config is injected');
    for (const f of ['live-tab.js', 'tokens.css', 'series.js']) assert.ok(fs.readFileSync(path.join(site, f)).equals(fs.readFileSync(path.join(ROOT, f))), f + ' = the gated code');
    assert.strictEqual(fs.readFileSync(path.join(site, 'matches.json'), 'utf8'), '[{"data":1}]', 'data untouched');
    const bi = JSON.parse(fs.readFileSync(path.join(site, 'build-info.json'), 'utf8'));
    assert.strictEqual(bi.commit, SHA); assert.deepStrictEqual(bi.data, { runId: '123', commit: 'f'.repeat(40), builtAt: '2026-10-12T01:00:00Z' });
    assert.strictEqual(info.commit, SHA);
    // refusals: a bad sha, no data
    assert.throws(() => M.publish({ code: ROOT, site, env: { CODE_SHA: 'abc' } }), /40-char/);
    const empty = path.join(dir, 'empty'); fs.mkdirSync(empty);
    assert.throws(() => M.publish({ code: ROOT, site: empty, env: { CODE_SHA: SHA } }), /no pipeline data/);
    fs.rmSync(dir, { recursive: true, force: true });
  },
  'gate.yml: one machine per shard of the plan, GATE_SHARDS of them, on every code push to main': (S) => {
    const n = Number(/GATE_SHARDS: (\d+)/.exec(S.gate)[1]);
    const list = /shard: \[([\d, ]+)\]/.exec(S.gate)[1].split(',').map((x) => Number(x.trim()));
    assert.deepStrictEqual(list, Array.from({ length: n }, (_, i) => i + 1), 'the matrix lists every shard 1..GATE_SHARDS');
    assert.ok(/node tools\/gate-run\.mjs --shards "\$GATE_SHARDS" --shard \$\{\{ matrix\.shard \}\}/.test(S.gate));
    assert.ok(/push:\n\s+branches: \[main\]/.test(S.gate));
    assert.ok(/needs\.shard\.result \}\}" = "success"/.test(S.gate), 'the run fails unless every shard passed');
  },
  'publish.yml: triggered by both workflows by their real names; reads the artifact the pipeline writes; deploys only behind the switch': (S) => {
    const gateName = /^name: (.+)$/m.exec(S.gate)[1].trim(), pipeName = /^name: (.+)$/m.exec(S.pipeline)[1].trim();
    assert.ok(S.publish.includes(`workflows: ["${gateName}", "${pipeName}"]`), 'workflow_run names must equal the workflows\' own names');
    assert.ok(/name: site-data\n\s+path: _site\n\s+run-id:/.test(S.publish), 'downloads site-data from the resolved run');
    assert.ok(/github\.event\.workflow_run\.conclusion == 'success'/.test(S.publish), 'a failed gate or pipeline run publishes nothing');
    assert.ok(/needs\.assemble\.outputs\.deploy == 'true'/.test(S.publish) && /steps\.mode\.outputs\.deploy == 'true'/.test(S.publish), 'Pages only behind PUBLISH_DEPLOY');
    // founder 2026-10-13: the newest publish cancels a stuck one (run 38253661020 held the group 17.5 h)
    assert.ok(/concurrency:\n\s+group: site-publish\n\s+cancel-in-progress: true/.test(S.publish), 'a stuck publish must be replaced by the next one');
  },
  'site-code.sh = the code lines of pipeline.yml "Assemble site", line for line (no file in one list only)': (S) => {
    const asm = S.pipeline.slice(S.pipeline.indexOf('      - name: Assemble site'), S.pipeline.indexOf('      - name: Inject Supabase public config'));
    const isCode = (l) => /\.(html|js|css)\b|assets\//.test(l) && !/\.json\b|node tools\//.test(l);
    const norm = (l) => l.trim().replace(/"\$SITE\/?/g, '_site/').replace(/"/g, '').replace(/_site\/\s/g, '_site/ ').replace(/\s+/g, ' ');
    const fromPipe = asm.split('\n').filter((l) => /^\s+(cp|mkdir -p _site\/assets)/.test(l) && isCode(l)).map(norm).sort();
    const fromScript = S.code.split('\n').filter((l) => /^(cp|mkdir -p "\$SITE\/assets)/.test(l)).map(norm).sort();
    assert.ok(fromPipe.length >= 15, `only ${fromPipe.length} code lines found in Assemble site`);
    assert.deepStrictEqual(fromScript, fromPipe);
  },
  'deploy-lane.mjs: the hold rules watch the run that deploys (publish.yml), not pipeline.yml': (S) => {
    assert.ok(/export const DEPLOY_WORKFLOW = 'publish\.yml';/.test(S.lane), 'DEPLOY_WORKFLOW is not publish.yml');
    assert.ok(/pipelineRuns: githubPipelineRuns\(\{ repo: [^}]*workflow: DEPLOY_WORKFLOW \}\)/.test(S.lane), 'the real lane does not watch DEPLOY_WORKFLOW');
  },
  'pipeline.yml: uploads site-data after every data check; deploys nothing': (S) => {
    const st = steps(S.pipeline), at = (re) => st.findIndex((x) => re.test(x.name));
    const comp = at(/^Assert site completeness$/), rec = at(/^Reconcile suite on the freshly built store/);
    const stamp = at(/^Deploy ancestor guard/), up = at(/^Upload the built site for publish\.yml/);
    assert.ok(comp >= 0 && rec >= 0 && stamp >= 0 && up >= 0, 'all steps present');
    assert.ok(up > comp && up > rec && up > stamp, `site-data is uploaded after the data checks (${[comp, rec, stamp, up]})`);
    assert.ok(/name: site-data\n\s+path: _site/.test(st[up].body));
    assert.ok(!st.some((x) => /upload-pages-artifact|deploy-pages/.test(x.body)), 'pipeline.yml deploys Pages: only publish.yml may');
  },
};

const MUTANTS = [
  ['a failed gate counts as passed', 'resolve', "if (r.conclusion === 'success' && !bySha.has(r.head_sha))", "if (!bySha.has(r.head_sha))", 'resolve: CODE'],
  ['an expired artifact is published', 'resolve', "a.name === DATA_ARTIFACT && !a.expired", "a.name === DATA_ARTIFACT", 'resolve: DATA'],
  ['the oldest artifact wins', 'resolve', "String(b.created_at).localeCompare(String(a.created_at))", "String(a.created_at).localeCompare(String(b.created_at))", 'resolve: DATA'],
  ['the code overlay skipped', 'site', "execFileSync('bash', [path.join(code, 'tools', 'site-code.sh'), code, site], { stdio: 'inherit' });", '', 'publish-site'],
  ['the code overlay copies with the TIP\'s file list, not the gated checkout\'s', 'site', "path.join(code, 'tools', 'site-code.sh')", "path.join(ROOT, 'tools', 'site-code.sh')", 'publish-site'],
  ['the data info dropped from the stamp', 'site', "data: { runId: env.DATA_RUN_ID || dataInfo.runId || null, commit: dataInfo.commit || null, builtAt: dataInfo.builtAt || null },", '', 'publish-site'],
  ['Supabase not injected', 'site', "if (env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) {", "if (false) {", 'publish-site'],
  ['a shard missing from the matrix', 'gate', 'shard: [1, 2, 3, 4, 5, 6]', 'shard: [1, 2, 3, 4, 5]', 'gate.yml'],
  ['the lane watches pipeline.yml again', 'lane', "workflow: DEPLOY_WORKFLOW })", "workflow: 'pipeline.yml' })", 'deploy-lane.mjs'],
  ['pipeline.yml deploys Pages again', 'pipeline', null, 'PAGES', 'pipeline.yml'],
  ['publish deploys whatever the switch says', 'publish', "if: needs.assemble.outputs.ready == 'true' && needs.assemble.outputs.deploy == 'true'", "if: needs.assemble.outputs.ready == 'true'", 'publish.yml'],
  ['publish fires on a failed run', 'publish', "github.event.workflow_run.conclusion == 'success'", "github.event.workflow_run.conclusion != ''", 'publish.yml'],
  ['site-data uploaded before the data checks', 'pipeline', null, null, 'pipeline.yml'],
  ['a code file in pipeline.yml but not in site-code.sh', 'code', 'cp tournament-identity.js "$SITE/"\n', '', 'site-code.sh ='],
  ['a code file in site-code.sh but not in pipeline.yml', 'pipeline', null, 'DROPCP', 'site-code.sh ='],
];

(async () => {
  let failed = 0, n = 0;
  const run = async (S, only) => { const res = {}; for (const [k, f] of Object.entries(CASES)) { if (only && !k.startsWith(only)) continue; try { await f(S); res[k] = true; } catch (e) { res[k] = e; } } return res; };
  const base = await run(SOURCES);
  for (const [k, r] of Object.entries(base)) { n++; if (r === true) console.log('  ok   ' + k); else { failed++; console.log('  FAIL ' + k + '\n       ' + (r.message || r).toString().split('\n')[0]); } }
  for (const [label, file, find, repl, target] of MUTANTS) {
    n++;
    const S = { ...SOURCES };
    if (file === 'pipeline' && repl === 'PAGES') {
      S.pipeline = S.pipeline.replace('      # Surface failures loudly', '      - name: Deploy to GitHub Pages\n        uses: actions/deploy-pages@v4\n\n      # Surface failures loudly');
    } else if (file === 'pipeline' && repl === 'DROPCP') {
      S.pipeline = S.pipeline.replace('          cp tournament-identity.js _site/\n', '');
    } else if (file === 'pipeline') {   // move the upload above the reconcile step
      const up = S.pipeline.indexOf('      # Founder 2026-10-12: code and data deploy'), pages = S.pipeline.indexOf('      # Surface failures loudly', up);
      const block = S.pipeline.slice(up, pages), rec = S.pipeline.indexOf('      - name: Reconcile suite on the freshly built store');
      S.pipeline = S.pipeline.slice(0, rec) + block + S.pipeline.slice(rec, up) + S.pipeline.slice(pages);
    } else {
      if (S[file].split(find).length !== 2) { failed++; console.log(`  FAIL mutant anchor not found once: ${label}`); continue; }
      S[file] = S[file].replace(find, repl);
    }
    const r = await run(S, target);
    const bit = Object.values(r).some((v) => v !== true);
    if (bit) console.log(`  ok   mutant bites — ${label}`); else { failed++; console.log(`  FAIL mutant SURVIVED — ${label}`); }
  }
  console.log(`publish split: ${n - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
