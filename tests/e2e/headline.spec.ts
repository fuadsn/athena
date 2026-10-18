import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test, expect, type Page, type Locator } from '@playwright/test';
import type { RequestDetail, State } from '@athena/contracts';

/** Release test: all learning and execution use the running live-model runtime. */
test('cold evidence → owner teaching → verified work → changed authority', async ({ page, baseURL }, testInfo) => {
  const recording = process.env.ATHENA_RECORD_DEMO === '1';
  const recordingStarted = Date.now();
  const chapters: { seconds: number; caption: string }[] = [];
  const chapter = async (caption: string, target?: Locator, pauseMs = 4000) => {
    if (!recording) return;
    if (target) await target.scrollIntoViewIfNeeded();
    chapters.push({ seconds: (Date.now() - recordingStarted) / 1000, caption });
    const file = testInfo.outputPath('chapters.json');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(chapters, null, 2) + '\n');
    await page.waitForTimeout(pauseMs);
  };
  const showAuthorityQuery = async () => {
    if (!recording) return;
    const event = page.locator('.event-log li').filter({ hasText: 'Q3_current_role_holder' }).first();
    await event.getByText('Recorded details', { exact: true }).click();
    await chapter('This recorded Cypher traversal follows HOLDS_ROLE to current authority.', event.locator('pre'), 6000);
    await event.getByText('Recorded details', { exact: true }).click();
  };
  const endpoint = new URL(baseURL!);
  const hosted = !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (hosted && (process.env.ATHENA_HOSTED_TEST !== '1' || !process.env.DEMO_ACCESS_CODE || endpoint.protocol !== 'https:')) {
    throw new Error('A hosted reset rehearsal requires HTTPS, ATHENA_HOSTED_TEST=1 and DEMO_ACCESS_CODE');
  }
  const ownerSession = await page.request.post('/api/session', {
    headers: { origin: endpoint.origin },
    data: { personId: 'person_mira', ...(hosted ? { accessCode: process.env.DEMO_ACCESS_CODE } : {}) },
  });
  expect(ownerSession.ok(), await ownerSession.text()).toBeTruthy();
  const reset = await page.request.post('/api/demo/reset', { data: {} });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  const cold = await state(page);
  expect(cold.modelConfigured, 'The headline release flow requires a real configured model; there is no canned fallback.').toBe(true);
  expect(cold.procedures.filter(procedure => procedure.status === 'PUBLISHED')).toHaveLength(0);
  expect(cold.cases).toHaveLength(3);
  await page.goto('/');
  await expect(page.getByText('No published procedure')).toBeVisible();
  await chapter('Three synthetic historical cases. No published procedure.', page.getByRole('heading', { level: 1 }));
  await page.getByRole('button', { name: 'Open Northstar source' }).click();
  await expect(page.getByRole('dialog')).toContainText('Northstar');
  await chapter('Historical observations link to immutable source evidence.', page.getByRole('dialog'));
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('button', { name: 'Learn from these cases' }).click();
  await chapter('The live model reads graph evidence and proposes a procedure for review.', undefined, 0);
  await expect(page.getByRole('heading', { name: 'Teach the reusable policy' })).toBeVisible();
  await expect(page.getByText('A PERSON NEEDS TO CONFIRM')).toBeVisible();
  await chapter('Observed variation needs human teaching before it can become reusable policy.', page.locator('.teaching-question'), 6000);
  await page.getByLabel('Normal trial duration', { exact: true }).fill('7');
  await page.getByLabel('Extended trial duration', { exact: true }).fill('30');
  await page.getByLabel('Extension approval role', { exact: true }).selectOption('role_trial_extension_approver');
  await page.getByRole('checkbox', { name: 'Configure access and expiry while the workspace is inactive.' }).check();
  await page.getByRole('checkbox', { name: 'Activate only after both access and expiry are correctly configured.' }).check();
  await page.getByRole('checkbox', { name: 'I confirm these settings as reusable policy.' }).check();
  await chapter('Mira confirms 7 days normally; 30 days requires approval for each request.', page.locator('.review-form'), 6000);
  await page.getByRole('button', { name: 'Confirm & publish procedure' }).click();
  await expect(page.getByRole('button', { name: 'Use this procedure' })).toBeVisible();
  await chapter('The reviewed procedure and its human confirmation now persist in FalkorDB.', page.locator('.published-panel .panel-header'));
  const taught = await state(page);
  const published = taught.procedures.find(procedure => procedure.status === 'PUBLISHED');
  expect(published).toBeDefined();
  expect(published!.rules.every(rule => rule.confirmationRefs.length > 0)).toBe(true);

  // T04: omitted duration resolves from graph, with a fresh request episode.
  await page.getByRole('button', { name: 'Use this procedure' }).click();
  await expect(page.getByRole('button', { name: 'Create trial request', exact: true })).toBeDisabled();
  await expect(page.getByText('Select the authorized trial operator to submit work.')).toBeVisible();
  await persona(page, 'person_ana');
  await submit(page, 'Atlas Robotics', 'owner@atlas.example');
  await expect(page.getByRole('heading', { name: 'Workspace independently verified' })).toBeVisible();
  let latest = await latestRequest(page);
  expect(latest.plan?.parameters.durationDays).toBe(7);
  expect(latest.verification?.passed).toBe(true);
  expect(latest.episodes.every(episode => episode.initialContextMessages === 0)).toBe(true);
  expect(latest.verification?.resourceCount).toBe(1);
  await chapter('A fresh episode uses the confirmed default. A separate application verifies the result.', page.locator('.completion-card'));

  // T05: a request waits without mutation; only current authority can approve.
  await submit(page, 'Orion Instruments', 'owner@orion.example', '30');
  await expect(page.getByRole('heading', { name: 'Waiting for Ravi' })).toBeVisible();
  latest = await latestRequest(page);
  expect(latest.request.state).toBe('WAITING_APPROVAL');
  expect(latest.receipts).toHaveLength(0);
  await chapter('The extension waits for Ravi. No workspace changes happen before approval.', page.getByLabel('Graph decision path'));
  await showAuthorityQuery();
  const unauthorized = await page.request.post(`/api/plans/${latest.plan!.id}/approval`, { data: { planHash: latest.plan!.planHash, decision: 'APPROVED' } });
  expect(unauthorized.status()).toBe(403);
  await persona(page, 'person_ravi');
  await chapter('Ravi approves one exact plan; code rechecks authority before every mutation.', page.locator('.approval-card'));
  await page.getByRole('button', { name: 'Approve this plan' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace independently verified' })).toBeVisible();
  latest = await latestRequest(page);
  expect(latest.verification?.passed).toBe(true);
  expect(latest.plan?.parameters.durationDays).toBe(30);
  expect(latest.verification?.workspace?.grants).toEqual([{ email: 'owner@orion.example', role: 'member' }]);
  await page.getByRole('button', { name: 'Inspect outcome' }).click();
  await expect(page.getByRole('heading', { name: 'The result matches the approved plan.' })).toBeVisible();
  await chapter('Independent checks confirm the actual workspace, access, expiry and uniqueness.', page.getByRole('heading', { name: 'The result matches the approved plan.' }), 6000);

  // T06 + T07 pre-approval invalidation: changing authority invalidates the displayed pending plan.
  await persona(page, 'person_ana');
  await page.getByRole('button', { name: 'Do', exact: true }).click();
  await submit(page, 'Vela Research', 'owner@vela.example', '30');
  await expect(page.getByRole('heading', { name: 'Waiting for Ravi' })).toBeVisible();
  const stale = await latestRequest(page);
  await persona(page, 'person_mira');
  await page.getByRole('button', { name: 'Demo controls' }).click();
  await page.getByLabel('Current role holder').selectOption('person_leena');
  await chapter('Change the graph assignment from Ravi to Leena. Pending plans become stale.', page.getByRole('dialog'), 5000);
  await page.getByRole('button', { name: 'Update authority' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await persona(page, 'person_ravi');
  const oldApproval = await page.request.post(`/api/plans/${stale.plan!.id}/approval`, { data: { planHash: stale.plan!.planHash, decision: 'APPROVED' } });
  expect(oldApproval.ok()).toBe(false);
  expect(['STALE_PLAN', 'FORBIDDEN']).toContain((await oldApproval.json()).error.code);
  await persona(page, 'person_ana');
  await submit(page, 'Peregrine Labs', 'owner@peregrine.example', '30');
  await expect(page.getByRole('heading', { name: 'Waiting for Leena' })).toBeVisible();
  latest = await latestRequest(page);
  expect(latest.plan?.approverPersonId).toBe('person_leena');
  expect(latest.receipts).toHaveLength(0);
  await chapter('A new episode retrieves Leena from the changed graph, without a prompt or code change.', page.getByLabel('Graph decision path'), 6000);
  await showAuthorityQuery();
  await persona(page, 'person_leena');
  await page.getByRole('button', { name: 'Approve this plan' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace independently verified' })).toBeVisible();
  latest = await latestRequest(page);
  expect(latest.verification?.passed).toBe(true);
  expect(latest.verification?.resourceCount).toBe(1);

  // T08 completed replay: same semantic request/key returns the original resource, never a second.
  await persona(page, 'person_ana');
  const replay = await page.request.post('/api/requests', { data: {
    processId: latest.request.processId,
    customerId: latest.request.customerId,
    customerName: latest.request.customerName,
    ownerEmail: latest.request.ownerEmail,
    requestedDays: latest.request.requestedDays,
    idempotencyKey: latest.request.idempotencyKey,
  } });
  expect(replay.ok(), await replay.text()).toBeTruthy();
  expect((await replay.json()).id).toBe(latest.request.id);
  const replayDetail = await (await page.request.get(`/api/requests/${latest.request.id}`)).json() as RequestDetail;
  expect(replayDetail.verification?.resourceCount).toBe(1);
  expect(replayDetail.verification?.workspace?.id).toBe(latest.verification?.workspace?.id);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The result matches the approved plan.' })).toBeVisible();
  await chapter('Company knowledge stays. Agents start fresh. Real work is independently verified.', page.getByRole('heading', { name: 'The result matches the approved plan.' }), 8000);
});

async function state(page: Page) { const response = await page.request.get('/api/state'); expect(response.ok()).toBeTruthy(); return await response.json() as State; }
async function latestRequest(page: Page) { const latest = (await state(page)).requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!; return await (await page.request.get(`/api/requests/${latest.id}`)).json() as RequestDetail; }
async function persona(page: Page, id: string) { await page.getByRole('combobox', { name: 'Demo persona' }).selectOption(id); await expect.poll(async () => (await state(page)).currentActorId, { timeout: 15_000 }).toBe(id); }
async function submit(page: Page, customer: string, email: string, days = '') {
  await page.getByLabel('Customer name', { exact: true }).fill(customer);
  await page.getByLabel('Workspace owner', { exact: true }).fill(email);
  await page.getByLabel('Requested duration', { exact: false }).fill(days);
  await page.getByRole('button', { name: 'Create trial request', exact: true }).click();
  await expect(page.getByRole('heading', { name: customer, exact: true })).toBeVisible();
}
