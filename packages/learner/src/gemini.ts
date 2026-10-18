import OpenAI from 'openai';
import { AppError, type ModelAdapter, type ModelTurn } from '@athena/contracts';

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Preserve the complete assistant message, including Gemini thought signatures. */
function messages(input: unknown[]): Message[] {
  return input.map(value => {
    const item = value as Record<string, unknown>;
    if (item.type === 'gemini_message') return item.message as Message;
    if (item.type === 'function_call_output') return { role: 'tool', tool_call_id: String(item.call_id), content: String(item.output) };
    if (['system', 'user'].includes(String(item.role)) && typeof item.content === 'string') return item as unknown as Message;
    throw new AppError('INVALID_INPUT', 'Unexpected conversation item for the Gemini adapter');
  });
}

export function createGeminiAdapter(options: { apiKey?: string; model?: string; baseURL?: string } = {}): ModelAdapter {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options.model ?? process.env.GEMINI_MODEL;
  if (!apiKey || !model) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Configure GEMINI_API_KEY and GEMINI_MODEL before running live learning', 503);
  const client = new OpenAI({ apiKey, baseURL: options.baseURL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/', maxRetries: 0, timeout: 120_000 });
  return {
    mode: 'live', model,
    async turn(input, tools, signal): Promise<ModelTurn> {
      try {
        const response = await client.chat.completions.create({
          model, messages: messages(input),
          tools: tools.map(tool => ({ type: 'function' as const, function: { ...tool, strict: true } })),
          tool_choice: 'required', parallel_tool_calls: false, max_tokens: 12_000, reasoning_effort: 'low',
        }, { signal });
        const choice = response.choices[0];
        if (!choice || !['tool_calls', 'stop'].includes(choice.finish_reason)) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Gemini did not complete a usable tool response; no candidate was accepted', 503);
        const calls = (choice.message.tool_calls ?? []).map(call => {
          if (call.type !== 'function') throw new AppError('FORBIDDEN', 'Gemini returned an unsupported tool type', 403);
          let args: unknown;
          try { args = JSON.parse(call.function.arguments); } catch { throw new AppError('INVALID_INPUT', 'Gemini returned malformed tool arguments'); }
          return { id: call.id, name: call.function.name, arguments: args };
        });
        if (!calls.length || new Set(calls.map(call => call.id)).size !== calls.length) throw new AppError('INVALID_INPUT', 'Gemini must return uniquely identified tool calls');
        return { output: [{ type: 'gemini_message', message: choice.message }], calls, text: choice.message.content ?? '',
          inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0,
          model: response.model, responseId: response.id };
      } catch (error) {
        if (signal.aborted) throw new AppError('BUDGET_EXCEEDED', 'Model episode exceeded its active time budget', 408);
        if (error instanceof AppError) throw error;
        throw new AppError('DEPENDENCY_UNAVAILABLE', 'Gemini request failed or its free quota was reached; no paid-provider fallback was used', 503);
      }
    },
  };
}
