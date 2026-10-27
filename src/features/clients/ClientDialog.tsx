import { useEffect, useState, type FormEvent } from 'react';
import type { Client } from '../../data/types';
import { useCrmStore } from '../../store/crmStore';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

type ClientForm = {
  name: string;
  company: string;
  email: string;
  phone: string;
  city: string;
  notes: string;
};

const emptyForm: ClientForm = {
  name: '',
  company: '',
  email: '',
  phone: '',
  city: '',
  notes: '',
};

export function ClientDialog({
  open,
  onOpenChange,
  client,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: Client;
  onCreated?: (client: Client) => void;
}) {
  const [form, setForm] = useState<ClientForm>(emptyForm);
  const [error, setError] = useState('');
  const addClient = useCrmStore((state) => state.addClient);
  const updateClient = useCrmStore((state) => state.updateClient);
  const flush = useCrmStore((state) => state.flush);
  const { notify } = useToast();

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(
      client
        ? {
            name: client.name,
            company: client.company,
            email: client.email,
            phone: client.phone,
            city: client.city,
            notes: client.notes,
          }
        : emptyForm,
    );
  }, [open, client]);

  const set = <K extends keyof ClientForm>(key: K, value: ClientForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.company.trim()) {
      setError('Add a contact name and company to continue.');
      return;
    }
    if (client) {
      updateClient(client.id, {
        name: form.name.trim(),
        company: form.company.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        notes: form.notes.trim(),
      });
      await flush();
      notify('Client updated');
      onCreated?.({ ...client, ...form });
    } else {
      const created = addClient({
        name: form.name.trim(),
        company: form.company.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
      });
      if (form.notes.trim()) updateClient(created.id, { notes: form.notes.trim() });
      await flush();
      notify('Client added');
      onCreated?.({ ...created, notes: form.notes.trim() });
    }
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={client ? 'Edit client' : 'Add client'}
      description="Keep the relationship record complete and easy to find."
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="submit" form="client-form" className="btn btn-primary">
            {client ? 'Save changes' : 'Add client'}
          </button>
        </>
      }
    >
      <form id="client-form" className="form-stack" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field">
            <span>Contact name *</span>
            <input
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Company *</span>
            <input value={form.company} onChange={(event) => set('company', event.target.value)} />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => set('email', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input value={form.phone} onChange={(event) => set('phone', event.target.value)} />
          </label>
          <label className="field">
            <span>City</span>
            <input value={form.city} onChange={(event) => set('city', event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Notes</span>
          <textarea
            rows={4}
            value={form.notes}
            onChange={(event) => set('notes', event.target.value)}
            placeholder="Preferences, context, or anything worth remembering."
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
