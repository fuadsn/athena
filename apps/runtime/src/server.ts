import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError, IdSchema, ReviewSchema, TrialRequestInputSchema } from '@athena/contracts';
import { RuntimeService, type RuntimeOptions } from './service';
import { publicOrigin } from '../../../packages/contracts/src/origin';

const LearningBody = z.object({ caseIds: z.array(IdSchema).min(1).max(20) }).strict();
const PublishBody = z.object({ review: ReviewSchema, expectedRevision: z.number().int().nonnegative() }).strict();
const ApprovalBody = z.object({ planHash: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(['APPROVED', 'REJECTED']) }).strict();
const AssignBody = z.object({ roleId: IdSchema, personId: IdSchema, expectedRevision: z.number().int().nonnegative() }).strict();
async function body(request: IncomingMessage): Promise<unknown> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const value of request) { bytes += value.length; if (bytes > 128_000) throw new AppError('INVALID_INPUT', 'Request body too large', 413); chunks.push(Buffer.from(value)); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new AppError('INVALID_INPUT', 'Body must be valid JSON'); }
}
function send(response: ServerResponse, status: number, data: unknown): void { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(data)); }
export function signSession(actorId: string, secret: string, expiresAt = Date.now() + 12 * 60 * 60 * 1000): string {
  const payload = Buffer.from(JSON.stringify({ actorId, expiresAt })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function readSession(request: IncomingMessage, secret: string): string | null {
  const token = request.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('athena_session='))?.slice('athena_session='.length);
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual: Buffer; try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return typeof session.actorId === 'string' && typeof session.expiresAt === 'number' && session.expiresAt > Date.now() ? session.actorId : null; } catch { return null; }
}
export function createRuntimeServer(options: RuntimeOptions & { sessionSecret: string; publicOrigin?: string; accessCode?: string }) {
  if (options.sessionSecret.length < 32) throw new Error('DEMO_SESSION_SECRET must contain at least 32 characters');
  const hostedOrigin = publicOrigin(options.publicOrigin);
  if (hostedOrigin && (!options.accessCode || options.accessCode.length < 16)) throw new Error('Hosted demos require a DEMO_ACCESS_CODE of at least 16 characters');
  let attempts = 0, attemptWindow = Date.now();
  const service = new RuntimeService(options);
  const server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url ?? '/', 'http://runtime.local'), path = url.pathname;
    if (request.method !== 'GET') {
      const origin = request.headers.origin;
      if (hostedOrigin && origin !== hostedOrigin) throw new AppError('FORBIDDEN', 'Changes must come from the configured demo origin', 403);
      if (!hostedOrigin && origin) { let host = ''; try { host = new URL(origin).hostname; } catch { /* invalid origin remains disallowed */ } if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new AppError('FORBIDDEN', 'Mutations are available only from the local demo origin', 403); }
    }
    if (path === '/health' && request.method === 'GET') { await options.graph.ping(); return send(response, 200, { ok: true, graph: 'available', modelConfigured: !!options.model }); }
    const actorId = readSession(request, options.sessionSecret);
    if (path === '/session') {
      if (!options.demoMode) throw new AppError('FORBIDDEN', 'Persona selection is available only in local demo mode', 403);
      const directory = await options.graph.getDirectory();
      if (request.method === 'GET') return send(response, 200, { actorId, demoMode: true, hosted: !!hostedOrigin, accessRequired: !!hostedOrigin && !actorId, people: directory.people });
      if (request.method === 'POST') {
        const { personId, accessCode } = z.object({ personId: IdSchema, accessCode: z.string().max(256).optional() }).strict().parse(await body(request));
        if (hostedOrigin && !actorId) {
          if (Date.now() - attemptWindow >= 60_000) { attempts = 0; attemptWindow = Date.now(); }
          if (++attempts > 20) throw new AppError('BUDGET_EXCEEDED', 'Too many entry attempts. Wait one minute before trying again.', 429);
          const expected = createHmac('sha256', options.sessionSecret).update(options.accessCode!).digest();
          const actual = createHmac('sha256', options.sessionSecret).update(accessCode ?? '').digest();
          if (!timingSafeEqual(actual, expected)) throw new AppError('FORBIDDEN', 'Enter the demo access code supplied with the submission.', 403);
        }
        const person = directory.people.find(p => p.id === personId);
        if (!person) throw new AppError('FORBIDDEN', 'Unknown demo persona', 403);
        response.setHeader('set-cookie', `athena_session=${signSession(personId, options.sessionSecret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${hostedOrigin ? '; Secure' : ''}`);
        return send(response, 200, { actorId: personId, personId, person, hosted: !!hostedOrigin, accessRequired: false });
      }
    }
    if (!actorId || !(await options.graph.getDirectory()).people.some(p => p.id === actorId)) throw new AppError('FORBIDDEN', 'Choose a local demo persona to continue', 403);
    if (path === '/state' && request.method === 'GET') return send(response, 200, { ...await options.graph.getState(), currentActorId: actorId, modelConfigured: !!options.model, demoMode: options.demoMode });
    if (path === '/events' && request.method === 'GET') {
      const after = Number(url.searchParams.get('after') ?? 0); if (!Number.isSafeInteger(after) || after < 0) throw new AppError('INVALID_INPUT', 'Invalid event cursor');
      return send(response, 200, await options.graph.getEvents(after));
    }
    let match: RegExpMatchArray | null;
    if ((match = path.match(/^\/sources\/([\w.:-]+)$/)) && request.method === 'GET') {
      const rev = url.searchParams.has('revision') ? Number(url.searchParams.get('revision')) : undefined;
      if (rev !== undefined && (!Number.isSafeInteger(rev) || rev < 1)) throw new AppError('INVALID_INPUT', 'Invalid source revision');
      const source = await options.graph.getSource(match[1], rev); if (!source) throw new AppError('NOT_FOUND', 'Source not found', 404); return send(response, 200, source);
    }
    if (path === '/learning-runs' && request.method === 'POST') { const input = LearningBody.parse(await body(request)); const run = await service.startLearning(actorId, input.caseIds); return send(response, 202, { id: run.id, run }); }
    if ((match = path.match(/^\/learning-runs\/([\w.:-]+)$/)) && request.method === 'GET') { const detail = await options.graph.getLearningRun(match[1]); if (!detail) throw new AppError('NOT_FOUND', 'Learning run not found', 404); return send(response, 200, detail); }
    if ((match = path.match(/^\/procedures\/([\w.:-]+)\/publish$/)) && request.method === 'POST') { const input = PublishBody.parse(await body(request)); return send(response, 200, { procedure: await service.publish(actorId, match[1], input.review, input.expectedRevision) }); }
    if (path === '/requests' && request.method === 'POST') { const input = TrialRequestInputSchema.parse(await body(request)); const created = await service.createRequest(actorId, input); return send(response, 202, { id: created.id, request: created }); }
    if ((match = path.match(/^\/requests\/([\w.:-]+)$/)) && request.method === 'GET') { const detail = await options.graph.getRequest(match[1]); if (!detail) throw new AppError('NOT_FOUND', 'Request not found', 404); return send(response, 200, detail); }
    if ((match = path.match(/^\/requests\/([\w.:-]+)\/resume$/)) && request.method === 'POST') { z.object({}).strict().parse(await body(request)); const resumed = await service.resume(actorId, match[1]); return send(response, 202, { id: resumed.id, request: resumed }); }
    if ((match = path.match(/^\/plans\/([\w.:-]+)\/approval$/)) && request.method === 'POST') { const input = ApprovalBody.parse(await body(request)); return send(response, 200, await service.approve(actorId, match[1], input.planHash, input.decision)); }
    if (path === '/authority/assign' && request.method === 'POST') { const input = AssignBody.parse(await body(request)); return send(response, 200, { assignment: await service.assign(actorId, input.roleId, input.personId, input.expectedRevision) }); }
    if (path === '/demo/reset' && request.method === 'POST') { z.object({}).strict().parse(await body(request)); await service.reset(actorId); return send(response, 200, { ok: true }); }
    throw new AppError('NOT_FOUND', 'Unknown API endpoint', 404);
  })().catch(error => {
    const failure = error instanceof AppError ? error : error instanceof z.ZodError ? new AppError('INVALID_INPUT', 'Input failed strict schema validation', 400, error.issues.map(i => ({ path: i.path, message: i.message }))) : new AppError('DEPENDENCY_UNAVAILABLE', 'An internal dependency failed', 503);
    // Do not echo provider/client exceptions, credentials, or raw request bodies.
    send(response, failure.status, { error: { code: failure.code, message: failure.message, ...(failure.code === 'INVALID_INPUT' && failure.details ? { details: failure.details } : {}) } });
  }); });
  return { server, service };
}
