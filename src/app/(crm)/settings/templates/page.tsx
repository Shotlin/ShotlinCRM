'use client';

import { Archive, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useToast } from '@/components/ui/Toast';

type Template = {
  id: string;
  name: string;
  body: string;
  updatedAt: string;
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  const load = async () => {
    const response = await fetch('/api/templates', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = (await response.json()) as { templates: Template[] };
    setTemplates(payload.templates);
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, body }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Template could not be created');
      setName('');
      setBody('');
      await load();
      notify('Template created');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Template could not be created');
    } finally {
      setBusy(false);
    }
  };

  const archive = async (id: string) => {
    const response = await fetch(`/api/templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    if (response.ok) {
      await load();
      notify('Template archived');
    } else {
      notify('Template could not be archived');
    }
  };

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="Settings / Templates"
        title="Message templates"
        description="Reusable replies for quotes, follow-ups, and payment reminders. Nothing sends automatically."
        actions={
          <a href="/settings/integrations" className="btn btn-secondary">Connections</a>
        }
      />

      <div className="settings-two-column">
        <form className="card template-editor" onSubmit={create}>
          <div className="settings-panel-head compact-head">
            <div>
              <h2>New template</h2>
              <p>Use only the variables listed below.</p>
            </div>
          </div>
          <label className="field">
            <span>Template name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Proposal follow-up" required />
          </label>
          <label className="field">
            <span>Message</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={8}
              maxLength={8000}
              placeholder={'Hi {{name}}, just checking whether the proposal for {{company}} reached you.'}
              required
            />
          </label>
          <div className="variable-row">
            <code>{'{{name}}'}</code>
            <code>{'{{company}}'}</code>
            <code>{'{{followUpDate}}'}</code>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Plus size={15} /> {busy ? 'Creating…' : 'Create template'}
          </button>
          <p className="field-hint">Placeholders are filled from the selected lead when you choose this template in the inbox.</p>
        </form>

        <section className="card template-list-card" aria-label="Saved templates">
          <div className="settings-panel-head compact-head">
            <div>
              <h2>Saved templates</h2>
              <p>{templates.length} active</p>
            </div>
          </div>
          <div className="template-list">
            {templates.map((template) => (
              <article className="template-item" key={template.id}>
                <div>
                  <strong>{template.name}</strong>
                  <p>{template.body}</p>
                </div>
                <button type="button" className="icon-button" onClick={() => void archive(template.id)} aria-label={`Archive ${template.name}`}>
                  <Archive size={15} />
                </button>
              </article>
            ))}
            {templates.length === 0 ? <p className="muted-copy">No templates yet. Create one to use it in the inbox.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
