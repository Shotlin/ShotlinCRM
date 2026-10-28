'use client';

import { LoaderCircle, MousePointer2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FIELD_LABEL, fitField, type SignField } from '@/server/services/deals/fields';

type Pdf = { numPages: number; getPage: (n: number) => Promise<Page> };
type Page = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<unknown>; cancel: () => void };
};

const newId = () => Math.random().toString(36).slice(2, 10);

// Shows the real pages of the PDF and lets you place, move, resize and remove the signature boxes.
export function SignaturePlacer({ dealId, initial, disabled, onSaved }: { dealId: string; initial: SignField[]; disabled: boolean; onSaved: () => void }) {
  const [pdf, setPdf] = useState<Pdf | null>(null);
  const [fields, setFields] = useState<SignField[]>(initial);
  const [target, setTarget] = useState(1);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setFields(initial), [initial]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const response = await fetch(`/api/agreements/${dealId}/file`, { cache: 'no-store' });
        if (!response.ok) throw new Error('no file');
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
        if (cancelled) return;
        setPdf(doc as unknown as Pdf);
        setTarget(Math.max(1, doc.numPages));
        setState('ready');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  const change = (id: string, patch: Partial<SignField>) => setFields((list) => list.map((f) => (f.id === id ? fitField({ ...f, ...patch }) : f)));
  const add = (role: SignField['role']) => setFields((list) => [...list, fitField({ id: newId(), role, page: target, x: role === 'client' ? 0.08 : 0.55, y: 0.78, w: 0.36, h: 0.07 })]);

  const save = async () => {
    setSaving(true);
    setError('');
    setNote('');
    const response = await fetch(`/api/agreements/${dealId}/sign-fields`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) setError(payload?.error ?? 'Could not save the signature boxes.');
    else {
      setNote(fields.length ? 'Signature boxes saved. Signing will stamp the signature inside them.' : 'No boxes. Signing will add only the signature page.');
      onSaved();
    }
  };

  return (
    <div className="bk-placer">
      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      {note ? <p className="bk-ok">{note}</p> : null}
      <div className="bk-row-actions bk-row-top">
        <label className="bk-select">On page
          <select value={target} onChange={(event) => setTarget(Number(event.target.value))} disabled={!pdf}>
            {Array.from({ length: pdf?.numPages ?? 1 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-secondary" disabled={disabled || state !== 'ready'} onClick={() => add('client')}><Plus size={15} aria-hidden="true" /> Client signature box</button>
        <button type="button" className="btn btn-secondary" disabled={disabled || state !== 'ready'} onClick={() => add('developer')}><Plus size={15} aria-hidden="true" /> Our signature box</button>
        <button type="button" className="btn btn-primary" disabled={disabled || saving} onClick={() => void save()}>
          {saving ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <MousePointer2 size={15} aria-hidden="true" />} Save boxes
        </button>
      </div>
      <p className="bk-sub">Drag a box to move it and pull its corner to resize. Boxes with nothing placed mean the signature goes only on the signature page.</p>

      {state === 'loading' ? <p className="bk-loading"><LoaderCircle className="spin" size={16} aria-hidden="true" /> Opening the PDF…</p> : null}
      {state === 'failed' ? <p className="bk-error">The PDF could not be opened here. Check that a PDF is saved on this document.</p> : null}

      <div className="bk-pages" ref={wrap}>
        {pdf ? Array.from({ length: pdf.numPages }, (_, index) => (
          <PdfPage key={index + 1} pdf={pdf} number={index + 1} fields={fields.filter((f) => f.page === index + 1)} disabled={disabled} onChange={change} onRemove={(id) => setFields((list) => list.filter((f) => f.id !== id))} />
        )) : null}
      </div>
    </div>
  );
}

function PdfPage({ pdf, number, fields, disabled, onChange, onRemove }: { pdf: Pdf; number: number; fields: SignField[]; disabled: boolean; onChange: (id: string, patch: Partial<SignField>) => void; onRemove: (id: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; startX: number; startY: number; field: SignField } | null>(null);
  const task = useRef<{ cancel: () => void } | null>(null);

  const draw = useCallback(async () => {
    const el = canvas.current;
    const box = holder.current;
    if (!el || !box) return;
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const scale = (box.clientWidth / base.width) * (window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale });
    el.width = viewport.width;
    el.height = viewport.height;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    // One drawing at a time per page: a newer one replaces an older one that is still running.
    task.current?.cancel();
    const current = page.render({ canvas: el, canvasContext: ctx, viewport });
    task.current = current;
    try {
      await current.promise;
    } catch {
      // A cancelled drawing is expected when a newer one starts.
    }
  }, [pdf, number]);

  useEffect(() => {
    void draw();
    return () => task.current?.cancel();
  }, [draw]);

  const begin = (event: React.PointerEvent, field: SignField, mode: 'move' | 'resize') => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Some browsers refuse capture for a synthetic pointer; dragging still works without it.
    }
    drag.current = { id: field.id, mode, startX: event.clientX, startY: event.clientY, field };
  };
  const move = (event: React.PointerEvent) => {
    const d = drag.current;
    const box = holder.current;
    if (!d || !box) return;
    const dx = (event.clientX - d.startX) / box.clientWidth;
    const dy = (event.clientY - d.startY) / box.clientHeight;
    onChange(d.id, d.mode === 'move' ? { x: d.field.x + dx, y: d.field.y + dy } : { w: d.field.w + dx, h: d.field.h + dy });
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <div className="bk-page-wrap">
      <div className="bk-page-no">Page {number}</div>
      <div className="bk-pdf-page" ref={holder} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <canvas ref={canvas} className="bk-pdf-canvas" />
        {fields.map((field) => (
          <div
            key={field.id}
            className={`bk-sign-box bk-sign-${field.role}${disabled ? ' off' : ''}`}
            style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.w * 100}%`, height: `${field.h * 100}%` }}
            onPointerDown={(event) => begin(event, field, 'move')}
          >
            <span>{FIELD_LABEL[field.role]}</span>
            {!disabled ? (
              <>
                <button type="button" className="bk-sign-x" aria-label="Remove this box" onPointerDown={(event) => event.stopPropagation()} onClick={() => onRemove(field.id)}><Trash2 size={12} /></button>
                <i className="bk-sign-grip" onPointerDown={(event) => begin(event, field, 'resize')} />
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
