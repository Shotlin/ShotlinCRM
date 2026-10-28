'use client';

import { ArrowLeft, Check, Download, FileSignature, FolderKanban, LoaderCircle, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from '@/lib/router';
import { describeMilestones, gstOf, splitByPercent } from '@/server/services/deals/milestones';
import { useCrmStore } from '@/store/crmStore';
import { day, inr } from '../gst/format';
import { BlockEditor } from './BlockEditor';
import { SigningPanel } from './SigningPanel';
import { starterBlocks, type Block } from '@/server/services/deals/content';

type Row = { key: string; title: string; trigger: string; amount: string; dueOn: string };
type Form = {
  kind: 'proposal' | 'agreement';
  clientId: string;
  leadId: string;
  title: string;
  reference: string;
  status: 'draft' | 'sent' | 'signed' | 'declined';
  base: string;
  gstRatePct: string;
  issuedOn: string;
  signedOn: string;
  durationDays: string;
  brief: string;
  sourceDocumentId: string;
  mode: 'upload' | 'write';
  blocks: Block[];
  rows: Row[];
};
type Loaded = {
  id: string;
  kind: 'proposal' | 'agreement';
  clientId: string | null;
  leadId: string | null;
  title: string;
  reference: string;
  status: Form['status'] | 'client_signed' | 'changes_requested';
  reviewNote: string;
  baseAmountMinor: number;
  gstRatePct: number;
  issuedOn: string | null;
  signedOn: string | null;
  durationDays: number | null;
  brief: string;
  fileName: string | null;
  fileSize: number | null;
  hasFile: boolean;
  sourceDocumentId: string | null;
  content: Block[] | null;
  projectId: string | null;
  milestones: { id: string; title: string; trigger: string; baseMinor: number; dueOn: string | null }[];
};

const newKey = () => Math.random().toString(36).slice(2);
const blankRow = (): Row => ({ key: newKey(), title: '', trigger: '', amount: '', dueOn: '' });
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const paise = (value: string) => Math.round((Number(value.replace(/,/g, '')) || 0) * 100);
const rupees = (minor: number) => String(minor / 100);

const fromLoaded = (doc: Loaded): Form => ({
  kind: doc.kind,
  clientId: doc.clientId ?? '',
  leadId: doc.leadId ?? '',
  title: doc.title,
  reference: doc.reference,
  status: (doc.status === 'client_signed' || doc.status === 'changes_requested' ? 'sent' : doc.status) as Form['status'],
  base: rupees(doc.baseAmountMinor),
  gstRatePct: String(doc.gstRatePct),
  issuedOn: doc.issuedOn ?? '',
  signedOn: doc.signedOn ?? '',
  durationDays: doc.durationDays ? String(doc.durationDays) : '',
  brief: doc.brief,
  sourceDocumentId: doc.sourceDocumentId ?? '',
  mode: doc.content ? 'write' : 'upload',
  blocks: doc.content ?? [],
  rows: doc.milestones.map((m) => ({ key: m.id, title: m.title, trigger: m.trigger, amount: rupees(m.baseMinor), dueOn: m.dueOn ?? '' })),
});

const STEP_NAMES = ['Kickoff / initial advance', 'Delivery / UAT', 'Final release'];

export function AgreementEditorPage() {
  const params = useParams<{ dealId: string }>();
  const isNew = params.dealId === 'new';
  const navigate = useNavigate();
  const clients = useCrmStore((state) => state.clients);
  const leads = useCrmStore((state) => state.leads);
  const chats = useCrmStore((state) => state.chats);
  const fileInput = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<Form>({
    kind: 'agreement', clientId: '', leadId: '', title: '', reference: '', status: 'draft', base: '', gstRatePct: '18',
    issuedOn: today(), signedOn: '', durationDays: '', brief: '', sourceDocumentId: '', mode: 'upload', blocks: [], rows: [blankRow(), blankRow(), blankRow()],
  });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [pending, setPending] = useState<File | null>(null);
  const [split, setSplit] = useState('50,30,20');
  const [kickoff, setKickoff] = useState(today());
  const [busy, setBusy] = useState<'save' | 'project' | 'upload' | 'preview' | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const signedLock = Boolean(loaded && (loaded.status === 'client_signed' || loaded.status === 'signed'));
  const locked = Boolean(loaded?.projectId) || signedLock;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const fromId = query.get('from');
    if (isNew) {
      const kind = query.get('kind') === 'proposal' ? 'proposal' : 'agreement';
      setForm((current) => ({ ...current, kind, clientId: query.get('clientId') ?? '', leadId: query.get('leadId') ?? '' }));
      if (!fromId) return;
    }
    const id = isNew ? fromId! : params.dealId;
    fetch(`/api/agreements/${id}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('This document was not found.');
        return (await response.json()) as Loaded;
      })
      .then((doc) => {
        if (isNew) {
          // An agreement written from a proposal starts with the proposal's details, but not its file.
          setForm({ ...fromLoaded(doc), kind: 'agreement', status: 'draft', signedOn: '', reference: '', sourceDocumentId: doc.id, title: doc.title.replace(/proposal/i, 'Agreement') });
          setNote(`Started from the proposal "${doc.title}". Upload the agreement PDF and check the milestones.`);
        } else {
          setLoaded(doc);
          setForm(fromLoaded(doc));
        }
      })
      .catch((problem: Error) => setError(problem.message))
      .finally(() => setLoading(false));
  }, [isNew, params.dealId]);

  const refreshLoaded = async () => {
    const fresh = await fetch(`/api/agreements/${params.dealId}`, { cache: 'no-store' });
    if (fresh.ok) {
      const doc = (await fresh.json()) as Loaded;
      setLoaded(doc);
      setForm(fromLoaded(doc));
    }
  };

  const baseMinor = paise(form.base);
  const rate = Math.round(Number(form.gstRatePct) || 0);
  const parts = form.rows.map((row) => paise(row.amount));
  const rows = describeMilestones(baseMinor, rate, parts);
  const sum = parts.reduce((a, b) => a + b, 0);
  const matches = baseMinor > 0 && sum === baseMinor;
  const totalGross = baseMinor + gstOf(baseMinor, rate);

  const applySplit = () => {
    const percents = split.split(',').map((value) => Number(value.trim())).filter((value) => value > 0);
    if (percents.length === 0 || Math.abs(percents.reduce((a, b) => a + b, 0) - 100) > 0.01) {
      setError('The percentages must add up to 100, for example 50,30,20.');
      return;
    }
    setError('');
    const amounts = splitByPercent(baseMinor, percents);
    setForm((current) => ({
      ...current,
      rows: amounts.map((amount, index) => ({
        key: current.rows[index]?.key ?? newKey(),
        title: current.rows[index]?.title || `Milestone ${index + 1} - ${STEP_NAMES[index] ?? ''}`.trim().replace(/ -$/, ''),
        trigger: current.rows[index]?.trigger ?? '',
        amount: rupees(amount),
        dueOn: current.rows[index]?.dueOn ?? '',
      })),
    }));
  };

  const updateRow = (key: string, patch: Partial<Row>) => setForm((current) => ({ ...current, rows: current.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)) }));

  const body = {
      kind: form.kind,
      clientId: form.clientId || null,
      leadId: form.leadId || null,
      title: form.title,
      reference: form.reference,
      status: form.status,
      baseRupees: baseMinor / 100,
      gstRatePct: rate,
      issuedOn: form.issuedOn || null,
      signedOn: form.signedOn || null,
      durationDays: form.durationDays ? Number(form.durationDays) : null,
      brief: form.brief,
      sourceDocumentId: form.sourceDocumentId || null,
      milestones: form.rows
        .filter((row) => row.title.trim() || row.amount.trim())
        .map((row) => ({ title: row.title, trigger: row.trigger, amountRupees: paise(row.amount) / 100, dueOn: row.dueOn || null })),
  };

  const chooseMode = (mode: Form['mode']) =>
    setForm((current) => ({ ...current, mode, blocks: mode === 'write' && current.blocks.length === 0 ? starterBlocks(current.kind) : current.blocks }));

  const preview = async () => {
    setBusy('preview');
    setError('');
    try {
      const response = await fetch('/api/agreements/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Could not build the preview.');
      window.open(URL.createObjectURL(await response.blob()), '_blank');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not build the preview.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError('');
    try {
      let response: Response;
      if (isNew) {
        const data = new FormData();
        data.set('data', JSON.stringify(body));
        if (pending) data.set('file', pending);
        response = await fetch('/api/agreements', { method: 'POST', body: data });
      } else {
        response = await fetch(`/api/agreements/${params.dealId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      const payload = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Could not save.');
      if (isNew && payload?.id) navigate(`/agreements/${payload.id}`);
      else {
        setNote('Saved.');
        const fresh = await fetch(`/api/agreements/${params.dealId}`, { cache: 'no-store' });
        if (fresh.ok) setLoaded((await fresh.json()) as Loaded);
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    if (isNew) {
      setPending(file);
      return;
    }
    setBusy('upload');
    setError('');
    const data = new FormData();
    data.set('file', file);
    const response = await fetch(`/api/agreements/${params.dealId}/file`, { method: 'POST', body: data });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) setError(payload?.error ?? 'Upload failed.');
    else {
      setNote('PDF uploaded and stored compressed in R2.');
      const fresh = await fetch(`/api/agreements/${params.dealId}`, { cache: 'no-store' });
      if (fresh.ok) setLoaded((await fresh.json()) as Loaded);
    }
    setBusy(null);
  };

  const createProject = async () => {
    setBusy('project');
    setError('');
    const response = await fetch(`/api/agreements/${params.dealId}/project`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startsOn: kickoff }) });
    const payload = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
    setBusy(null);
    if (!response.ok || !payload?.id) setError(payload?.error ?? 'Could not create the project.');
    else navigate(`/projects/${payload.id}`);
  };

  const remove = async () => {
    if (!window.confirm('Delete this document and its PDF? This cannot be undone.')) return;
    const response = await fetch(`/api/agreements/${params.dealId}`, { method: 'DELETE' });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (response.ok) navigate('/agreements');
    else setError(payload?.error ?? 'Could not delete.');
  };

  if (loading) return <div className="page editor-page"><p className="bk-loading"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Loading…</p></div>;

  const fileLabel = pending?.name ?? loaded?.fileName ?? null;
  const people = [...leads, ...chats].filter((lead) => lead.name);

  return (
    <div className="page editor-page">
      <div className="editor-topbar">
        <Link to="/agreements" className="back-link"><ArrowLeft size={15} aria-hidden="true" /> Proposals &amp; agreements</Link>
        <span className="eyebrow">{form.kind === 'agreement' ? 'Agreement' : 'Proposal'}</span>
      </div>
      <div className="editor-title-row">
        <div>
          <h1>{isNew ? `Upload ${form.kind}` : form.title || 'Untitled'}</h1>
          <p>{isNew ? 'Upload the PDF you wrote, then set the cost and payment milestones.' : 'Keep the cost and milestones in step with the PDF.'}</p>
        </div>
        <div className="editor-top-actions">
          {loaded?.hasFile ? (
            <a className="btn btn-secondary" href={`/api/agreements/${loaded.id}/file`} target="_blank" rel="noreferrer"><Download size={15} aria-hidden="true" /> View PDF</a>
          ) : null}
          {!isNew && loaded?.kind === 'proposal' ? (
            <Link to={`/agreements/new?kind=agreement&from=${loaded.id}`} className="btn btn-secondary"><FileSignature size={15} aria-hidden="true" /> Make agreement from this</Link>
          ) : null}
          {!signedLock ? <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void save()}>
            {busy === 'save' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />} Save
          </button> : null}
        </div>
      </div>

      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      {note ? <p className="bk-ok">{note}</p> : null}

      {loaded?.kind === 'agreement' ? (
        <section className="card section-card bk-tint-go">
          <h3><FolderKanban size={17} aria-hidden="true" /> Project</h3>
          {loaded.projectId ? (
            <p>This agreement already started a project. <Link to={`/projects/${loaded.projectId}`} className="bk-link"><b>Open the project</b></Link></p>
          ) : (
            <div className="bk-inline">
              <p>Start the project from this agreement. The payment milestones move across, and you can then add the timeline and raise each invoice.</p>
              <label className="bk-field">Kickoff date<input type="date" value={kickoff} onChange={(event) => setKickoff(event.target.value)} /></label>
              <button type="button" className="btn btn-primary" disabled={busy !== null || !loaded.milestones.length || loaded.status === 'client_signed'} onClick={() => void createProject()}>
                {busy === 'project' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <FolderKanban size={15} aria-hidden="true" />} Create project
              </button>
              {!loaded.milestones.length ? <p className="bk-sub">Add and save the payment milestones first.</p> : null}
              {loaded.status === 'client_signed' ? <p className="bk-sub">Approve the client's signature below first, then start the project.</p> : null}
            </div>
          )}
        </section>
      ) : null}

      {!isNew && loaded ? <SigningPanel dealId={loaded.id} status={loaded.status} hasFile={loaded.hasFile} reviewNote={loaded.reviewNote} onChanged={() => void refreshLoaded()} /> : null}
      {signedLock ? <p className="bk-note">This document is signed, so it is locked. Start a new version if something has to change.</p> : null}

      <div className={signedLock ? 'bk-locked' : undefined} inert={signedLock}>
      <section className="card section-card">
        <h3><FileSignature size={17} aria-hidden="true" /> Details</h3>
        <div className="bk-form">
          <label>Type
            <select value={form.kind} onChange={(event) => set('kind', event.target.value as Form['kind'])} disabled={!isNew}>
              <option value="agreement">Agreement</option>
              <option value="proposal">Proposal</option>
            </select>
          </label>
          <label>Status
            <select value={form.status} onChange={(event) => set('status', event.target.value as Form['status'])}>
              <option value="draft">Draft</option><option value="sent">Sent to client</option><option value="signed">Signed</option><option value="declined">Declined</option>
            </select>
          </label>
          <label>Client
            <select value={form.clientId} onChange={(event) => set('clientId', event.target.value)}>
              <option value="">No client yet</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}
            </select>
          </label>
          <label>Or a lead
            <select value={form.leadId} onChange={(event) => set('leadId', event.target.value)}>
              <option value="">No lead</option>
              {people.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}{lead.company ? ` · ${lead.company}` : ''}</option>)}
            </select>
          </label>
          <label className="bk-wide">Title<input value={form.title} onChange={(event) => set('title', event.target.value)} placeholder="e.g. DEALKR Multi-Vendor E-Commerce Marketplace" /></label>
          <label>Reference<input value={form.reference} onChange={(event) => set('reference', event.target.value)} placeholder="e.g. SHOT/PROP/2627/004-R1" /></label>
          <label>Issued on<input type="date" value={form.issuedOn} onChange={(event) => set('issuedOn', event.target.value)} /></label>
          <label>Signed on<input type="date" value={form.signedOn} onChange={(event) => set('signedOn', event.target.value)} /></label>
          <label>Delivery time (days)<input inputMode="numeric" value={form.durationDays} onChange={(event) => set('durationDays', event.target.value)} placeholder="e.g. 30 or 60" /></label>
          <label className="bk-wide">Project brief
            <textarea rows={4} value={form.brief} onChange={(event) => set('brief', event.target.value)} placeholder="What is being built, in a few lines. It carries over to the project." />
          </label>
        </div>
      </section>

      <section className="card section-card">
        <h3><Upload size={17} aria-hidden="true" /> The document</h3>
        <div className="bk-mode" role="tablist" aria-label="How the document is made">
          <button type="button" role="tab" aria-selected={form.mode === 'upload'} className={form.mode === 'upload' ? 'on' : ''} onClick={() => chooseMode('upload')}>Upload a PDF</button>
          <button type="button" role="tab" aria-selected={form.mode === 'write'} className={form.mode === 'write' ? 'on' : ''} onClick={() => chooseMode('write')}>Write it here</button>
        </div>
        {form.mode === 'upload' ? (
          <div className="bk-drop">
            <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
            <p>{fileLabel ? <><b>{fileLabel}</b>{loaded?.fileSize ? ` · ${(loaded.fileSize / 1024).toFixed(0)} KB, stored compressed in R2` : ' · will upload when you save'}</> : 'No PDF yet. Upload the document you wrote.'}</p>
            <button type="button" className="btn btn-secondary" disabled={busy === 'upload'} onClick={() => fileInput.current?.click()}>
              {busy === 'upload' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />} {fileLabel ? 'Replace PDF' : 'Choose PDF'}
            </button>
          </div>
        ) : (
          <>
            <p className="bk-note bk-note-top">
              Write the body here and the PDF is made for you when you save. The first page (parties, fee), the payment milestones and the signature boxes are added automatically from the details above and below.
            </p>
            <div className="bk-row-actions bk-row-top">
              <button type="button" className="btn btn-secondary" onClick={() => { if (form.blocks.length === 0 || window.confirm('Replace what is written with the starting template?')) set('blocks', starterBlocks(form.kind)); }}>Start from a template</button>
              <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void preview()}>
                {busy === 'preview' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <FileSignature size={15} aria-hidden="true" />} Preview the PDF
              </button>
              {loaded?.hasFile ? <span className="bk-sub">The saved PDF is updated every time you press Save.</span> : null}
            </div>
            <BlockEditor blocks={form.blocks} onChange={(next) => set('blocks', next)} disabled={signedLock} />
          </>
        )}
      </section>

      <section className="card section-card">
        <h3><Check size={17} aria-hidden="true" /> Cost and payment milestones</h3>
        <div className="bk-form">
          <label>Project cost before GST (₹)<input inputMode="decimal" value={form.base} onChange={(event) => set('base', event.target.value)} placeholder="e.g. 60000" disabled={locked} /></label>
          <label>GST %<input inputMode="numeric" value={form.gstRatePct} onChange={(event) => set('gstRatePct', event.target.value)} disabled={locked} /></label>
        </div>
        <p className="bk-total">
          {baseMinor > 0 ? <>Total payable: <b>{inr(totalGross)}</b> <span className="bk-sub">({inr(baseMinor)} + GST {inr(gstOf(baseMinor, rate))})</span></> : 'Enter the cost to see the total.'}
        </p>

        {locked ? (
          <p className="bk-note">The project already exists, so the milestones are changed on the project page.</p>
        ) : (
          <div className="bk-split-tool">
            <label>Quick split by percent<input value={split} onChange={(event) => setSplit(event.target.value)} /></label>
            <button type="button" className="btn btn-secondary" onClick={applySplit} disabled={baseMinor <= 0}>Fill milestones</button>
          </div>
        )}

        <div className="bk-ms-head"><span>Milestone</span><span>When it is due</span><span>Amount (₹)</span><span>Share · GST · Total</span><span>Date</span><span /></div>
        {form.rows.map((row, index) => (
          <div key={row.key} className="bk-ms-row">
            <input value={row.title} placeholder={`Milestone ${index + 1}`} onChange={(event) => updateRow(row.key, { title: event.target.value })} disabled={locked} />
            <input value={row.trigger} placeholder="Trigger, e.g. written acceptance and kickoff access" onChange={(event) => updateRow(row.key, { trigger: event.target.value })} disabled={locked} />
            <input inputMode="decimal" value={row.amount} placeholder="0" onChange={(event) => updateRow(row.key, { amount: event.target.value })} disabled={locked} />
            <span className="bk-sub">{rows[index]?.baseMinor ? `${rows[index].percent}% · ${inr(rows[index].gstMinor)} · ` : ''}<b>{rows[index]?.baseMinor ? inr(rows[index].grossMinor) : '-'}</b></span>
            <input type="date" value={row.dueOn} onChange={(event) => updateRow(row.key, { dueOn: event.target.value })} disabled={locked} />
            {!locked ? (
              <button type="button" className="bk-iconbtn" aria-label="Remove milestone" onClick={() => setForm((current) => ({ ...current, rows: current.rows.length > 1 ? current.rows.filter((r) => r.key !== row.key) : current.rows }))}><Trash2 size={15} /></button>
            ) : <span />}
          </div>
        ))}
        {!locked ? <button type="button" className="btn btn-secondary" onClick={() => setForm((current) => ({ ...current, rows: [...current.rows, blankRow()] }))}><Plus size={15} aria-hidden="true" /> Add milestone</button> : null}
        {baseMinor > 0 ? (
          <p className={matches ? 'bk-match ok' : 'bk-match bad'}>
            {matches ? `Milestones add up to ${inr(sum)}.` : `Milestones add up to ${inr(sum)}; they must equal ${inr(baseMinor)} (${sum > baseMinor ? 'over' : 'short'} by ${inr(Math.abs(baseMinor - sum))}).`}
          </p>
        ) : null}
      </section>

      </div>

      {!isNew && !loaded?.projectId && !signedLock ? (
        <button type="button" className="btn btn-secondary bk-danger" onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" /> Delete this document</button>
      ) : null}
      {loaded?.issuedOn ? <p className="bk-foot">Issued {day(loaded.issuedOn)}</p> : null}
    </div>
  );
}
