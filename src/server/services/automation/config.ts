import { z } from 'zod';

// Amounts are stored in USD micro-units to avoid floating-point budget errors.
export const automationConfigSchema = z.object({
  provider: z.literal('openrouter'),
  defaultModel: z.string().trim().min(1).max(200),
  researchModel: z.string().trim().max(200).default(''),
  developmentModel: z.string().trim().max(200).default(''),
  qaModel: z.string().trim().max(200).default(''),
  maxRunMicros: z.number().int().min(1).max(1_000_000_000),
  monthlyBudgetMicros: z.number().int().min(1).max(10_000_000_000),
}).strict().refine((config) => config.maxRunMicros <= config.monthlyBudgetMicros, {
  path: ['maxRunMicros'],
  message: 'A single run cannot exceed the monthly automation budget',
});

export type AutomationConfig = z.infer<typeof automationConfigSchema>;
