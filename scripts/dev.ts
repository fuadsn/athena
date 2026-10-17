import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { FalkorDB as EmbeddedGraph } from 'falkordblite';
if (!existsSync('.env')) throw new Error('Run npm run setup first');
const production = process.argv.includes('--production');
if (production && !existsSync('apps/web/.next/BUILD_ID')) throw new Error('Run npm run build before npm run preview');
const children: ChildProcess[] = [];
let graph: EmbeddedGraph | undefined;
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(child => new Promise<void>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  })));
  await graph?.close();
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop(); });

if (process.argv.includes('--embedded')) {
  if (process.env.FALKORDB_PASSWORD) throw new Error('Embedded development mode requires an empty FALKORDB_PASSWORD; use Docker for password-protected instances');
  if (!['127.0.0.1', 'localhost', undefined].includes(process.env.FALKORDB_HOST)) throw new Error('Embedded development mode requires a loopback FALKORDB_HOST');
  const port = Number(process.env.FALKORDB_PORT ?? 16379);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local FALKORDB_PORT');
  const { FalkorDB } = await import('falkordblite');
  graph = await FalkorDB.open({
    path: resolve('.local/graph'),
    falkordbVersion: 'v4.18.3',
    additionalConfig: { port: String(port), bind: '127.0.0.1', appendonly: 'yes', appendfsync: 'always' },
    inheritStdio: true,
    timeout: 15_000,
  });
  process.env.FALKORDB_HOST = '127.0.0.1';
  process.env.FALKORDB_PORT = String(port);
  process.stdout.write(`Real embedded FalkorDB is listening on 127.0.0.1:${port}; persistent data: .local/graph\n`);
  if (stopping) { await graph.close(); process.exit(0); }
}
const launch = (label: string, args: string[]) => {
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
  children.push(child);
  child.on('exit', code => { if (!stopping) { process.stderr.write(`${label} exited with ${code}.\n`); process.exitCode = code ?? 1; void stop(); } });
  child.on('error', error => { process.stderr.write(`${label}: ${error.message}\n`); process.exitCode = 1; void stop(); });
};
launch('Workspace Lab', ['--env-file-if-exists=.env', '--import', 'tsx', 'apps/workspace-lab/src/main.ts']);
launch('Athena runtime', ['--env-file-if-exists=.env', '--import', 'tsx', 'apps/runtime/src/main.ts']);
launch('Web interface', [resolve('node_modules/next/dist/bin/next'), production ? 'start' : 'dev', 'apps/web', ...(production ? [] : ['--webpack']), '-H', '127.0.0.1', '-p', '3100']);
process.stdout.write('Athena local workspace: http://127.0.0.1:3100\n');
