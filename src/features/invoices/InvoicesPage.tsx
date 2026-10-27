import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  Plus,
  ReceiptText,
  Search,
} from 'lucide-react';
import { Link, useNavigate } from '../../lib/router';
import { formatMoney } from '../../data/currencies';
import { DEMO_NOW } from '../../data/demo';
import type { InvoiceStatus } from '../../data/types';
import { formatDate, PAYMENT_METHOD_LABELS } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import {
  financeSummary,
  invoiceBalanceMinor,
  invoiceDisplayStatus,
  invoiceTotalMinor,
  type InvoiceDisplayStatus,
} from '../../store/selectors';
import { PageHeader } from '../../components/layout/PageHeader';
import { MetricCard } from '../../components/ui/MetricCard';
import { StatusPill } from '../../components/ui/Badges';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { PaymentDialog } from './PaymentDialog';

type PageTab = 'invoices' | 'payments';
type InvoiceFilter = 'all' | InvoiceStatus | InvoiceDisplayStatus;

export function InvoicesPage() {
  const [tab, setTab] = useState<PageTab>('invoices');
  const [filter, setFilter] = useState<InvoiceFilter>('all');
  const [query, setQuery] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | undefined>();
  const invoices = useCrmStore((state) => state.invoices);
  const payments = useCrmStore((state) => state.payments);
  const clients = useCrmStore((state) => state.clients);
  const reportingCurrency = useCrmStore((state) => state.reportingCurrency);
  const createInvoice = useCrmStore((state) => state.createInvoice);
  const flush = useCrmStore((state) => state.flush);
  const navigate = useNavigate();
  const { notify } = useToast();

  const finance = useMemo(
    () =>
      financeSummary({
        invoices,
        payments,
        reportingCurrency,
        rates: { INR: 1, USD: 83, EUR: 90, GBP: 105 },
        now: DEMO_NOW,
      }),
    [invoices, payments, reportingCurrency],
  );

  const invoiceRows = useMemo(
    () =>
      invoices.map((invoice) => ({
        ...invoice,
        client: clients.find((client) => client.id === invoice.clientId),
        totalMinor: invoiceTotalMinor(invoice),
        balanceMinor: invoiceBalanceMinor(invoice, payments),
        displayStatus: invoiceDisplayStatus(invoice, payments, DEMO_NOW),
      })),
    [clients, invoices, payments],
  );

  const filteredInvoices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return invoiceRows.filter((invoice) => {
      const matchesFilter = filter === 'all' || invoice.displayStatus === filter;
      const matchesSearch =
        !needle ||
        invoice.number.toLowerCase().includes(needle) ||
        invoice.client?.company.toLowerCase().includes(needle) ||
        invoice.client?.name.toLowerCase().includes(needle);
      return matchesFilter && matchesSearch;
    });
  }, [filter, invoiceRows, query]);

  const filteredPayments = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return payments
      .map((payment) => {
        const invoice = invoices.find((item) => item.id === payment.invoiceId);
        return {
          ...payment,
          invoice,
          client: clients.find((client) => client.id === invoice?.clientId),
        };
      })
      .filter((payment) => {
        if (!needle) return true;
        return (
          payment.invoice?.number.toLowerCase().includes(needle) ||
          payment.client?.company.toLowerCase().includes(needle) ||
          payment.client?.name.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }, [clients, invoices, payments, query]);

  const paidCount = invoiceRows.filter((invoice) => invoice.displayStatus === 'paid').length;
  const hasOutstanding = invoiceRows.some(
    (invoice) => invoice.status !== 'draft' && invoice.balanceMinor > 0,
  );

  const openPayment = (invoiceId?: string) => {
    setPaymentInvoiceId(invoiceId);
    setPaymentOpen(true);
  };

  const handleNew = async () => {
    const invoice = createInvoice();
    await flush();
    notify('Draft invoice created');
    navigate(`/invoices/${invoice.id}/edit`);
  };

  return (
    <div className="page invoices-page">
      <PageHeader
        eyebrow="09 / Invoices & payments"
        title="Invoices & payments"
        description="Issue clear invoices, record what landed, and keep the balance honest."
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => openPayment()}
              disabled={!hasOutstanding}
            >
              <CircleDollarSign size={15} /> Record payment
            </button>
            <button type="button" className="btn btn-primary" onClick={handleNew}>
              <Plus size={16} /> New invoice
            </button>
          </>
        }
      />

      <section className="metric-grid">
        <MetricCard
          label="Outstanding"
          value={formatMoney(finance.outstandingMinor, reportingCurrency)}
          detail={`${invoiceRows.filter((invoice) => invoice.balanceMinor > 0).length} open invoices`}
          icon={ReceiptText}
        />
        <MetricCard
          label="Overdue"
          value={formatMoney(finance.overdueMinor, reportingCurrency)}
          detail={`${finance.overdueCount} need follow-up`}
          icon={CalendarClock}
        />
        <MetricCard
          label="Received this month"
          value={formatMoney(finance.receivedThisMonthMinor, reportingCurrency)}
          detail="from recorded payments"
          icon={CircleDollarSign}
        />
        <MetricCard
          label="Paid invoices"
          value={String(paidCount)}
          detail={`out of ${invoices.length} total`}
          icon={Clock3}
        />
      </section>

      <div className="list-toolbar invoice-toolbar">
        <div className="underline-tabs inline-tabs" role="tablist" aria-label="Invoice view">
          <button
            type="button"
            className={tab === 'invoices' ? 'active' : ''}
            onClick={() => setTab('invoices')}
            role="tab"
            aria-selected={tab === 'invoices'}
          >
            Invoices
          </button>
          <button
            type="button"
            className={tab === 'payments' ? 'active' : ''}
            onClick={() => setTab('payments')}
            role="tab"
            aria-selected={tab === 'payments'}
          >
            Payments
          </button>
        </div>
        <div className="toolbar-right">
          <label className="search-field">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${tab}`}
              aria-label={`Search ${tab}`}
            />
          </label>
          {tab === 'invoices' ? (
            <label className="select-field">
              <span className="sr-only">Invoice status</span>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as InvoiceFilter)}
              >
                <option value="all">All statuses</option>
                <option value="overdue">Overdue</option>
                <option value="partially_paid">Partially paid</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="draft">Draft</option>
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {tab === 'invoices' ? (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th>Total</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link to={`/invoices/${invoice.id}/edit`} className="mono-cell link-strong">
                        {invoice.number}
                      </Link>
                    </td>
                    <td>{invoice.client?.company ?? 'Unlinked'}</td>
                    <td className="muted-cell">{formatDate(invoice.issuedAt)}</td>
                    <td className="muted-cell">{formatDate(invoice.dueAt)}</td>
                    <td className="numeric">
                      {formatMoney(invoice.totalMinor, invoice.currency)}
                    </td>
                    <td className={`numeric ${invoice.balanceMinor > 0 ? 'money-outstanding' : ''}`}>
                      {formatMoney(invoice.balanceMinor, invoice.currency)}
                    </td>
                    <td>
                      <StatusPill status={invoice.displayStatus} kind="invoice" />
                    </td>
                    <td>
                      <div className="table-actions">
                        {invoice.balanceMinor > 0 && invoice.status !== 'draft' ? (
                          <button
                            type="button"
                            className="row-text-action"
                            onClick={() => openPayment(invoice.id)}
                          >
                            Record
                          </button>
                        ) : null}
                        <Link
                          to={`/invoices/${invoice.id}/edit`}
                          className="icon-button row-open"
                          aria-label={`Open ${invoice.number}`}
                        >
                          <ArrowUpRight size={15} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredInvoices.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matching invoices"
              description="Try another status, invoice number, or client."
            />
          ) : null}
          <div className="table-footer">
            <span>Showing {filteredInvoices.length} of {invoices.length} invoices</span>
            <span className="sample-label">Outstanding totals use sample FX</span>
          </div>
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Client</th>
                  <th>Invoice</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatDate(payment.receivedAt)}</td>
                    <td>{payment.client?.company ?? 'Unlinked'}</td>
                    <td className="mono-cell">{payment.invoice?.number ?? '—'}</td>
                    <td>{PAYMENT_METHOD_LABELS[payment.method]}</td>
                    <td className="numeric">
                      {formatMoney(payment.amountMinor, payment.currency)}
                    </td>
                    <td className="muted-cell">{payment.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredPayments.length === 0 ? (
            <EmptyState
              icon={CircleDollarSign}
              title="No payments yet"
              description="Recorded payments will appear here."
            />
          ) : null}
          <div className="table-footer">
            <span>Showing {filteredPayments.length} payments</span>
            <span className="sample-label">Revenue is counted by received date</span>
          </div>
        </div>
      )}

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        invoices={invoices}
        initialInvoiceId={paymentInvoiceId}
      />
    </div>
  );
}
