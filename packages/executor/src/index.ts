import { randomUUID } from 'node:crypto';
import {
  AppError, ProcedureSchema, ReviewSchema, PlanSchema, planHash, operationHash,
  type Procedure, type Review, type Source, type Rule, type Step, type Scalar, type Condition,
  type TrialRequest, type Plan, type GraphStore, type Approval, type EvidenceRef,
  type LabClient, type ToolReceipt, type Workspace, type Verification, type Binding,
} from '@athena/contracts';

export const newId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export const nowIso = (): string => new Date().toISOString();
const MUTATING = new Set(['create_workspace', 'set_expiry', 'grant_access', 'activate_workspace']);
const REQUIRED_TOOLS = [...MUTATING];
function fail(message: string): never { throw new AppError('INVALID_INPUT', message); }
export function orderSteps(steps: Step[]): Step[] {
  if (new Set(steps.map(s => s.id)).size !== steps.length) fail('Procedure step IDs must be unique');
  const done = new Set<string>(), ordered: Step[] = [];
  while (ordered.length < steps.length) {
    const next = steps.find(s => !done.has(s.id) && s.dependsOn.every(id => done.has(id)));
    if (!next) fail('Step dependencies contain a cycle or an unknown step');
    ordered.push(next); done.add(next.id);
  }
  return ordered;
}
export function scalarRules(procedure: Procedure): Record<string, Scalar> {
  const values: Record<string, Scalar> = {};
  for (const rule of procedure.rules.filter(r => r.kind === 'scalar')) {
    if (rule.value === null || values[rule.key] !== undefined) fail('Scalar rules need unique keys and values');
    values[rule.key] = rule.value;
  }
  return values;
}
const binding = (kind: Binding['kind'], key: string, stepId: string | null = null): Binding => ({ kind, key, stepId });
function expectedBindings(step: Step, createId: string): Record<string, Binding> {
  const workspaceId = binding('output', 'id', createId);
  switch (step.tool) {
    case 'create_workspace': return { customerId: binding('request', 'customerId'), requestId: binding('request', 'id') };
    case 'set_expiry': return { workspaceId, expiresAt: binding('derived', 'expiryFromCreatedAt', createId) };
    case 'grant_access': return { workspaceId, email: binding('request', 'ownerEmail'), role: binding('rule', 'accessRole') };
    case 'activate_workspace': case 'read_workspace': return { workspaceId };
    case 'check_access': return { workspaceId, email: binding('request', 'ownerEmail') };
  }
}
/** Tool contracts are prebuilt; company settings and dependency structure live in the procedure. */
export function validateProcedure(procedure: Procedure, confirmed = false): void {
  ProcedureSchema.parse(procedure);
  const ordered = orderSteps(procedure.steps);
  for (const tool of REQUIRED_TOOLS) if (procedure.steps.filter(s => s.tool === tool).length !== 1) fail(`Procedure must compose exactly one ${tool}`);
  if (new Set(procedure.rules.map(r => r.id)).size !== procedure.rules.length) fail('Rule IDs must be unique');
  const values = scalarRules(procedure);
  const create = ordered.find(s => s.tool === 'create_workspace')!;
  const completed = new Set<string>();
  const ancestorsOf = (id: string): Set<string> => {
    const found = new Set<string>();
    const visit = (current: string) => { for (const dependency of ordered.find(s => s.id === current)!.dependsOn) if (!found.has(dependency)) { found.add(dependency); visit(dependency); } };
    visit(id); return found;
  };
  for (const step of ordered) {
    const expected = expectedBindings(step, create.id);
    if (JSON.stringify(Object.keys(step.bindings).sort()) !== JSON.stringify(Object.keys(expected).sort())) fail(`Unexpected arguments for ${step.tool}`);
    for (const [key, value] of Object.entries(expected)) {
      const actual = step.bindings[key];
      if (actual.kind !== value.kind || actual.key !== value.key || actual.stepId !== value.stepId) fail(`Unsafe binding for ${step.tool}.${key}`);
      if (actual.stepId && (!completed.has(actual.stepId) || !ancestorsOf(step.id).has(actual.stepId))) fail('Output bindings must reference prerequisite steps');
    }
    completed.add(step.id);
    if (confirmed && !step.confirmationRefs.length) fail('Every published step needs human confirmation');
  }
  for (const rule of procedure.rules) {
    if (rule.kind === 'scalar' && (rule.condition !== null || rule.outcome !== null || rule.requiredRoleId !== null)) fail('Scalar rule has executable fields');
    if (rule.kind === 'branch' && (rule.value !== null || rule.outcome === null)) fail('Branch rule is incomplete');
    if (rule.outcome === 'require_approval' && !rule.requiredRoleId) fail('Approval branch requires a role');
    if (rule.outcome !== 'require_approval' && rule.requiredRoleId !== null) fail('Unexpected approval role');
    if (rule.kind === 'branch' && !rule.condition && rule.outcome !== 'clarify') fail('Only a clarification fallback may omit its condition');
    if (rule.condition) {
      const predicates = rule.condition.op === 'all' ? rule.condition.conditions : [rule.condition];
      for (const condition of predicates) for (const operand of [condition.left, ...(condition.op === 'in' ? condition.right : [condition.right])]) {
        if (operand.kind === 'rule' && !(operand.key in values)) fail(`Unknown rule reference ${operand.key}`);
      }
    }
    if (confirmed && (rule.status !== 'CONFIRMED' || !rule.confirmationRefs.length)) fail('Every published rule needs human confirmation');
  }
  if (confirmed) {
    if (!Number.isInteger(values.normalDurationDays) || Number(values.normalDurationDays) <= 0 || !Number.isInteger(values.extendedDurationDays) || Number(values.extendedDurationDays) <= Number(values.normalDurationDays) || values.accessRole !== 'member') fail('Confirmed policy settings are invalid');
    const expiry = ordered.find(s => s.tool === 'set_expiry')!, grants = ordered.find(s => s.tool === 'grant_access')!, activate = ordered.find(s => s.tool === 'activate_workspace')!;
    const ancestors = (id: string): Set<string> => { const result = new Set<string>(); const visit = (id: string) => { for (const dep of ordered.find(s => s.id === id)!.dependsOn) if (!result.has(dep)) { result.add(dep); visit(dep); } }; visit(id); return result; };
    if (!ancestors(expiry.id).has(create.id) || !ancestors(grants.id).has(create.id) || !ancestors(activate.id).has(expiry.id) || !ancestors(activate.id).has(grants.id)) fail('Published dependencies must configure an inactive workspace before activation');
  }
}

