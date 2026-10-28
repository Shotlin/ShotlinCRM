'use client';

import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from '../../lib/router';

type Health = { level: 'ok' | 'warn' | 'critical'; headline: string | null };

// A bar across the top that appears only when storage is getting full.
export function StorageBanner() {
  const [health, setHealth] = useState<Health | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem('storage-banner-dismissed') === 'warn');
    } catch {
      // Storage can be blocked; the bar then simply stays visible.
    }
    let cancelled = false;
    const check = () =>
      fetch('/api/system/storage', { cache: 'no-store' })
        .then((response) => (response.ok ? (response.json() as Promise<Health>) : null))
        .then((value) => {
          if (!cancelled && value) setHealth(value);
        })
        .catch(() => undefined);
    void check();
    const timer = setInterval(check, 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!health || health.level === 'ok' || !health.headline) return null;
  // A warning can be put away for this visit. A critical one stays until space is freed.
  if (health.level === 'warn' && dismissed) return null;

  return (
    <div className={`storage-banner storage-banner-${health.level}`} role="alert">
      <TriangleAlert size={16} aria-hidden="true" />
      <span>{health.headline}</span>
      <Link to="/settings/storage">Details</Link>
      {health.level === 'warn' ? (
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            try {
              sessionStorage.setItem('storage-banner-dismissed', 'warn');
            } catch {
              // Not saved, so it shows again next visit.
            }
          }}
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
