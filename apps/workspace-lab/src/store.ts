import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { AppError, LabOperationSchema, WorkspaceSchema, type LabOperation, type Workspace } from '@athena/contracts';

const StateSchema = z.object({
  version: z.literal(1),
  workspaces: z.array(WorkspaceSchema),
  operations: z.array(LabOperationSchema),
}).strict();

type State = z.infer<typeof StateSchema>;
const emptyState = (): State => ({ version: 1, workspaces: [], operations: [] });

/** One process owns a store; every operation is serialized and reloads durable state. */
export class LabStore {
  private tail: Promise<unknown> = Promise.resolve();
  private lockFd: number;
  private closed = false;
  private closing: Promise<void> | null = null;
  private hasPersistedState: boolean;
  private readonly lockPath: string;

  constructor(private readonly dataPath: string) {
    mkdirSync(dirname(dataPath), { recursive: true, mode: 0o700 });
    this.hasPersistedState = existsSync(dataPath);
    this.lockPath = `${dataPath}.lock`;
    if (existsSync(this.lockPath)) {
      // Serialize stale-lock recovery so concurrent starts cannot remove a new owner's lock.
      const recoveryPath = `${this.lockPath}.recovery`;
      let recoveryFd: number;
      try { recoveryFd = openSync(recoveryPath, 'wx', 0o600); }
      catch { throw new AppError('CONFLICT', 'Lab store lock recovery is already in progress; inspect the store before retrying', 409); }
      try {
        writeFileSync(recoveryFd, JSON.stringify({ pid: process.pid }));
        if (existsSync(this.lockPath)) {
          let owner: { pid: number };
          try { owner = JSON.parse(readFileSync(this.lockPath, 'utf8')); }
          catch { throw new AppError('DEPENDENCY_UNAVAILABLE', 'Lab store lock is invalid; inspect the store before restarting', 503); }
          if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Lab store lock is invalid', 503);
          try {
            process.kill(owner.pid, 0);
            throw new AppError('CONFLICT', 'Another Lab process owns this store', 409);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
            unlinkSync(this.lockPath);
          }
        }
        try { this.lockFd = openSync(this.lockPath, 'wx', 0o600); }
        catch { throw new AppError('CONFLICT', 'Another Lab process owns this store', 409); }
      } finally {
        closeSync(recoveryFd);
        unlinkSync(recoveryPath);
      }
    } else {
      try { this.lockFd = openSync(this.lockPath, 'wx', 0o600); }
      catch { throw new AppError('CONFLICT', 'Another Lab process owns this store', 409); }
    }
    try {
      writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid }));
      if (existsSync(dataPath)) this.validate(JSON.parse(readFileSync(dataPath, 'utf8')));
    } catch {
      closeSync(this.lockFd);
      unlinkSync(this.lockPath);
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Lab store is unreadable or corrupt', 503);
    }
  }

  private validate(value: unknown): State {
    const state = StateSchema.parse(value);
    const ids = new Set(state.workspaces.map(workspace => workspace.id));
    const requests = new Set(state.workspaces.map(workspace => workspace.requestId));
    const keys = new Set(state.operations.map(operation => operation.operationKey));
    if (ids.size !== state.workspaces.length || requests.size !== state.workspaces.length || keys.size !== state.operations.length) {
      throw new Error('Duplicate persisted identities');
    }
    for (const operation of state.operations) {
      const { receipt, workspace } = operation;
      if (!ids.has(workspace.id) || receipt.resourceId !== workspace.id || receipt.requestId !== workspace.requestId || receipt.operationKey !== operation.operationKey || receipt.inputHash !== operation.inputHash || operation.operationKey !== `${receipt.requestId}/${receipt.stepId}`) {
        throw new Error('Invalid persisted receipt');
      }
    }
    return state;
  }

  private async read(): Promise<State> {
    try { return this.validate(JSON.parse(await readFile(this.dataPath, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !this.hasPersistedState) return emptyState();
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Lab store is unreadable or corrupt', 503);
    }
  }

  private async commit(state: State): Promise<void> {
    this.validate(state);
    const temporary = `${this.dataPath}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, this.dataPath);
      this.hasPersistedState = true;
      // Persist the rename itself, as well as the file contents.
      const directory = await open(dirname(this.dataPath), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch {
      await unlink(temporary).catch(() => undefined);
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Lab could not persist the operation; reconcile before retrying', 503);
    }
  }

  transaction<T>(fn: (state: State) => { value: T; changed: boolean }): Promise<T> {
    const operation = this.tail.then(async () => {
      if (this.closed) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Lab store is closed', 503);
      const state = await this.read();
      const result = fn(state);
      if (result.changed) await this.commit(state);
      return structuredClone(result.value);
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  getWorkspace(id: string): Promise<Workspace> {
    return this.transaction(state => {
      const workspace = state.workspaces.find(item => item.id === id);
      if (!workspace) throw new AppError('NOT_FOUND', 'Workspace does not exist', 404);
      return { value: workspace, changed: false };
    });
  }

  list(requestId: string): Promise<Workspace[]> {
    return this.transaction(state => ({ value: state.workspaces.filter(item => item.requestId === requestId), changed: false }));
  }

  getOperation(key: string): Promise<LabOperation | null> {
    return this.transaction(state => ({ value: state.operations.find(item => item.operationKey === key) ?? null, changed: false }));
  }

  reset(): Promise<void> {
    return this.transaction(state => {
      state.workspaces = [];
      state.operations = [];
      return { value: undefined, changed: true };
    });
  }

  /** Drain writes even if their HTTP caller disconnected before the response. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = this.tail.then(() => {
      closeSync(this.lockFd);
      unlinkSync(this.lockPath);
    });
    return this.closing;
  }
}
