// Founder ruling 2026-10-25 (post-deploy check) — tools/post-deploy-check.mjs, its own test.
//   unit: the sign-in strip, the build-sha read, every `judge` rule, the message;
//   end to end in headless Chrome over a local "deployed site" built from this checkout (tools/site-code.sh + the
//   committed matches.json + a build-info.json fixture, stamped like publish-site.mjs does):
//     green  the current dashboard → ok, the view rendered, zero uncaught errors;
//     red    the same page with a duplicate top-level `const _tpLoad` in the main script → fails, names the error;
//     red    the REAL pre-fix dashboard of the 25 Oct outage (b41ac740e^, f255dca34's `const _tpLoad`) → fails;
//     red    page build-sha ≠ build-info.json commit → fails (after its re-reads);
//     alert  a failure sends ONE Telegram message (fake server) naming the error; a refused send says NOT sent;
//   wiring: post-deploy-check.yml runs after a successful "Publish site", from main, with the Telegram secrets.
// No Chrome → the browser checks SKIP out loud (never a pass); set CHROME_BIN.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripAuth, metaShas, judge, message, run, GLOBALS } from './post-deploy-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m + '\n        ' + String(d).slice(0, 900)); } };
const SHA = 'a'.repeat(40), OTHER = 'b'.repeat(40);

