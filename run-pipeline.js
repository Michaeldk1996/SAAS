#!/usr/bin/env node
// Resilient launcher for bsp-pipeline.js.
//
// Why this exists: launchd fires bsp-pipeline.js on a fixed interval, but on a
// laptop that sleeps/loses network, individual runs used to fail silently
// (getaddrinfo ENOTFOUND / connection reset) and the data would fall behind
// with no visible signal. This wrapper:
//   1. Waits for the network to actually be reachable before starting.
//   2. Retries the whole pipeline with exponential backoff on failure.
//   3. Records every attempt in pipeline-health.json so a missed/failed run is
//      immediately obvious (the dashboard reads this and shows a banner).
// It is safe to run standalone (`node run-pipeline.js`) or from launchd.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

const DIR = __dirname;
const HEALTH_PATH = path.join(DIR, 'pipeline-health.json');
const PIPELINE = path.join(DIR, 'bsp-pipeline.js');
const NODE = process.execPath;

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [0, 30000, 60000, 120000, 300000]; // 0s, 30s, 1m, 2m, 5m
const NET_HOST = 'api.api-tennis.com';
const NET_WAIT_TRIES = 20;      // up to ~10 min waiting for network on wake
const NET_WAIT_INTERVAL = 30000;

const trigger = process.argv[2] || 'manual';
const log = (...a) => console.log(`[${new Date().toISOString()}] [runner]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadHealth() {
  try { return JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8')); }
  catch { return { lastSuccess: null, consecutiveFailures: 0, history: [] }; }
}
function saveHealth(h) {
  h.history = (h.history || []).slice(-20);
  fs.writeFileSync(HEALTH_PATH, JSON.stringify(h, null, 2));
}

async function networkReady() {
  for (let i = 1; i <= NET_WAIT_TRIES; i++) {
    try { await dns.lookup(NET_HOST); return true; }
    catch { log(`network not ready (try ${i}/${NET_WAIT_TRIES}) — ${NET_HOST} unresolved`); await sleep(NET_WAIT_INTERVAL); }
  }
  return false;
}

function runPipelineOnce() {
  return new Promise(resolve => {
    const child = spawn(NODE, [PIPELINE], { cwd: DIR, stdio: 'inherit', env: process.env });
    child.on('close', code => resolve(code));
    child.on('error', err => { log('spawn error:', err.message); resolve(1); });
  });
}

(async () => {
  const started = Date.now();
  const health = loadHealth();
  health.lastAttempt = new Date().toISOString();
  health.lastTrigger = trigger;

  log(`starting (trigger=${trigger}); last success: ${health.lastSuccess || 'never'}`);

  if (!(await networkReady())) {
    const msg = `network unreachable after ${NET_WAIT_TRIES} tries`;
    log('ABORT:', msg);
    health.consecutiveFailures = (health.consecutiveFailures || 0) + 1;
    health.lastError = msg;
    health.lastErrorAt = new Date().toISOString();
    health.history.push({ at: health.lastAttempt, trigger, ok: false, error: msg });
    saveHealth(health);
    process.exit(1);
  }

  let code = 1;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const wait = BACKOFF_MS[attempt - 1] || 300000;
      log(`attempt ${attempt}/${MAX_ATTEMPTS} — backing off ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
    log(`running pipeline (attempt ${attempt}/${MAX_ATTEMPTS})`);
    code = await runPipelineOnce();
    if (code === 0) break;
    log(`pipeline exited non-zero (code ${code})`);
  }

  const durationMs = Date.now() - started;
  if (code === 0) {
    health.lastSuccess = new Date().toISOString();
    health.lastSuccessDurationMs = durationMs;
    health.consecutiveFailures = 0;
    health.lastError = null;
    health.history.push({ at: health.lastAttempt, trigger, ok: true, durationMs });
    saveHealth(health);
    log(`SUCCESS in ${Math.round(durationMs / 1000)}s`);
    process.exit(0);
  } else {
    health.consecutiveFailures = (health.consecutiveFailures || 0) + 1;
    health.lastError = `pipeline failed after ${MAX_ATTEMPTS} attempts (exit ${code})`;
    health.lastErrorAt = new Date().toISOString();
    health.history.push({ at: health.lastAttempt, trigger, ok: false, error: health.lastError });
    saveHealth(health);
    log(`FAILED after ${MAX_ATTEMPTS} attempts — recorded (${health.consecutiveFailures} consecutive)`);
    process.exit(1);
  }
})();
