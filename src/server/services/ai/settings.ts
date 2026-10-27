import { randomUUID } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { AiSettingsView } from '../../../data/ai';
import { db } from '../../db/client';
import { aiAnalysisRuns, aiProviderSettings } from '../../db/schema';
import { decryptAiSecret, encryptAiSecret } from '../../security/envelope';
import {
  AiProviderError,
  callStructured,
  type AiProviderName,
  type ResolvedAiConfig,
} from './provider';

export const DEFAULT_MODELS: Record<AiProviderName, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-5-mini',
  openrouter: 'anthropic/claude-sonnet-4.5',
};

export const RESERVED_TOKENS_PER_RUN = 4_000;

export const AI_PROVIDERS: AiProviderName[] = ['anthropic', 'openai', 'openrouter'];

export function isAiProvider(value: unknown): value is AiProviderName {
  return value === 'anthropic' || value === 'openai' || value === 'openrouter';
}

export type SaveAiSettingsInput = {
  provider: AiProviderName;
  model: string;
  apiKey?: string;
  enabled: boolean;
  autoDraftEnabled: boolean;
  redactIdentifiers: boolean;
  firstResponseMinutes: number;
  monthlyTokenBudget: number;
};

export async function getAiSettingsView(workspaceId: string): Promise<AiSettingsView> {
  const [row] = await db
    .select()
    .from(aiProviderSettings)
    .where(eq(aiProviderSettings.workspaceId, workspaceId))
    .limit(1);
  const usageThisMonth = await countUsageThisMonth(workspaceId);
  const provider = isAiProvider(row?.provider) ? row.provider : 'anthropic';
  return {
    configured: Boolean(row?.encryptedApiKey),
    provider,
    model: row?.model ?? DEFAULT_MODELS[provider],
    enabled: row?.enabled ?? false,
    autoDraftEnabled: row?.autoDraftEnabled ?? true,
    redactIdentifiers: row?.redactIdentifiers ?? true,
    firstResponseMinutes: row?.firstResponseMinutes ?? 60,
    monthlyTokenBudget: row?.monthlyTokenBudget ?? 1_000_000,
    hasApiKey: Boolean(row?.encryptedApiKey),
    lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
    lastTestError: row?.lastTestError ?? null,
    usageThisMonth,
  };
}

export async function getAiConfig(workspaceId: string): Promise<ResolvedAiConfig | null> {
  const [row] = await db
    .select()
    .from(aiProviderSettings)
    .where(eq(aiProviderSettings.workspaceId, workspaceId))
    .limit(1);
  if (!row || !row.enabled || !row.encryptedApiKey || !isAiProvider(row.provider)) return null;
  return {
    workspaceId,
    provider: row.provider,
    model: row.model,
    apiKey: decryptAiSecret(row.encryptedApiKey),
    autoDraftEnabled: row.autoDraftEnabled,
    redactIdentifiers: row.redactIdentifiers,
    firstResponseMinutes: row.firstResponseMinutes,
    monthlyTokenBudget: row.monthlyTokenBudget,
  };
}

export async function saveAiSettings(workspaceId: string, input: SaveAiSettingsInput) {
  const [existing] = await db
    .select()
    .from(aiProviderSettings)
    .where(eq(aiProviderSettings.workspaceId, workspaceId))
    .limit(1);
  const encryptedApiKey = input.apiKey
    ? encryptAiSecret(input.apiKey)
    : existing?.encryptedApiKey;
  if (!encryptedApiKey) {
    throw new Error('Enter an API key to enable AI analysis');
  }

  const now = new Date();
  await db
    .insert(aiProviderSettings)
    .values({
      id: existing?.id ?? randomUUID(),
      workspaceId,
      provider: input.provider,
      model: input.model,
      encryptedApiKey,
      enabled: input.enabled,
      autoDraftEnabled: input.autoDraftEnabled,
      redactIdentifiers: input.redactIdentifiers,
      firstResponseMinutes: input.firstResponseMinutes,
      monthlyTokenBudget: input.monthlyTokenBudget,
      privacyMode: input.redactIdentifiers ? 'redacted' : 'full',
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiProviderSettings.workspaceId,
      set: {
        provider: input.provider,
        model: input.model,
        encryptedApiKey,
        enabled: input.enabled,
        autoDraftEnabled: input.autoDraftEnabled,
        redactIdentifiers: input.redactIdentifiers,
        firstResponseMinutes: input.firstResponseMinutes,
        monthlyTokenBudget: input.monthlyTokenBudget,
        privacyMode: input.redactIdentifiers ? 'redacted' : 'full',
        lastTestError: null,
        updatedAt: now,
      },
    });

  return getAiSettingsView(workspaceId);
}

