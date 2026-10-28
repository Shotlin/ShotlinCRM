import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Info,
  Mic,
  Paperclip,
  Search,
  SendHorizontal,
  Sparkles,
  User,
  Video,
  X,
  CircleAlert,
  Lock,
} from 'lucide-react';
import { isToday, isYesterday, parseISO, differenceInCalendarDays } from 'date-fns';
import { Link } from '../../lib/router';
import { formatMoney } from '../../data/currencies';
import type { Lead, Message } from '../../data/types';
import { formatDate, formatFollowUp } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { StatusPill } from '../../components/ui/Badges';
import { useToast } from '../../components/ui/Toast';

type MessageTemplate = { id: string; name: string; body: string };
type LoadedDraft = {
  id: string;
  leadId: string;
  body: string;
  triggeringMessageId: string | null;
  generatedAt: string;
};
type Filter = 'all' | 'unread' | 'pipeline' | 'meta';

function renderPreview(template: MessageTemplate, name: string, company: string, followUpAt?: string) {
  return template.body
    .replace(/\{\{\s*name\s*\}\}/g, name)
    .replace(/\{\{\s*company\s*\}\}/g, company)
    .replace(/\{\{\s*followUpDate\s*\}\}/g, followUpAt ? formatDate(followUpAt, 'd MMM') : '');
}

// Same rules as the WhatsApp chat list: time today, "Yesterday", weekday, then date.
function listTime(iso: string) {
  const date = parseISO(iso);
  if (isToday(date)) return formatDate(iso, 'h:mm a');
  if (isYesterday(date)) return 'Yesterday';
  if (differenceInCalendarDays(new Date(), date) < 7) return formatDate(iso, 'EEEE');
  return formatDate(iso, 'dd/MM/yyyy');
}

function dayLabel(iso: string) {
  const date = parseISO(iso);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return formatDate(iso, 'd MMMM yyyy');
}

const previewText = (message: Message | undefined, fallback: string) => {
  if (!message) return fallback;
  if (message.body && !/^\[(image|video|audio|document)\]$/.test(message.body)) return message.body;
  if (message.kind === 'image') return 'Photo';
  if (message.kind === 'video') return 'Video';
  if (message.kind === 'audio') return 'Voice message';
  if (message.kind === 'document') return 'Document';
  return message.body || fallback;
};

function Ticks({ state, className = '' }: { state: Message['state']; className?: string }) {
  if (state === 'failed') return <CircleAlert size={15} className={`wa-tick wa-tick-failed ${className}`} aria-label="Failed" />;
  if (state === 'queued' || state === 'sample') return <Clock size={13} className={`wa-tick ${className}`} aria-label="Sending" />;
  if (state === 'sent') return <Check size={16} className={`wa-tick ${className}`} aria-label="Sent" />;
  return (
    <CheckCheck
      size={16}
      className={`wa-tick${state === 'read' ? ' wa-tick-read' : ''} ${className}`}
      aria-label={state === 'read' ? 'Read' : 'Delivered'}
    />
  );
}

function WaAvatar({ size = 49 }: { size?: number }) {
  return (
    <span className="wa-avatar" style={{ width: size, height: size }} aria-hidden="true">
      <User size={Math.round(size * 0.62)} strokeWidth={0} fill="currentColor" />
    </span>
  );
}

