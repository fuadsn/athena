import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { operationHash, type LabClient, type ToolName, type Workspace } from '@athena/contracts';
import { createLabServer } from '../../apps/workspace-lab/src/server';
import { createLabClient } from '../../apps/workspace-lab/src/client';

const token = 'test-lab-write-token';
const adminToken = 'test-lab-admin-token';

function envelope<T extends Record<string, unknown>>(tool: ToolName, resourceId: string | null, stepId: string, fields: T, requestId = 'request_alpha') {
  const input = { requestId, stepId, ...fields, operationKey: `${requestId}/${stepId}`, inputHash: '' };
  return { ...input, inputHash: operationHash(tool, resourceId, input) };
}

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP listener');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

describe('Workspace Lab real HTTP and durable store', () => {
  let directory: string;
  let dataPath: string;
  let server: Server;
  let url: string;
  let client: LabClient;
  let clock: Date;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'athena-lab-'));
    dataPath = join(directory, 'state.json');
    clock = new Date('2030-04-20T10:00:00.000Z');
    server = createLabServer({ dataPath, token, adminToken, allowReset: true, now: () => clock });
    url = await listen(server);
    client = createLabClient({ url, token, adminToken });
  });

  afterEach(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  async function create(): Promise<Workspace> {
    return (await client.create(envelope('create_workspace', null, 'create', { customerId: 'customer_alpha' }))).workspace;
  }

  async function configure(workspace: Workspace, role: 'member' | 'admin' | 'viewer' = 'member') {
    await client.setExpiry(workspace.id, envelope('set_expiry', workspace.id, 'expiry', { expiresAt: '2030-04-29T10:00:00.000Z' }));
    await client.setGrants(workspace.id, envelope('grant_access', workspace.id, 'grants', { grants: [{ email: 'owner@example.com', role }] }));
  }

  it('persists actual inactive resources, activation and access expiry without company constants', async () => {
    const workspace = await create();
    expect(workspace).toMatchObject({ active: false, expiresAt: null, grants: [], createdAt: clock.toISOString() });
    expect(await client.checkAccess(workspace.id, 'owner@example.com')).toMatchObject({ allowed: false, role: null });
    await configure(workspace);
    expect(await client.checkAccess(workspace.id, 'owner@example.com')).toMatchObject({ allowed: false });
    await client.activate(workspace.id, envelope('activate_workspace', workspace.id, 'activate', {}));
    expect(await client.checkAccess(workspace.id, 'OWNER@example.com')).toMatchObject({ allowed: true, role: 'member' });
    expect(await client.checkAccess(workspace.id, 'stranger@example.com')).toMatchObject({ allowed: false, role: null });
    const stored = JSON.parse(await readFile(dataPath, 'utf8'));
    expect(stored.workspaces).toHaveLength(1);
    expect(stored.operations).toHaveLength(4);
    expect(stored.workspaces[0]).toEqual(await client.read(workspace.id));
    clock = new Date('2030-04-29T10:00:00.000Z');
    expect(await client.checkAccess(workspace.id, 'owner@example.com')).toMatchObject({ allowed: false, role: null });
  });

  it('rejects activation until expiry and grants exist, and keeps failed mutations uncommitted', async () => {
    const workspace = await create();
    const activation = envelope('activate_workspace', workspace.id, 'activate', {});
    await expect(client.activate(workspace.id, activation)).rejects.toMatchObject({ code: 'CONFLICT' });
    await client.setExpiry(workspace.id, envelope('set_expiry', workspace.id, 'expiry', { expiresAt: '2030-04-19T10:00:00.000Z' }));
    await client.setGrants(workspace.id, envelope('grant_access', workspace.id, 'grants', { grants: [{ email: 'owner@example.com', role: 'member' as const }] }));
    await expect(client.activate(workspace.id, activation)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await client.operation('request_alpha/activate')).toBeNull();
    expect((await client.read(workspace.id)).active).toBe(false);
    await client.setExpiry(workspace.id, envelope('set_expiry', workspace.id, 'expiry_fix', { expiresAt: '2030-04-20T10:00:00.001Z' }));
    expect((await client.activate(workspace.id, activation)).workspace.active).toBe(true);
  });

  it('serves identical retries concurrently as one durable operation and prevents a second create step', async () => {
    const input = envelope('create_workspace', null, 'create', { customerId: 'customer_alpha' });
    const operations = await Promise.all(Array.from({ length: 12 }, () => client.create(input)));
    expect(new Set(operations.map(operation => operation.workspace.id)).size).toBe(1);
    expect(operations.filter(operation => operation.receipt.result === 'APPLIED')).toHaveLength(1);
    expect(operations.filter(operation => operation.receipt.result === 'ALREADY_APPLIED')).toHaveLength(11);
    expect(await client.list('request_alpha')).toHaveLength(1);
    await expect(client.create(envelope('create_workspace', null, 'create_again', { customerId: 'customer_alpha' }))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(JSON.parse(await readFile(dataPath, 'utf8')).operations).toHaveLength(1);
  });

  it('reconciles original receipts after restart while read returns the latest application state', async () => {
    const workspace = await create();
    await configure(workspace);
    await client.activate(workspace.id, envelope('activate_workspace', workspace.id, 'activate', {}));
    await close(server);
    server = createLabServer({ dataPath, token, adminToken, allowReset: true, now: () => clock });
    url = await listen(server);
    client = createLabClient({ url, token, adminToken });
    const original = await client.operation('request_alpha/create');
    expect(original?.workspace.active).toBe(false);
    expect(original?.receipt.result).toBe('APPLIED');
    expect((await client.read(workspace.id)).active).toBe(true);
    const retry = await client.create(envelope('create_workspace', null, 'create', { customerId: 'customer_alpha' }));
    expect(retry.receipt.result).toBe('ALREADY_APPLIED');
    expect(retry.workspace.id).toBe(workspace.id);
    expect(await client.list('request_alpha')).toHaveLength(1);
  });

  it('rejects a changed input under the same operation key', async () => {
    await create();
    await expect(client.create(envelope('create_workspace', null, 'create', { customerId: 'other_customer' }))).rejects.toMatchObject({ code: 'CONFLICT' });
    const workspace = (await client.list('request_alpha'))[0];
    await configure(workspace);
    await expect(client.setExpiry(workspace.id, envelope('set_expiry', workspace.id, 'expiry', { expiresAt: '2030-05-20T10:00:00.000Z' }))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await client.read(workspace.id)).expiresAt).toBe('2030-04-29T10:00:00.000Z');
  });

  it('recomputes input hashes and validates key bindings before any write', async () => {
    const input = envelope('create_workspace', null, 'create', { customerId: 'customer_alpha' });
    await expect(client.create({ ...input, customerId: 'tampered' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(client.create({ ...input, operationKey: 'request_alpha/different_step' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await client.list('request_alpha')).toEqual([]);
    expect(await client.operation(input.operationKey)).toBeNull();
  });

  it('prevents cross-request mutation and immutable active-resource reconfiguration', async () => {
    const workspace = await create();
    await expect(client.setExpiry(workspace.id, envelope('set_expiry', workspace.id, 'expiry', { expiresAt: '2030-04-29T10:00:00.000Z' }, 'wrong_request'))).rejects.toMatchObject({ code: 'CONFLICT' });
    await configure(workspace);
    const expiryRetry = envelope('set_expiry', workspace.id, 'expiry', { expiresAt: '2030-04-29T10:00:00.000Z' });
    await client.activate(workspace.id, envelope('activate_workspace', workspace.id, 'activate', {}));
    expect((await client.setExpiry(workspace.id, expiryRetry)).receipt.result).toBe('ALREADY_APPLIED');
    await expect(client.setExpiry(workspace.id, envelope('set_expiry', workspace.id, 'change_expiry', { expiresAt: '2030-04-30T10:00:00.000Z' }))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(client.setGrants(workspace.id, envelope('grant_access', workspace.id, 'change_grants', { grants: [{ email: 'owner@example.com', role: 'admin' as const }] }))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps real privileged access and expiry observable for independent verification', async () => {
    const workspace = await create();
    await configure(workspace, 'admin');
    await client.activate(workspace.id, envelope('activate_workspace', workspace.id, 'activate', {}));
    // The application permits valid capabilities; the company verifier must reject this role.
    expect((await client.read(workspace.id)).grants).toEqual([{ email: 'owner@example.com', role: 'admin' }]);
    expect(await client.checkAccess(workspace.id, 'owner@example.com')).toMatchObject({ allowed: true, role: 'admin' });
    const state = JSON.parse(await readFile(dataPath, 'utf8'));
    state.workspaces[0].expiresAt = '2030-04-20T09:59:59.000Z';
    await writeFile(dataPath, JSON.stringify(state));
    expect((await client.read(workspace.id)).expiresAt).toBe('2030-04-20T09:59:59.000Z');
    expect(await client.checkAccess(workspace.id, 'owner@example.com')).toMatchObject({ allowed: false });
  });

  it('validates server-side credentials, strict payloads and unique grant identities', async () => {
    const input = envelope('create_workspace', null, 'create', { customerId: 'customer_alpha' });
    const denied = await fetch(`${url}/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(denied.status).toBe(403);
    const unknownField = await fetch(`${url}/workspaces`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...input, actorId: 'admin' }) });
    expect(unknownField.status).toBe(400);
    const malformed = await fetch(`${url}/workspaces`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{bad' });
    expect(malformed.status).toBe(400);
    const workspace = await create();
    await expect(client.setGrants(workspace.id, envelope('grant_access', workspace.id, 'grants', { grants: [{ email: 'owner@example.com', role: 'member' as const }, { email: 'OWNER@example.com', role: 'admin' as const }] }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await client.read(workspace.id)).grants).toEqual([]);
    const wrongTokenClient = createLabClient({ url, token: 'wrong' });
    await expect(wrongTokenClient.read(workspace.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('limits reset to explicit demo administration with a distinct token', async () => {
    await create();
    for (const suppliedToken of [undefined, 'wrong-admin-token']) {
      const deniedReset = await fetch(`${url}/admin/reset`, { method: 'POST', headers: { ...(suppliedToken ? { authorization: `Bearer ${suppliedToken}` } : {}), 'content-type': 'application/json' }, body: '{}' });
      expect(deniedReset.status).toBe(403);
    }
    const writeTokenReset = await fetch(`${url}/admin/reset`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
    expect(writeTokenReset.status).toBe(403);
    expect(await client.list('request_alpha')).toHaveLength(1);
    await client.reset();
    expect(await client.list('request_alpha')).toEqual([]);
    expect(await client.operation('request_alpha/create')).toBeNull();
    await close(server);
    server = createLabServer({ dataPath, token, adminToken });
    url = await listen(server);
    client = createLabClient({ url, token, adminToken });
    await expect(client.reset()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses concurrent ownership of a store and fails closed on damaged persistence', async () => {
    expect(() => createLabServer({ dataPath, token })).toThrow('Another Lab process owns this store');
    await create();
    await writeFile(dataPath, '{corrupt');
    await expect(client.list('request_alpha')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    await expect(client.create(envelope('create_workspace', null, 'create', { customerId: 'customer_beta' }, 'request_beta'))).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(await readFile(dataPath, 'utf8')).toBe('{corrupt');
  });

  it('returns unavailable on network failure and timeout without inventing receipts', async () => {
    const slowServer = createServer((_request, _response) => undefined);
    const slowUrl = await listen(slowServer);
    try {
      const slowClient = createLabClient({ url: slowUrl, token, timeoutMs: 30 });
      await expect(slowClient.list('request_alpha')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Lab request timed out; reconcile before retrying' });
    } finally { slowServer.closeAllConnections(); await close(slowServer); }
    await close(server);
    await expect(client.list('request_alpha')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('reconciles a committed write after its HTTP response is lost', async () => {
    const proxy = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const committed = await fetch(`${url}${request.url}`, {
        method: request.method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: Buffer.concat(chunks),
      });
      await committed.text();
      // The real Lab has committed both state and receipt; its caller loses the response.
      response.destroy();
    });
    const proxyUrl = await listen(proxy);
    const input = envelope('create_workspace', null, 'create', { customerId: 'customer_alpha' });
    try {
      await expect(createLabClient({ url: proxyUrl, token }).create(input)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
      const receipt = await client.operation('request_alpha/create');
      expect(receipt?.receipt.result).toBe('APPLIED');
      const retry = await client.create(input);
      expect(retry.receipt.result).toBe('ALREADY_APPLIED');
      expect(retry.workspace.id).toBe(receipt?.workspace.id);
      expect(await client.list('request_alpha')).toHaveLength(1);
    } finally { await close(proxy); }
  });

  it('fails closed if a previously persisted store disappears', async () => {
    await create();
    await rm(dataPath);
    await expect(client.list('request_alpha')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    await expect(client.create(envelope('create_workspace', null, 'create', { customerId: 'customer_beta' }, 'request_beta'))).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    await expect(readFile(dataPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not forward credentials across redirects or accept malformed successful responses', async () => {
    let destinationCalls = 0;
    const destination = createServer((_request, response) => { destinationCalls += 1; response.end('[]'); });
    const destinationUrl = await listen(destination);
    const redirect = createServer((_request, response) => { response.writeHead(302, { location: destinationUrl }); response.end(); });
    const redirectUrl = await listen(redirect);
    const malformed = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"success":true}'); });
    const malformedUrl = await listen(malformed);
    try {
      await expect(createLabClient({ url: redirectUrl, token }).list('request_alpha')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
      expect(destinationCalls).toBe(0);
      await expect(createLabClient({ url: malformedUrl, token }).list('request_alpha')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Lab returned an invalid response' });
    } finally { await Promise.all([close(destination), close(redirect), close(malformed)]); }
  });
});
