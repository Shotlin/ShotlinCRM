import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarClock, CircleDollarSign, Info, Wallet } from 'lucide-react';
import { isSameMonth, parseISO } from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DEMO_NOW } from '../../data/demo';
import {
  convertMinor,
  CURRENCIES,
  CURRENCY_SYMBOLS,
  formatMoney,
  formatMoneyCompact,
  SAMPLE_RATES,
} from '../../data/currencies';
import type { Currency } from '../../data/types';
import { formatDate, PAYMENT_METHOD_LABELS } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { financeSummary, monthlyRevenueSeries } from '../../store/selectors';
import { PageHeader } from '../../components/layout/PageHeader';
import { MetricCard } from '../../components/ui/MetricCard';

export function FinancePage() {
  const invoices = useCrmStore((state) => state.invoices);
  const payments = useCrmStore((state) => state.payments);
  const clients = useCrmStore((state) => state.clients);
  const reportingCurrency = useCrmStore((state) => state.reportingCurrency);
  const setReportingCurrency = useCrmStore((state) => state.setReportingCurrency);

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
  const series = useMemo(
    () => monthlyRevenueSeries(payments, reportingCurrency, SAMPLE_RATES, DEMO_NOW),
    [payments, reportingCurrency],
  );
  const recentPayments = useMemo(
    () =>
      [...payments]
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        .slice(0, 6)
        .map((payment) => {
          const invoice = invoices.find((item) => item.id === payment.invoiceId);
          const client = clients.find((item) => item.id === invoice?.clientId);
          return { ...payment, invoice, client };
        }),
    [clients, invoices, payments],
  );
  const currencyBreakdown = useMemo(() => {
    const monthPayments = payments.filter((payment) =>
      isSameMonth(parseISO(payment.receivedAt), DEMO_NOW),
    );
    const grouped = CURRENCIES.map((currency) => {
      const currencyPayments = monthPayments.filter(
        (payment) => payment.currency === currency,
      );
      return {
        currency,
        originalMinor: currencyPayments.reduce(
          (total, payment) => total + payment.amountMinor,
          0,
        ),
        convertedMinor: currencyPayments.reduce(
          (total, payment) =>
            total +
            convertMinor(payment.amountMinor, payment.currency, reportingCurrency),
          0,
        ),
      };
    }).filter((item) => item.originalMinor > 0);
    const total = grouped.reduce((sum, item) => sum + item.convertedMinor, 0);
    return grouped.map((item) => ({
      ...item,
      share: total > 0 ? Math.round((item.convertedMinor / total) * 100) : 0,
    }));
  }, [payments, reportingCurrency]);

  const currentMonthLabel = series.at(-1)?.label ?? 'This month';
  const previousMonthValue = finance.previousMonthMinor;
  const monthGrowth =
    previousMonthValue > 0
      ? Math.round(
          ((finance.receivedThisMonthMinor - previousMonthValue) / previousMonthValue) * 100,
        )
      : 0;

  return (
    <div className="page finance-page">
      <PageHeader
        eyebrow="11 / Finance"
        title="Finance"
        description="Revenue, balance, and collections without accounting noise."
        actions={
          <>
            <label className="currency-selector">
              <span>Reporting currency</span>
              <select
                value={reportingCurrency}
                onChange={(event) => setReportingCurrency(event.target.value as Currency)}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency} — {currency === 'INR' ? 'Indian rupee' : currency === 'USD' ? 'US dollar' : currency === 'EUR' ? 'Euro' : 'British pound'}
                  </option>
                ))}
              </select>
            </label>
            <span className="fx-chip">
              <Info size={13} /> Sample FX
            </span>
          </>
        }
      />

      <section className="metric-grid">
        <MetricCard
          label="This month revenue"
          value={formatMoney(finance.receivedThisMonthMinor, reportingCurrency)}
          detail={`vs. ${formatMoney(previousMonthValue, reportingCurrency)} last month`}
          icon={CircleDollarSign}
          trend={{
            value: `${monthGrowth >= 0 ? '+' : ''}${monthGrowth}%`,
            direction: monthGrowth >= 0 ? 'up' : 'down',
            good: monthGrowth >= 0,
          }}
        />
        <MetricCard
          label="Last quarter revenue"
          value={formatMoney(finance.lastQuarterMinor, reportingCurrency)}
          detail="completed quarter, by receipt date"
          icon={Wallet}
        />
        <MetricCard
          label="Outstanding"
          value={formatMoney(finance.outstandingMinor, reportingCurrency)}
          detail={`${formatMoney(finance.overdueMinor, reportingCurrency)} overdue`}
          icon={CalendarClock}
        />
        <MetricCard
          label="Overdue"
          value={formatMoney(finance.overdueMinor, reportingCurrency)}
          detail={`${finance.overdueCount} invoices past due`}
          icon={ArrowDownRight}
        />
      </section>

      <div className="finance-main-grid">
        <section className="card section-card finance-chart-card">
          <div className="section-head">
            <div>
              <h2>Monthly received revenue</h2>
              <p>Recorded by payment date, never by invoice issue date.</p>
            </div>
            <span className="chart-legend">
              <span className="legend-dot" /> Received
            </span>
          </div>
          <div className="finance-chart" role="img" aria-label="Monthly received revenue chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
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
                  cursor={{ fill: '#f6f6f4' }}
                  content={(props) => {
                    if (!props.active || !props.payload?.length) return null;
                    return (
                      <div className="chart-tooltip">
                        <span>{props.label}</span>
                        <strong>
                          {formatMoney(Number(props.payload[0]?.value ?? 0), reportingCurrency)}
                        </strong>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="valueMinor"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={38}
                  isAnimationActive={false}
                >
                  {series.map((entry, index) => (
                    <Cell
                      key={entry.month}
                      fill={index === series.length - 1 ? '#171816' : '#dededa'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-foot">
            <span>{currentMonthLabel} is current</span>
            <span>{formatMoneyCompact(finance.receivedThisMonthMinor, reportingCurrency)} received</span>
          </div>
        </section>

        <section className="card section-card currency-card">
          <div className="section-head">
            <div>
              <h2>By original currency</h2>
              <p>This month&apos;s original receipts before conversion.</p>
            </div>
          </div>
          <div className="currency-breakdown">
            {currencyBreakdown.map((item) => (
              <div className="currency-row" key={item.currency}>
                <div className="currency-row-top">
                  <span className="currency-code">{item.currency}</span>
                  <strong>{formatMoney(item.originalMinor, item.currency)}</strong>
                  <small>{item.share}%</small>
                </div>
                <div className="currency-bar">
                  <span style={{ width: `${Math.max(2, item.share)}%` }} />
                </div>
              </div>
            ))}
            {currencyBreakdown.length === 0 ? (
              <p className="muted-copy">No payments received this month.</p>
            ) : null}
          </div>
          <p className="fx-note">
            Conversion uses fixed sample rates: 1 USD = ₹83 · 1 EUR = ₹90 · 1 GBP = ₹105.
          </p>
        </section>
      </div>

      <div className="finance-lower-grid">
        <section className="card section-card">
          <div className="section-head">
            <div>
              <h2>Recent payments</h2>
              <p>Latest money received across all invoices.</p>
            </div>
          </div>
          <div className="payment-feed">
            {recentPayments.map((payment) => (
              <div className="payment-feed-row" key={payment.id}>
                <span className="round-icon"><ArrowUpRight size={14} /></span>
                <div className="payment-feed-main">
                  <strong>{payment.client?.company ?? 'Unlinked client'}</strong>
                  <small>
                    {payment.invoice?.number ?? 'Invoice'} · {formatDate(payment.receivedAt)} ·{' '}
                    {PAYMENT_METHOD_LABELS[payment.method]}
                  </small>
                </div>
                <strong>{formatMoney(payment.amountMinor, payment.currency)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="card section-card comparison-card">
          <div className="section-head">
            <div>
              <h2>Period comparison</h2>
              <p>A quiet look at the revenue trend.</p>
            </div>
          </div>
          <div className="comparison-table">
            <div className="comparison-head">
              <span>Measure</span>
              <span>{currentMonthLabel}</span>
              <span>Previous</span>
              <span>Change</span>
            </div>
            <div className="comparison-row">
              <span>Received</span>
              <strong>{formatMoney(finance.receivedThisMonthMinor, reportingCurrency)}</strong>
              <span>{formatMoney(previousMonthValue, reportingCurrency)}</span>
              <span className={monthGrowth >= 0 ? 'positive-change' : 'negative-change'}>
                {monthGrowth >= 0 ? '+' : ''}{monthGrowth}%
              </span>
            </div>
            <div className="comparison-row">
              <span>Last quarter</span>
              <strong>{formatMoney(finance.lastQuarterMinor, reportingCurrency)}</strong>
              <span>—</span>
              <span className="muted-cell">—</span>
            </div>
            <div className="comparison-row">
              <span>Outstanding</span>
              <strong>{formatMoney(finance.outstandingMinor, reportingCurrency)}</strong>
              <span>{formatMoney(finance.overdueMinor, reportingCurrency)} overdue</span>
              <span className="muted-cell">Open</span>
            </div>
          </div>
          <p className="sample-label">All summary values are Sample FX conversions.</p>
        </section>
      </div>
    </div>
  );
}
