'use client';

import { useEffect, useRef, useState } from 'react';
import { RiCheckLine, RiEraserLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';

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

const when = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));

export function SignForm({ token, view }: { token: string; view: View }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [ink, setInk] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<'idle' | 'signed'>('idle');

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
  }, []);

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

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/s/${token}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Could not save. Please try again.');
      setState('signed');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const signed = view.status === 'client_signed' || view.status === 'signed' || state === 'signed';
  const canSign = view.status === 'sent' && state === 'idle';

  return (
    <div className="sh-sign-layout">
      <header className="sh-sign-heading">
        <span className="sh-sign-kicker">{view.kind === 'proposal' ? 'Proposal' : 'Agreement'} · Secure signing link</span>
        <h1>{view.title}</h1>
        <p>{signed ? 'Your signature has been recorded. You can review the document below.' : 'Please review the document below, then add your signature to confirm your acceptance.'}</p>
      </header>
      {signed ? (
        <section className="sh-card sh-done sh-sign-done">
          <h2>Thank you{view.clientSignature ? `, ${view.clientSignature.name}` : ''}</h2>
          <p>
            {view.countersigned
              ? 'This agreement is now signed by both parties.'
              : 'Your signature has been added. Shotlin will review and approve it, and you will be told when it is final.'}
          </p>
          {view.clientSignature ? <p className="sh-sub">Signed {when(view.clientSignature.signedAt)}</p> : null}
          <p><a className="sh-btn" href={`/s/${token}/agreement`} target="_blank" rel="noreferrer">Download the signed copy (PDF)</a></p>
        </section>
      ) : (
        <div className="sh-sign-grid">
          <section className="sh-card sh-document-card">
            <div className="sh-document-head"><div><strong>Agreement</strong><span>Review your document before signing</span></div><a href={`/s/${token}/agreement`} target="_blank" rel="noreferrer">Open PDF ↗</a></div>
            <iframe className="sh-frame" title="The agreement" src={`/s/${token}/agreement`} />
          </section>

          {canSign ? <section className="sh-card sh-sign-card">
          <h2 className="sh-sign-title">Sign and approve</h2>
          <p className="sh-sign-intro">Please review the document, then add your signature below.</p>
          <div className="sh-fields">
            <Input label="Your full name" value={name} onChange={setName} autoComplete="name" maxLength={120} isRequired />
            <Input label="Your role (optional)" value={title} onChange={setTitle} placeholder="e.g. Proprietor, Director" maxLength={120} />
          </div>
          <p className="sh-label">Your signature</p>
          {view.signBoxPages.length > 0 ? <p className="sh-sub">It will be placed in the signature box on page {view.signBoxPages.join(', ')} of the document, and recorded on a signature page at the end.</p> : null}
          <canvas ref={canvas} className="sh-pad" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} aria-label="Signature pad" />
          <div className="sh-row">
            <Button className="sh-clear-button" variant="secondary" size="small" leadingIcon={RiEraserLine} onClick={clear}>Clear signature</Button>
            <span className="sh-sub">Use your finger or mouse.</span>
          </div>
          <Checkbox className="sh-check" isSelected={consent} onChange={setConsent}>
            <span>I have read this document in full and agree to it. I am authorised to sign for the client named in it, and I accept this drawn signature as my own.</span>
          </Checkbox>
          {error ? <p className="sh-error" role="alert">{error}</p> : null}
          <p>
            <Button className="sh-approve-button" leadingIcon={RiCheckLine} disabled={busy || !ink || !consent || name.trim().length < 2} onClick={() => void send({ action: 'sign', name, title, signature: canvas.current?.toDataURL('image/png') ?? '', consent })}>
              {busy ? 'Saving…' : 'Approve and sign'}
            </Button>
          </p>
          </section> : null}
        </div>
      )}
      <footer className="sh-foot">Private signing link. Your signature, signing time and device address are recorded on the completed document.</footer>
    </div>
  );
}
