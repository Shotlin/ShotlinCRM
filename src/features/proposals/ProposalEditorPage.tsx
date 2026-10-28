import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, FileText, Plus, Send, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from '../../lib/router';
import { addDays, format } from 'date-fns';
import {
  CURRENCIES,
  CURRENCY_SYMBOLS,
  formatMoney,
  lineItemsTotalMinor,
} from '../../data/currencies';
import type { Currency, LineItem, Proposal, ProposalStatus } from '../../data/types';
import { formatDate, PROPOSAL_STATUS_LABELS, toMoneyInput } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusPill } from '../../components/ui/Badges';
import { useToast } from '../../components/ui/Toast';

type EditorLine = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

type ProposalDraft = {
  title: string;
  clientId: string;
  leadId: string;
  currency: Currency;
  validUntil: string;
  notes: string;
  lines: EditorLine[];
};

const toEditorLine = (line: LineItem): EditorLine => ({
  id: line.id,
  description: line.description,
  quantity: String(line.quantity),
  unitPrice: toMoneyInput(line.unitPriceMinor),
});

const toStoreLines = (lines: EditorLine[]): LineItem[] =>
  lines.map((line) => ({
    id: line.id,
    description: line.description.trim() || 'Untitled item',
    quantity: Math.max(1, Number(line.quantity) || 1),
    unitPriceMinor: Math.round((Number(line.unitPrice) || 0) * 100),
  }));

const emptyDraft: ProposalDraft = {
  title: '',
  clientId: '',
  leadId: '',
  currency: 'INR',
  validUntil: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
  notes: '',
  lines: [{ id: 'new-line', description: '', quantity: '1', unitPrice: '' }],
};

// "New proposal" opens this editor at /proposals/new/edit. Nothing is saved until you press Save.
const NEW_ID = 'new';

