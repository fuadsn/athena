export {};
const url = process.env.RUNTIME_URL ?? 'http://127.0.0.1:4100';
const session = await fetch(new URL('/session', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personId: 'person_mira' }), signal: AbortSignal.timeout(15000) });
if (!session.ok) throw new Error(`Demo session failed: ${session.status}`);
const cookie = session.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const response = await fetch(new URL('/demo/reset', url), { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}', signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Demo reset failed: ${response.status} ${await response.text()}`);
console.log('Graph and Workspace Lab reset together. No procedure is published.');
