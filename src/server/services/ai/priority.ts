import type { AiPriority, ScoreFactor } from '../../../data/ai';

export type ScoreInput = {
  now: Date;
  type: string;
  waitingSince?: Date | null;
  firstResponseTargetMinutes?: number;
  isNew?: boolean;
  unread?: boolean;
  buyingIntent?: boolean;
  aiUrgent?: boolean;
  valuePoints?: number;
  overdueProject?: boolean;
  overdueInvoice?: boolean;
  proposalExpiring?: boolean;
  proposalExpired?: boolean;
  followUpDue?: boolean;
  meetingToday?: boolean;
};

const MINUTE = 60_000;

export function priorityForScore(score: number): AiPriority {
  if (score >= 70) return 'high';
  if (score >= 45) return 'secondary';
  return 'normal';
}

export function delayPoints(now: Date, since: Date): ScoreFactor | null {
  const minutes = (now.getTime() - since.getTime()) / MINUTE;
  if (minutes >= 24 * 60) {
    return { code: 'waiting_24h', label: 'Waiting over 24 hours', points: 25 };
  }
  if (minutes >= 8 * 60) {
    return { code: 'waiting_8h', label: 'Waiting over 8 hours', points: 20 };
  }
  if (minutes >= 2 * 60) {
    return { code: 'waiting_2h', label: 'Waiting over 2 hours', points: 12 };
  }
  if (minutes >= 30) {
    return { code: 'waiting_30m', label: 'Waiting over 30 minutes', points: 5 };
  }
  return null;
}

export function scoreCandidate(input: ScoreInput) {
  const factors: ScoreFactor[] = [];
  const add = (condition: boolean | undefined, code: string, label: string, points: number) => {
    if (condition) factors.push({ code, label, points });
  };

  add(input.overdueProject, 'project_overdue', 'Project deadline passed', 40);
  add(input.overdueInvoice, 'invoice_overdue', 'Invoice payment overdue', 35);
  add(input.proposalExpired, 'proposal_expired', 'Proposal expired', 30);
  add(input.proposalExpiring, 'proposal_expiring', 'Proposal expires within 48 hours', 25);
  add(input.followUpDue, 'follow_up_due', 'Follow-up is due', 20);
  add(input.aiUrgent, 'ai_urgency', 'Explicit urgency in conversation', 20);
  add(input.buyingIntent, 'buying_intent', 'Buying, scope, or payment question', 15);
  add(input.meetingToday, 'meeting_today', 'Production or meeting today', 10);
  add(input.unread, 'unread_new', 'Unread new enquiry', 8);

  if (input.type === 'first_reply' && input.waitingSince) {
    const minutes = (input.now.getTime() - input.waitingSince.getTime()) / MINUTE;
    add(
      minutes > (input.firstResponseTargetMinutes ?? 60),
      'first_response_sla',
      'First-response target breached',
      35,
    );
  }

  if (input.waitingSince) {
    const delay = delayPoints(input.now, input.waitingSince);
    if (delay) factors.push(delay);
  }

  if ((input.valuePoints ?? 0) > 0) {
    factors.push({
      code: 'deal_value',
      label: 'High-value opportunity',
      points: input.valuePoints!,
    });
  }

  const score = Math.min(
    100,
    factors.reduce((total, factor) => total + factor.points, 0),
  );
  let priority = priorityForScore(score);
  if ((input.overdueProject || input.overdueInvoice) && priority === 'normal') {
    priority = 'secondary';
  }

  return { score, priority, factors };
}
