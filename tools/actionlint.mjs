#!/usr/bin/env node
// TEN-449 (founder, 2026-10-19): "Add actionlint (or equivalent) to npm test, so GitHub's own parser rules are checked
// before landing." Runs actionlint over every workflow file: .github/workflows/*.yml|yaml and tools/te-store-repo/te-refresh.yml.
//
// HOW IT IS OBTAINED — the same on this Mac, in tools/ci-suite.sh's clone and on GitHub's runners, with nothing
// installed by hand: the official release tarball of a PINNED version is downloaded from GitHub and its SHA-256 is
// checked against the table below (copied from the release's checksums file, never fetched at run time). A verified
// tarball is cached under ~/.cache/stennisfy-actionlint and re-verified on every use.
// FAIL CLOSED: no network, a wrong checksum, an unknown platform or a binary that won't run is exit 1, never a skip.
//
// WHAT IT DOES NOT CHECK: GitHub's 21,000-character expression limit (the 19 Oct outage, 893f7d43e). actionlint has
// no such rule; tools/test-workflow-expr-length.mjs is the check for that class.
//
// Shellcheck and pyflakes integrations are OFF (-shellcheck= -pyflakes=): actionlint runs them only when they are on
// PATH, which differs between this Mac (absent) and ubuntu-latest (shellcheck present), so leaving them on would make
// the result depend on the machine. Every actionlint rule of its own runs. Narrow, commented ignores live in
// .github/actionlint.yaml.
//
// Usage: node tools/actionlint.mjs [file ...]    (no files = every workflow file in the repo)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.7.12';
// From https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_checksums.txt
export const SHA256 = {
  darwin_amd64: '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  darwin_arm64: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  linux_amd64: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  linux_arm64: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG = path.join(ROOT, '.github', 'actionlint.yaml');

export function platformKey(platform = process.platform, arch = process.arch) {
  const a = { x64: 'amd64', arm64: 'arm64' }[arch];
  const key = `${platform}_${a}`;
  if (!a || !SHA256[key]) throw new Error(`actionlint: no pinned checksum for ${platform}/${arch} — add it to SHA256 in tools/actionlint.mjs`);
  return key;
}

export function workflowFiles(root = ROOT) {
  const dir = path.join(root, '.github', 'workflows');
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => path.join(dir, f));
  const te = path.join(root, 'tools', 'te-store-repo', 'te-refresh.yml');
  if (!fs.existsSync(te)) throw new Error(`actionlint: ${te} is missing`);
  return [...files, te];
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Returns the path of a verified tarball. Throws (fail closed) when it cannot get one.
export async function obtainTarball({ key = platformKey(), expected = SHA256[key], version = VERSION,
  cacheDir = process.env.ACTIONLINT_CACHE_DIR || path.join(os.homedir(), '.cache', 'stennisfy-actionlint'),
  url = `https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_${key}.tar.gz`,
  attempts = 3, timeoutMs = 60000 } = {}) {
  if (!/^[0-9a-f]{64}$/.test(expected || '')) throw new Error('actionlint: no pinned checksum');
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `actionlint_${version}_${key}.tar.gz`);
  if (fs.existsSync(file)) {
    if (sha256(fs.readFileSync(file)) === expected) return file;
    fs.rmSync(file, { force: true }); // corrupt or tampered cache: fetch again, verify again
  }
  let last = 'no attempt';
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) { last = `HTTP ${r.status}`; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const got = sha256(buf);
      if (got !== expected) throw new Error(`actionlint: checksum mismatch for ${url} (got ${got}, pinned ${expected}) — refusing to run it`);
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file); // atomic: parallel gate shards never see a half-written tarball
      return file;
    } catch (e) {
      if (/checksum mismatch/.test(e.message)) throw e;
      last = e.message;
    }
  }
  throw new Error(`actionlint: could not download ${url} after ${attempts} attempt(s) (${last}) — failing closed`);
}

// Extracts the verified tarball into a fresh temp dir and returns the binary path (caller removes the dir).
export function extract(tarball) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actionlint-'));
  const r = spawnSync('tar', ['-xzf', tarball, '-C', dir, 'actionlint'], { encoding: 'utf8' });
  const bin = path.join(dir, 'actionlint');
  if (r.status !== 0 || !fs.existsSync(bin)) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(`actionlint: could not extract ${tarball}: ${r.stderr}`); }
  return { dir, bin };
}

// Lints `files`; returns { code, output }. code 0 = clean, 1 = findings, anything else = actionlint failed to run.
// Files are passed relative to the real cwd: the per-path ignores in the config match on that relative path
// (macOS's /var → /private/var symlink would otherwise turn it into ../../private/…).
export function lint(bin, files, { config = CONFIG, cwd = ROOT } = {}) {
  cwd = fs.realpathSync(cwd);
  const rel = files.map((f) => path.relative(cwd, fs.realpathSync(f)));
  const args = ['-no-color', '-oneline', '-shellcheck=', '-pyflakes=', '-config-file', config, ...rel];
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: 3, output: `actionlint did not run: ${r.error.message}` };
  return { code: r.status, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

async function main() {
  const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f)) : workflowFiles();
  let ex;
  try {
    ex = extract(await obtainTarball());
    const v = spawnSync(ex.bin, ['-version'], { encoding: 'utf8' });
    if (v.status !== 0 || !v.stdout.startsWith(VERSION)) throw new Error(`actionlint: the binary does not run or is not ${VERSION}: ${v.stderr || v.stdout}`);
    const r = lint(ex.bin, files);
    if (r.output) console.error(r.output);
    console.log(`actionlint ${VERSION}: ${files.length} workflow file(s), ${r.code === 0 ? 'clean' : r.code === 1 ? 'FINDINGS (see above)' : `actionlint FAILED (exit ${r.code})`}`);
    process.exitCode = r.code === 0 ? 0 : 1;
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exitCode = 1;
  } finally {
    if (ex) fs.rmSync(ex.dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