/** Compile only the explicitly submitted owner review, retaining historical provenance. */
export function reviewedProcedure(candidate: Procedure, reviewInput: Review, confirmation: Source, nextVersion: number, revision: number): Procedure {
  const review = ReviewSchema.parse(reviewInput);
  validateProcedure(candidate);
  const humanRef: EvidenceRef = { sourceId: confirmation.id, revision: confirmation.revision, quote: confirmation.text, observationId: null };
  const basis = candidate.observedPatterns.flatMap(p => p.evidenceRefs);
  const evidenceFor = (key: string) => candidate.rules.find(r => r.key === key)?.evidenceRefs ?? basis;
  const scalars: Rule[] = (['normalDurationDays', 'extendedDurationDays', 'accessRole'] as const).map(key => ({
    id: `rule_${key}`, key, kind: 'scalar', value: review[key], condition: null, outcome: null, requiredRoleId: null,
    status: 'CONFIRMED', evidenceRefs: evidenceFor(key), confirmationRefs: [humanRef],
  }));
  const branch = (key: string, scalar: string, outcome: Rule['outcome'], role: string | null): Rule => ({
    id: `rule_${key}`, key, kind: 'branch', value: null,
    condition: { op: 'eq', left: { kind: 'request', key: 'requestedDays' }, right: { kind: 'rule', key: scalar } },
    outcome, requiredRoleId: role, status: 'CONFIRMED', evidenceRefs: evidenceFor(scalar), confirmationRefs: [humanRef],
  });
  const rules: Rule[] = [...scalars, branch('normal', 'normalDurationDays', 'permit', null), branch('extended', 'extendedDurationDays', 'require_approval', review.extensionApprovalRoleId),
    { id: 'rule_clarification', key: 'unsupported', kind: 'branch', value: null, condition: null, outcome: 'clarify', requiredRoleId: null, status: 'CONFIRMED', evidenceRefs: basis, confirmationRefs: [humanRef] }];
  const create = candidate.steps.find(s => s.tool === 'create_workspace')!, expiry = candidate.steps.find(s => s.tool === 'set_expiry')!, grants = candidate.steps.find(s => s.tool === 'grant_access')!;
  const steps = candidate.steps.map(step => ({ ...step, confirmationRefs: [humanRef], dependsOn: [...new Set([...step.dependsOn,
    ...(['set_expiry', 'grant_access'].includes(step.tool) ? [create.id] : []), ...(step.tool === 'activate_workspace' ? [expiry.id, grants.id] : [])])] }));
  const procedure: Procedure = { ...candidate, id: newId('procedure'), version: nextVersion, status: 'PUBLISHED', rules, steps, publishedAt: nowIso(), publishedBy: confirmation.authorPersonIds[0], knowledgeRevision: revision + 1, confirmationSourceId: confirmation.id };
  validateProcedure(procedure, true);
  return procedure;
}

