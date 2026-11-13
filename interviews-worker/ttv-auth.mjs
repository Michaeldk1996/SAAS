// Tennis TV sign-in for the interviews worker: the keycloak authorization-code + PKCE flow, server-side (proven to
// work from a plain client — no browser needed to get a session). Returns { access_token, refresh_token }. The browser
// then plays the clip with this session injected into localStorage; nothing about the stream's own key is touched.
import crypto from 'node:crypto';
const AUTH = 'https://sso.tennistv.com/auth/realms/tennistv/protocol/openid-connect';
const CLIENT = 'tennis-tv-web', REDIRECT = 'https://www.tennistv.com/';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const b64 = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function signIn(email, password, fetchFn = fetch) {
  if (!email || !password) throw new Error('TENNISTV_EMAIL / TENNISTV_PASSWORD not set');
  const jar = new Map();
  const keep = (res) => { for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) { const kv = c.split(';')[0]; const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); } };
  const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const verifier = b64(crypto.randomBytes(32)), challenge = b64(crypto.createHash('sha256').update(verifier).digest());
  const u = `${AUTH}/auth?client_id=${CLIENT}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&response_mode=query&scope=openid&code_challenge=${challenge}&code_challenge_method=S256&state=${b64(crypto.randomBytes(8))}`;
  let r = await fetchFn(u, { headers: { 'user-agent': UA }, redirect: 'manual' }); keep(r);
  const html = await r.text();
  const action = (/<form[^>]*action="([^"]+)"/i.exec(html) || [])[1];
  if (!action) throw new Error('login form not found (captcha? layout change?)');
  r = await fetchFn(action.replace(/&amp;/g, '&'), { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() }, body: new URLSearchParams({ username: email, password, credentialId: '' }), redirect: 'manual' });
  keep(r);
  const loc = r.headers.get('location') || '';
  const code = (/[?&]code=([^&]+)/.exec(loc) || [])[1];
  if (!code) throw new Error(`login failed (status ${r.status}; wrong credentials or a challenge)`);
  r = await fetchFn(`${AUTH}/token`, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT, code, redirect_uri: REDIRECT, code_verifier: verifier }) });
  const tok = await r.json();
  if (!tok.access_token) throw new Error(`token exchange failed: ${tok.error || r.status}`);
  return { access_token: tok.access_token, refresh_token: tok.refresh_token, expires_in: tok.expires_in };
}
