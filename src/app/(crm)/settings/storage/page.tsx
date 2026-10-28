'use client';

import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';

type Item = {
  id: string;
  label: string;
  usedBytes: number;
  limitBytes: number | null;
  percent: number | null;
  level: 'ok' | 'warn' | 'critical';
  detail: string;
};
type Health = { checkedAt: string; level: 'ok' | 'warn' | 'critical'; items: Item[]; headline: string | null };

const LEVEL_LABEL = { ok: 'Fine', warn: 'Getting full', critical: 'Almost full' } as const;

export default function StoragePage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/system/storage${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('The storage check could not run.');
      setHealth((await response.json()) as Health);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The storage check could not run.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div className="page storage-page">
      <PageHeader
        eyebrow="Settings / Storage"
        title="Storage"
        description="How full your file storage, server disk and database are. You get a warning at 80% and a stronger one at 95%."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void load(true)} disabled={loading}>
            {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} Check now
          </button>
        }
      />
      {error ? <p className="form-error">{error}</p> : null}
      {health ? (
        <>
          <div className="storage-grid">
            {health.items.map((item) => (
              <section key={item.id} className={`card storage-card storage-card-${item.level}`}>
                <div className="storage-card-head">
                  <h2>{item.label}</h2>
                  <span className={`storage-chip storage-chip-${item.level}`}>{LEVEL_LABEL[item.level]}</span>
                </div>
                {item.percent !== null ? (
                  <div className="storage-bar" role="progressbar" aria-valuenow={Math.round(item.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={item.label}>
                    <span style={{ width: `${Math.max(2, item.percent)}%` }} />
                  </div>
                ) : null}
                <p>{item.detail}</p>
              </section>
            ))}
          </div>
          <p className="muted-copy">
            Checked {new Date(health.checkedAt).toLocaleString('en-IN')}. The file storage limit is set on the server
            (<code>STORAGE_LIMIT_GB</code>, 10 GB by default, the size of the R2 free plan).
          </p>
        </>
      ) : loading ? (
        <p className="muted-copy">Checking…</p>
      ) : null}
    </div>
  );
}
