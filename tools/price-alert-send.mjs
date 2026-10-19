#!/usr/bin/env node
// Sends one Telegram message from a text file (founder ruling 2026-10-18: one alert per run). An empty or missing file
// sends nothing. A message that cannot be sent is an ::error:: in the log and the step summary — never silent — and the
// step still exits 0: an alert must never hold back a publish. TELEGRAM_API_URL points the test at a fake server.
import { readFileSync, existsSync, appendFileSync } from 'node:fs';

// timeoutMs (optional, default 20 s): a caller with its own time budget passes what is left of it (TEN-449).
export async function sendTelegram(text, env = process.env, { timeoutMs = 20000 } = {}) {
  const tok = env.TELEGRAM_BOT_TOKEN, chat = env.TELEGRAM_CHAT_ID;
  if (!tok || !chat) return { ok: false, why: 'no Telegram secret set' };
  const base = (env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }), signal: AbortSignal.timeout(timeoutMs) });
    return { ok: r.status >= 200 && r.status < 300, why: `HTTP ${r.status}` };
  } catch (e) { return { ok: false, why: e.name }; }   // never echo the URL: it carries the bot token
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = process.argv[2];
  const text = f && existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
  if (!text) { console.log('alert: nothing to send'); process.exit(0); }
  const r = await sendTelegram(text);
  if (r.ok) console.log(`alert: Telegram sent (${r.why})`);
  else {
    console.log(`::error title=Alert not sent::Telegram ${r.why} — the message is below`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Alert NOT sent (${r.why})\n\n${text}\n`);
  }
  console.log(text);
  process.exit(0);
}
