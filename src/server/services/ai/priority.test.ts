import { describe, expect, it } from 'vitest';
import { delayPoints, priorityForScore, scoreCandidate } from './priority';

const now = new Date('2026-10-27T11:30:00.000Z');

describe('priorityForScore', () => {
  it('uses the approved thresholds', () => {
    expect(priorityForScore(70)).toBe('high');
    expect(priorityForScore(69)).toBe('secondary');
    expect(priorityForScore(45)).toBe('secondary');
    expect(priorityForScore(44)).toBe('normal');
  });
});

describe('scoreCandidate', () => {
  it('makes a breached first reply with buying intent high', () => {
    const result = scoreCandidate({
      now,
      type: 'first_reply',
      waitingSince: new Date('2026-10-27T09:16:00.000Z'),
      firstResponseTargetMinutes: 60,
      isNew: true,
      unread: true,
      buyingIntent: true,
      aiUrgent: false,
      valuePoints: 0,
    });
    expect(result.score).toBe(70);
    expect(result.priority).toBe('high');
    expect(result.factors.map((factor) => factor.code)).toEqual([
      'buying_intent',
      'unread_new',
      'first_response_sla',
      'waiting_2h',
    ]);
  });

  it('never promotes an overdue invoice below secondary', () => {
    const result = scoreCandidate({ now, type: 'invoice_overdue', overdueInvoice: true });
    expect(result.score).toBe(35);
    expect(result.priority).toBe('secondary');
  });

  it('caps combined factors at 100', () => {
    const result = scoreCandidate({
      now,
      type: 'project_overdue',
      overdueProject: true,
      overdueInvoice: true,
      buyingIntent: true,
      aiUrgent: true,
      firstResponseTargetMinutes: 60,
      isNew: true,
      unread: true,
      waitingSince: new Date('2026-10-20T09:00:00.000Z'),
      valuePoints: 10,
    });
    expect(result.score).toBe(100);
  });
});

describe('delayPoints', () => {
  it('ignores waits below thirty minutes', () => {
    expect(delayPoints(now, new Date('2026-10-27T11:15:00.000Z'))).toBeNull();
  });

  it('crosses the approved age bands', () => {
    expect(delayPoints(now, new Date('2026-10-27T09:00:00.000Z'))?.points).toBe(12);
    expect(delayPoints(now, new Date('2026-10-26T10:00:00.000Z'))?.points).toBe(25);
  });
});