function conditionMatches(condition: Condition, request: Record<string, Scalar>, values: Record<string, Scalar>): boolean {
  if (condition.op === 'all') return condition.conditions.every(c => conditionMatches(c, request, values));
  const value = (operand: {kind: 'request' | 'rule'; key: string}): Scalar => {
    const result = (operand.kind === 'request' ? request : values)[operand.key];
    if (result === undefined) fail(`Cannot resolve condition field ${operand.key}`);
    return result;
  };
  return condition.op === 'eq' ? value(condition.left) === value(condition.right) : condition.right.some(right => value(condition.left) === value(right));
}
export async function makePlan(graph: GraphStore, request: TrialRequest, at = nowIso()): Promise<Plan> {
  const procedure = await graph.getCurrentProcedure(request.processId);
  if (!procedure) throw new AppError('NEEDS_TEACHING', 'Teach and publish a procedure before requesting work', 409);
  validateProcedure(procedure, true);
  await graph.validateEvidence(procedure.rules.flatMap(r => [...r.evidenceRefs, ...r.confirmationRefs]).concat(procedure.steps.flatMap(s => [...s.evidenceRefs, ...s.confirmationRefs])));
  const values = scalarRules(procedure);
  const durationDays = request.requestedDays ?? Number(values.normalDurationDays);
  const resolved = { requestedDays: durationDays, ownerEmail: request.ownerEmail, customerId: request.customerId, customerName: request.customerName };
  const matches = procedure.rules.filter(r => r.kind === 'branch' && r.condition && conditionMatches(r.condition, resolved, values));
  if (!matches.length || matches.some(r => r.outcome === 'clarify')) throw new AppError('UNSUPPORTED_REQUEST', `The reviewed procedure does not permit ${durationDays} days. Clarify this request with the process owner.`, 409);
  const roles = [...new Set(matches.filter(r => r.outcome === 'require_approval').map(r => r.requiredRoleId!))];
  if (roles.length > 1) throw new AppError('AMBIGUOUS_AUTHORITY', 'The plan requires conflicting approval roles', 409);
  const authority = roles.length ? await graph.resolveAuthority(roles[0], at) : null;
  const plan: Plan = { id: newId('plan'), requestId: request.id, requestRevision: request.revision, procedureId: procedure.id,
    knowledgeRevision: await graph.getKnowledgeRevision(), planHash: '', createdAt: at,
    parameters: { durationDays, accessRole: values.accessRole as 'member', customerId: request.customerId, customerName: request.customerName, ownerEmail: request.ownerEmail },
    steps: orderSteps(procedure.steps), requiredApprovalRoleId: roles[0] ?? null, approverPersonId: authority?.person.id ?? null, assignmentRevision: authority?.assignment.revision ?? null,
    evidenceRefs: [...matches.flatMap(r => [...r.evidenceRefs, ...r.confirmationRefs]), ...procedure.rules.filter(r => r.kind === 'scalar').flatMap(r => [...r.evidenceRefs, ...r.confirmationRefs]), ...(authority?.assignment.evidenceRefs ?? [])],
    justification: `The confirmed procedure resolves this request to ${durationDays} days with ${values.accessRole} access.${authority ? ` Current approval belongs to ${authority.person.name}.` : ' The reviewed ordinary branch permits this request.'}` };
  plan.planHash = planHash(plan);
  return PlanSchema.parse(plan);
}

