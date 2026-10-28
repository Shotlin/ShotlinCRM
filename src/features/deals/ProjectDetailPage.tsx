'use client';

import { ArrowLeft, CalendarClock, Check, FilePlus2, FileSignature, FileText, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import { Link, useParams } from '@/lib/router';
import { gstOf, invoicePlan } from '@/server/services/deals/milestones';
import { day, inr } from '../gst/format';
import { PROJECT_STATUS } from './ProjectsPage';
import { SharePanel } from './SharePanel';

type RoadmapItem = { id: string; title: string; detail: string; dueOn: string | null; status: 'planned' | 'in_progress' | 'done' };
type Milestone = {
  id: string;
  index: number;
  kind: 'agreed' | 'additional';
  title: string;
  trigger: string;
  baseMinor: number;
  grossMinor: number;
  dueOn: string | null;
  status: 'planned' | 'in_progress' | 'delivered' | 'accepted';
  invoice: { id: string; number: string; status: string; cancelled: boolean; receivedMinor: number } | null;
};
type Detail = {
  id: string;
  title: string;
  status: string;
  brief: string;
  startsOn: string | null;
  dueOn: string;
  roadmap: RoadmapItem[];
  client: { id: string; name: string; company: string };
  agreement: { id: string; title: string; hasFile: boolean } | null;
  gstRatePct: number;
  milestones: Milestone[];
};

const M_STATUS = { planned: 'Planned', in_progress: 'In progress', delivered: 'Delivered', accepted: 'Accepted' } as const;
const R_STATUS = { planned: 'Upcoming', in_progress: 'Ongoing', done: 'Done' } as const;
const newId = () => `r-${Math.random().toString(36).slice(2, 10)}`;

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [brief, setBrief] = useState('');
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [extra, setExtra] = useState({ title: '', trigger: '', amount: '', dueOn: '', status: 'planned' as Milestone['status'] });

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}`, { cache: 'no-store' });
    if (!response.ok) {
      setError('This project was not found.');
      return;
    }
    const detail = (await response.json()) as Detail;
    setData(detail);
    setBrief(detail.brief);
    setRoadmap(detail.roadmap);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, message?: string) => {
    setSaving(true);
    setError('');
    const response = await fetch(`/api/projects/${projectId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) setError(payload?.error ?? 'Could not save.');
    else {
      if (message) setNote(message);
      await load();
    }
  };

  const patchMilestone = async (id: string, body: Record<string, unknown>) => {
    const response = await fetch(`/api/projects/${projectId}/milestones/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) setError('Could not update the milestone.');
    else await load();
  };

  if (!data) return <div className="page">{error ? <p className="bk-error" role="alert">{error}</p> : <p className="bk-loading"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Loading…</p>}</div>;

  // The invoice plan (advances first, final last) only looks at the agreed milestones.
  const agreed = data.milestones.filter((m) => m.kind === 'agreed');
  const additional = data.milestones.filter((m) => m.kind === 'additional');
  const parts = agreed.map((m) => m.baseMinor);
  const total = parts.reduce((a, b) => a + b, 0);
  const additionalTotal = additional.reduce((a, m) => a + m.baseMinor, 0);
  const invoicedMinor = data.milestones.filter((m) => m.invoice && !m.invoice.cancelled).reduce((a, m) => a + m.baseMinor, 0);
  const ongoing = roadmap.filter((r) => r.status === 'in_progress');
  const upcoming = roadmap.filter((r) => r.status === 'planned');
  const done = roadmap.filter((r) => r.status === 'done');

  const invoiceLink = (m: Milestone) => {
    if (m.kind === 'additional') {
      // Extra work is billed as an ordinary tax invoice. It does not touch the agreed advances.
      const query = new URLSearchParams({
        clientId: data.client.id,
        milestoneId: m.id,
        type: 'regular',
        project: data.title,
        amount: String(m.baseMinor / 100),
        line: m.title,
        ref: `Additional scope under agreement${data.agreement ? `: ${data.agreement.title}` : ''}`,
      });
      return `/invoices/gst/new?${query.toString()}`;
    }
    const position = agreed.findIndex((x) => x.id === m.id);
    const plan = invoicePlan(parts, position);
    const before = agreed.slice(0, position).map((x) => x.invoice?.number).filter(Boolean).join(', ');
    const query = new URLSearchParams({
      clientId: data.client.id,
      milestoneId: m.id,
      type: plan.docType,
      project: data.title,
      projectTotal: String(plan.projectTaxableMinor / 100),
      advance: String(plan.advanceTaxableMinor / 100),
      amount: String(plan.lineMinor / 100),
      line: m.title,
      ref: data.agreement ? `Agreement: ${data.agreement.title}` : '',
      advanceRef: plan.docType === 'final' ? before : '',
    });
    return `/invoices/gst/new?${query.toString()}`;
  };

  const addExtra = async () => {
    setSaving(true);
    setError('');
    const response = await fetch(`/api/projects/${projectId}/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: extra.title, trigger: extra.trigger, amountRupees: Number(extra.amount.replace(/,/g, '')) || 0, dueOn: extra.dueOn || null, status: extra.status }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) setError(payload?.error ?? 'Could not add it.');
    else {
      setAdding(false);
      setExtra({ title: '', trigger: '', amount: '', dueOn: '', status: 'planned' });
      setNote('Additional charge added.');
      await load();
    }
  };

  const removeExtra = async (m: Milestone) => {
    if (!window.confirm(`Remove "${m.title}"? This cannot be undone.`)) return;
    const response = await fetch(`/api/projects/${projectId}/milestones/${m.id}`, { method: 'DELETE' });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) setError(payload?.error ?? 'Could not remove it.');
    else await load();
  };

  const updateRoadmap = (id: string, change: Partial<RoadmapItem>) => setRoadmap((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));

  return (
    <div className="page">
      <Link to="/projects" className="back-link"><ArrowLeft size={15} aria-hidden="true" /> Projects</Link>
      <PageHeader
        eyebrow="14 / Project"
        title={data.title}
        description={`${data.client.company || data.client.name}${data.startsOn ? ` · kickoff ${day(data.startsOn)}` : ''} · due ${day(data.dueOn)}`}
        actions={
          <label className="bk-select">
            Status
            <select value={data.status} onChange={(event) => void patch({ status: event.target.value }, 'Status updated.')}>
              {Object.entries(PROJECT_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
            </select>
          </label>
        }
      />

      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      {note ? <p className="bk-ok">{note}</p> : null}

      <section className="metric-grid">
        <MetricCard icon={FileSignature} label="Project value" value={inr(total)} detail={additionalTotal > 0 ? `Agreed, plus ${inr(additionalTotal)} additional` : 'Before GST, across all milestones'} />
        <MetricCard icon={FileText} label="Invoiced so far" value={inr(invoicedMinor)} detail={`${data.milestones.filter((m) => m.invoice && !m.invoice.cancelled).length} of ${data.milestones.length} invoices raised`} />
        <MetricCard icon={Check} label="Milestones accepted" value={`${agreed.filter((m) => m.status === 'accepted').length} of ${agreed.length}`} detail="Marked accepted by the client" />
        <MetricCard icon={CalendarClock} label="Timeline" value={`${ongoing.length} ongoing`} detail={`${upcoming.length} upcoming · ${done.length} done`} />
      </section>

      <section className="card section-card">
        <h3><FileSignature size={17} aria-hidden="true" /> Payment milestones</h3>
        <ul className="bk-list">
          {data.milestones.map((m) => (
            <li key={m.id} className="bk-ms-card">
              <div className="bk-grow">
                <p><b>{m.title}</b> {m.kind === 'additional' ? <span className="bk-chip bk-tone-violet">Additional</span> : null} <span className={`bk-chip bk-tone-${m.status === 'accepted' ? 'green' : m.status === 'delivered' ? 'blue' : m.status === 'in_progress' ? 'amber' : 'violet'}`}>{M_STATUS[m.status]}</span></p>
                {m.trigger ? <p className="bk-sub">{m.trigger}</p> : null}
                <p className="bk-sub">{inr(m.baseMinor)} + GST {inr(gstOf(m.baseMinor, data.gstRatePct))} = <b>{inr(m.grossMinor)}</b>{m.dueOn ? ` · due ${day(m.dueOn)}` : ''}</p>
              </div>
              <select value={m.status} onChange={(event) => void patchMilestone(m.id, { status: event.target.value })} aria-label={`Status of ${m.title}`}>
                {Object.entries(M_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {m.invoice && !m.invoice.cancelled ? (
                <Link to={`/invoices/gst/${m.invoice.id}`} className="btn btn-secondary"><FileText size={15} aria-hidden="true" /> {m.invoice.number} · {m.invoice.status.toLowerCase()}</Link>
              ) : (
                <Link to={invoiceLink(m)} className="btn btn-primary"><FilePlus2 size={15} aria-hidden="true" /> Create invoice</Link>
              )}
              {m.kind === 'additional' && !m.invoice ? <button type="button" className="bk-iconbtn" aria-label={`Remove ${m.title}`} onClick={() => void removeExtra(m)}><Trash2 size={15} /></button> : null}
            </li>
          ))}
        </ul>
        {adding ? (
          <div className="bk-extra">
            <h4 className="bk-subhead">Additional charge</h4>
            <div className="bk-form">
              <label className="bk-wide">What is the extra work?<input value={extra.title} onChange={(event) => setExtra({ ...extra, title: event.target.value })} placeholder="e.g. Additional scope: B2B features, new themes and functions" /></label>
              <label className="bk-wide">Details<textarea rows={3} value={extra.trigger} onChange={(event) => setExtra({ ...extra, trigger: event.target.value })} placeholder="What was agreed, when the client approved it and when it will be billed" /></label>
              <label>Amount before GST (₹)<input inputMode="decimal" value={extra.amount} onChange={(event) => setExtra({ ...extra, amount: event.target.value })} placeholder="e.g. 21001" /></label>
              <label>Status
                <select value={extra.status} onChange={(event) => setExtra({ ...extra, status: event.target.value as Milestone['status'] })}>
                  {Object.entries(M_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            {Number(extra.amount) > 0 ? <p className="bk-total">GST {data.gstRatePct}%: <b>{inr(gstOf(Math.round(Number(extra.amount.replace(/,/g, '')) * 100), data.gstRatePct))}</b> · total <b>{inr(Math.round(Number(extra.amount.replace(/,/g, '')) * 100) + gstOf(Math.round(Number(extra.amount.replace(/,/g, '')) * 100), data.gstRatePct))}</b></p> : null}
            <div className="bk-row-actions">
              <button type="button" className="btn btn-primary" disabled={saving || !extra.title.trim() || !(Number(extra.amount) > 0)} onClick={() => void addExtra()}><Check size={15} aria-hidden="true" /> Add charge</button>
              <button type="button" className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="bk-row-actions"><button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}><Plus size={15} aria-hidden="true" /> Add additional charge</button></div>
        )}
        <p className="bk-note">The agreed milestones start as advance requests and the last one becomes the final invoice, which adjusts what was already billed. An additional charge is billed as its own ordinary tax invoice. You can change the type in the invoice form.</p>
      </section>

      <section className="card section-card">
        <h3><CalendarClock size={17} aria-hidden="true" /> Timeline</h3>
        {roadmap.length === 0 ? <p className="bk-empty">No timeline yet. Add the blocks of work, for example “Week 1: Discovery”.</p> : null}
        <div className="bk-road">
          {roadmap.map((item) => (
            <div key={item.id} className="bk-road-row">
              <input value={item.title} placeholder="What is being done" onChange={(event) => updateRoadmap(item.id, { title: event.target.value })} />
              <input value={item.detail} placeholder="Details (shown to the client)" onChange={(event) => updateRoadmap(item.id, { detail: event.target.value })} />
              <input type="date" value={item.dueOn ?? ''} onChange={(event) => updateRoadmap(item.id, { dueOn: event.target.value || null })} />
              <select value={item.status} onChange={(event) => updateRoadmap(item.id, { status: event.target.value as RoadmapItem['status'] })}>
                {Object.entries(R_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button type="button" className="bk-iconbtn" aria-label="Remove" onClick={() => setRoadmap((list) => list.filter((entry) => entry.id !== item.id))}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="bk-row-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setRoadmap((list) => [...list, { id: newId(), title: '', detail: '', dueOn: null, status: 'planned' }])}><Plus size={15} aria-hidden="true" /> Add timeline item</button>
          <button type="button" className="btn btn-primary" disabled={saving || roadmap.some((item) => !item.title.trim())} onClick={() => void patch({ roadmap }, 'Timeline saved.')}><Check size={15} aria-hidden="true" /> Save timeline</button>
        </div>
      </section>

      <section className="card section-card">
        <h3><FileText size={17} aria-hidden="true" /> Project brief</h3>
        <textarea className="bk-textarea" rows={6} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="What is being built, scope in short, anything the team and the client should keep in mind." />
        <div className="bk-row-actions">
          <button type="button" className="btn btn-primary" disabled={saving || brief === data.brief} onClick={() => void patch({ brief }, 'Brief saved.')}><Check size={15} aria-hidden="true" /> Save brief</button>
          {data.agreement ? (
            <>
              <Link to={`/agreements/${data.agreement.id}`} className="btn btn-secondary"><FileSignature size={15} aria-hidden="true" /> Agreement</Link>
              {data.agreement.hasFile ? <a className="btn btn-secondary" href={`/api/agreements/${data.agreement.id}/file`} target="_blank" rel="noreferrer">View agreement PDF</a> : null}
            </>
          ) : null}
        </div>
      </section>

      <SharePanel kind="project" targetId={data.id} />
    </div>
  );
}
