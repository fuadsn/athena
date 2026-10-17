import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AppError, IdSchema, LabActivateSchema, LabCreateSchema, LabExpirySchema, LabGrantsSchema,
  operationHash, type LabClient, type LabOperation, type ToolName, type Workspace,
} from '@athena/contracts';
import { LabStore } from './store';

type Envelope = { requestId: string; stepId: string; operationKey: string; inputHash: string };

/** File-backed application capabilities. Authentication belongs to its HTTP boundary. */
export class WorkspaceLab implements LabClient {
  private readonly store: LabStore;
  private readonly now: () => Date;

  constructor(options: { dataPath: string; now?: () => Date }) {
    this.store = new LabStore(options.dataPath);
    this.now = options.now ?? (() => new Date());
  }

  private async mutate(tool: ToolName, id: string | null, input: Envelope & Record<string, unknown>, change: (workspace: Workspace) => void): Promise<LabOperation> {
    if (input.operationKey !== `${input.requestId}/${input.stepId}`) throw new AppError('INVALID_INPUT', 'Operation key must be requestId/stepId');
    if (input.inputHash !== operationHash(tool, id, input)) throw new AppError('INVALID_INPUT', 'Input hash does not match the submitted operation');
    return this.store.transaction(state => {
      const prior = state.operations.find(item => item.operationKey === input.operationKey);
      if (prior) {
        if (prior.inputHash !== input.inputHash) throw new AppError('CONFLICT', 'Operation key was already used with different inputs', 409);
        return { value: { ...prior, receipt: { ...prior.receipt, result: 'ALREADY_APPLIED' as const } }, changed: false };
      }
      const observedAt = this.now().toISOString();
      let workspace: Workspace;
      if (tool === 'create_workspace') {
        if (state.workspaces.some(item => item.requestId === input.requestId)) throw new AppError('CONFLICT', 'This request already has a workspace', 409);
        workspace = { id: `ws_${randomUUID()}`, requestId: input.requestId, customerId: input.customerId as string, createdAt: observedAt, expiresAt: null, grants: [], active: false };
        state.workspaces.push(workspace);
      } else {
        const existing = state.workspaces.find(item => item.id === id);
        if (!existing) throw new AppError('NOT_FOUND', 'Workspace does not exist', 404);
        if (existing.requestId !== input.requestId) throw new AppError('CONFLICT', 'Workspace belongs to a different request', 409);
        if (existing.active) throw new AppError('CONFLICT', 'Active workspaces cannot be reconfigured', 409);
        workspace = existing;
      }
      change(workspace);
      const operation: LabOperation = {
        operationKey: input.operationKey,
        inputHash: input.inputHash,
        workspace: structuredClone(workspace),
        receipt: { requestId: input.requestId, stepId: input.stepId, operationKey: input.operationKey, inputHash: input.inputHash, resourceId: workspace.id, observedAt, result: 'APPLIED' },
      };
      state.operations.push(operation);
      return { value: operation, changed: true };
    });
  }

  async create(raw: z.infer<typeof LabCreateSchema>): Promise<LabOperation> {
    const input = LabCreateSchema.parse(raw);
    return this.mutate('create_workspace', null, input, () => undefined);
  }

  async setExpiry(id: string, raw: z.infer<typeof LabExpirySchema>): Promise<LabOperation> {
    IdSchema.parse(id);
    const input = LabExpirySchema.parse(raw);
    return this.mutate('set_expiry', id, input, workspace => { workspace.expiresAt = input.expiresAt; });
  }

  async setGrants(id: string, raw: z.infer<typeof LabGrantsSchema>): Promise<LabOperation> {
    IdSchema.parse(id);
    const input = LabGrantsSchema.parse(raw);
    if (new Set(input.grants.map(grant => grant.email.toLowerCase())).size !== input.grants.length) throw new AppError('INVALID_INPUT', 'Grant emails must be unique');
    return this.mutate('grant_access', id, input, workspace => { workspace.grants = input.grants; });
  }

  async activate(id: string, raw: z.infer<typeof LabActivateSchema>): Promise<LabOperation> {
    IdSchema.parse(id);
    const input = LabActivateSchema.parse(raw);
    return this.mutate('activate_workspace', id, input, workspace => {
      if (!workspace.expiresAt || Date.parse(workspace.expiresAt) <= this.now().getTime() || workspace.grants.length === 0) throw new AppError('CONFLICT', 'Activation requires future expiry and at least one access grant', 409);
      workspace.active = true;
    });
  }

  async read(id: string): Promise<Workspace> { return this.store.getWorkspace(IdSchema.parse(id)); }
  async list(requestId: string): Promise<Workspace[]> { return this.store.list(IdSchema.parse(requestId)); }

  async checkAccess(id: string, email: string): Promise<{ allowed: boolean; role: string | null; evaluatedAt: string }> {
    z.email().parse(email);
    const workspace = await this.read(id);
    const evaluatedAt = this.now().toISOString();
    const grant = workspace.grants.find(item => item.email.toLowerCase() === email.toLowerCase());
    const allowed = workspace.active && workspace.expiresAt !== null && Date.parse(workspace.expiresAt) > Date.parse(evaluatedAt) && Boolean(grant);
    return { allowed, role: allowed ? grant!.role : null, evaluatedAt };
  }

  async operation(key: string): Promise<LabOperation | null> {
    const parts = key.split('/');
    if (parts.length !== 2) throw new AppError('INVALID_INPUT', 'Operation key must be requestId/stepId');
    parts.forEach(part => IdSchema.parse(part));
    return this.store.getOperation(key);
  }

  reset(): Promise<void> { return this.store.reset(); }
  close(): Promise<void> { return this.store.close(); }
}
