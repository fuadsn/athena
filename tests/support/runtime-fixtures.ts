/** Explicit test doubles. Runtime production code must never import this module. */
import {
  AppError, stableStringify, type GraphStore, type HistorySeed, type State, type Source, type EvidenceRef,
  type Procedure, type Assignment, type LearningRun, type TrialRequest, type Plan, type Approval,
  type Episode, type ToolReceipt, type Verification, type Event, type ModelAdapter, type ModelTool,
} from '@athena/contracts';
import { assertEvidence, assertSource } from '../../packages/graph/src';
import { makeConfirmation, makeProcedure } from '../../packages/graph/test/fixtures';

const copy = <T>(value: T): T => structuredClone(value);

/** Tests runtime control flow only. This is not a FalkorDB implementation or fallback. */
export class TestOnlyGraphStore implements GraphStore {
  available = true;
  failReceiptOnce = false;
  revision = 0;
  private history!: HistorySeed;
  private sources = new Map<string, Source>();
  private procedures = new Map<string, Procedure>();
  private learning = new Map<string, LearningRun>();
  private requests = new Map<string, TrialRequest>();
  private plans = new Map<string, Plan>();
  private approvals = new Map<string, Approval>();
  private episodes = new Map<string, Episode>();
  private receipts = new Map<string, ToolReceipt>();
  private verifications = new Map<string, Verification>();
  private events: Event[] = [];
  private assignments: Assignment[] = [];
  constructor(seed: HistorySeed) { this.replace(seed); }
  private check() { if (!this.available) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Injected test graph outage', 503); }
  private replace(seed: HistorySeed) {
    this.history = copy(seed); this.revision = 0;
    this.sources = new Map(seed.sources.map(s => [`${s.id}@${s.revision}`, copy(s)]));
    this.procedures.clear(); this.learning.clear(); this.requests.clear(); this.plans.clear(); this.approvals.clear(); this.episodes.clear(); this.receipts.clear(); this.verifications.clear(); this.events = []; this.assignments = copy(seed.roleAssignments);
  }
  async close() {}
  async ping() { this.check(); }
  async seed(seed: HistorySeed) { this.check(); if (seed.datasetId !== this.history.datasetId) throw new AppError('CONFLICT', 'Different test dataset'); }
  async reset(seed: HistorySeed) { this.check(); this.replace(seed); }
  async getDirectory() { this.check(); return copy({ people: this.history.people, roles: this.history.roles, processes: this.history.processes, assignments: this.assignments }); }
  async getKnowledgeRevision() { this.check(); return this.revision; }
  async getState(): Promise<State> {
    this.check(); return copy({ ...await this.getDirectory(), knowledgeRevision: this.revision, counts: { Case: this.history.cases.length, Source: this.sources.size, Procedure: this.procedures.size, Approval: this.approvals.size }, cases: this.history.cases, procedures: [...this.procedures.values()], requests: [...this.requests.values()], learningRuns: [...this.learning.values()] });
  }
  async getHistory(processId: string, caseIds: string[] = []) {
    this.check(); const cases = this.history.cases.filter(c => c.processId === processId && (!caseIds.length || caseIds.includes(c.id)));
    if (caseIds.some(id => !cases.some(c => c.id === id))) throw new AppError('NOT_FOUND', 'Missing test history case');
    const observations = this.history.observations.filter(o => cases.some(c => c.id === o.caseId));
    const sourceIds = new Set([...cases.flatMap(c => c.sourceRefs), ...observations.flatMap(o => o.evidenceRefs)].map(r => `${r.sourceId}@${r.revision}`));
    return copy({ cases, observations, sources: [...this.sources.entries()].filter(([key]) => sourceIds.has(key)).map(([, source]) => source) });
  }
  async getSource(id: string, revision?: number) { this.check(); return copy([...this.sources.values()].filter(s => s.id === id && (revision === undefined || s.revision === revision)).sort((a, b) => b.revision - a.revision)[0] ?? null); }
  async validateEvidence(refs: EvidenceRef[]) { this.check(); assertEvidence(refs, [...this.sources.values()], this.history.observations); }
  async getCurrentProcedure(processId: string) { this.check(); return copy([...this.procedures.values()].find(p => p.processId === processId && p.status === 'PUBLISHED') ?? null); }
  async getProcedure(id: string) { this.check(); return copy(this.procedures.get(id) ?? null); }
  async saveDraft(procedure: Procedure) { this.check(); if (this.procedures.get(procedure.id)?.status === 'PUBLISHED') throw new AppError('CONFLICT', 'Immutable test procedure'); this.procedures.set(procedure.id, copy(procedure)); }
  async publish(procedure: Procedure, source: Source, actorId: string, expectedRevision: number) {
    this.check(); if (!this.history.processes.some(p => p.id === procedure.processId && p.ownerPersonId === actorId)) throw new AppError('FORBIDDEN', 'Only owner may publish');
    if (this.revision !== expectedRevision) throw new AppError('STALE_PLAN', 'Test knowledge changed', 409);
    assertSource(source); this.sources.set(`${source.id}@${source.revision}`, copy(source));
    await this.validateEvidence([...procedure.rules, ...procedure.steps].flatMap(x => [...x.evidenceRefs, ...x.confirmationRefs]));
    for (const previous of this.procedures.values()) if (previous.processId === procedure.processId && previous.status === 'PUBLISHED') previous.status = 'SUPERSEDED';
    const published = { ...procedure, status: 'PUBLISHED' as const, knowledgeRevision: ++this.revision, publishedAt: new Date().toISOString(), publishedBy: actorId, confirmationSourceId: source.id };
    this.procedures.set(published.id, copy(published)); return copy(published);
  }
  async resolveAuthority(roleId: string, now: string) {
    this.check(); const assignments = this.assignments.filter(a => a.roleId === roleId && a.validFrom <= now && (a.validTo === null || a.validTo > now));
    if (assignments.length !== 1) throw new AppError('AMBIGUOUS_AUTHORITY', 'No unique test role holder', 409);
    const assignment = assignments[0]; const person = this.history.people.find(p => p.id === assignment.personId)!;
    await this.validateEvidence(assignment.evidenceRefs); return copy({ person, assignment });
  }
  async assignAuthority(roleId: string, personId: string, actorId: string, expectedRevision: number, source: Source) {
    this.check(); if (!this.history.processes.some(p => p.ownerPersonId === actorId)) throw new AppError('FORBIDDEN', 'Only owner may assign');
    if (this.revision !== expectedRevision) throw new AppError('STALE_PLAN', 'Test knowledge changed', 409);
    const now = new Date().toISOString(), revision = Math.max(0, ...this.assignments.filter(a => a.roleId === roleId).map(a => a.revision)) + 1;
    for (const assignment of this.assignments) if (assignment.roleId === roleId && (!assignment.validTo || assignment.validTo > now)) assignment.validTo = now;
    const assignment: Assignment = { id: `assignment_test_${revision}`, personId, roleId, revision, validFrom: now, validTo: null, evidenceRefs: [{ sourceId: source.id, revision: source.revision, quote: source.text, observationId: null }] };
    this.sources.set(`${source.id}@${source.revision}`, copy(source)); this.assignments.push(copy(assignment)); this.revision++; return copy(assignment);
  }
  async saveLearningRun(run: LearningRun) { this.check(); this.learning.set(run.id, copy(run)); }
  async getLearningRun(id: string) { this.check(); const run = this.learning.get(id); return run ? copy({ run, candidate: run.procedureId ? this.procedures.get(run.procedureId) ?? null : null, episode: this.episodes.get(run.episodeId) ?? null, events: this.events.filter(e => e.targetId === id) }) : null; }
  async saveRequest(request: TrialRequest) { this.check(); this.requests.set(request.id, copy(request)); }
  async findRequestByKey(key: string) { this.check(); return copy([...this.requests.values()].find(r => r.idempotencyKey === key) ?? null); }
  async getRequest(id: string) {
    this.check(); const request = this.requests.get(id); if (!request) return null;
    return copy({ request, plan: request.currentPlanId ? this.plans.get(request.currentPlanId) ?? null : null, approvals: [...this.approvals.values()].filter(a => a.requestId === id && a.planId === request.currentPlanId), episodes: [...this.episodes.values()].filter(e => e.targetId === id), receipts: [...this.receipts.values()].filter(r => r.requestId === id), verification: [...this.verifications.values()].filter(v => v.requestId === id).at(-1) ?? null, events: this.events.filter(e => e.targetId === id) });
  }
  async savePlan(plan: Plan) { this.check(); const old = this.plans.get(plan.id); if (old && stableStringify(old) !== stableStringify(plan)) throw new AppError('CONFLICT', 'Immutable test plan'); this.plans.set(plan.id, copy(plan)); }
  async getPlan(id: string) { this.check(); return copy(this.plans.get(id) ?? null); }
  async saveApproval(approval: Approval) { this.check(); this.approvals.set(approval.id, copy(approval)); }
  async saveEpisode(episode: Episode) { this.check(); this.episodes.set(episode.id, copy(episode)); }
  async saveReceipt(receipt: ToolReceipt) { this.check(); if (this.failReceiptOnce) { this.failReceiptOnce = false; throw new AppError('DEPENDENCY_UNAVAILABLE', 'Injected receipt write interruption', 503); } this.receipts.set(receipt.operationKey, copy(receipt)); }
  async saveVerification(verification: Verification) { this.check(); this.verifications.set(verification.id, copy(verification)); }
  async appendEvent(event: Omit<Event, 'sequence'>) { this.check(); const saved = { ...event, sequence: this.events.length + 1 }; this.events.push(copy(saved)); return copy(saved); }
  async getEvents(after = 0, targetId?: string) { this.check(); return copy(this.events.filter(e => e.sequence > after && (!targetId || e.targetId === targetId))); }
  drainTraces() { return []; }
}

export const proposedWireCandidate = () => {
  const procedure = makeProcedure(makeConfirmation());
  return {
    summary: procedure.summary, observedPatterns: procedure.observedPatterns,
    uncertainties: [{ question: 'The examples include seven-day and thirty-day trials. Which is normal, and does the exception need a current role holder approval each time?', evidenceRefs: procedure.observedPatterns[0].evidenceRefs }],
    rules: procedure.rules.map(rule => ({ ...rule, status: 'PROPOSED' as const, confirmationRefs: [] })),
    steps: procedure.steps.map(step => ({ ...step, confirmationRefs: [], bindings: Object.entries(step.bindings).map(([parameter, value]) => ({ parameter, ...value })) })),
  };
};

/** Deterministic test model, visibly mode=test; never exported by production adapters. */
export function createTestOnlyModel(): ModelAdapter & { contexts: unknown[][] } {
  let count = 0;
  const contexts: unknown[][] = [];
  return {
    mode: 'test', model: 'test-only-scripted-tools', contexts,
    async turn(input: unknown[], tools: ModelTool[]) {
      contexts.push(copy(input)); count++;
      let name: string, args: unknown;
      if (tools.some(tool => tool.name === 'submit_candidate')) {
        const calls = input.filter(item => !!item && typeof item === 'object' && (item as { type?: string }).type === 'function_call') as { name: string }[];
        name = !calls.some(c => c.name === 'read_history') ? 'read_history' : !calls.some(c => c.name === 'read_directory') ? 'read_directory' : 'submit_candidate';
        args = name === 'submit_candidate' ? proposedWireCandidate() : {};
      } else {
        const tool = tools[0]; name = tool.name;
        const properties = tool.parameters.properties as Record<string, { enum: unknown[] }>;
        args = Object.fromEntries(Object.entries(properties).map(([key, schema]) => [key, schema.enum[0]]));
      }
      const call = { id: `test_call_${count}`, name, arguments: args };
      return { output: [{ type: 'function_call', call_id: call.id, name, arguments: JSON.stringify(args) }], calls: [call], text: '', inputTokens: 10, outputTokens: 5, model: 'test-only-scripted-tools', responseId: `test_response_${count}` };
    },
  };
}
