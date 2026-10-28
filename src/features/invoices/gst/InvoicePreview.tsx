import { buildInvoiceDocument } from '../../../server/services/invoicing/document';
import type { GstInvoice } from '../../../server/services/invoicing/calc';

// A paper-style copy of the invoice that redraws while you type. It is built by the same code that
// writes the PDF and Word files, so the wording and the numbers match what the customer will get.
export function InvoicePreview({ model, docNoLabel }: { model: GstInvoice; docNoLabel?: string }) {
  const doc = buildInvoiceDocument(model);
  const docNo = docNoLabel ?? doc.docNo;
  return (
    <div className="gst-paper" aria-label="Invoice preview">
      <header className="gst-paper-head">
        <div className="gst-paper-brand">
          <b>SHOTLIN</b>
          {doc.supplierLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="gst-paper-title">
          <h3>{doc.heading.title}</h3>
          {doc.heading.subtitle ? <p>{doc.heading.subtitle}</p> : null}
          <p className="gst-paper-no">
            {doc.heading.numberLabel}: <b>{docNo}</b>
          </p>
        </div>
      </header>

      <table className="gst-paper-meta">
        <thead>
          <tr>
            {doc.meta.labels.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {doc.meta.values.map((value, index) => (
              <td key={doc.meta.labels[index]}>{value || '-'}</td>
            ))}
          </tr>
        </tbody>
      </table>

      <div className="gst-paper-two">
        <div>
          <h4>BILLED TO</h4>
          {doc.billed.map((line) => (
            <p key={line.label}>
              <b>{line.label}</b> {line.value || '-'}
            </p>
          ))}
        </div>
        <div>
          <h4>PROJECT / SERVICE</h4>
          {doc.project.map((line) => (
            <p key={line.label}>
              <b>{line.label}</b> {line.value || '-'}
            </p>
          ))}
        </div>
      </div>

      <table className="gst-paper-items">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Taxable Value</th>
            <th>Tax Rate</th>
            <th>Tax Amount</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((item) => (
            <tr key={item.index}>
              <td>{item.index}</td>
              <td>
                <b>{item.description || '-'}</b>
                {item.detail ? <span>{item.detail}</span> : null}
              </td>
              <td>{item.qty}</td>
              <td>{item.taxable}</td>
              <td>{item.rate}</td>
              <td>{item.tax}</td>
              <td>{item.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="gst-paper-two gst-paper-lower">
        <div>
          {doc.leftNotes.map((note) => (
            <p key={note.label}>
              <b>{note.label}</b> {note.text || '-'}
            </p>
          ))}
        </div>
        <dl className="gst-paper-totals">
          {doc.totals.map((row) => (
            <div key={row.label} className={row.grand ? 'grand' : undefined}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {doc.terms.length ? (
        <div className="gst-paper-terms">
          <h4>NOTES &amp; TERMS</h4>
          <ol>
            {doc.terms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <footer className="gst-paper-foot">
        <span>{doc.footerLeft}</span>
        <span>{doc.footerRight.replace(doc.docNo, docNo)}</span>
      </footer>
    </div>
  );
}
