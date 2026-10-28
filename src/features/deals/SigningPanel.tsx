'use client';

import { BadgeCheck, FileSignature, LoaderCircle, PenLine, ShieldCheck, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SharePanel } from './SharePanel';

type Signature = { role: 'client' | 'developer'; name: string; title: string; signedAt: string; ip: string; sha256: string };
type Company = { hasSignature: boolean; name: string; title: string };

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));

export function SigningPanel({ dealId, status, hasFile, reviewNote, onChanged }: { dealId: string; status: string; hasFile: boolean; reviewNote: string; onChanged: () => void }) {
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [sigs, comp] = await Promise.all([
      fetch(`/api/agreements/${dealId}/signatures`, { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<{ signatures: Signature[] }>) : { signatures: [] })),
      fetch('/api/settings/signature', { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<Company>) : null)),
    ]);
    setSignatures(sigs.signatures);
    if (comp) {
      setCompany(comp);
      setName((current) => current || comp.name);
      setTitle((current) => current || comp.title);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load, status]);

  const call = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError('');
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setError(payload?.error ?? 'That did not work.');
      return false;
    }
    return true;
  };

  const approve = async () => {
    if (await call(`/api/agreements/${dealId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', name, title }) })) {
      await load();
      onChanged();
    }
  };

  const resend = async () => {
    if (await call(`/api/agreements/${dealId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resend' }) })) onChanged();
  };

  const uploadSignature = async (file: File) => {
    const data = new FormData();
    data.set('file', file);
    data.set('name', name);
    data.set('title', title);
    if (await call('/api/settings/signature', { method: 'POST', body: data })) await load();
  };

  const client = signatures.find((s) => s.role === 'client');

  if (status === 'signed' && signatures.length === 0) return null;

  return (
    <section className="card section-card bk-tint-go">
      <h3><PenLine size={16} aria-hidden="true" /> Signature</h3>
      {error ? <p className="bk-error" role="alert">{error}</p> : null}

      {status === 'draft' || status === 'sent' || status === 'changes_requested' ? (
        <>
          {status === 'changes_requested' ? (
            <div className="bk-adjust bk-adjust-open">
              <div className="bk-grow">
                <p><b>The client asked for a change</b></p>
                <p className="bk-sub">{reviewNote || 'No message.'}</p>
              </div>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void resend()}>Done, send it again</button>
            </div>
          ) : null}
          {hasFile ? (
            <>
              <p className="bk-note bk-note-top">
                <ShieldCheck size={14} aria-hidden="true" /> Send this link to the client. They read the document, draw their signature on screen and press approve. The signed PDF then replaces the unsigned one, and it comes back here for you to review and approve.
              </p>
              <SharePanel kind="agreement" targetId={dealId} />
            </>
          ) : (
            <p className="bk-empty">Upload the PDF (or write the document) first. Then you can send it for signature.</p>
          )}
        </>
      ) : null}

      {status === 'client_signed' ? (
        <>
          <div className="bk-adjust">
            <span className="bk-adjust-icon"><BadgeCheck size={16} aria-hidden="true" /></span>
            <div className="bk-grow">
              <p><b>{client?.name ?? 'The client'}</b>{client?.title ? `, ${client.title}` : ''} signed this on {client ? when(client.signedAt) : ''}</p>
              <p className="bk-sub">Device address {client?.ip || 'not recorded'}. Open the signed PDF below, check it, then approve.</p>
            </div>
            <a className="btn btn-secondary" href={`/api/agreements/${dealId}/file`} target="_blank" rel="noreferrer"><FileSignature size={15} aria-hidden="true" /> Open signed PDF</a>
          </div>
          <h4 className="bk-subhead">Approve and countersign</h4>
          <div className="bk-form">
            <label>Signing for Shotlin<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Sayan Mondal" /></label>
            <label>Designation<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Proprietor" /></label>
          </div>
          <div className="bk-drop">
            <input ref={picker} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSignature(file); event.target.value = ''; }} />
            <p>{company?.hasSignature ? 'Your company signature is saved and will be placed on the approval page.' : 'No company signature saved yet. Upload a picture of your signature or seal (PNG or JPG). It is saved for next time.'}</p>
            <button type="button" className="btn btn-secondary" disabled={busy || name.trim().length < 2} onClick={() => picker.current?.click()}>
              <Upload size={15} aria-hidden="true" /> {company?.hasSignature ? 'Change signature' : 'Upload signature'}
            </button>
          </div>
          <div className="bk-row-actions">
            <button type="button" className="btn btn-primary" disabled={busy || name.trim().length < 2} onClick={() => void approve()}>
              {busy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <BadgeCheck size={15} aria-hidden="true" />} Approve and countersign
            </button>
          </div>
        </>
      ) : null}

      {status === 'signed' && signatures.length > 0 ? (
        <ul className="bk-list">
          {signatures.map((signature) => (
            <li key={`${signature.role}-${signature.signedAt}`} className="bk-adjust">
              <span className="bk-adjust-icon"><BadgeCheck size={16} aria-hidden="true" /></span>
              <div className="bk-grow">
                <p><b>{signature.name}</b>{signature.title ? `, ${signature.title}` : ''} · {signature.role === 'client' ? 'client' : 'Shotlin'} · {when(signature.signedAt)}</p>
                <p className="bk-sub">Document fingerprint {signature.sha256.slice(0, 16)}…{signature.ip ? ` · from ${signature.ip}` : ''}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
