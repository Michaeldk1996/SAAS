// One page (100 posts) of @ATP_Entry's timeline: id, time, text, image urls. Read-only, nothing committed.
import fs from 'node:fs';
const UID = '1549708186885701632', tok = process.env.X_BEARER_TOKEN;
const p = new URLSearchParams({ max_results: '100', 'tweet.fields': 'created_at,attachments', expansions: 'attachments.media_keys', 'media.fields': 'url,type,alt_text', exclude: 'retweets,replies' });
const r = await fetch(`https://api.x.com/2/users/${UID}/tweets?${p}`, { headers: { authorization: `Bearer ${tok}` } });
const j = await r.json();
if (!r.ok) { console.log('X API', r.status, JSON.stringify(j).slice(0, 300)); process.exit(1); }
const media = new Map(((j.includes && j.includes.media) || []).map((m) => [m.media_key, m]));
const rows = (j.data || []).map((t) => ({ id: t.id, at: t.created_at, text: t.text, images: ((t.attachments && t.attachments.media_keys) || []).map((k) => (media.get(k) || {}).url).filter(Boolean) }));
fs.writeFileSync('/tmp/x-posts.json', JSON.stringify(rows, null, 1));
console.log(rows.length, 'posts', rows.length ? rows[rows.length - 1].at + ' .. ' + rows[0].at : '');
for (const x of rows.slice(0, 12)) console.log(x.at, '|', x.text.replace(/\s+/g, ' ').slice(0, 90), '|', x.images.length, 'img');
