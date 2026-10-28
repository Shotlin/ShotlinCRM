'use client';

import { Check, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';

type Status = {
  state: 'none' | 'migrating' | 'connected' | 'error';
  accountId: string | null;
  bucket: string | null;
  accessKeyHint: string | null;
  limitGb: number | null;
  totalFiles: number;
  copiedFiles: number;
  lastError: string | null;
  connectedAt: string | null;
};
type Step = { name: string; ok: boolean; message?: string };
type Form = { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string; limitGb: string };

const EMPTY: Form = { accountId: '', bucket: '', accessKeyId: '', secretAccessKey: '', limitGb: '10' };
const signature = (form: Form) => JSON.stringify(form);

export function StorageConnection({ onChanged }: { onChanged: () => void }) {
  const { notify } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'test' | 'connect' | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [problem, setProblem] = useState('');
  const [testedFor, setTestedFor] = useState('');

  const previousState = useRef<Status['state'] | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/settings/storage/connection', { cache: 'no-store' });
    if (response.ok) setStatus((await response.json()) as Status);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The moment the copy finishes and files switch to R2, refresh the numbers on the page.
  useEffect(() => {
    if (previousState.current === 'migrating' && status?.state === 'connected') onChanged();
    previousState.current = status?.state ?? null;
  }, [status?.state, onChanged]);

  // While files are being copied, keep the progress fresh and refresh the numbers when it finishes.
  useEffect(() => {
    if (status?.state !== 'migrating') return;
    const timer = setInterval(() => {
      void load().then(onChanged);
    }, 3000);
    return () => clearInterval(timer);
  }, [status?.state, load, onChanged]);

  const patch = (key: keyof Form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSteps(null);
    setProblem('');
  };

  const send = async (path: string) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, limitGb: Number(form.limitGb) || 10 }),
    });
    return { response, payload: (await response.json().catch(() => null)) as { ok?: boolean; steps?: Step[]; error?: string } | null };
  };

  const test = async () => {
    setBusy('test');
    setProblem('');
    setSteps(null);
    try {
      const { response, payload } = await send('/api/settings/storage/connection/test');
      if (!response.ok) {
        setProblem(payload?.error ?? 'The test could not run.');
        return;
      }
      setSteps(payload?.steps ?? []);
      if (payload?.ok) setTestedFor(signature(form));
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy('connect');
    setProblem('');
    try {
      const { response, payload } = await send('/api/settings/storage/connection');
      if (!response.ok) {
        setSteps(payload?.steps ?? null);
        setProblem(payload?.error ?? 'Could not connect.');
        return;
      }
      setStatus(payload as unknown as Status);
      // The secret is only kept in the page until it is sent. Clear it as soon as it is saved.
      setForm(EMPTY);
      setTestedFor('');
      setSteps(null);
      setEditing(false);
      notify('Connected. Your existing files are being copied to R2.');
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const connected = status?.state === 'connected' || status?.state === 'migrating';
  const showForm = !connected || editing || status?.state === 'error';
  const canConnect = testedFor !== '' && testedFor === signature(form) && busy === null;
  const filled = Object.entries(form).every(([key, value]) => key === 'limitGb' || value.trim() !== '');
  const percent = status && status.totalFiles > 0 ? Math.round((status.copiedFiles / status.totalFiles) * 100) : status?.state === 'connected' ? 100 : 0;

  return (
    <section className="card storage-connect">
      <div className="storage-card-head">
        <h2>File storage: Cloudflare R2</h2>
        {status?.state === 'connected' ? <span className="storage-chip">Connected</span> : null}
        {status?.state === 'migrating' ? <span className="storage-chip storage-chip-warn">Copying files</span> : null}
        {status?.state === 'error' ? <span className="storage-chip storage-chip-critical">Needs attention</span> : null}
        {status?.state === 'none' ? <span className="storage-chip storage-chip-warn">Not connected</span> : null}
      </div>

      {status?.state === 'migrating' ? (
        <div className="storage-progress">
          <div className="storage-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Copy progress">
            <span style={{ width: `${Math.max(3, percent)}%` }} />
          </div>
          <p>
            Copying your existing files to R2: {status.copiedFiles} of {status.totalFiles}. You can keep working. New files switch to R2
            when this finishes. Nothing is deleted from the server.
          </p>
        </div>
      ) : null}

      {status?.state === 'connected' ? (
        <p>
          Files are stored in bucket <strong>{status.bucket}</strong> (key {status.accessKeyHint}). {status.copiedFiles} existing file
          {status.copiedFiles === 1 ? '' : 's'} copied. Warnings start at 80% of {status.limitGb} GB.
          {status.lastError ? ` Note: ${status.lastError}` : ''}
        </p>
      ) : null}

      {status?.state === 'error' ? <p className="form-error">{status.lastError}</p> : null}

      {connected && !editing && status?.state !== 'error' ? (
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
            Change keys
          </button>
        </div>
      ) : null}

      {showForm ? (
        <form
          className="storage-form"
          onSubmit={(event) => {
            event.preventDefault();
            void test();
          }}
          autoComplete="off"
        >
          <details className="storage-help">
            <summary>Where do I find these?</summary>
            <ol>
              <li>In Cloudflare, open <strong>R2 Object Storage</strong>. Your <strong>Account ID</strong> is shown on that page.</li>
              <li>Create a bucket (keep it private). Its name is the <strong>Bucket name</strong>.</li>
              <li>
                Choose <strong>Manage API tokens → Create API token</strong>, give it <strong>Object Read &amp; Write</strong> for that bucket,
                and copy the <strong>Access Key ID</strong> and <strong>Secret Access Key</strong>. Cloudflare shows the secret only once.
              </li>
            </ol>
          </details>
          <div className="form-grid">
            <label className="field">
              <span>Account ID</span>
              <input value={form.accountId} onChange={(event) => patch('accountId', event.target.value)} spellCheck={false} autoComplete="off" placeholder="32 letters and numbers" />
            </label>
            <label className="field">
              <span>Bucket name</span>
              <input value={form.bucket} onChange={(event) => patch('bucket', event.target.value)} spellCheck={false} autoComplete="off" placeholder="shotlin-crm" />
            </label>
            <label className="field">
              <span>Access Key ID</span>
              <input value={form.accessKeyId} onChange={(event) => patch('accessKeyId', event.target.value)} spellCheck={false} autoComplete="off" />
            </label>
            <label className="field">
              <span>Secret Access Key</span>
              <input type="password" value={form.secretAccessKey} onChange={(event) => patch('secretAccessKey', event.target.value)} spellCheck={false} autoComplete="new-password" />
            </label>
            <label className="field">
              <span>Warn me when storage is nearly full (GB)</span>
              <input inputMode="numeric" value={form.limitGb} onChange={(event) => patch('limitGb', event.target.value)} autoComplete="off" />
            </label>
          </div>

          {steps ? (
            <ul className="storage-steps" aria-live="polite">
              {steps.map((step) => (
                <li key={step.name} className={step.ok ? 'ok' : 'bad'}>
                  {step.ok ? <Check size={15} /> : <X size={15} />}
                  <span>
                    {step.name}
                    {step.message ? <em>{step.message}</em> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {problem && !steps?.some((step) => !step.ok) ? (
            <p className="form-error">
              <CircleAlert size={14} /> {problem}
            </p>
          ) : null}
          {testedFor !== '' && testedFor === signature(form) ? <p className="storage-pass">The connection works. Press Connect to start using R2.</p> : null}

          <div className="storage-actions">
            <button type="submit" className="btn btn-secondary" disabled={busy !== null || !filled}>
              {busy === 'test' ? <LoaderCircle size={15} className="spin" /> : null} Test connection
            </button>
            <button type="button" className="btn btn-primary" disabled={!canConnect} onClick={() => void connect()}>
              {busy === 'connect' ? <LoaderCircle size={15} className="spin" /> : null} Connect
            </button>
            {editing ? (
              <button type="button" className="btn btn-secondary" onClick={() => { setEditing(false); setForm(EMPTY); setSteps(null); setProblem(''); }}>
                Cancel
              </button>
            ) : null}
          </div>
          <p className="muted-copy">
            Your keys are encrypted before they are saved and are never shown again. Connecting copies your existing files to R2 and keeps the
            originals on the server.
          </p>
        </form>
      ) : null}
    </section>
  );
}
