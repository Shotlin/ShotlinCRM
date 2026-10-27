import { z } from 'zod';

const short = (max: number) => z.string().trim().min(1).max(max);
const nullableDate = z
  .string()
  .max(80)
  .nullable()
  .refine((value) => value === null || !Number.isNaN(Date.parse(value)), 'Invalid date');

const entityEvidence = z.object({
  entityType: z.enum(['message', 'proposal', 'invoice', 'project', 'calendar', 'lead']),
  entityId: z.string().min(1).max(200),
  quote: z.string().trim().min(1).max(500),
});

const messageEvidence = z.object({
  messageId: z.string().min(1).max(200),
  quote: z.string().trim().min(1).max(500),
});

const confidence = z.number().int().min(0).max(100);

export const messageAnalysisSchema = z.object({
  language: short(40),
  summary: short(2_000),
  intent: z.enum([
    'enquiry',
    'scope_change',
    'proposal_question',
    'payment',
    'scheduling',
    'follow_up',
    'acknowledgement',
    'complaint',
    'other',
  ]),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']),
  urgency: z.enum(['low', 'medium', 'high']),
  needsReply: z.boolean(),
  requestedActions: z.array(short(300)).max(10).default([]),
  commitments: z
    .array(z.object({ text: short(500), dueAt: nullableDate }))
    .max(10)
    .default([]),
  dates: z.array(z.object({ text: short(200), date: nullableDate })).max(10).default([]),
  evidence: z.array(messageEvidence).min(1).max(10),
  confidence,
});

export const contactBriefSchema = z.object({
  summary: short(3_000),
  businessState: short(1_000),
  openLoops: z.array(short(500)).max(10).default([]),
  risks: z.array(short(500)).max(10).default([]),
  nextBestAction: short(1_000),
  evidence: z.array(entityEvidence).min(1).max(15),
  confidence,
});

export const replyDraftSchema = z.object({
  body: z.string().trim().min(1).max(8_000),
  language: short(40),
  evidence: z.array(entityEvidence).min(1).max(10),
  missingInfoQuestions: z.array(short(500)).max(5).default([]),
  confidence,
});

export const conversationSummarySchema = z.object({
  summary: short(3_000),
  openLoops: z.array(short(500)).max(10).default([]),
  commitments: z.array(short(500)).max(10).default([]),
  evidence: z.array(messageEvidence).max(10).default([]),
  confidence,
});

export type MessageAnalysisOutput = z.infer<typeof messageAnalysisSchema>;
export type ContactBriefOutput = z.infer<typeof contactBriefSchema>;
export type ReplyDraftOutput = z.infer<typeof replyDraftSchema>;
export type ConversationSummaryOutput = z.infer<typeof conversationSummarySchema>;

export class AiOutputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AiOutputError';
  }
}

function parseOrThrow<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const path = result.error.issues[0]?.path.join('.') || 'response';
    throw new AiOutputError('invalid_output', `The AI response was invalid at ${path}`);
  }
  return result.data;
}

function normalizeQuote(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function assertEvidence(
  evidence: { messageId?: string; entityId?: string; quote: string }[],
  allowed: Set<string> | Map<string, string>,
) {
  for (const item of evidence) {
    const id = item.messageId ?? item.entityId;
    if (!id) {
      throw new AiOutputError('invalid_evidence', 'The AI response omitted an evidence reference');
    }
    if (allowed instanceof Set) {
      if (!allowed.has(id)) {
        throw new AiOutputError(
          'invalid_evidence',
          'The AI response used evidence outside the provided records',
        );
      }
      continue;
    }
    const source = allowed.get(id);
    if (source === undefined) {
      throw new AiOutputError(
        'invalid_evidence',
        'The AI response used evidence outside the provided records',
      );
    }
    if (!normalizeQuote(source).toLowerCase().includes(normalizeQuote(item.quote).toLowerCase())) {
      throw new AiOutputError(
        'invalid_evidence',
        'The AI response quote does not match the referenced record',
      );
    }
  }
}

export function parseMessageAnalysis(
  raw: unknown,
  allowedMessageSources: Set<string> | Map<string, string>,
  targetMessageId?: string,
) {
  const value = parseOrThrow(messageAnalysisSchema, mustParse(raw));
  assertEvidence(value.evidence, allowedMessageSources);
  if (
    targetMessageId &&
    !value.evidence.some((item) => item.messageId === targetMessageId)
  ) {
    throw new AiOutputError(
      'invalid_evidence',
      'The AI response did not cite the analyzed message',
    );
  }
  return value;
}

export function parseContactBrief(raw: unknown, allowedSources: Set<string> | Map<string, string>) {
  const value = parseOrThrow(contactBriefSchema, mustParse(raw));
  assertEvidence(value.evidence, allowedSources);
  return value;
}

export function parseReplyDraft(raw: unknown, allowedSources: Set<string> | Map<string, string>) {
  const value = parseOrThrow(replyDraftSchema, mustParse(raw));
  assertEvidence(value.evidence, allowedSources);
  return value;
}

export function parseConversationSummary(
  raw: unknown,
  allowedMessageSources: Set<string> | Map<string, string>,
) {
  const value = parseOrThrow(conversationSummarySchema, mustParse(raw));
  assertEvidence(value.evidence, allowedMessageSources);
  return value;
}

function mustParse(raw: unknown) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new AiOutputError('invalid_json', 'The AI response was not valid JSON');
    }
  }
  return raw;
}

