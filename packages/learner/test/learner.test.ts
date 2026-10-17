import { describe, expect, test, vi } from 'vitest';
import seedJson from '../../../fixtures/company-history.json';
import { HistorySeedSchema, type Episode, type GraphStore, type ModelAdapter, type ModelCall } from '@athena/contracts';
import { assertEvidence } from '../../graph/src';
import { learnProcedure, LEARNING_TOOLS, LEARNING_SYSTEM_PROMPT } from '../src';

const seed = HistorySeedSchema.parse(seedJson);
const ref = seed.observations[0].evidenceRefs[0];
const fresh = (): Episode => ({ id: 'episode_test', mission: 'LEARN', targetId: 'learn_test', startedAt: new Date().toISOString(), endedAt: null, status: 'RUNNING', initialContextMessages: 0, modelTurns: 0, toolCalls: 0, activeMs: 0, inputTokens: 0, outputTokens: 0, model: null, error: null });
const candidate = () => ({ summary: 'Proposed behavior from historical cases.', observedPatterns: [{ text: 'Trials are created and configured.', evidenceRefs: [ref] }], uncertainties: [{ question: 'Which observed durations are normal and which require approval?', evidenceRefs: [ref] }], rules: [{ id: 'rule_normal', key: 'normalDurationDays', kind: 'scalar', value: 7, condition: null, outcome: null, requiredRoleId: null, status: 'PROPOSED', evidenceRefs: [ref], confirmationRefs: [] }], steps: [{ id: 'step_create', tool: 'create_workspace', dependsOn: [], bindings: [{ parameter: 'customerId', kind: 'request', key: 'customerId', stepId: null }], evidenceRefs: [ref], confirmationRefs: [] }] });
const hooks = () => ({ onUpdate: vi.fn(async (_episode: Episode) => {}), onEvent: vi.fn(async (_type: string, _message: string, _data?: Record<string, unknown>) => {}) });
const graph = () => ({
  getHistory: vi.fn(async () => ({ cases: seed.cases, observations: seed.observations, sources: seed.sources })),
  getDirectory: vi.fn(async () => ({ people: seed.people, roles: seed.roles, assignments: seed.roleAssignments, processes: seed.processes })),
  getSource: vi.fn(async (id: string, revision: number) => seed.sources.find(s => s.id === id && s.revision === revision) ?? null),
  validateEvidence: vi.fn(async (refs) => { assertEvidence(refs, seed.sources, seed.observations); }),
} as unknown as GraphStore);
function scripted(calls: ModelCall[]): ModelAdapter {
  let index = 0;
  return { mode: 'test', model: 'test-only', turn: vi.fn(async () => { const call = calls[index++]; return { calls: [call], output: [{ type: 'function_call', name: call.name, call_id: call.id, arguments: JSON.stringify(call.arguments) }], text: '', inputTokens: 10, outputTokens: 5, model: 'test-only', responseId: `test_response_${index}` }; }) };
}
const reads: ModelCall[] = [{ id: 'call_history', name: 'read_history', arguments: {} }, { id: 'call_directory', name: 'read_directory', arguments: {} }];

