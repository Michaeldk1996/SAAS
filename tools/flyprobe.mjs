const tok = process.env.FLY_API_TOKEN || '';
if (!tok) { console.log('NO TOKEN'); process.exit(0); }
const q = async (query, variables) => { const r = await fetch('https://api.fly.io/graphql', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ query, variables }) }); return (await r.json().catch(() => ({}))); };
const o = await q('{ organizations { nodes { id slug } } }');
const org = (((o.data || {}).organizations || {}).nodes || []).find(n => n.slug === 'personal') || (((o.data || {}).organizations || {}).nodes || [])[0];
console.log('org id?', !!org);
if (!org) { console.log('cannot see org:', JSON.stringify((o.errors || []).map(e => e.message))); process.exit(0); }
const name = 'stennisfy-interviews';
const c = await q('mutation($input: CreateAppInput!){ createApp(input:$input){ app { name } } }', { input: { organizationId: org.id, name } });
if (c.data && c.data.createApp) { console.log('CREATED app', c.data.createApp.app.name); }
else { console.log('createApp errors:', JSON.stringify((c.errors || []).map(e => e.message))); }
// whichever: show apps now
const a = await q('{ apps { nodes { name } } }');
console.log('apps now:', JSON.stringify((((a.data || {}).apps || {}).nodes || []).map(x => x.name)));
