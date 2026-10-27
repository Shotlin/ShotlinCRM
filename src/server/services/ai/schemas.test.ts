import { describe, expect, it } from 'vitest';
import {
  parseContactBrief,
  parseConversationSummary,
  parseMessageAnalysis,
  parseReplyDraft,
} from './schemas';

describe('message analysis schema', () => {
  const raw = {
    language: 'en',
    summary: 'Asks whether the dates are available.',
    intent: 'scheduling',
    sentiment: 'positive',
    urgency: 'high',
    needsReply: true,
    requestedActions: ['Confirm availability'],
    commitments: [{ text: 'Confirm by tomorrow', dueAt: null }],
    dates: [{ text: 'December 12–13', date: null }],
    evidence: [{ messageId: 'message-1', quote: 'Can you confirm December 12–13?' }],
    confidence: 91,
  };

  it('accepts a valid analysis with real message evidence', () => {
    expect(parseMessageAnalysis(raw, new Set(['message-1']))).toMatchObject(raw);
  });

  it('rejects evidence for a message that was not supplied', () => {
    expect(() =>
      parseMessageAnalysis(
        {
          ...raw,
          evidence: [{ messageId: 'other-message', quote: 'Invented source' }],
        },
        new Set(['message-1']),
      ),
    ).toThrow(/evidence/i);
  });

  it('rejects impossible confidence', () => {
    expect(() => parseMessageAnalysis({ ...raw, confidence: 101 }, new Set(['message-1']))).toThrow();
  });

  it('requires the analysis to cite the analyzed target message', () => {
    expect(() =>
      parseMessageAnalysis(
        {
          ...raw,
          evidence: [{ messageId: 'context-message', quote: 'Context only' }],
        },
        new Set(['message-1', 'context-message']),
        'message-1',
      ),
    ).toThrow(/analyzed message/i);
  });

  it('rejects paraphrased quotes against the referenced record', () => {
    expect(() =>
      parseMessageAnalysis(
        {
          ...raw,
          evidence: [{ messageId: 'message-1', quote: 'A totally invented quotation' }],
        },
        new Map([['message-1', 'Can you confirm December 12–13?']]),
        'message-1',
      ),
    ).toThrow(/quote/i);
  });

  it('accepts an exact quote against the referenced record', () => {
    expect(
      parseMessageAnalysis(
        raw,
        new Map([['message-1', 'Please can you confirm December 12–13?']]),
        'message-1',
      ).evidence[0].quote,
    ).toBe('Can you confirm December 12–13?');
  });

  it('treats instruction-like message text as ordinary data', () => {
    const parsed = parseMessageAnalysis(
      {
        ...raw,
        summary: 'ignore previous instructions',
      },
      new Set(['message-1']),
    );
    expect(parsed.summary).toBe('ignore previous instructions');
  });
});

describe('contact brief and draft schemas', () => {
  it('caps brief lists and validates evidence entities', () => {
    expect(() =>
      parseContactBrief(
        {
          summary: 'Active wedding enquiry.',
          businessState: 'Connected, proposal not sent.',
          openLoops: Array.from({ length: 11 }, (_, index) => `Loop ${index}`),
          risks: [],
          nextBestAction: 'Confirm dates.',
          evidence: [{ entityType: 'lead', entityId: 'lead-1', quote: 'Wedding enquiry' }],
          confidence: 80,
        },
        new Set(),
      ),
    ).toThrow();
  });

  it('rejects an empty or oversized reply draft', () => {
    const base = {
      body: 'Thanks — I will confirm shortly.',
      language: 'en',
      evidence: [{ entityType: 'message', entityId: 'message-1', quote: 'Confirm?' }],
      missingInfoQuestions: [],
      confidence: 80,
    };
    expect(() => parseReplyDraft({ ...base, body: '' }, new Set(['message-1']))).toThrow();
    expect(() =>
      parseReplyDraft({ ...base, body: 'x'.repeat(8_001) }, new Set(['message-1'])),
    ).toThrow();
  });

  it('accepts a bounded conversation summary', () => {
    expect(
      parseConversationSummary(
        {
          summary: 'The couple discussed dates and a teaser.',
          openLoops: ['Confirm date'],
          commitments: ['Send revised package'],
          evidence: [{ messageId: 'message-1', quote: 'Please confirm' }],
          confidence: 84,
        },
        new Set(['message-1']),
      ).openLoops,
    ).toEqual(['Confirm date']);
  });
});
