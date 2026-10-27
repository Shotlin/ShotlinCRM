import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import { formatMoney } from '../../data/currencies';
import type { Invoice, PaymentMethod } from '../../data/types';
import { PAYMENT_METHOD_LABELS, toMoneyInput } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { invoiceBalanceMinor } from '../../store/selectors';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

export function PaymentDialog({
  open,
  onOpenChange,
  invoices,
  initialInvoiceId,
  lockInvoice = false,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoices: Invoice[];
  initialInvoiceId?: string;
  lockInvoice?: boolean;
  onRecorded?: () => void;
}) {
  const payments = useCrmStore((state) => state.payments);
  const recordPayment = useCrmStore((state) => state.recordPayment);
  const flush = useCrmStore((state) => state.flush);
  const { notify } = useToast();
  const [invoiceId, setInvoiceId] = useState(initialInvoiceId ?? '');
  const [amount, setAmount] = useState('');
  const [receivedAt, setReceivedAt] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const available = useMemo(
    () =>
      invoices.filter(
        (invoice) => invoice.status !== 'draft' && invoiceBalanceMinor(invoice, payments) > 0,
      ),
    [invoices, payments],
  );
  const invoice = available.find((item) => item.id === invoiceId);

  useEffect(() => {
    if (!open) return;
    const nextInvoice =
      available.find((item) => item.id === initialInvoiceId) ?? available[0];
    setInvoiceId(nextInvoice?.id ?? '');
    setError('');
    setMethod('bank');
    setNote('');
    setReceivedAt(format(new Date(), 'yyyy-MM-dd'));
    setAmount(nextInvoice ? toMoneyInput(invoiceBalanceMinor(nextInvoice, payments)) : '');
  }, [open, initialInvoiceId, available, payments]);

  useEffect(() => {
    if (!open || !invoice) return;
    setAmount(toMoneyInput(invoiceBalanceMinor(invoice, payments)));
  }, [invoiceId, invoice, open, payments]);

  const balance = invoice ? invoiceBalanceMinor(invoice, payments) : 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!invoice) {
      setError('Choose an invoice to record a payment.');
      return;
    }
    const amountMinor = Math.round((Number(amount) || 0) * 100);
    if (amountMinor <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (amountMinor > balance) {
      setError('The amount cannot exceed the outstanding balance.');
      return;
    }

    recordPayment({
      invoiceId: invoice.id,
      amountMinor,
      receivedAt: `${receivedAt}T12:00:00`,
      method,
      note: note.trim(),
    });
    await flush();
    notify(
      amountMinor === balance ? 'Invoice paid in full' : 'Partial payment recorded',
    );
    onOpenChange(false);
    onRecorded?.();
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Record payment"
      description="Payments update the invoice, client balance, and revenue automatically."
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="submit" form="payment-form" className="btn btn-primary" disabled={!invoice}>
            Record payment
          </button>
        </>
      }
    >
      <form id="payment-form" className="form-stack" onSubmit={handleSubmit}>
        <label className="field">
          <span>Invoice</span>
          <select
            value={invoiceId}
            onChange={(event) => setInvoiceId(event.target.value)}
            disabled={lockInvoice || available.length <= 1}
          >
            {available.length === 0 ? <option value="">No invoices awaiting payment</option> : null}
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.number} · {formatMoney(invoiceBalanceMinor(item, payments), item.currency)} due
              </option>
            ))}
          </select>
        </label>

        {invoice ? (
          <div className="payment-summary">
            <div>
              <span>Outstanding balance</span>
              <strong>{formatMoney(balance, invoice.currency)}</strong>
            </div>
            <span className="sample-label">Billed in {invoice.currency}</span>
          </div>
        ) : null}

        <div className="form-grid">
          <label className="field">
            <span>Amount ({invoice?.currency ?? '—'})</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="field">
            <span>Received on</span>
            <input
              type="date"
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Method</span>
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Reference note</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
