import { useEffect, useState, type FormEvent } from 'react';
import { Infinity as MetaMark, MessageCircle } from 'lucide-react';
import { CURRENCIES } from '../../data/currencies';
import type { Currency, Lead, LeadSource } from '../../data/types';
import { toMoneyInput, parseMoneyInput } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

type LeadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: Lead;
  onSaved?: (lead: Lead) => void;
};

type FormState = {
  name: string;
  company: string;
  phone: string;
  email: string;
  city: string;
  source: LeadSource;
  initialMessage: string;
  value: string;
  currency: Currency;
  followUpAt: string;
};

const emptyForm: FormState = {
  name: '',
  company: '',
  phone: '',
  email: '',
  city: '',
  source: 'whatsapp',
  initialMessage: '',
  value: '',
  currency: 'INR',
  followUpAt: '',
};

export function LeadDialog({ open, onOpenChange, lead, onSaved }: LeadDialogProps) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState('');
  const addLead = useCrmStore((state) => state.addLead);
  const updateLead = useCrmStore((state) => state.updateLead);
  const flush = useCrmStore((state) => state.flush);
  const { notify } = useToast();

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(
      lead
        ? {
            name: lead.name,
            company: lead.company,
            phone: lead.phone,
            email: lead.email,
            city: lead.city,
            source: lead.source,
            initialMessage: lead.initialMessage,
            value: toMoneyInput(lead.valueMinor),
            currency: lead.currency,
            followUpAt: lead.followUpAt?.slice(0, 16) ?? '',
          }
        : emptyForm,
    );
  }, [open, lead]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('Add a name to continue.');
      return;
    }
    if (!lead && !form.initialMessage.trim()) {
      setError('Add the enquiry message so the lead has context.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      company: form.company.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      city: form.city.trim(),
      source: form.source,
      initialMessage: form.initialMessage.trim(),
      valueMinor: parseMoneyInput(form.value),
      currency: form.currency,
      followUpAt: form.followUpAt ? `${form.followUpAt}:00` : undefined,
    };

    if (lead) {
      updateLead(lead.id, payload);
      await flush();
      notify('Lead updated');
      onSaved?.({ ...lead, ...payload });
    } else {
      const created = addLead(payload);
      await flush();
      notify('Lead added to your pipeline');
      onSaved?.(created);
    }
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={lead ? 'Edit lead' : 'New lead'}
      description={
        lead
          ? 'Keep the contact and opportunity details current.'
          : 'Add an enquiry manually with its first WhatsApp or Meta message.'
      }
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="submit" form="lead-form" className="btn btn-primary">
            {lead ? 'Save changes' : 'Add lead'}
          </button>
        </>
      }
    >
      <form id="lead-form" className="form-stack" onSubmit={handleSubmit}>
        <div className="segmented" role="group" aria-label="Lead source">
          <button
            type="button"
            className={`segment${form.source === 'whatsapp' ? ' active' : ''}`}
            onClick={() => set('source', 'whatsapp')}
          >
            <MessageCircle size={14} />
            WhatsApp
          </button>
          <button
            type="button"
            className={`segment${form.source === 'meta' ? ' active' : ''}`}
            onClick={() => set('source', 'meta')}
          >
            <MetaMark size={15} />
            Meta
          </button>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Name *</span>
            <input
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
              placeholder="e.g. Riya Sharma"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Company</span>
            <input
              value={form.company}
              onChange={(event) => set('company', event.target.value)}
              placeholder="Studio or company"
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
              placeholder="+91"
              inputMode="tel"
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              value={form.email}
              onChange={(event) => set('email', event.target.value)}
              placeholder="name@company.com"
              type="email"
            />
          </label>
          <label className="field">
            <span>City</span>
            <input
              value={form.city}
              onChange={(event) => set('city', event.target.value)}
              placeholder="City"
            />
          </label>
          <label className="field">
            <span>Follow-up</span>
            <input
              type="datetime-local"
              value={form.followUpAt}
              onChange={(event) => set('followUpAt', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Estimated value</span>
            <input
              value={form.value}
              onChange={(event) => set('value', event.target.value)}
              placeholder="80,000"
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span>Currency</span>
            <select value={form.currency} onChange={(event) => set('currency', event.target.value as Currency)}>
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>{lead ? 'Original enquiry' : 'Enquiry message *'}</span>
          <textarea
            value={form.initialMessage}
            onChange={(event) => set('initialMessage', event.target.value)}
            rows={4}
            placeholder="What did they ask for?"
          />
        </label>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
