import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { convertMinor, SAMPLE_RATES } from '../../../data/currencies';
import type {
  AiContactDetail,
  AiDashboard,
  AiRecommendation,
  EvidenceRef,
} from '../../../data/ai';
import { deriveCalendarEvents, invoiceBalanceMinor } from '../../../store/selectors';
import { db } from '../../db/client';
import {
  aiAnalysisRuns,
  contactBriefs,
  conversations,
  messageAnalyses,
  projects,
  replyDrafts,
} from '../../db/schema';
import { loadCrmSnapshot } from '../crm/load';
import { conversationFact, formatDelay } from './facts';
import {
  loadOpenRecommendations,
  syncRecommendations,
} from './recommendations';
import { getAiSettingsView } from './settings';

const eventTypeLabels: Record<string, string> = {
  follow_up: 'Follow-up',
  meeting: 'Meeting',
  proposal_expiry: 'Proposal expiry',
  payment_due: 'Payment due',
};

function sameLocalDay(value: string | Date, now: Date) {
  return new Date(value).toDateString() === now.toDateString();
}

function withAgeLabel(recommendation: AiRecommendation, now: Date): AiRecommendation {
  if (!recommendation.dueAt) return recommendation;
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(recommendation.dueAt).getTime()) / 60_000),
  );
  if (recommendation.type === 'first_reply' || recommendation.type === 'reply_needed') {
    return { ...recommendation, ageLabel: `Waiting ${formatDelay(minutes)}` };
  }
  if (recommendation.type === 'follow_up_due') {
    return { ...recommendation, ageLabel: `Due ${formatDelay(minutes)} ago` };
  }
  if (recommendation.type === 'project_overdue' || recommendation.type === 'invoice_overdue') {
    const days = Math.max(1, Math.floor(minutes / 1_440));
    return { ...recommendation, ageLabel: `${days}d overdue` };
  }
  if (recommendation.type === 'proposal_expiring') {
    return minutes > 0
      ? { ...recommendation, ageLabel: 'Expired' }
      : { ...recommendation, ageLabel: `Due in ${formatDelay(Math.abs(minutes))}` };
  }
  return recommendation;
}

