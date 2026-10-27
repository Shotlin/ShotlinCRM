'use client';

import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clipboard,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AiContactDetail, AiPriority } from '../../data/ai';
import { formatMoney } from '../../data/currencies';
import { formatFollowUp, formatRelative, LEAD_STATUS_LABELS, SOURCE_LABELS } from '../../lib/format';
import type { LeadStatus } from '../../data/types';
import { Link, useParams } from '../../lib/router';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { useToast } from '../../components/ui/Toast';

const priorityLabels: Record<AiPriority, string> = {
  high: 'High priority',
  secondary: 'Secondary',
  normal: 'Routine',
};

function formatDelay(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

async function responseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export function ContactIntelligencePage() {
  const params = useParams<{ leadId: string }>();
  const leadId = params.leadId;
  const { notify } = useToast();
  const [contact, setContact] = useState<AiContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [instruction, setInstruction] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectDueAt, setProjectDueAt] = useState('');
  const [projectStatus, setProjectStatus] = useState('active');
  const draftDirtyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/ai/contacts/${leadId}`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => null)) as
        | (AiContactDetail & { error?: string })
        | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Contact analysis could not be loaded');
      setContact(payload);
      if (!draftDirtyRef.current) setDraftBody(payload?.draft?.body ?? '');
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Contact analysis could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    draftDirtyRef.current = false;
    void load();
    const events = new EventSource('/api/events');
    events.onmessage = () => void load();
    return () => events.close();
  }, [load]);

  const generate = async () => {
    if (!contact) return;
    if (contact.draft && !window.confirm('Replace the current draft with a fresh AI draft?')) return;
    setBusyAction('generate');
    try {
      const response = await fetch('/api/ai/replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          instruction: instruction.trim() || undefined,
          force: Boolean(contact.draft),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, 'Reply could not be generated'));
      const payload = (await response.json()) as {
        draft: Omit<NonNullable<AiContactDetail['draft']>, 'stale'>;
      };
      const generatedDraft = { ...payload.draft, stale: false };
      setContact((current) => (current ? { ...current, draft: generatedDraft } : current));
      setDraftBody(payload.draft.body);
      draftDirtyRef.current = false;
      notify('Reply draft generated for review');
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : 'Reply could not be generated');
    } finally {
      setBusyAction(null);
    }
  };

  const saveDraft = async () => {
    if (!contact?.draft) return;
    setBusyAction('save');
    try {
      const response = await fetch(`/api/ai/replies/${contact.draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draftBody }),
      });
      if (!response.ok) throw new Error(await responseError(response, 'Draft could not be saved'));
      setContact((current) =>
        current?.draft
          ? { ...current, draft: { ...current.draft, state: 'edited', body: draftBody } }
          : current,
      );
      draftDirtyRef.current = false;
      notify('Draft saved');
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : 'Draft could not be saved');
    } finally {
      setBusyAction(null);
    }
  };

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draftBody);
      notify('Draft copied');
    } catch {
      notify('Could not copy the draft');
    }
  };

  const refreshBrief = async () => {
    setBusyAction('brief');
    try {
      const response = await fetch(`/api/ai/contacts/${leadId}/brief`, { method: 'POST' });
      if (!response.ok) throw new Error(await responseError(response, 'Analysis could not be refreshed'));
      const payload = (await response.json()) as {
        brief: NonNullable<AiContactDetail['brief']>;
      };
      setContact((current) =>
        current
          ? {
              ...current,
              brief: {
                ...payload.brief,
                generatedAt: new Date(payload.brief.generatedAt).toISOString(),
              },
            }
          : current,
      );
      notify('Contact analysis refreshed');
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : 'Analysis could not be refreshed');
    } finally {
      setBusyAction(null);
    }
  };

  const addProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!contact) return;
    setBusyAction('project');
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          clientId: contact.lead.clientId ?? undefined,
          title: projectTitle,
          status: projectStatus,
          dueAt: new Date(projectDueAt).toISOString(),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, 'Project deadline could not be saved'));
      setProjectTitle('');
      setProjectDueAt('');
      await load();
      notify('Project deadline saved');
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : 'Project deadline could not be saved');
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="page ai-page">
        <div className="route-loading" role="status">
          <span className="route-loading-mark" aria-hidden="true" />
          Loading contact intelligence
        </div>
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="page ai-page">
        <div className="ai-error" role="alert">
          <TriangleAlert size={18} />
          <p>{error ?? 'Contact analysis is unavailable'}</p>
          <Link to="/ai" className="btn btn-secondary">Back to AI assistant</Link>
        </div>
      </div>
    );
  }

  const latestInbound = [...contact.messages].reverse().find((message) => message.direction === 'inbound');
  const latestAnalysis = latestInbound
    ? contact.analyses.find((analysis) => analysis.messageId === latestInbound.id)
    : contact.analyses[0];
  const leadRecommendation = contact.recommendations[0];
  const evidence = leadRecommendation?.evidence ?? [];
  const visibleMessages = contact.messages.slice(-8);

  return (
    <div className="page ai-page ai-contact-page">
      <Link to="/ai" className="ai-back-link">
        <ArrowLeft size={14} /> AI assistant
      </Link>
      <PageHeader
        eyebrow="AI assistant / Contact"
        title={contact.lead.name}
        description={`${contact.lead.company || 'Personal contact'} · ${
          LEAD_STATUS_LABELS[contact.lead.status as LeadStatus] ?? contact.lead.status
        } · ${SOURCE_LABELS[contact.lead.source]}`}
        actions={
          <>
            <Link to={`/inbox?leadId=${contact.lead.id}`} className="btn btn-secondary">
              Open conversation
            </Link>
            <Link to={`/leads/${contact.lead.id}`} className="btn btn-primary">
              Open lead
            </Link>
          </>
        }
      />

      {!contact.configured ? (
        <section className="ai-notice" aria-label="AI provider setup">
          <span className="ai-notice-icon"><Sparkles size={16} /></span>
          <div>
            <strong>Conversation understanding is not connected.</strong>
            <p>
              Reply delay and business evidence are live. Connect a provider to extract intent,
              commitments, and reply drafts.
            </p>
          </div>
          <Link to="/settings/ai" className="btn btn-secondary">Configure AI</Link>
        </section>
      ) : null}

      <div className="ai-contact-layout">
        <aside className="ai-contact-column">
          <section className="card section-card ai-panel" aria-labelledby="ai-why-title">
            <div className="ai-panel-head">
              <h2 id="ai-why-title">Why this matters</h2>
              <span className={`ai-priority-tag ai-priority-${leadRecommendation?.priority ?? 'normal'}`}>
                <span aria-hidden="true" />
                {priorityLabels[leadRecommendation?.priority ?? 'normal']}
              </span>
            </div>
            <div className="ai-contact-person">
              <Avatar name={contact.lead.name} size="lg" />
              <div>
                <strong>{contact.lead.name}</strong>
                <small>{formatMoney(contact.lead.valueMinor, contact.lead.currency)} estimated value</small>
              </div>
            </div>
            {contact.delayedReply ? (
              <p className="ai-delay">
                Reply delayed {formatDelay(contact.delayedReply.minutes)}
              </p>
            ) : (
              <p className="ai-delay ai-delay-clear"><Check size={14} /> No inbound reply is waiting</p>
            )}
            <div className="ai-evidence-list">
              {evidence.map((item) => (
                <div key={`${item.kind}-${item.id}`}>
                  <span>{item.label}</span>
                  <p>{item.quote}</p>
                </div>
              ))}
              {contact.lead.followUpAt ? (
                <div>
                  <span>Next follow-up</span>
                  <p>{formatFollowUp(contact.lead.followUpAt)}</p>
                </div>
              ) : null}
            </div>
            {leadRecommendation?.scoreFactors.length ? (
              <div className="ai-score-breakdown">
                <span>Score {leadRecommendation.score}</span>
                <p>{leadRecommendation.scoreFactors.map((factor) => factor.label).join(' · ')}</p>
              </div>
            ) : null}
          </section>

          <section className="card section-card ai-panel" aria-labelledby="ai-projects-title">
            <div className="ai-panel-head">
              <h2 id="ai-projects-title">Project deadlines</h2>
            </div>
            <div className="ai-project-list">
              {contact.projects.map((project) => (
                <div key={project.id} className="ai-project-row">
                  <span>
                    <strong>{project.title}</strong>
                    <small>{project.status.replace('_', ' ')} · due {new Date(project.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
                  </span>
                  {project.overdue ? <em>Overdue</em> : null}
                </div>
              ))}
              {contact.projects.length === 0 ? <p className="muted-copy">No project deadline recorded.</p> : null}
            </div>
            {contact.lead.clientId ? (
              <form className="ai-inline-form" onSubmit={addProject}>
                <label className="field">
                  <span>Project</span>
                  <input
                    value={projectTitle}
                    onChange={(event) => setProjectTitle(event.target.value)}
                    placeholder="Launch film"
                    maxLength={300}
                    required
                  />
                </label>
                <label className="field">
                  <span>Deadline</span>
                  <input
                    type="datetime-local"
                    value={projectDueAt}
                    onChange={(event) => setProjectDueAt(event.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>Status</span>
                  <select value={projectStatus} onChange={(event) => setProjectStatus(event.target.value)}>
                    <option value="active">Active</option>
                    <option value="on_hold">On hold</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <button type="submit" className="btn btn-secondary btn-sm" disabled={busyAction === 'project'}>
                  {busyAction === 'project' ? 'Saving…' : 'Add deadline'}
                </button>
              </form>
            ) : (
              <p className="field-hint">Convert this lead to a client before recording project deadlines.</p>
            )}
          </section>
        </aside>

        <section className="card ai-panel ai-conversation-panel" aria-labelledby="ai-conversation-title">
          <div className="ai-panel-head">
            <div>
              <h2 id="ai-conversation-title">Conversation intelligence</h2>
              <p>The latest context and what the assistant found.</p>
            </div>
          </div>
          <div className="ai-message-stack">
            {visibleMessages.map((message) => (
              <article key={message.id} className={`ai-message ai-message-${message.direction}`}>
                <span>{message.direction === 'inbound' ? 'Client' : 'You'}</span>
                <p>{message.body || '[Media message]'}</p>
                <time>{formatRelative(message.sentAt)}</time>
              </article>
            ))}
            {visibleMessages.length === 0 ? <p className="muted-copy">No messages yet.</p> : null}
          </div>

          <div className="ai-analysis-card">
            <div className="ai-panel-head">
              <div>
                <h2>What AI found</h2>
                <p>{latestAnalysis ? 'Grounded in the latest analyzed message.' : 'Waiting for message analysis.'}</p>
              </div>
              {latestAnalysis ? (
                <span className="ai-confidence">{latestAnalysis.confidence}% confidence</span>
              ) : null}
            </div>
            {latestAnalysis ? (
              <>
                <p className="ai-analysis-summary">{latestAnalysis.summary}</p>
                <dl className="ai-analysis-facts">
                  <div><dt>Intent</dt><dd>{latestAnalysis.intent.replaceAll('_', ' ')}</dd></div>
                  <div><dt>Sentiment</dt><dd>{latestAnalysis.sentiment}</dd></div>
                  <div><dt>Urgency</dt><dd>{latestAnalysis.urgency}</dd></div>
                  <div><dt>Reply needed</dt><dd>{latestAnalysis.needsReply ? 'Yes' : 'No'}</dd></div>
                </dl>
                {latestAnalysis.requestedActions.length ? (
                  <div className="ai-analysis-list">
                    <span>Requested actions</span>
                    <ul>{latestAnalysis.requestedActions.map((action) => <li key={action}>{action}</li>)}</ul>
                  </div>
                ) : null}
                {latestAnalysis.commitments.length ? (
                  <div className="ai-analysis-list">
                    <span>Commitments</span>
                    <ul>{latestAnalysis.commitments.map((commitment) => <li key={commitment.text}>{commitment.text}</li>)}</ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="muted-copy">
                {contact.configured
                  ? 'Analysis will appear after the worker processes the conversation.'
                  : 'Connect an AI provider to read this conversation.'}
              </p>
            )}
          </div>

          <div className="ai-brief-block">
            <div className="ai-panel-head">
              <div>
                <h2>Contact brief</h2>
                <p>{contact.brief ? `Updated ${formatRelative(contact.brief.generatedAt)}` : 'A concise business summary.'}</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void refreshBrief()}
                disabled={!contact.configured || busyAction === 'brief'}
              >
                <RefreshCw size={13} /> {busyAction === 'brief' ? 'Refreshing…' : 'Refresh analysis'}
              </button>
            </div>
            {contact.brief ? (
              <div className="ai-brief-content">
                <p>{contact.brief.summary}</p>
                <p className="ai-brief-state">{contact.brief.businessState}</p>
                <div className="ai-brief-columns">
                  <div><span>Open loops</span><ul>{contact.brief.openLoops.map((loop) => <li key={loop}>{loop}</li>)}</ul></div>
                  <div><span>Risks</span><ul>{contact.brief.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>
                </div>
                <p className="ai-next-action"><strong>Next best action</strong>{contact.brief.nextBestAction}</p>
              </div>
            ) : (
              <p className="muted-copy">
                {contact.configured
                  ? 'Refresh analysis to create a contact-level brief.'
                  : 'Available after AI is connected.'}
              </p>
            )}
          </div>
        </section>

        <aside className="ai-contact-column ai-reply-column">
          <section className="card ai-panel ai-reply-panel" aria-labelledby="ai-reply-title">
            <div className="ai-panel-head">
              <div>
                <h2 id="ai-reply-title">Suggested reply</h2>
                <p>{contact.draft ? 'Review every word before it leaves.' : 'A draft using the available context.'}</p>
              </div>
              {contact.draft ? <span className="ai-draft-state">Draft · not sent</span> : null}
            </div>

            {contact.draft ? (
              <>
                <label className="sr-only" htmlFor="ai-draft-body">Suggested reply</label>
                <textarea
                  id="ai-draft-body"
                  className="ai-reply-textarea"
                  value={draftBody}
                  onChange={(event) => {
                    draftDirtyRef.current = true;
                    setDraftBody(event.target.value);
                  }}
                  rows={11}
                  maxLength={8_000}
                />
                {contact.draft.stale ? (
                  <p className="ai-stale-draft">
                    A newer client message arrived. Regenerate this draft before sending.
                  </p>
                ) : null}
                {contact.draft.missingInfoQuestions.length ? (
                  <div className="ai-missing-info">
                    <span>Confirm before sending</span>
                    <ul>{contact.draft.missingInfoQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
                  </div>
                ) : null}
                {contact.draft.evidence.length ? (
                  <div className="ai-draft-evidence">
                    {contact.draft.evidence.slice(0, 4).map((item) => (
                      <span key={`${item.kind}-${item.id}`}>{item.label}</span>
                    ))}
                  </div>
                ) : null}
                <div className="ai-reply-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void saveDraft()}
                    disabled={busyAction === 'save' || !draftBody.trim()}
                  >
                    {busyAction === 'save' ? 'Saving…' : 'Save draft'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void copyDraft()}
                  >
                    <Clipboard size={14} /> Copy
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary ai-regenerate"
                  onClick={() => void generate()}
                  disabled={busyAction === 'generate'}
                >
                  <RefreshCw size={14} /> Regenerate
                </button>
                {contact.draft.stale ? (
                  <button type="button" className="btn btn-primary ai-open-inbox" disabled>
                    Edit in inbox <ArrowUpRight size={14} />
                  </button>
                ) : (
                  <Link
                    to={`/inbox?leadId=${leadId}&draftId=${contact.draft.id}`}
                    className="btn btn-primary ai-open-inbox"
                  >
                    Edit in inbox <ArrowUpRight size={14} />
                  </Link>
                )}
              </>
            ) : (
              <div className="ai-reply-empty">
                <Sparkles size={20} />
                <strong>No draft yet</strong>
                <p>
                  {contact.configured
                    ? 'Generate a reply from the conversation, proposal, payment, and project evidence.'
                    : 'Connect an AI provider to generate a draft.'}
                </p>
                {contact.configured ? (
                  <>
                    <label className="field">
                      <span>Optional instruction</span>
                      <input
                        value={instruction}
                        onChange={(event) => setInstruction(event.target.value)}
                        maxLength={500}
                        placeholder="Offer the portrait add-on"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void generate()}
                      disabled={busyAction === 'generate'}
                    >
                      {busyAction === 'generate' ? 'Drafting…' : 'Generate reply'}
                    </button>
                  </>
                ) : (
                  <Link to="/settings/ai" className="btn btn-secondary">Configure AI</Link>
                )}
              </div>
            )}
            <p className="ai-safety-note">
              <ShieldCheck size={14} /> AI drafts require your review. Nothing is sent automatically.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
