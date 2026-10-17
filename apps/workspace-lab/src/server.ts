import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  AppError, IdSchema, LabActivateSchema, LabCreateSchema, LabExpirySchema, LabGrantsSchema,
} from '@athena/contracts';
import { WorkspaceLab } from './application';

export type LabServerOptions = {
  dataPath: string;
  token: string;
  adminToken?: string;
  allowReset?: boolean;
  now?: () => Date;
};


function authorized(request: IncomingMessage, token: string | undefined): boolean {
  if (!token) return false;
  const received = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AppError('INVALID_INPUT', 'Content-Type must be application/json', 415);
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 65_536) throw new AppError('INVALID_INPUT', 'Request body exceeds 64 KiB', 413);
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('INVALID_INPUT', 'Request body must contain valid JSON', 400); }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body));
}

/** Independent resource service. It enforces application invariants, never company policy. */
export function createLabServer(options: LabServerOptions): Server {
  if (!options.token || options.token.trim() !== options.token) throw new AppError('INVALID_INPUT', 'LAB_TOKEN must be configured');
  if (options.allowReset && (!options.adminToken || options.adminToken === options.token)) throw new AppError('INVALID_INPUT', 'Reset requires a distinct LAB_ADMIN_TOKEN');
  const application = new WorkspaceLab(options);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://lab.local');
      const path = decodeURIComponent(url.pathname);
      const method = request.method;
      if (method === 'GET' && path === '/health') {
        await application.list('__health__');
        return send(response, 200, { ok: true, service: 'workspace-lab' });
      }
      if (method === 'POST' && path === '/admin/reset') {
        if (!options.allowReset || !authorized(request, options.adminToken)) throw new AppError('FORBIDDEN', 'Demo administrative reset is unavailable', 403);
        z.object({}).strict().parse(await jsonBody(request));
        await application.reset();
        return send(response, 200, { ok: true });
      }
      if (!authorized(request, options.token)) throw new AppError('FORBIDDEN', 'Invalid Lab credentials', 403);
      if (method === 'POST' && path === '/workspaces') {
        const input = LabCreateSchema.parse(await jsonBody(request));
        return send(response, 200, await application.create(input));
      }
      if (method === 'GET' && path === '/workspaces') {
        const requestId = IdSchema.parse(url.searchParams.get('requestId'));
        return send(response, 200, await application.list(requestId));
      }
      const operationRoute = /^\/operations\/([^/]+\/[^/]+)$/.exec(path);
      if (method === 'GET' && operationRoute) {
        const [requestId, stepId] = operationRoute[1].split('/');
        IdSchema.parse(requestId); IdSchema.parse(stepId);
        const operation = await application.operation(operationRoute[1]);
        if (!operation) throw new AppError('NOT_FOUND', 'Operation does not exist', 404);
        return send(response, 200, operation);
      }
      const workspaceRoute = /^\/workspaces\/([^/]+)(?:\/(expiry|grants|activate|access))?$/.exec(path);
      if (workspaceRoute) {
        const id = IdSchema.parse(workspaceRoute[1]);
        const action = workspaceRoute[2];
        if (method === 'GET' && !action) return send(response, 200, await application.read(id));
        if (method === 'GET' && action === 'access') {
          const email = z.email().parse(url.searchParams.get('email'));
          return send(response, 200, await application.checkAccess(id, email));
        }
        if (method === 'PUT' && action === 'expiry') {
          const input = LabExpirySchema.parse(await jsonBody(request));
          return send(response, 200, await application.setExpiry(id, input));
        }
        if (method === 'PUT' && action === 'grants') {
          const input = LabGrantsSchema.parse(await jsonBody(request));
          return send(response, 200, await application.setGrants(id, input));
        }
        if (method === 'POST' && action === 'activate') {
          const input = LabActivateSchema.parse(await jsonBody(request));
          return send(response, 200, await application.activate(id, input));
        }
      }
      throw new AppError('NOT_FOUND', 'Lab endpoint does not exist', 404);
    } catch (error) {
      if (response.destroyed || response.headersSent) return;
      if (error instanceof z.ZodError) return send(response, 400, { error: { code: 'INVALID_INPUT', message: 'Request does not match the input schema', details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) } });
      if (error instanceof URIError) return send(response, 400, { error: { code: 'INVALID_INPUT', message: 'Malformed request URL' } });
      if (error instanceof AppError) return send(response, error.status, { error: { code: error.code, message: error.message, details: error.details } });
      send(response, 500, { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Lab could not complete this operation' } });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  const closeHttp = server.close.bind(server);
  server.close = (callback?: (error?: Error) => void) => {
    closeHttp(error => {
      void application.close().then(() => callback?.(error), failure => callback?.(failure as Error));
    });
    return server;
  };
  return server;
}
