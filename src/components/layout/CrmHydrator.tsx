'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useCrmStore } from '../../store/crmStore';
import { useToast } from '../ui/Toast';

export function CrmHydrator({ children }: { children: ReactNode }) {
  const hydrate = useCrmStore((state) => state.hydrate);
  const hydrated = useCrmStore((state) => state.hydrated);
  const refresh = useCrmStore((state) => state.refresh);
  const lastError = useCrmStore((state) => state.lastError);
  const clearError = useCrmStore((state) => state.clearError);
  const [error, setError] = useState('');
  const { notify } = useToast();

  useEffect(() => {
    hydrate().catch(() => setError('The workspace could not be loaded.'));
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    const events = new EventSource('/api/events');
    events.onmessage = () => {
      void refresh().catch(() => undefined);
    };
    return () => events.close();
  }, [hydrated, refresh]);

  useEffect(() => {
    if (!lastError) return;
    notify(lastError);
    clearError();
  }, [lastError, notify, clearError]);

  if (error) {
    return (
      <div className="route-loading" role="alert">
        {error} <button type="button" className="text-link" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className="route-loading" role="status">
        <span className="route-loading-mark" aria-hidden="true" />
        Loading workspace
      </div>
    );
  }

  return <>{children}</>;
}
