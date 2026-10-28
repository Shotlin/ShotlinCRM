'use client';

import { ArrowLeft, CalendarClock, Check, FilePlus2, FileSignature, FileText, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from '@/lib/router';
import { invoicePlan } from '@/server/services/deals/milestones';
import { day, inr } from '../gst/format';
import { PROJECT_STATUS } from './ProjectsPage';
import { SharePanel } from './SharePanel';

type RoadmapItem = { id: string; title: string; detail: string; dueOn: string | null; status: 'planned' | 'in_progress' | 'done' };
type Milestone = {
  id: string;
  index: number;
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

  if (!data) return <div className="bk-page">{error ? <p className="bk-error" role="alert">{error}</p> : <p className="bk-loading"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Loading…</p>}</div>;

  const parts = data.milestones.map((m) => m.baseMinor);
  const total = parts.reduce((a, b) => a + b, 0);
  const invoicedMinor = data.milestones.filter((m) => m.invoice && !m.invoice.cancelled).reduce((a, m) => a + m.baseMinor, 0);
  const ongoing = roadmap.filter((r) => r.status === 'in_progress');
  const upcoming = roadmap.filter((r) => r.status === 'planned');
  const done = roadmap.filter((r) => r.status === 'done');

  const invoiceLink = (m: Milestone) => {
    const plan = invoicePlan(parts, m.index);
    const before = data.milestones.slice(0, m.index).map((x) => x.invoice?.number).filter(Boolean).join(', ');
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

  const updateRoadmap = (id: string, change: Partial<RoadmapItem>) => setRoadmap((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));

  return (
    <div className="bk-page">
      <Link to="/projects" className="back-link"><ArrowLeft size={15} aria-hidden="true" /> Projects</Link>
      <section className="bk-hero bk-hero-project">
        <div>
          <p className="bk-hero-kicker">{data.client.company || data.client.name}</p>
          <p className="bk-hero-number bk-hero-title2">{data.title}</p>
          <p className="bk-hero-sub">
            {data.startsOn ? `Kickoff ${day(data.startsOn)} · ` : ''}Due {day(data.dueOn)} · {inr(invoicedMinor)} of {inr(total)} invoiced
          </p>
        </div>
        <label className="bk-year">Status
          <select value={data.status} onChange={(event) => void patch({ status: event.target.value }, 'Status updated.')}>
            {Object.entries(PROJECT_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
          </select>
        </label>
      </section>

      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      {note ? <p className="bk-ok">{note}</p> : null}

      <div className="bk-stats">
        <div className="bk-stat bk-tone-green"><span className="bk-stat-icon"><Check size={18} aria-hidden="true" /></span><div><p className="bk-stat-label">Done</p><p className="bk-stat-value">{done.length}</p></div></div>
        <div className="bk-stat bk-tone-amber"><span className="bk-stat-icon"><LoaderCircle size={18} aria-hidden="true" /></span><div><p className="bk-stat-label">Ongoing</p><p className="bk-stat-value">{ongoing.length}</p></div></div>
        <div className="bk-stat bk-tone-indigo"><span className="bk-stat-icon"><CalendarClock size={18} aria-hidden="true" /></span><div><p className="bk-stat-label">Upcoming</p><p className="bk-stat-value">{upcoming.length}</p></div></div>
      </div>

      <section className="bk-card">
        <h3><FileSignature size={17} aria-hidden="true" /> Payment milestones</h3>
        <ul className="bk-list">
          {data.milestones.map((m) => (
            <li key={m.id} className="bk-ms-card">
              <div className="bk-grow">
                <p><b>{m.title}</b> <span className={`bk-chip bk-tone-${m.status === 'accepted' ? 'green' : m.status === 'delivered' ? 'blue' : m.status === 'in_progress' ? 'amber' : 'violet'}`}>{M_STATUS[m.status]}</span></p>
                {m.trigger ? <p className="bk-sub">{m.trigger}</p> : null}
                <p className="bk-sub">{inr(m.baseMinor)} + GST = <b>{inr(m.grossMinor)}</b>{m.dueOn ? ` · due ${day(m.dueOn)}` : ''}</p>
              </div>
              <select value={m.status} onChange={(event) => void patchMilestone(m.id, { status: event.target.value })} aria-label={`Status of ${m.title}`}>
                {Object.entries(M_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {m.invoice && !m.invoice.cancelled ? (
                <Link to={`/invoices/gst/${m.invoice.id}`} className="btn btn-secondary"><FileText size={15} aria-hidden="true" /> {m.invoice.number} · {m.invoice.status.toLowerCase()}</Link>
              ) : (
                <Link to={invoiceLink(m)} className="btn btn-primary"><FilePlus2 size={15} aria-hidden="true" /> Create invoice</Link>
              )}
            </li>
          ))}
        </ul>
        <p className="bk-note">The first milestones become advance requests and the last one becomes the final invoice, which adjusts what was already billed. You can change the type in the invoice form.</p>
      </section>

      <section className="bk-card">
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

      <section className="bk-card">
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
