import { Hash, Hourglass, ListOrdered } from 'lucide-react';
import type { DocType } from '../../../server/services/invoicing/calc';
import type { NumberingState } from '../../../server/services/invoicing/numbering';

const serialOf = (docNo: string) => Number(docNo.split('/').pop());
const prefixOf = (docNo: string) => docNo.slice(0, docNo.lastIndexOf('/') + 1);
const rupees = (minor: number) => `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Explains, before anything is saved, which number this document will get and when.
export function NumberingPanel({
  docType,
  numbering,
  loaded,
  selfId,
}: {
  docType: DocType;
  numbering: NumberingState | null;
  selfId?: string;
  loaded: { docNo: string; series: string; status: string; cancelled: boolean } | null;
}) {
  if (loaded?.cancelled) {
    return (
      <section className="gst-numbering gst-numbering-off">
        <h3><Hash size={15} aria-hidden="true" /> Number</h3>
        <p>This one is cancelled and no longer counts. {loaded.series === 'REF' ? 'It never used a tax number, so there is no gap.' : 'Its number stays on record.'}</p>
      </section>
    );
  }
  if (loaded && loaded.series !== 'REF') {
    return (
      <section className="gst-numbering">
        <h3><Hash size={15} aria-hidden="true" /> Number</h3>
        <p>
          <b>{loaded.docNo}</b> is final. It is locked to this {docType === 'advance' ? 'advance receipt' : 'invoice'}.
        </p>
      </section>
    );
  }
  if (!numbering) return null;

  if (docType !== 'advance') {
    return (
      <section className="gst-numbering">
        <h3><Hash size={15} aria-hidden="true" /> Number</h3>
        <p>
          Saving a draft uses <b>no number</b>. When you press <b>Mark as issued</b> it gets <b>{numbering.nextInvoice}</b>.
        </p>
        <p className="gst-numbering-sub">A draft you throw away never leaves a gap in your numbers.</p>
      </section>
    );
  }

  const next = serialOf(numbering.nextAdvance);
  const prefix = prefixOf(numbering.nextAdvance);
  const others = numbering.waiting.filter((request) => request.id !== selfId);
  return (
    <section className="gst-numbering">
      <h3><Hash size={15} aria-hidden="true" /> Number: given when the money arrives</h3>
      <p>
        This is a <b>payment request</b>. It has only a reference. It gets its tax number (<b>{numbering.nextAdvance}</b> if it were paid now)
        the moment the <b>full advance is recorded</b>, so numbers follow the order clients really pay.
      </p>
      <div className="gst-sim">
        <p className="gst-sim-title"><ListOrdered size={14} aria-hidden="true" /> Simulation</p>
        <ol>
          <li>
            <span>1st advance paid</span>
            <b>{prefix}{next}</b>
          </li>
          <li>
            <span>2nd advance paid</span>
            <b>{prefix}{next + 1}</b>
          </li>
          <li>
            <span>A request nobody pays</span>
            <b>cancelled, uses no number</b>
          </li>
        </ol>
      </div>
      {others.length > 0 ? (
        <div className="gst-waiting">
          <p className="gst-sim-title"><Hourglass size={14} aria-hidden="true" /> Other requests waiting for money</p>
          <ul>
            {others.map((request) => (
              <li key={request.id}>
                <span>{request.client}</span>
                <span className="gst-numbering-sub">{request.ref} · {rupees(request.grossMinor)}{request.sent ? '' : ' · draft'}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
