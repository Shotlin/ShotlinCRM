'use client';

import {
  AlertOctagon,
  BellRing,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Landmark,
  LoaderCircle,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '@/components/layout/PageHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import { EXPENSE_CATEGORIES, PAYEE_TYPES, categoryOf } from '@/server/services/expenses/categories';
import type { ExpenseRow, ExpenseSummary } from '@/server/services/expenses/summary';
import { day, inr, monthName } from '../gst/format';

type Entry = Omit<ExpenseRow, 'spentAt'> & { spentAt: string };
type Payload = { summary: Omit<ExpenseSummary, 'unplanned' | 'dueThisMonth'> & { dueThisMonth: { title: string; category: string; payeeName: string; payeeType: string; lastAmountMinor: number; lastSpentAt: string }[] }; currentMonth: string; entries: Entry[] };

type Form = {
  id: string | null;
  spentOn: string;
  title: string;
  category: string;
  payeeName: string;
  payeeType: string;
  amount: string;
  gst: string;
  itcEligible: boolean;
  planned: boolean;
  recurring: boolean;
  method: string;
  note: string;
};

const todayIso = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const blank = (): Form => ({ id: null, spentOn: todayIso(), title: '', category: 'software', payeeName: '', payeeType: 'vendor', amount: '', gst: '', itcEligible: false, planned: true, recurring: false, method: '', note: '' });
const shift = (key: string, by: number) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const shortMonth = (key: string) => new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${key}-01T00:00:00Z`));

export function ExpensesPage() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async (target: string | null) => {
    setError('');
    try {
      const response = await fetch(`/api/expenses${target ? `?month=${target}` : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Expenses could not be loaded.');
      const payload = (await response.json()) as Payload;
      setData(payload);
      setMonth((current) => current ?? payload.summary.month);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Expenses could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  const summary = data?.summary;
  const delta = summary ? summary.totalMinor - summary.previousTotalMinor : 0;
  const chart = useMemo(
    () => summary?.series.map((s) => ({ name: shortMonth(s.month), Planned: s.plannedMinor / 100, Unplanned: s.unplannedMinor / 100 })) ?? [],
    [summary],
  );
  const biggest = summary?.byCategory[0]?.totalMinor ?? 0;
  const biggestPayee = summary?.byPayee[0]?.totalMinor ?? 0;

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setFormError('');
    const body = {
      spentOn: form.spentOn,
      title: form.title,
      category: form.category,
      payeeName: form.payeeName,
      payeeType: form.payeeType,
      amountRupees: Number(form.amount),
      gstRupees: Number(form.gst || 0),
      itcEligible: form.itcEligible,
      planned: form.planned,
      recurring: form.recurring,
      method: form.method,
      note: form.note,
    };
    try {
      const response = await fetch(form.id ? `/api/expenses/${form.id}` : '/api/expenses', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Could not save.');
      setForm(null);
      setMonth(form.spentOn.slice(0, 7));
      await load(form.spentOn.slice(0, 7));
    } catch (problem) {
      setFormError(problem instanceof Error ? problem.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: Entry) => {
    if (!window.confirm(`Delete "${entry.title}" (${inr(entry.amountMinor)})? This cannot be undone.`)) return;
    const response = await fetch(`/api/expenses/${entry.id}`, { method: 'DELETE' });
    if (response.ok) await load(month);
    else setError('Could not delete that entry.');
  };

  const edit = (entry: Entry) =>
    setForm({
      id: entry.id,
      spentOn: new Date(new Date(entry.spentAt).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10),
      title: entry.title,
      category: entry.category,
      payeeName: entry.payeeName,
      payeeType: entry.payeeType,
      amount: String(entry.amountMinor / 100),
      gst: entry.gstMinor ? String(entry.gstMinor / 100) : '',
      itcEligible: entry.itcEligible,
      planned: entry.planned,
      recurring: entry.recurring,
      method: entry.method,
      note: entry.note,
    });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  return (
    <div className="page">
      <PageHeader
        eyebrow="12 / Expenses"
        title="Expenses"
        description="Bills, subscriptions, salaries, ads, loans and surprise purchases. Who you paid, how much, and when."
        actions={
          <button className="btn btn-primary" type="button" onClick={() => { setFormError(''); setForm(blank()); }}>
            <Plus size={16} aria-hidden="true" /> Add expense
          </button>
        }
      />
      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      {!summary || !data || !month ? (
        !error ? <p className="bk-loading"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Loading expenses…</p> : null
      ) : (
        <>
          <div className="bk-toolbar">
            <div className="bk-monthpick">
              <button type="button" className="bk-iconbtn" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}><ChevronLeft size={16} /></button>
              <span>{monthName(month)}</span>
              <button type="button" className="bk-iconbtn" aria-label="Next month" onClick={() => setMonth(shift(month, 1))} disabled={month >= data.currentMonth}><ChevronRight size={16} /></button>
            </div>
          </div>

          <section className="metric-grid">
            <MetricCard
              icon={Wallet}
              label="Spent this month"
              value={inr(summary.totalMinor)}
              detail={`${summary.count} entr${summary.count === 1 ? 'y' : 'ies'}`}
              trend={delta === 0 ? undefined : { value: `${inr(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'}`, direction: delta > 0 ? 'up' : 'down', good: delta <= 0 }}
            />
            <MetricCard icon={Check} label="Planned" value={inr(summary.plannedMinor)} detail="Normal monthly spending" />
            <MetricCard icon={AlertOctagon} label="Unplanned" value={inr(summary.unplannedMinor)} detail="Surprise and emergency spending" />
            <MetricCard icon={Landmark} label="GST paid on bills" value={inr(summary.gstMinor)} detail="Eligible GST lowers your GST payable" />
          </section>

          {summary.dueThisMonth.length > 0 ? (
            <section className="card section-card bk-tint-warn">
              <h3><BellRing size={17} aria-hidden="true" /> Repeating bills not entered this month</h3>
              <ul className="bk-list">
                {summary.dueThisMonth.map((d) => (
                  <li key={`${d.title}-${d.payeeName}`} className="bk-adjust bk-adjust-open">
                    <span className="bk-adjust-icon"><CalendarClock size={18} aria-hidden="true" /></span>
                    <div className="bk-grow">
                      <p><b>{d.title}</b> · {d.payeeName}</p>
                      <p className="bk-sub">Last paid {inr(d.lastAmountMinor)} on {day(d.lastSpentAt.slice(0, 10))}</p>
                    </div>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => setForm({ ...blank(), title: d.title, category: d.category, payeeName: d.payeeName, payeeType: d.payeeType, amount: String(d.lastAmountMinor / 100), recurring: true })}
                    >
                      Add for this month
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card section-card">
            <h3><CalendarClock size={17} aria-hidden="true" /> Last 12 months</h3>
            <div className="bk-chart" aria-label="Monthly spending, planned and unplanned">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e6e1" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={52} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip formatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
                  <Bar dataKey="Planned" stackId="a" fill="#151613" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Unplanned" stackId="a" fill="#aa514a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="bk-legend"><i className="bk-dot" style={{ background: '#151613' }} /> Planned <i className="bk-dot" style={{ background: '#aa514a' }} /> Unplanned</p>
          </section>

          <div className="bk-two">
            <section className="card section-card">
              <h3><Wallet size={17} aria-hidden="true" /> Where the money went</h3>
              {summary.byCategory.length === 0 ? <p className="bk-empty">No expenses in {monthName(month)}.</p> : (
                <ul className="bk-bars">
                  {summary.byCategory.map((c) => (
                    <li key={c.id}>
                      <div className="bk-bars-top"><span><i className="bk-dot" style={{ background: c.color }} />{c.label}</span><b>{inr(c.totalMinor)}</b></div>
                      <div className="bk-bar"><span style={{ width: `${Math.max(3, Math.round((c.totalMinor / biggest) * 100))}%`, background: c.color }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card section-card">
              <h3><UserRound size={17} aria-hidden="true" /> Who you paid</h3>
              {summary.byPayee.length === 0 ? <p className="bk-empty">Nobody paid yet this month.</p> : (
                <ul className="bk-bars">
                  {summary.byPayee.map((p) => (
                    <li key={p.name}>
                      <div className="bk-bars-top"><span>{p.name} <small className="bk-sub">{PAYEE_TYPES.find((t) => t.id === p.type)?.label ?? ''}</small></span><b>{inr(p.totalMinor)}</b></div>
                      <div className="bk-bar"><span style={{ width: `${Math.max(3, Math.round((p.totalMinor / biggestPayee) * 100))}%`, background: '#526f93' }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card section-card">
            <h3><Wallet size={17} aria-hidden="true" /> Every entry in {monthName(month)}</h3>
            {data.entries.length === 0 ? <p className="bk-empty">Nothing yet. Use “Add expense” for your first one.</p> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Date</th><th>What</th><th>Paid to</th><th>Category</th><th className="numeric">Amount</th><th className="numeric">GST</th><th /></tr></thead>
                  <tbody>
                    {data.entries.map((e) => {
                      const c = categoryOf(e.category);
                      return (
                        <tr key={e.id}>
                          <td>{day(new Date(new Date(e.spentAt).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10))}</td>
                          <td>
                            <b>{e.title}</b>{' '}
                            {!e.planned ? <span className="bk-chip bk-tone-red">Unplanned</span> : null}{' '}
                            {e.recurring ? <span className="bk-chip bk-tone-violet"><Repeat size={11} aria-hidden="true" /> Monthly</span> : null}
                            {e.note ? <span className="bk-sub bk-block">{e.note}</span> : null}
                          </td>
                          <td>{e.payeeName}</td>
                          <td><span className="bk-chip" style={{ background: `${c.color}1a`, color: c.color }}>{c.label}</span></td>
                          <td className="numeric"><b>{inr(e.amountMinor)}</b></td>
                          <td className="numeric">{e.gstMinor ? <>{inr(e.gstMinor)}{e.itcEligible ? ' ✓' : ''}</> : '–'}</td>
                          <td className="numeric bk-actions">
                            <button type="button" aria-label={`Edit ${e.title}`} onClick={() => edit(e)}><Pencil size={15} /></button>
                            <button type="button" aria-label={`Delete ${e.title}`} onClick={() => void remove(e)}><Trash2 size={15} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {form ? (
        <div className="bk-modal" role="dialog" aria-modal="true" aria-label={form.id ? 'Edit expense' : 'Add expense'}>
          <div className="bk-modal-card">
            <div className="bk-modal-head">
              <h2>{form.id ? 'Edit expense' : 'Add expense'}</h2>
              <button type="button" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
            </div>
            <div className="bk-form">
              <label>Date<input type="date" value={form.spentOn} onChange={(e) => set('spentOn', e.target.value)} /></label>
              <label>What was it for?<input value={form.title} placeholder="e.g. ChatGPT Plus, Meta ads, electricity bill" onChange={(e) => set('title', e.target.value)} /></label>
              <label>Category
                <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label>Paid to
                <input list="expense-payees" value={form.payeeName} placeholder="Person, bank, Meta, OpenAI…" onChange={(e) => {
                  const known = data?.summary.payees.find((p) => p.name.toLowerCase() === e.target.value.trim().toLowerCase());
                  setForm((f) => (f ? { ...f, payeeName: e.target.value, payeeType: known?.type ?? f.payeeType } : f));
                }} />
                <datalist id="expense-payees">{data?.summary.payees.map((p) => <option key={p.name} value={p.name} />)}</datalist>
              </label>
              <label>Who is it?
                <select value={form.payeeType} onChange={(e) => set('payeeType', e.target.value)}>
                  {PAYEE_TYPES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <label>Amount paid (₹)<input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} /></label>
              <label>GST inside it (₹, optional)<input inputMode="decimal" value={form.gst} onChange={(e) => set('gst', e.target.value)} /></label>
              <label>Paid by<input value={form.method} placeholder="UPI, card, bank transfer, cash" onChange={(e) => set('method', e.target.value)} /></label>
              <label className="bk-wide">Note<input value={form.note} onChange={(e) => set('note', e.target.value)} /></label>
              <div className="bk-checks bk-wide">
                <label><input type="checkbox" checked={!form.planned} onChange={(e) => set('planned', !e.target.checked)} /> Unplanned or emergency</label>
                <label><input type="checkbox" checked={form.recurring} onChange={(e) => set('recurring', e.target.checked)} /> Repeats every month</label>
                <label><input type="checkbox" checked={form.itcEligible} disabled={!Number(form.gst)} onChange={(e) => set('itcEligible', e.target.checked)} /> GST is eligible as input credit</label>
              </div>
            </div>
            {formError ? <p className="bk-error" role="alert">{formError}</p> : null}
            <div className="bk-modal-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn btn-primary" type="button" disabled={saving} onClick={() => void save()}>
                {saving ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : null} Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
