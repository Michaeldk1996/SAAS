// Classifier for tools/git-hooks/pre-push (founder 2026-10-22: the skip-ci exemption must check the files, never trust
// the marker). Data = the deploy lane's ONE definition (tools/deploy-lane.mjs: isDataPath / isDataCommit — data-bot
// author, the marker in the subject, every file one a data bot really writes), imported from the pushing checkout.
//
//   node push-classify.mjs <toplevel> commits <sha>...   → one JSON line per commit
//   node push-classify.mjs <toplevel> datadiff <a> <b>   → exit 0 iff every file that differs between a and b is data
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
} else {
  console.error('usage: push-classify.mjs <toplevel> commits <sha>... | datadiff <a> <b>');
  process.exit(2);
}