// ── unit ──
const dash = readFileSync(join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const st = stripAuth(dash);
ok(st.stripped === 2 && !/BSP\.require(Verified|Auth)\(/.test(st.html), 'the shipped dashboard: both sign-in redirect calls removed, nothing else', st.stripped);
ok(st.html.length - dash.length === 2 * ('/* post-deploy check: sign-in redirect removed */'.length) - "BSP.requireVerified('auth.html?mode=signin', 'verify.html');".length - "BSP.requireAuth('auth.html?mode=signin');".length,
  'the strip changes only those two calls (byte count)');
ok(metaShas(`<meta charset="UTF-8">\n<meta name="build-sha" content="${SHA}">`).join() === SHA && metaShas('<p>').length === 0, 'build-sha meta read like publish-site.mjs writes it');
const G = Object.fromEntries(Object.entries(GLOBALS));
const healthy = { pageOk: true, errors: [], metaShas: [SHA], info: { commit: SHA }, ready: true, globals: G, view: { children: 12, text: 'Lyon …' } };
ok(judge(healthy).length === 0, 'healthy observation → no failure', judge(healthy));
let f = judge({ ...healthy, errors: [{ text: "SyntaxError: Identifier '_tpLoad' has already been declared", url: 'http://127.0.0.1:1/bsp-consult-dashboard.html', line: 25790 }] });
ok(f.length === 1 && /uncaught error on load: SyntaxError: Identifier '_tpLoad' has already been declared \(bsp-consult-dashboard\.html:25791\)/.test(f[0]), 'an uncaught error → a failure naming it, file and line', f);
f = judge({ ...healthy, metaShas: [OTHER] });
ok(f.length === 1 && /page build-sha bbbbbbbbb ≠ build-info\.json commit aaaaaaaaa/.test(f[0]), 'page build-sha ≠ build-info commit → failure', f);
ok(judge({ ...healthy, metaShas: [] }).some((x) => /0 build-sha meta tags/.test(x)), 'no build-sha meta → failure');
ok(judge({ ...healthy, info: null, infoWhy: 'HTTP 404' }).some((x) => /build-info\.json has no commit \(HTTP 404\)/.test(x)), 'build-info.json unreadable → failure');
f = judge({ ...healthy, globals: { ...G, tpPageEvents: 'undefined' } });
ok(f.length === 1 && /page globals missing: tpPageEvents/.test(f[0]), 'one page global missing → failure naming it', f);
ok(judge({ ...healthy, view: { children: 0, text: '' } }).some((x) => /\(#matchlist\) never rendered/.test(x)), 'the default view empty → failure');
ok(judge({ ...healthy, view: { children: 1, text: 'No matches found. No data loaded yet — check the status message above.' } }).some((x) => /never loaded its fixtures/.test(x)),
  "the view stuck on renderMatches' pre-data message → failure (that render happens before the fixtures arrive)");
ok(judge({ ...healthy, view: { children: 1, text: 'No matches found. Try different filters.' } }).length === 0, 'a real empty board (fixtures loaded, none today) is healthy');
ok(judge({ pageOk: false, pageWhy: 'bsp-consult-dashboard.html: HTTP 404' }).join() === 'the page could not be loaded (bsp-consult-dashboard.html: HTTP 404)', 'page not fetched → failure, saying so');
const msg = message(['uncaught error on load: X'], { info: { commit: SHA, runNumber: 2077 }, base: 'https://x/SAAS/bsp-consult-dashboard.html', runUrl: 'https://gh/run/1' });
ok(/^Stennisfy post-deploy check FAILED: the live dashboard \(aaaaaaaaa, publish run 2077\) is broken\.\n- uncaught error on load: X\n/.test(msg) && /https:\/\/gh\/run\/1$/.test(msg), 'message: build, run, each failure, the run link', msg);

// ── end to end ──
const chrome = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chrome) console.log('  SKIP  the browser checks: no Chrome (set CHROME_BIN) — said out loud, not a pass');
else {
  const site = mkdtempSync(join(tmpdir(), 'pdc-site-'));
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const srv = createServer((req, res) => {
    const p = normalize(join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!p.startsWith(site) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    try { res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch { res.writeHead(404); res.end(); }
  });
  let tgStatus = 200; const tg = [];
  const tgs = createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { tg.push(JSON.parse(b || '{}')); res.writeHead(tgStatus); res.end('{}'); }); });
  try {
    execFileSync('bash', [join(ROOT, 'tools/site-code.sh'), ROOT, site]);
    copyFileSync(join(ROOT, 'matches.json'), join(site, 'matches.json'));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r)); await new Promise((r) => tgs.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const stamp = (html, sha = SHA) => html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n<meta name="build-sha" content="${sha}">`);
    const page = (html) => writeFileSync(join(site, 'bsp-consult-dashboard.html'), html);
    const info = (commit = SHA) => writeFileSync(join(site, 'build-info.json'), JSON.stringify({ commit, runId: '5', runNumber: 2077, builtAt: new Date().toISOString(), data: {} }));
    const env = { POST_DEPLOY_RETRY_MS: '0', POST_DEPLOY_SETTLE_MS: '1500', CHROME_BIN: chrome, TELEGRAM_API_URL: `http://127.0.0.1:${tgs.address().port}`,
      TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42', RUN_URL: 'https://gh/run/9', GITHUB_STEP_SUMMARY: join(site, 'summary.md') };
    const go = (o = {}) => run({ base, env, log: () => {}, timeoutMs: 20000, ...o });

    page(stamp(dash)); info();
    let r = await go();
    ok(r.ok && r.summary.errors.length === 0 && r.summary.view.children > 0 && Object.entries(GLOBALS).every(([k, t]) => r.summary.globals[k] === t),
      'green: the current dashboard renders, every page global present, zero uncaught errors', JSON.stringify(r.summary));

    const anchor = 'let _tpLoad = null;';
    ok(dash.split(anchor).length === 2, 'the control anchor (TEN-339 `let _tpLoad`) is in the dashboard exactly once');
    page(stamp(dash.replace(anchor, anchor + '\nconst _tpLoad = {};')));
    r = await go({ alert: true });
    ok(!r.ok && r.summary.failures.some((x) => /Identifier '_tpLoad' has already been declared/.test(x)) && r.summary.failures.some((x) => /page globals missing/.test(x)),
      'red: a duplicate top-level const in the main script → fails, naming the error and the missing globals', JSON.stringify(r.summary.failures));
    ok(tg.length === 1 && tg[0].chat_id === '42' && /post-deploy check FAILED/.test(tg[0].text) && /_tpLoad/.test(tg[0].text) && /https:\/\/gh\/run\/9/.test(tg[0].text),
      'alert: ONE Telegram message naming the error and the run', JSON.stringify(tg));

    let pre = null;
    try { pre = execFileSync('git', ['-C', ROOT, 'show', 'b41ac740e^:bsp-consult-dashboard.html'], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
    if (!pre) console.log('  SKIP  the real pre-fix dashboard: b41ac740e^ not in this clone (shallow?) — said out loud, not a pass');
    else {
      page(stamp(pre));
      r = await go();
      ok(!r.ok && r.summary.failures.some((x) => /'_tpLoad' has already been declared/.test(x)), 'red: the real 25 Oct pre-fix dashboard (b41ac740e^) → fails', JSON.stringify(r.summary.failures));
    }

    page(stamp(dash)); info(OTHER);
    r = await go();
    ok(!r.ok && r.summary.failures.length === 1 && /≠ build-info\.json commit/.test(r.summary.failures[0]), 'red: page build-sha ≠ build-info commit → fails on that alone', JSON.stringify(r.summary.failures));

    info(); tgStatus = 500;
    page(stamp(dash.replace(anchor, anchor + '\nconst _tpLoad = {};')));
    r = await go({ alert: true });
    ok(!r.ok && r.sent && !r.sent.ok && /Post-deploy alert NOT sent \(HTTP 500\)/.test(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')), 'a refused Telegram send → step summary says NOT sent (and the run still fails)');
  } finally { srv.close(); tgs.close(); rmSync(site, { recursive: true, force: true }); }
}

// ── wiring ──
const y = readFileSync(join(ROOT, '.github/workflows/post-deploy-check.yml'), 'utf8');
ok(/workflow_run:\n\s+workflows: \['Publish site'\]\n\s+types: \[completed\]/.test(y), 'triggers on "Publish site" completing');
ok(/if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.workflow_run\.conclusion == 'success'/.test(y), 'only after a successful publish (or by hand)');
ok(/ref: main/.test(y), 'runs the checker from main');
ok(/node tools\/post-deploy-check\.mjs --alert --expect-run/.test(y) && /TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/.test(y) && /TELEGRAM_CHAT_ID: \$\{\{ secrets\.TELEGRAM_PIPELINE_CHAT_ID \|\| secrets\.TELEGRAM_CHAT_ID \}\}/.test(y),
  'the checker with --alert, the publish run id, and the existing Telegram secrets');
ok(/CHROME_BIN: google-chrome/.test(y) && !/continue-on-error/.test(y) && !/\|\|\s*true/.test(y), 'Chrome on the runner; a failure fails the job (no continue-on-error)');
console.log(`\ntest-post-deploy-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
