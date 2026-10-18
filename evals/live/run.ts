import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { State, RequestDetail, LearningDetail, Review } from '@athena/contracts';

/** Test harness only. This file and acceptance.json are never imported by runtime code. */
const expected = JSON.parse(await readFile(new URL('../acceptance.json', import.meta.url), 'utf8'));
const base = process.env.RUNTIME_URL ?? 'http://127.0.0.1:4100';
const count = Number(process.env.LIVE_REHEARSALS ?? expected.releaseGate.liveRehearsals.requiredConsecutivePasses);
if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('LIVE_REHEARSALS must be from 1 to 10');
const endpoint = new URL(base);
if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Live reset rehearsals require an explicitly local runtime');
const runId = new Date().toISOString().replaceAll(':', '-');
const outputDir = resolve('.local/live-rehearsals', runId);
await mkdir(outputDir, { recursive: true });
const cookies = new Map<string, string>();
async function api<T>(path: string, actor: string, input?: unknown): Promise<T> {
  if (!cookies.has(actor)) {
    const response = await fetch(new URL('/session', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personId: actor }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Session creation failed: HTTP ${response.status}`);
    cookies.set(actor, response.headers.getSetCookie().map(c => c.split(';')[0]).join('; '));
  }
  const response = await fetch(new URL(path, base), { method: input === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', cookie: cookies.get(actor)! }, body: input === undefined ? undefined : JSON.stringify(input), signal: AbortSignal.timeout(30_000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${payload.error?.code ?? ''} ${payload.error?.message ?? ''}`);
  return payload as T;
}
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, failed: (value: T) => string | null): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < 140_000) {
    const value = await read(), error = failed(value);
    if (error) throw new Error(error);
    if (done(value)) return value;
    await delay(700);
  }
  throw new Error('Timed out waiting for a bounded episode result');
}
const requestUntil = (id: string, state: string) => until(
  () => api<RequestDetail>(`/requests/${id}`, 'person_ana'),
  // The request transition precedes the episode's final usage write. Wait for
  // both so rehearsal evidence never records a completed job with an active
  // episode or misses its final latency and token counters.
  d => d.request.state === state && d.episodes.length > 0 && d.episodes.every(episode => episode.status !== 'RUNNING') &&
    (state !== 'COMPLETED' || d.episodes.some(episode => episode.status === 'SUCCEEDED')),
  d => ['FAILED', 'BLOCKED', 'REJECTED'].includes(d.request.state) ? `${d.request.state}: ${d.request.reason}` : d.episodes.find(episode => episode.status === 'FAILED')?.error ?? null,
);
const proof: Record<string, unknown>[] = [];
let consecutive = 0;
for (let index = 1; index <= count; index++) {
  const rehearsal: Record<string, unknown> = { index, startedAt: new Date().toISOString(), outcome: 'RUNNING', mode: 'LIVE_MODEL', teachingInputOrigin: 'Explicit authenticated owner review by this evaluation harness, after live induction.' };
  const file = resolve(outputDir, `rehearsal-${index}.json`);
  try {
    await api('/demo/reset', 'person_mira', {});
    const cold = await api<State>('/state', 'person_mira');
    if (!cold.modelConfigured) throw new Error('Runtime has no live model configured');
    if (cold.procedures.some(p => p.status === 'PUBLISHED') || cold.requests.length) throw new Error('Reset did not produce a cold graph');
    rehearsal.coldState = cold;
    const { id: learningId } = await api<{ id: string }>('/learning-runs', 'person_mira', { caseIds: cold.cases.map(c => c.id) });
    const learning = await until(() => api<LearningDetail>(`/learning-runs/${learningId}`, 'person_mira'), d => d.run.state === 'NEEDS_REVIEW', d => d.run.state === 'FAILED' ? d.run.error ?? 'Learning failed' : null);
    rehearsal.learning = learning;
    if (!learning.candidate || !learning.episode || learning.episode.modelTurns < 1 || !learning.episode.model) throw new Error('No genuine model induction evidence');
    const variationText = JSON.stringify(learning.candidate.uncertainties).toLowerCase();
    if (!/(seven|7)/.test(variationText) || !/(thirty|30)/.test(variationText)) throw new Error('Live candidate did not expose the required duration variation');
    const teaching = expected.teachingInputs.reviewV1.structuredConfirmation;
    const review: Review = { normalDurationDays: teaching.normalDurationDays, extendedDurationDays: teaching.extendedDurationDays, accessRole: teaching.accessRole, extensionApprovalRoleId: teaching.extensionApprovalRoleId, configureWhileInactive: true, activateAfterConfiguration: true, confirmAllFields: true };
    rehearsal.explicitOwnerReview = review;
    await api(`/procedures/${learning.candidate.id}/publish`, 'person_mira', { review, expectedRevision: (await api<State>('/state', 'person_mira')).knowledgeRevision });
    const submit = async (customer: string, days: number | null) => api<{ id: string }>('/requests', 'person_ana', { processId: 'process_trial', customerId: `customer_${customer.toLowerCase()}`, customerName: customer, ownerEmail: `owner@${customer.toLowerCase()}.example`, requestedDays: days, idempotencyKey: randomUUID() });
    const normal = await submit(`Harbor${index}`, null);
    rehearsal.normal = await requestUntil(normal.id, 'COMPLETED');
    const extended = await submit(`Orbit${index}`, teaching.extendedDurationDays);
    const waiting = await requestUntil(extended.id, 'WAITING_APPROVAL');
    if (!waiting.plan || waiting.receipts.length || waiting.plan.approverPersonId !== 'person_ravi') throw new Error('Extension mutated early or routed to the wrong person');
    rehearsal.extendedBeforeApproval = waiting;
    await api(`/plans/${waiting.plan.id}/approval`, 'person_ravi', { planHash: waiting.plan.planHash, decision: 'APPROVED' });
    const completed = await requestUntil(extended.id, 'COMPLETED');
    if (!completed.verification?.passed || new Set(completed.episodes.map(e => e.id)).size < 2) throw new Error('Missing independent verification or fresh approval-resume episode');
    rehearsal.extended = completed;
    const beforeSwap = await api<State>('/state', 'person_mira');
    await api('/authority/assign', 'person_mira', { roleId: teaching.extensionApprovalRoleId, personId: 'person_leena', expectedRevision: beforeSwap.knowledgeRevision });
    const switched = await submit(`Quartz${index}`, teaching.extendedDurationDays);
    const routed = await requestUntil(switched.id, 'WAITING_APPROVAL');
    if (routed.plan?.approverPersonId !== 'person_leena') throw new Error('Fresh request did not route to Leena');
    let oldHolderRejected = false;
    try { await api(`/plans/${routed.plan.id}/approval`, 'person_ravi', { planHash: routed.plan.planHash, decision: 'APPROVED' }); }
    catch (error) { oldHolderRejected = error instanceof Error && error.message.includes('FORBIDDEN'); }
    if (!oldHolderRejected) throw new Error('Old holder still approved new work');
    await api(`/plans/${routed.plan.id}/approval`, 'person_leena', { planHash: routed.plan.planHash, decision: 'APPROVED' });
    rehearsal.afterAuthorityChange = await requestUntil(switched.id, 'COMPLETED');
    const ending = await api<State>('/state', 'person_mira');
    const sources: unknown[] = [];
    for (const p of ending.procedures.filter(p => p.status === 'PUBLISHED')) if (p.confirmationSourceId) sources.push(await api(`/sources/${p.confirmationSourceId}`, 'person_mira'));
    rehearsal.confirmationSources = sources;
    rehearsal.events = await api('/events?after=0', 'person_mira');
    rehearsal.outcome = 'PASSED'; consecutive++;
    process.stdout.write(`Live rehearsal ${index}/${count}: PASSED\n`);
  } catch (error) {
    rehearsal.outcome = 'FAILED'; rehearsal.error = error instanceof Error ? error.message : String(error); consecutive = 0;
    try {
      const finalState = await api<State>('/state', 'person_mira');
      rehearsal.finalState = finalState;
      // Keep actual usage, episodes, proposals and receipts even when polling
      // rejects before the successful result could be assigned above.
      const diagnostics = await Promise.allSettled([
        ...finalState.learningRuns.map(run => api<LearningDetail>(`/learning-runs/${run.id}`, 'person_mira')),
        ...finalState.requests.map(request => api<RequestDetail>(`/requests/${request.id}`, 'person_mira')),
      ]);
      rehearsal.failureDiagnostics = diagnostics.map(result => result.status === 'fulfilled'
        ? { available: true, detail: result.value }
        : { available: false, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      rehearsal.events = await api('/events?after=0', 'person_mira');
    } catch { /* Preserve the original error when graph/API are down. */ }
    process.stderr.write(`Live rehearsal ${index}/${count}: FAILED — ${String(rehearsal.error)}\n`);
    process.exitCode = 1;
  } finally {
    rehearsal.finishedAt = new Date().toISOString();
    await writeFile(file, JSON.stringify(rehearsal, null, 2) + '\n'); proof.push({ index, outcome: rehearsal.outcome, file });
  }
  if (rehearsal.outcome === 'FAILED') break;
}
const summary = { recordedAt: new Date().toISOString(), requiredConsecutivePasses: expected.releaseGate.liveRehearsals.requiredConsecutivePasses, consecutivePasses: consecutive, releaseGatePassed: consecutive >= expected.releaseGate.liveRehearsals.requiredConsecutivePasses, rehearsals: proof };
await writeFile(resolve(outputDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`Actual rehearsal evidence: ${outputDir}`);
if (!summary.releaseGatePassed) process.exitCode = 1;
