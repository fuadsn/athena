import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { RequestDetail, Review, TrialRequestInput } from '@athena/contracts';
import { createRuntimeServer, signSession } from '../../apps/runtime/src/server';
import { WorkspaceLab } from '../../apps/workspace-lab/src/application';
import { seed } from '../../packages/graph/test/fixtures';
import { TestOnlyGraphStore, createTestOnlyModel } from '../support/runtime-fixtures';

const sessionSecret = 'runtime-http-test-only-session-secret-123456';
const review: Review = { normalDurationDays: 9, extendedDurationDays: 30, accessRole: 'member', extensionApprovalRoleId: 'role_trial_extension_approver', configureWhileInactive: true, activateAfterConfiguration: true, confirmAllFields: true };
const requestInput = (requestedDays: number | null = null): TrialRequestInput => ({ processId: 'process_trial', customerId: 'customer_http', customerName: 'HTTP customer', ownerEmail: 'owner@http-test.example', requestedDays, idempotencyKey: 'http-request-key' });

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No runtime TCP listener');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

/** Actual HTTP and file-backed Lab; only company graph/model are explicitly test doubles. */
describe('runtime HTTP sessions and authorization boundary', () => {
  let directory: string;
  let graph: TestOnlyGraphStore;
  let lab: WorkspaceLab;
  let runtime: ReturnType<typeof createRuntimeServer>;
  let url: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'athena-runtime-http-'));
    graph = new TestOnlyGraphStore(seed);
    lab = new WorkspaceLab({ dataPath: join(directory, 'lab.json') });
    runtime = createRuntimeServer({ graph, lab, model: createTestOnlyModel(), history: seed, demoMode: true, autoRun: false, sessionSecret });
    url = await listen(runtime.server);
  });

  afterEach(async () => {
    if (runtime) { await close(runtime.server); await runtime.service.waitForIdle(); }
    if (lab) await lab.close();
    if (graph) await graph.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function json(path: string, options: { method?: string; cookie?: string; input?: unknown; headers?: Record<string, string> } = {}) {
    return fetch(`${url}${path}`, {
      method: options.method ?? 'GET',
      headers: { ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.input !== undefined ? { 'content-type': 'application/json' } : {}), ...options.headers },
      ...(options.input !== undefined ? { body: JSON.stringify(options.input) } : {}),
    });
  }

  async function login(personId: string): Promise<string> {
    const response = await json('/session', { method: 'POST', input: { personId } });
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    return setCookie!.split(';')[0];
  }

  async function candidate(): Promise<string> {
    const run = await runtime.service.startLearning('person_mira', seed.cases.map(item => item.id));
    await runtime.service.runLearning(run.id);
    return (await graph.getLearningRun(run.id))!.candidate!.id;
  }

  async function teach(): Promise<void> {
    const id = await candidate();
    const ownerCookie = await login('person_mira');
    const response = await json(`/procedures/${id}/publish`, { method: 'POST', cookie: ownerCookie, input: { review, expectedRevision: 0 } });
    expect(response.status).toBe(200);
  }

  it('issues a signed HttpOnly cookie and uses that identity for authenticated state', async () => {
    const cookie = await login('person_ana');
    const response = await json('/state', { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const state = await response.json();
    expect(state).toMatchObject({ currentActorId: 'person_ana', demoMode: true, knowledgeRevision: 0 });
    expect(JSON.stringify(state)).not.toContain(sessionSecret);
  });

  it('rejects absent, tampered, expired and unknown-person sessions', async () => {
    const valid = signSession('person_ana', sessionSecret);
    const [payload, signature] = valid.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const forgedPayload = Buffer.from(JSON.stringify({ ...decoded, actorId: 'person_mira' })).toString('base64url');
    const cookies = [undefined, `athena_session=${forgedPayload}.${signature}`, `athena_session=${signSession('person_ana', sessionSecret, Date.now() - 1)}`, `athena_session=${signSession('person_nonexistent', sessionSecret)}`, `athena_session=${valid}.extra`, 'athena_session=invalid.signature'];
    for (const cookie of cookies) {
      const response = await json('/state', { cookie });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }
    const headerSpoof = await json('/state', { headers: { 'x-actor-id': 'person_mira', authorization: 'Bearer person_mira' } });
    expect(headerSpoof.status).toBe(403);
  });

  it('rejects unknown personas and disables persona issuance outside demo mode', async () => {
    const unknown = await json('/session', { method: 'POST', input: { personId: 'person_nonexistent' } });
    expect(unknown.status).toBe(403);
    await close(runtime.server);
    runtime = createRuntimeServer({ graph, lab, model: createTestOnlyModel(), history: seed, demoMode: false, autoRun: false, sessionSecret });
    url = await listen(runtime.server);
    const response = await json('/session', { method: 'POST', input: { personId: 'person_mira' } });
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects body actor spoofing before any request or company mutation', async () => {
    const id = await candidate();
    const cookie = await login('person_ana');
    const attempts = [
      { path: '/requests', input: { ...requestInput(), actorId: 'person_mira' } },
      { path: `/procedures/${id}/publish`, input: { review, expectedRevision: 0, actorId: 'person_mira' } },
      { path: '/authority/assign', input: { roleId: review.extensionApprovalRoleId, personId: 'person_leena', expectedRevision: 0, actorId: 'person_mira' } },
      { path: '/session', input: { personId: 'person_ana', actorId: 'person_mira' } },
    ];
    for (const attempt of attempts) {
      const response = await json(attempt.path, { method: 'POST', cookie, input: attempt.input });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    }
    expect(await graph.getKnowledgeRevision()).toBe(0);
    expect(await graph.getCurrentProcedure('process_trial')).toBeNull();
    expect((await graph.getState()).requests).toEqual([]);
  });

  it.each(['person_ana', 'person_ravi', 'person_leena'])('prevents %s from publishing or assigning company authority', async actor => {
    const id = await candidate();
    const cookie = await login(actor);
    const published = await json(`/procedures/${id}/publish`, { method: 'POST', cookie, input: { review, expectedRevision: 0 } });
    expect(published.status).toBe(403);
    const assigned = await json('/authority/assign', { method: 'POST', cookie, input: { roleId: review.extensionApprovalRoleId, personId: 'person_leena', expectedRevision: 0 } });
    expect(assigned.status).toBe(403);
    expect(await graph.getKnowledgeRevision()).toBe(0);
    expect((await graph.resolveAuthority(review.extensionApprovalRoleId, new Date().toISOString())).person.id).toBe('person_ravi');
  });

  it.each(['person_mira', 'person_ravi', 'person_leena'])('does not treat %s as an authorized trial operator', async actor => {
    const cookie = await login(actor);
    const response = await json('/requests', { method: 'POST', cookie, input: requestInput() });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect((await graph.getState()).requests).toEqual([]);
  });

  it.each(['https://foreign.example', 'http://localhost.foreign.example', 'null'])('rejects foreign mutation Origin %s before issuing sessions or creating work', async origin => {
    const cookie = await login('person_ana');
    const session = await json('/session', { method: 'POST', input: { personId: 'person_mira' }, headers: { origin } });
    expect(session.status).toBe(403);
    expect(session.headers.get('set-cookie')).toBeNull();
    const request = await json('/requests', { method: 'POST', cookie, input: requestInput(), headers: { origin } });
    expect(request.status).toBe(403);
    expect((await graph.getState()).requests).toEqual([]);
  });

  it('accepts the legitimate local origin and ties persisted work to the signed operator', async () => {
    await teach();
    const cookie = await login('person_ana');
    const created = await json('/requests', { method: 'POST', cookie, input: requestInput(), headers: { origin: 'http://localhost:3100', 'x-actor-id': 'person_mira' } });
    expect(created.status).toBe(202);
    const payload = await created.json();
    expect(payload.request.requestedBy).toBe('person_ana');
    await runtime.service.runRequest(payload.id);
    const read = await json(`/requests/${payload.id}`, { cookie });
    const detail = await read.json() as RequestDetail;
    expect(detail.request).toMatchObject({ state: 'COMPLETED', requestedBy: 'person_ana' });
    expect(detail.verification?.passed).toBe(true);
    const resources = await lab.list(payload.id);
    expect(resources).toHaveLength(1);
    expect(Date.parse(resources[0].expiresAt!) - Date.parse(resources[0].createdAt)).toBe(9 * 86_400_000);
  });

  it('permits only the signed current approver and binds approval to the displayed exact plan', async () => {
    await teach();
    const operatorCookie = await login('person_ana');
    const created = await json('/requests', { method: 'POST', cookie: operatorCookie, input: requestInput(30) });
    const payload = await created.json();
    await runtime.service.runRequest(payload.id);
    const detail = (await graph.getRequest(payload.id))!;
    expect(detail.request.state).toBe('WAITING_APPROVAL');
    const path = `/plans/${detail.plan!.id}/approval`;
    for (const actor of ['person_ana', 'person_mira', 'person_leena']) {
      const cookie = await login(actor);
      const denied = await json(path, { method: 'POST', cookie, input: { planHash: detail.plan!.planHash, decision: 'APPROVED' } });
      expect(denied.status).toBe(403);
    }
    const approverCookie = await login('person_ravi');
    const forged = await json(path, { method: 'POST', cookie: approverCookie, input: { planHash: '0'.repeat(64), decision: 'APPROVED' } });
    expect(forged.status).toBe(409);
    expect(await lab.list(payload.id)).toEqual([]);
    const approved = await json(path, { method: 'POST', cookie: approverCookie, input: { planHash: detail.plan!.planHash, decision: 'APPROVED' } });
    expect(approved.status).toBe(200);
    await runtime.service.runRequest(payload.id);
    expect((await graph.getRequest(payload.id))?.request.state).toBe('COMPLETED');
    expect(await lab.list(payload.id)).toHaveLength(1);
  });

  it('restricts administrative reset to the signed process owner', async () => {
    const operatorCookie = await login('person_ana');
    const denied = await json('/demo/reset', { method: 'POST', cookie: operatorCookie, input: {} });
    expect(denied.status).toBe(403);
    const ownerCookie = await login('person_mira');
    const reset = await json('/demo/reset', { method: 'POST', cookie: ownerCookie, input: {} });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ ok: true });
    expect(await graph.getCurrentProcedure('process_trial')).toBeNull();
  });
});