export async function loadAiDashboard(
  workspaceId: string,
  now = new Date(),
): Promise<AiDashboard> {
  await syncRecommendations(workspaceId, now);
  const snapshot = await loadCrmSnapshot(workspaceId);
  const [conversationRows, projectRows, settingView, analysisStats, failedStats, pendingStats] =
    await Promise.all([
      db
        .select()
        .from(conversations)
        .where(eq(conversations.workspaceId, workspaceId)),
      db.select().from(projects).where(eq(projects.workspaceId, workspaceId)),
      getAiSettingsView(workspaceId),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(messageAnalyses)
        .where(eq(messageAnalyses.workspaceId, workspaceId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(aiAnalysisRuns)
        .where(
          and(
            eq(aiAnalysisRuns.workspaceId, workspaceId),
            eq(aiAnalysisRuns.state, 'failed'),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(aiAnalysisRuns)
        .where(
          and(
            eq(aiAnalysisRuns.workspaceId, workspaceId),
            inArray(aiAnalysisRuns.state, ['queued', 'running']),
          ),
        ),
    ]);

  const facts = conversationRows.map((conversation) =>
    conversationFact({
      leadId: conversation.leadId,
      conversationId: conversation.id,
      messages: snapshot.messages.filter((message) => message.leadId === conversation.leadId),
      lastReadAt: conversation.lastReadAt?.toISOString() ?? null,
      now,
    }),
  );
  const recommendations = (await loadOpenRecommendations(workspaceId, snapshot.leads, now))
    .map((recommendation) => withAgeLabel(recommendation, now));
  const leadById = new Map(snapshot.leads.map((lead) => [lead.id, lead]));
  const overdueInvoices = snapshot.invoices.filter(
    (invoice) =>
      invoice.status === 'sent' &&
      invoiceBalanceMinor(invoice, snapshot.payments) > 0 &&
      new Date(invoice.dueAt) < now,
  );
  const overdueLeadIds = new Set(
    overdueInvoices.flatMap((invoice) => (invoice.leadId ? [invoice.leadId] : [])),
  );
  let atRiskMinor = overdueInvoices.reduce(
    (total, invoice) =>
      total +
      convertMinor(
        invoiceBalanceMinor(invoice, snapshot.payments),
        invoice.currency,
        snapshot.reportingCurrency,
        SAMPLE_RATES,
      ),
    0,
  );
  const overdueProjects = projectRows.filter(
    (project) => project.status === 'active' && project.dueAt < now,
  );
  for (const project of overdueProjects) {
    if (!project.leadId || overdueLeadIds.has(project.leadId)) continue;
    const lead = leadById.get(project.leadId);
    if (!lead) continue;
    atRiskMinor += convertMinor(
      lead.valueMinor,
      lead.currency,
      snapshot.reportingCurrency,
      SAMPLE_RATES,
    );
  }

  const derivedEvents = deriveCalendarEvents({
    leads: snapshot.leads,
    proposals: snapshot.proposals,
    invoices: snapshot.invoices,
    payments: snapshot.payments,
    manualEvents: snapshot.events,
  });
  const today = [
    ...derivedEvents
      .filter((event) => sameLocalDay(event.startsAt, now))
      .map((event) => {
        const lead = event.leadId ? leadById.get(event.leadId) : undefined;
        return {
          id: event.id,
          startsAt: new Date(event.startsAt),
          time: new Date(event.startsAt).toLocaleTimeString('en-IN', {
            hour: 'numeric',
            minute: '2-digit',
          }),
          title: event.title,
          meta: [lead?.name, eventTypeLabels[event.type] ?? event.type]
            .filter(Boolean)
            .join(' · '),
          href: event.href ?? (event.leadId ? `/ai/contacts/${event.leadId}` : '/calendar'),
        };
      }),
    ...projectRows
      .filter((project) => sameLocalDay(project.dueAt, now))
      .map((project) => ({
        id: `project-due-${project.id}`,
        startsAt: project.dueAt,
        time: project.dueAt.toLocaleTimeString('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
        }),
        title: `${project.title} due`,
        meta: [leadById.get(project.leadId ?? '')?.name, 'Project deadline']
          .filter(Boolean)
          .join(' · '),
        href: project.leadId ? `/ai/contacts/${project.leadId}` : '/ai',
      })),
  ]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      time: item.time,
      title: item.title,
      meta: item.meta,
      href: item.href,
    }));

  const top = recommendations.slice(0, 2);
  const briefing =
    top.length === 0
      ? 'Nothing urgent is waiting. Keep the workspace moving.'
      : `Start with ${top[0].leadName}. ${top[0].explanation}.${
          top[1] ? ` Then ${top[1].leadName}. ${top[1].explanation}.` : ''
        }`;

  return {
    generatedAt: now.toISOString(),
    analysis: {
      configured: settingView.hasApiKey && settingView.enabled,
      enabled: settingView.enabled,
      provider: settingView.hasApiKey ? settingView.provider : null,
      model: settingView.hasApiKey ? settingView.model : null,
      analyzed: Number(analysisStats[0]?.count ?? 0),
      total: snapshot.messages.length,
      failed: Number(failedStats[0]?.count ?? 0),
      pending: Number(pendingStats[0]?.count ?? 0),
    },
    metrics: {
      needsAttention: recommendations.filter(
        (item) => item.priority === 'high' || item.priority === 'secondary',
      ).length,
      unreadMessages: facts.reduce((total, fact) => total + fact.unread, 0),
      repliesWaiting: facts.filter((fact) => fact.awaitingReply).length,
      atRiskMinor,
      reportingCurrency: snapshot.reportingCurrency,
    },
    recommendations,
    today,
    signals: {
      proposalFollowUps: recommendations.filter((item) => item.type === 'proposal_expiring').length,
      overdueInvoices: overdueInvoices.length,
      projectRisks: overdueProjects.length,
    },
    briefing,
  };
}

