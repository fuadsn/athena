import { readFile } from 'node:fs/promises';
import { HistorySeedSchema } from '@athena/contracts';
import { createGraphStore } from '@athena/graph';
const graph = await createGraphStore();
try {
  const history = HistorySeedSchema.parse(JSON.parse(await readFile('fixtures/company-history.json', 'utf8')));
  await graph.seed(history);
  const state = await graph.getState();
  console.log(JSON.stringify({ seeded: true, counts: state.counts, knowledgeRevision: state.knowledgeRevision }, null, 2));
} finally { await graph.close(); }
