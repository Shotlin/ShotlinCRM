export type AiProviderName = 'anthropic' | 'openai' | 'openrouter';

export type ResolvedAiConfig = {
  workspaceId: string;
  provider: AiProviderName;
  model: string;
  apiKey: string;
  autoDraftEnabled: boolean;
  redactIdentifiers: boolean;
  firstResponseMinutes: number;
  monthlyTokenBudget: number;
};

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

const TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARS = 120_000;

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  try {
    return JSON.parse(unfenced);
  } catch {
    throw new AiProviderError('The AI provider returned invalid JSON', true, 'invalid_json');
  }
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  provider: AiProviderName,
) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new AiProviderError(
      timedOut
        ? 'The AI provider timed out'
        : `The ${provider} provider could not be reached`,
      true,
      timedOut ? 'provider_timeout' : 'provider_unreachable',
    );
  }

  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new AiProviderError(
      response.status === 401 || response.status === 403
        ? 'The AI provider rejected this API key'
        : `The AI provider returned HTTP ${response.status}`,
      retryable,
      `provider_http_${response.status}`,
    );
  }

  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new AiProviderError(
      'The AI provider returned an unreadable response',
      true,
      'invalid_response',
    );
  }
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function callStructured(
  config: ResolvedAiConfig,
  request: { system: string; user: string; maxTokens: number },
): Promise<{ data: unknown; usage: { inputTokens: number; outputTokens: number } }> {
  if (request.system.length + request.user.length > MAX_INPUT_CHARS) {
    throw new AiProviderError('The analysis context is too large', false, 'payload_too_large');
  }

  if (config.provider === 'anthropic') {
    const payload = await postJson(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model: config.model,
        max_tokens: request.maxTokens,
        temperature: 0.2,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      },
      config.provider,
    );
    const content = Array.isArray(payload.content)
      ? payload.content
          .filter(
            (part): part is { type: string; text: string } =>
              typeof part === 'object' &&
              part !== null &&
              (part as { type?: unknown }).type === 'text' &&
              typeof (part as { text?: unknown }).text === 'string',
          )
          .map((part) => part.text)
          .join('')
      : '';
    if (!content) {
      throw new AiProviderError('The AI provider returned no content', true, 'empty_content');
    }
    const usage = (payload.usage ?? {}) as Record<string, unknown>;
    return {
      data: parseJsonText(content),
      usage: {
        inputTokens: numberValue(usage.input_tokens),
        outputTokens: numberValue(usage.output_tokens),
      },
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (config.provider === 'openrouter') {
    headers['X-Title'] = 'Shotlin CRM';
    headers['HTTP-Referer'] = process.env.AUTH_URL ?? 'http://127.0.0.1:3000';
  }
  const payload = await postJson(
    config.provider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions',
    headers,
    {
      model: config.model,
      ...(config.provider === 'openai'
        ? { max_completion_tokens: request.maxTokens }
        : { max_tokens: request.maxTokens }),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    },
    config.provider,
  );
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = typeof first?.message?.content === 'string' ? first.message.content : '';
  if (!content) {
    throw new AiProviderError('The AI provider returned no content', true, 'empty_content');
  }
  const usage = (payload.usage ?? {}) as Record<string, unknown>;
  return {
    data: parseJsonText(content),
    usage: {
      inputTokens: numberValue(usage.prompt_tokens),
      outputTokens: numberValue(usage.completion_tokens),
    },
  };
}
