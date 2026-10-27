import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProviderError, callStructured, type ResolvedAiConfig } from './provider';

const config = (provider: ResolvedAiConfig['provider']): ResolvedAiConfig => ({
  workspaceId: 'workspace-1',
  provider,
  model: provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-5-mini',
  apiKey: 'test-secret-key',
  autoDraftEnabled: true,
  redactIdentifiers: true,
  firstResponseMinutes: 60,
  monthlyTokenBudget: 1_000_000,
});

const request = { system: 'Return JSON.', user: '{"message":"hello"}', maxTokens: 400 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('structured provider adapters', () => {
  it('calls Anthropic messages and parses its JSON text', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"ok":true}' }],
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callStructured(config('anthropic'), request);

    expect(result).toEqual({ data: { ok: true }, usage: { inputTokens: 12, outputTokens: 4 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({
      'x-api-key': 'test-secret-key',
      'anthropic-version': '2023-06-01',
    });
  });

  it('calls OpenAI chat completions with JSON mode', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callStructured(config('openai'), request);

    expect(result.data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(init.body as string)).toMatchObject({
      response_format: { type: 'json_object' },
    });
  });

  it('calls OpenRouter with app attribution headers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '```json\n{"ok":true}\n```' } }],
          usage: { prompt_tokens: 8, completion_tokens: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callStructured(config('openrouter'), request);

    expect(result.data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers).toMatchObject({ 'X-Title': 'Shotlin CRM' });
  });

  it('returns safe non-retryable errors for authentication failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('secret upstream detail', { status: 401 })),
    );

    const failure = callStructured(config('openai'), request);
    await expect(failure).rejects.toBeInstanceOf(AiProviderError);
    await expect(failure).rejects.not.toThrow(/test-secret-key|secret upstream detail/);
  });

  it('does not send oversized messages', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callStructured(config('anthropic'), { ...request, user: 'x'.repeat(120_001) }),
    ).rejects.toMatchObject({ code: 'payload_too_large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
