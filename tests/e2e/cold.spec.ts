import { test, expect } from '@playwright/test';

test('local browser entry, evidence, and origin guards work without a model', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter local demo' }).click();
  await expect(page.getByRole('combobox', { name: 'Demo persona' })).toHaveValue('person_mira');
  await expect(page.getByRole('button', { name: 'Open Northstar source' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Northstar source' }).click();
  await expect(page.getByRole('dialog')).toContainText('Northstar');
  await page.getByRole('button', { name: 'Close dialog' }).click();

  const stateResponse = await page.request.get('/api/state');
  expect(stateResponse.ok()).toBe(true);
  const state = await stateResponse.json();
  if (!state.modelConfigured && !state.learningRuns.length && !state.procedures.length) {
    await expect(page.getByRole('button', { name: 'Learn from these cases' })).toBeDisabled();
    await expect(page.getByText('A live model must be configured before learning can start.')).toBeVisible();
  }

  for (const origin of ['https://foreign.example', 'http://localhost.foreign.example', 'null', 'http://127.0.0.1:59999']) {
    const response = await page.request.post('/api/session', { headers: { origin }, data: { personId: 'person_ana' } });
    expect(response.status(), origin).toBe(403);
  }
  const local = await page.request.post('/api/session', { headers: { origin: new URL(baseURL!).origin }, data: { personId: 'person_mira' } });
  expect(local.ok(), await local.text()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Demo persona' })).toHaveValue('person_mira');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
