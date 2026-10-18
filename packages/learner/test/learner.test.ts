import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import seedJson from '../../../fixtures/company-history.json';
import { AppError, HistorySeedSchema, type CandidateContent, type Episode, type GraphStore, type ModelAdapter, type ModelCall } from '@athena/contracts';
import { assertEvidence } from '../../graph/src';
import { orderSteps } from '../../executor/src';
import { CandidateToolSchema, learnProcedure, LEARNING_TOOLS, LEARNING_SYSTEM_PROMPT } from '../src';

const seed = HistorySeedSchema.parse(seedJson);
const ref = seed.observations[0].evidenceRefs[0];
const fresh = (): Episode => ({ id: 'episode_test', mission: 'LEARN', targetId: 'learn_test', startedAt: new Date().toISOString(), endedAt: null, status: 'RUNNING', initialContextMessages: 0, modelTurns: 0, toolCalls: 0, activeMs: 0, inputTokens: 0, outputTokens: 0, model: null, error: null });
const candidate = () => ({ summary: 'Proposed behavior from historical cases.', observedPatterns: [{ text: 'Trials are created and configured.', evidenceRefs: [ref] }], uncertainties: [{ question: 'Which observed durations are normal and which require approval?', evidenceRefs: [ref] }], rules: [{ id: 'rule_normal', key: 'normalDurationDays', kind: 'scalar', value: 7, condition: null, outcome: null, requiredRoleId: null, status: 'PROPOSED', evidenceRefs: [ref], confirmationRefs: [] }], steps: [{ id: 'step_create', tool: 'create_workspace', dependsOn: [] as string[], bindings: [{ parameter: 'customerId', kind: 'request', key: 'customerId', stepId: null }], evidenceRefs: [ref], confirmationRefs: [] }] });
const hooks = () => ({ onUpdate: vi.fn(async (_episode: Episode) => {}), onEvent: vi.fn(async (_type: string, _message: string, _data?: Record<string, unknown>) => {}) });
const graph = () => ({
  getHistory: vi.fn(async () => ({ cases: seed.cases, observations: seed.observations, sources: seed.sources })),
  getDirectory: vi.fn(async () => ({ people: seed.people, roles: seed.roles, assignments: seed.roleAssignments, processes: seed.processes })),
  getSource: vi.fn(async (id: string, revision: number) => seed.sources.find(s => s.id === id && s.revision === revision) ?? null),
  validateEvidence: vi.fn(async (refs) => { assertEvidence(refs, seed.sources, seed.observations); }),
} as unknown as GraphStore);
function scripted(calls: ModelCall[]): ModelAdapter {
  let index = 0;
  return { mode: 'test', model: 'test-only', turn: vi.fn(async () => {
    const call = calls[index++];
    if (!call) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Test-only scripted model has no more responses');
    return { calls: [call], output: [{ type: 'function_call', name: call.name, call_id: call.id, arguments: JSON.stringify(call.arguments) }], text: '', inputTokens: 10, outputTokens: 5, model: 'test-only', responseId: `test_response_${index}` };
  }) };
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
    await expect(learnProcedure({ graph: graph(), model: scripted([...reads, { id: 'call_submit', name: 'submit_candidate', arguments: proposed }]), episode: fresh(), hooks: observed, processId: 'process_trial' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(observed.onEvent).toHaveBeenCalledWith('CANDIDATE_REJECTED', expect.stringContaining('literal excerpt'), expect.objectContaining({ code: 'INVALID_INPUT', rejectedProposal: proposed }));
    expect(observed.onEvent.mock.calls.some(call => call[0] === 'CANDIDATE_PROPOSED')).toBe(false);
    expect(observed.onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED' }));
  });
  test('returns actual structural feedback and accepts a corrected model proposal in the same episode', async () => {
    const invalid = candidate(); invalid.steps[0].dependsOn = ['create_workspace'];
    const corrected = candidate();
    const model = scripted([...reads, { id: 'invalid_submit', name: 'submit_candidate', arguments: invalid }, { id: 'corrected_submit', name: 'submit_candidate', arguments: corrected }]);
    const observed = hooks();
    const validateCandidate = vi.fn((content: CandidateContent) => { orderSteps(content.steps); });
    const result = await learnProcedure({ graph: graph(), model, episode: fresh(), hooks: observed, processId: 'process_trial', validateCandidate });
    expect(result.episode).toMatchObject({ id: 'episode_test', status: 'WAITING', modelTurns: 4, toolCalls: 4, inputTokens: 40, outputTokens: 20 });
    expect(validateCandidate).toHaveBeenCalledTimes(2);
    expect(result.candidate.steps[0].dependsOn).toEqual([]);
    expect(observed.onEvent).toHaveBeenCalledWith('CANDIDATE_REJECTED', 'Step dependencies contain a cycle or an unknown step', expect.objectContaining({ toolCallId: 'invalid_submit', rejectedProposal: invalid, code: 'INVALID_INPUT' }));
    const nextContext = vi.mocked(model.turn).mock.calls[3][0] as Array<{ type?: string; call_id?: string; output?: string }>;
    const feedback = nextContext.find(item => item.type === 'function_call_output' && item.call_id === 'invalid_submit');
    expect(JSON.parse(feedback!.output!)).toEqual({ accepted: false, error: { code: 'INVALID_INPUT', message: 'Step dependencies contain a cycle or an unknown step' } });
    expect(observed.onUpdate.mock.calls.filter(([episode]) => episode.status === 'WAITING')).toHaveLength(1);
    expect(observed.onUpdate.mock.calls.at(-2)?.[0]).toMatchObject({ status: 'RUNNING', modelTurns: 3, toolCalls: 3, endedAt: null });
  });
  test('repeated invalid proposals consume the original budget and never enter review', async () => {
    const invalid = candidate(); invalid.steps[0].dependsOn = ['step_create'];
    const observed = hooks();
    const model = scripted([...reads, ...Array.from({ length: 6 }, (_, index) => ({ id: `invalid_${index}`, name: 'submit_candidate', arguments: invalid }))]);
    await expect(learnProcedure({ graph: graph(), model, episode: fresh(), hooks: observed, processId: 'process_trial', validateCandidate: content => { orderSteps(content.steps); } })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(observed.onEvent.mock.calls.filter(call => call[0] === 'CANDIDATE_REJECTED')).toHaveLength(6);
    expect(observed.onEvent.mock.calls.some(call => call[0] === 'CANDIDATE_PROPOSED')).toBe(false);
    expect(observed.onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED', modelTurns: 8, toolCalls: 8, inputTokens: 80, outputTokens: 40 }));
    expect(vi.mocked(model.turn)).toHaveBeenCalledTimes(8);
  });
  test('strict-schema feedback can be corrected without weakening local validation', async () => {
    const malformed = { ...candidate(), extraPolicy: 'not allowed' };
    const observed = hooks();
    const result = await learnProcedure({ graph: graph(), model: scripted([...reads, { id: 'malformed', name: 'submit_candidate', arguments: malformed }, { id: 'fixed', name: 'submit_candidate', arguments: candidate() }]), episode: fresh(), hooks: observed, processId: 'process_trial' });
    expect(result.episode.status).toBe('WAITING');
    expect(observed.onEvent).toHaveBeenCalledWith('CANDIDATE_REJECTED', expect.stringContaining('strict schema validation'), expect.objectContaining({ code: 'INVALID_INPUT', rejectedProposal: malformed }));
    expect(result.candidate).not.toHaveProperty('extraPolicy');
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
  test('tool schemas use supported unions without changing discriminator semantics', () => {
    const original = z.toJSONSchema(CandidateToolSchema, { target: 'draft-7' });
    const wire = LEARNING_TOOLS.find(tool => tool.name === 'submit_candidate')!.parameters;
    let unions = 0;
    const compare = (source: any, target: any) => {
      if (!source || typeof source !== 'object') { expect(target).toEqual(source); return; }
      if (source.oneOf) {
        unions++;
        // Every converted union must have mutually exclusive literal tags.
        const variants = source.oneOf;
        const tags = Object.keys(variants[0].properties).filter(key => variants.every((variant: any) => variant.properties[key]?.const !== undefined));
        expect(tags.some(key => new Set(variants.map((variant: any) => variant.properties[key].const)).size === variants.length)).toBe(true);
        expect(target.oneOf).toBeUndefined();
        expect(target.anyOf).toHaveLength(variants.length);
      }
      for (const [key, value] of Object.entries(source)) {
        if (key !== '$schema') compare(value, target[key === 'oneOf' ? 'anyOf' : key]);
      }
    };
    compare(original, wire);
    expect(unions).toBeGreaterThan(0);
  });
  test('every tool object is strict and includes all properties as required', () => {
    const inspect = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const schema = value as Record<string, unknown>;
      expect(schema).not.toHaveProperty('oneOf');
      if (schema.type === 'object') { expect(schema.additionalProperties).toBe(false); expect(schema.required ?? []).toEqual(Object.keys(schema.properties as object ?? {})); }
      Object.values(schema).forEach(child => Array.isArray(child) ? child.forEach(inspect) : inspect(child));
    };
    LEARNING_TOOLS.forEach(tool => inspect(tool.parameters));
    expect(LEARNING_SYSTEM_PROMPT).not.toMatch(/\b(7|30|seven|thirty)\b/);
  });
});
