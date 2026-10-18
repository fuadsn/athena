import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FalkorDB } from 'falkordblite';
import { publicOrigin } from '../packages/contracts/src/origin';

// All services share one free container. Only the web listener is public.
const origin = publicOrigin(process.env.APP_PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL);
if (!origin) throw new Error('Configure APP_PUBLIC_ORIGIN or Render\'s RENDER_EXTERNAL_URL');
if ((process.env.DEMO_ACCESS_CODE ?? '').length < 16) throw new Error('Set DEMO_ACCESS_CODE to at least 16 characters');
const provider = process.env.MODEL_PROVIDER || 'openai';
if (!['openai', 'gemini'].includes(provider)) throw new Error('MODEL_PROVIDER must be openai or gemini');
const port = Number(process.env.PORT ?? 10000);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [4100, 4200, 16379].includes(port)) throw new Error('Invalid hosted web port');
const data = resolve(process.env.ATHENA_DATA_DIR ?? '.local/hosted');
await mkdir(data, { recursive: true });
const env: NodeJS.ProcessEnv = { ...process.env, APP_PUBLIC_ORIGIN: origin, NODE_OPTIONS: '--max-old-space-size=128',
  FALKORDB_HOST: '127.0.0.1', FALKORDB_PORT: '16379', FALKORDB_GRAPH: 'athena', FALKORDB_PASSWORD: '',
  RUNTIME_HOST: '127.0.0.1', RUNTIME_PORT: '4100', RUNTIME_URL: 'http://127.0.0.1:4100',
  WORKSPACE_LAB_HOST: '127.0.0.1', WORKSPACE_LAB_PORT: '4200', WORKSPACE_LAB_URL: 'http://127.0.0.1:4200',
  WORKSPACE_LAB_STORE: resolve(data, 'workspaces.json'), DEMO_MODE: 'true', MODEL_PROVIDER: provider,
  WORKSPACE_LAB_TOKEN: randomBytes(36).toString('base64url'), WORKSPACE_LAB_ADMIN_TOKEN: randomBytes(36).toString('base64url'),
  DEMO_SESSION_SECRET: process.env.DEMO_SESSION_SECRET || randomBytes(36).toString('base64url'),
};
delete env.RENDER_API_KEY;
// The runtime gets only the selected provider's credential.
if (provider === 'openai') delete env.GEMINI_API_KEY;
else delete env.OPENAI_API_KEY;
const graph = await FalkorDB.open({ path: resolve(data, 'graph'), falkordbVersion: 'v4.18.3',
  additionalConfig: { port: '16379', bind: '127.0.0.1', appendonly: 'yes', appendfsync: 'always', save: '""', maxmemory: '96mb', 'maxmemory-policy': 'noeviction' }, timeout: 30_000 });
const children: ChildProcess[] = [];
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); }, 8000);
  force.unref();
  await Promise.all(children.map(child => new Promise<void>(done => {
    if (child.exitCode !== null || child.signalCode) return done();
    child.once('exit', () => done()); child.kill('SIGTERM');
  })));
  clearTimeout(force); await graph.close();
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop(); });
const launch = (name: string, args: string[], childEnv: NodeJS.ProcessEnv) => {
  if (stopping) throw new Error('Hosted startup stopped');
  const child = spawn(process.execPath, args, { env: childEnv, stdio: 'inherit' }); children.push(child);
  child.once('error', () => { process.exitCode = 1; void stop(); });
  child.once('exit', code => { if (!stopping) { process.stderr.write(`${name} stopped (${code}); stopping the demonstration.\n`); process.exitCode = code || 1; void stop(); } });
};
const ready = async (url: string) => {
  for (let attempt = 0; attempt < 300 && !stopping; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* Wait for the service to bind. */ }
    await new Promise(done => setTimeout(done, 300));
  }
  throw new Error('A hosted service did not become ready');
};
try {
  const labEnv: NodeJS.ProcessEnv = { ...env }; delete labEnv.OPENAI_API_KEY; delete labEnv.GEMINI_API_KEY; delete labEnv.DEMO_ACCESS_CODE;
  launch('Workspace Lab', ['--import', 'tsx', 'apps/workspace-lab/src/main.ts'], labEnv);
  await ready('http://127.0.0.1:4200/health');
  launch('Runtime', ['--import', 'tsx', 'apps/runtime/src/main.ts'], env);
  await ready('http://127.0.0.1:4100/health');
  const webEnv: NodeJS.ProcessEnv = { ...env }; delete webEnv.OPENAI_API_KEY; delete webEnv.GEMINI_API_KEY; delete webEnv.DEMO_ACCESS_CODE; delete webEnv.DEMO_SESSION_SECRET; delete webEnv.WORKSPACE_LAB_TOKEN; delete webEnv.WORKSPACE_LAB_ADMIN_TOKEN;
  launch('Web', [resolve('node_modules/next/dist/bin/next'), 'start', 'apps/web', '-H', '0.0.0.0', '-p', String(port)], webEnv);
  process.stdout.write('Athena hosted demo started. Free storage is ephemeral; only historical evidence is seeded.\n');
} catch (error) { await stop(); throw error; }
