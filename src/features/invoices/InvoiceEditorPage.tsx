import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CircleDollarSign, Plus, ReceiptText, Send, Trash2 } from 'lucide-react';
import { Link, useParams } from '../../lib/router';
import { addDays, format } from 'date-fns';
import {
  CURRENCIES,
  CURRENCY_SYMBOLS,
  formatMoney,
  lineItemsTotalMinor,
} from '../../data/currencies';
import type { Currency, LineItem } from '../../data/types';
import { formatDate, PAYMENT_METHOD_LABELS, toMoneyInput } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import {
  invoiceBalanceMinor,
  invoiceDisplayStatus,
  invoicePaidMinor,
} from '../../store/selectors';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusPill } from '../../components/ui/Badges';
import { useToast } from '../../components/ui/Toast';
import { PaymentDialog } from './PaymentDialog';

type EditorLine = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

type InvoiceDraft = {
  clientId: string;
  leadId: string;
  proposalId: string;
  currency: Currency;
  issuedAt: string;
  dueAt: string;
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

const emptyDraft: InvoiceDraft = {
  clientId: '',
  leadId: '',
  proposalId: '',
  currency: 'INR',
  issuedAt: format(new Date(), 'yyyy-MM-dd'),
  dueAt: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
  notes: '',
  lines: [{ id: 'new-line', description: '', quantity: '1', unitPrice: '' }],
};

export function InvoiceEditorPage() {
  const { invoiceId } = useParams();
  const { notify } = useToast();
  const invoice = useCrmStore((state) =>
    state.invoices.find((item) => item.id === invoiceId),
  );
  const clients = useCrmStore((state) => state.clients);
  const leads = useCrmStore((state) => state.leads);
  const proposals = useCrmStore((state) => state.proposals);
  const payments = useCrmStore((state) => state.payments);
  const updateInvoice = useCrmStore((state) => state.updateInvoice);
  const flush = useCrmStore((state) => state.flush);
  const [draft, setDraft] = useState<InvoiceDraft>(emptyDraft);
  const [error, setError] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    setDraft({
      clientId: invoice.clientId,
      leadId: invoice.leadId ?? '',
      proposalId: invoice.proposalId ?? '',
      currency: invoice.currency,
      issuedAt: invoice.issuedAt.slice(0, 10),
      dueAt: invoice.dueAt.slice(0, 10),
      notes: invoice.notes,
      lines:
        invoice.lineItems.length > 0
          ? invoice.lineItems.map(toEditorLine)
          : [{ id: `line-${Date.now()}`, description: '', quantity: '1', unitPrice: '' }],
    });
    setError('');
    // Only reload the draft when switching records, not on background CRM refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  const client = clients.find((item) => item.id === draft.clientId);
  const invoicePayments = useMemo(
    () =>
      payments
        .filter((payment) => payment.invoiceId === invoice?.id)
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    [payments, invoice?.id],
  );
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

  if (!invoice) {
    return (
      <div className="page">
        <EmptyState
          icon={ReceiptText}
          title="Invoice not found"
          description="Return to invoices and choose a record to edit."
          action={
            <Link to="/invoices" className="btn btn-primary">
              Back to invoices
            </Link>
          }
        />
      </div>
    );
  }

  const balance = invoiceBalanceMinor(invoice, payments);
  const paid = invoicePaidMinor(invoice, payments);
  const status = invoiceDisplayStatus(invoice, payments);

  const patch = <K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) =>
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

  const persist = () => {
    if (!draft.clientId) {
      setError('Choose a client before saving the invoice.');
      return false;
    }
    setError('');
    updateInvoice(invoice.id, {
      clientId: draft.clientId,
      leadId: draft.leadId || undefined,
      proposalId: draft.proposalId || undefined,
      currency: draft.currency,
      issuedAt: `${draft.issuedAt}T10:00:00`,
      dueAt: `${draft.dueAt}T18:00:00`,
      notes: draft.notes,
      lineItems: toStoreLines(draft.lines),
    });
    return true;
  };

  const handleSave = async () => {
    if (persist()) {
      await flush();
      notify('Invoice saved');
    }
  };

  const handleSend = async () => {
    if (!persist()) return;
    updateInvoice(invoice.id, { status: 'sent' });
    await flush();
    notify('Invoice marked as sent');
  };

  return (
    <div className="page editor-page invoice-editor-page">
      <div className="editor-topbar">
        <Link to="/invoices" className="back-link">
          <ArrowLeft size={15} /> Invoices
        </Link>
        <span className="eyebrow">10 / Invoice editor</span>
      </div>

      <div className="editor-title-row">
        <div>
          <h1>{invoice.status === 'draft' ? 'Edit invoice' : invoice.number}</h1>
          <p>Build the invoice on the left and check the live document preview.</p>
        </div>
        <div className="editor-top-actions">
          <StatusPill status={status} kind="invoice" />
          <button type="button" className="btn btn-secondary" onClick={handleSave}>
            <Check size={15} /> Save invoice
          </button>
          {invoice.status === 'draft' ? (
            <button type="button" className="btn btn-primary" onClick={handleSend}>
              <Send size={15} /> Mark as sent
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setPaymentOpen(true)}
              disabled={balance === 0}
            >
              <CircleDollarSign size={15} /> Record payment
            </button>
          )}
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
                <h2>Invoice details</h2>
              </div>
              <span className="mono-label">{invoice.number}</span>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Client *</span>
                <select
                  value={draft.clientId}
                  onChange={(event) => patch('clientId', event.target.value)}
                >
                  <option value="">Select a client</option>
                  {clients.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.company} · {item.name}
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
              <label className="field">
                <span>Proposal</span>
                <select
                  value={draft.proposalId}
                  onChange={(event) => patch('proposalId', event.target.value)}
                >
                  <option value="">No linked proposal</option>
                  {proposals.map((proposal) => (
                    <option key={proposal.id} value={proposal.id}>
                      {proposal.number} · {proposal.title}
                    </option>
                  ))}
                </select>
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
              <label className="field">
                <span>Issue date</span>
                <input
                  type="date"
                  value={draft.issuedAt}
                  onChange={(event) => patch('issuedAt', event.target.value)}
                />
              </label>
              <label className="field">
                <span>Due date</span>
                <input
                  type="date"
                  value={draft.dueAt}
                  onChange={(event) => patch('dueAt', event.target.value)}
                />
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
                      placeholder="What are you billing for?"
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
                <h2>Payment notes</h2>
              </div>
            </div>
            <label className="field">
              <span>Notes shown on the invoice</span>
              <textarea
                rows={4}
                value={draft.notes}
                onChange={(event) => patch('notes', event.target.value)}
                placeholder="Payment terms or a short thank-you."
              />
            </label>
          </section>

          <section className="card editor-section">
            <div className="editor-section-head">
              <div>
                <span className="card-kicker">04</span>
                <h2>Payment history</h2>
              </div>
              <span className="paid-amount">
                {formatMoney(paid, invoice.currency)} received
              </span>
            </div>
            {invoicePayments.length > 0 ? (
              <div className="payment-history">
                {invoicePayments.map((payment) => (
                  <div className="payment-history-row" key={payment.id}>
                    <span className="round-icon"><CircleDollarSign size={14} /></span>
                    <div>
                      <strong>{formatMoney(payment.amountMinor, payment.currency)}</strong>
                      <small>{formatDate(payment.receivedAt)} · {PAYMENT_METHOD_LABELS[payment.method]}</small>
                    </div>
                    <span>{payment.note || 'No note'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-copy">No payments recorded yet.</p>
            )}
          </section>
        </div>

        <aside className="live-preview-wrap">
          <div className="preview-sticky">
            <div className="preview-ribbon">
              <span>Live invoice preview</span>
              <small>Saved invoice data</small>
            </div>
            <article className="invoice-paper">
              <header className="invoice-paper-head">
                <div>
                  <div className="paper-brand">Shotlin CRM</div>
                  <p>Independent creative studio</p>
                  <p>Mumbai, India</p>
                </div>
                <div className="invoice-wordmark">INVOICE</div>
              </header>

              <div className="invoice-paper-meta">
                <div>
                  <span>Billed to</span>
                  <strong>{client?.company ?? 'Select a client'}</strong>
                  <p>{client?.name ?? 'Client contact'}</p>
                  <p>{client?.city ?? ''}</p>
                </div>
                <div className="invoice-meta-grid">
                  <span>Invoice number</span>
                  <strong>{invoice.number}</strong>
                  <span>Issue date</span>
                  <strong>{formatDate(draft.issuedAt)}</strong>
                  <span>Due date</span>
                  <strong>{formatDate(draft.dueAt)}</strong>
                </div>
              </div>

              <div className="paper-table">
                <div className="paper-table-head">
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Unit price</span>
                  <span>Amount</span>
                </div>
                {draft.lines.map((line) => (
                  <div className="paper-table-row" key={line.id}>
                    <span>{line.description || 'Untitled item'}</span>
                    <span>{Math.max(1, Number(line.quantity) || 1)}</span>
                    <span>{formatMoney(Math.round((Number(line.unitPrice) || 0) * 100), draft.currency)}</span>
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

              <div className="invoice-paper-totals">
                <div>
                  <span>Subtotal</span>
                  <span>{formatMoney(totalMinor, draft.currency)}</span>
                </div>
                <div>
                  <span>Total</span>
                  <strong>{formatMoney(totalMinor, draft.currency)}</strong>
                </div>
                <div>
                  <span>Paid</span>
                  <span>{formatMoney(paid, invoice.currency)}</span>
                </div>
                <div className="amount-due">
                  <span>Amount due</span>
                  <strong>{formatMoney(balance, invoice.currency)}</strong>
                </div>
              </div>

              <div className="invoice-status-block">
                <StatusPill status={status} kind="invoice" />
                <p>{draft.notes || 'Payment terms will appear here.'}</p>
              </div>
            </article>
          </div>
        </aside>
      </div>

      <div className="editor-mobile-actions">
        <button type="button" className="btn btn-secondary" onClick={handleSave}>
          Save invoice
        </button>
        {invoice.status === 'draft' ? (
          <button type="button" className="btn btn-primary" onClick={handleSend}>
            Mark as sent
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setPaymentOpen(true)}
            disabled={balance === 0}
          >
            Record payment
          </button>
        )}
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        invoices={[invoice]}
        initialInvoiceId={invoice.id}
        lockInvoice
      />
    </div>
  );
}
