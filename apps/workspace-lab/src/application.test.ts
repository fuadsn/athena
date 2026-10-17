import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { operationHash, type ToolName } from '@athena/contracts';
import { WorkspaceLab } from './application';

function operation<T extends Record<string, unknown>>(tool: ToolName, resourceId: string | null, stepId: string, fields: T, requestId = 'req_a') {
  const input = { requestId, stepId, ...fields, operationKey: `${requestId}/${stepId}`, inputHash: '' };
  return { ...input, inputHash: operationHash(tool, resourceId, input) };
}

describe('Workspace Lab application with real file persistence', () => {
  let directory: string;
  let dataPath: string;
  let app: WorkspaceLab;
  let now: Date;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'athena-lab-app-'));
    dataPath = join(directory, 'state.json');
    now = new Date('2030-01-01T10:00:00.000Z');
    app = new WorkspaceLab({ dataPath, now: () => now });
  });
  afterEach(async () => {
    await chmod(directory, 0o700);
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  const createInput = () => operation('create_workspace', null, 'create', { customerId: 'customer_a' });

  it('atomically persists one resource and receipt across concurrent identical creates', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => app.create(createInput())));
    expect(new Set(results.map(result => result.workspace.id)).size).toBe(1);
    expect(results.filter(result => result.receipt.result === 'APPLIED')).toHaveLength(1);
    expect(results.filter(result => result.receipt.result === 'ALREADY_APPLIED')).toHaveLength(19);
    const state = JSON.parse(await readFile(dataPath, 'utf8'));
    expect(state.workspaces).toHaveLength(1);
    expect(state.operations).toHaveLength(1);
    expect(state.operations[0].workspace).toEqual(state.workspaces[0]);
    expect((await readdir(directory)).sort()).toEqual(['state.json', 'state.json.lock']);
  });

  it('recovers a committed operation after the caller loses its receipt and restarts', async () => {
    await app.create(createInput()); // Caller crashes before saving the returned receipt.
    await app.close();
    app = new WorkspaceLab({ dataPath, now: () => now });
    const recovered = await app.operation('req_a/create');
    expect(recovered?.receipt.result).toBe('APPLIED');
    const retry = await app.create(createInput());
    expect(retry.receipt.result).toBe('ALREADY_APPLIED');
    expect(retry.workspace.id).toBe(recovered?.workspace.id);
    expect(await app.list('req_a')).toHaveLength(1);
  });

  it('rejects forged hashes, changed semantic input, reused step keys and duplicate requests', async () => {
    await expect(app.create({ ...createInput(), customerId: 'forged' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(app.create({ ...createInput(), operationKey: 'req_other/create' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const first = await app.create(createInput());
    await expect(app.create(operation('create_workspace', null, 'create', { customerId: 'different' }))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(app.create(operation('create_workspace', null, 'another_create', { customerId: 'customer_a' }))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(app.setExpiry(first.workspace.id, operation('set_expiry', first.workspace.id, 'create', { expiresAt: '2030-01-10T10:00:00.000Z' }))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await app.list('req_a')).toHaveLength(1);
    expect(JSON.parse(await readFile(dataPath, 'utf8')).operations).toHaveLength(1);
  });

  it('requires inactive configuration, evaluates actual access and denies expiry at its exact boundary', async () => {
    const { workspace } = await app.create(createInput());
    const activation = operation('activate_workspace', workspace.id, 'activate', {});
    await expect(app.activate(workspace.id, activation)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await app.operation('req_a/activate')).toBeNull();
    const expiry = operation('set_expiry', workspace.id, 'expiry', { expiresAt: '2030-01-10T10:00:00.000Z' });
    await app.setExpiry(workspace.id, expiry);
    await expect(app.activate(workspace.id, activation)).rejects.toMatchObject({ code: 'CONFLICT' });
    await app.setGrants(workspace.id, operation('grant_access', workspace.id, 'grants', { grants: [{ email: 'owner@example.com', role: 'viewer' as const }] }));
    expect(await app.checkAccess(workspace.id, 'owner@example.com')).toMatchObject({ allowed: false });
    await app.activate(workspace.id, activation);
    expect(await app.checkAccess(workspace.id, 'owner@example.com')).toMatchObject({ allowed: true, role: 'viewer' });
    expect(await app.checkAccess(workspace.id, 'stranger@example.com')).toMatchObject({ allowed: false, role: null });
    expect((await app.setExpiry(workspace.id, expiry)).receipt.result).toBe('ALREADY_APPLIED');
    await expect(app.setExpiry(workspace.id, operation('set_expiry', workspace.id, 'new_expiry', { expiresAt: '2030-02-10T10:00:00.000Z' }))).rejects.toMatchObject({ code: 'CONFLICT' });
    now = new Date('2030-01-10T10:00:00.000Z');
    expect(await app.checkAccess(workspace.id, 'owner@example.com')).toMatchObject({ allowed: false, role: null });
    expect((await app.read(workspace.id)).active).toBe(true);
  });

  it('blocks cross-request writes and duplicate identities while keeping the store unchanged', async () => {
    const { workspace } = await app.create(createInput());
    const before = await readFile(dataPath, 'utf8');
    await expect(app.setExpiry(workspace.id, operation('set_expiry', workspace.id, 'expiry', { expiresAt: '2030-01-10T10:00:00.000Z' }, 'req_other'))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(app.setGrants(workspace.id, operation('grant_access', workspace.id, 'grants', { grants: [{ email: 'owner@example.com', role: 'member' as const }, { email: 'OWNER@example.com', role: 'admin' as const }] }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await readFile(dataPath, 'utf8')).toBe(before);
  });

  it('preserves the committed snapshot when a real filesystem permission failure prevents writing', async () => {
    const { workspace } = await app.create(createInput());
    const before = await readFile(dataPath, 'utf8');
    await chmod(directory, 0o500);
    try {
      await expect(app.setExpiry(workspace.id, operation('set_expiry', workspace.id, 'expiry', { expiresAt: '2030-01-10T10:00:00.000Z' }))).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    } finally { await chmod(directory, 0o700); }
    expect(await readFile(dataPath, 'utf8')).toBe(before);
    expect(await app.operation('req_a/expiry')).toBeNull();
    expect((await app.read(workspace.id)).expiresAt).toBeNull();
  });

  it('reads actual persisted changes and refuses corrupt or missing storage without recreating it', async () => {
    const { workspace } = await app.create(createInput());
    const state = JSON.parse(await readFile(dataPath, 'utf8'));
    state.workspaces[0].grants = [{ email: 'owner@example.com', role: 'admin' }];
    await writeFile(dataPath, JSON.stringify(state));
    expect((await app.read(workspace.id)).grants[0].role).toBe('admin');
    await writeFile(dataPath, '{corrupt');
    await expect(app.read(workspace.id)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(await readFile(dataPath, 'utf8')).toBe('{corrupt');
    await rm(dataPath);
    await expect(app.create(createInput())).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    await expect(readFile(dataPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('holds a single-writer lock and makes reset remove workspaces and durable receipts together', async () => {
    expect(() => new WorkspaceLab({ dataPath })).toThrow('Another Lab process owns this store');
    await app.create(createInput());
    await app.reset();
    const state = JSON.parse(await readFile(dataPath, 'utf8'));
    expect(state.workspaces).toEqual([]);
    expect(state.operations).toEqual([]);
    expect(await app.operation('req_a/create')).toBeNull();
    await app.close();
    app = new WorkspaceLab({ dataPath, now: () => now });
    expect(await app.list('req_a')).toEqual([]);
  });

  it('recovers a terminated owner lock while refusing ambiguous interrupted lock recovery', async () => {
    await app.create(createInput());
    await app.close();
    await writeFile(`${dataPath}.lock`, JSON.stringify({ pid: 2_147_483_647 }));
    app = new WorkspaceLab({ dataPath, now: () => now });
    expect(await app.list('req_a')).toHaveLength(1);
    await app.close();
    await writeFile(`${dataPath}.lock`, JSON.stringify({ pid: 2_147_483_647 }));
    await writeFile(`${dataPath}.lock.recovery`, JSON.stringify({ pid: 2_147_483_647 }));
    expect(() => new WorkspaceLab({ dataPath })).toThrow('Lab store lock recovery is already in progress');
  });
});