export async function countUsageThisMonth(workspaceId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${aiAnalysisRuns.inputTokens} + ${aiAnalysisRuns.outputTokens}), 0)::int`,
    })
    .from(aiAnalysisRuns)
    .where(
      and(
        eq(aiAnalysisRuns.workspaceId, workspaceId),
        gte(aiAnalysisRuns.createdAt, monthStart),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function countBudgetUsageThisMonth(workspaceId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(
        case
          when ${aiAnalysisRuns.state} in ('queued', 'running')
            then ${RESERVED_TOKENS_PER_RUN}
          else ${aiAnalysisRuns.inputTokens} + ${aiAnalysisRuns.outputTokens}
        end
      ), 0)::int`,
    })
    .from(aiAnalysisRuns)
    .where(
      and(
        eq(aiAnalysisRuns.workspaceId, workspaceId),
        gte(aiAnalysisRuns.createdAt, monthStart),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function assertWithinBudget(config: ResolvedAiConfig) {
  const used = await countBudgetUsageThisMonth(config.workspaceId);
  if (used >= config.monthlyTokenBudget) {
    throw new AiProviderError(
      'The monthly AI token budget has been reached',
      false,
      'budget_exhausted',
    );
  }
}

export async function testAiProvider(
  workspaceId: string,
  override?: { provider?: AiProviderName; model?: string; apiKey?: string },
) {
  const [row] = await db
    .select()
    .from(aiProviderSettings)
    .where(eq(aiProviderSettings.workspaceId, workspaceId))
    .limit(1);
  const provider = override?.provider ?? (isAiProvider(row?.provider) ? row.provider : 'anthropic');
  const model = override?.model?.trim() || row?.model || DEFAULT_MODELS[provider];
  const apiKey = override?.apiKey?.trim() || (row?.encryptedApiKey ? decryptAiSecret(row.encryptedApiKey) : '');
  if (!apiKey) throw new Error('Enter an API key before testing the connection');

  const config: ResolvedAiConfig = {
    workspaceId,
    provider,
    model,
    apiKey,
    autoDraftEnabled: row?.autoDraftEnabled ?? true,
    redactIdentifiers: row?.redactIdentifiers ?? true,
    firstResponseMinutes: row?.firstResponseMinutes ?? 60,
    monthlyTokenBudget: row?.monthlyTokenBudget ?? 1_000_000,
  };

  try {
    await callStructured(config, {
      system: 'Return one JSON object. Do not use tools.',
      user: 'Return JSON exactly {"ok":true}.',
      maxTokens: 40,
    });
    if (row) {
      await db
        .update(aiProviderSettings)
        .set({ lastTestedAt: new Date(), lastTestError: null, updatedAt: new Date() })
        .where(eq(aiProviderSettings.workspaceId, workspaceId));
    }
    return { ok: true, provider, model };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provider test failed';
    if (row) {
      await db
        .update(aiProviderSettings)
        .set({ lastTestError: message.slice(0, 300), updatedAt: new Date() })
        .where(eq(aiProviderSettings.workspaceId, workspaceId));
    }
    throw error;
  }
}
