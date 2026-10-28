import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Ban, Check, CircleDollarSign, Download, FileText, Send } from 'lucide-react';
import { Link, useNavigate, useParams } from '../../../lib/router';
import {
  amountInWords,
  computeTotals,
  defaultGstTreatment,
  deriveSupplyType,
  formatMoney,
  type DocType,
  type GstInvoice,
} from '../../../server/services/invoicing/calc';
import { useCrmStore } from '../../../store/crmStore';
import { EmptyState } from '../../../components/ui/EmptyState';
import { useToast } from '../../../components/ui/Toast';
import { DEFAULT_JURISDICTION_TERM } from '../../../server/services/invoicing/supplier';
import type { NumberingState } from '../../../server/services/invoicing/numbering';
import { PaymentDialog } from '../PaymentDialog';
import { InvoicePreview } from './InvoicePreview';
import { NumberingPanel } from './NumberingPanel';
import { GST_STATES } from './states';

type LineForm = { id: string; description: string; detail: string; qty: string; unitPrice: string };

type Form = {
  docType: DocType;
  clientId: string;
  leadId: string;
  issuedAt: string;
  paymentTerms: string;
  stateCode: string;
  customerName: string;
  representative: string;
  address: string;
  cityStatePin: string;
  pan: string;
  gstin: string;
  projectName: string;
  category: string;
  reference: string;
  advanceRef: string;
  advanceNote: string;
  lines: LineForm[];
  taxRatePct: string;
  sac: string;
  projectTaxable: string;
  advanceTaxable: string;
  gstTreatment: string;
  adjustmentNote: string;
  terms: string;
};

type Loaded = {
  docNo: string;
  status: string;
  cancelled: boolean;
  receivedMinor: number;
  grandMinor: number;
  clientId: string;
  invoice: GstInvoiceJson;
  drive: {
    configured: boolean;
    state: 'pending' | 'synced' | 'failed' | null;
    pdfUrl: string | null;
    docxUrl: string | null;
    folderName: string | null;
    syncedAt: string | null;
    error: string | null;
  };
};

// Dates arrive as strings over JSON.
type GstInvoiceJson = Omit<GstInvoice, 'issuedAt'> & { issuedAt: string };

const IST = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: IST });
const newLine = (): LineForm => ({ id: `line-${Math.random().toString(36).slice(2)}`, description: '', detail: '', qty: '1', unitPrice: '' });

const toMinor = (value: string) => Math.round((Number(value.replace(/,/g, '')) || 0) * 100);
const toRupees = (minor: number) => (minor / 100).toFixed(2);

const EMPTY: Form = {
  docType: 'final',
  clientId: '',
  leadId: '',
  issuedAt: today(),
  paymentTerms: '',
  stateCode: '',
  customerName: '',
  representative: '',
  address: '',
  cityStatePin: '',
  pan: '',
  gstin: '',
  projectName: '',
  category: '',
  reference: '',
  advanceRef: '',
  advanceNote: '',
  lines: [newLine()],
  taxRatePct: '18',
  sac: '998314',
  projectTaxable: '',
  advanceTaxable: '',
  gstTreatment: '',
  adjustmentNote: '',
  terms: '',
};

const TYPE_LABELS: Record<DocType, string> = {
  final: 'Final / balance tax invoice (INV)',
  advance: 'Advance payment request (becomes the receipt voucher, ADV, when paid)',
  regular: 'Regular tax invoice (INV)',
};

