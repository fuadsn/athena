import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppError, planHash, textHash, type Approval, type Assignment, type GraphStore, type Person,
  type Plan, type Procedure, type RequestDetail, type Review, type Source, type ToolReceipt,
  type TrialRequest, type Verification,
} from '@athena/contracts';
import { WorkspaceLab } from '../../../apps/workspace-lab/src/application';
import { assertEvidence } from '../../graph/src';
import { makeConfirmation, makeProcedure, seed } from '../../graph/test/fixtures';
import { executePlan, guardPlan, makePlan, MutationBroker, orderSteps, reviewedProcedure, validateProcedure, verifyPlan, type ExecutionHooks } from './index';

const review = (normalDurationDays = 9): Review => ({ normalDurationDays, extendedDurationDays: 30, accessRole: 'member', extensionApprovalRoleId: 'role_trial_extension_approver', configureWhileInactive: true, activateAfterConfiguration: true, confirmAllFields: true });
function confirmationFor(normalDays = 9): Source {
  const confirmation = makeConfirmation();
  confirmation.text = `As process owner, I explicitly confirm normal trials last ${normalDays} days and extended trials last 30 days. Extensions require the current Trial Extension Approver. Grant only member access; configure expiry and access while inactive before activation.`;
  confirmation.contentHash = textHash(confirmation.text);
  return confirmation;
}

