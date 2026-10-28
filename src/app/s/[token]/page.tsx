import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { rateLimit } from '@/server/http/rate-limit';
import { loadPublicInvoice, loadPublicProject, resolveShare } from '@/server/services/share/store';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Project update', robots: { index: false, follow: false, nocache: true } };

const inr = (minor: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(minor / 100)}`;
const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const PROJECT_STATUS: Record<string, string> = { active: 'In progress', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' };
const STEP: Record<string, string> = { planned: 'Upcoming', in_progress: 'Ongoing', done: 'Done' };
const MILESTONE: Record<string, string> = { planned: 'Planned', in_progress: 'In progress', delivered: 'Delivered, awaiting your approval', accepted: 'Accepted' };

function Unavailable({ message }: { message: string }) {
  return (
    <main className="sh-page">
      <section className="sh-card sh-center">
        <p className="sh-brand">SHOTLIN</p>
        <h1>{message}</h1>
        <p>Please ask Shotlin for a new link.</p>
      </section>
    </main>
  );
}

export default async function SharedProject({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await rateLimit(`share-page:${ip}`, 60, 60))) return <Unavailable message="Too many requests. Try again in a minute." />;
  const link = await resolveShare(token, true);
  if (link && link.kind === 'invoice') {
    const invoice = await loadPublicInvoice(link.workspaceId, link.targetId);
    if (!invoice) return <Unavailable message="This link is no longer available." />;
    return (
      <main className="sh-page">
        <header className="sh-hero">
          <p className="sh-brand">SHOTLIN <span>Digital Product Studio</span></p>
          <h1>{invoice.heading.title}</h1>
          <p>{invoice.heading.numberLabel}: {invoice.docNo} · {day(invoice.issuedOn)}</p>
          <div className="sh-pills">
            <span className="sh-pill">{invoice.paymentStatus}</span>
            <span className="sh-pill">For {invoice.customer}</span>
          </div>
        </header>
        <section className="sh-card">
          <h2>{invoice.project}</h2>
          <ul className="sh-ms">
            {invoice.lines.map((line) => (
              <li key={line.description}>
                <div><p><b>{line.description}</b></p></div>
                <div className="sh-right"><p className="sh-amount">{inr(line.amountMinor)}</p></div>
              </li>
            ))}
          </ul>
          <dl className="sh-totals">
            <div><dt>Taxable value</dt><dd>{inr(invoice.taxableMinor)}</dd></div>
            <div><dt>{invoice.taxLabel}</dt><dd>{inr(invoice.taxMinor)}</dd></div>
            {invoice.roundOffMinor !== 0 ? <div><dt>Round off</dt><dd>{inr(invoice.roundOffMinor)}</dd></div> : null}
            <div className="sh-grand"><dt>Total</dt><dd>{inr(invoice.grandMinor)}</dd></div>
            <div><dt>Received</dt><dd>{inr(invoice.receivedMinor)}</dd></div>
            <div><dt>Balance</dt><dd>{inr(invoice.balanceMinor)}</dd></div>
          </dl>
          <p><a className="sh-btn" href={`/s/${token}/invoice/${invoice.id}`} target="_blank" rel="noreferrer">Download the invoice (PDF)</a></p>
        </section>
        <footer className="sh-foot">This is a private page made for you by Shotlin. Please do not share the link. It stops working on {day(link.expiresAt.toISOString().slice(0, 10))}.</footer>
      </main>
    );
  }
  const project = link && link.kind === 'project' ? await loadPublicProject(link.workspaceId, link.targetId) : null;
  if (!link || !project) return <Unavailable message="This link is no longer available." />;

  const groups = [
    { key: 'in_progress', title: 'Ongoing' },
    { key: 'planned', title: 'Coming up' },
    { key: 'done', title: 'Done' },
  ] as const;
  const accepted = project.milestones.filter((m) => m.status === 'accepted').length;

  return (
    <main className="sh-page">
      <header className="sh-hero">
        <p className="sh-brand">SHOTLIN <span>Digital Product Studio</span></p>
        <h1>{project.title}</h1>
        <p>Prepared for {project.preparedFor}</p>
        <div className="sh-pills">
          <span className="sh-pill">{PROJECT_STATUS[project.status] ?? project.status}</span>
          {project.startsOn ? <span className="sh-pill">Kickoff {day(project.startsOn)}</span> : null}
          {project.dueOn ? <span className="sh-pill">Target {day(project.dueOn)}</span> : null}
          <span className="sh-pill">{accepted} of {project.milestones.length} milestones accepted</span>
        </div>
      </header>

      {project.brief ? (
        <section className="sh-card">
          <h2>About this project</h2>
          <p className="sh-pre">{project.brief}</p>
        </section>
      ) : null}

      {project.roadmap.length > 0 ? (
        <section className="sh-card">
          <h2>Timeline</h2>
          {groups.map((group) => {
            const items = project.roadmap.filter((item) => item.status === group.key);
            if (items.length === 0) return null;
            return (
              <div key={group.key} className="sh-group">
                <h3>{group.title}</h3>
                <ul>
                  {items.map((item) => (
                    <li key={`${item.title}-${item.dueOn}`} className={`sh-step sh-step-${item.status}`}>
                      <span className="sh-dot" aria-hidden="true" />
                      <div>
                        <p><b>{item.title}</b> <span className="sh-tag">{STEP[item.status]}</span></p>
                        {item.detail ? <p className="sh-sub">{item.detail}</p> : null}
                        {item.dueOn ? <p className="sh-sub">By {day(item.dueOn)}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="sh-card">
        <h2>Payment milestones and invoices</h2>
        <ul className="sh-ms">
          {project.milestones.map((m) => (
            <li key={m.title}>
              <div>
                <p><b>{m.title}</b>{m.additional ? <span className="sh-tag">Additional scope</span> : null}</p>
                {m.trigger ? <p className="sh-sub">{m.trigger}</p> : null}
                <p className="sh-sub">{MILESTONE[m.status]}{m.dueOn ? ` · due ${day(m.dueOn)}` : ''}</p>
              </div>
              <div className="sh-right">
                <p className="sh-amount">{inr(m.grossMinor)}</p>
                <p className="sh-sub">{inr(m.baseMinor)} + GST</p>
                {m.invoice ? (
                  <a className="sh-btn" href={`/s/${token}/invoice/${m.invoice.id}`} target="_blank" rel="noreferrer">
                    Invoice {m.invoice.number}
                  </a>
                ) : (
                  <span className="sh-sub">Invoice not raised yet</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        {project.agreement ? (
          <p><a className="sh-btn sh-btn-ghost" href={`/s/${token}/agreement`} target="_blank" rel="noreferrer">View the signed agreement (PDF)</a></p>
        ) : null}
      </section>

      <footer className="sh-foot">
        This is a private page made for you by Shotlin. Please do not share the link. It stops working on {day(link.expiresAt.toISOString().slice(0, 10))}.
      </footer>
    </main>
  );
}
