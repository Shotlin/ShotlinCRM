import { useEffect, useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import type { CalendarEventType } from '../../data/types';
import { useCrmStore } from '../../store/crmStore';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

export function EventDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: Date;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(format(defaultDate, 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [type, setType] = useState<CalendarEventType>('meeting');
  const [error, setError] = useState('');
  const addEvent = useCrmStore((state) => state.addEvent);
  const flush = useCrmStore((state) => state.flush);
  const { notify } = useToast();

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDate(format(defaultDate, 'yyyy-MM-dd'));
    setStartTime('10:00');
    setEndTime('11:00');
    setType('meeting');
    setError('');
  }, [open, defaultDate]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Add a title for the event.');
      return;
    }
    if (endTime <= startTime) {
      setError('The end time must be after the start time.');
      return;
    }
    addEvent({
      title: title.trim(),
      startsAt: `${date}T${startTime}:00`,
      endsAt: `${date}T${endTime}:00`,
      type,
    });
    await flush();
    notify('Event added to calendar');
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New event"
      description="Add a meeting or studio block to this week."
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="submit" form="event-form" className="btn btn-primary">
            Add event
          </button>
        </>
      }
    >
      <form id="event-form" className="form-stack" onSubmit={handleSubmit}>
        <label className="field">
          <span>Title *</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Type</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as CalendarEventType)}
            >
              <option value="meeting">Meeting</option>
              <option value="follow_up">Follow-up</option>
              <option value="proposal_expiry">Proposal expiry</option>
              <option value="payment_due">Payment due</option>
            </select>
          </label>
          <label className="field">
            <span>Starts</span>
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Ends</span>
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </label>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