export function InboxPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [reply, setReply] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [sending, setSending] = useState(false);
  const [mobilePane, setMobilePane] = useState<'list' | 'thread'>('list');
  const [infoOpen, setInfoOpen] = useState(false);
  const [loadedDraft, setLoadedDraft] = useState<LoadedDraft | null>(null);
  const [inboxReady, setInboxReady] = useState(false);
  const messages = useCrmStore((state) => state.messages);
  const leads = useCrmStore((state) => state.leads);
  const chats = useCrmStore((state) => state.chats);
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

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pipelineIds = useMemo(() => new Set(leads.map((lead) => lead.id)), [leads]);

  const byLead = useMemo(() => {
    const map = new Map<string, Message[]>();
    for (const message of messages) {
      const list = map.get(message.leadId);
      if (list) list.push(message);
      else map.set(message.leadId, [message]);
    }
    for (const list of map.values()) list.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    return map;
  }, [messages]);

  const conversations = useMemo(
    () =>
      [...leads, ...chats]
        .filter((lead) => byLead.has(lead.id))
        .sort((a, b) => {
          const lastA = byLead.get(a.id)?.at(-1)?.sentAt ?? a.lastActivityAt;
          const lastB = byLead.get(b.id)?.at(-1)?.sentAt ?? b.lastActivityAt;
          return lastB.localeCompare(lastA);
        }),
    [leads, chats, byLead],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return conversations.filter((lead) => {
      if (filter === 'unread' && !(lead.unread && lead.unread > 0)) return false;
      if (filter === 'pipeline' && !pipelineIds.has(lead.id)) return false;
      if (filter === 'meta' && lead.source !== 'meta') return false;
      return (
        !needle ||
        lead.name.toLowerCase().includes(needle) ||
        lead.company.toLowerCase().includes(needle) ||
        lead.phone.replace(/\D/g, '').includes(needle.replace(/\D/g, '') || '\u0000')
      );
    });
  }, [conversations, query, filter, pipelineIds]);

  // Like WhatsApp Web, nothing is open until a chat is chosen.
  const selected: Lead | null = conversations.find((lead) => lead.id === selectedId) ?? null;
  const thread = useMemo(() => (selected ? byLead.get(selected.id) ?? [] : []), [byLead, selected]);
  const inPipeline = selected ? pipelineIds.has(selected.id) : false;
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const preview =
    selectedTemplate && selected
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
    const key = `${selected.id}:${selected.lastActivityAt}:${selected.unread ?? 0}`;
    if (markedReadRef.current.has(key)) return;
    markedReadRef.current.add(key);
    void fetch(`/api/conversations/${selected.id}/read`, { method: 'POST' })
      .then(() => (selected.unread ? refresh() : undefined))
      .catch(() => undefined);
  }, [inboxReady, mobilePane, selected, refresh]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [thread.length, selected?.id]);

  const chooseConversation = (leadId: string) => {
    setSelectedId(leadId);
    setTemplateId('');
    setFile(null);
    setReply('');
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

  const addToPipeline = async () => {
    if (!selected) return;
    try {
      const response = await fetch(`/api/conversations/${selected.id}/pipeline`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not add this chat to the pipeline');
      await refresh();
      notify('Added to pipeline as a new lead');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not add this chat to the pipeline');
    }
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
      if (sentViaAi) await refresh().catch(() => undefined);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Message could not be queued');
    } finally {
      setSending(false);
    }
  };

  const canSend = !sending && !draftStale && Boolean(reply.trim() || selectedTemplate || file);

  return (
    <div className={`wa-app${mobilePane === 'thread' ? ' wa-mobile-thread' : ''}${infoOpen ? ' wa-info-open' : ''}`}>
      <section className="wa-list" aria-label="Chats">
        <header className="wa-list-head">
          <h1>Chats</h1>
        </header>
        <div className="wa-search-wrap">
          <label className="wa-search">
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search or start a new chat"
              aria-label="Search chats"
            />
          </label>
        </div>
        <div className="wa-filters" role="group" aria-label="Filter chats">
          {(
            [
              ['all', 'All'],
              ['unread', 'Unread'],
              ['pipeline', 'Pipeline'],
              ['meta', 'Meta'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="wa-chat-list">
          {filtered.map((lead) => {
            const list = byLead.get(lead.id) ?? [];
            const last = list.at(-1);
            const unread = lead.unread ?? 0;
            return (
              <button
                type="button"
                key={lead.id}
                className={`wa-chat-row${selected?.id === lead.id ? ' active' : ''}`}
                onClick={() => chooseConversation(lead.id)}
              >
                <WaAvatar />
                <span className="wa-chat-main">
                  <span className="wa-chat-top">
                    <strong>{lead.name}</strong>
                    <small className={unread ? 'unread' : ''}>
                      {listTime(last?.sentAt ?? lead.lastActivityAt)}
                    </small>
                  </span>
                  <span className="wa-chat-bottom">
                    <span className="wa-chat-preview">
                      {last?.direction === 'outbound' ? <Ticks state={last.state} /> : null}
                      {last?.kind === 'image' ? <Camera size={15} className="wa-preview-icon" /> : null}
                      {last?.kind === 'video' ? <Video size={15} className="wa-preview-icon" /> : null}
                      {last?.kind === 'audio' ? <Mic size={15} className="wa-preview-icon" /> : null}
                      {last?.kind === 'document' ? <FileText size={15} className="wa-preview-icon" /> : null}
                      <span>{previewText(last, lead.initialMessage)}</span>
                    </span>
                    {unread > 0 ? <span className="wa-badge">{unread > 99 ? '99+' : unread}</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <p className="wa-empty-list">
              {conversations.length === 0 ? 'No chats yet. Messages will appear here.' : 'No chats found.'}
            </p>
          ) : null}
        </div>
      </section>

      <section className="wa-thread" aria-label="Conversation">
        {selected ? (
          <>
            <header className="wa-thread-head">
              <button
                type="button"
                className="wa-icon-btn wa-back"
                onClick={() => setMobilePane('list')}
                aria-label="Back to chats"
              >
                <ArrowLeft size={20} />
              </button>
              <button type="button" className="wa-identity" onClick={() => setInfoOpen((open) => !open)}>
                <WaAvatar size={40} />
                <span className="wa-identity-copy">
                  <strong>{selected.name}</strong>
                  <small>{selected.phone || selected.email || selected.company}</small>
                </span>
              </button>
              <div className="wa-head-actions">
                {inPipeline ? (
                  <span className="wa-stage">
                    <StatusPill status={selected.status} />
                  </span>
                ) : (
                  <button type="button" className="wa-pill-btn" onClick={addToPipeline}>
                    Add to pipeline
                  </button>
                )}
                <button
                  type="button"
                  className={`wa-icon-btn${infoOpen ? ' active' : ''}`}
                  onClick={() => setInfoOpen((open) => !open)}
                  aria-label="Contact info"
                  aria-pressed={infoOpen}
                >
                  <Info size={20} />
                </button>
              </div>
            </header>

            <div className="wa-messages" aria-live="polite">
              <div className="wa-messages-inner">
                {thread.map((message, index) => {
                  const previous = thread[index - 1];
                  const newDay = !previous || dayLabel(previous.sentAt) !== dayLabel(message.sentAt);
                  const tail = newDay || previous?.direction !== message.direction;
                  return (
                    <div key={message.id} className="wa-message-block">
                      {newDay ? (
                        <div className="wa-day">
                          <span>{dayLabel(message.sentAt)}</span>
                        </div>
                      ) : null}
                      <div className={`wa-row wa-${message.direction}${tail ? ' tail' : ''}`}>
                        <div className={`wa-bubble${message.media && !message.body ? ' media-only' : ''}`}>
                          <MessageAttachment message={message} />
                          {message.body && !(message.media && /^\[\w+\]$/.test(message.body)) ? (
                            <p>{message.body}</p>
                          ) : null}
                          {!message.body && !message.media ? (
                            <p className="wa-unavailable">
                              {message.kind === 'text' ? 'Empty message' : `${message.kind} unavailable`}
                            </p>
                          ) : null}
                          <span className="wa-meta">
                            {formatDate(message.sentAt, 'h:mm a')}
                            {message.direction === 'outbound' ? <Ticks state={message.state} /> : null}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>
            </div>

            {loadedDraft ? (
              <div className={`wa-draft-note${draftStale ? ' stale' : ''}`} role="status">
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

            {file ? (
              <div className="wa-attach-preview">
                {filePreview ? (
                  <img src={filePreview} alt="" />
                ) : (
                  <span className="wa-attach-icon">
                    <FileText size={28} />
                  </span>
                )}
                <span className="wa-attach-name">{file.name}</span>
                <button type="button" className="wa-icon-btn" onClick={() => setFile(null)} aria-label="Remove attachment">
                  <X size={20} />
                </button>
              </div>
            ) : null}

            <form className="wa-composer" onSubmit={handleSend}>
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
                className="wa-icon-btn"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach a file"
              >
                <Paperclip size={22} />
              </button>
              <select
                className="wa-template"
                value={templateId}
                onChange={(event) => {
                  setTemplateId(event.target.value);
                  setLoadedDraft(null);
                  setReply('');
                }}
                aria-label="Message template"
              >
                <option value="">Templates</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="reply-message">
                Type a message
              </label>
              <input
                id="reply-message"
                className="wa-input"
                value={selectedTemplate ? preview : reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Type a message"
                readOnly={Boolean(selectedTemplate)}
                autoComplete="off"
              />
              <button
                type="submit"
                className={`wa-send${canSend ? ' ready' : ''}`}
                disabled={!canSend}
                aria-label="Send message"
              >
                <SendHorizontal size={22} />
              </button>
            </form>
          </>
        ) : (
          <div className="wa-welcome">
            <div className="wa-welcome-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">
                <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.200Zm4.500-6.100c-.2-.1-1.500-.7-1.700-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.6.1a6.700 6.700 0 0 1-3.300-2.900c-.2-.4.200-.4.700-1.300.1-.1 0-.3 0-.4l-.8-1.800c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.300 3 3 0 0 0-.9 2.200 5.300 5.300 0 0 0 1.100 2.800 12 12 0 0 0 4.600 4c1.700.7 2.400.8 3.300.7a2.800 2.800 0 0 0 1.800-1.300 2.300 2.300 0 0 0 .2-1.300c-.1-.1-.3-.2-.6-.3Z" />
              </svg>
            </div>
            <h2>Shotlin CRM for WhatsApp</h2>
            <p>Send and receive messages with your linked WhatsApp, right here in your CRM.</p>
            <small>
              <Lock size={12} aria-hidden="true" /> Your chats stay on your own server
            </small>
          </div>
        )}
      </section>

      {selected && infoOpen ? (
        <aside className="wa-info" aria-label="Contact info">
          <header className="wa-info-head">
            <button type="button" className="wa-icon-btn" onClick={() => setInfoOpen(false)} aria-label="Close contact info">
              <X size={20} />
            </button>
            <h2>Contact info</h2>
          </header>
          <div className="wa-info-body">
            <div className="wa-info-card wa-info-identity">
              <WaAvatar size={150} />
              <h3>{selected.name}</h3>
              <p>{selected.phone}</p>
            </div>
            <div className="wa-info-card">
              <dl>
                <div>
                  <dt>Phone</dt>
                  <dd>{selected.phone || '—'}</dd>
                </div>
                {selected.email ? (
                  <div>
                    <dt>Email</dt>
                    <dd>{selected.email}</dd>
                  </div>
                ) : null}
                {inPipeline ? (
                  <>
                    <div>
                      <dt>Stage</dt>
                      <dd>
                        <StatusPill status={selected.status} />
                      </dd>
                    </div>
                    <div>
                      <dt>Estimated value</dt>
                      <dd>{formatMoney(selected.valueMinor, selected.currency)}</dd>
                    </div>
                    <div>
                      <dt>Next follow-up</dt>
                      <dd>{selected.followUpAt ? formatFollowUp(selected.followUpAt) : 'Not scheduled'}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </div>
            <div className="wa-info-card wa-info-actions">
              {inPipeline ? (
                <>
                  <Link to={`/leads/${selected.id}`} className="wa-action">
                    Open lead
                  </Link>
                  <Link to="/proposals" className="wa-action">
                    Proposals
                  </Link>
                </>
              ) : (
                <button type="button" className="wa-action" onClick={addToPipeline}>
                  Add to pipeline
                </button>
              )}
            </div>
            <p className="wa-info-note">
              Messages are sent through your linked WhatsApp device. The phone can unlink this session at any
              time.
            </p>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function MessageAttachment({ message }: { message: Message }) {
  if (!message.media) return null;
  if (message.kind === 'image') {
    return (
      <a href={message.media.url} target="_blank" rel="noreferrer" className="wa-media-link">
        <img className="wa-media" src={message.media.url} alt={message.body || 'Image attachment'} loading="lazy" />
      </a>
    );
  }
  if (message.kind === 'video') {
    return <video className="wa-media" src={message.media.url} controls preload="metadata" />;
  }
  if (message.kind === 'audio') {
    return <audio className="wa-audio" src={message.media.url} controls preload="metadata" />;
  }
  return (
    <a className="wa-document" href={message.media.url} target="_blank" rel="noreferrer">
      <FileText size={28} />
      <span>{message.media.filename ?? 'Document'}</span>
    </a>
  );
}