export async function guardPlan(graph: GraphStore, plan: Plan, now?: Date, requireApproval = true): Promise<{ request: TrialRequest; approval: Approval | null }> {
  const clock = () => now ?? new Date();
  PlanSchema.parse(plan);
  const detail = await graph.getRequest(plan.requestId);
  if (!detail) throw new AppError('NOT_FOUND', 'Request does not exist', 404);
  if (detail.request.state === 'REJECTED') throw new AppError('FORBIDDEN', 'Rejected requests cannot be resumed', 403);
  if (detail.request.revision !== plan.requestRevision || detail.request.currentPlanId !== plan.id || planHash(plan) !== plan.planHash || (await graph.getKnowledgeRevision()) !== plan.knowledgeRevision) throw new AppError('STALE_PLAN', 'The request or company knowledge changed; review a new plan', 409);
  const current = await graph.getCurrentProcedure(detail.request.processId);
  if (!current || current.id !== plan.procedureId) throw new AppError('STALE_PLAN', 'The plan no longer uses the current published procedure', 409);
  validateProcedure(current, true);
  if (!detail.plan || detail.plan.planHash !== plan.planHash || planHash(detail.plan) !== plan.planHash) throw new AppError('STALE_PLAN', 'The proposed action differs from the persisted plan', 409);
  const expected = await makePlan(graph, detail.request, clock().toISOString());
  if (expected.planHash !== plan.planHash) throw new AppError('STALE_PLAN', 'The plan does not match the current request and reviewed rules', 409);
  let approval: Approval | null = null;
  if (plan.requiredApprovalRoleId) {
    const holder = await graph.resolveAuthority(plan.requiredApprovalRoleId, clock().toISOString());
    const finalNow = clock().getTime();
    if (Date.parse(holder.assignment.validFrom) > finalNow || (holder.assignment.validTo !== null && Date.parse(holder.assignment.validTo) <= finalNow)) throw new AppError('STALE_PLAN', 'Approval authority expired during validation', 409);
    if (holder.person.id !== plan.approverPersonId || holder.assignment.revision !== plan.assignmentRevision) throw new AppError('STALE_PLAN', 'Approval authority changed; review a new plan', 409);
    approval = detail.approvals.find(a => a.planId === plan.id && a.planHash === plan.planHash && a.roleId === plan.requiredApprovalRoleId && a.actorId === holder.person.id && a.assignmentRevision === holder.assignment.revision && a.knowledgeRevision === plan.knowledgeRevision && a.decision === 'APPROVED' && Date.parse(a.expiresAt) > finalNow) ?? null;
    if (requireApproval && !approval) throw new AppError('APPROVAL_REQUIRED', 'This exact plan needs a current, unexpired approval', 409);
  }
  return { request: detail.request, approval };
}

