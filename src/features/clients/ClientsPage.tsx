import { useMemo, useState } from 'react';
import { ArrowUpRight, CircleDollarSign, Plus, Search, UsersRound } from 'lucide-react';
import { Link, useNavigate } from '../../lib/router';
import { formatMoney } from '../../data/currencies';
import type { Client } from '../../data/types';
import { formatDate } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { clientFinancials } from '../../store/selectors';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ClientDialog } from './ClientDialog';

type PaymentFilter = 'all' | 'outstanding' | 'paid';

type ClientRow = {
  client: Client;
  receivedMinor: number;
  outstandingMinor: number;
  invoiceCount: number;
  activeProposals: number;
  lastActivity: string | null;
};

export function ClientsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const navigate = useNavigate();
  const clients = useCrmStore((state) => state.clients);
  const leads = useCrmStore((state) => state.leads);
  const proposals = useCrmStore((state) => state.proposals);
  const invoices = useCrmStore((state) => state.invoices);
  const payments = useCrmStore((state) => state.payments);
  const reportingCurrency = useCrmStore((state) => state.reportingCurrency);

  const rows = useMemo<ClientRow[]>(
    () =>
      clients.map((client) => {
        const financials = clientFinancials(
          client.id,
          invoices,
          payments,
          reportingCurrency,
        );
        const clientProposals = proposals.filter(
          (proposal) => proposal.clientId === client.id,
        );
        const activity = [
          ...leads
            .filter((lead) => lead.clientId === client.id)
            .map((lead) => lead.lastActivityAt),
          ...clientProposals.map((proposal) => proposal.updatedAt),
          ...invoices
            .filter((invoice) => invoice.clientId === client.id)
            .map((invoice) => invoice.updatedAt),
        ].sort().at(-1);
        return {
          client,
          receivedMinor: financials.receivedMinor,
          outstandingMinor: financials.outstandingMinor,
          invoiceCount: financials.invoiceCount,
          activeProposals: clientProposals.filter(
            (proposal) => proposal.status === 'sent' || proposal.status === 'draft',
          ).length,
          lastActivity: activity ?? null,
        };
      }),
    [clients, invoices, leads, payments, proposals, reportingCurrency],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(({ client, outstandingMinor }) => {
      const matchesQuery =
        !needle ||
        client.name.toLowerCase().includes(needle) ||
        client.company.toLowerCase().includes(needle) ||
        client.email.toLowerCase().includes(needle);
      const matchesPayment =
        paymentFilter === 'all' ||
        (paymentFilter === 'outstanding' && outstandingMinor > 0) ||
        (paymentFilter === 'paid' && outstandingMinor === 0);
      return matchesQuery && matchesPayment;
    });
  }, [rows, query, paymentFilter]);

  const totalReceived = rows.reduce((total, row) => total + row.receivedMinor, 0);
  const totalOutstanding = rows.reduce((total, row) => total + row.outstandingMinor, 0);
  const activeProposals = rows.reduce((total, row) => total + row.activeProposals, 0);

  return (
    <div className="page clients-page">
      <PageHeader
        eyebrow="05 / Clients"
        title="Clients"
        description="The people and studios you have built a relationship with."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setDialogOpen(true)}>
            <Plus size={16} /> Add client
          </button>
        }
      />

      <section className="client-summary" aria-label="Client summary">
        <div>
          <span className="summary-icon"><UsersRound size={15} /></span>
          <p>Total clients</p>
          <strong>{clients.length}</strong>
        </div>
        <div>
          <span className="summary-icon"><ClipboardIcon /></span>
          <p>Active proposals</p>
          <strong>{activeProposals}</strong>
        </div>
        <div>
          <span className="summary-icon"><CircleDollarSign size={15} /></span>
          <p>Total received</p>
          <strong>{formatMoney(totalReceived, reportingCurrency)}</strong>
          <small>Sample FX</small>
        </div>
        <div>
          <span className="summary-icon"><CircleDollarSign size={15} /></span>
          <p>Outstanding</p>
          <strong>{formatMoney(totalOutstanding, reportingCurrency)}</strong>
          <small>Sample FX</small>
        </div>
      </section>

      <div className="list-toolbar">
        <label className="search-field">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clients"
            aria-label="Search clients"
          />
        </label>
        <label className="select-field">
          <span className="sr-only">Payment state</span>
          <select
            value={paymentFilter}
            onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)}
          >
            <option value="all">All payment states</option>
            <option value="outstanding">With outstanding</option>
            <option value="paid">Paid in full</option>
          </select>
        </label>
      </div>

      <div className="card table-card">
        <div className="table-wrap">
          <table className="data-table clients-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Contact</th>
                <th>Active proposals</th>
                <th>Received value</th>
                <th>Outstanding</th>
                <th>Last activity</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.client.id}>
                  <td>
                    <Link to={`/clients/${row.client.id}`} className="table-person">
                      <Avatar name={row.client.company} />
                      <span>
                        <strong>{row.client.company}</strong>
                        <small>{row.client.name}</small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <span className="contact-cell">
                      <span>{row.client.email}</span>
                      <small>{row.client.phone}</small>
                    </span>
                  </td>
                  <td className="numeric">{row.activeProposals}</td>
                  <td className="numeric">{formatMoney(row.receivedMinor, reportingCurrency)}</td>
                  <td>
                    {row.invoiceCount === 0 ? (
                      <span className="muted-cell">No invoice</span>
                    ) : row.outstandingMinor > 0 ? (
                      <span className="money-outstanding">
                        {formatMoney(row.outstandingMinor, reportingCurrency)}
                      </span>
                    ) : (
                      <span className="pill pill-green">
                        <span className="pill-dot" /> Paid
                      </span>
                    )}
                  </td>
                  <td className="muted-cell">
                    {row.lastActivity ? formatDate(row.lastActivity) : 'No activity'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-button row-open"
                      onClick={() => navigate(`/clients/${row.client.id}`)}
                      aria-label={`Open ${row.client.company}`}
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No matching clients"
            description="Try another name, company, or payment state."
          />
        ) : null}
        <div className="table-footer">
          <span>
            Showing {filtered.length} of {clients.length} clients
          </span>
          <span className="sample-label">Sample FX totals in {reportingCurrency}</span>
        </div>
      </div>

      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(client) => navigate(`/clients/${client.id}`)}
      />
    </div>
  );
}

function ClipboardIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2.5h6V4M9 9h6M9 13h6M9 17h4" />
    </svg>
  );
}
