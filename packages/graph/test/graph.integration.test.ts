import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { FalkorDB } from 'falkordb';
import { textHash, type GraphStore, type Plan, type TrialRequest } from '@athena/contracts';
import { createGraphStore } from '../src';
import { seed, makeConfirmation, makeProcedure } from './fixtures';

/** Runs only against a real FalkorDB, in its own disposable graph. */
describe.skipIf(process.env.GRAPH_INTEGRATION !== '1')('actual FalkorDB relationship integration', () => {
  const name = `athena_graph_test_${Date.now()}`;
  let store: GraphStore;
  let db: FalkorDB;
  let raw: ReturnType<FalkorDB['selectGraph']>;
  beforeAll(async () => {
    store = await createGraphStore({ graph: name });
    db = await FalkorDB.connect({ host: process.env.FALKORDB_HOST ?? '127.0.0.1', port: Number(process.env.FALKORDB_PORT ?? 16379), password: process.env.FALKORDB_PASSWORD });
    raw = db.selectGraph(name);
  });
  beforeEach(async () => { await store.reset(seed); });
  afterAll(async () => { if (raw) await raw.delete(); if (store) await store.close(); if (db) await db.close(); });

  test('Q1 imports only history and resolves real evidence edges', async () => {
    const state = await store.getState();
    expect(state.counts.Procedure ?? 0).toBe(0);
    expect(state.counts.Approval ?? 0).toBe(0);
    expect(state.knowledgeRevision).toBe(0);
    const history = await store.getHistory('process_trial');
    expect(history.cases).toHaveLength(3); expect(history.observations).toHaveLength(15); expect(history.sources).toHaveLength(9);
    await store.validateEvidence(history.observations.flatMap(o => o.evidenceRefs));
    await store.seed(seed);
    expect((await store.getState()).counts.Case).toBe(3);
  });
  test('Q2 publishes from owner confirmation and fresh reads reconstruct dependencies and roles', async () => {
    const confirmation = makeConfirmation(); const proposed = makeProcedure(confirmation);
    const draft = { ...proposed, rules: proposed.rules.map(r => ({ ...r, status: 'PROPOSED' as const, confirmationRefs: [] })), steps: proposed.steps.map(s => ({ ...s, confirmationRefs: [] })) };
    await store.saveDraft(draft);
    expect(await store.getCurrentProcedure('process_trial')).toBe(null);
    await expect(store.publish(proposed, confirmation, 'person_ana', 0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await store.publish(proposed, confirmation, 'person_mira', 0);
    const current = await store.getCurrentProcedure('process_trial');
    expect(current?.status).toBe('PUBLISHED'); expect(current?.knowledgeRevision).toBe(1);
    expect(current?.steps.find(s => s.id === 'activate')?.dependsOn.sort()).toEqual(['access', 'expiry']);
    expect(current?.rules.find(r => r.outcome === 'require_approval')?.requiredRoleId).toBe('role_trial_extension_approver');
    await expect(store.saveDraft(draft)).rejects.toMatchObject({ code: 'CONFLICT' });
    await raw.query('MATCH (p:Procedure)-[link:HAS_STEP]->(s:Step {id: $id}) DELETE link', { params: { id: 'activate' } });
    expect((await store.getCurrentProcedure('process_trial'))?.steps.some(s => s.id === 'activate')).toBe(false);
    await raw.query('MATCH (p:Procedure)-[link:FOR_PROCESS]->(:Process) DELETE link');
    expect(await store.getCurrentProcedure('process_trial')).toBe(null);
  });
  test('Q3 role assignment changes current routing and missing authority fails closed', async () => {
    const now = new Date().toISOString();
    expect((await store.resolveAuthority('role_trial_extension_approver', now)).person.id).toBe('person_ravi');
    const text = 'Mira assigns Leena to the Trial Extension Approver role effective immediately.';
    const source = { ...makeConfirmation(), id: 'source_role_change', kind: 'authority' as const, text, contentHash: textHash(text) };
    const assignment = await store.assignAuthority('role_trial_extension_approver', 'person_leena', 'person_mira', 0, source);
    expect(assignment.revision).toBe(2);
    expect((await store.resolveAuthority('role_trial_extension_approver', new Date().toISOString())).person.id).toBe('person_leena');
    expect(await store.getKnowledgeRevision()).toBe(1);
    await raw.query('MATCH (:Person)-[a:HOLDS_ROLE]->(:Role) DELETE a');
    await expect(store.resolveAuthority('role_trial_extension_approver', new Date().toISOString())).rejects.toMatchObject({ code: 'AMBIGUOUS_AUTHORITY' });
  });
  test('Q4/Q5 traverse plans, approvals, receipts, verification and ordered audit events', async () => {
    const published = await store.publish(makeProcedure(makeConfirmation()), makeConfirmation(), 'person_mira', 0);
    const now = new Date().toISOString();
    const request: TrialRequest = { id: 'request_test', processId: 'process_trial', customerId: 'customer_unseen', customerName: 'Unseen', ownerEmail: 'owner@unseen.example', requestedDays: 30, revision: 1, idempotencyKey: 'key_test', inputHash: 'test', requestedBy: 'person_ana', createdAt: now, updatedAt: now, state: 'WAITING_APPROVAL', reason: null, errorCode: null, currentPlanId: 'plan_test' };
    const plan: Plan = { id: 'plan_test', requestId: request.id, requestRevision: 1, procedureId: published.id, knowledgeRevision: 1, planHash: 'hash_test', createdAt: now, parameters: { durationDays: 30, accessRole: 'member', customerId: request.customerId, customerName: request.customerName, ownerEmail: request.ownerEmail }, steps: published.steps, requiredApprovalRoleId: 'role_trial_extension_approver', approverPersonId: 'person_ravi', assignmentRevision: 1, evidenceRefs: [], justification: 'Test-only plan' };
    await store.saveRequest(request); await store.savePlan(plan);
    await store.saveApproval({ id: 'approval_test', requestId: request.id, planId: plan.id, planHash: plan.planHash, actorId: 'person_ravi', roleId: 'role_trial_extension_approver', assignmentRevision: 1, knowledgeRevision: 1, decision: 'APPROVED', createdAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await store.saveReceipt({ requestId: request.id, stepId: 'create', operationKey: `${request.id}/create`, inputHash: 'input_hash', resourceId: 'workspace_test', observedAt: now, result: 'APPLIED' });
    await store.saveVerification({ id: 'verification_test', requestId: request.id, planId: plan.id, checkedAt: now, passed: false, checks: [], workspace: null, resourceCount: 0 });
    await store.appendEvent({ id: 'event_test', at: now, actorId: 'person_ana', targetId: request.id, type: 'TEST_EVENT', message: 'Test audit', data: {} });
    const result = await store.getRequest(request.id);
    expect(result?.approvals).toHaveLength(1); expect(result?.receipts).toHaveLength(1); expect(result?.verification?.passed).toBe(false); expect(result?.events[0].sequence).toBe(1);
    expect(result?.receipts[0]).not.toHaveProperty('id');
    const traces = store.drainTraces(); expect(traces.some(t => t.name.startsWith('Q4_'))).toBe(true); expect(traces.some(t => t.name.startsWith('Q5_'))).toBe(true);
  });
});
