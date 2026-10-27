import { and, eq, sql } from 'drizzle-orm';
import type { AiRecommendation, RecommendationType } from '../../../data/ai';
import { deriveCalendarEvents } from '../../../store/selectors';
import { db } from '../../db/client';
import {
  aiProviderSettings,
  conversations,
  messageAnalyses,
  projects,
  recommendations,
} from '../../db/schema';
import { loadCrmSnapshot } from '../crm/load';
import {
  deriveOperationalRecommendations,
  type AnalysisFact,
  type ProjectFact,
} from './facts';

export type StoredRecommendation = typeof recommendations.$inferSelect;

function hrefFor(type: RecommendationType, leadId: string | null, clientId: string | null, evidenceId: string) {
  if (type === 'invoice_overdue') return `/invoices/${evidenceId}/edit`;
  if (type === 'proposal_expiring') return `/proposals/${evidenceId}/edit`;
  if (type === 'meeting_today') return '/calendar';
  if (leadId) return `/ai/contacts/${leadId}`;
  if (clientId) return `/clients/${clientId}`;
  return '/ai';
}

export async function syncRecommendations(workspaceId: string, now = new Date()): Promise<void> {
  const snapshot = await loadCrmSnapshot(workspaceId);
  const [conversationRows, projectRows, analysisRows, settingRows] = await Promise.all([
    db
      .select({
        id: conversations.id,
        leadId: conversations.leadId,
        lastReadAt: conversations.lastReadAt,
      })
      .from(conversations)
      .where(eq(conversations.workspaceId, workspaceId)),
    db.select().from(projects).where(eq(projects.workspaceId, workspaceId)),
    db
      .select({
        messageId: messageAnalyses.messageId,
        intent: messageAnalyses.intent,
        urgency: messageAnalyses.urgency,
        needsReply: messageAnalyses.needsReply,
        confidence: messageAnalyses.confidence,
      })
      .from(messageAnalyses)
      .where(eq(messageAnalyses.workspaceId, workspaceId)),
    db
      .select({ firstResponseMinutes: aiProviderSettings.firstResponseMinutes })
      .from(aiProviderSettings)
      .where(eq(aiProviderSettings.workspaceId, workspaceId))
      .limit(1),
  ]);

  const analyses = new Map<string, AnalysisFact>(
    analysisRows.map((analysis) => [
      analysis.messageId,
      {
        intent: analysis.intent,
        urgency: analysis.urgency,
        needsReply: analysis.needsReply,
        confidence: analysis.confidence,
      },
    ]),
  );
  const projectFacts: ProjectFact[] = projectRows.map((project) => ({
    id: project.id,
    workspaceId: project.workspaceId,
    clientId: project.clientId,
    leadId: project.leadId,
    proposalId: project.proposalId,
    title: project.title,
    status: project.status,
    startsAt: project.startsAt,
    dueAt: project.dueAt,
  }));
  const derived = deriveOperationalRecommendations({
    now,
    leads: snapshot.leads,
    clients: snapshot.clients,
    messages: snapshot.messages,
    conversations: conversationRows.map((conversation) => ({
      id: conversation.id,
      leadId: conversation.leadId,
      lastReadAt: conversation.lastReadAt?.toISOString() ?? null,
    })),
    proposals: snapshot.proposals,
    invoices: snapshot.invoices,
    payments: snapshot.payments,
    projects: projectFacts,
    events: deriveCalendarEvents({
      leads: snapshot.leads,
      proposals: snapshot.proposals,
      invoices: snapshot.invoices,
      payments: snapshot.payments,
      manualEvents: snapshot.events,
    }),
    analyses,
    reportingCurrency: snapshot.reportingCurrency,
    firstResponseMinutes: settingRows[0]?.firstResponseMinutes ?? 60,
  });

  const existingByFingerprint = new Map<string, StoredRecommendation>();
  const activeFingerprints = new Set(derived.map((candidate) => candidate.fingerprint));

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    const existingRows = await tx
      .select()
      .from(recommendations)
      .where(eq(recommendations.workspaceId, workspaceId));
    for (const row of existingRows) existingByFingerprint.set(row.fingerprint, row);

    for (const candidate of derived) {
      const existing = existingByFingerprint.get(candidate.fingerprint);
      const base = {
        leadId: candidate.leadId,
        clientId: candidate.clientId,
        type: candidate.type,
        title: candidate.title,
        explanation: candidate.explanation,
        priority: candidate.priority,
        score: candidate.score,
        scoreFactors: candidate.scoreFactors,
        evidence: candidate.evidence,
        dueAt: candidate.dueAt,
        generatedAt: now,
      };
      if (existing) {
        const snoozeExpired =
          existing.state === 'snoozed' &&
          existing.snoozeUntil !== null &&
          existing.snoozeUntil.getTime() <= now.getTime();
        const reopened = existing.state === 'resolved';
        await tx
          .update(recommendations)
          .set({
            ...base,
            state: snoozeExpired || reopened ? 'open' : existing.state,
            snoozeUntil: snoozeExpired ? null : existing.snoozeUntil,
            resolvedAt: snoozeExpired || reopened ? null : existing.resolvedAt,
          })
          .where(
            and(
              eq(recommendations.id, existing.id),
              eq(recommendations.workspaceId, workspaceId),
            ),
          );
      } else {
        await tx.insert(recommendations).values({
          id: `rec-${candidate.fingerprint.slice(0, 24)}`,
          workspaceId,
          fingerprint: candidate.fingerprint,
          state: 'open',
          ...base,
        });
      }
    }

    const staleOpen = existingRows.filter(
      (row) => row.state === 'open' && !activeFingerprints.has(row.fingerprint),
    );
    for (const row of staleOpen) {
      await tx
        .update(recommendations)
        .set({ state: 'resolved', resolvedAt: now, generatedAt: now })
        .where(and(eq(recommendations.id, row.id), eq(recommendations.workspaceId, workspaceId)));
    }

    // Time-sensitive scores are recalculated whenever the dashboard is opened.
    if (staleOpen.length === 0) {
      await tx
        .update(recommendations)
        .set({ generatedAt: now })
        .where(
          and(
            eq(recommendations.workspaceId, workspaceId),
            eq(recommendations.state, 'open'),
          ),
        );
    }
  });
}