export class MutationBroker {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
export type ExecutionHooks = { onEvent(type: string, message: string, data?: Record<string, unknown>): Promise<void>; onState(state: TrialRequest['state']): Promise<void>; selectAction?: (step: Step, plan: Plan) => Promise<void>; signal?: AbortSignal };

/** Graph validation and a state-changing Lab call are serialized with all authority changes. */
export async function executePlan(graph: GraphStore, lab: LabClient, broker: MutationBroker, plan: Plan, hooks: ExecutionHooks): Promise<Verification> {
  const outputs = new Map<string, Workspace>();
  const assertActive = () => { if (hooks.signal?.aborted) throw new AppError('BUDGET_EXCEEDED', 'Episode active-processing budget exceeded', 408); };
  await hooks.onState('EXECUTING');
  for (const step of orderSteps(plan.steps)) {
    assertActive();
    if (hooks.selectAction) await hooks.selectAction(step, plan);
    await broker.run(async () => {
      assertActive();
      const { request } = await guardPlan(graph, plan);
      const args: Record<string, unknown> = {};
      for (const [name, bind] of Object.entries(step.bindings)) {
        if (bind.kind === 'request') args[name] = bind.key === 'requestedDays' ? plan.parameters.durationDays : (request as unknown as Record<string, unknown>)[bind.key];
        else if (bind.kind === 'rule') {
          if (bind.key === 'accessRole') args[name] = plan.parameters.accessRole;
          else throw new AppError('INVALID_INPUT', 'Unexpected action rule binding');
        } else {
          const output = outputs.get(bind.stepId!);
          if (!output) throw new AppError('INVALID_INPUT', 'Missing prerequisite output');
          if (bind.kind === 'derived' && bind.key === 'expiryFromCreatedAt') args[name] = new Date(Date.parse(output.createdAt) + plan.parameters.durationDays * 86_400_000).toISOString();
          else if (bind.kind === 'output' && ['id', 'createdAt'].includes(bind.key)) args[name] = output[bind.key as 'id' | 'createdAt'];
          else throw new AppError('INVALID_INPUT', 'Unsupported parameter binding');
        }
      }
      if (!MUTATING.has(step.tool)) {
        if (step.tool === 'read_workspace') outputs.set(step.id, await lab.read(String(args.workspaceId)));
        else await lab.checkAccess(String(args.workspaceId), String(args.email));
        await hooks.onEvent('tool_read', `${step.tool} read the Workspace Lab`, { stepId: step.id, tool: step.tool });
        return;
      }
      const operationKey = `${plan.requestId}/${step.id}`;
      const resourceId = step.tool === 'create_workspace' ? null : String(args.workspaceId);
      const input: Record<string, unknown> = { requestId: plan.requestId, stepId: step.id, operationKey };
      if (step.tool === 'create_workspace') input.customerId = args.customerId;
      if (step.tool === 'set_expiry') input.expiresAt = args.expiresAt;
      if (step.tool === 'grant_access') input.grants = [{ email: args.email, role: args.role }];
      input.inputHash = operationHash(step.tool, resourceId, input);
      const prior = await lab.operation(operationKey);
      assertActive();
      if (prior) {
        if (prior.inputHash !== input.inputHash) throw new AppError('CONFLICT', 'An earlier operation committed different inputs; partial work needs review', 409);
        outputs.set(step.id, prior.workspace);
        await graph.saveReceipt({ ...prior.receipt, result: 'ALREADY_APPLIED' });
        await hooks.onEvent('receipt_reconciled', `${step.tool} was already committed; receipt reconciled`, { operationKey, resourceId: prior.workspace.id });
        return;
      }
      // Recheck after reconciliation I/O, immediately before dispatching a mutation.
      await guardPlan(graph, plan);
      assertActive();
      let result;
      if (step.tool === 'create_workspace') result = await lab.create(input as Parameters<LabClient['create']>[0]);
      else if (step.tool === 'set_expiry') result = await lab.setExpiry(resourceId!, input as Parameters<LabClient['setExpiry']>[1]);
      else if (step.tool === 'grant_access') result = await lab.setGrants(resourceId!, input as Parameters<LabClient['setGrants']>[1]);
      else result = await lab.activate(resourceId!, input as Parameters<LabClient['activate']>[1]);
      outputs.set(step.id, result.workspace);
      // Commit may have happened even when the episode expires. Keep its receipt before stopping.
      await graph.saveReceipt(result.receipt);
      await hooks.onEvent('tool_applied', `${step.tool} ${result.receipt.result.toLowerCase().replaceAll('_', ' ')}`, { stepId: step.id, tool: step.tool, receipt: result.receipt });
    });
  }
  assertActive();
  await hooks.onState('VERIFYING');
  return broker.run(async () => {
    assertActive();
    await guardPlan(graph, plan);
    const verification = await verifyPlan(graph, lab, plan);
    await graph.saveVerification(verification);
    if (!verification.passed) throw new AppError('VERIFICATION_FAILED', 'Workspace read-back did not match the approved plan', 409, { verificationId: verification.id });
    assertActive();
    await guardPlan(graph, plan);
    const detail = await graph.getRequest(plan.requestId);
    // The only COMPLETED transition is inside this deterministic verifier path.
    await graph.saveRequest({ ...detail!.request, state: 'COMPLETED', updatedAt: nowIso(), errorCode: null, reason: null });
    await hooks.onEvent('verified', 'Independent workspace checks passed', { verificationId: verification.id, checks: verification.checks });
    return verification;
  });
}

export async function verifyPlan(graph: GraphStore, lab: LabClient, plan: Plan): Promise<Verification> {
  const resources = await lab.list(plan.requestId);
  const workspace = resources.length === 1 ? await lab.read(resources[0].id) : null;
  const checks: Verification['checks'] = [];
  const check = (name: string, expected: unknown, actual: unknown, passed = JSON.stringify(expected) === JSON.stringify(actual)) => checks.push({ name, expected, actual, passed });
  check('Exactly one workspace', 1, resources.length);
  if (workspace) {
    check('Request identity', plan.requestId, workspace.requestId);
    check('Customer identity', plan.parameters.customerId, workspace.customerId);
    check('Exact member grant', [{ email: plan.parameters.ownerEmail, role: plan.parameters.accessRole }], workspace.grants);
    const expectedExpiry = Date.parse(workspace.createdAt) + plan.parameters.durationDays * 86_400_000;
    check('Expiry from persisted creation time', new Date(expectedExpiry).toISOString(), workspace.expiresAt, workspace.expiresAt !== null && Math.abs(Date.parse(workspace.expiresAt) - expectedExpiry) <= 1000);
    check('Workspace active', true, workspace.active);
    const member = await lab.checkAccess(workspace.id, plan.parameters.ownerEmail);
    check('Intended member access', true, member.allowed && member.role === plan.parameters.accessRole);
    const outsiderEmail = `unrelated-${newId('check')}@verification.example`;
    const outsider = await lab.checkAccess(workspace.id, outsiderEmail);
    check('Unrelated identity denied', false, outsider.allowed);
  }
  const detail = await graph.getRequest(plan.requestId);
  for (const step of plan.steps.filter(s => MUTATING.has(s.tool))) {
    const operationKey = `${plan.requestId}/${step.id}`;
    const operation = await lab.operation(operationKey);
    const receipt = detail?.receipts.find(r => r.operationKey === operationKey);
    check(`Durable receipt: ${step.tool}`, true, !!receipt && !!operation && receipt.inputHash === operation.inputHash && receipt.resourceId === workspace?.id);
  }
  try { const { approval } = await guardPlan(graph, plan); check('Current plan and applicable approval', true, !plan.requiredApprovalRoleId || approval !== null); }
  catch (error) { if (error instanceof AppError && error.code === 'DEPENDENCY_UNAVAILABLE') throw error; check('Current plan and applicable approval', true, false); }
  return { id: newId('verification'), requestId: plan.requestId, planId: plan.id, checkedAt: nowIso(), passed: checks.every(c => c.passed), checks, workspace, resourceCount: resources.length };
}
