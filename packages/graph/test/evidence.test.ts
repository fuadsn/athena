import { describe, expect, test, vi } from 'vitest';
import seedJson from '../../../fixtures/company-history.json';
import { HistorySeedSchema } from '@athena/contracts';
import { assertEvidence, assertSource, FalkorGraphStore, QUERIES, type QueryDriver } from '../src';

const seed = HistorySeedSchema.parse(seedJson);
describe('immutable, literal evidence boundary', () => {
  test('cold fixture contains valid hashed sources and no executable graph policy', async () => {
    seed.sources.forEach(assertSource);
    seed.observations.forEach(o => assertEvidence(o.evidenceRefs, seed.sources, seed.observations));
    const calls: string[] = [];
    const driver: QueryDriver = { query: async query => { calls.push(query); return { data: [] }; } };
    await new FalkorGraphStore(driver).seed(seed);
    expect(calls.at(-1)).toContain('HAS_OBSERVATION');
    expect(calls.at(-1)).toContain('HOLDS_ROLE');
    expect(calls.at(-1)).not.toMatch(/CREATE \([^)]*:(Procedure|Step|Rule|Plan|Approval)/);
  });
  test('rejects altered source text without a matching immutable hash', () => {
    expect(() => assertSource({ ...seed.sources[0], text: seed.sources[0].text + ' changed' })).toThrow('invalid content hash');
  });
  test('rejects fabricated quotes and mismatched observation provenance', () => {
    const ref = seed.people[0].evidenceRefs[0];
    expect(() => assertEvidence([{ ...ref, quote: 'This quote is fabricated.' }], seed.sources, seed.observations)).toThrow('literal excerpt');
    expect(() => assertEvidence([{ ...ref, quote: null, observationId: seed.observations[0].id }], seed.sources, seed.observations)).toThrow('does not support');
    expect(() => assertEvidence([{ ...ref, sourceId: 'missing_source' }], seed.sources, seed.observations)).toThrow('does not exist');
  });
  test('rejects dangling history references before any graph write', async () => {
    const invalid = structuredClone(seed); invalid.roleAssignments[0].personId = 'nonexistent';
    let calls = 0;
    const store = new FalkorGraphStore({ query: async () => { calls++; return { data: [] }; } });
    await expect(store.seed(invalid)).rejects.toThrow('Assignment person is missing');
    expect(calls).toBe(0);
  });
  test('retains every referenced immutable source revision when reading history', async () => {
    const original = seed.sources[0], newer = { ...original, revision: original.revision + 1 };
    const store = new FalkorGraphStore({ query: async query => ({ data: query === QUERIES.history ? [original, newer].map(source => ({ caseJson: JSON.stringify(seed.cases[0]), observationJson: JSON.stringify(seed.observations[0]), sourceJson: JSON.stringify(source) })) : [] }) });
    const history = await store.getHistory('process_trial');
    expect(history.sources.map(source => source.revision)).toEqual([1, 2]);
  });
  test('detects corruption of stored source text before returning it as evidence', async () => {
    const stored = { ...seed.sources[0], text: seed.sources[0].text + ' injected text without an updated immutable hash' };
    const store = new FalkorGraphStore({ query: async () => ({ data: [{ json: JSON.stringify(stored) }] }) });
    await expect(store.getSource(stored.id, stored.revision)).rejects.toThrow('invalid content hash');
  });
});