export function ProposalEditorPage() {
  const { proposalId } = useParams();
  const isNew = proposalId === NEW_ID;
  const { notify } = useToast();
  const navigate = useNavigate();
  const stored = useCrmStore((state) => state.proposals.find((item) => item.id === proposalId));
  const clients = useCrmStore((state) => state.clients);
  const leads = useCrmStore((state) => state.leads);
  const createProposal = useCrmStore((state) => state.createProposal);
  const updateProposal = useCrmStore((state) => state.updateProposal);
  const setProposalStatus = useCrmStore((state) => state.setProposalStatus);
  const convertLeadToClient = useCrmStore((state) => state.convertLeadToClient);
  const flush = useCrmStore((state) => state.flush);
  const [draft, setDraft] = useState<ProposalDraft>(emptyDraft);
  const [error, setError] = useState('');

  // A stand-in shown while the proposal is new. It is never stored.
  const blankProposal = useMemo<Proposal>(
    () => ({
      id: NEW_ID,
      number: 'Assigned when saved',
      title: '',
      status: 'draft',
      currency: 'INR',
      issuedAt: new Date().toISOString(),
      validUntil: '',
      notes: '',
      updatedAt: new Date().toISOString(),
      lineItems: [],
    }),
    [],
  );
  const proposal = stored ?? (isNew ? blankProposal : undefined);

  useEffect(() => {
    if (isNew) {
      // The client, lead, title and value can arrive in the address so the form starts filled in.
      const query = new URLSearchParams(window.location.search);
      const value = Number(query.get('value') ?? 0);
      const currency = query.get('currency');
      setDraft({
        ...emptyDraft,
        title: query.get('title') ?? '',
        clientId: query.get('clientId') ?? '',
        leadId: query.get('leadId') ?? '',
        currency: (CURRENCIES as readonly string[]).includes(currency ?? '') ? (currency as Currency) : 'INR',
        lines: [{ id: `line-${Date.now()}`, description: value > 0 ? 'Production' : '', quantity: '1', unitPrice: value > 0 ? toMoneyInput(value) : '' }],
      });
      setError('');
      return;
    }
    if (!stored) return;
    setDraft({
      title: stored.title,
      clientId: stored.clientId ?? '',
      leadId: stored.leadId ?? '',
      currency: stored.currency,
      validUntil: stored.validUntil.slice(0, 10),
      notes: stored.notes,
      lines:
        stored.lineItems.length > 0
          ? stored.lineItems.map(toEditorLine)
          : [{ id: `line-${Date.now()}`, description: '', quantity: '1', unitPrice: '' }],
    });
    setError('');
    // Only reload the draft when switching records, not on background CRM refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.id]);

  const selectedClient = clients.find((client) => client.id === draft.clientId);
  const selectedLead = leads.find((lead) => lead.id === draft.leadId);
  const previewClient = selectedClient?.company ?? selectedLead?.company ?? 'Select a client';
  const previewContact = selectedClient?.name ?? selectedLead?.name ?? 'Add a client to this proposal';
  const totalMinor = useMemo(
    () =>
      lineItemsTotalMinor(
        draft.lines.map((line) => ({
          quantity: Math.max(1, Number(line.quantity) || 1),
          unitPriceMinor: Math.round((Number(line.unitPrice) || 0) * 100),
        })),
      ),
    [draft.lines],
  );

  if (!proposal) {
    return (
      <div className="page">
        <EmptyState
          icon={FileText}
          title="Proposal not found"
          description="Return to proposals and choose a record to edit."
          action={
            <Link to="/proposals" className="btn btn-primary">
              Back to proposals
            </Link>
          }
        />
      </div>
    );
  }

  const patch = <K extends keyof ProposalDraft>(key: K, value: ProposalDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const updateLine = (id: string, patchLine: Partial<EditorLine>) => {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.id === id ? { ...line, ...patchLine } : line,
      ),
    }));
  };

  const addLine = () => {
    setDraft((current) => ({
      ...current,
      lines: [
        ...current.lines,
        { id: `line-${Date.now()}`, description: '', quantity: '1', unitPrice: '' },
      ],
    }));
  };

  const removeLine = (id: string) => {
    setDraft((current) => ({
      ...current,
      lines:
        current.lines.length === 1
          ? current.lines
          : current.lines.filter((line) => line.id !== id),
    }));
  };

  // Saves the draft and returns the proposal's id, or null when something is missing.
  // For a new proposal this is the moment the record is created.
  const persist = (status?: ProposalStatus): string | null => {
    if (!draft.title.trim()) {
      setError('Add a proposal title before saving.');
      return null;
    }
    setError('');
    const fields = {
      title: draft.title.trim(),
      clientId: draft.clientId || undefined,
      leadId: draft.leadId || undefined,
      currency: draft.currency,
      validUntil: `${draft.validUntil}T18:00:00`,
      notes: draft.notes,
      lineItems: toStoreLines(draft.lines),
    };
    let id = proposal.id;
    if (isNew) id = createProposal(fields).id;
    else updateProposal(id, fields);
    if (status) setProposalStatus(id, status);
    return id;
  };

  const handleSave = async () => {
    const id = persist();
    if (!id) return;
    await flush();
    notify(isNew ? 'Proposal created' : 'Proposal saved');
    if (isNew) navigate(`/proposals/${id}/edit`);
  };

  const handleStatus = async (status: ProposalStatus) => {
    const id = persist(status);
    if (!id) return;
    if (status === 'accepted') {
      let clientId = draft.clientId;
      if (!clientId && draft.leadId) {
        clientId = convertLeadToClient(draft.leadId);
        updateProposal(id, { clientId });
        setDraft((current) => ({ ...current, clientId }));
      }
      await flush();
      notify('Proposal accepted and lead moved forward');
    } else {
      await flush();
      notify(`Proposal marked as ${PROPOSAL_STATUS_LABELS[status].toLowerCase()}`);
    }
    if (isNew) navigate(`/proposals/${id}/edit`);
  };

  return (
    <div className="page editor-page">
      <div className="editor-topbar">
        <Link to="/proposals" className="back-link">
          <ArrowLeft size={15} /> Proposals
        </Link>
        <span className="eyebrow">08 / Proposal editor</span>
      </div>

      <div className="editor-title-row">
        <div>
          <h1>{isNew ? 'New proposal' : proposal.status === 'draft' ? 'Edit proposal' : proposal.title}</h1>
          <p>{isNew ? 'Nothing is saved until you press Save.' : 'Changes in the editor update the live summary in real time.'}</p>
        </div>
        <div className="editor-top-actions">
          <StatusPill status={proposal.status} kind="proposal" />
          <button type="button" className="btn btn-secondary" onClick={handleSave}>
            <Check size={15} /> {isNew ? 'Save proposal' : 'Save changes'}
          </button>
          {proposal.status === 'draft' ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleStatus('sent')}
            >
              <Send size={15} /> Mark as sent
            </button>
          ) : null}
          {proposal.status === 'sent' ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleStatus('accepted')}
            >
              <Check size={15} /> Mark accepted
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="form-error editor-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="split-editor">
        <div className="editor-form">
          <section className="card editor-section">
            <div className="editor-section-head">
              <div>
                <span className="card-kicker">01</span>
                <h2>Proposal details</h2>
              </div>
              <span className="mono-label">{proposal.number}</span>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Client</span>
                <select
                  value={draft.clientId}
                  onChange={(event) => patch('clientId', event.target.value)}
                >
                  <option value="">Select a client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.company} · {client.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Linked lead</span>
                <select
                  value={draft.leadId}
                  onChange={(event) => patch('leadId', event.target.value)}
                >
                  <option value="">No linked lead</option>
                  {leads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name} · {lead.company}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field-span-2">
                <span>Proposal title</span>
                <input
                  value={draft.title}
                  onChange={(event) => patch('title', event.target.value)}
                  placeholder="Name the work clearly"
                />
              </label>
              <label className="field">
                <span>Valid until</span>
                <input
                  type="date"
                  value={draft.validUntil}
                  onChange={(event) => patch('validUntil', event.target.value)}
                />
              </label>
              <label className="field">
                <span>Currency</span>
                <select
                  value={draft.currency}
                  onChange={(event) => patch('currency', event.target.value as Currency)}
                >
                  {CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="card editor-section">
            <div className="editor-section-head">
              <div>
                <span className="card-kicker">02</span>
                <h2>Line items</h2>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addLine}>
                <Plus size={14} /> Add item
              </button>
            </div>
            <div className="line-items">
              <div className="line-item-head" aria-hidden="true">
                <span>Description</span>
                <span>Qty</span>
                <span>Unit price</span>
                <span>Amount</span>
                <span />
              </div>
              {draft.lines.map((line) => (
                <div className="line-item-row" key={line.id}>
                  <label className="field">
                    <span className="mobile-field-label">Description</span>
                    <input
                      value={line.description}
                      onChange={(event) =>
                        updateLine(line.id, { description: event.target.value })
                      }
                      placeholder="What is included?"
                    />
                  </label>
                  <label className="field">
                    <span className="mobile-field-label">Qty</span>
                    <input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.id, { quantity: event.target.value })
                      }
                      aria-label="Quantity"
                    />
                  </label>
                  <label className="field">
                    <span className="mobile-field-label">Unit price</span>
                    <div className="currency-input">
                      <span>{CURRENCY_SYMBOLS[draft.currency]}</span>
                      <input
                        inputMode="decimal"
                        value={line.unitPrice}
                        onChange={(event) =>
                          updateLine(line.id, { unitPrice: event.target.value })
                        }
                        aria-label="Unit price"
                      />
                    </div>
                  </label>
                  <div className="line-amount">
                    {formatMoney(
                      Math.round(
                        (Number(line.unitPrice) || 0) *
                          100 *
                          Math.max(1, Number(line.quantity) || 1),
                      ),
                      draft.currency,
                    )}
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => removeLine(line.id)}
                    disabled={draft.lines.length === 1}
                    aria-label={`Remove ${line.description || 'line item'}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <div className="editor-totals">
              <div>
                <span>Subtotal</span>
                <strong>{formatMoney(totalMinor, draft.currency)}</strong>
              </div>
              <div className="grand-total">
                <span>Total</span>
                <strong>{formatMoney(totalMinor, draft.currency)}</strong>
              </div>
            </div>
          </section>

          <section className="card editor-section">
            <div className="editor-section-head">
              <div>
                <span className="card-kicker">03</span>
                <h2>Notes</h2>
              </div>
            </div>
            <label className="field">
              <span>Terms and context</span>
              <textarea
                rows={5}
                value={draft.notes}
                onChange={(event) => patch('notes', event.target.value)}
                placeholder="Anything the client should understand about this proposal."
              />
            </label>
          </section>
        </div>

        <aside className="live-preview-wrap">
          <div className="preview-sticky">
            <div className="preview-ribbon">
              <span>Live proposal preview</span>
              <small>No PDF is generated in this prototype</small>
            </div>
            <article className="proposal-paper">
              <header className="paper-head">
                <div>
                  <div className="paper-brand">Shotlin CRM</div>
                  <p>Images and stories, made with care.</p>
                </div>
                <div className="paper-meta">
                  <span>Proposal</span>
                  <strong>{proposal.number}</strong>
                </div>
              </header>

              <div className="paper-parties">
                <div>
                  <span>Prepared for</span>
                  <strong>{previewClient}</strong>
                  <p>{previewContact}</p>
                </div>
                <div>
                  <span>Date</span>
                  <p>{formatDate(proposal.issuedAt)}</p>
                  <span>Valid until</span>
                  <p>{formatDate(draft.validUntil)}</p>
                </div>
              </div>

              <div className="paper-title">
                <h2>{draft.title || 'Untitled proposal'}</h2>
                <p>A considered production proposal for {previewClient}.</p>
              </div>

              <div className="paper-lines">
                <div className="paper-lines-head">
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Amount</span>
                </div>
                {draft.lines.map((line) => (
                  <div className="paper-line" key={line.id}>
                    <span>{line.description || 'Untitled item'}</span>
                    <span>{Math.max(1, Number(line.quantity) || 1)}</span>
                    <span>
                      {formatMoney(
                        Math.round(
                          (Number(line.unitPrice) || 0) *
                            100 *
                            Math.max(1, Number(line.quantity) || 1),
                        ),
                        draft.currency,
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <div className="paper-totals">
                <div>
                  <span>Subtotal</span>
                  <strong>{formatMoney(totalMinor, draft.currency)}</strong>
                </div>
                <div>
                  <span>Total</span>
                  <strong>{formatMoney(totalMinor, draft.currency)}</strong>
                </div>
              </div>

              {draft.notes ? <p className="paper-notes">{draft.notes}</p> : null}
              <footer className="paper-footer">
                <span>Shotlin CRM</span>
                <span>hello@shotlin.studio</span>
              </footer>
            </article>
          </div>
        </aside>
      </div>

      <div className="editor-mobile-actions">
        <button type="button" className="btn btn-secondary" onClick={handleSave}>
          Save changes
        </button>
        {proposal.status === 'draft' ? (
          <button type="button" className="btn btn-primary" onClick={() => handleStatus('sent')}>
            Mark as sent
          </button>
        ) : null}
        {proposal.status === 'sent' ? (
          <button type="button" className="btn btn-primary" onClick={() => handleStatus('accepted')}>
            Mark accepted
          </button>
        ) : null}
      </div>
    </div>
  );
}
