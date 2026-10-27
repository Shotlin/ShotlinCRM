import type { Currency, LeadSource } from './types';

export type AiPriority = 'high' | 'secondary' | 'normal';
export type ScoreFactor = { code: string; label: string; points: number };
export type EvidenceRef = {
  kind: 'message' | 'proposal' | 'invoice' | 'project' | 'calendar' | 'lead';
  id: string;
  label: string;
  quote?: string;
};
export type RecommendationType =
  | 'first_reply'
  | 'reply_needed'
  | 'proposal_expiring'
  | 'invoice_overdue'
  | 'follow_up_due'
  | 'project_overdue'
  | 'meeting_today';

export type AiRecommendation = {
  id: string;
  type: RecommendationType;
  priority: AiPriority;
  score: number;
  scoreFactors: ScoreFactor[];
  title: string;
  explanation: string;
  quote: string;
  ageLabel: string | null;
  source: LeadSource | null;
  leadId: string | null;
  clientId: string | null;
  leadName: string;
  dueAt: string | null;
  href: string;
  evidence: EvidenceRef[];
};

export type AiDashboard = {
  generatedAt: string;
  analysis: {
    configured: boolean;
    enabled: boolean;
    provider: string | null;
    model: string | null;
    analyzed: number;
    total: number;
    failed: number;
    pending: number;
  };
  metrics: {
    needsAttention: number;
    unreadMessages: number;
    repliesWaiting: number;
    atRiskMinor: number;
    reportingCurrency: Currency;
  };
  recommendations: AiRecommendation[];
  today: { id: string; time: string; title: string; meta: string; href: string }[];
  signals: { proposalFollowUps: number; overdueInvoices: number; projectRisks: number };
  briefing: string;
};

export type AiMessageAnalysisView = {
  messageId: string;
  summary: string;
  intent: string;
  sentiment: string;
  urgency: string;
  needsReply: boolean;
  requestedActions: string[];
  commitments: { text: string; dueAt: string | null }[];
  confidence: number;
};

export type AiContactDetail = {
  lead: {
    id: string;
    name: string;
    company: string;
    phone: string;
    email: string;
    city: string;
    source: LeadSource;
    status: string;
    valueMinor: number;
    currency: Currency;
    followUpAt: string | null;
    clientId: string | null;
  };
  delayedReply: { since: string; minutes: number } | null;
  unread: number;
  recommendations: AiRecommendation[];
  analyses: AiMessageAnalysisView[];
  brief: {
    summary: string;
    businessState: string;
    openLoops: string[];
    risks: string[];
    nextBestAction: string;
    generatedAt: string;
  } | null;
  messages: { id: string; direction: 'inbound' | 'outbound'; body: string; sentAt: string }[];
  projects: {
    id: string;
    title: string;
    status: string;
    startsAt: string | null;
    dueAt: string;
    overdue: boolean;
  }[];
  draft: {
    id: string;
    body: string;
    state: string;
    stale: boolean;
    evidence: EvidenceRef[];
    missingInfoQuestions: string[];
    generatedAt: string;
  } | null;
  configured: boolean;
};

export type AiSettingsView = {
  configured: boolean;
  provider: 'anthropic' | 'openai' | 'openrouter';
  model: string;
  enabled: boolean;
  autoDraftEnabled: boolean;
  redactIdentifiers: boolean;
  firstResponseMinutes: number;
  monthlyTokenBudget: number;
  hasApiKey: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
  usageThisMonth: number;
};

export type AiReplyDraftView = {
  id: string;
  leadId: string;
  leadName: string;
  body: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  source: LeadSource;
};
