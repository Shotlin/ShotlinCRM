import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  MessageSquare,
  NotebookPen,
  Pencil,
  Plus,
  SendHorizontal,
  UserRoundPlus,
} from 'lucide-react';
import { Link, useNavigate, useParams } from '../../lib/router';
import { formatMoney } from '../../data/currencies';
import type { LeadStatus } from '../../data/types';
import { formatDate, formatFollowUp, formatRelative, LEAD_STATUS_LABELS } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { LEAD_STAGES } from '../../store/selectors';
import { Avatar } from '../../components/ui/Avatar';
import { SourceBadge, StatusPill } from '../../components/ui/Badges';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/layout/PageHeader';
import { LeadDialog } from './LeadDialog';

type TimelineItem = {
  id: string;
  date: string;
  title: string;
  body: string;
  icon: typeof MessageSquare;
  href?: string;
};

export function LeadDetailPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const { notify } = useToast();
  const leads = useCrmStore((state) => state.leads);
  const messages = useCrmStore((state) => state.messages);
  const clients = useCrmStore((state) => state.clients);
  const proposals = useCrmStore((state) => state.proposals);
  const invoices = useCrmStore((state) => state.invoices);
  const payments = useCrmStore((state) => state.payments);
  const notes = useCrmStore((state) => state.notes);
  const moveLead = useCrmStore((state) => state.moveLead);
  const addNote = useCrmStore((state) => state.addNote);
  const sendMessage = useCrmStore((state) => state.sendMessage);
  const convertLeadToClient = useCrmStore((state) => state.convertLeadToClient);
  const flush = useCrmStore((state) => state.flush);

  const lead = leads.find((item) => item.id === leadId);
  const client = clients.find((item) => item.id === lead?.clientId);
  const leadMessages = useMemo(
    () =>
      messages
        .filter((message) => message.leadId === leadId)
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    [messages, leadId],
  );
  const leadProposals = useMemo(
    () => proposals.filter((proposal) => proposal.leadId === leadId),
    [proposals, leadId],
  );
  const leadInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.leadId === leadId),
    [invoices, leadId],
  );
  const leadNotes = useMemo(
    () =>
      notes
        .filter((item) => item.leadId === leadId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notes, leadId],
  );

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!lead) return [];
    const items: TimelineItem[] = [
      {
        id: `created-${lead.id}`,
        date: lead.createdAt,
        title: `Lead created via ${lead.source === 'whatsapp' ? 'WhatsApp' : 'Meta'}`,
        body: lead.initialMessage,
        icon: MessageSquare,
      },
      ...leadMessages
        .filter((message) => message.sentAt !== lead.createdAt)
        .map((message) => ({
          id: message.id,
          date: message.sentAt,
          title: message.direction === 'outbound' ? 'Reply sent' : 'Message received',
          body: message.body,
          icon: SendHorizontal,
        })),
      ...leadNotes.map((item) => ({
        id: item.id,
        date: item.createdAt,
        title: 'Note added',
        body: item.body,
        icon: NotebookPen,
      })),
      ...leadProposals.map((proposal) => ({
        id: `proposal-${proposal.id}`,
        date: proposal.updatedAt,
        title: proposal.status === 'draft' ? 'Proposal drafted' : `Proposal ${proposal.status}`,
        body: `${proposal.number} · ${proposal.title}`,
        icon: FileText,
        href: `/proposals/${proposal.id}/edit`,
      })),
      ...leadInvoices.map((invoice) => ({
        id: `invoice-${invoice.id}`,
        date: invoice.issuedAt,
        title: 'Invoice issued',
        body: `${invoice.number} · ${formatMoney(
          invoice.lineItems.reduce(
            (total, item) => total + item.quantity * item.unitPriceMinor,
            0,
          ),
          invoice.currency,
        )}`,
        icon: FileText,
        href: `/invoices/${invoice.id}/edit`,
      })),
      ...payments
        .filter((payment) => leadInvoices.some((invoice) => invoice.id === payment.invoiceId))
        .map((payment) => ({
          id: `payment-${payment.id}`,
          date: payment.receivedAt,
          title: 'Payment received',
          body: `${formatMoney(payment.amountMinor, payment.currency)} · ${payment.method}`,
          icon: CircleDollarSign,
        })),
    ];
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [lead, leadMessages, leadNotes, leadProposals, leadInvoices, payments]);

  if (!lead) {
    return (
      <div className="page">
        <EmptyState
          icon={MessageSquare}
          title="Lead not found"
          description="This lead may have been removed or the link is incorrect."
          action={
            <Link to="/pipeline" className="btn btn-primary">
              Back to pipeline
            </Link>
          }
        />
      </div>
    );
  }

  // Opens the proposal form with this lead chosen. Nothing is saved until you press Save.
  const handleCreateProposal = () => {
    const query = new URLSearchParams({
      leadId: lead.id,
      title: `${lead.company || lead.name} project`,
      currency: lead.currency,
      value: String(lead.valueMinor),
    });
    if (lead.clientId) query.set('clientId', lead.clientId);
    navigate(`/proposals/new/edit?${query.toString()}`);
  };

  const handleConvert = async () => {
    const id = convertLeadToClient(lead.id);
    await flush();
    notify('Lead converted to client');
    navigate(`/clients/${id}`);
  };

  const handleNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) return;
    addNote(lead.id, note.trim());
    await flush();
    setNote('');
    notify('Note added');
  };

  const handleReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage(lead.id, reply.trim());
      setReply('');
      notify('Message queued for WhatsApp');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Message could not be queued');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page lead-detail-page">
      <Link to="/pipeline" className="back-link">
        <ArrowLeft size={15} /> Pipeline
      </Link>
      <PageHeader
        eyebrow="04 / Lead detail"
        title={lead.name}
        description={`${lead.company || 'Independent'} · ${lead.city || 'Location not set'}`}
        actions={
          <>
            <div className="lead-header-value">
              <span>Estimated value</span>
              <strong>{formatMoney(lead.valueMinor, lead.currency)}</strong>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(true)}>
              <Pencil size={15} /> Edit lead
            </button>
          </>
        }
      />

      <div className="lead-meta-row">
        <SourceBadge source={lead.source} />
        <StatusPill status={lead.status} />
        <span className="meta-divider" />
        <span>{lead.phone || 'No phone added'}</span>
        <span className="meta-divider" />
        <span>{lead.email || 'No email added'}</span>
        <span className="meta-divider" />
        <span>Added {formatDate(lead.createdAt)}</span>
        {lead.tags.length ? (
          <span className="lead-tags">
            {lead.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </span>
        ) : null}
      </div>

      <div className="lead-detail-grid">
        <div className="lead-detail-main">
          <section className="card section-card">
            <div className="section-head">
              <div>
                <h2>Conversation</h2>
                <p>{leadMessages.length} messages in this thread.</p>
              </div>
              <Link to="/inbox" className="text-link">
                Open inbox <ArrowUpRight size={14} />
              </Link>
            </div>
            <div className="lead-message-list">
              {leadMessages.map((message) => (
                <div key={message.id} className={`lead-message message-${message.direction}`}>
                  <Avatar
                    name={message.direction === 'inbound' ? lead.name : 'Sayan'}
                    size="sm"
                    muted={message.direction === 'outbound'}
                  />
                  <div>
                    <span className="lead-message-meta">
                      {message.direction === 'inbound' ? lead.name : 'You'} ·{' '}
                      {formatDate(message.sentAt, 'd MMM · h:mm a')}
                      {message.direction === 'outbound' ? ` · ${message.state}` : ''}
                    </span>
                    {message.media?.mimeType.startsWith('image/') ? (
                      <img className="message-media" src={message.media.url} alt={message.body || 'Image attachment'} loading="lazy" />
                    ) : null}
                    {message.body ? <p>{message.body}</p> : null}
                    {!message.body && !message.media ? (
                      <p className="muted-copy">{message.kind === 'text' ? 'Empty message' : `${message.kind} unavailable`}</p>
                    ) : null}
                    {message.media && !message.media.mimeType.startsWith('image/') ? (
                      <a className="message-document" href={message.media.url} target="_blank" rel="noreferrer">
                        {message.media.filename ?? 'Attachment'}
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
              {leadMessages.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title="No messages yet"
                  description="Send a WhatsApp message to begin the conversation record."
                />
              ) : null}
            </div>
            <form className="composer lead-composer" onSubmit={handleReply}>
              <label className="sr-only" htmlFor="lead-reply">
                Write a WhatsApp message
              </label>
              <input
                id="lead-reply"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Write a WhatsApp message…"
              />
              <button type="submit" className="composer-send" disabled={!reply.trim() || sending}>
                <SendHorizontal size={17} />
                <span className="sr-only">Send WhatsApp message</span>
              </button>
            </form>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <div>
                <h2>Notes</h2>
                <p>Private context for your next conversation.</p>
              </div>
            </div>
            <form className="note-composer" onSubmit={handleNote}>
              <label className="sr-only" htmlFor="lead-note">
                Add a note
              </label>
              <textarea
                id="lead-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="What should you remember about this lead?"
              />
              <button className="btn btn-secondary" type="submit" disabled={!note.trim()}>
                <Plus size={14} /> Add note
              </button>
            </form>
            <div className="note-list">
              {leadNotes.map((item) => (
                <div className="note-item" key={item.id}>
                  <span className="note-mark">
                    <NotebookPen size={14} />
                  </span>
                  <div>
                    <p>{item.body}</p>
                    <small>{formatDate(item.createdAt, 'd MMM yyyy · h:mm a')}</small>
                  </div>
                </div>
              ))}
              {leadNotes.length === 0 ? (
                <p className="muted-copy">No notes yet. Add the useful details while they are fresh.</p>
              ) : null}
            </div>
          </section>
        </div>

        <div className="lead-detail-side">
          <section className="card section-card timeline-card">
            <div className="section-head">
              <div>
                <h2>Timeline</h2>
                <p>Every meaningful touchpoint.</p>
              </div>
            </div>
            <div className="timeline">
              {timeline.map((item) => {
                const Icon = item.icon;
                return (
                  <div className="timeline-item" key={item.id}>
                    <span className="timeline-mark">
                      <Icon size={14} />
                    </span>
                    <div className="timeline-copy">
                      <div className="timeline-title">
                        <strong>{item.title}</strong>
                        <time>{formatRelative(item.date)}</time>
                      </div>
                      {item.href ? (
                        <Link to={item.href} className="timeline-body timeline-link">
                          {item.body} <ArrowUpRight size={12} />
                        </Link>
                      ) : (
                        <p className="timeline-body">{item.body}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {lead.followUpAt ? (
            <section className="card section-card next-action-card">
              <span className="card-kicker">
                <CalendarClock size={14} /> Next follow-up
              </span>
              <h2>{formatFollowUp(lead.followUpAt)}</h2>
              <p>Keep the next step specific and small.</p>
              <button
                type="button"
                className="btn btn-secondary full-width"
                onClick={() => moveLead(lead.id, 'connected')}
              >
                <CheckCircle2 size={15} /> Mark as connected
              </button>
            </section>
          ) : null}

          <section className="card section-card action-card">
            <div className="section-head">
              <div>
                <h2>Actions</h2>
                <p>Move the relationship forward.</p>
              </div>
            </div>
            <div className="stacked-actions">
              <button type="button" className="btn btn-primary" onClick={handleCreateProposal}>
                <FileText size={15} /> Create proposal
              </button>
              {leadProposals[0] ? (
                <Link to={`/proposals/${leadProposals[0].id}/edit`} className="btn btn-secondary">
                  Open latest proposal <ArrowUpRight size={14} />
                </Link>
              ) : null}
              {lead.clientId ? (
                <Link to={`/clients/${lead.clientId}`} className="btn btn-secondary">
                  <ArrowUpRight size={15} /> Open client record
                </Link>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={handleConvert}>
                  <UserRoundPlus size={15} /> Convert to client
                </button>
              )}
              {leadInvoices[0] ? (
                <Link to="/invoices" className="btn btn-secondary">
                  <CircleDollarSign size={15} /> View invoices
                </Link>
              ) : null}
            </div>
            <label className="field stage-select">
              <span>Current stage</span>
              <select
                value={lead.status}
                onChange={(event) => {
                  moveLead(lead.id, event.target.value as LeadStatus);
                  notify(`Moved to ${LEAD_STATUS_LABELS[event.target.value as LeadStatus]}`);
                }}
              >
                {LEAD_STAGES.map((stage) => (
                  <option key={stage.status} value={stage.status}>
                    {stage.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {client ? (
            <section className="card section-card compact-client-card">
              <span className="card-kicker">Client</span>
              <div className="compact-client">
                <Avatar name={client.name} size="sm" />
                <div>
                  <strong>{client.company}</strong>
                  <small>{client.email}</small>
                </div>
                <Link to={`/clients/${client.id}`} aria-label="Open client">
                  <ArrowUpRight size={14} />
                </Link>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <LeadDialog open={editOpen} onOpenChange={setEditOpen} lead={lead} />
    </div>
  );
}
