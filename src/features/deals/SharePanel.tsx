'use client';

import { Copy, Link2, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { day } from '../gst/format';

type ShareRow = { id: string; label: string; createdAt: string; expiresAt: string; revoked: boolean; expired: boolean; viewCount: number; lastViewedAt: string | null };

export function SharePanel({ kind, targetId }: { kind: 'project'; targetId: string }) {
  const [links, setLinks] = useState<ShareRow[]>([]);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/share?kind=${kind}&targetId=${encodeURIComponent(targetId)}`, { cache: 'no-store' });
    if (response.ok) setLinks(((await response.json()) as { links: ShareRow[] }).links);
  }, [kind, targetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError('');
    setCopied(false);
    const response = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId, label, days: Number(days) }) });
    const payload = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
    setBusy(false);
    if (!response.ok || !payload?.url) setError(payload?.error ?? 'Could not create the link.');
    else {
      setFresh(payload.url);
      setLabel('');
      await load();
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Stop this link from working? The client will no longer be able to open it.')) return;
    await fetch(`/api/share/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <section className="bk-card">
      <h3><Link2 size={17} aria-hidden="true" /> Client link</h3>
      <p className="bk-note bk-note-top">
        <ShieldCheck size={14} aria-hidden="true" /> A private page for your client, with no login. It shows the brief, timeline, milestones, the signed agreement and the invoices of this project, and nothing else.
        Each link has a secret that cannot be guessed, expires on its own, and can be stopped any time.
      </p>
      <div className="bk-share-new">
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Who is it for? e.g. Deepak (DEALKR)" maxLength={120} />
        <select value={days} onChange={(event) => setDays(event.target.value)} aria-label="Link validity">
          <option value="7">Works for 7 days</option><option value="30">Works for 30 days</option><option value="90">Works for 90 days</option><option value="180">Works for 180 days</option>
        </select>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
          {busy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />} Create link
        </button>
      </div>
      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      {fresh ? (
        <div className="bk-share-url" role="status">
          <p><b>Copy it now.</b> For safety the full link is shown only this once.</p>
          <div>
            <code>{fresh}</code>
            <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard.writeText(fresh).then(() => setCopied(true))}><Copy size={15} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      ) : null}
      {links.length > 0 ? (
        <div className="bk-table-wrap">
          <table className="bk-table">
            <thead><tr><th>For</th><th>Created</th><th>Valid until</th><th className="num">Opened</th><th /></tr></thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id}>
                  <td>{link.label || 'Client link'} {link.revoked ? <span className="bk-chip bk-tone-red">Stopped</span> : link.expired ? <span className="bk-chip bk-tone-amber">Expired</span> : <span className="bk-chip bk-tone-green">Working</span>}</td>
                  <td>{day(link.createdAt.slice(0, 10))}</td>
                  <td>{day(link.expiresAt.slice(0, 10))}</td>
                  <td className="num">{link.viewCount}{link.lastViewedAt ? ` · last ${day(link.lastViewedAt.slice(0, 10))}` : ''}</td>
                  <td className="num">{!link.revoked && !link.expired ? <button type="button" className="bk-iconbtn" aria-label="Stop this link" onClick={() => void revoke(link.id)}><Trash2 size={15} /></button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
