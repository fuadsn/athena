import { readFile } from 'node:fs/promises';
import { HistorySeedSchema } from '@athena/contracts';
import { createGraphStore } from '@athena/graph';
import { createModelAdapter, hasModelConfiguration } from '@athena/learner';
import { createLabClient } from '../../workspace-lab/src/client';
import { createRuntimeServer } from './server';

const graph = await createGraphStore();
const history = HistorySeedSchema.parse(JSON.parse(await readFile(new URL('../../../fixtures/company-history.json', import.meta.url), 'utf8')));
await graph.seed(history);
const token = process.env.WORKSPACE_LAB_TOKEN;
if (!token) throw new Error('WORKSPACE_LAB_TOKEN is required');
const lab = createLabClient({ url: process.env.WORKSPACE_LAB_URL ?? 'http://127.0.0.1:4200', token, adminToken: process.env.WORKSPACE_LAB_ADMIN_TOKEN });
const model = hasModelConfiguration() ? createModelAdapter() : null;
const { server, service } = createRuntimeServer({ graph, lab, model, history, demoMode: process.env.DEMO_MODE === 'true', sessionSecret: process.env.DEMO_SESSION_SECRET ?? '', approvalTtlSeconds: Number(process.env.APPROVAL_TTL_SECONDS ?? 900) });
const port = Number(process.env.RUNTIME_PORT ?? 4100), host = process.env.RUNTIME_HOST ?? '127.0.0.1';
server.listen(port, host, () => process.stdout.write(`Athena runtime at http://${host}:${port}; live model ${model ? 'configured' : 'not configured'}\n`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { server.close(() => { void service.waitForIdle().finally(() => graph.close()).finally(() => process.exit(0)); }); });