function formFromInvoice(loaded: Loaded): Form {
  const { invoice } = loaded;
  return {
    docType: invoice.docType,
    clientId: loaded.clientId,
    leadId: '',
    issuedAt: new Date(invoice.issuedAt).toLocaleDateString('en-CA', { timeZone: IST }),
    paymentTerms: invoice.paymentTerms,
    stateCode: invoice.customer.stateCode,
    customerName: invoice.customer.name,
    representative: invoice.customer.representative ?? '',
    address: invoice.customer.address,
    cityStatePin: invoice.customer.cityStatePin,
    pan: invoice.customer.pan ?? '',
    gstin: invoice.customer.gstin ?? '',
    projectName: invoice.project.name,
    category: invoice.project.category ?? '',
    reference: invoice.project.reference ?? '',
    advanceRef: invoice.project.advanceRef ?? '',
    advanceNote: invoice.project.advanceNote ?? '',
    lines: invoice.lines.map((line) => ({
      id: `line-${Math.random().toString(36).slice(2)}`,
      description: line.description,
      detail: line.detail ?? '',
      qty: String(line.qty),
      unitPrice: toRupees(line.taxableMinor / line.qty),
    })),
    taxRatePct: String(invoice.taxRatePct),
    sac: invoice.sac,
    projectTaxable: invoice.projectTaxableMinor !== undefined ? toRupees(invoice.projectTaxableMinor) : '',
    advanceTaxable: invoice.advanceTaxableMinor !== undefined ? toRupees(invoice.advanceTaxableMinor) : '',
    gstTreatment: invoice.gstTreatment,
    adjustmentNote: invoice.adjustmentNote ?? '',
    terms: invoice.terms.join('\n'),
  };
}

function bodyFromForm(form: Form) {
  const optional = (value: string) => value.trim() || undefined;
  const hasProject = form.docType !== 'regular';
  return {
    clientId: form.clientId,
    leadId: optional(form.leadId),
    docType: form.docType,
    issuedAt: `${form.issuedAt}T12:00:00+05:30`,
    taxRatePct: Math.round(Number(form.taxRatePct) || 0),
    sac: form.sac.trim(),
    paymentTerms: optional(form.paymentTerms),
    customer: {
      name: form.customerName,
      representative: optional(form.representative),
      address: form.address,
      cityStatePin: form.cityStatePin,
      pan: optional(form.pan),
      gstin: optional(form.gstin),
      placeOfSupply: GST_STATES.find((state) => state.code === form.stateCode)?.name ?? '',
      stateCode: form.stateCode,
    },
    project: {
      name: form.projectName,
      category: optional(form.category),
      reference: optional(form.reference),
      advanceRef: form.docType === 'final' ? optional(form.advanceRef) : undefined,
      advanceNote: form.docType === 'advance' ? optional(form.advanceNote) : undefined,
    },
    lines: form.lines.map((line) => ({
      description: line.description,
      detail: optional(line.detail),
      qty: Math.max(1, Math.floor(Number(line.qty) || 1)),
      unitPriceMinor: toMinor(line.unitPrice),
    })),
    projectTaxableMinor: hasProject && form.projectTaxable.trim() ? toMinor(form.projectTaxable) : undefined,
    advanceTaxableMinor: hasProject && form.advanceTaxable.trim() ? toMinor(form.advanceTaxable) : undefined,
    gstTreatment: optional(form.gstTreatment),
    adjustmentNote: optional(form.adjustmentNote),
    terms: form.terms
      .split('\n')
      .map((term) => term.trim())
      .filter(Boolean),
  };
}

