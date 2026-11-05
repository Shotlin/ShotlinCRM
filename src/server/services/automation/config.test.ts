import { describe, expect, it } from 'vitest';
import { automationConfigSchema } from './config';

const config = { provider: 'openrouter', defaultModel: 'example/model', maxRunMicros: 1_000_000, monthlyBudgetMicros: 5_000_000 };

describe('automation budget configuration', () => {
  it('accepts integer USD micro-units with optional model overrides', () => {
    expect(automationConfigSchema.parse(config)).toMatchObject({ researchModel: '', maxRunMicros: 1_000_000 });
  });
  it('rejects a per-run limit larger than the monthly limit', () => {
    expect(automationConfigSchema.safeParse({ ...config, maxRunMicros: 6_000_000 }).success).toBe(false);
  });
  it('rejects fractional amounts and other providers', () => {
    expect(automationConfigSchema.safeParse({ ...config, maxRunMicros: 1.5 }).success).toBe(false);
    expect(automationConfigSchema.safeParse({ ...config, provider: 'openai' }).success).toBe(false);
  });
});