export async function loadOpenRecommendations(
  workspaceId: string,
  leads: { id: string; name: string; source: 'meta' | 'whatsapp' }[],
  now = new Date(),
): Promise<AiRecommendation[]> {
  const rows = await db
    .select()
    .from(recommendations)
    .where(
      and(
        eq(recommendations.workspaceId, workspaceId),
        eq(recommendations.state, 'open'),
        sql`(${recommendations.snoozeUntil} is null or ${recommendations.snoozeUntil} <= ${now})`,
      ),
    );
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));

  return rows
    .map((row): AiRecommendation => {
      const lead = row.leadId ? leadById.get(row.leadId) : undefined;
      const evidence = row.evidence as AiRecommendation['evidence'];
      const firstEvidence = evidence[0];
      return {
        id: row.id,
        type: row.type as RecommendationType,
        priority: row.priority as AiRecommendation['priority'],
        score: row.score,
        scoreFactors: row.scoreFactors,
        title: row.title,
        explanation: row.explanation,
        quote: firstEvidence?.quote ?? row.explanation,
        ageLabel: null,
        source: lead?.source ?? null,
        leadId: row.leadId,
        clientId: row.clientId,
        leadName: lead?.name ?? 'Client',
        dueAt: row.dueAt?.toISOString() ?? null,
        href: hrefFor(row.type as RecommendationType, row.leadId, row.clientId, firstEvidence?.id ?? ''),
        evidence,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999');
    });
}

export async function setRecommendationState(
  workspaceId: string,
  recommendationId: string,
  action: 'snooze' | 'dismiss' | 'reopen',
  hours = 24,
) {
  const now = new Date();
  const state = action === 'dismiss' ? 'dismissed' : action === 'reopen' ? 'open' : 'snoozed';
  const snoozeUntil =
    action === 'snooze'
      ? new Date(now.getTime() + Math.min(168, Math.max(1, hours)) * 3_600_000)
      : null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    const [updated] = await tx
      .update(recommendations)
      .set({
        state,
        snoozeUntil,
        resolvedAt: null,
        generatedAt: now,
      })
      .where(
        and(
          eq(recommendations.id, recommendationId),
          eq(recommendations.workspaceId, workspaceId),
        ),
      )
      .returning({ id: recommendations.id });
    return updated ?? null;
  });
}
