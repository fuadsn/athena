import { expect, test, vi } from 'vitest';
import { withModelBudget } from '../src/budget';
import type { ModelAdapter, ModelTurn } from '@athena/contracts';

test('hosted allowance counts failures, refuses concurrent calls and renews after an hour', async () => {
  let now = 0, release!: () => void;
  const turn = vi.fn(async () => { await new Promise<void>(done => { release = done; }); throw new Error('provider failure'); });
  const base: ModelAdapter = { mode: 'test', model: 'test-only', turn };
  const model = withModelBudget(base, 1, () => now), signal = new AbortController().signal;
  const first = model.turn([], [], signal);
  const firstResult = expect(first).rejects.toThrow('provider failure');
  await expect(model.turn([], [], signal)).rejects.toMatchObject({ code: 'CONFLICT' });
  release(); await firstResult;
  await expect(model.turn([], [], signal)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  expect(turn).toHaveBeenCalledTimes(1);
  now = 3_600_000;
  base.turn = async () => ({ output: [], calls: [], text: '', model: 'test-only', responseId: 'test', inputTokens: 0, outputTokens: 0 } satisfies ModelTurn);
  await expect(model.turn([], [], signal)).resolves.toHaveProperty('responseId', 'test');
});
