// Probe only (not for main): can a server sign in to Tennis TV with the account in GitHub secrets, and reach one clip?
// Prints statuses and shapes, never a token, cookie, email or password.
import crypto from 'node:crypto';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const AUTH = 'https://sso.tennistv.com/auth/realms/tennistv/protocol/openid-connect', CLIENT = 'tennis-tv-web', REDIRECT = 'https://www.tennistv.com/';
const jar = new Map();
const keep = (res) => { for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); } };
const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
const b64 = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64(crypto.randomBytes(32)), challenge = b64(crypto.createHash('sha256').update(verifier).digest());
const email = process.env.TENNISTV_EMAIL, password = process.env.TENNISTV_PASSWORD;
console.log('secrets present:', !!email, !!password);
const u = `${AUTH}/auth?client_id=${CLIENT}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&response_mode=query&scope=openid&code_challenge=${challenge}&code_challenge_method=S256&state=${b64(crypto.randomBytes(8))}`;
let r = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'manual' }); keep(r);
let html = await r.text();
console.log('1 auth page:', r.status, 'bytes', html.length, 'captcha?', /captcha|recaptcha|turnstile|hcaptcha/i.test(html), 'form?', /kc-form-login|name="password"/.test(html));
const action = (/<form[^>]*action="([^"]+)"/i.exec(html) || [])[1];
if (!action) { console.log('no login form found; title:', (/<title>([^<]*)/i.exec(html) || [])[1]); process.exit(0); }
r = await fetch(action.replace(/&amp;/g, '&'), { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() }, body: new URLSearchParams({ username: email || '', password: password || '', credentialId: '' }), redirect: 'manual' }); keep(r);
const loc = r.headers.get('location') || '';
const body2 = r.status === 200 ? await r.text() : '';
console.log('2 login post:', r.status, 'redirect to site?', loc.startsWith(REDIRECT), 'has code?', /[?&]code=/.test(loc), r.status === 200 ? ('page says: ' + ((/class="[^"]*(?:alert|error|feedback)[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{3,120})/i.exec(body2) || [])[1] || (/<title>([^<]*)/i.exec(body2) || [])[1])) : '');
const code = (/[?&]code=([^&]+)/.exec(loc) || [])[1];
if (!code) process.exit(0);
r = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT, code, redirect_uri: REDIRECT, code_verifier: verifier }) });
const tok = await r.json().catch(() => ({}));
console.log('3 token:', r.status, 'access?', !!tok.access_token, 'refresh?', !!tok.refresh_token, 'expires_in', tok.expires_in, 'refresh_expires_in', tok.refresh_expires_in, tok.error || '');
if (!tok.access_token) process.exit(0);
// 4 a clip: the video page -> the playback entry -> the manifest
const page = await (await fetch('https://www.tennistv.com/videos/4607963/stockholm-2026-r2-rune-interview', { headers: { 'user-agent': UA } })).text();
const ids = [...new Set(page.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [])];
console.log('4 video page bytes', page.length, 'uuids on page', ids.length, 'mentions streamamg/entry:', /streamamg|entryId|entry_id|mediaId/i.test(page), (page.match(/"(?:entryId|entry_id|mediaId|videoId|sourceId)"\s*:\s*"[^"]{6,60}"/g) || []).slice(0, 5));
for (const id of ids.slice(0, 6)) {
  const e = await fetch(`https://api.playback.streamamg.com/v1/entry/${id}`, { headers: { 'user-agent': UA, authorization: `Bearer ${tok.access_token}`, origin: 'https://www.tennistv.com', referer: 'https://www.tennistv.com/' } });
  const t = await e.text();
  console.log('  entry', id.slice(0, 8), e.status, t.slice(0, 160).replace(/token=[^"&]+/g, 'token=…').replace(/eyJ[A-Za-z0-9_.-]+/g, 'JWT…'));
  if (e.status === 200) break;
}
