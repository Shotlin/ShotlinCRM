'use client';

import { ArrowUpRight, MessageSquareReply, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AiReplyDraftView } from '../../data/ai';
import { formatRelative } from '../../lib/format';
import { Link } from '../../lib/router';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { SourceBadge } from '../../components/ui/Badges';

const stateLabels: Record<string, string> = {
  draft: 'Draft · not sent',
  edited: 'Edited · not sent',
  approved: 'Approved · not sent',
};

export function AiRepliesPage() {
  const [drafts, setDrafts] = useState<AiReplyDraftView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const events = new EventSource('/api/events');
    const load = async () => {
      try {
        const response = await fetch('/api/ai/replies', { cache: 'no-store' });
        const payload = (await response.json().catch(() => null)) as
          | { drafts: AiReplyDraftView[]; error?: string }
          | null;
        if (!response.ok) throw new Error(payload?.error ?? 'Replies could not be loaded');
        setDrafts(payload?.drafts ?? []);
        setError(null);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Replies could not be loaded');
      } finally {
        setLoading(false);
      }
    };
    void load();
    events.onmessage = () => void load();
    return () => events.close();
  }, []);

  return (
    <div className="page ai-page ai-replies-page">
      <PageHeader
        eyebrow="AI assistant / Replies"
        title="Review replies"
        description="Drafts grounded in real conversations, waiting for your judgement."
        actions={<Link to="/ai" className="btn btn-secondary">Back to priorities</Link>}
      />

      <div className="ai-safety-note">
        <ShieldCheck size={16} />
        <p>AI drafts require your review. Nothing is sent automatically.</p>
      </div>

      {loading ? (
        <div className="route-loading" role="status">
          <span className="route-loading-mark" aria-hidden="true" />
          Loading reply drafts
        </div>
      ) : error ? (
        <div className="ai-empty" role="alert">
          <strong>{error}</strong>
          <p>Reload this page to try again.</p>
        </div>
      ) : drafts.length === 0 ? (
        <div className="card ai-empty ai-replies-empty">
          <MessageSquareReply size={22} />
          <strong>No drafts are waiting.</strong>
          <p>
            Connect an AI provider and open a contact to generate an evidence-linked reply, or
            let automatic drafts appear after new enquiries.
          </p>
          <Link to="/ai" className="btn btn-secondary">Open priorities</Link>
        </div>
      ) : (
        <div className="ai-replies-list">
          {drafts.map((draft) => (
            <Link key={draft.id} to={`/ai/contacts/${draft.leadId}`} className="card ai-draft-card">
              <div className="ai-draft-person">
                <Avatar name={draft.leadName} />
                <span>
                  <strong>{draft.leadName}</strong>
                  <small>{stateLabels[draft.state] ?? draft.state} · {formatRelative(draft.updatedAt)}</small>
                </span>
                <SourceBadge source={draft.source} />
              </div>
              <p className="ai-draft-excerpt">{draft.body}</p>
              <span className="ai-draft-action">
                Review draft <ArrowUpRight size={14} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
