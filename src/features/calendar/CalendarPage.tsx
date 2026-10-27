import { useMemo, useState } from 'react';
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';
import { ArrowLeft, ArrowRight, CalendarPlus, Circle } from 'lucide-react';
import { Link } from '../../lib/router';
import { DEMO_NOW } from '../../data/demo';
import type { CalendarEvent } from '../../data/types';
import { formatDate } from '../../lib/format';
import { useCrmStore } from '../../store/crmStore';
import { deriveCalendarEvents } from '../../store/selectors';
import { PageHeader } from '../../components/layout/PageHeader';
import { EventDialog } from './EventDialog';

const TYPE_LABELS = {
  follow_up: 'Follow-up',
  meeting: 'Meeting',
  proposal_expiry: 'Proposal expiry',
  payment_due: 'Payment due',
};

const TIME_START = 8;
const TIME_END = 19;
const HOUR_HEIGHT = 60;

function EventBlock({ event }: { event: CalendarEvent }) {
  const start = parseISO(event.startsAt);
  const end = parseISO(event.endsAt);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const duration = Math.max(
    30,
    Math.round((end.getTime() - start.getTime()) / 60_000),
  );
  const top = Math.max(0, ((startMinutes - TIME_START * 60) / 60) * HOUR_HEIGHT);
  const height = Math.max(34, (duration / 60) * HOUR_HEIGHT - 4);

  const content = (
    <>
      <strong>{event.title}</strong>
      <span>{format(start, 'h:mm a')}</span>
    </>
  );

  const className = `calendar-event type-${event.type}`;

  return event.href ? (
    <Link
      to={event.href}
      className={className}
      style={{ top, height }}
      title={event.title}
    >
      {content}
    </Link>
  ) : (
    <div className={className} style={{ top, height }} title={event.title}>
      {content}
    </div>
  );
}

