'use client';

import { FileCheck2, FilePlus2, FileSignature, FileText, FolderKanban, LoaderCircle, Paperclip } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Link } from '@/lib/router';
import { inr } from '../gst/format';

type Deal = {
  id: string;
  kind: 'proposal' | 'agreement';
  title: string;
  reference: string;
  status: string;
  party: string;
  isLead: boolean;
  baseAmountMinor: number;
  totalMinor: number;
  hasFile: boolean;
  projectId: string | null;
};

const STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'violet' },
  sent: { label: 'Sent', tone: 'blue' },
  signed: { label: 'Signed', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
};

export function AgreementsPage() {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'proposal' | 'agreement'>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/agreements', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load your documents.');
        return ((await response.json()) as { deals: Deal[] }).deals;
      })
      .then(setDeals)
      .catch((problem: Error) => setError(problem.message));
  }, []);

  const shown = (deals ?? []).filter((deal) => filter === 'all' || deal.kind === filter);

  return (
    <div className="bk-page">
      <PageHeader
        eyebrow="Deals"
        title="Proposals & agreements"
        description="Upload the proposal or agreement you wrote, set the cost and the payment milestones, then start the project from it."
        actions={
          <>
            <Link to="/agreements/new?kind=proposal" className="btn btn-secondary">
              <FileText size={15} aria-hidden="true" /> Upload proposal
            </Link>
            <Link to="/agreements/new?kind=agreement" className="btn btn-primary">
              <FilePlus2 size={15} aria-hidden="true" /> Upload agreement
            </Link>
          </>
        }
      />
      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      <div className="bk-tabs" role="tablist" aria-label="Filter">
        {(['all', 'proposal', 'agreement'] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'on' : ''} onClick={() => setFilter(value)}>
            {value === 'all' ? 'All' : value === 'proposal' ? 'Proposals' : 'Agreements'}
          </button>
        ))}
      </div>
      {!deals ? (
        !error ? <p className="bk-loading"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Loading…</p> : null
      ) : shown.length === 0 ? (
        <section className="bk-card">
          <p className="bk-empty">Nothing here yet. Upload your first proposal or agreement with the buttons above.</p>
        </section>
      ) : (
        <section className="bk-card">
          <div className="bk-table-wrap">
            <table className="bk-table">
              <thead>
                <tr><th>Document</th><th>Client / lead</th><th>Status</th><th className="num">Cost before GST</th><th className="num">Total with GST</th><th>Project</th></tr>
              </thead>
              <tbody>
                {shown.map((deal) => (
                  <tr key={deal.id}>
                    <td>
                      <Link to={`/agreements/${deal.id}`} className="bk-link">
                        {deal.kind === 'agreement' ? <FileSignature size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />} <b>{deal.title}</b>
                      </Link>
                      <span className="bk-sub bk-block">
                        <span className={`bk-chip ${deal.kind === 'agreement' ? 'bk-tone-indigo' : 'bk-tone-teal'}`}>{deal.kind === 'agreement' ? 'Agreement' : 'Proposal'}</span>
                        {deal.reference ? ` ${deal.reference}` : ''} {deal.hasFile ? <Paperclip size={12} aria-label="PDF attached" /> : null}
                      </span>
                    </td>
                    <td>{deal.party || '-'} {deal.isLead ? <span className="bk-chip bk-tone-amber">Lead</span> : null}</td>
                    <td><span className={`bk-chip bk-tone-${STATUS[deal.status]?.tone ?? 'violet'}`}>{STATUS[deal.status]?.label ?? deal.status}</span></td>
                    <td className="num">{inr(deal.baseAmountMinor)}</td>
                    <td className="num"><b>{inr(deal.totalMinor)}</b></td>
                    <td>
                      {deal.projectId ? (
                        <Link to={`/projects/${deal.projectId}`} className="bk-link"><FolderKanban size={14} aria-hidden="true" /> Open project</Link>
                      ) : deal.kind === 'agreement' ? (
                        <span className="bk-sub"><FileCheck2 size={13} aria-hidden="true" /> Not started</span>
                      ) : (
                        <span className="bk-sub">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
