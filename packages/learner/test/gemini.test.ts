import { afterEach, describe, expect, test, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createModelAdapter, hasModelConfiguration } from '../src/model';

let server: Server | undefined;
afterEach(async () => { vi.unstubAllEnvs(); if (server?.listening) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } });
async function endpoint(handler: (body: any, authorization: string | undefined) => { status?: number; body: unknown }) {
  server = createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    const result = handler(JSON.parse(data), req.headers.authorization);
    res.writeHead(result.status ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.body));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
}
const tool = { name: 'read_history', description: 'Read evidence', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } };
const assistant = { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_history', arguments: '{}' }, extra_content: { google: { thought_signature: 'test-only-opaque-signature' } } }] };
const response = { id: 'response_test', model: 'gemini-test', choices: [{ finish_reason: 'tool_calls', message: assistant }], usage: { prompt_tokens: 18, completion_tokens: 7 } };

describe('Gemini adapter at the actual HTTP boundary', () => {
  test('preserves opaque assistant fields and routes tool results to the matching call', async () => {
    const received: any[] = [];
    const baseURL = await endpoint((body, authorization) => { expect(authorization).toBe('Bearer test-gemini-key'); received.push(body); return { body: response }; });
    const model = createModelAdapter({ provider: 'gemini', model: 'gemini-test', apiKey: 'test-gemini-key', baseURL });
    const input: unknown[] = [{ role: 'system', content: 'Use evidence' }, { role: 'user', content: 'Learn' }];
    const turn = await model.turn(input, [tool], new AbortController().signal);
    expect(turn).toMatchObject({ calls: [{ id: 'call_1', name: 'read_history', arguments: {} }], inputTokens: 18, outputTokens: 7 });
    input.push(...turn.output, { type: 'function_call_output', call_id: 'call_1', output: '{"cases":[]}' });
    await model.turn(input, [tool], new AbortController().signal);
    expect(received[1].messages[2]).toEqual(assistant);
    expect(received[1].messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"cases":[]}' });
    expect(received[0]).toMatchObject({ tool_choice: 'required', parallel_tool_calls: false });
  });
  test('quota errors fail without retrying or leaking provider error content', async () => {
    let count = 0;
    const baseURL = await endpoint(() => { count++; return { status: 429, body: { error: { message: 'test-secret-provider-error', code: 429 } } }; });
    const model = createModelAdapter({ provider: 'gemini', apiKey: 'test-key', model: 'gemini-test', baseURL });
    await expect(model.turn([], [tool], new AbortController().signal)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', message: expect.stringContaining('no paid-provider fallback') });
    expect(count).toBe(1);
  });
  test('truncated responses cannot become accepted tool calls', async () => {
    const baseURL = await endpoint(() => ({ body: { ...response, choices: [{ finish_reason: 'length', message: assistant }] } }));
    const model = createModelAdapter({ provider: 'gemini', apiKey: 'test-key', model: 'gemini-test', baseURL });
    await expect(model.turn([], [tool], new AbortController().signal)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
  test('Gemini selection never borrows configured OpenAI credentials', () => {
    vi.stubEnv('MODEL_PROVIDER', 'gemini'); vi.stubEnv('OPENAI_API_KEY', 'test-openai-key'); vi.stubEnv('OPENAI_MODEL', 'test-openai-model');
    vi.stubEnv('GEMINI_API_KEY', ''); vi.stubEnv('GEMINI_MODEL', 'gemini-test');
    expect(hasModelConfiguration()).toBe(false);
    expect(() => createModelAdapter()).toThrow('GEMINI_API_KEY');
  });
});
