import { AppError, type ModelAdapter } from '@athena/contracts';

/** A shared hosted-demo allowance; reaching it never switches providers. */
export function withModelBudget(model: ModelAdapter, maximum: number, clock = Date.now): ModelAdapter {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1000) throw new Error('MODEL_TURNS_PER_HOUR must be between 1 and 1000');
  let started = clock(), used = 0, active = false;
  return { mode: model.mode, model: model.model, async turn(input, tools, signal) {
    if (active) throw new AppError('CONFLICT', 'Another demo model call is in progress. Try again after it finishes.', 409);
    if (clock() - started >= 3_600_000) { started = clock(); used = 0; }
    if (used >= maximum) throw new AppError('BUDGET_EXCEEDED', 'The shared demo has reached its hourly model-call allowance. Try again later.', 429);
    used++; active = true;
    try { return await model.turn(input, tools, signal); } finally { active = false; }
  } };
}
