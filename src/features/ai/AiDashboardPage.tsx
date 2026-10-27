'use client';

import {
  ArrowUpRight,
  CalendarClock,
  Inbox,
  MessageSquareReply,
  Quote,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AiDashboard, AiPriority, AiRecommendation } from '../../data/ai';
import { formatMoneyCompact } from '../../data/currencies';
import { Link } from '../../lib/router';
import { PageHeader } from '../../components/layout/PageHeader';
import { MetricCard } from '../../components/ui/MetricCard';
import { Avatar } from '../../components/ui/Avatar';
import { SourceBadge } from '../../components/ui/Badges';

type Tab = 'all' | 'replies' | 'followups' | 'risks';

const priorityLabels: Record<AiPriority, string> = {
  high: 'High priority',
  secondary: 'Secondary',
  normal: 'Routine',
};

const typeLabels: Record<AiRecommendation['type'], string> = {
  first_reply: 'New enquiry',
  reply_needed: 'Reply needed',
  proposal_expiring: 'Proposal',
  invoice_overdue: 'Payment risk',
  follow_up_due: 'Follow-up',
  project_overdue: 'Project risk',
  meeting_today: 'Today',
};

function matchesTab(recommendation: AiRecommendation, tab: Tab) {
  if (tab === 'all') return true;
  if (tab === 'replies') {
    return recommendation.type === 'first_reply' || recommendation.type === 'reply_needed';
  }
  if (tab === 'followups') {
    return recommendation.type === 'follow_up_due' || recommendation.type === 'proposal_expiring';
  }
  return recommendation.type === 'invoice_overdue' || recommendation.type === 'project_overdue';
}

function RecommendationRow({ recommendation }: { recommendation: AiRecommendation }) {
  return (
    <Link className="ai-rec-row" to={recommendation.href}>
      <Avatar name={recommendation.leadName} />
      <span className="ai-rec-main">
        <span className="ai-rec-kicker">
          {typeLabels[recommendation.type]}
          {recommendation.ageLabel ? <span className="ai-rec-age">{recommendation.ageLabel}</span> : null}
        </span>
        <strong>{recommendation.title}</strong>
        <small>{recommendation.explanation}</small>
      </span>
      <span className="ai-rec-quote">
        <Quote size={12} aria-hidden="true" />
        <span>{recommendation.quote}</span>
      </span>
      <span className={`ai-priority-tag ai-priority-${recommendation.priority}`}>
        <span aria-hidden="true" />
        {priorityLabels[recommendation.priority]}
      </span>
      <span className="ai-rec-source">
        {recommendation.source ? <SourceBadge source={recommendation.source} /> : null}
        <span className="ai-rec-score">{recommendation.score}</span>
      </span>
      <ArrowUpRight className="ai-rec-arrow" size={15} aria-hidden="true" />
    </Link>
  );
}

