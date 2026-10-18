// TEN-443 test stub (tools/test-te-refresh.mjs): replaces fetch for a te-refresh child process. Serves TE pages from
// TE_STUB_PAGES (path -> html, or a number = that HTTP status), an api-tennis player birthday, and logs every URL.
import fs from 'node:fs';
const PAGES = JSON.parse(fs.readFileSync(process.env.TE_STUB_PAGES, 'utf8'));
const log = (u) => fs.appendFileSync(process.env.TE_STUB_LOG, u + '\n');
globalThis.fetch = async (url) => {
  url = String(url); log(url);
  const res = (status, body) => ({ status, ok: status === 200, headers: new Map(), text: async () => body, json: async () => JSON.parse(body) });
  if (url.includes('api.api-tennis.com') && process.env.TE_STUB_API_STATUS) return res(+process.env.TE_STUB_API_STATUS, 'error');
  if (url.includes('api.api-tennis.com')) return res(200, JSON.stringify({ result: [{ player_key: 2, player_full_name: 'Nate Newman', player_bday: '03.04.2000', player_country: 'Australia' }] }));
  const p = url.replace(/^https?:\/\/www\.tennisexplorer\.com/, '');
  const v = PAGES[p];
  if (v === undefined) return res(404, 'not found');
  return typeof v === 'number' ? res(v, '') : res(200, v);
};
