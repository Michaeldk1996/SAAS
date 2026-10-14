#!/usr/bin/env node
// F5 (founder ruling 2026-10-14): a best-effort pipeline step (`|| true`) must not fail silently. After the step this
// reports (a) the exit code the `|| true` swallowed, (b) each declared output that is missing or empty, and (c) each
// output the step always writes that was NOT written by this step (mtime before the step started). It reports — it
// never exits non-zero: these steps are best-effort by ruling and the publish still runs. Problems are ::error::
// annotations, a line in the step summary and a row in .step-checks.jsonl (read by the final summary step).
// Usage: node tools/step-check.mjs --step "<name>" --rc <code> --since <epoch s> [--fresh f]... [--exists f]...
import fs from 'node:fs';
export function checkStep({ step, rc, since, fresh = [], exists = [] }, stat = fs.statSync) {
  const problems = [];
  if (Number(rc) !== 0) problems.push(`exited ${rc} (swallowed by || true)`);
  const look = (f) => { try { return stat(f); } catch (e) { return null; } };
  for (const f of [...fresh, ...exists]) {
    const s = look(f);
    if (!s) { problems.push(`${f} missing`); continue; }
    if (s.isFile() && s.size === 0) problems.push(`${f} empty`);
  }
  for (const f of fresh) {
    const s = look(f);
    if (s && since && s.mtimeMs < Number(since) * 1000 - 1000) problems.push(`${f} not rewritten by this step (last written ${new Date(s.mtimeMs).toISOString()})`);
  }
  return { step, ok: problems.length === 0, problems };
}
function main(argv) {
  const a = { fresh: [], exists: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--step') { a.step = v; i++; } else if (k === '--rc') { a.rc = v; i++; } else if (k === '--since') { a.since = v; i++; }
    else if (k === '--fresh') { a.fresh.push(v); i++; } else if (k === '--exists') { a.exists.push(v); i++; }
  }
  const r = checkStep(a);
  const line = r.ok ? `ok  · ${r.step}` : `ERR · ${r.step}: ${r.problems.join('; ')}`;
  if (r.ok) console.log(`step-check ${line}`);
  else console.log(`::error title=Best-effort step failed::${r.step}: ${r.problems.join('; ')}`);
  try { fs.appendFileSync('.step-checks.jsonl', JSON.stringify({ ...r, at: new Date().toISOString() }) + '\n'); } catch (e) { /* report only */ }
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`); } catch (e) { /* report only */ } }
}
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