export function AiDashboardPage() {
  const [dashboard, setDashboard] = useState<AiDashboard | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/ai/dashboard', { cache: 'no-store' });
      const payload = (await response.json().catch(() => null)) as
        | (AiDashboard & { error?: string })
        | null;
      if (!response.ok) throw new Error(payload?.error ?? 'The AI dashboard could not be loaded');
      setDashboard(payload);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The AI dashboard could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const events = new EventSource('/api/events');
    events.onmessage = () => void load(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 60_000);
    return () => {
      events.close();
      window.clearInterval(timer);
    };
  }, [load]);

  const visible = useMemo(
    () => dashboard?.recommendations.filter((item) => matchesTab(item, tab)) ?? [],
    [dashboard, tab],
  );

  if (loading && !dashboard) {
    return (
      <div className="page ai-page">
        <div className="route-loading" role="status">
          <span className="route-loading-mark" aria-hidden="true" />
          Preparing your priorities
        </div>
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="page ai-page">
        <div className="ai-error" role="alert">
          <TriangleAlert size={18} />
          <p>{error}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!dashboard) return null;
  const freshness = dashboard.analysis.configured
    ? dashboard.analysis.analyzed < dashboard.analysis.total || dashboard.analysis.pending > 0
      ? `${dashboard.analysis.analyzed} of ${dashboard.analysis.total} messages analyzed`
      : `Analysis up to date${
          dashboard.analysis.failed
            ? ` · ${dashboard.analysis.failed} failed ${
                dashboard.analysis.failed === 1 ? 'run' : 'runs'
              }`
            : ''
        }`
    : 'AI provider not connected';

  const counts = {
    all: dashboard.recommendations.length,
    replies: dashboard.recommendations.filter((item) => matchesTab(item, 'replies')).length,
    followups: dashboard.recommendations.filter((item) => matchesTab(item, 'followups')).length,
    risks: dashboard.recommendations.filter((item) => matchesTab(item, 'risks')).length,
  };

  return (
    <div className="page ai-page">
      <PageHeader
        eyebrow="02 / AI assistant"
        title="Your day, prioritized"
        description="Every conversation and commitment, ranked by what needs you now."
        actions={
          <>
            <span className="ai-freshness">
              <Sparkles size={13} aria-hidden="true" />
              {freshness}
            </span>
            <Link to="/ai/replies" className="btn btn-primary">
              Review replies
            </Link>
          </>
        }
      />

      {!dashboard.analysis.configured ? (
        <section className="ai-notice" aria-label="AI provider setup">
          <span className="ai-notice-icon"><Sparkles size={16} /></span>
          <div>
            <strong>Priorities are live. Message understanding needs a provider.</strong>
            <p>
              Unread, reply delays, invoices, proposals, project deadlines, and today’s work are
              calculated from your CRM now. Connect Claude, OpenAI, or OpenRouter for message
              analysis and reply drafts.
            </p>
          </div>
          <Link to="/settings/ai" className="btn btn-secondary">Connect AI provider</Link>
        </section>
      ) : null}

      <section className="metric-grid" aria-label="AI workspace summary">
        <MetricCard
          label="Needs attention"
          value={String(dashboard.metrics.needsAttention)}
          detail="high and secondary"
          icon={TriangleAlert}
        />
        <MetricCard
          label="Unread messages"
          value={String(dashboard.metrics.unreadMessages)}
          detail="across conversations"
          icon={Inbox}
        />
        <MetricCard
          label="Replies waiting"
          value={String(dashboard.metrics.repliesWaiting)}
          detail="no sent reply yet"
          icon={MessageSquareReply}
        />
        <MetricCard
          label="At risk"
          value={formatMoneyCompact(dashboard.metrics.atRiskMinor, dashboard.metrics.reportingCurrency)}
          detail="overdue money and projects"
          icon={CalendarClock}
        />
      </section>

      <div className="ai-priority-grid">
        <section className="card ai-priority-card" aria-labelledby="ai-priority-title">
          <div className="ai-priority-head">
            <div>
              <h2 id="ai-priority-title">Priority queue</h2>
              <p>Evidence-linked work, highest impact first.</p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh priorities"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? 'spin' : undefined} />
            </button>
          </div>
          <div className="ai-filter-row" role="group" aria-label="Filter priority queue">
            {(
              [
                ['all', 'All'],
                ['replies', 'Replies'],
                ['followups', 'Follow-ups'],
                ['risks', 'Risks'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={tab === value ? 'active' : undefined}
                onClick={() => setTab(value)}
                aria-pressed={tab === value}
              >
                {label} <span>{counts[value]}</span>
              </button>
            ))}
          </div>

          <div className="ai-rec-list" role="list">
            {visible.map((recommendation) => (
              <div role="listitem" key={recommendation.id}>
                <RecommendationRow recommendation={recommendation} />
              </div>
            ))}
            {visible.length === 0 ? (
              <div className="ai-empty">
                <Sparkles size={18} />
                <strong>{dashboard.recommendations.length ? 'Nothing in this view.' : 'Nothing is waiting.'}</strong>
                <p>
                  {dashboard.recommendations.length
                    ? 'Choose another filter to see the rest of the queue.'
                    : 'New replies, deadlines, and payment risks will appear here.'}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="ai-side-column" aria-label="Today and signals">
          <section className="card section-card ai-side-card">
            <div className="section-head">
              <div>
                <h2>Today</h2>
                <p>{new Date(dashboard.generatedAt).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}</p>
              </div>
              <Link to="/calendar" className="text-link">Calendar</Link>
            </div>
            <div className="ai-today-list">
              {dashboard.today.map((item) => (
                <Link key={item.id} to={item.href} className="ai-today-item">
                  <time>{item.time}</time>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.meta}</small>
                  </span>
                </Link>
              ))}
              {dashboard.today.length === 0 ? <p className="muted-copy">No scheduled commitments today.</p> : null}
            </div>
          </section>

          <section className="card section-card ai-side-card">
            <div className="section-head">
              <div>
                <h2>Business signals</h2>
                <p>What the numbers say.</p>
              </div>
            </div>
            <div className="ai-signal-list">
              <div><span>Proposals needing follow-up</span><strong>{dashboard.signals.proposalFollowUps}</strong></div>
              <div><span>Overdue invoices</span><strong>{dashboard.signals.overdueInvoices}</strong></div>
              <div><span>Project deadlines passed</span><strong>{dashboard.signals.projectRisks}</strong></div>
            </div>
          </section>

          <section className="card section-card ai-side-card ai-briefing-card">
            <div className="section-head">
              <div>
                <h2>Briefing</h2>
                <p>Built from the same ranked evidence.</p>
              </div>
            </div>
            <p>{dashboard.briefing}</p>
            <Link to="/ai/replies" className="text-link">
              Open reply review <ArrowUpRight size={13} />
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
