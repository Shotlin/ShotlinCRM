import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  FileText,
  Paperclip,
  Search,
  SendHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { Link } from '../../lib/router';
import { formatMoney } from '../../data/currencies';
import type { LeadSource, Message } from '../../data/types';
import { formatDate, formatFollowUp, formatRelative } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { Avatar } from '../../components/ui/Avatar';
import { SourceBadge, StatusPill } from '../../components/ui/Badges';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/layout/PageHeader';

type MessageTemplate = { id: string; name: string; body: string };
type LoadedDraft = {
  id: string;
  leadId: string;
  body: string;
  triggeringMessageId: string | null;
  generatedAt: string;
};

function renderPreview(template: MessageTemplate, name: string, company: string, followUpAt?: string) {
  return template.body
    .replace(/\{\{\s*name\s*\}\}/g, name)
    .replace(/\{\{\s*company\s*\}\}/g, company)
    .replace(/\{\{\s*followUpDate\s*\}\}/g, followUpAt ? formatDate(followUpAt, 'd MMM') : '');
}

export function InboxPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | LeadSource>('all');
  const [reply, setReply] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [sending, setSending] = useState(false);
  const [mobilePane, setMobilePane] = useState<'list' | 'thread'>('list');
  const [loadedDraft, setLoadedDraft] = useState<LoadedDraft | null>(null);
  const [inboxReady, setInboxReady] = useState(false);
  const messages = useCrmStore((state) => state.messages);
  const leads = useCrmStore((state) => state.leads);
  const sendMessage = useCrmStore((state) => state.sendMessage);
  const refresh = useCrmStore((state) => state.refresh);
  const { notify } = useToast();
  const threadEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const markedReadRef = useRef(new Set<string>());

  useEffect(() => {
    fetch('/api/templates')
      .then((response) => (response.ok ? response.json() : { templates: [] }))
      .then((payload: { templates?: MessageTemplate[] }) => setTemplates(payload.templates ?? []))
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const leadId = search.get('leadId');
    const draftId = search.get('draftId');
    if (leadId) {
      setSelectedId(leadId);
      setMobilePane('thread');
    }
    if (!draftId) {
      setInboxReady(true);
      return;
    }
    void fetch(`/api/ai/replies/${draftId}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('AI draft could not be loaded');
        return (await response.json()) as {
          draft: {
            id: string;
            leadId: string;
            body: string;
            triggeringMessageId: string | null;
            generatedAt: string;
          };
        };
      })
      .then(({ draft }) => {
        setSelectedId(draft.leadId);
        setMobilePane('thread');
        setReply(draft.body);
        setLoadedDraft({
          id: draft.id,
          leadId: draft.leadId,
          body: draft.body,
          triggeringMessageId: draft.triggeringMessageId,
          generatedAt: draft.generatedAt,
        });
      })
      .catch(() => notify('AI draft could not be loaded'))
      .finally(() => setInboxReady(true));
  }, [notify]);

  const conversations = useMemo(() => {
    const leadIdsWithMessages = new Set(messages.map((message) => message.leadId));
    return [...leads]
      .filter((lead) => leadIdsWithMessages.has(lead.id))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }, [leads, messages]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return conversations.filter((lead) => {
      const matchesSource = source === 'all' || lead.source === source;
      const matchesQuery =
        !needle ||
        lead.name.toLowerCase().includes(needle) ||
        lead.company.toLowerCase().includes(needle);
      return matchesSource && matchesQuery;
    });
  }, [conversations, query, source]);

  const selected =
    conversations.find((lead) => lead.id === selectedId) ?? conversations[0] ?? null;
  const thread = useMemo(
    () =>
      messages
        .filter((message) => message.leadId === selected?.id)
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    [messages, selected?.id],
  );
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const preview = selectedTemplate && selected
    ? renderPreview(selectedTemplate, selected.name, selected.company, selected.followUpAt)
    : '';
  const draftStale = useMemo(() => {
    if (!loadedDraft?.triggeringMessageId) return false;
    const trigger = messages.find((message) => message.id === loadedDraft.triggeringMessageId);
    const latestInbound = messages
      .filter((message) => message.leadId === loadedDraft.leadId && message.direction === 'inbound')
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    return Boolean(trigger && latestInbound && latestInbound.sentAt > trigger.sentAt);
  }, [loadedDraft, messages]);

  useEffect(() => {
    if (!inboxReady || !selected) return;
    const compactLayout = window.matchMedia('(max-width: 780px)').matches;
    if (compactLayout && mobilePane !== 'thread') return;
    const key = `${selected.id}:${selected.lastActivityAt}`;
    if (markedReadRef.current.has(key)) return;
    markedReadRef.current.add(key);
    void fetch(`/api/conversations/${selected.id}/read`, { method: 'POST' }).catch(() => undefined);
  }, [inboxReady, mobilePane, selected]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [thread.length, selected?.id]);

  const chooseConversation = (leadId: string) => {
    setSelectedId(leadId);
    setTemplateId('');
    setFile(null);
    setLoadedDraft(null);
    setMobilePane('thread');
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    if (next && next.size > 64 * 1024 * 1024) {
      notify('Choose a file smaller than 64 MB');
      event.target.value = '';
      return;
    }
    setLoadedDraft(null);
    setFile(next);
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || sending || draftStale) return;
    if (!reply.trim() && !selectedTemplate && !file) return;
    setSending(true);
    let sentViaAi = false;
    try {
      if (loadedDraft && loadedDraft.leadId === selected.id && !selectedTemplate && !file) {
        const edited = await fetch(`/api/ai/replies/${loadedDraft.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: reply.trim() }),
        });
        if (!edited.ok) {
          const payload = (await edited.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? 'The draft could not be saved');
        }
        const sent = await fetch(`/api/ai/replies/${loadedDraft.id}/send`, {
          method: 'POST',
        });
        if (!sent.ok) {
          const payload = (await sent.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? 'The draft could not be sent');
        }
        sentViaAi = true;
      } else {
        await sendMessage(selected.id, selectedTemplate ? '' : reply.trim(), {
          templateId: selectedTemplate?.id,
          file: file ?? undefined,
        });
      }
      setLoadedDraft(null);
      setReply('');
      setTemplateId('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      notify('Message queued for WhatsApp');
      if (sentViaAi) await refresh().catch(() => undefined);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Message could not be queued');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page inbox-page">
      <PageHeader
        eyebrow="03 / Inbox"
        title="Inbox"
        description="WhatsApp and Meta conversations, in one calm workspace."
        actions={<span className="demo-label">Linked WhatsApp · manual sends</span>}
      />

      <div className={`inbox-layout${mobilePane === 'thread' ? ' mobile-thread' : ''}`}>
        <section className="inbox-list-pane" aria-label="Conversations">
          <div className="inbox-list-head">
            <label className="search-field">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
              />
            </label>
            <div className="source-filter-row" role="group" aria-label="Filter by source">
              {(['all', 'whatsapp', 'meta'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={source === item ? 'active' : ''}
                  onClick={() => setSource(item)}
                >
                  {item === 'all' ? 'All' : item === 'whatsapp' ? 'WhatsApp' : 'Meta'}
                </button>
              ))}
            </div>
          </div>
          <div className="conversation-list">
            {filtered.map((lead) => {
              const last = messages
                .filter((message) => message.leadId === lead.id)
                .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
              return (
                <button
                  type="button"
                  key={lead.id}
                  className={`conversation-item${selected?.id === lead.id ? ' active' : ''}`}
                  onClick={() => chooseConversation(lead.id)}
                >
                  <Avatar name={lead.name} />
                  <span className="conversation-copy">
                    <span className="conversation-topline">
                      <strong>{lead.name}</strong>
                      <small>{formatRelative(lead.lastActivityAt)}</small>
                    </span>
                    <span className="conversation-bottomline">
                      <span>
                        {last?.direction === 'outbound' ? 'You: ' : ''}
                        {last?.body || (last?.kind === 'image' ? 'Photo' : last?.kind === 'document' ? 'Document' : lead.initialMessage)}
                      </span>
                      <SourceBadge source={lead.source} />
                    </span>
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No conversations"
                description="Try another search or source filter."
              />
            ) : null}
          </div>
        </section>

        <section className="inbox-thread-pane" aria-label="Conversation">
          {selected ? (
            <>
              <header className="thread-head">
                <button
                  type="button"
                  className="mobile-back"
                  onClick={() => setMobilePane('list')}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft size={18} />
                </button>
                <Avatar name={selected.name} />
                <div className="thread-identity">
                  <h2>{selected.name}</h2>
                  <p>{selected.phone || selected.email || selected.company}</p>
                </div>
                <StatusPill status={selected.status} />
              </header>

              <div className="thread-messages" aria-live="polite">
                <div className="thread-date">
                  <span>{formatDate(thread[0]?.sentAt ?? selected.createdAt, 'd MMMM yyyy')}</span>
                </div>
                {thread.map((message) => (
                  <div key={message.id} className={`message-row message-${message.direction}`}>
                    <div className="message-bubble">
                      <MessageAttachment message={message} />
                      {message.body ? <p>{message.body}</p> : null}
                      {!message.body && !message.media ? (
                        <p className="muted-copy">{message.kind === 'text' ? 'Empty message' : `${message.kind} unavailable`}</p>
                      ) : null}
                      <span>
                        {formatDate(message.sentAt, 'h:mm a')}
                        {message.direction === 'outbound' ? ` · ${message.state}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>

              {loadedDraft ? (
                <div className={`inbox-ai-draft-note${draftStale ? ' stale' : ''}`} role="status">
                  <Sparkles size={14} aria-hidden="true" />
                  <span>
                    {draftStale
                      ? 'A newer client message arrived. Regenerate this draft before sending.'
                      : 'AI draft loaded · review before sending.'}
                  </span>
                  <Link to={`/ai/contacts/${loadedDraft.leadId}`}>
                    {draftStale ? 'Regenerate' : 'View evidence'}
                  </Link>
                </div>
              ) : null}

              <form className="composer live-composer" onSubmit={handleSend}>
                <label className="sr-only" htmlFor="reply-message">Write a WhatsApp message</label>
                {file ? (
                  <span className="composer-file">
                    <Paperclip size={13} />
                    {file.name}
                    <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment">
                      <X size={12} />
                    </button>
                  </span>
                ) : null}
                <input
                  id="reply-message"
                  value={selectedTemplate ? preview : reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Write a message…"
                  readOnly={Boolean(selectedTemplate)}
                />
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,audio/ogg,audio/mpeg,application/pdf"
                  onChange={handleFile}
                  aria-label="Attach a file"
                />
                <button
                  type="button"
                  className="composer-tool"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach a file"
                >
                  <Paperclip size={17} />
                </button>
                <select
                  className="composer-template"
                  value={templateId}
                  onChange={(event) => {
                    setTemplateId(event.target.value);
                    setLoadedDraft(null);
                    setReply('');
                  }}
                  aria-label="Message template"
                >
                  <option value="">Template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="composer-send"
                  disabled={sending || draftStale || (!reply.trim() && !selectedTemplate && !file)}
                  aria-label="Send WhatsApp message"
                >
                  <SendHorizontal size={17} />
                </button>
              </form>
            </>
          ) : (
            <EmptyState
              icon={Search}
              title="Select a conversation"
              description="Choose a lead to read their messages."
            />
          )}
        </section>

        <aside className="inbox-context-pane" aria-label="Lead context">
          {selected ? (
            <>
              <div className="context-head">
                <span>Lead profile</span>
                <Link to={`/leads/${selected.id}`} aria-label="Open full lead profile">
                  <ArrowUpRight size={16} />
                </Link>
              </div>
              <div className="context-identity">
                <Avatar name={selected.name} size="lg" />
                <h2>{selected.name}</h2>
                <p>{selected.company}</p>
                <StatusPill status={selected.status} />
              </div>
              <dl className="context-list">
                <div>
                  <dt>Phone</dt>
                  <dd>{selected.phone || '—'}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{selected.email || '—'}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd><SourceBadge source={selected.source} /></dd>
                </div>
                <div>
                  <dt>Estimated value</dt>
                  <dd className="strong-value">{formatMoney(selected.valueMinor, selected.currency)}</dd>
                </div>
                <div>
                  <dt>Next follow-up</dt>
                  <dd>{selected.followUpAt ? formatFollowUp(selected.followUpAt) : 'Not scheduled'}</dd>
                </div>
              </dl>
              <div className="context-actions">
                <Link to={`/leads/${selected.id}`} className="btn btn-secondary">
                  <CalendarClock size={15} /> Open lead
                </Link>
                <Link to="/proposals" className="btn btn-secondary">
                  <FileText size={15} /> Proposals
                </Link>
              </div>
              <p className="context-disclaimer">
                Messages are sent manually through your linked WhatsApp device. The phone can
                unlink this session at any time.
              </p>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function MessageAttachment({ message }: { message: Message }) {
  if (!message.media) return null;
  if (message.kind === 'image') {
    return <img className="message-media" src={message.media.url} alt={message.body || 'Image attachment'} loading="lazy" />;
  }
  if (message.kind === 'video') {
    return <video className="message-media" src={message.media.url} controls preload="metadata" />;
  }
  if (message.kind === 'audio') {
    return <audio className="message-audio" src={message.media.url} controls preload="metadata" />;
  }
  return (
    <a className="message-document" href={message.media.url} target="_blank" rel="noreferrer">
      <FileText size={16} /> {message.media.filename ?? 'Document'}
    </a>
  );
}
