import { z } from 'zod';
import {
  ApiErrorSchema, AppError, IdSchema, LabActivateSchema, LabCreateSchema, LabExpirySchema,
  LabGrantsSchema, LabOperationSchema, TimestampSchema, WorkspaceSchema, type LabClient,
} from '@athena/contracts';

export type LabClientOptions = { url: string; token: string; adminToken?: string; timeoutMs?: number };
const AccessSchema = z.object({ allowed: z.boolean(), role: z.enum(['member', 'admin', 'viewer']).nullable(), evaluatedAt: TimestampSchema }).strict();

export function createLabClient(options: LabClientOptions): LabClient {
  const origin = new URL(options.url);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new AppError('INVALID_INPUT', 'Lab URL must be an HTTP origin');
  if (!options.token) throw new AppError('INVALID_INPUT', 'Lab token must be configured');

  async function request<T>(path: string, method: string, schema: z.ZodType<T>, input?: unknown, admin = false): Promise<T> {
    const token = admin ? options.adminToken : options.token;
    if (!token) throw new AppError('FORBIDDEN', 'Lab administrative token is unavailable', 403);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
      const response = await fetch(new URL(path, origin), {
        method, redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, ...(input !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const error = ApiErrorSchema.safeParse(body);
        if (!error.success) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Lab returned an invalid error response', 503);
        throw new AppError(error.data.error.code, error.data.error.message, response.status, error.data.error.details);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Lab returned an invalid response', 503);
      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DEPENDENCY_UNAVAILABLE', controller.signal.aborted ? 'Lab request timed out; reconcile before retrying' : 'Lab is unavailable; reconcile before retrying', 503);
    } finally { clearTimeout(timer); }
  }

  const workspacePath = (id: string) => `/workspaces/${encodeURIComponent(IdSchema.parse(id))}`;
  return {
    create: input => request('/workspaces', 'POST', LabOperationSchema, LabCreateSchema.parse(input)),
    setExpiry: (id, input) => request(`${workspacePath(id)}/expiry`, 'PUT', LabOperationSchema, LabExpirySchema.parse(input)),
    setGrants: (id, input) => request(`${workspacePath(id)}/grants`, 'PUT', LabOperationSchema, LabGrantsSchema.parse(input)),
    activate: (id, input) => request(`${workspacePath(id)}/activate`, 'POST', LabOperationSchema, LabActivateSchema.parse(input)),
    read: id => request(workspacePath(id), 'GET', WorkspaceSchema),
    list: requestId => request(`/workspaces?requestId=${encodeURIComponent(IdSchema.parse(requestId))}`, 'GET', z.array(WorkspaceSchema)),
    checkAccess: (id, email) => request(`${workspacePath(id)}/access?email=${encodeURIComponent(z.email().parse(email))}`, 'GET', AccessSchema),
    operation: async key => {
      if (!/^[a-zA-Z0-9_.:-]+\/[a-zA-Z0-9_.:-]+$/.test(key)) throw new AppError('INVALID_INPUT', 'Operation key must be requestId/stepId');
      try { return await request(`/operations/${encodeURIComponent(key)}`, 'GET', LabOperationSchema); }
      catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') return null; throw error; }
    },
    reset: async () => { await request('/admin/reset', 'POST', z.object({ ok: z.literal(true) }).strict(), {}, true); },
  };
}
