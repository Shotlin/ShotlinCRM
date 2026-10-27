import { useMemo, useState } from 'react';
import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  Check,
  ChevronDown,
  GripVertical,
  List,
  Plus,
  Search,
  SquareKanban,
} from 'lucide-react';
import { Link, useNavigate } from '../../lib/router';
import { formatMoney } from '../../data/currencies';
import type { Currency, Lead, LeadSource, LeadStatus } from '../../data/types';
import { formatFollowUp } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { LEAD_STAGES, pipelineSummary } from '../../store/selectors';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { SourceBadge, StatusPill } from '../../components/ui/Badges';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { LeadDialog } from '../leads/LeadDialog';

const stageKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return;

  const columns = LEAD_STAGES.map((stage) => context.droppableRects.get(stage.status))
    .filter((rect) => rect !== undefined)
    .sort((a, b) => a.left - b.left);

  const target =
    event.code === 'ArrowRight'
      ? columns.find((rect) => rect.left > currentCoordinates.x + 20)
      : [...columns].reverse().find((rect) => rect.left < currentCoordinates.x - 20);

  return target
    ? { x: target.left + 10, y: currentCoordinates.y }
    : undefined;
};

function LeadCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
  });
  const moveLead = useCrmStore((state) => state.moveLead);
  const style = transform
    ? { transform: CSS.Translate.toString(transform), zIndex: 20 }
    : undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`pipeline-card${isDragging ? ' is-dragging' : ''}`}
    >
      <div className="pipeline-card-head">
        <Link to={`/leads/${lead.id}`} className="pipeline-card-name">
          <Avatar name={lead.name} size="sm" />
          <span>
            <strong>{lead.name}</strong>
            <small>{lead.company}</small>
          </span>
        </Link>
        <button
          type="button"
          className="drag-handle"
          aria-label={`Drag ${lead.name} to another stage`}
          {...listeners}
          {...attributes}
        >
          <GripVertical size={15} />
        </button>
      </div>
      <Link to={`/leads/${lead.id}`} className="pipeline-card-body">
        <p>{lead.initialMessage}</p>
        <div className="pipeline-card-meta">
          <strong>{formatMoney(lead.valueMinor, lead.currency)}</strong>
          <SourceBadge source={lead.source} />
        </div>
        {lead.followUpAt ? (
          <span className="pipeline-card-followup">{formatFollowUp(lead.followUpAt)}</span>
        ) : null}
      </Link>
      <details className="card-more">
        <summary aria-label={`More actions for ${lead.name}`}>
          <ChevronDown size={14} />
        </summary>
        <div className="card-more-menu">
          <span className="menu-label">Move to stage</span>
          {LEAD_STAGES.filter((stage) => stage.status !== lead.status).map((stage) => (
            <button
              type="button"
              key={stage.status}
              onClick={() => moveLead(lead.id, stage.status)}
            >
              {stage.label}
            </button>
          ))}
        </div>
      </details>
    </article>
  );
}

