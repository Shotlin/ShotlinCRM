'use client';

import { useEffect, useRef, useState } from 'react';

type View = {
  title: string;
  kind: 'proposal' | 'agreement';
  reference: string;
  status: string;
  party: string;
  baseMinor: number;
  gstMinor: number;
  gstRatePct: number;
  reviewNote: string;
  signBoxPages: number[];
  milestones: { title: string; trigger: string; grossMinor: number }[];
  clientSignature: { name: string; title: string; signedAt: string } | null;
  countersigned: boolean;
};

const inr = (minor: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(minor / 100)}`;
const when = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));

export function SignForm({ token, view }: { token: string; view: View }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [ink, setInk] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [consent, setConsent] = useState(false);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<'idle' | 'signed' | 'asked'>('idle');

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = el.clientWidth * ratio;
    el.height = el.clientHeight * ratio;
    const ctx = el.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
    }
  }, [asking]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y + 0.01);
    ctx.stroke();
    setInk(true);
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const stop = () => {
    drawing.current = false;
  };
  const clear = () => {
    const el = canvas.current;
    el?.getContext('2d')?.clearRect(0, 0, el.width, el.height);
    setInk(false);
  };

  const send = async (body: Record<string, unknown>, next: 'signed' | 'asked') => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/s/${token}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Could not save. Please try again.');
      setState(next);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const signed = view.status === 'client_signed' || view.status === 'signed' || state === 'signed';
  const canSign = view.status === 'sent' && state === 'idle';

  return (
    <>
      <header className="sh-hero">
        <p className="sh-brand">SHOTLIN <span>Digital Product Studio</span></p>
        <h1>{view.title}</h1>
        <p>{view.kind === 'agreement' ? 'Agreement' : 'Proposal'} for {view.party || 'you'}{view.reference ? ` · ${view.reference}` : ''}</p>
        <div className="sh-pills">
          <span className="sh-pill">{signed ? (view.countersigned ? 'Signed by both parties' : 'You have signed') : view.status === 'changes_requested' ? 'Changes requested' : 'Waiting for your signature'}</span>
          <span className="sh-pill">Total {inr(view.baseMinor + view.gstMinor)} incl. {view.gstRatePct}% GST</span>
        </div>
      </header>

      {signed ? (
        <section className="sh-card sh-done">
          <h2>Thank you{view.clientSignature ? `, ${view.clientSignature.name}` : ''}</h2>
          <p>
            {view.countersigned
              ? 'This agreement is now signed by both parties.'
              : 'Your signature has been added. Shotlin will review and approve it, and you will be told when it is final.'}
          </p>
          {view.clientSignature ? <p className="sh-sub">Signed {when(view.clientSignature.signedAt)}</p> : null}
          <p><a className="sh-btn" href={`/s/${token}/agreement`} target="_blank" rel="noreferrer">Download the signed copy (PDF)</a></p>
        </section>
      ) : null}

      {state === 'asked' || view.status === 'changes_requested' ? (
        <section className="sh-card">
          <h2>Your change request was sent</h2>
          <p>Shotlin will update the document and send it to you again. You can open this same link later.</p>
          {view.reviewNote ? <p className="sh-sub">{view.reviewNote}</p> : null}
        </section>
      ) : null}

      <section className="sh-card">
        <h2>Read the document</h2>
        <iframe className="sh-frame" title="The document" src={`/s/${token}/agreement`} />
        <p><a className="sh-btn sh-btn-ghost" href={`/s/${token}/agreement`} target="_blank" rel="noreferrer">Open it in a new tab</a></p>
      </section>

      {view.milestones.length > 0 ? (
        <section className="sh-card">
          <h2>Payment schedule</h2>
          <ul className="sh-ms">
            {view.milestones.map((m) => (
              <li key={m.title}>
                <div><p><b>{m.title}</b></p>{m.trigger ? <p className="sh-sub">{m.trigger}</p> : null}</div>
                <div className="sh-right"><p className="sh-amount">{inr(m.grossMinor)}</p><p className="sh-sub">incl. GST</p></div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canSign ? (
        <section className="sh-card">
          <h2>Approve and sign</h2>
          <div className="sh-fields">
            <label>Your full name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={120} /></label>
            <label>Your role (optional)<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Proprietor, Director" maxLength={120} /></label>
          </div>
          <p className="sh-label">Draw your signature</p>
          {view.signBoxPages.length > 0 ? <p className="sh-sub">It will be placed in the signature box on page {view.signBoxPages.join(', ')} of the document, and recorded on a signature page at the end.</p> : null}
          <canvas ref={canvas} className="sh-pad" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} aria-label="Signature pad" />
          <div className="sh-row">
            <button type="button" className="sh-btn sh-btn-ghost" onClick={clear}>Clear</button>
            <span className="sh-sub">Use your finger or mouse.</span>
          </div>
          <label className="sh-check">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I have read this document in full and agree to it. I am authorised to sign for the client named in it, and I accept this drawn signature as my own.</span>
          </label>
          {error ? <p className="sh-error" role="alert">{error}</p> : null}
          <p>
            <button type="button" className="sh-btn" disabled={busy || !ink || !consent || name.trim().length < 2} onClick={() => void send({ action: 'sign', name, title, signature: canvas.current?.toDataURL('image/png') ?? '', consent }, 'signed')}>
              {busy ? 'Saving…' : 'Approve and sign'}
            </button>
          </p>

          <div className="sh-ask">
            {!asking ? (
              <button type="button" className="sh-link" onClick={() => setAsking(true)}>Something needs to change? Ask for a change instead</button>
            ) : (
              <>
                <label className="sh-label">What would you like changed?
                  <textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} />
                </label>
                <p>
                  <button type="button" className="sh-btn sh-btn-ghost" disabled={busy || message.trim().length < 3} onClick={() => void send({ action: 'changes', name, message }, 'asked')}>Send my request</button>{' '}
                  <button type="button" className="sh-link" onClick={() => setAsking(false)}>Cancel</button>
                </p>
              </>
            )}
          </div>
        </section>
      ) : null}

      <footer className="sh-foot">
        This is a private page made for you by Shotlin. Please do not share the link. Your signature, the time and your device address are recorded on the signed document.
      </footer>
    </>
  );
}