/** Deliberately test-only graph double. Application state always uses the real file-backed Lab. */
function graphFixture(normalDays = 9, requestedDays: number | null = null) {
  const confirmation = confirmationFor(normalDays);
  const procedure = reviewedProcedure(makeProcedure(confirmation), review(normalDays), confirmation, 1, 0);
  const timestamp = new Date().toISOString();
  const request: TrialRequest = { id: 'request_executor_test', processId: 'process_trial', customerId: 'customer_new', customerName: 'New company', ownerEmail: 'owner@new.example', requestedDays, revision: 1, idempotencyKey: 'request_key', inputHash: 'test_input_hash', requestedBy: 'person_ana', createdAt: timestamp, updatedAt: timestamp, state: 'READY', reason: null, errorCode: null, currentPlanId: null };
  const state: {
    procedure: Procedure | null; revision: number; request: TrialRequest; plan: Plan | null;
    approvals: Approval[]; receipts: ToolReceipt[]; verification: Verification | null;
    authority: { person: Person; assignment: Assignment }; available: boolean; authorityMissing: boolean;
    failReceiptStep: string | null;
  } = {
    procedure, revision: 1, request, plan: null, approvals: [], receipts: [], verification: null,
    authority: { person: structuredClone(seed.people.find(person => person.id === 'person_ravi')!), assignment: structuredClone(seed.roleAssignments[0]) },
    available: true, authorityMissing: false, failReceiptStep: null,
  };
  const requireAvailable = () => { if (!state.available) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Test graph outage', 503); };
  const graph = {
    getCurrentProcedure: vi.fn(async (_processId: string) => { requireAvailable(); return structuredClone(state.procedure); }),
    getKnowledgeRevision: vi.fn(async () => { requireAvailable(); return state.revision; }),
    validateEvidence: vi.fn(async refs => { requireAvailable(); assertEvidence(refs, [...seed.sources, confirmation], seed.observations); }),
    getDirectory: vi.fn(async () => { requireAvailable(); return { people: seed.people, roles: seed.roles, assignments: [state.authority.assignment], processes: seed.processes }; }),
    getSource: vi.fn(async (id: string, revision?: number) => { requireAvailable(); return [...seed.sources, confirmation].find(source => source.id === id && (!revision || source.revision === revision)) ?? null; }),
    resolveAuthority: vi.fn(async (_roleId: string, _at: string) => { requireAvailable(); if (state.authorityMissing) throw new AppError('AMBIGUOUS_AUTHORITY', 'No unique current role holder', 409); return structuredClone(state.authority); }),
    getPlan: vi.fn(async (id: string) => { requireAvailable(); return id === state.plan?.id ? structuredClone(state.plan) : null; }),
    getRequest: vi.fn(async (id: string): Promise<RequestDetail | null> => {
      requireAvailable();
      return id === state.request.id ? structuredClone({ request: state.request, plan: state.plan, approvals: state.approvals, receipts: state.receipts, verification: state.verification, episodes: [], events: [] }) : null;
    }),
    saveRequest: vi.fn(async (next: TrialRequest) => { requireAvailable(); state.request = structuredClone(next); }),
    saveReceipt: vi.fn(async (receipt: ToolReceipt) => {
      requireAvailable();
      if (state.failReceiptStep === receipt.stepId) { state.failReceiptStep = null; throw new AppError('DEPENDENCY_UNAVAILABLE', 'Test graph receipt write interrupted', 503); }
      state.receipts = [...state.receipts.filter(item => item.operationKey !== receipt.operationKey), structuredClone(receipt)];
    }),
    saveVerification: vi.fn(async (verification: Verification) => { requireAvailable(); state.verification = structuredClone(verification); }),
  } as unknown as GraphStore;
  const hooks: ExecutionHooks = {
    onEvent: vi.fn(async (_type, _message, _data) => undefined),
    onState: vi.fn(async next => { state.request.state = next; }),
  };
  return { state, graph, confirmation, hooks };
}

describe('executor plans, guards and real Workspace Lab effects', () => {
  let directory: string;
  let dataPath: string;
  let lab: WorkspaceLab;
  let clock: Date;
  let fixture: ReturnType<typeof graphFixture>;
  let broker: MutationBroker;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'athena-executor-'));
    dataPath = join(directory, 'state.json');
    clock = new Date();
    lab = new WorkspaceLab({ dataPath, now: () => clock });
    fixture = graphFixture();
    broker = new MutationBroker();
  });
  afterEach(async () => { await lab.close(); await rm(directory, { recursive: true, force: true }); });

  async function plan(requestedDays: number | null = null, normalDays = 9): Promise<Plan> {
    fixture = graphFixture(normalDays, requestedDays);
    const result = await makePlan(fixture.graph, fixture.state.request);
    fixture.state.plan = result;
    fixture.state.request.currentPlanId = result.id;
    return result;
  }

  function approve(value: Plan, patch: Partial<Approval> = {}): Approval {
    const approval: Approval = { id: 'approval_test', requestId: value.requestId, planId: value.id, planHash: value.planHash, actorId: value.approverPersonId!, roleId: value.requiredApprovalRoleId!, assignmentRevision: value.assignmentRevision!, knowledgeRevision: value.knowledgeRevision, decision: 'APPROVED', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), ...patch };
    fixture.state.approvals.push(approval);
    return approval;
  }

  async function execute(value: Plan, hooks: ExecutionHooks = fixture.hooks) { return executePlan(fixture.graph, lab, broker, value, hooks); }
  async function alterResource(change: (workspace: Record<string, unknown>, state: Record<string, unknown>) => void) {
    const persisted = JSON.parse(await readFile(dataPath, 'utf8'));
    change(persisted.workspaces[0], persisted);
    await writeFile(dataPath, JSON.stringify(persisted));
  }

  it('resolves omitted duration to human-confirmed nine days and independently verifies actual work', async () => {
    const value = await plan();
    expect(value.parameters.durationDays).toBe(9);
    expect(value.requiredApprovalRoleId).toBeNull();
    const verification = await execute(value);
    expect(verification.passed).toBe(true);
    expect(fixture.state.request.state).toBe('COMPLETED');
    const workspace = (await lab.list(value.requestId))[0];
    expect(Date.parse(workspace.expiresAt!) - Date.parse(workspace.createdAt)).toBe(9 * 86_400_000);
    expect(workspace.grants).toEqual([{ email: value.parameters.ownerEmail, role: 'member' }]);
    expect(fixture.state.receipts).toHaveLength(4);
    expect(fixture.graph.validateEvidence).toHaveBeenCalled();
  });

  it('preserves unsupported fourteen-day requests and asks for clarification before mutation', async () => {
    fixture = graphFixture(7, 14);
    await expect(makePlan(fixture.graph, fixture.state.request)).rejects.toMatchObject({ code: 'UNSUPPORTED_REQUEST' });
    expect(fixture.state.request.requestedDays).toBe(14);
    expect(await lab.list(fixture.state.request.id)).toEqual([]);
  });

  it('requires a published capability and valid evidence instead of any local fallback', async () => {
    fixture.state.procedure = null;
    await expect(makePlan(fixture.graph, fixture.state.request)).rejects.toMatchObject({ code: 'NEEDS_TEACHING' });
    fixture = graphFixture();
    fixture.state.procedure!.rules[0].confirmationRefs[0].quote = 'fabricated owner consent';
    await expect(makePlan(fixture.graph, fixture.state.request)).rejects.toThrow('literal excerpt');
    expect(await lab.list(fixture.state.request.id)).toEqual([]);
  });

  it('compiles explicit owner review into confirmations without treating history as approval', () => {
    const confirmation = confirmationFor();
    const candidate = makeProcedure(confirmation);
    const before = structuredClone(candidate);
    const reviewed = reviewedProcedure(candidate, review(), confirmation, 2, 8);
    expect(candidate).toEqual(before);
    expect(reviewed).toMatchObject({ status: 'PUBLISHED', version: 2, knowledgeRevision: 9, publishedBy: 'person_mira', confirmationSourceId: confirmation.id });
    expect(reviewed.rules.find(rule => rule.key === 'normalDurationDays')?.value).toBe(9);
    expect([...reviewed.rules, ...reviewed.steps].every(item => item.confirmationRefs.some(ref => ref.sourceId === confirmation.id))).toBe(true);
    const missingRuleConfirmation = structuredClone(reviewed);
    missingRuleConfirmation.rules[0].confirmationRefs = [];
    expect(() => validateProcedure(missingRuleConfirmation, true)).toThrow('human confirmation');
    const missingStepConfirmation = structuredClone(reviewed);
    missingStepConfirmation.steps[0].confirmationRefs = [];
    expect(() => validateProcedure(missingStepConfirmation, true)).toThrow('human confirmation');
    expect(() => reviewedProcedure(candidate, { ...review(), confirmAllFields: false } as unknown as Review, confirmation, 2, 8)).toThrow();
  });

  it.each(['duplicate', 'cycle', 'unknown'] as const)('rejects %s step dependencies', kind => {
    const steps = structuredClone(fixture.state.procedure!.steps);
    if (kind === 'duplicate') steps[1].id = steps[0].id;
    if (kind === 'cycle') steps[0].dependsOn = ['activate'];
    if (kind === 'unknown') steps[0].dependsOn = ['missing_step'];
    expect(() => orderSteps(steps)).toThrow();
  });

  it.each(['missing_create_dependency', 'early_activation', 'wrong_owner_binding', 'unknown_scalar'] as const)('rejects unsafe procedure variant %s', variant => {
    const procedure = structuredClone(fixture.state.procedure!);
    if (variant === 'missing_create_dependency') procedure.steps.find(step => step.tool === 'set_expiry')!.dependsOn = [];
    if (variant === 'early_activation') procedure.steps.find(step => step.tool === 'activate_workspace')!.dependsOn = ['create'];
    if (variant === 'wrong_owner_binding') procedure.steps.find(step => step.tool === 'grant_access')!.bindings.email.key = 'customerId';
    if (variant === 'unknown_scalar') {
      const branch = procedure.rules.find(rule => rule.key === 'normal')!;
      if (branch.condition?.op === 'eq') branch.condition.right = { kind: 'rule', key: 'unconfirmed_duration' };
    }
    expect(() => validateProcedure(procedure, true)).toThrow();
  });

  it('blocks extensions until a matching current approval exists', async () => {
    const value = await plan(30);
    expect(value.approverPersonId).toBe('person_ravi');
    await expect(execute(value)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(await lab.list(value.requestId)).toEqual([]);
    approve(value);
    expect((await execute(value)).passed).toBe(true);
    expect((await lab.list(value.requestId))).toHaveLength(1);
  });

  it.each(['wrong_hash', 'wrong_actor', 'wrong_role', 'wrong_revision', 'expired', 'rejected'] as const)('rejects %s approval before any mutation', async variant => {
    const value = await plan(30);
    const changes: Record<typeof variant, Partial<Approval>> = {
      wrong_hash: { planHash: 'different_hash' }, wrong_actor: { actorId: 'person_leena' }, wrong_role: { roleId: 'unrelated_role' },
      wrong_revision: { assignmentRevision: value.assignmentRevision! + 1 }, expired: { expiresAt: new Date(Date.now() - 1).toISOString() }, rejected: { decision: 'REJECTED' },
    };
    approve(value, changes[variant]);
    await expect(execute(value)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(await lab.list(value.requestId)).toEqual([]);
  });

  it.each(['knowledge', 'request', 'procedure', 'holder', 'assignment'] as const)('invalidates the plan after %s changes', async variant => {
    const value = await plan(30);
    approve(value);
    if (variant === 'knowledge') fixture.state.revision += 1;
    if (variant === 'request') fixture.state.request.revision += 1;
    if (variant === 'procedure') fixture.state.procedure!.id = 'procedure_new';
    if (variant === 'holder') fixture.state.authority.person = seed.people.find(person => person.id === 'person_leena')!;
    if (variant === 'assignment') fixture.state.authority.assignment.revision += 1;
    await expect(execute(value)).rejects.toMatchObject({ code: 'STALE_PLAN' });
    expect(await lab.list(value.requestId)).toEqual([]);
  });

  it('does not authorize an approval that expires while graph revalidation is in flight', async () => {
    vi.useFakeTimers();
    try {
      const value = await plan(30);
      approve(value, { expiresAt: new Date(Date.now() + 10).toISOString() });
      const original = fixture.graph.getCurrentProcedure;
      let delayed = false;
      fixture.graph.getCurrentProcedure = async processId => {
        if (!delayed) { delayed = true; await new Promise(resolve => setTimeout(resolve, 20)); }
        return original(processId);
      };
      const outcome = guardPlan(fixture.graph, value).then(result => ({ result, error: null }), error => ({ result: null, error }));
      await vi.advanceTimersByTimeAsync(25);
      expect((await outcome).error).toMatchObject({ code: 'APPROVAL_REQUIRED' });
    } finally { vi.useRealTimers(); }
  });

  it('blocks missing authority and graph outages without guessing history', async () => {
    fixture = graphFixture(7, 30);
    fixture.state.authorityMissing = true;
    await expect(makePlan(fixture.graph, fixture.state.request)).rejects.toMatchObject({ code: 'AMBIGUOUS_AUTHORITY' });
    const value = await plan();
    fixture.state.available = false;
    await expect(execute(value)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(await lab.list(value.requestId)).toEqual([]);
  });

  it('does not revive a rejected request', async () => {
    const value = await plan(30);
    approve(value);
    fixture.state.request.state = 'REJECTED';
    await expect(guardPlan(fixture.graph, value)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(['create', 'expiry', 'activate'] as const)('reconciles a committed %s after graph receipt persistence fails', async stepId => {
    const value = await plan();
    fixture.state.failReceiptStep = stepId;
    await expect(execute(value)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    const committed = await lab.operation(`${value.requestId}/${stepId}`);
    expect(committed).not.toBeNull();
    const createdAt = (await lab.list(value.requestId))[0].createdAt;
    clock = new Date(clock.getTime() + 3_600_000);
    await lab.close();
    lab = new WorkspaceLab({ dataPath, now: () => clock });
    const verification = await execute(value);
    expect(verification.passed).toBe(true);
    const resources = await lab.list(value.requestId);
    expect(resources).toHaveLength(1);
    expect(resources[0].createdAt).toBe(createdAt);
    expect(resources[0].expiresAt).toBe(new Date(Date.parse(createdAt) + 9 * 86_400_000).toISOString());
    expect(fixture.state.receipts).toHaveLength(4);
  });

  it('rechecks graph authority between steps and preserves honest inactive partial work', async () => {
    const value = await plan(30);
    approve(value);
    const hooks: ExecutionHooks = { ...fixture.hooks, selectAction: async step => {
      if (step.tool === 'set_expiry') await broker.run(async () => { fixture.state.revision += 1; fixture.state.authority.assignment.revision += 1; });
    } };
    await expect(execute(value, hooks)).rejects.toMatchObject({ code: 'STALE_PLAN' });
    const resources = await lab.list(value.requestId);
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ active: false, expiresAt: null, grants: [] });
    expect(await lab.operation(`${value.requestId}/expiry`)).toBeNull();
    expect(fixture.state.request.state).not.toBe('COMPLETED');
  });

  it('blocks a replacement plan that conflicts with already committed configuration', async () => {
    const original = await plan();
    fixture.state.failReceiptStep = 'expiry';
    await expect(execute(original)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    const existing = (await lab.list(original.requestId))[0];
    fixture.state.request.requestedDays = 30;
    fixture.state.request.revision += 1;
    const replacement = await makePlan(fixture.graph, fixture.state.request);
    fixture.state.plan = replacement;
    fixture.state.request.currentPlanId = replacement.id;
    approve(replacement);
    await expect(execute(replacement)).rejects.toMatchObject({ code: 'CONFLICT' });
    const resources = await lab.list(original.requestId);
    expect(resources).toHaveLength(1);
    expect(resources[0]).toEqual(existing);
    expect(resources[0].active).toBe(false);
    expect(fixture.state.request.state).not.toBe('COMPLETED');
  });

  it('stops dispatch after cancellation and retains committed state for reconciliation', async () => {
    const value = await plan();
    const controller = new AbortController();
    const hooks: ExecutionHooks = { ...fixture.hooks, signal: controller.signal, onEvent: async type => { if (type === 'tool_applied') controller.abort(); } };
    await expect(execute(value, hooks)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(await lab.list(value.requestId)).toHaveLength(1);
    expect(fixture.state.receipts).toHaveLength(1);
    expect(await lab.operation(`${value.requestId}/expiry`)).toBeNull();
    expect(fixture.state.request.state).not.toBe('COMPLETED');
  });

  it.each(['wrong_expiry', 'admin_owner', 'extra_admin', 'wrong_customer', 'inactive', 'missing_receipt'] as const)('prevents completion for actual persisted %s read-back', async variant => {
    const value = await plan();
    const hooks: ExecutionHooks = { ...fixture.hooks, onState: async state => {
      fixture.state.request.state = state;
      if (state !== 'VERIFYING') return;
      if (variant === 'missing_receipt') fixture.state.receipts.pop();
      else await alterResource(workspace => {
        if (variant === 'wrong_expiry') workspace.expiresAt = new Date(Date.parse(workspace.expiresAt as string) + 2000).toISOString();
        if (variant === 'admin_owner') workspace.grants = [{ email: value.parameters.ownerEmail, role: 'admin' }];
        if (variant === 'extra_admin') (workspace.grants as unknown[]).push({ email: 'unrelated@example.com', role: 'admin' });
        if (variant === 'wrong_customer') workspace.customerId = 'unrelated_customer';
        if (variant === 'inactive') workspace.active = false;
      });
    } };
    await expect(execute(value, hooks)).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    expect(fixture.state.verification?.passed).toBe(false);
    expect(fixture.state.request.state).not.toBe('COMPLETED');
    expect(await lab.list(value.requestId)).toHaveLength(1);
    if (variant !== 'inactive') expect((await lab.list(value.requestId))[0].active).toBe(true);
  });

  it('fails closed when persisted duplicates violate Lab storage invariants', async () => {
    const value = await plan();
    const hooks: ExecutionHooks = { ...fixture.hooks, onState: async state => {
      fixture.state.request.state = state;
      if (state === 'VERIFYING') await alterResource((workspace, persisted) => { (persisted.workspaces as unknown[]).push({ ...workspace, id: 'duplicate_workspace' }); });
    } };
    await expect(execute(value, hooks)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(fixture.state.request.state).not.toBe('COMPLETED');
    expect(JSON.parse(await readFile(dataPath, 'utf8')).workspaces).toHaveLength(2);
  });

  it('rejects a self-rehashed plan that changes duration and removes required approval', async () => {
    const value = await plan();
    value.parameters.durationDays = 30;
    value.planHash = planHash(value);
    fixture.state.plan = structuredClone(value);
    await expect(guardPlan(fixture.graph, value)).rejects.toMatchObject({ code: 'STALE_PLAN' });
    expect(await lab.list(value.requestId)).toEqual([]);
  });

  it('rejects self-rehashed plan steps that no longer equal the reviewed procedure', async () => {
    const value = await plan();
    value.steps = value.steps.filter(step => step.tool !== 'grant_access');
    value.steps.find(step => step.tool === 'activate_workspace')!.dependsOn = ['expiry'];
    value.planHash = planHash(value);
    fixture.state.plan = structuredClone(value);
    await expect(guardPlan(fixture.graph, value)).rejects.toMatchObject({ code: 'STALE_PLAN' });
  });

  it('requires every output binding to name an actual dependency, including read steps', () => {
    const procedure = structuredClone(fixture.state.procedure!);
    const source = procedure.steps[0];
    procedure.steps.push({ ...source, id: 'read', tool: 'read_workspace', dependsOn: [], bindings: { workspaceId: { kind: 'output', key: 'id', stepId: source.id } } });
    expect(() => validateProcedure(procedure, true)).toThrow();
  });

  it('serializes mutation tasks and continues after a rejected task', async () => {
    const order: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const first = broker.run(async () => { order.push('first:start'); await barrier; order.push('first:end'); });
    const failed = broker.run(async () => { order.push('failure'); throw new AppError('CONFLICT', 'test'); });
    const failureCheck = expect(failed).rejects.toMatchObject({ code: 'CONFLICT' });
    const last = broker.run(async () => { order.push('last'); return 3; });
    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    release();
    await first;
    await failureCheck;
    expect(await last).toBe(3);
    expect(order).toEqual(['first:start', 'first:end', 'failure', 'last']);
  });
});
