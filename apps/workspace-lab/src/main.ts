import { resolve } from 'node:path';
import { createLabServer } from './server';

const token = process.env.WORKSPACE_LAB_TOKEN ?? process.env.LAB_TOKEN;
if (!token) throw new Error('WORKSPACE_LAB_TOKEN is required');
const port = Number(process.env.WORKSPACE_LAB_PORT ?? process.env.LAB_PORT ?? 4200);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('LAB_PORT must be a valid TCP port');
const host = process.env.WORKSPACE_LAB_HOST ?? process.env.LAB_HOST ?? '127.0.0.1';
const server = createLabServer({
  dataPath: resolve(process.env.WORKSPACE_LAB_STORE ?? process.env.LAB_DATA_PATH ?? '.local/workspace-lab.json'), token,
  adminToken: process.env.WORKSPACE_LAB_ADMIN_TOKEN ?? process.env.LAB_ADMIN_TOKEN,
  allowReset: process.env.DEMO_MODE === 'true',
});
server.listen(port, host, () => process.stdout.write(`Workspace Lab listening at http://${host}:${port}\n`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => process.exit(0)));
