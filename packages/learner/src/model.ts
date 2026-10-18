import OpenAI from 'openai';
import { AppError, type ModelAdapter, type ModelTool, type ModelTurn } from '@athena/contracts';
import { createGeminiAdapter } from './gemini';

export type ModelOptions = { apiKey?: string; model?: string; baseURL?: string; provider?: 'openai' | 'gemini' };

export function hasModelConfiguration(): boolean {
  const provider = process.env.MODEL_PROVIDER ?? 'openai';
  if (provider === 'gemini') return !!(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);
  if (provider === 'openai') return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
  throw new AppError('INVALID_INPUT', 'MODEL_PROVIDER must be openai or gemini');
}

/** Live Responses adapter. Missing credentials and API failures never select a fake. */
export function createModelAdapter(options: ModelOptions = {}): ModelAdapter {
  const provider = options.provider ?? process.env.MODEL_PROVIDER ?? 'openai';
  if (provider === 'gemini') return createGeminiAdapter(options);
  if (provider !== 'openai') throw new AppError('INVALID_INPUT', 'MODEL_PROVIDER must be openai or gemini');
  const model = options.model ?? process.env.OPENAI_MODEL;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!model || !apiKey) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Configure OPENAI_API_KEY and OPENAI_MODEL before running live learning', 503);
  const client = new OpenAI({ apiKey, baseURL: options.baseURL, maxRetries: 0, timeout: 120_000 });
  return {
    mode: 'live', model,
    async turn(input: unknown[], tools: ModelTool[], signal: AbortSignal): Promise<ModelTurn> {
      try {
        const response = await client.responses.create({
          model, input: input as OpenAI.Responses.ResponseInput, store: false,
          include: ['reasoning.encrypted_content'],
          tools: tools.map(tool => ({ ...tool, type: 'function' as const, strict: true })),
          tool_choice: 'required', parallel_tool_calls: false, max_output_tokens: 12_000,
        }, { signal });
        if (response.status !== 'completed') throw new AppError('DEPENDENCY_UNAVAILABLE', `Model response ${response.status}; no candidate was accepted`, 503, { responseId: response.id, incompleteDetails: response.incomplete_details });
        const calls = response.output.filter(item => item.type === 'function_call').map(item => {
          let argumentsValue: unknown;
          try { argumentsValue = JSON.parse(item.arguments); } catch { throw new AppError('INVALID_INPUT', 'Model returned malformed tool arguments'); }
          return { id: item.call_id, name: item.name, arguments: argumentsValue };
        });
        return { output: response.output, calls, text: response.output_text, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0, model: response.model, responseId: response.id };
      } catch (error) {
        if (signal.aborted) throw new AppError('BUDGET_EXCEEDED', 'Model episode exceeded its active time budget', 408);
        if (error instanceof AppError) throw error;
        throw new AppError('DEPENDENCY_UNAVAILABLE', 'Live model request failed; no fallback candidate was produced', 503, { cause: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
