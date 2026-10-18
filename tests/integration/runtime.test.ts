import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FalkorDB } from 'falkordb';
import { AppError, type GraphStore, type ModelAdapter, type Review, type TrialRequestInput } from '@athena/contracts';
import { createGraphStore } from '@athena/graph';
import { RuntimeService } from '../../apps/runtime/src/service';
import { WorkspaceLab } from '../../apps/workspace-lab/src/application';
import { seed } from '../../packages/graph/test/fixtures';
import { TestOnlyGraphStore, createTestOnlyModel } from '../support/runtime-fixtures';

const review = (normalDurationDays = 7): Review => ({ normalDurationDays, extendedDurationDays: 30, accessRole: 'member', extensionApprovalRoleId: 'role_trial_extension_approver', configureWhileInactive: true, activateAfterConfiguration: true, confirmAllFields: true });
const requestInput = (requestedDays: number | null = null, key = 'test-request'): TrialRequestInput => ({ processId: 'process_trial', customerId: `customer_${key}`, customerName: 'Unseen runtime customer', ownerEmail: 'owner@unseen-runtime.example', requestedDays, idempotencyKey: key });

for (const realGraph of [false, true]) {
  describe.skipIf(realGraph && process.env.RUNTIME_GRAPH_INTEGRATION !== '1')(`runtime + real file-backed Lab (${realGraph ? 'actual FalkorDB; test-only model' : 'test-only graph and model doubles'})`, () => {
    let directory: string, dataPath: string;
    let graph: GraphStore, lab: WorkspaceLab, runtime: RuntimeService;
    let model: ReturnType<typeof createTestOnlyModel>;
    let cleanupGraph: (() => Promise<void>) | null;
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'athena-runtime-test-')); dataPath = join(directory, 'lab.json');
      lab = new WorkspaceLab({ dataPath }); model = createTestOnlyModel(); cleanupGraph = null;
      if (realGraph) {
        const graphName = `athena_runtime_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        graph = await createGraphStore({ graph: graphName });
        await graph.seed(seed);
        cleanupGraph = async () => {
          const db = await FalkorDB.connect({ host: process.env.FALKORDB_HOST ?? '127.0.0.1', port: Number(process.env.FALKORDB_PORT ?? 16379), password: process.env.FALKORDB_PASSWORD });
          try { await db.selectGraph(graphName).delete(); } finally { await db.close(); }
        };
      } else graph = new TestOnlyGraphStore(seed);
      runtime = new RuntimeService({ graph, lab, model, history: seed, demoMode: true, autoRun: false });
    });
    afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); if (lab) await lab.close(); if (graph) await graph.close(); if (cleanupGraph) await cleanupGraph(); if (directory) await rm(directory, { recursive: true, force: true }); });

    async function teach(normalDays = 7) {
      const run = await runtime.startLearning('person_mira', seed.cases.map(c => c.id));
      await runtime.runLearning(run.id);
      const detail = await graph.getLearningRun(run.id);
      expect(detail?.run.state).toBe('NEEDS_REVIEW'); expect(detail?.episode?.initialContextMessages).toBe(0);
      if (realGraph) {
        const historyTrace = detail!.events.find(event => event.type === 'graph_query' && event.data.name === 'Q1_history_evidence');
        expect(historyTrace?.data).toMatchObject({ query: expect.stringContaining('HAS_OBSERVATION'), parameters: { processId: 'process_trial', caseIds: seed.cases.map(c => c.id) }, rowCount: expect.any(Number), durationMs: expect.any(Number) });
        expect(Number(historyTrace!.data.rowCount)).toBeGreaterThan(0);
      }
      expect(await graph.getCurrentProcedure('process_trial')).toBeNull();
      return runtime.publish('person_mira', detail!.candidate!.id, review(normalDays), 0);
    }

    test('cold knowledge blocks work before any model call or application mutation', async () => {
      expect(await graph.getCurrentProcedure('process_trial')).toBeNull();
      const request = await runtime.createRequest('person_ana', requestInput());
      await expect(runtime.runRequest(request.id)).rejects.toMatchObject({ code: 'NEEDS_TEACHING' });
      expect((await graph.getRequest(request.id))?.request).toMatchObject({ state: 'BLOCKED', errorCode: 'NEEDS_TEACHING' });
      expect(model.contexts).toHaveLength(0); expect(await lab.list(request.id)).toEqual([]);
    });

    test('learns a cited proposal and permits only the owner to publish explicit structured teaching', async () => {
      await expect(runtime.startLearning('person_ana', seed.cases.map(c => c.id))).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const run = await runtime.startLearning('person_mira', seed.cases.map(c => c.id)); await runtime.runLearning(run.id);
      const detail = (await graph.getLearningRun(run.id))!;
      expect(detail.candidate?.rules.every(r => r.status === 'PROPOSED' && r.confirmationRefs.length === 0)).toBe(true);
      expect(detail.episode?.status).toBe('WAITING');
      await expect(runtime.publish('person_ana', detail.candidate!.id, review(), 0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(runtime.publish('person_mira', detail.candidate!.id, { ...review(), confirmAllFields: false } as unknown as Review, 0)).rejects.toBeDefined();
      const published = await runtime.publish('person_mira', detail.candidate!.id, review(), 0);
      expect(published).toMatchObject({ status: 'PUBLISHED', knowledgeRevision: 1 });
      expect((await graph.getLearningRun(run.id))?.run.state).toBe('PUBLISHED');
      await expect(runtime.runLearning(run.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    test('a fresh normal request executes real effects using the human-confirmed nine-day rule', async () => {
      await teach(9);
      const request = await runtime.createRequest('person_ana', requestInput()); await runtime.runRequest(request.id);
      const detail = (await graph.getRequest(request.id))!;
      expect(detail.request.state).toBe('COMPLETED'); expect(detail.plan?.parameters.durationDays).toBe(9); expect(detail.verification?.passed).toBe(true);
      expect(detail.receipts).toHaveLength(4); expect(detail.episodes).toHaveLength(1); expect(detail.episodes[0]).toMatchObject({ initialContextMessages: 0, status: 'SUCCEEDED' });
      const workspace = (await lab.list(request.id))[0];
      expect(workspace.active).toBe(true); expect(Date.parse(workspace.expiresAt!) - Date.parse(workspace.createdAt)).toBe(9 * 86_400_000);
      expect(await lab.checkAccess(workspace.id, request.ownerEmail)).toMatchObject({ allowed: true, role: 'member' });
      expect(await lab.checkAccess(workspace.id, 'unrelated@runtime-test.example')).toMatchObject({ allowed: false });
      const freshContext = model.contexts.find(items => JSON.stringify(items).includes('HANDLE_REQUEST'))!;
      expect(freshContext).toHaveLength(2); expect(JSON.stringify(freshContext)).not.toContain('submit_candidate');
    });

    test('an invalid model dependency is rejected and corrected before a review draft is saved', async () => {
      const turn = model.turn.bind(model);
      let rejected = false;
      vi.spyOn(model, 'turn').mockImplementation(async (...args) => {
        const result = await turn(...args);
        const proposal = result.calls.find(call => call.name === 'submit_candidate');
        if (proposal && !rejected) {
          rejected = true;
          (proposal.arguments as { steps: { dependsOn: string[] }[] }).steps[0].dependsOn = ['missing_step'];
          result.output = [{ type: 'function_call', call_id: proposal.id, name: proposal.name, arguments: JSON.stringify(proposal.arguments) }];
        }
        return result;
      });
      const run = await runtime.startLearning('person_mira', seed.cases.map(c => c.id));
      await runtime.runLearning(run.id);
      const detail = (await graph.getLearningRun(run.id))!;
      expect(detail.run.state).toBe('NEEDS_REVIEW');
      expect(detail.episode).toMatchObject({ status: 'WAITING', modelTurns: 4, toolCalls: 4 });
      expect(detail.events.filter(event => event.type === 'CANDIDATE_REJECTED')).toHaveLength(1);
      expect(detail.candidate!.steps.every(step => !step.dependsOn.includes('missing_step'))).toBe(true);
      expect(await graph.getCurrentProcedure('process_trial')).toBeNull();
    });

    test('a draft persistence failure marks both the learning run and its usage-bearing episode failed', async () => {
      vi.spyOn(graph, 'saveDraft').mockRejectedValueOnce(new AppError('DEPENDENCY_UNAVAILABLE', 'Injected draft persistence failure', 503));
      const run = await runtime.startLearning('person_mira', seed.cases.map(c => c.id));
      await expect(runtime.runLearning(run.id)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
      const detail = (await graph.getLearningRun(run.id))!;
      expect(detail.run).toMatchObject({ state: 'FAILED', error: 'Injected draft persistence failure' });
      expect(detail.episode).toMatchObject({ status: 'FAILED', modelTurns: 3, toolCalls: 3, inputTokens: 30, outputTokens: 15, error: 'Injected draft persistence failure' });
      expect(detail.candidate).toBeNull();
    });

    test('extended work stops with no resource, then resumes in a fresh episode after exact current approval', async () => {
      await teach();
      const request = await runtime.createRequest('person_ana', requestInput(30)); await runtime.runRequest(request.id);
      const waiting = (await graph.getRequest(request.id))!;
      expect(waiting.request.state).toBe('WAITING_APPROVAL'); expect(waiting.plan?.approverPersonId).toBe('person_ravi'); expect(await lab.list(request.id)).toEqual([]);
      await expect(runtime.approve('person_ana', waiting.plan!.id, waiting.plan!.planHash, 'APPROVED')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(runtime.approve('person_ravi', waiting.plan!.id, 'altered-plan-hash', 'APPROVED')).rejects.toMatchObject({ code: 'STALE_PLAN' });
      await runtime.approve('person_ravi', waiting.plan!.id, waiting.plan!.planHash, 'APPROVED'); await runtime.runRequest(request.id);
      const completed = (await graph.getRequest(request.id))!;
      expect(completed.request.state).toBe('COMPLETED'); expect(completed.approvals).toHaveLength(1); expect(completed.episodes).toHaveLength(2);
      expect(new Set(completed.episodes.map(e => e.id)).size).toBe(2); expect(completed.episodes.every(e => e.initialContextMessages === 0)).toBe(true);
      expect(completed.episodes.map(e => e.status)).toEqual(['WAITING', 'SUCCEEDED']);
      if (realGraph) {
        const traces = completed.events.filter(event => event.type === 'graph_query');
        for (const prefix of ['Q2_', 'Q3_', 'Q4_', 'Q5_']) expect(traces.some(event => String(event.data.name).startsWith(prefix))).toBe(true);
        const authority = traces.find(event => event.data.name === 'Q3_current_role_holder')!;
        expect(authority.data).toMatchObject({ query: expect.stringContaining('HOLDS_ROLE'), parameters: { roleId: 'role_trial_extension_approver', now: expect.any(String) }, rowCount: 1, durationMs: expect.any(Number) });
      }
    });

    test('approval during a waiting episode schedules a fresh continuation after that episode exits', async () => {
      await teach();
      runtime = new RuntimeService({ graph, lab, model: createTestOnlyModel(), history: seed, demoMode: true });
      let reachedWaiting!: () => void, releaseWaitingWrite!: () => void, releaseWaitingEpisode!: () => void;
      const waitingReached = new Promise<void>(resolve => { reachedWaiting = resolve; });
      const waitingWriteGate = new Promise<void>(resolve => { releaseWaitingWrite = resolve; });
      const waitingEpisodeGate = new Promise<void>(resolve => { releaseWaitingEpisode = resolve; });
      const saveRequest = graph.saveRequest.bind(graph), saveEpisode = graph.saveEpisode.bind(graph);
      vi.spyOn(graph, 'saveRequest').mockImplementation(async value => {
        await saveRequest(value);
        if (value.state === 'WAITING_APPROVAL') { reachedWaiting(); await waitingWriteGate; }
      });
      vi.spyOn(graph, 'saveEpisode').mockImplementation(async value => {
        if (value.mission === 'HANDLE_REQUEST' && value.status === 'WAITING') await waitingEpisodeGate;
        await saveEpisode(value);
      });
      const request = await runtime.createRequest('person_ana', requestInput(30));
      await waitingReached;
      const plan = (await graph.getRequest(request.id))!.plan!;
      // Approval joins the broker lane before the retiring episode's final write.
      const approval = runtime.approve('person_ravi', plan.id, plan.planHash, 'APPROVED');
      releaseWaitingWrite(); await approval;
      expect((await graph.getRequest(request.id))?.request.state).toBe('QUEUED');
      releaseWaitingEpisode(); await runtime.waitForIdle();
      const completed = (await graph.getRequest(request.id))!;
      expect(completed.request.state).toBe('COMPLETED');
      expect(completed.episodes).toHaveLength(2);
      expect(completed.episodes.map(e => e.status)).toEqual(['WAITING', 'SUCCEEDED']);
    });

    test('an authority change invalidates an unused approval and routes a fresh plan to Leena', async () => {
      await teach();
      const request = await runtime.createRequest('person_ana', requestInput(30)); await runtime.runRequest(request.id);
      const old = (await graph.getRequest(request.id))!.plan!;
      await runtime.approve('person_ravi', old.id, old.planHash, 'APPROVED');
      await runtime.assign('person_mira', 'role_trial_extension_approver', 'person_leena', 1);
      expect((await graph.getRequest(request.id))?.request).toMatchObject({ state: 'BLOCKED', errorCode: 'STALE_PLAN' });
      await expect(runtime.approve('person_ravi', old.id, old.planHash, 'APPROVED')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await lab.list(request.id)).toEqual([]);
      await runtime.resume('person_ana', request.id); await runtime.runRequest(request.id);
      const fresh = (await graph.getRequest(request.id))!.plan!;
      expect(fresh.id).not.toBe(old.id); expect(fresh.planHash).not.toBe(old.planHash); expect(fresh.approverPersonId).toBe('person_leena');
      expect((await graph.getRequest(request.id))?.request.state).toBe('WAITING_APPROVAL');
      await runtime.approve('person_leena', fresh.id, fresh.planHash, 'APPROVED'); await runtime.runRequest(request.id);
      expect((await graph.getRequest(request.id))?.request.state).toBe('COMPLETED');
    });

    test('unsupported duration remains unchanged and never creates a workspace', async () => {
      await teach(); const request = await runtime.createRequest('person_ana', requestInput(14));
      await expect(runtime.runRequest(request.id)).rejects.toMatchObject({ code: 'UNSUPPORTED_REQUEST' });
      expect((await graph.getRequest(request.id))?.request).toMatchObject({ requestedDays: 14, state: 'BLOCKED', errorCode: 'UNSUPPORTED_REQUEST' });
      expect(await lab.list(request.id)).toEqual([]);
    });

    test('repeated request submission is idempotent and changed input under its key conflicts', async () => {
      await teach(); const input = requestInput();
      const first = await runtime.createRequest('person_ana', input), second = await runtime.createRequest('person_ana', input);
      expect(second.id).toBe(first.id); await runtime.runRequest(first.id);
      expect((await runtime.createRequest('person_ana', input)).id).toBe(first.id);
      await expect(runtime.createRequest('person_ana', { ...input, requestedDays: 30 })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await lab.list(first.id)).toHaveLength(1);
    });

    test('restarts after a committed Lab create and interrupted graph receipt without duplication', async () => {
      await teach(); const request = await runtime.createRequest('person_ana', requestInput());
      vi.spyOn(graph, 'saveReceipt').mockRejectedValueOnce(new AppError('DEPENDENCY_UNAVAILABLE', 'Injected receipt write interruption', 503));
      await expect(runtime.runRequest(request.id)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
      const original = (await lab.list(request.id))[0]; expect(original.active).toBe(false);
      expect((await graph.getRequest(request.id))?.request.state).toBe('FAILED');
      expect((await graph.getRequest(request.id))?.receipts).toHaveLength(0);
      await lab.close(); lab = new WorkspaceLab({ dataPath });
      runtime = new RuntimeService({ graph, lab, model: createTestOnlyModel(), history: seed, demoMode: true, autoRun: false });
      await runtime.resume('person_ana', request.id); await runtime.runRequest(request.id);
      const resources = await lab.list(request.id); expect(resources).toHaveLength(1); expect(resources[0]).toMatchObject({ id: original.id, createdAt: original.createdAt, active: true });
      const detail = (await graph.getRequest(request.id))!; expect(detail.request.state).toBe('COMPLETED'); expect(detail.receipts).toHaveLength(4);
      expect(detail.events.some(e => e.type === 'receipt_reconciled')).toBe(true);
      expect(JSON.parse(await readFile(dataPath, 'utf8')).operations).toHaveLength(4);
    });

    test('a graph outage fails closed before application mutation without a local procedure fallback', async () => {
      await teach(); const request = await runtime.createRequest('person_ana', requestInput());
      vi.spyOn(graph, 'getCurrentProcedure').mockRejectedValue(new AppError('DEPENDENCY_UNAVAILABLE', 'Injected graph read outage', 503));
      await expect(runtime.runRequest(request.id)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
      expect((await graph.getRequest(request.id))?.request).toMatchObject({ state: 'FAILED', errorCode: 'DEPENDENCY_UNAVAILABLE' });
      expect(await lab.list(request.id)).toEqual([]);
    });

    test('query audit preserves supplied trace evidence and excludes unrelated internal write traces', async () => {
      // This assertion tests forwarding, not query execution. Actual query evidence
      // is checked separately in the opt-in FalkorDB cases above.
      const exact = { name: 'Q3_current_role_holder', query: 'MATCH (person:Person)-[:HOLDS_ROLE]->(role:Role {id: $roleId}) RETURN person.id', parameters: { roleId: 'role_trial_extension_approver' }, rowCount: 1, durationMs: 4 };
      vi.spyOn(graph, 'drainTraces').mockReturnValueOnce([exact, { name: 'save_request', query: 'internal write', parameters: {}, rowCount: 0, durationMs: 2 }]);
      await runtime.broker.run(() => runtime.recordTraces('trace_test'));
      const events = await graph.getEvents(0, 'trace_test');
      expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ type: 'graph_query', actorId: 'graph', data: exact });
      expect(events[0].message).toContain('1 rows in 4 ms');
    });

    test('a rejected extension remains terminal and cannot be resumed by its operator', async () => {
      await teach(); const request = await runtime.createRequest('person_ana', requestInput(30)); await runtime.runRequest(request.id);
      const plan = (await graph.getRequest(request.id))!.plan!;
      await runtime.approve('person_ravi', plan.id, plan.planHash, 'REJECTED');
      await expect(runtime.resume('person_ana', request.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await graph.getRequest(request.id))?.request.state).toBe('REJECTED'); expect(await lab.list(request.id)).toEqual([]);
    });

    test('concurrent submission and reset cannot erase a newly scheduled active job', async () => {
      await teach();
      let releaseBroker!: () => void, releaseModel!: () => void;
      const brokerGate = new Promise<void>(resolve => { releaseBroker = resolve; });
      const modelGate = new Promise<void>(resolve => { releaseModel = resolve; });
      const delegate = createTestOnlyModel();
      const gated: ModelAdapter = { mode: 'test', model: delegate.model, async turn(input, tools, signal) { await modelGate; return delegate.turn(input, tools, signal); } };
      runtime = new RuntimeService({ graph, lab, model: gated, history: seed, demoMode: true });
      const blocker = runtime.broker.run(() => brokerGate);
      const submitted = runtime.createRequest('person_ana', requestInput());
      const reset = runtime.reset('person_mira');
      const rejectedReset = expect(reset).rejects.toMatchObject({ code: 'CONFLICT' });
      releaseBroker(); await blocker;
      const request = await submitted; await rejectedReset;
      expect(await graph.getCurrentProcedure('process_trial')).not.toBeNull();
      expect(await graph.getRequest(request.id)).not.toBeNull();
      releaseModel(); await runtime.waitForIdle();
      expect((await graph.getRequest(request.id))?.request.state).toBe('COMPLETED');
    });

    test('a stalled request model fails visibly at its bounded timeout with no workspace', async () => {
      await teach(); const request = await runtime.createRequest('person_ana', requestInput());
      let reachedModel!: () => void;
      const modelStarted = new Promise<void>(resolve => { reachedModel = resolve; });
      const stalled: ModelAdapter = { mode: 'test', model: 'test-only-stalled', turn: async () => { reachedModel(); return new Promise(() => {}); } };
      runtime = new RuntimeService({ graph, lab, model: stalled, history: seed, demoMode: true, autoRun: false });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const result = runtime.runRequest(request.id); const assertion = expect(result).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
      // Let real FalkorDB setup reads complete before advancing virtual time.
      // Otherwise their own five-second I/O deadlines fire before Redis can reply,
      // testing a database outage instead of the intended stalled-model boundary.
      await modelStarted;
      await vi.advanceTimersByTimeAsync(120_000); await assertion;
      vi.useRealTimers();
      const detail = (await graph.getRequest(request.id))!; expect(detail.request).toMatchObject({ state: 'FAILED', errorCode: 'BUDGET_EXCEEDED' });
      expect(detail.episodes.at(-1)?.status).toBe('FAILED'); expect(await lab.list(request.id)).toEqual([]);
    });
  });
}
