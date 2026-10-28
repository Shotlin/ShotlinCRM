'use client';

import {
  AlertTriangle,
  ArrowRightLeft,
  BadgeIndianRupee,
  Banknote,
  Building2,
  CalendarRange,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Hourglass,
  Landmark,
  LoaderCircle,
  MapPin,
  PiggyBank,
  ReceiptText,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import type { Bucket, GstReport, QuarterReport } from '@/server/services/gst/report';
import { day, inr } from './format';

type Payload = { report: GstReport; years: string[] };

const QUARTER_THEME: Record<string, string> = { Q1: 'indigo', Q2: 'teal', Q3: 'amber', Q4: 'rose' };
const STATE_LABEL = { past: 'Finished', current: 'Running now', upcoming: 'Not started' } as const;
const DOC_LABEL = { advance: 'Advance', final: 'Final', regular: 'Regular' } as const;

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function SplitBar({ left, right, leftLabel, rightLabel, leftTone, rightTone }: { left: Bucket; right: Bucket; leftLabel: string; rightLabel: string; leftTone: string; rightTone: string }) {
  const total = left.taxableMinor + right.taxableMinor;
  const l = share(left.taxableMinor, total);
  return (
    <div className="bk-split">
      <div className="bk-split-bar" role="img" aria-label={`${leftLabel} ${l}%, ${rightLabel} ${total ? 100 - l : 0}%`}>
        {total > 0 ? (
          <>
            <span className={`bk-fill bk-bg-${leftTone}`} style={{ width: `${l}%` }} />
            <span className={`bk-fill bk-bg-${rightTone}`} style={{ width: `${100 - l}%` }} />
          </>
        ) : null}
      </div>
      <div className="bk-split-legend">
        <span><i className={`bk-dot bk-bg-${leftTone}`} />{leftLabel}: <b>{inr(left.taxableMinor)}</b> · {left.count} bill{left.count === 1 ? '' : 's'} · GST {inr(left.taxMinor)}</span>
        <span><i className={`bk-dot bk-bg-${rightTone}`} />{rightLabel}: <b>{inr(right.taxableMinor)}</b> · {right.count} bill{right.count === 1 ? '' : 's'} · GST {inr(right.taxMinor)}</span>
      </div>
    </div>
  );
}

function QuarterDetail({ q, report }: { q: QuarterReport; report: GstReport }) {
  const gstSplit = [q.total.igstMinor > 0 ? `IGST ${inr(q.total.igstMinor)}` : '', q.total.cgstMinor > 0 ? `CGST ${inr(q.total.cgstMinor)}` : '', q.total.sgstMinor > 0 ? `SGST ${inr(q.total.sgstMinor)}` : ''].filter(Boolean).join(' · ');
  const stillOpen = report.openAdvances.filter((a) => a.quarter <= q.id);
  const excluded = report.excluded;

  return (
    <div className="bk-detail">
      <section className="metric-grid">
        <MetricCard icon={BadgeIndianRupee} label="Taxable sales" value={inr(q.total.taxableMinor)} detail={`${q.total.count} document${q.total.count === 1 ? '' : 's'} counted`} />
        <MetricCard icon={Landmark} label="GST collected (output)" value={inr(q.total.taxMinor)} detail={gstSplit || 'No tax this quarter'} />
        <MetricCard icon={PiggyBank} label="Input credit (from expenses)" value={inr(q.itcMinor)} detail={q.creditBroughtMinor > 0 ? `Plus ${inr(q.creditBroughtMinor)} carried from before` : q.creditLeftMinor > 0 ? `${inr(q.creditLeftMinor)} left over, carries on` : 'GST on bills marked eligible'} />
        <MetricCard icon={Banknote} label="GST to pay" value={inr(q.netPayableMinor)} detail={q.state === 'past' ? 'Finished quarter' : 'So far this quarter'} />
      </section>

      <section className="card section-card">
        <h3><CalendarRange size={17} aria-hidden="true" /> Month by month</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Month</th><th className="numeric">Taxable</th><th className="numeric">B2B</th><th className="numeric">B2C</th><th className="numeric">Advances</th><th className="numeric">GST</th></tr>
            </thead>
            <tbody>
              {q.months.map((m) => (
                <tr key={m.key}>
                  <td><b>{m.label}</b></td>
                  <td className="numeric">{inr(m.total.taxableMinor)}</td>
                  <td className="numeric">{inr(m.b2b.taxableMinor)}</td>
                  <td className="numeric">{inr(m.b2c.taxableMinor)}</td>
                  <td className="numeric">{inr(m.advances.taxableMinor)}</td>
                  <td className="numeric"><b>{inr(m.total.taxMinor)}</b></td>
                </tr>
              ))}
              <tr className="bk-total-row">
                <td>Quarter total</td>
                <td className="numeric">{inr(q.total.taxableMinor)}</td>
                <td className="numeric">{inr(q.b2b.taxableMinor)}</td>
                <td className="numeric">{inr(q.b2c.taxableMinor)}</td>
                <td className="numeric">{inr(q.advances.taxableMinor)}</td>
                <td className="numeric">{inr(q.total.taxMinor)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="bk-two">
        <section className="card section-card">
          <h3><Building2 size={17} aria-hidden="true" /> B2B and B2C</h3>
          <SplitBar left={q.b2b} right={q.b2c} leftLabel="B2B (has GSTIN)" rightLabel="B2C (no GSTIN)" leftTone="blue" rightTone="violet" />
          <p className="bk-note">B2B means the customer gave a GST number. A business without a GST number counts as B2C.</p>
        </section>
        <section className="card section-card">
          <h3><ReceiptText size={17} aria-hidden="true" /> Advances and final bills</h3>
          <SplitBar left={q.advances} right={q.finals} leftLabel="Advance payments" rightLabel="Final / regular invoices" leftTone="amber" rightTone="green" />
          <p className="bk-note">GST on an advance is counted when the advance is received. The final invoice then taxes only the balance.</p>
        </section>
      </div>

      <section className="card section-card">
        <h3><ArrowRightLeft size={17} aria-hidden="true" /> Advances adjusted this quarter</h3>
        {q.adjustments.length === 0 ? (
          <p className="bk-empty">No final invoice in this quarter adjusted an earlier advance.</p>
        ) : (
          <ul className="bk-list">
            {q.adjustments.map((a) => (
              <li key={a.docNo} className="bk-adjust">
                <span className="bk-adjust-icon"><CheckCircle2 size={18} aria-hidden="true" /></span>
                <div>
                  <p><b>{a.docNo}</b> · {a.client} · {day(a.countedOn)}</p>
                  <p className="bk-sub">
                    Adjusted advance <b>{a.advanceDocNo ?? 'not linked'}</b> of {inr(a.advanceTaxableMinor)} taxable.
                    GST of <b>{inr(a.gstAlreadyPaidMinor)}</b> was already counted{a.advanceQuarter ? ` in ${a.advanceQuarter}` : ' earlier'}, so it is not taxed again.
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {stillOpen.length > 0 ? (
          <>
            <h4 className="bk-subhead"><Hourglass size={15} aria-hidden="true" /> Advances received but not adjusted yet</h4>
            <ul className="bk-list">
              {stillOpen.map((a) => (
                <li key={a.docNo} className="bk-adjust bk-adjust-open">
                  <span className="bk-adjust-icon"><Clock3 size={18} aria-hidden="true" /></span>
                  <div>
                    <p><b>{a.docNo}</b> · {a.client} · received {day(a.countedOn)} ({a.quarter})</p>
                    <p className="bk-sub">{a.project}. {inr(a.taxableMinor)} taxable, GST {inr(a.gstMinor)}. Adjust it in the final invoice.</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="card section-card">
        <h3><MapPin size={17} aria-hidden="true" /> By state (place of supply)</h3>
        {q.states.length === 0 ? (
          <p className="bk-empty">Nothing counted in this quarter yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>State</th><th className="numeric">B2B taxable</th><th className="numeric">B2C taxable</th><th className="numeric">Total taxable</th><th className="numeric">GST</th></tr></thead>
              <tbody>
                {q.states.map((s) => (
                  <tr key={s.stateCode}>
                    <td><span className="bk-chip bk-tone-indigo">{s.stateCode}</span> <b>{s.stateName}</b></td>
                    <td className="numeric">{inr(s.b2b.taxableMinor)}</td>
                    <td className="numeric">{inr(s.b2c.taxableMinor)}</td>
                    <td className="numeric">{inr(s.total.taxableMinor)}</td>
                    <td className="numeric"><b>{inr(s.total.taxMinor)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card section-card">
        <h3><FileCheck2 size={17} aria-hidden="true" /> Documents counted in this quarter</h3>
        {q.docs.length === 0 ? (
          <p className="bk-empty">No documents counted yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Document</th><th>Counted on</th><th>Client</th><th>Type</th><th>State</th><th className="numeric">Taxable</th><th className="numeric">GST</th><th className="numeric">Total</th></tr></thead>
              <tbody>
                {q.docs.map((d) => (
                  <tr key={d.docNo}>
                    <td><b>{d.docNo}</b></td>
                    <td>{day(d.countedOn)}</td>
                    <td>{d.client} <span className={`bk-chip ${d.kind === 'B2B' ? 'bk-tone-blue' : 'bk-tone-violet'}`}>{d.kind}</span></td>
                    <td><span className={`bk-chip ${d.docType === 'advance' ? 'bk-tone-amber' : 'bk-tone-green'}`}>{DOC_LABEL[d.docType]}</span></td>
                    <td>{d.stateName}</td>
                    <td className="numeric">{inr(d.taxableMinor)}</td>
                    <td className="numeric">{inr(d.taxMinor)}</td>
                    <td className="numeric">{inr(d.grossMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {excluded.length > 0 ? (
        <section className="card section-card bk-tint-warn">
          <h3><AlertTriangle size={17} aria-hidden="true" /> Not counted yet</h3>
          <p className="bk-note">These are left out of every total above until they are issued or the advance is received.</p>
          <ul className="bk-list">
            {excluded.map((e) => (
              <li key={e.docNo} className="bk-adjust bk-adjust-open">
                <span className="bk-adjust-icon"><Clock3 size={18} aria-hidden="true" /></span>
                <div>
                  <p><b>{e.docNo}</b> · {e.client} · <span className="bk-chip bk-tone-red">{e.reason}</span></p>
                  <p className="bk-sub">{inr(e.taxableMinor)} taxable, GST {inr(e.taxMinor)} will be added once it counts.</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function GstReportPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [fy, setFy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setError('');
    fetch(`/api/gst/report${fy ? `?fy=${fy}` : ''}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('The GST report could not be built.');
        return (await response.json()) as Payload;
      })
      .then((payload) => alive && setData(payload))
      .catch((problem: Error) => alive && setError(problem.message));
    return () => {
      alive = false;
    };
  }, [fy]);

  const report = data?.report;
  const active = report ? (report.quarters.find((q) => q.id === picked) ?? report.quarters.find((q) => q.state === 'current') ?? report.quarters.find((q) => q.total.count > 0) ?? report.quarters[0]) : null;

  return (
    <div className="page">
      <PageHeader
        eyebrow="11 / GST returns"
        title="GST returns"
        description="Every quarter and month: what you sold, how much GST you collected, what is left to pay."
        actions={
          data && data.years.length > 1 ? (
            <label className="bk-select">
              Year
              <select value={report?.fy ?? ''} onChange={(event) => { setFy(event.target.value); setPicked(null); }}>
                {data.years.map((y) => <option key={y} value={y}>FY {y}</option>)}
              </select>
            </label>
          ) : undefined
        }
      />
      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      {!report || !active ? (
        !error ? <p className="bk-loading"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Building your GST report…</p> : null
      ) : (
        <>
          <section className="metric-grid">
            <MetricCard icon={Banknote} label={`GST to pay, FY ${report.fy}`} value={inr(report.netPayableMinor)} detail="After input credit" />
            <MetricCard icon={BadgeIndianRupee} label="Taxable sales this year" value={inr(report.year.taxableMinor)} detail={`${report.year.count} documents counted`} />
            <MetricCard icon={Landmark} label="GST collected this year" value={inr(report.year.taxMinor)} detail="Output tax on counted documents" />
            <MetricCard icon={PiggyBank} label="Input credit this year" value={inr(report.itcMinor)} detail="Unused credit carries forward" />
          </section>

          <div className="bk-quarters" role="tablist" aria-label="Quarters">
            {report.quarters.map((q) => (
              <button
                key={q.id}
                role="tab"
                aria-selected={q.id === active.id}
                className={`bk-quarter bk-tone-${QUARTER_THEME[q.id]}${q.id === active.id ? ' on' : ''}`}
                onClick={() => setPicked(q.id)}
                type="button"
              >
                <span className="bk-quarter-top">
                  <b>{q.id}</b>
                  <span className={`bk-state bk-state-${q.state}`}>{STATE_LABEL[q.state]}</span>
                </span>
                <span className="bk-quarter-range">{q.range}</span>
                <span className="bk-quarter-pay">{inr(q.netPayableMinor)}</span>
                <span className="bk-quarter-sub">GST to pay · {q.total.count} doc{q.total.count === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>

          <QuarterDetail q={active} report={report} />
          <p className="bk-foot">
            This is a planning view built from your invoices and expenses. Check the figures with your accountant before you file or pay.
          </p>
        </>
      )}
    </div>
  );
}
