import { useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, CircleDollarSign, Plus, Sparkles, UsersRound } from 'lucide-react';
import { Link, useNavigate } from '../../lib/router';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Currency } from '../../data/types';
import { DEMO_NOW } from '../../data/demo';
import { CURRENCY_SYMBOLS, formatMoney, formatMoneyCompact, SAMPLE_RATES } from '../../data/currencies';
import { formatDate, formatFollowUp, LEAD_STATUS_LABELS } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import {
  financeSummary,
  monthlyRevenueSeries,
  pipelineSummary,
} from '../../store/selectors';
import { PageHeader } from '../../components/layout/PageHeader';
import { MetricCard } from '../../components/ui/MetricCard';
import { StatusPill, SourceBadge } from '../../components/ui/Badges';
import { Avatar } from '../../components/ui/Avatar';
import { LeadDialog } from '../leads/LeadDialog';

const chartTooltip = ({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: readonly { value?: unknown }[];
  label?: string;
  currency: Currency;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <span>{label}</span>
      <strong>{formatMoney(Number(payload[0].value ?? 0), currency)}</strong>
    </div>
  );
};

export function OverviewPage() {
  const [leadOpen, setLeadOpen] = useState(false);
  const navigate = useNavigate();
  const leads = useCrmStore((state) => state.leads);
  const invoices = useCrmStore((state) => state.invoices);
  const payments = useCrmStore((state) => state.payments);
  const reportingCurrency = useCrmStore((state) => state.reportingCurrency);

  const pipeline = useMemo(
    () => pipelineSummary(leads, reportingCurrency),
    [leads, reportingCurrency],
  );
  const finance = useMemo(
    () =>
      financeSummary({
        invoices,
        payments,
        reportingCurrency,
        rates: SAMPLE_RATES,
        now: DEMO_NOW,
      }),
    [invoices, payments, reportingCurrency],
  );
  const chartData = useMemo(
    () => monthlyRevenueSeries(payments, reportingCurrency, SAMPLE_RATES, DEMO_NOW),
    [payments, reportingCurrency],
  );
  const recentLeads = useMemo(
    () =>
      [...leads]
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
        .slice(0, 5),
    [leads],
  );
  const followUps = useMemo(
    () =>
      leads
        .filter((lead) => lead.followUpAt && lead.status !== 'paid')
        .sort((a, b) => (a.followUpAt ?? '').localeCompare(b.followUpAt ?? ''))
        .slice(0, 4),
    [leads],
  );

  const newLeads = leads.filter((lead) => lead.status === 'new').length;
  const activeLeads = leads.filter((lead) => lead.status !== 'paid').length;
  const monthGrowth =
    finance.previousMonthMinor > 0
      ? Math.round(
          ((finance.receivedThisMonthMinor - finance.previousMonthMinor) /
            finance.previousMonthMinor) *
            100,
        )
      : 0;

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="01 / Overview"
        title="Good morning, Sayan"
        description={`${formatDate(DEMO_NOW, 'EEEE, d MMMM')} · A clear view of what needs your attention.`}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setLeadOpen(true)}>
            <Plus size={16} />
            New lead
          </button>
        }
      />

      <section className="metric-grid" aria-label="Key performance indicators">
        <MetricCard
          label="New leads"
          value={String(newLeads)}
          detail="waiting for first reply"
          icon={Sparkles}
        />
        <MetricCard
          label="Active pipeline"
          value={String(activeLeads)}
          detail={`${formatMoneyCompact(
            pipeline.reduce((total, column) => total + column.valueMinor, 0),
            reportingCurrency,
          )} in motion`}
          icon={UsersRound}
        />
        <MetricCard
          label="Received this month"
          value={formatMoney(finance.receivedThisMonthMinor, reportingCurrency)}
          detail="vs. last month"
          icon={CircleDollarSign}
          trend={{
            value: `${monthGrowth >= 0 ? '+' : ''}${monthGrowth}%`,
            direction: monthGrowth >= 0 ? 'up' : 'down',
            good: monthGrowth >= 0,
          }}
        />
        <MetricCard
          label="Outstanding"
          value={formatMoney(finance.outstandingMinor, reportingCurrency)}
          detail={`${finance.overdueCount} invoices overdue`}
          icon={CalendarClock}
        />
      </section>

      <section className="dashboard-main-grid">
        <article className="card section-card pipeline-snapshot">
          <div className="section-head">
            <div>
              <h2>Pipeline overview</h2>
              <p>Where every conversation stands today.</p>
            </div>
            <Link to="/pipeline" className="text-link">
              View pipeline <ArrowRight size={14} />
            </Link>
          </div>
          <div className="pipeline-summary-row">
            {pipeline.map((column, index) => (
              <Link key={column.status} to="/pipeline" className="pipeline-summary-step">
                <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
                <strong>{column.count}</strong>
                <span>{column.label}</span>
                <small>{formatMoneyCompact(column.valueMinor, reportingCurrency)}</small>
              </Link>
            ))}
          </div>
        </article>

        <article className="card section-card revenue-snapshot">
          <div className="section-head">
            <div>
              <h2>Received revenue</h2>
              <p>Payments recorded, not invoices issued.</p>
            </div>
            <Link to="/finance" className="text-link">
              Finance <ArrowRight size={14} />
            </Link>
          </div>
          <div className="chart-total">
            <strong>{formatMoney(finance.receivedThisMonthMinor, reportingCurrency)}</strong>
            <span>this month</span>
          </div>
          <div className="mini-chart" role="img" aria-label="Six month revenue chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#efefec" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#6e716b', fontSize: 11 }}
                />
                <YAxis
                  width={42}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#6e716b', fontSize: 10 }}
                  tickFormatter={(value: number) =>
                    `${CURRENCY_SYMBOLS[reportingCurrency]}${Math.round(value / 100_000)}k`
                  }
                />
                <Tooltip
                  cursor={{ stroke: '#bfc1bd', strokeDasharray: '3 3' }}
                  content={(props) =>
                    chartTooltip({
                      active: props.active,
                      payload: props.payload,
                      label: String(props.label ?? ''),
                      currency: reportingCurrency,
                    })
                  }
                />
                <Line
                  type="monotone"
                  dataKey="valueMinor"
                  isAnimationActive={false}
                  stroke="#171816"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#171816', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#171816', strokeWidth: 3, stroke: '#fff' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="dashboard-lower-grid">
        <article className="card section-card recent-leads-card">
          <div className="section-head">
            <div>
              <h2>Recent conversations</h2>
              <p>Latest activity across Meta and WhatsApp.</p>
            </div>
            <Link to="/inbox" className="text-link">
              Open inbox <ArrowRight size={14} />
            </Link>
          </div>
          <div className="recent-leads-list">
            {recentLeads.map((lead) => (
              <button
                type="button"
                className="recent-lead-row"
                key={lead.id}
                onClick={() => navigate(`/leads/${lead.id}`)}
              >
                <Avatar name={lead.name} />
                <span className="recent-lead-main">
                  <strong>{lead.name}</strong>
                  <small>{lead.initialMessage}</small>
                </span>
                <span className="recent-lead-source">
                  <SourceBadge source={lead.source} />
                </span>
                <StatusPill status={lead.status} />
                <span className="recent-lead-time">{formatFollowUp(lead.lastActivityAt)}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="card section-card follow-up-card">
          <div className="section-head">
            <div>
              <h2>Up next</h2>
              <p>Follow-ups you have committed to.</p>
            </div>
            <Link to="/calendar" className="text-link">
              Calendar <ArrowRight size={14} />
            </Link>
          </div>
          <div className="follow-up-list">
            {followUps.length === 0 ? (
              <p className="muted-copy">You are all caught up.</p>
            ) : (
              followUps.map((lead) => (
                <Link to={`/leads/${lead.id}`} className="follow-up-row" key={lead.id}>
                  <span className="follow-up-date">
                    <strong>{lead.followUpAt ? formatDate(lead.followUpAt, 'd') : '—'}</strong>
                    <span>{lead.followUpAt ? formatDate(lead.followUpAt, 'MMM') : ''}</span>
                  </span>
                  <span className="follow-up-copy">
                    <strong>{lead.name}</strong>
                    <small>
                      {LEAD_STATUS_LABELS[lead.status]} · {lead.company}
                    </small>
                  </span>
                  <span className="follow-up-time">
                    {lead.followUpAt ? formatDate(lead.followUpAt, 'h:mm a') : ''}
                  </span>
                </Link>
              ))
            )}
          </div>
        </article>
      </section>

      <LeadDialog open={leadOpen} onOpenChange={setLeadOpen} />
    </div>
  );
}
