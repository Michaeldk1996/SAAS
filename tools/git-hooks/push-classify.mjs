// Classifier for tools/git-hooks/pre-push (founder 2026-10-22: the skip-ci exemption must check the files, never trust
// the marker). Data = the deploy lane's ONE definition (tools/deploy-lane.mjs: isDataPath / isDataCommit — data-bot
// author, the marker in the subject, every file one a data bot really writes), imported from the pushing checkout.
//
//   node push-classify.mjs <toplevel> commits <sha>...   → one JSON line per commit
//   node push-classify.mjs <toplevel> datadiff <a> <b>   → exit 0 iff every file that differs between a and b is data
//   node push-classify.mjs <toplevel> lane <laneFile> <receiptsDir> <sha> <callerTicket>
//                                                         → exit 0 iff the push is the lane holder's, through deploy-batch,
//                                                           on a green ci-suite receipt; else prints why, exit 1
//
// Files per commit = its FIRST-PARENT diff (a root commit: everything in it), so a merge shows what it brings in
// (`git diff-tree -r` without -m lists nothing for a merge — the hole this closes).
// marker = any token GitHub honours to run no workflow for a push: [skip ci] [ci skip] [no ci] [skip actions]
// [actions skip] anywhere in the message, or a `skip-checks: true` trailer.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , top, mode, ...args] = process.argv;
const { isDataPath, isDataCommit } = await import(pathToFileURL(path.join(top, 'tools', 'deploy-lane.mjs')).href);
const git = (...a) => execFileSync('git', a, { cwd: top, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const lines = (s) => s.split('\n').filter(Boolean);
const MARKER = /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]|^skip-checks:\s*true\s*$/im;

if (mode === 'commits') {
  for (const c of args) {
    const parents = git('rev-list', '--parents', '-n', '1', c).split(' ').slice(1);
    const files = lines(parents.length
      ? git('diff', '--name-only', '--no-renames', `${parents[0]}`, c)
      : git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', c));
    const [subject, authorEmail] = git('log', '-1', '--format=%s%x00%ae', c).split('\0');
    const message = git('log', '-1', '--format=%B', c);
    const data = isDataCommit({ subject, authorEmail, files });
    console.log(JSON.stringify({ sha: c, data, marker: MARKER.test(message), merge: parents.length > 1,
      codeFiles: files.filter((f) => !isDataPath(f)).slice(0, 5) }));
  }
} else if (mode === 'datadiff') {
  const files = lines(git('diff', '--name-only', '--no-renames', args[0], args[1]));
  process.exit(files.every(isDataPath) ? 0 : 1);
} else if (mode === 'lane') {
  // Founder 2026-10-22 (item 4): the hook enforces the deploy lane. ONE suite record — the lane's ci-suite.sh receipt —
  // and the push must be tools/deploy-batch.mjs acting for the current, unexpired lane holder.
  const fs = await import('node:fs');
  const [laneFile, receiptsDir, sha, caller] = args;
  const no = (why) => { console.log(why); process.exit(1); };
  if (!caller) no('a raw push: code reaches main only through tools/deploy-batch.mjs while you hold the deploy lane (node tools/deploy-lane.mjs claim …, then deploy-batch).');
  let claim = null;
  if (fs.existsSync(laneFile)) { try { claim = JSON.parse(fs.readFileSync(laneFile, 'utf8')).claim || null; } catch (e) { no(`cannot read the lane file ${laneFile}: ${e.message}`); } }
  if (!claim) no('nobody holds the deploy lane — claim it first (node tools/deploy-lane.mjs claim …).');
  if (claim.ticket !== caller) no(`the lane is held by ${claim.ticket}, not ${caller}.`);
  if (!(Date.parse(claim.expiresAt) > Date.now())) no(`the lane claim of ${claim.ticket} expired at ${claim.expiresAt} — claim again.`);
  const green = (s) => { try { const r = JSON.parse(fs.readFileSync(path.join(receiptsDir, `${s}.json`), 'utf8')); return r.sha === s && r.exit === 0; } catch { return false; } };
  const dataOnly = (a) => { try { return lines(git('diff', '--name-only', '--no-renames', a, sha)).every(isDataPath); } catch { return false; } };
  const exists = (s) => { try { git('cat-file', '-e', `${s}^{commit}`); return true; } catch { return false; } };
  if (green(sha)) { console.log(`receipt for ${sha.slice(0, 9)}`); process.exit(0); }
  if (claim.sha && exists(claim.sha) && green(claim.sha) && dataOnly(claim.sha)) { console.log(`receipt for the claimed ${claim.sha.slice(0, 9)} (data-only difference)`); process.exit(0); }
  // a batch replayed onto new data-bot commits: any recent green receipt that differs from the pushed commit in data only
  const recent = fs.existsSync(receiptsDir) ? fs.readdirSync(receiptsDir).filter((f) => /^[0-9a-f]{40}\.json$/.test(f))
    .map((f) => ({ s: f.slice(0, 40), t: fs.statSync(path.join(receiptsDir, f)).mtimeMs })).filter((x) => Date.now() - x.t < 48 * 3600e3) : [];
  for (const { s } of recent) if (exists(s) && green(s) && dataOnly(s)) { console.log(`receipt for ${s.slice(0, 9)} (data-only difference)`); process.exit(0); }
  no(`no green ci-suite receipt for ${sha.slice(0, 9)} (nor for a receipted commit that differs from it in data files only) — run tools/ci-suite.sh ${sha.slice(0, 9)}.`);
} else {
  console.error('usage: push-classify.mjs <toplevel> commits <sha>... | datadiff <a> <b> | lane <laneFile> <receiptsDir> <sha> <ticket>');
  process.exit(2);
}
