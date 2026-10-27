'use client';

import { Check, LoaderCircle, QrCode, Smartphone, Unplug } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { MetaIntegration } from './MetaIntegration';

type Status = {
  state: 'disconnected' | 'qr_required' | 'connecting' | 'connected' | 'logged_out' | 'error';
  phone: string | null;
  connectedAt: string | null;
  qrDataUrl: string | null;
  qrExpiresAt: string | null;
  lastError: string | null;
  workerOnline: boolean;
  transport: 'live' | 'mock' | 'unknown';
};

const labels: Record<Status['state'], string> = {
  disconnected: 'Not connected',
  qr_required: 'Waiting for scan',
  connecting: 'Connecting',
  connected: 'Connected',
  logged_out: 'Unlinked',
  error: 'Connection error',
};

export default function IntegrationsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  const load = useCallback(async () => {
    const response = await fetch('/api/integrations/whatsapp', { cache: 'no-store' });
    if (!response.ok) return;
    setStatus((await response.json()) as Status);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = async (action: 'pair' | 'disconnect' | 'logout') => {
    if (action === 'logout' && !window.confirm('Unlink this WhatsApp device? You will need to scan a new QR code.')) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/integrations/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'The action failed');
      notify(action === 'pair' ? 'Pairing started' : action === 'logout' ? 'Device unlinked' : 'Disconnecting');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="Settings / Integrations"
        title="Connections"
        description="Link your own WhatsApp account and connect Meta lead ads."
      />

      <section className="card settings-panel">
        <div className="settings-panel-head">
          <div className="settings-icon"><Smartphone size={18} /></div>
          <div>
            <h2>WhatsApp linked device</h2>
            <p>Unofficial linked-device connection through Baileys. Messages are sent only when you press Send.</p>
          </div>
          <span className={`connection-status status-${status?.state ?? 'disconnected'}`}>
            <span />
            {status ? labels[status.state] : 'Checking'}
          </span>
        </div>

        <div className="whatsapp-setting-grid">
          <div className="whatsapp-instructions">
            <p className="setting-warning">
              This is not the official WhatsApp Business API. WhatsApp may require a reconnect or
              change linked-device behaviour. Your phone remains the primary WhatsApp account.
            </p>
            <ol className="setup-steps">
              <li>Open WhatsApp on your phone.</li>
              <li>Go to Settings → Linked devices → Link a device.</li>
              <li>Scan the QR code shown here within 60 seconds.</li>
            </ol>
            {status?.phone ? <p className="connected-phone">Linked number: <strong>+{status.phone}</strong></p> : null}
            {status?.lastError ? <p className="setting-error" role="status">{status.lastError}</p> : null}
            {!status?.workerOnline ? (
              <p className="setting-error" role="status">
                Worker offline. Run <code>npm run worker</code> in the project directory.
              </p>
            ) : status.transport === 'mock' ? (
              <p className="setting-error" role="status">
                Test transport active. Messages are simulated and are not delivered to WhatsApp.
              </p>
            ) : null}
            <div className="settings-actions">
              {status?.state === 'connected' ? (
                <button type="button" className="btn btn-secondary" onClick={() => void act('disconnect')} disabled={busy}>
                  <Unplug size={15} /> Disconnect
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void act('pair')} disabled={busy || !status?.workerOnline}>
                  {busy ? <LoaderCircle size={15} className="spin" /> : <QrCode size={15} />}
                  {status?.state === 'connecting' ? 'Refresh pairing' : 'Link WhatsApp'}
                </button>
              )}
              {(status?.state === 'connected' || status?.state === 'logged_out') ? (
                <button type="button" className="btn btn-secondary" onClick={() => void act('logout')} disabled={busy}>
                  Unlink device
                </button>
              ) : null}
            </div>
          </div>

          <div className="qr-panel" aria-live="polite">
            {status?.connectedAt ? (
              <div className="qr-success">
                <span><Check size={22} /></span>
                <h3>Device connected</h3>
                <p>Incoming messages sync into the inbox. Outgoing messages stay manual.</p>
              </div>
            ) : status?.qrDataUrl ? (
              <>
                <img src={status.qrDataUrl} alt="WhatsApp linking QR code" width={256} height={256} />
                <p>Scan before {status.qrExpiresAt ? new Date(status.qrExpiresAt).toLocaleTimeString() : 'it expires'}.</p>
              </>
            ) : (
              <div className="qr-placeholder">
                <QrCode size={34} />
                <p>{status?.workerOnline ? 'Start pairing to show a QR code.' : 'Start the worker, then link this device.'}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <MetaIntegration />

      <section className="card settings-panel">
        <div className="settings-panel-head">
          <div className="settings-icon"><QrCode size={18} /></div>
          <div>
            <h2>Message templates</h2>
            <p>Create reusable messages with lead fields, then choose one in the inbox before sending.</p>
          </div>
          <a href="/settings/templates" className="btn btn-secondary">Manage templates</a>
        </div>
      </section>
    </div>
  );
}