export async function loadAiContact(
  workspaceId: string,
  leadId: string,
  now = new Date(),
): Promise<AiContactDetail> {
  await syncRecommendations(workspaceId, now);
  const snapshot = await loadCrmSnapshot(workspaceId);
  const lead = snapshot.leads.find((item) => item.id === leadId);
  if (!lead) throw new Error('Lead not found in this workspace');
  const [conversationRows, projectRows, analysisRows, briefRows, draftRows, settingView] =
    await Promise.all([
      db
        .select()
        .from(conversations)
        .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.leadId, leadId)))
        .limit(1),
      db.select().from(projects).where(eq(projects.workspaceId, workspaceId)),
      db
        .select()
        .from(messageAnalyses)
        .where(and(eq(messageAnalyses.workspaceId, workspaceId), eq(messageAnalyses.leadId, leadId)))
        .orderBy(desc(messageAnalyses.analyzedAt)),
      db
        .select()
        .from(contactBriefs)
        .where(and(eq(contactBriefs.workspaceId, workspaceId), eq(contactBriefs.leadId, leadId)))
        .limit(1),
      db
        .select()
        .from(replyDrafts)
        .where(and(eq(replyDrafts.workspaceId, workspaceId), eq(replyDrafts.leadId, leadId)))
        .orderBy(desc(replyDrafts.updatedAt)),
      getAiSettingsView(workspaceId),
    ]);
  const conversation = conversationRows[0] ?? null;
  const messages = snapshot.messages
    .filter((message) => message.leadId === leadId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const fact = conversationFact({
    leadId,
    conversationId: conversation?.id ?? null,
    messages,
    lastReadAt: conversation?.lastReadAt?.toISOString() ?? null,
    now,
  });
  const recommendations = (
    await loadOpenRecommendations(workspaceId, snapshot.leads, now)
  ).filter(
    (recommendation) =>
      recommendation.leadId === leadId ||
      (lead.clientId !== undefined && recommendation.clientId === lead.clientId),
  );
  const latestDraft = draftRows.find((draft) =>
    ['draft', 'edited', 'approved'].includes(draft.state),
  );
  const latestInbound = messages
    .filter((message) => message.direction === 'inbound')
    .at(-1);
  const draftTrigger = latestDraft?.triggeringMessageId
    ? messages.find((message) => message.id === latestDraft.triggeringMessageId)
    : undefined;
  const draftStale = Boolean(
    latestInbound &&
      draftTrigger &&
      new Date(latestInbound.sentAt).getTime() > new Date(draftTrigger.sentAt).getTime(),
  );
  const brief = briefRows[0] ?? null;

  return {
    lead: {
      id: lead.id,
      name: lead.name,
      company: lead.company,
      phone: lead.phone,
      email: lead.email,
      city: lead.city,
      source: lead.source,
      status: lead.status,
      valueMinor: lead.valueMinor,
      currency: lead.currency,
      followUpAt: lead.followUpAt ?? null,
      clientId: lead.clientId ?? null,
    },
    delayedReply:
      fact.awaitingReply && fact.lastInboundAt
        ? { since: fact.lastInboundAt.toISOString(), minutes: fact.delayMinutes }
        : null,
    unread: fact.unread,
    recommendations: recommendations.map((recommendation) => withAgeLabel(recommendation, now)),
    analyses: analysisRows.map((analysis) => ({
      messageId: analysis.messageId,
      summary: analysis.summary,
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      urgency: analysis.urgency,
      needsReply: analysis.needsReply,
      requestedActions: analysis.requestedActions,
      commitments: analysis.commitments,
      confidence: analysis.confidence,
    })),
    brief: brief
      ? {
          summary: brief.summary,
          businessState: brief.businessState,
          openLoops: brief.openLoops,
          risks: brief.risks,
          nextBestAction: brief.nextBestAction,
          generatedAt: brief.generatedAt.toISOString(),
        }
      : null,
    messages: messages.slice(-80).map((message) => ({
      id: message.id,
      direction: message.direction,
      body: message.body,
      sentAt: message.sentAt,
    })),
    projects: projectRows
      .filter(
        (project) =>
          project.leadId === leadId ||
          (lead.clientId !== undefined && project.clientId === lead.clientId),
      )
      .map((project) => ({
        id: project.id,
        title: project.title,
        status: project.status,
        startsAt: project.startsAt?.toISOString() ?? null,
        dueAt: project.dueAt.toISOString(),
        overdue: project.status === 'active' && project.dueAt < now,
      })),
    draft: latestDraft
      ? {
          id: latestDraft.id,
          body: latestDraft.body,
          state: latestDraft.state,
          stale: draftStale,
          evidence: latestDraft.evidence.map((item) => ({
            kind: item.entityType as EvidenceRef['kind'],
            id: item.entityId ?? item.messageId ?? '',
            label: item.entityType,
            quote: item.quote,
          })),
          missingInfoQuestions: latestDraft.missingInfoQuestions,
          generatedAt: latestDraft.generatedAt.toISOString(),
        }
      : null,
    configured: settingView.hasApiKey && settingView.enabled,
  };
}
