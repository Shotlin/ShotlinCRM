import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  FileText,
  Mail,
  MapPin,
  MessageSquareText,
  Pencil,
  Phone,
  Plus,
} from 'lucide-react';
import { Link, useNavigate, useParams } from '../../lib/router';
import { formatMoney } from '../../data/currencies';
import type { ProposalStatus } from '../../data/types';
import { formatDate, formatFollowUp, PROPOSAL_STATUS_LABELS } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import {
  clientFinancials,
  invoiceBalanceMinor,
  invoiceDisplayStatus,
  invoiceTotalMinor,
} from '../../store/selectors';
import { Avatar } from '../../components/ui/Avatar';
import { StatusPill } from '../../components/ui/Badges';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/layout/PageHeader';
import { useToast } from '../../components/ui/Toast';
import { ClientDialog } from './ClientDialog';

type ClientTab = 'overview' | 'proposals' | 'invoices' | 'activity';

const tabs: { id: ClientTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'activity', label: 'Activity' },
];

export function ClientDetailPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ClientTab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const { notify } = useToast();
  const clients = useCrmStore((state) => state.clients);
  const leads = useCrmStore((state) => state.leads);
  const proposals = useCrmStore((state) => state.proposals);
  const invoices = useCrmStore((state) => state.invoices);
  const payments = useCrmStore((state) => state.payments);
  const messages = useCrmStore((state) => state.messages);
  const createProposal = useCrmStore((state) => state.createProposal);
  const createInvoice = useCrmStore((state) => state.createInvoice);
  const flush = useCrmStore((state) => state.flush);
  const reportingCurrency = useCrmStore((state) => state.reportingCurrency);

  const client = clients.find((item) => item.id === clientId);
  const relatedLeads = useMemo(
    () => leads.filter((lead) => lead.clientId === clientId),
    [leads, clientId],
  );
  const relatedProposals = useMemo(
    () => proposals.filter((proposal) => proposal.clientId === clientId),
    [proposals, clientId],
  );
  const relatedInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.clientId === clientId),
    [invoices, clientId],
  );
  const latestLead = relatedLeads.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0];
  const recentMessages = useMemo(
    () =>
      messages
        .filter((message) => relatedLeads.some((lead) => lead.id === message.leadId))
        .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
        .slice(0, 3),
    [messages, relatedLeads],
  );
  const financials = useMemo(
    () =>
      client
        ? clientFinancials(client.id, invoices, payments, reportingCurrency)
        : { receivedMinor: 0, outstandingMinor: 0, invoiceCount: 0 },
    [client, invoices, payments, reportingCurrency],
  );
  const nextFollowUp = relatedLeads
    .filter((lead) => lead.followUpAt && lead.status !== 'paid')
    .sort((a, b) => (a.followUpAt ?? '').localeCompare(b.followUpAt ?? ''))[0];

  const activity = useMemo(() => {
    const items = [
      ...relatedLeads.flatMap((lead) => [
        {
          id: `lead-${lead.id}`,
          date: lead.createdAt,
          title: 'Lead opened',
          body: `${lead.source === 'whatsapp' ? 'WhatsApp' : 'Meta'} · ${lead.initialMessage}`,
        },
      ]),
      ...relatedProposals.map((proposal) => ({
        id: `proposal-${proposal.id}`,
        date: proposal.updatedAt,
        title: `Proposal ${PROPOSAL_STATUS_LABELS[proposal.status].toLowerCase()}`,
        body: `${proposal.number} · ${proposal.title}`,
      })),
      ...relatedInvoices.map((invoice) => ({
        id: `invoice-${invoice.id}`,
        date: invoice.updatedAt,
        title: 'Invoice updated',
        body: `${invoice.number} · ${formatMoney(invoiceTotalMinor(invoice), invoice.currency)}`,
      })),
      ...payments
        .filter((payment) => relatedInvoices.some((invoice) => invoice.id === payment.invoiceId))
        .map((payment) => ({
          id: `payment-${payment.id}`,
          date: payment.receivedAt,
          title: 'Payment received',
          body: formatMoney(payment.amountMinor, payment.currency),
        })),
    ];
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [relatedLeads, relatedProposals, relatedInvoices, payments]);

  if (!client) {
    return (
      <div className="page">
        <EmptyState
          icon={FileText}
          title="Client not found"
          description="This record may have been removed or the link is incorrect."
          action={
            <Link to="/clients" className="btn btn-primary">
              Back to clients
            </Link>
          }
        />
      </div>
    );
  }

  const newProposal = async () => {
    const proposal = createProposal({
      clientId: client.id,
      leadId: latestLead?.id,
      title: `${client.company} project`,
      currency: latestLead?.currency ?? reportingCurrency,
      lineItems: [
        {
          id: `line-${Date.now()}`,
          description: 'Production',
          quantity: 1,
          unitPriceMinor: latestLead?.valueMinor ?? 0,
        },
      ],
    });
    await flush();
    notify('Draft proposal created');
    navigate(`/proposals/${proposal.id}/edit`);
  };

  const newInvoice = async () => {
    const invoice = createInvoice({
      clientId: client.id,
      leadId: latestLead?.id,
      currency: latestLead?.currency ?? reportingCurrency,
      lineItems: [
        {
          id: `line-${Date.now()}`,
          description: 'Production',
          quantity: 1,
          unitPriceMinor: latestLead?.valueMinor ?? 0,
        },
      ],
    });
    await flush();
    notify('Draft invoice created');
    navigate(`/invoices/${invoice.id}/edit`);
  };

  return (
    <div className="page client-detail-page">
      <Link to="/clients" className="back-link">
        <ArrowLeft size={15} /> Clients
      </Link>
      <PageHeader
        eyebrow="06 / Client detail"
        title={client.company}
        description={`${client.name} · ${client.city}`}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(true)}>
              <Pencil size={15} /> Edit client
            </button>
            <button type="button" className="btn btn-primary" onClick={newProposal}>
              <Plus size={15} /> New proposal
            </button>
          </>
        }
      />

      <section className="client-identity-card card">
        <div className="client-identity-main">
          <Avatar name={client.company} size="lg" />
          <div>
            <h2>{client.name}</h2>
            <p>Primary contact</p>
          </div>
        </div>
        <dl className="client-contact-grid">
          <div>
            <dt><Mail size={13} /> Email</dt>
            <dd>{client.email}</dd>
          </div>
          <div>
            <dt><Phone size={13} /> Phone</dt>
            <dd>{client.phone}</dd>
          </div>
          <div>
            <dt><MapPin size={13} /> Location</dt>
            <dd>{client.city}</dd>
          </div>
        </dl>
        <div className="client-values">
          <div>
            <span>Total received</span>
            <strong>{formatMoney(financials.receivedMinor, reportingCurrency)}</strong>
          </div>
          <div>
            <span>Outstanding</span>
            <strong>{formatMoney(financials.outstandingMinor, reportingCurrency)}</strong>
          </div>
        </div>
      </section>

      <div className="underline-tabs" role="tablist" aria-label="Client record">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'proposals' ? <span>{relatedProposals.length}</span> : null}
            {item.id === 'invoices' ? <span>{relatedInvoices.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="client-overview-grid">
          <section className="card section-card">
            <div className="section-head">
              <div>
                <h2>Relationship</h2>
                <p>Active engagement and private context.</p>
              </div>
            </div>
            <div className="relationship-rows">
              <div>
                <span>Status</span>
                <StatusPill status={latestLead?.status ?? 'paid'} />
              </div>
              <div>
                <span>Client since</span>
                <strong>{formatDate(client.createdAt)}</strong>
              </div>
              <div>
                <span>Primary source</span>
                <strong>{latestLead?.source === 'meta' ? 'Meta' : 'WhatsApp'}</strong>
              </div>
              <div>
                <span>Open proposals</span>
                <strong>
                  {relatedProposals.filter((proposal) => proposal.status === 'sent').length}
                </strong>
              </div>
            </div>
            <div className="client-notes-block">
              <span>Notes</span>
              <p>{client.notes || 'No notes yet.'}</p>
            </div>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <div>
                <h2>Recent conversation</h2>
                <p>The latest signals from this client.</p>
              </div>
              {latestLead ? (
                <Link to={`/leads/${latestLead.id}`} className="text-link">
                  Open lead <ArrowUpRight size={14} />
                </Link>
              ) : null}
            </div>
            <div className="client-message-preview">
              {recentMessages.map((message) => (
                <div className="preview-message" key={message.id}>
                  <span className={`preview-dot ${message.direction}`} />
                  <div>
                    <p>{message.body}</p>
                    <small>{formatDate(message.sentAt, 'd MMM · h:mm a')}</small>
                  </div>
                </div>
              ))}
              {recentMessages.length === 0 ? (
                <EmptyState
                  icon={MessageSquareText}
                  title="No conversation yet"
                  description="Messages linked to this client will appear here."
                />
              ) : null}
            </div>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <div>
                <h2>Next follow-up</h2>
                <p>One intentional next step.</p>
              </div>
            </div>
            {nextFollowUp?.followUpAt ? (
              <div className="next-follow-up-block">
                <span className="round-icon"><CalendarClock size={17} /></span>
                <strong>{formatFollowUp(nextFollowUp.followUpAt)}</strong>
                <p>{nextFollowUp.name} · {nextFollowUp.company}</p>
                <Link to={`/leads/${nextFollowUp.id}`} className="btn btn-secondary full-width">
                  Open follow-up
                </Link>
              </div>
            ) : (
              <p className="muted-copy">No follow-up scheduled.</p>
            )}
          </section>

          <section className="card section-card">
            <div className="section-head">
              <div>
                <h2>Related records</h2>
                <p>Proposals and invoices at a glance.</p>
              </div>
            </div>
            <div className="related-record-list">
              {relatedProposals.slice(0, 2).map((proposal) => (
                <Link to={`/proposals/${proposal.id}/edit`} key={proposal.id}>
                  <FileText size={15} />
                  <span>
                    <strong>{proposal.title}</strong>
                    <small>{proposal.number}</small>
                  </span>
                  <span className={`proposal-status-text status-${proposal.status}`}>
                    {PROPOSAL_STATUS_LABELS[proposal.status as ProposalStatus]}
                  </span>
                </Link>
              ))}
              {relatedInvoices.slice(0, 2).map((invoice) => (
                <Link to={`/invoices/${invoice.id}/edit`} key={invoice.id}>
                  <CircleDollarSign size={15} />
                  <span>
                    <strong>{invoice.number}</strong>
                    <small>Balance {formatMoney(invoiceBalanceMinor(invoice, payments), invoice.currency)}</small>
                  </span>
                  <StatusPill
                    status={invoiceDisplayStatus(invoice, payments)}
                    kind="invoice"
                  />
                </Link>
              ))}
            </div>
            <button type="button" className="btn btn-secondary full-width" onClick={newInvoice}>
              <Plus size={14} /> New invoice
            </button>
          </section>
        </div>
      ) : null}

      {tab === 'proposals' ? (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Proposal</th>
                  <th>Status</th>
                  <th>Value</th>
                  <th>Valid until</th>
                  <th>Updated</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {relatedProposals.map((proposal) => {
                  const value = proposal.lineItems.reduce(
                    (total, item) => total + item.quantity * item.unitPriceMinor,
                    0,
                  );
                  return (
                    <tr key={proposal.id}>
                      <td>
                        <span className="table-record">
                          <strong>{proposal.title}</strong>
                          <small>{proposal.number}</small>
                        </span>
                      </td>
                      <td><StatusPill status={proposal.status} kind="proposal" /></td>
                      <td className="numeric">{formatMoney(value, proposal.currency)}</td>
                      <td>{formatDate(proposal.validUntil)}</td>
                      <td className="muted-cell">{formatDate(proposal.updatedAt)}</td>
                      <td>
                        <Link to={`/proposals/${proposal.id}/edit`} className="icon-button row-open">
                          <ArrowUpRight size={15} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {relatedProposals.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No proposals yet"
              description="Create the first proposal for this relationship."
              action={<button className="btn btn-primary" onClick={newProposal}>Create proposal</button>}
            />
          ) : null}
        </div>
      ) : null}

      {tab === 'invoices' ? (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Balance</th>
                  <th>Due</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {relatedInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <span className="table-record">
                        <strong>{invoice.number}</strong>
                        <small>{invoice.lineItems[0]?.description}</small>
                      </span>
                    </td>
                    <td>
                      <StatusPill status={invoiceDisplayStatus(invoice, payments)} kind="invoice" />
                    </td>
                    <td className="numeric">{formatMoney(invoiceTotalMinor(invoice), invoice.currency)}</td>
                    <td className="numeric">{formatMoney(invoiceBalanceMinor(invoice, payments), invoice.currency)}</td>
                    <td>{formatDate(invoice.dueAt)}</td>
                    <td>
                      <Link to={`/invoices/${invoice.id}/edit`} className="icon-button row-open">
                        <ArrowUpRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {relatedInvoices.length === 0 ? (
            <EmptyState
              icon={CircleDollarSign}
              title="No invoices yet"
              description="Create an invoice when the work is confirmed."
              action={<button className="btn btn-primary" onClick={newInvoice}>Create invoice</button>}
            />
          ) : null}
        </div>
      ) : null}

      {tab === 'activity' ? (
        <section className="card section-card">
          <div className="section-head">
            <div>
              <h2>Complete activity</h2>
              <p>All client records in reverse chronological order.</p>
            </div>
          </div>
          <div className="activity-feed">
            {activity.map((item) => (
              <div className="activity-item" key={item.id}>
                <span className="activity-marker" />
                <div>
                  <div className="activity-title">
                    <strong>{item.title}</strong>
                    <time>{formatDate(item.date)}</time>
                  </div>
                  <p>{item.body}</p>
                </div>
              </div>
            ))}
            {activity.length === 0 ? (
              <p className="muted-copy">No activity recorded yet.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <ClientDialog open={editOpen} onOpenChange={setEditOpen} client={client} />
    </div>
  );
}
