'use client';

import { CheckCircle2, LoaderCircle, Radio } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/Toast';

type MetaStatus = {
  configured: boolean;
  pageId: string | null;
  status: string;
  updatedAt: string | null;
  appSecretConfigured: boolean;
};

export function MetaIntegration() {
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');
  const { notify } = useToast();

  const load = async () => {
    const response = await fetch('/api/integrations/meta', { cache: 'no-store' });
    if (response.ok) setStatus((await response.json()) as MetaStatus);
  };
  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, []);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/integrations/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, accessToken, verifyToken }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Meta connection failed');
      setAccessToken('');
      await load();
      notify('Meta lead ads connected');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Meta connection failed');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Remove the Meta connection? New lead ads will stop arriving.')) return;
    setBusy(true);
    try {
      const response = await fetch('/api/integrations/meta', { method: 'DELETE' });
      if (!response.ok) throw new Error('Meta could not be disconnected');
      await load();
      notify('Meta disconnected');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Meta could not be disconnected');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card settings-panel">
      <div className="settings-panel-head">
        <div className="settings-icon"><Radio size={18} /></div>
        <div>
          <h2>Meta lead ads</h2>
          <p>Connect a Facebook Page to turn Lead Ads submissions into Meta-labelled CRM leads automatically.</p>
        </div>
        <span className={`connection-status status-${status?.configured ? 'connected' : 'disconnected'}`}>
          <span />
          {status?.configured ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="meta-integration-body">
        {status?.configured ? (
          <div className="meta-connected">
            <p><CheckCircle2 size={16} /> Page <strong>{status.pageId}</strong> is receiving lead ads.</p>
            <p className="field-hint">
              In Meta App Dashboard → Webhooks, subscribe the Page to <code>leadgen</code> and use:
            </p>
            <code className="webhook-url">{`${origin}/api/webhooks/meta`}</code>
            <p className="field-hint">
              The app secret on the server is {status.appSecretConfigured ? 'configured' : 'missing'}.
              Lead phone numbers and ad attribution are stored in PostgreSQL.
            </p>
            <button type="button" className="btn btn-secondary" onClick={() => void disconnect()} disabled={busy}>
              Disconnect Meta
            </button>
          </div>
        ) : (
          <form className="meta-form" onSubmit={connect}>
            {status && !status.appSecretConfigured ? (
              <p className="setting-error" role="status">
                Set <code>META_APP_SECRET</code> on the server before connecting. Webhook
                signatures cannot be verified without the app secret.
              </p>
            ) : null}
            <div className="form-grid">
              <label className="field">
                <span>Facebook Page ID</span>
                <input value={pageId} onChange={(event) => setPageId(event.target.value)} inputMode="numeric" placeholder="1234567890" required />
              </label>
              <label className="field">
                <span>Webhook verify token</span>
                <input value={verifyToken} onChange={(event) => setVerifyToken(event.target.value)} type="password" minLength={12} autoComplete="new-password" placeholder="A private 12+ character value" required />
              </label>
            </div>
            <label className="field">
              <span>Page access token</span>
              <input value={accessToken} onChange={(event) => setAccessToken(event.target.value)} type="password" autoComplete="new-password" placeholder="Encrypted before it is stored" required />
            </label>
            <p className="field-hint">
              In Meta App Dashboard, add the same verify token and subscribe to the Page&apos;s
              <code> leadgen</code> field. Use the webhook URL shown after connecting.
            </p>
            <button type="submit" className="btn btn-primary" disabled={busy || !status?.appSecretConfigured}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Radio size={15} />}
              {busy ? 'Verifying with Meta…' : 'Connect Meta page'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