function PipelineColumn({
  stage,
  leads,
  count,
  totalMinor,
  currency,
}: {
  stage: LeadStatus;
  leads: Lead[];
  count: number;
  totalMinor: number;
  currency: Currency;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const stageLabel = LEAD_STAGES.find((item) => item.status === stage)?.label ?? stage;

  return (
    <section
      ref={setNodeRef}
      className={`pipeline-column${isOver ? ' is-over' : ''}`}
      aria-label={`${stageLabel} column`}
    >
      <div className="pipeline-column-head">
        <div>
          <span className={`stage-marker stage-${stage}`} />
          <h2>{stageLabel}</h2>
          <span className="column-count">{count}</span>
        </div>
        <small>{formatMoney(totalMinor, currency)}</small>
      </div>
      <div className="pipeline-column-body">
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
        {leads.length === 0 ? (
          <div className="column-empty">
            <span>No leads here</span>
            <small>Drop a card to move it</small>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function PipelinePage() {
  const [leadOpen, setLeadOpen] = useState(false);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [source, setSource] = useState<'all' | LeadSource>('all');
  const [query, setQuery] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const leads = useCrmStore((state) => state.leads);
  const reportingCurrency = useCrmStore((state) => state.reportingCurrency);
  const moveLead = useCrmStore((state) => state.moveLead);
  const { notify } = useToast();
  const navigate = useNavigate();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: stageKeyboardCoordinates }),
  );

  const filtered = useMemo(
    () =>
      leads.filter((lead) => {
        const matchesSource = source === 'all' || lead.source === source;
        const needle = query.trim().toLowerCase();
        const matchesQuery =
          !needle ||
          lead.name.toLowerCase().includes(needle) ||
          lead.company.toLowerCase().includes(needle) ||
          lead.initialMessage.toLowerCase().includes(needle);
        return matchesSource && matchesQuery;
      }),
    [leads, source, query],
  );

  const summary = useMemo(
    () => pipelineSummary(filtered, reportingCurrency),
    [filtered, reportingCurrency],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const leadId = String(event.active.id);
    const status = event.over?.id as LeadStatus | undefined;
    if (!status) return;
    const lead = leads.find((item) => item.id === leadId);
    if (!lead || lead.status === status) return;
    moveLead(leadId, status);
    const label = LEAD_STAGES.find((stage) => stage.status === status)?.label ?? status;
    setAnnouncement(`${lead.name} moved to ${label}`);
    notify(`${lead.name} moved to ${label}`);
  };

  return (
    <div className="page pipeline-page">
      <PageHeader
        eyebrow="02 / Pipeline"
        title="Pipeline"
        description="Turn conversations into confirmed bookings."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setLeadOpen(true)}>
            <Plus size={16} />
            New lead
          </button>
        }
      />

      <div className="pipeline-toolbar">
        <div className="pipeline-filters">
          <label className="search-field">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search leads"
              aria-label="Search leads"
            />
          </label>
          <label className="select-field">
            <span className="sr-only">Lead source</span>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as 'all' | LeadSource)}
            >
              <option value="all">All sources</option>
              <option value="meta">Meta</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>
        </div>
        <div className="view-toggle" role="group" aria-label="Pipeline view">
          <button
            type="button"
            className={view === 'kanban' ? 'active' : ''}
            onClick={() => setView('kanban')}
            aria-pressed={view === 'kanban'}
          >
            <SquareKanban size={14} /> Kanban
          </button>
          <button
            type="button"
            className={view === 'list' ? 'active' : ''}
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
          >
            <List size={14} /> List
          </button>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {view === 'kanban' && filtered.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragEnd={handleDragEnd}
        >
          <div className="kanban-board">
            {summary.map((column) => (
              <PipelineColumn
                key={column.status}
                stage={column.status}
                leads={filtered.filter((lead) => lead.status === column.status)}
                count={column.count}
                totalMinor={column.valueMinor}
                currency={reportingCurrency}
              />
            ))}
          </div>
        </DndContext>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Source</th>
                  <th>Stage</th>
                  <th>Value</th>
                  <th>Next follow-up</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <Link to={`/leads/${lead.id}`} className="table-person">
                        <Avatar name={lead.name} size="sm" />
                        <span>
                          <strong>{lead.name}</strong>
                          <small>{lead.company}</small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <SourceBadge source={lead.source} />
                    </td>
                    <td>
                      <StatusPill status={lead.status} />
                    </td>
                    <td className="numeric">{formatMoney(lead.valueMinor, lead.currency)}</td>
                    <td className="muted-cell">
                      {lead.followUpAt ? formatFollowUp(lead.followUpAt) : 'Not scheduled'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-link table-action"
                        onClick={() => navigate(`/leads/${lead.id}`)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matching leads"
              description="Try another name, company, or source filter."
            />
          ) : null}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card pipeline-empty-wrap">
          <EmptyState
            icon={Search}
            title="No matching leads"
            description="Clear the search or source filter to see the full pipeline."
            action={
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  setQuery('');
                  setSource('all');
                }}
              >
                <Check size={15} /> Clear filters
              </button>
            }
          />
        </div>
      ) : null}

      <LeadDialog open={leadOpen} onOpenChange={setLeadOpen} />
    </div>
  );
}