export function GstInvoiceEditorPage() {
  const params = useParams<{ invoiceId?: string }>();
  const invoiceId = params.invoiceId;
  const navigate = useNavigate();
  const { notify } = useToast();
  const clients = useCrmStore((state) => state.clients);
  const leads = useCrmStore((state) => state.leads);
  const chats = useCrmStore((state) => state.chats);
  const invoices = useCrmStore((state) => state.invoices);
  const refresh = useCrmStore((state) => state.refresh);

  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(Boolean(invoiceId));
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [numbering, setNumbering] = useState<NumberingState | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  const load = async (id: string) => {
    const response = await fetch(`/api/invoices/gst/${id}`, { cache: 'no-store' });
    if (!response.ok) {
      setMissing(true);
      return;
    }
    const payload = (await response.json()) as Loaded;
    setLoaded(payload);
    setForm(formFromInvoice(payload));
  };

  useEffect(() => {
    if (!invoiceId) return;
    setLoading(true);
    load(invoiceId)
      .catch(() => setMissing(true))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  // While the worker is sending the invoice to Drive, check back every few seconds.
  const driveWaiting = loaded?.drive.configured && (loaded.drive.state === 'pending' || loaded.drive.state === 'failed');
  useEffect(() => {
    if (!invoiceId || !driveWaiting) return;
    const timer = setInterval(() => void load(invoiceId).catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [invoiceId, driveWaiting]);


  // Which numbers come next, and which advance requests are waiting for money.
  useEffect(() => {
    let alive = true;
    fetch('/api/invoices/gst/numbering', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<NumberingState>) : null))
      .then((state) => alive && setNumbering(state))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [invoiceId, loaded?.docNo]);

  // "New invoice" on a client opens this page with the client already chosen. Nothing is saved until Create draft.
  useEffect(() => {
    if (invoiceId || prefilled || clients.length === 0) return;
    const query = new URLSearchParams(window.location.search);
    const clientId = query.get('clientId');
    const leadId = query.get('leadId');
    const type = query.get('type');
    const client = clients.find((item) => item.id === clientId);
    setPrefilled(true);
    setForm((current) => ({
      ...current,
      ...(type === 'advance' || type === 'final' || type === 'regular' ? { docType: type } : {}),
      ...(client ? { clientId: client.id, customerName: client.company || client.name, cityStatePin: client.city || '' } : {}),
      ...(leadId ? { leadId } : {}),
    }));
    // Start from the billing details used on this client's last invoice.
    if (client) {
      fetch(`/api/invoices/gst/last-billing?clientId=${encodeURIComponent(client.id)}`, { cache: 'no-store' })
        .then((response) => (response.ok ? (response.json() as Promise<{ customer: GstInvoice['customer'] | null }>) : null))
        .then((payload) => {
          const last = payload?.customer;
          if (!last) return;
          setForm((current) => ({
            ...current,
            customerName: last.name,
            representative: last.representative ?? '',
            address: last.address,
            cityStatePin: last.cityStatePin,
            pan: last.pan ?? '',
            gstin: last.gstin ?? '',
            stateCode: last.stateCode,
          }));
        })
        .catch(() => undefined);
    }
  }, [clients, invoiceId, prefilled]);

  const editable = !loaded || (loaded.status === 'draft' && !loaded.cancelled);
  const patch = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const updateLine = (id: string, change: Partial<LineForm>) =>
    setForm((current) => ({ ...current, lines: current.lines.map((line) => (line.id === id ? { ...line, ...change } : line)) }));

  const chooseClient = (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    setForm((current) => ({
      ...current,
      clientId,
      customerName: current.customerName || client?.company || client?.name || '',
      cityStatePin: current.cityStatePin || client?.city || '',
    }));
  };

  const chooseState = (stateCode: string) => patch('stateCode', stateCode);

  // The live summary uses the same maths as the server, so what you see is what is saved.
  const summary = useMemo(() => {
    const lines = form.lines.map((line) => {
      const qty = Math.max(1, Math.floor(Number(line.qty) || 1));
      return { description: line.description, qty, taxableMinor: qty * toMinor(line.unitPrice) };
    });
    const supplyType = deriveSupplyType(form.stateCode || '00');
    const placeOfSupply = GST_STATES.find((state) => state.code === form.stateCode)?.name ?? '';
    const rate = Math.round(Number(form.taxRatePct) || 0);
    const model: GstInvoice = {
      docType: form.docType,
      series: form.docType === 'advance' ? 'ADV' : 'INV',
      serial: 0,
      issuedAt: new Date(`${form.issuedAt}T12:00:00+05:30`),
      sac: form.sac,
      supplyType,
      taxRatePct: rate,
      paymentTerms: '',
      paymentStatus: '',
      customer: { name: '', address: '', cityStatePin: '', placeOfSupply, stateCode: form.stateCode },
      project: { name: '' },
      lines,
      projectTaxableMinor: form.docType !== 'regular' && form.projectTaxable.trim() ? toMinor(form.projectTaxable) : undefined,
      advanceTaxableMinor: form.docType !== 'regular' && form.advanceTaxable.trim() ? toMinor(form.advanceTaxable) : undefined,
      gstTreatment: '',
      terms: [],
    };
    const totals = computeTotals(model);
    const billable = totals.billableMinor;
    const project = model.projectTaxableMinor;
    const advance = model.advanceTaxableMinor ?? 0;
    const expected = form.docType === 'final' && project !== undefined ? project - advance : form.docType === 'advance' && model.advanceTaxableMinor !== undefined ? advance : undefined;
    const hints: string[] = [];
    if (!form.stateCode) hints.push('Choose the place of supply to decide CGST + SGST or IGST.');
    if (expected !== undefined && expected !== billable) {
      hints.push(`Line items add up to ${formatMoney(billable)} but should be ${formatMoney(expected)}.`);
    }
    return { totals, supplyType, billable, expected, hints, placeOfSupply, rate };
  }, [form]);

  const defaultTreatment = defaultGstTreatment(summary.supplyType, summary.placeOfSupply || 'the place of supply', summary.rate);


  // The same fields as the saved invoice, so the preview shows exactly what the PDF and Word file will say.
  const previewModel = useMemo<GstInvoice>(() => {
    const optional = (value: string) => value.trim() || undefined;
    const supplyType = deriveSupplyType(form.stateCode || '00');
    const place = GST_STATES.find((state) => state.code === form.stateCode)?.name ?? '';
    const rate = Math.round(Number(form.taxRatePct) || 0);
    const terms = form.terms.split('\n').map((term) => term.trim()).filter(Boolean);
    return {
      docType: form.docType,
      series: loaded?.invoice.series ?? 'REF',
      serial: loaded?.invoice.serial ?? 0,
      issuedAt: new Date(`${form.issuedAt || today()}T12:00:00+05:30`),
      sac: form.sac,
      supplyType,
      taxRatePct: rate,
      paymentTerms: form.paymentTerms.trim() || (form.docType === 'advance' ? 'Advance received / due before project kickoff' : 'Due before final delivery / handover'),
      paymentStatus: loaded?.invoice.paymentStatus ?? (form.docType === 'advance' ? 'PAYMENT PENDING' : 'PAYABLE / DUE'),
      customer: {
        name: form.customerName,
        representative: optional(form.representative),
        address: form.address,
        cityStatePin: form.cityStatePin,
        pan: optional(form.pan),
        gstin: optional(form.gstin),
        placeOfSupply: place,
        stateCode: form.stateCode,
      },
      project: {
        name: form.projectName,
        category: optional(form.category),
        reference: optional(form.reference),
        advanceRef: form.docType === 'final' ? optional(form.advanceRef) : undefined,
        advanceNote: form.docType === 'advance' ? optional(form.advanceNote) : undefined,
      },
      lines: form.lines.map((line) => {
        const qty = Math.max(1, Math.floor(Number(line.qty) || 1));
        return { description: line.description, detail: optional(line.detail), qty, taxableMinor: qty * toMinor(line.unitPrice) };
      }),
      projectTaxableMinor: form.docType !== 'regular' && form.projectTaxable.trim() ? toMinor(form.projectTaxable) : undefined,
      advanceTaxableMinor: form.docType !== 'regular' && form.advanceTaxable.trim() ? toMinor(form.advanceTaxable) : undefined,
      gstTreatment: form.gstTreatment.trim() || defaultGstTreatment(supplyType, place || 'the place of supply', rate),
      adjustmentNote: optional(form.adjustmentNote),
      terms: terms.length ? terms : [DEFAULT_JURISDICTION_TERM],
    };
  }, [form, loaded]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !editable) return;
    if (!form.clientId) {
      setErrors(['Choose a client first.']);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const response = await fetch(invoiceId ? `/api/invoices/gst/${invoiceId}` : '/api/invoices/gst', {
        method: invoiceId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyFromForm(form)),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; issues?: { path: string; message: string }[]; id?: string; docNo?: string }
        | null;
      if (!response.ok) {
        setErrors(payload?.issues?.length ? payload.issues.map((issue) => issue.message) : [payload?.error ?? 'The invoice could not be saved']);
        return;
      }
      await refresh().catch(() => undefined);
      notify(invoiceId ? 'Invoice saved' : `Draft ${payload?.docNo ?? ''} created`);
      if (!invoiceId && payload?.id) navigate(`/invoices/gst/${payload.id}`);
      else if (invoiceId) await load(invoiceId);
    } finally {
      setSaving(false);
    }
  };

  const action = async (path: string, body?: unknown) => {
    if (!invoiceId) return false;
    setErrors([]);
    const response = await fetch(`/api/invoices/gst/${invoiceId}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setErrors([payload?.error ?? 'That did not work']);
      return false;
    }
    await refresh().catch(() => undefined);
    await load(invoiceId);
    return true;
  };

  if (loading) {
    return (
      <div className="page editor-page">
        <p className="muted-copy">Loading invoice…</p>
      </div>
    );
  }
  if (missing) {
    return (
      <div className="page editor-page">
        <EmptyState
          icon={FileText}
          title="Invoice not found"
          description="It may have been removed or belongs to another workspace."
          action={
            <Link to="/invoices" className="btn btn-primary">
              Back to invoices
            </Link>
          }
        />
      </div>
    );
  }

  const storeInvoice = invoiceId ? invoices.find((item) => item.id === invoiceId) : undefined;
  const received = loaded?.receivedMinor ?? 0;
  const balance = loaded ? Math.max(0, loaded.grandMinor - received) : 0;
  const disabled = !editable;
  const leadChoices = [...leads, ...chats].filter((lead) => lead.name);

  return (
    <div className="page editor-page gst-editor-page">
      <div className="editor-topbar">
        <Link to="/invoices" className="back-link">
          <ArrowLeft size={15} /> Invoices
        </Link>
        <span className="eyebrow">GST invoice</span>
      </div>

      <div className="editor-title-row">
        <div>
          <h1>{loaded ? loaded.docNo : 'New GST invoice'}</h1>
          <p>
            {loaded
              ? loaded.cancelled
                ? 'This invoice is cancelled. Its number stays on record.'
                : loaded.status === 'draft'
                  ? 'Draft: you can still edit it. Issuing locks it.'
                  : 'Issued: it can be paid or cancelled, but not edited.'
              : 'Nothing is saved until you press Create draft. Tax numbers are given later, so a draft you drop leaves no gap.'}
          </p>
        </div>
        <div className="editor-top-actions">
          {loaded ? (
            <span className={`gst-status gst-status-${loaded.cancelled ? 'cancelled' : loaded.invoice.paymentStatus.toLowerCase().includes('paid') && !loaded.invoice.paymentStatus.includes('PARTIALLY') ? 'paid' : 'open'}`}>
              {loaded.invoice.paymentStatus}
            </span>
          ) : null}
          {loaded ? (
            <>
              <a className="btn btn-secondary" href={`/api/invoices/gst/${invoiceId}/file/pdf`} download>
                <Download size={15} /> PDF
              </a>
              <a className="btn btn-secondary" href={`/api/invoices/gst/${invoiceId}/file/docx`} download>
                <Download size={15} /> Word
              </a>
            </>
          ) : null}
          {loaded && loaded.status === 'draft' && !loaded.cancelled ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                if (await action('issue')) notify(loaded.invoice.docType === 'advance' ? 'Payment request marked as sent' : 'Invoice issued');
              }}
            >
              <Send size={15} /> {loaded.invoice.docType === 'advance' ? 'Mark request as sent' : 'Mark as issued'}
            </button>
          ) : null}
          {loaded && loaded.status !== 'draft' && !loaded.cancelled ? (
            <button type="button" className="btn btn-primary" onClick={() => setPaymentOpen(true)} disabled={balance === 0}>
              <CircleDollarSign size={15} /> Record payment
            </button>
          ) : null}
        </div>
      </div>

      {loaded ? (
        <p className={`gst-drive gst-drive-${loaded.drive.configured ? (loaded.drive.state ?? 'pending') : 'off'}`}>
          {!loaded.drive.configured ? (
            'Google Drive link is not set up yet. Downloads still work.'
          ) : loaded.drive.state === 'synced' ? (
            <>
              Saved to Drive{loaded.drive.folderName ? ` · ${loaded.drive.folderName}` : ''} and the master workbook.{' '}
              {loaded.drive.pdfUrl ? (
                <a href={loaded.drive.pdfUrl} target="_blank" rel="noreferrer">Open PDF</a>
              ) : null}
              {loaded.drive.docxUrl ? (
                <>
                  {' · '}
                  <a href={loaded.drive.docxUrl} target="_blank" rel="noreferrer">Open Word</a>
                </>
              ) : null}
            </>
          ) : loaded.drive.state === 'failed' ? (
            <>
              Drive sync is retrying: {loaded.drive.error ?? 'unknown problem'}{' '}
              <button type="button" className="text-link" onClick={() => void action('sync')}>Sync now</button>
            </>
          ) : (
            'Sending to Drive and the master workbook…'
          )}
          {loaded.drive.configured && loaded.drive.state === 'synced' ? (
            <>
              {' · '}
              <button type="button" className="text-link" onClick={() => void action('sync')}>Sync again</button>
            </>
          ) : null}
        </p>
      ) : null}

      {errors.length ? (
        <div className="form-error editor-error" role="alert">
          {errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}

      <form className="split-editor gst-editor" onSubmit={submit}>
        <div className="editor-form">
          <section className="card editor-section">
            <div className="editor-section-head">
              <div>
                <span className="card-kicker">01</span>
                <h2>Document</h2>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Type *</span>
                <select value={form.docType} onChange={(event) => patch('docType', event.target.value as DocType)} disabled={Boolean(loaded)}>
                  {(Object.keys(TYPE_LABELS) as DocType[]).map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Client *</span>
                <select value={form.clientId} onChange={(event) => chooseClient(event.target.value)} disabled={disabled}>
                  <option value="">Select a client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.company || client.name} · {client.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Issue date *</span>
                <input type="date" value={form.issuedAt} onChange={(event) => patch('issuedAt', event.target.value)} disabled={disabled} />
              </label>
              <label className="field">
                <span>Linked lead / chat</span>
                <select value={form.leadId} onChange={(event) => patch('leadId', event.target.value)} disabled={disabled}>
                  <option value="">None</option>
                  {leadChoices.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field-wide">
                <span>Payment terms</span>
                <input
                  value={form.paymentTerms}
                  onChange={(event) => patch('paymentTerms', event.target.value)}
                  placeholder={form.docType === 'advance' ? 'Advance received / due before project kickoff' : 'Due before final delivery / handover'}
                  disabled={disabled}
                />
              </label>
            </div>
          </section>

          <section className="card editor-section">
            <div className="editor-section-head">
              <div>
                <span className="card-kicker">02</span>
                <h2>Billed to</h2>
              </div>
            </div>
            <div className="form-grid">
              <label className="field field-wide">
                <span>Customer / business name *</span>
                <input value={form.customerName} onChange={(event) => patch('customerName', event.target.value)} disabled={disabled} />
              </label>
              <label className="field field-wide">
                <span>Authorised representative</span>
                <input value={form.representative} onChange={(event) => patch('representative', event.target.value)} disabled={disabled} />
              </label>
              <label className="field field-wide">
                <span>Billing address *</span>
                <input value={form.address} onChange={(event) => patch('address', event.target.value)} disabled={disabled} />
              </label>
              <label className="field">
                <span>City / state / PIN *</span>
                <input value={form.cityStatePin} onChange={(event) => patch('cityStatePin', event.target.value)} placeholder="Surat - 395006, Gujarat" disabled={disabled} />
              </label>
              <label className="field">
                <span>Place of supply *</span>
                <select value={form.stateCode} onChange={(event) => chooseState(event.target.value)} disabled={disabled}>
                  <option value="">Select a state</option>
                  {GST_STATES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name} ({state.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>GSTIN</span>
                <input value={form.gstin} onChange={(event) => patch('gstin', event.target.value.toUpperCase())} placeholder="Leave empty if unregistered" disabled={disabled} />
              </label>
              <label className="field">
                <span>PAN</span>
                <input value={form.pan} onChange={(event) => patch('pan', event.target.value.toUpperCase())} disabled={disabled} />
              </label>
            </div>
          </section>

          <section className="card editor-section">
            <div className="editor-section-head">
              <div>
                <span className="card-kicker">03</span>
                <h2>Project</h2>
              </div>
            </div>
            <div className="form-grid">
              <label className="field field-wide">
                <span>Project / service name *</span>
                <input value={form.projectName} onChange={(event) => patch('projectName', event.target.value)} disabled={disabled} />
              </label>
              <label className="field">
                <span>Service category</span>
                <input value={form.category} onChange={(event) => patch('category', event.target.value)} placeholder="Software / Digital Product Development" disabled={disabled} />
              </label>
              <label className="field">
                <span>Reference</span>
                <input value={form.reference} onChange={(event) => patch('reference', event.target.value)} placeholder="Agreement dated …" disabled={disabled} />
              </label>
              {form.docType === 'final' ? (
                <label className="field field-wide">
                  <span>Advance reference</span>
                  <input value={form.advanceRef} onChange={(event) => patch('advanceRef', event.target.value)} placeholder="SL/ADV/26-27/101 dated 19 May 2026" disabled={disabled} />
                </label>
              ) : null}
              {form.docType === 'advance' ? (
                <label className="field field-wide">
                  <span>Which advance is this</span>
                  <input value={form.advanceNote} onChange={(event) => patch('advanceNote', event.target.value)} placeholder="Milestone 1 - Project Kickoff (22%)" disabled={disabled} />
                </label>
              ) : null}
            </div>
          </section>

          <section className="card editor-section">
            <div className="editor-section-head">
              <div>
                <span className="card-kicker">04</span>
                <h2>Amounts (before tax)</h2>
              </div>
            </div>
            {form.docType !== 'regular' ? (
              <div className="form-grid">
                <label className="field">
                  <span>Total project value (₹)</span>
                  <input inputMode="decimal" value={form.projectTaxable} onChange={(event) => patch('projectTaxable', event.target.value)} placeholder="29999.00" disabled={disabled} />
                </label>
                <label className="field">
                  <span>{form.docType === 'final' ? 'Advance already billed (₹)' : 'Advance in this document (₹)'}</span>
                  <input inputMode="decimal" value={form.advanceTaxable} onChange={(event) => patch('advanceTaxable', event.target.value)} placeholder="15000.00" disabled={disabled} />
                </label>
              </div>
            ) : null}
            <div className="gst-lines">
              {form.lines.map((line, index) => (
                <div key={line.id} className="gst-line">
                  <label className="field field-wide">
                    <span>Line {index + 1} description *</span>
                    <input value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} disabled={disabled} />
                  </label>
                  <label className="field field-wide">
                    <span>Detail (printed under the description)</span>
                    <input value={line.detail} onChange={(event) => updateLine(line.id, { detail: event.target.value })} disabled={disabled} />
                  </label>
                  <label className="field">
                    <span>Qty</span>
                    <input inputMode="numeric" value={line.qty} onChange={(event) => updateLine(line.id, { qty: event.target.value })} disabled={disabled} />
                  </label>
                  <label className="field">
                    <span>Unit price (₹)</span>
                    <input inputMode="decimal" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })} disabled={disabled} />
                  </label>
                  {form.lines.length > 1 && !disabled ? (
                    <button type="button" className="row-text-action" onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((item) => item.id !== line.id) }))}>
                      Remove line
                    </button>
                  ) : null}
                </div>
              ))}
              {!disabled ? (
                <div className="gst-line-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, newLine()] }))}>
                    Add line
                  </button>
                  {summary.expected !== undefined && summary.expected > 0 && summary.expected !== summary.billable && form.lines.length === 1 ? (
                    <button type="button" className="btn btn-secondary" onClick={() => updateLine(form.lines[0].id, { qty: '1', unitPrice: toRupees(summary.expected ?? 0) })}>
                      Use {formatMoney(summary.expected)} as the amount
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="form-grid">
              <label className="field">
                <span>GST rate (%)</span>
                <input inputMode="numeric" value={form.taxRatePct} onChange={(event) => patch('taxRatePct', event.target.value)} disabled={disabled} />
              </label>
              <label className="field">
                <span>SAC code</span>
                <input value={form.sac} onChange={(event) => patch('sac', event.target.value)} disabled={disabled} />
              </label>
            </div>
          </section>

          <section className="card editor-section">
            <div className="editor-section-head">
              <div>
                <span className="card-kicker">05</span>
                <h2>Wording on the invoice</h2>
              </div>
            </div>
            <div className="form-grid">
              <label className="field field-wide">
                <span>GST treatment</span>
                <textarea rows={2} value={form.gstTreatment} onChange={(event) => patch('gstTreatment', event.target.value)} placeholder={defaultTreatment} disabled={disabled} />
              </label>
              <label className="field field-wide">
                <span>{form.docType === 'advance' ? 'Usage note' : 'Advance adjustment note'}</span>
                <textarea rows={3} value={form.adjustmentNote} onChange={(event) => patch('adjustmentNote', event.target.value)} disabled={disabled} />
              </label>
              <label className="field field-wide">
                <span>Notes &amp; terms (one per line)</span>
                <textarea rows={5} value={form.terms} onChange={(event) => patch('terms', event.target.value)} placeholder="Jurisdiction: Kolkata, West Bengal, India. …" disabled={disabled} />
              </label>
            </div>
          </section>

          {editable ? (
            <div className="gst-submit">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Check size={15} /> {invoiceId ? 'Save changes' : 'Create draft'}
              </button>
            </div>
          ) : null}

          {loaded && !loaded.cancelled ? (
            <section className="card editor-section gst-danger">
              <div className="editor-section-head">
                <div>
                  <h2>Cancel this invoice</h2>
                </div>
              </div>
              {!cancelOpen ? (
                <>
                  <p className="muted-copy">
                    {loaded.invoice.series === 'REF'
                      ? 'This has no tax number yet, so cancelling it leaves no gap in your numbers. You can’t cancel one that has payments recorded.'
                      : 'An issued invoice is never deleted, so the number sequence stays unbroken. A cancelled invoice keeps its number and is no longer owed. You can’t cancel one that has payments recorded.'}
                  </p>
                  <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(true)}>
                    <Ban size={15} /> Cancel invoice
                  </button>
                </>
              ) : (
                <div className="form-grid">
                  <label className="field field-wide">
                    <span>Reason *</span>
                    <input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Issued in error" />
                  </label>
                  <div className="gst-line-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={async () => {
                        if (await action('cancel', { reason: cancelReason })) {
                          setCancelOpen(false);
                          notify('Invoice cancelled');
                        }
                      }}
                    >
                      Confirm cancel
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(false)}>
                      Keep invoice
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </div>

        <aside className="gst-summary card" aria-label="Invoice summary">
          <NumberingPanel
            docType={form.docType}
            numbering={numbering}
            selfId={invoiceId}
            loaded={loaded ? { docNo: loaded.docNo, series: loaded.invoice.series, status: loaded.status, cancelled: loaded.cancelled } : null}
          />
          <span className="card-kicker">Summary</span>
          <h2>{form.docType === 'advance' ? 'Advance payment' : 'Tax invoice'}</h2>
          <p className="gst-supply">
            {form.stateCode ? (summary.supplyType === 'intra' ? 'Same state: CGST + SGST' : 'Other state: IGST') : 'Place of supply not chosen'}
          </p>
          <dl className="gst-totals">
            {summary.totals.rows.map((row) => (
              <div key={row.label} className={row.kind === 'grand' ? 'grand' : undefined}>
                <dt>{row.label}</dt>
                <dd>{formatMoney(row.valueMinor)}</dd>
              </div>
            ))}
          </dl>
          <p className="gst-words">{amountInWords(summary.totals.grandMinor)}</p>
          {loaded ? (
            <dl className="gst-totals gst-received">
              <div>
                <dt>Received so far</dt>
                <dd>{formatMoney(received)}</dd>
              </div>
              <div>
                <dt>Balance</dt>
                <dd>{formatMoney(balance)}</dd>
              </div>
            </dl>
          ) : null}
          {summary.hints.length ? (
            <ul className="gst-hints">
              {summary.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          ) : null}
          <p className="gst-fineprint">
            Tax type follows the place of supply. Payment status is worked out from payments you record, never typed.
          </p>
        </aside>
      </form>

      <section className="card gst-preview-card" aria-label="Live preview">
        <div className="editor-section-head">
          <div>
            <span className="card-kicker">Preview</span>
            <h2>What the customer will receive</h2>
          </div>
        </div>
        <p className="muted-copy">This redraws as you type. The PDF and Word file are made from the same data.</p>
        <InvoicePreview model={previewModel} docNoLabel={loaded ? loaded.docNo : form.docType === 'advance' ? 'REF given when saved' : 'Draft, no number yet'} />
      </section>

      <PaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} invoices={invoices} initialInvoiceId={storeInvoice?.id} />
    </div>
  );
}
