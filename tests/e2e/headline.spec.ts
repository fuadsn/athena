import { test, expect, type Page } from '@playwright/test';
import type { RequestDetail, State } from '@athena/contracts';

/** Release test: all learning and execution use the running live-model runtime. */
test('cold evidence → owner teaching → verified work → changed authority', async ({ page }) => {
  const ownerSession = await page.request.post('/api/session', { data: { personId: 'person_mira' } });
  expect(ownerSession.ok(), await ownerSession.text()).toBeTruthy();
  const reset = await page.request.post('/api/demo/reset', { data: {} });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  const cold = await state(page);
  expect(cold.modelConfigured, 'The headline release flow requires a real configured model; there is no canned fallback.').toBe(true);
  expect(cold.procedures.filter(procedure => procedure.status === 'PUBLISHED')).toHaveLength(0);
  expect(cold.cases).toHaveLength(3);
  await page.goto('/');
  await expect(page.getByText('No published procedure')).toBeVisible();
  await page.getByRole('button', { name: 'Open Northstar source' }).click();
  await expect(page.getByRole('dialog')).toContainText('Northstar');
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('button', { name: 'Learn from these cases' }).click();
  await expect(page.getByRole('heading', { name: 'Teach the reusable policy' })).toBeVisible();
  await expect(page.getByText('A PERSON NEEDS TO CONFIRM')).toBeVisible();
  await page.getByLabel('Normal trial duration', { exact: true }).fill('7');
  await page.getByLabel('Extended trial duration', { exact: true }).fill('30');
  await page.getByLabel('Extension approval role', { exact: true }).selectOption('role_trial_extension_approver');
  await page.getByRole('checkbox', { name: 'Configure access and expiry while the workspace is inactive.' }).check();
  await page.getByRole('checkbox', { name: 'Activate only after both access and expiry are correctly configured.' }).check();
  await page.getByRole('checkbox', { name: 'I confirm these settings as reusable policy.' }).check();
  await page.getByRole('button', { name: 'Confirm & publish procedure' }).click();
  await expect(page.getByRole('button', { name: 'Use this procedure' })).toBeVisible();
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

  // T05: a request waits without mutation; only current authority can approve.
  await submit(page, 'Orion Instruments', 'owner@orion.example', '30');
  await expect(page.getByRole('heading', { name: 'Waiting for Ravi' })).toBeVisible();
  latest = await latestRequest(page);
  expect(latest.request.state).toBe('WAITING_APPROVAL');
  expect(latest.receipts).toHaveLength(0);
  const unauthorized = await page.request.post(`/api/plans/${latest.plan!.id}/approval`, { data: { planHash: latest.plan!.planHash, decision: 'APPROVED' } });
  expect(unauthorized.status()).toBe(403);
  await persona(page, 'person_ravi');
  await page.getByRole('button', { name: 'Approve this plan' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace independently verified' })).toBeVisible();
  latest = await latestRequest(page);
  expect(latest.verification?.passed).toBe(true);
  expect(latest.plan?.parameters.durationDays).toBe(30);
  expect(latest.verification?.workspace?.grants).toEqual([{ email: 'owner@orion.example', role: 'member' }]);
  await page.getByRole('button', { name: 'Inspect outcome' }).click();
  await expect(page.getByRole('heading', { name: 'The result matches the approved plan.' })).toBeVisible();

  // T06 + T07 pre-approval invalidation: changing authority invalidates the displayed pending plan.
  await persona(page, 'person_ana');
  await page.getByRole('button', { name: 'Do', exact: true }).click();
  await submit(page, 'Vela Research', 'owner@vela.example', '30');
  await expect(page.getByRole('heading', { name: 'Waiting for Ravi' })).toBeVisible();
  const stale = await latestRequest(page);
  await persona(page, 'person_mira');
  await page.getByRole('button', { name: 'Demo controls' }).click();
  await page.getByLabel('Current role holder').selectOption('person_leena');
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