describe('bounded learning with test-only model adapters', () => {
  test('retrieves evidence, validates a proposed candidate, and ends waiting for human teaching', async () => {
    const model = scripted([...reads, { id: 'call_submit', name: 'submit_candidate', arguments: candidate() }]);
    const observed = hooks();
    const result = await learnProcedure({ graph: graph(), model, episode: fresh(), hooks: observed, processId: 'process_trial' });
    expect(result.episode).toMatchObject({ status: 'WAITING', initialContextMessages: 0, modelTurns: 3, toolCalls: 3, inputTokens: 30, outputTokens: 15 });
    expect(result.candidate.steps[0].bindings.customerId).toEqual({ kind: 'request', key: 'customerId', stepId: null });
    expect(result.candidate.rules[0].status).toBe('PROPOSED');
    expect(observed.onEvent).toHaveBeenCalledWith('CANDIDATE_PROPOSED', expect.any(String), expect.any(Object));
  });
  test('rejects fabricated citations instead of returning a candidate', async () => {
    const proposed = candidate(); proposed.observedPatterns[0].evidenceRefs = [{ ...ref, quote: 'fabricated statement', observationId: null }];
    const observed = hooks();
    await expect(learnProcedure({ graph: graph(), model: scripted([...reads, { id: 'call_submit', name: 'submit_candidate', arguments: proposed }]), episode: fresh(), hooks: observed, processId: 'process_trial' })).rejects.toThrow('literal excerpt');
    expect(observed.onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED' }));
  });
  test('malicious source cannot open a mutation tool surface', async () => {
    const observed = hooks();
    await expect(learnProcedure({ graph: graph(), model: scripted([{ id: 'attack', name: 'publish_procedure', arguments: { actorId: 'person_mira' } }]), episode: fresh(), hooks: observed, processId: 'process_trial' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(LEARNING_TOOLS.map(t => t.name)).toEqual(['read_history', 'read_directory', 'read_source', 'submit_candidate']);
  });
  test('rejects a model claiming its own confirmation', async () => {
    const proposed = candidate(); proposed.rules[0].status = 'CONFIRMED';
    await expect(learnProcedure({ graph: graph(), model: scripted([...reads, { id: 'submit', name: 'submit_candidate', arguments: proposed }]), episode: fresh(), hooks: hooks(), processId: 'process_trial' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  test('never carries prior episode counters into a new learning mission', async () => {
    await expect(learnProcedure({ graph: graph(), model: scripted([]), episode: { ...fresh(), modelTurns: 1 }, hooks: hooks(), processId: 'process_trial' })).rejects.toThrow('fresh episode');
  });
  test('repeated reading exhausts the model turn budget', async () => {
    await expect(learnProcedure({ graph: graph(), model: scripted(Array.from({ length: 9 }, (_, i) => ({ id: `call_${i}`, name: 'read_history', arguments: {} }))), episode: fresh(), hooks: hooks(), processId: 'process_trial' })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });
  test('a stalled model is bounded even if its adapter ignores cancellation', async () => {
    vi.useFakeTimers();
    try {
      const stalled: ModelAdapter = { mode: 'test', model: 'test-only-stalled', turn: async () => new Promise(() => {}) };
      const observed = hooks();
      const result = learnProcedure({ graph: graph(), model: stalled, episode: fresh(), hooks: observed, processId: 'process_trial' });
      const assertion = expect(result).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
      await vi.advanceTimersByTimeAsync(120_000);
      await assertion;
      expect(observed.onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED' }));
    } finally { vi.useRealTimers(); }
  });
  test('a stalled evidence read also exhausts the active-time budget', async () => {
    vi.useFakeTimers();
    try {
      const unavailable = graph(); unavailable.getHistory = async () => new Promise(() => {});
      const observed = hooks();
      const result = learnProcedure({ graph: unavailable, model: scripted(reads), episode: fresh(), hooks: observed, processId: 'process_trial' });
      const assertion = expect(result).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
      await vi.advanceTimersByTimeAsync(120_000); await assertion;
      expect(observed.onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED' }));
    } finally { vi.useRealTimers(); }
  });
  test('every tool object is strict and includes all properties as required', () => {
    const inspect = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const schema = value as Record<string, unknown>;
      if (schema.type === 'object') { expect(schema.additionalProperties).toBe(false); expect(schema.required ?? []).toEqual(Object.keys(schema.properties as object ?? {})); }
      Object.values(schema).forEach(child => Array.isArray(child) ? child.forEach(inspect) : inspect(child));
    };
    LEARNING_TOOLS.forEach(tool => inspect(tool.parameters));
    expect(LEARNING_SYSTEM_PROMPT).not.toMatch(/\b(7|30|seven|thirty)\b/);
  });
});
