import { useMemo, useState } from 'react';
import { ArrowUpRight, FileText, Plus, Search } from 'lucide-react';
import { Link, useNavigate } from '../../lib/router';
import { convertMinor, formatMoney } from '../../data/currencies';
import { DEMO_NOW } from '../../data/demo';
import type { ProposalStatus } from '../../data/types';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { formatDate } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusPill } from '../../components/ui/Badges';

type ProposalFilter = 'all' | ProposalStatus;

const FILTERS: { id: ProposalFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'sent', label: 'Sent' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'expired', label: 'Expired' },
];

export function ProposalsPage() {
  const [filter, setFilter] = useState<ProposalFilter>('all');
  const [query, setQuery] = useState('');
  const proposals = useCrmStore((state) => state.proposals);
  const clients = useCrmStore((state) => state.clients);
  const leads = useCrmStore((state) => state.leads);
  const reportingCurrency = useCrmStore((state) => state.reportingCurrency);
  const navigate = useNavigate();

  const enriched = useMemo(
    () =>
      proposals.map((proposal) => {
        const client = clients.find((item) => item.id === proposal.clientId);
        const lead = leads.find((item) => item.id === proposal.leadId);
        const valueMinor = proposal.lineItems.reduce(
          (total, item) => total + item.quantity * item.unitPriceMinor,
          0,
        );
        return {
          ...proposal,
          clientName: client?.company ?? lead?.company ?? 'Unlinked',
          valueMinor,
          daysToExpiry: differenceInCalendarDays(parseISO(proposal.validUntil), DEMO_NOW),
        };
      }),
    [clients, leads, proposals],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return enriched.filter((proposal) => {
      const matchesStatus = filter === 'all' || proposal.status === filter;
      const matchesSearch =
        !needle ||
        proposal.title.toLowerCase().includes(needle) ||
        proposal.number.toLowerCase().includes(needle) ||
        proposal.clientName.toLowerCase().includes(needle);
      return matchesStatus && matchesSearch;
    });
  }, [enriched, filter, query]);

  const sentValue = enriched
    .filter((proposal) => proposal.status === 'sent')
    .reduce(
      (total, proposal) =>
        total + convertMinor(proposal.valueMinor, proposal.currency, reportingCurrency),
      0,
    );
  const acceptedValue = enriched
    .filter((proposal) => proposal.status === 'accepted')
    .reduce(
      (total, proposal) =>
        total + convertMinor(proposal.valueMinor, proposal.currency, reportingCurrency),
      0,
    );
  const sentCount = enriched.filter((proposal) => proposal.status === 'sent').length;

  // Opens an empty proposal form. Nothing is saved until you press Save.
  const handleNew = () => navigate('/proposals/new/edit');

  return (
    <div className="page proposals-page">
      <PageHeader
        eyebrow="07 / Proposals"
        title="Proposals"
        description="Shape the work, agree the value, and keep every version visible."
        actions={
          <button type="button" className="btn btn-primary" onClick={handleNew}>
            <Plus size={16} /> New proposal
          </button>
        }
      />

      <div className="proposal-summary-strip card">
        <div>
          <span>Sent value</span>
          <strong>{formatMoney(sentValue, reportingCurrency)}</strong>
          <small>{sentCount} proposals awaiting a decision</small>
        </div>
        <div>
          <span>Accepted value</span>
          <strong>{formatMoney(acceptedValue, reportingCurrency)}</strong>
          <small>Across {enriched.filter((proposal) => proposal.status === 'accepted').length} accepted proposals</small>
        </div>
        <div>
          <span>Conversion</span>
          <strong>
            {sentCount > 0
              ? `${Math.round(
                  (enriched.filter((proposal) => proposal.status === 'accepted').length /
                    (sentCount + enriched.filter((proposal) => proposal.status === 'accepted').length)) *
                    100,
                )}%`
              : '—'}
          </strong>
          <small>Based on current records · Sample FX</small>
        </div>
      </div>

      <div className="list-toolbar proposals-toolbar">
        <div className="filter-tabs" role="tablist" aria-label="Proposal filters">
          {FILTERS.map((item) => {
            const count =
              item.id === 'all'
                ? enriched.length
                : enriched.filter((proposal) => proposal.status === item.id).length;
            return (
              <button
                key={item.id}
                type="button"
                className={filter === item.id ? 'active' : ''}
                onClick={() => setFilter(item.id)}
                role="tab"
                aria-selected={filter === item.id}
              >
                {item.label} <span>{count}</span>
              </button>
            );
          })}
        </div>
        <label className="search-field">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search proposals"
            aria-label="Search proposals"
          />
        </label>
      </div>

      <div className="card table-card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Proposal</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Valid until</th>
                <th>Updated</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((proposal) => (
                <tr key={proposal.id}>
                  <td className="mono-cell">{proposal.number}</td>
                  <td>
                    <Link to={`/proposals/${proposal.id}/edit`} className="table-record link-strong">
                      <strong>{proposal.title}</strong>
                      <small>{proposal.lineItems.length} line items</small>
                    </Link>
                  </td>
                  <td>{proposal.clientName}</td>
                  <td className="numeric">{formatMoney(proposal.valueMinor, proposal.currency)}</td>
                  <td><StatusPill status={proposal.status} kind="proposal" /></td>
                  <td>
                    <span className={proposal.status === 'sent' && proposal.daysToExpiry <= 7 ? 'expiry-soon' : ''}>
                      {formatDate(proposal.validUntil)}
                      {proposal.status === 'sent' && proposal.daysToExpiry <= 7 ? (
                        <small>{proposal.daysToExpiry < 0 ? 'Expired' : `${proposal.daysToExpiry}d left`}</small>
                      ) : null}
                    </span>
                  </td>
                  <td className="muted-cell">{formatDate(proposal.updatedAt)}</td>
                  <td>
                    <Link
                      to={`/proposals/${proposal.id}/edit`}
                      className="icon-button row-open"
                      aria-label={`Open ${proposal.number}`}
                    >
                      <ArrowUpRight size={15} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No proposals in this view"
            description="Try another status or search term."
          />
        ) : null}
        <div className="table-footer">
          <span>Showing {filtered.length} of {enriched.length} proposals</span>
          <span className="sample-label">Original currencies preserved</span>
        </div>
      </div>
    </div>
  );
}