export function CalendarPage() {
  const [view, setView] = useState<'week' | 'month'>('week');
  const [cursor, setCursor] = useState(DEMO_NOW);
  const [eventOpen, setEventOpen] = useState(false);
  const leads = useCrmStore((state) => state.leads);
  const proposals = useCrmStore((state) => state.proposals);
  const invoices = useCrmStore((state) => state.invoices);
  const payments = useCrmStore((state) => state.payments);
  const manualEvents = useCrmStore((state) => state.events);

  const events = useMemo(
    () =>
      deriveCalendarEvents({
        leads,
        proposals,
        invoices,
        payments,
        manualEvents,
      }),
    [leads, proposals, invoices, payments, manualEvents],
  );

  const weekStart = startOfWeek(cursor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const weekEvents = events.filter((event) => {
    const date = parseISO(event.startsAt);
    return date >= weekStart && date <= weekEnd;
  });
  const hours = Array.from(
    { length: TIME_END - TIME_START + 1 },
    (_, index) => TIME_START + index,
  );

  const monthStart = startOfMonth(cursor);
  const monthGridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthGridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
  const monthDays = eachDayOfInterval({ start: monthGridStart, end: monthGridEnd });

  const goPrevious = () => setCursor((date) => (view === 'week' ? subWeeks(date, 1) : subMonths(date, 1)));
  const goNext = () => setCursor((date) => (view === 'week' ? addWeeks(date, 1) : addMonths(date, 1)));
  const goToday = () => setCursor(DEMO_NOW);

  const label =
    view === 'week'
      ? `${format(weekStart, 'd MMM')} – ${format(weekEnd, 'd MMM yyyy')}`
      : format(cursor, 'MMMM yyyy');

  return (
    <div className="page calendar-page">
      <PageHeader
        eyebrow="12 / Calendar"
        title="Calendar"
        description="Follow-ups, production days, proposal expiry, and payment deadlines in one rhythm."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEventOpen(true)}>
            <CalendarPlus size={16} /> New event
          </button>
        }
      />

      <div className="calendar-layout">
        <section className="card calendar-board">
          <div className="calendar-toolbar">
            <div className="calendar-nav">
              <button type="button" className="icon-button bordered" onClick={goPrevious} aria-label={`Previous ${view}`}>
                <ArrowLeft size={15} />
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={goToday}>
                Today
              </button>
              <button type="button" className="icon-button bordered" onClick={goNext} aria-label={`Next ${view}`}>
                <ArrowRight size={15} />
              </button>
              <strong className="calendar-range-label">{label}</strong>
            </div>
            <div className="view-toggle" role="group" aria-label="Calendar view">
              <button
                type="button"
                className={view === 'month' ? 'active' : ''}
                onClick={() => setView('month')}
                aria-pressed={view === 'month'}
              >
                Month
              </button>
              <button
                type="button"
                className={view === 'week' ? 'active' : ''}
                onClick={() => setView('week')}
                aria-pressed={view === 'week'}
              >
                Week
              </button>
            </div>
          </div>

          {view === 'week' ? (
            <div className="week-calendar">
              <div className="week-head">
                <span className="time-gutter-head">GMT+5:30</span>
                {weekDays.map((day) => (
                  <div
                    key={day.toISOString()}
                    className={`week-day-head${isSameDay(day, DEMO_NOW) ? ' today' : ''}`}
                  >
                    <span>{format(day, 'EEE')}</span>
                    <strong>{format(day, 'd')}</strong>
                  </div>
                ))}
              </div>
              <div className="week-body">
                <div className="week-time-gutter">
                  {hours.map((hour) => (
                    <span key={hour} style={{ height: HOUR_HEIGHT }}>
                      {format(new Date(2026, 0, 1, hour), 'h a')}
                    </span>
                  ))}
                </div>
                {weekDays.map((day) => {
                  const dayEvents = weekEvents.filter((event) =>
                    isSameDay(parseISO(event.startsAt), day),
                  );
                  return (
                    <div
                      key={day.toISOString()}
                      className={`week-day-column${isSameDay(day, DEMO_NOW) ? ' today' : ''}`}
                      style={{ height: hours.length * HOUR_HEIGHT }}
                    >
                      {hours.map((hour) => (
                        <span
                          className="hour-line"
                          key={hour}
                          style={{ top: (hour - TIME_START) * HOUR_HEIGHT }}
                        />
                      ))}
                      {dayEvents.map((event) => {
                        const startHour = parseISO(event.startsAt).getHours();
                        return startHour >= TIME_START && startHour <= TIME_END ? (
                          <EventBlock key={event.id} event={event} />
                        ) : null;
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="month-calendar">
              <div className="month-week-head">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="month-grid">
                {monthDays.map((day) => {
                  const dayEvents = events.filter((event) =>
                    isSameDay(parseISO(event.startsAt), day),
                  );
                  return (
                    <div
                      key={day.toISOString()}
                      className={`month-day${isSameMonth(day, cursor) ? '' : ' outside'}${isSameDay(day, DEMO_NOW) ? ' today' : ''}`}
                    >
                      <span className="month-day-number">{format(day, 'd')}</span>
                      <div className="month-event-list">
                        {dayEvents.slice(0, 3).map((event) => {
                          const inner = (
                            <>
                              <span className={`month-event-dot type-${event.type}`} />
                              <span>{event.title}</span>
                            </>
                          );
                          return event.href ? (
                            <Link
                              key={event.id}
                              to={event.href}
                              className="month-event"
                              title={event.title}
                            >
                              {inner}
                            </Link>
                          ) : (
                            <div key={event.id} className="month-event" title={event.title}>
                              {inner}
                            </div>
                          );
                        })}
                        {dayEvents.length > 3 ? (
                          <span className="more-events">+{dayEvents.length - 3} more</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <aside className="calendar-agenda">
          <div className="agenda-head">
            <div>
              <h2>Upcoming</h2>
              <p>Across {view === 'week' ? 'this week' : 'this month'}</p>
            </div>
            <Circle size={10} fill="#171816" strokeWidth={0} />
          </div>
          <div className="agenda-list">
            {(view === 'week'
              ? weekEvents
              : events.filter((event) => isSameMonth(parseISO(event.startsAt), cursor))
            )
              .slice(0, 8)
              .map((event) => {
                const item = (
                  <>
                    <span className={`agenda-dot type-${event.type}`} />
                    <span className="agenda-copy">
                      <strong>{event.title}</strong>
                      <small>{TYPE_LABELS[event.type]}</small>
                      <span>
                        {formatDate(event.startsAt, 'EEE, d MMM')} ·{' '}
                        {format(parseISO(event.startsAt), 'h:mm a')}
                      </span>
                    </span>
                    <ArrowRight size={14} className="agenda-arrow" />
                  </>
                );
                return event.href ? (
                  <Link key={event.id} to={event.href} className="agenda-item">
                    {item}
                  </Link>
                ) : (
                  <div key={event.id} className="agenda-item">
                    {item}
                  </div>
                );
              })}
            {weekEvents.length === 0 && view === 'week' ? (
              <p className="muted-copy">No events scheduled this week.</p>
            ) : null}
          </div>

          <div className="calendar-legend">
            <span>Event types</span>
            <div><i className="legend type-follow_up" /> Lead follow-up</div>
            <div><i className="legend type-meeting" /> Meeting</div>
            <div><i className="legend type-proposal_expiry" /> Proposal expiry</div>
            <div><i className="legend type-payment_due" /> Payment due</div>
          </div>
          <p className="calendar-note">
            Times shown in your local timezone. Calendar entries are derived from CRM records.
          </p>
        </aside>
      </div>

      <EventDialog open={eventOpen} onOpenChange={setEventOpen} defaultDate={cursor} />
    </div>
  );
}