describe('graph authority and dependency failures', () => {
  test('does not fall back when FalkorDB is unavailable', async () => {
    const store = new FalkorGraphStore({ query: async () => { throw new Error('connection refused'); } });
    await expect(store.getCurrentProcedure('process_trial')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
  test('requires exactly one active role relationship', async () => {
    const empty = new FalkorGraphStore({ query: async () => ({ data: [] }) });
    await expect(empty.resolveAuthority('role_trial_extension_approver', new Date().toISOString())).rejects.toMatchObject({ code: 'AMBIGUOUS_AUTHORITY' });
    const duplicate = new FalkorGraphStore({ query: async () => ({ data: [{}, {}] }) });
    await expect(duplicate.resolveAuthority('role_trial_extension_approver', new Date().toISOString())).rejects.toMatchObject({ code: 'AMBIGUOUS_AUTHORITY' });
  });
  test('all five mandatory graph paths are fixed parameterized queries', () => {
    expect(QUERIES.history).toContain('HAS_OBSERVATION');
    expect(QUERIES.steps).toContain('PRECEDES');
    expect(QUERIES.rules).toContain('REQUIRES_ROLE');
    expect(QUERIES.authority).toContain('assignment.validTo');
    expect(QUERIES.approvalAuthority).toContain('APPROVES');
    expect(QUERIES.approvalAuthority).toContain('HOLDS_ROLE');
    expect(QUERIES.receipts).toContain('HAS_RECEIPT');
    expect(QUERIES.verification).toContain('HAS_VERIFICATION');
  });
});

describe('concurrent query evidence isolation', () => {
  test('overlapping episodes and UI polling drain only their own query evidence', async () => {
    const store = new FalkorGraphStore({ query: async () => ({ data: [] }) });
    const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
    const aStarted = deferred(), bStarted = deferred(), releaseA = deferred(), releaseB = deferred();
    const episodeA = store.withTraceScope(async () => {
      await store.getSource('source_episode_a_before', 1); aStarted.resolve(); await releaseA.promise;
      await store.getSource('source_episode_a_after', 1);
      const traces = store.drainTraces(); expect(store.drainTraces()).toEqual([]); return traces;
    });
    const episodeB = store.withTraceScope(async () => {
      await store.getSource('source_episode_b_before', 1); bStarted.resolve(); await releaseB.promise;
      await store.getSource('source_episode_b_after', 1); return store.drainTraces();
    });
    await Promise.all([aStarted.promise, bStarted.promise]);
    await store.getSource('source_ui_poll', 1);
    releaseB.resolve(); const b = await episodeB;
    releaseA.resolve(); const a = await episodeA;
    expect(a.map(t => t.parameters.id)).toEqual(['source_episode_a_before', 'source_episode_a_after']);
    expect(b.map(t => t.parameters.id)).toEqual(['source_episode_b_before', 'source_episode_b_after']);
    expect(store.drainTraces().map(t => t.parameters.id)).toEqual(['source_ui_poll']);
  });
  test('nested and failed scopes restore their parent without leaking evidence', async () => {
    const store = new FalkorGraphStore({ query: async () => ({ data: [] }) });
    const parent = await store.withTraceScope(async () => {
      await store.getSource('source_parent_before', 1);
      await expect(store.withTraceScope(async () => { await store.getSource('source_failed_child', 1); throw new Error('test episode failure'); })).rejects.toThrow('test episode failure');
      await store.getSource('source_parent_after', 1); return store.drainTraces();
    });
    expect(parent.map(t => t.parameters.id)).toEqual(['source_parent_before', 'source_parent_after']);
    expect(store.drainTraces()).toEqual([]);
  });
});

describe('bounded graph I/O', () => {
  test('retires a timed-out connection and refuses to retry behind an uncertain query', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0; const disconnect = vi.fn(async () => {});
      const store = new FalkorGraphStore({ query: async () => { calls++; return new Promise(() => {}); } }, disconnect, { queryTimeoutMs: 50 });
      const pending = expect(store.ping()).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', message: expect.stringContaining('timed out') });
      await vi.advanceTimersByTimeAsync(50); await pending;
      expect(disconnect).toHaveBeenCalledTimes(1);
      await expect(store.getKnowledgeRevision()).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
      expect(calls).toBe(1); await store.close(); expect(disconnect).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  test('clears a successful query deadline so it cannot retire a healthy connection later', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0; const disconnect = vi.fn(async () => {});
      const store = new FalkorGraphStore({ query: async () => { calls++; return { data: [] }; } }, disconnect, { queryTimeoutMs: 50 });
      await store.ping(); await vi.advanceTimersByTimeAsync(500);
      await store.ping(); expect(calls).toBe(2); expect(disconnect).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
