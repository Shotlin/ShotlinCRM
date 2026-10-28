// The rules for when to warn about storage. Pure, so they can be tested without a database.

export type Level = 'ok' | 'warn' | 'critical';

// A warning appears at 80% full, and a stronger one at 95%.
export const WARN_AT = 80;
export const CRITICAL_AT = 95;

export const levelFor = (percent: number): Level => (percent >= CRITICAL_AT ? 'critical' : percent >= WARN_AT ? 'warn' : 'ok');
const rank: Record<Level, number> = { ok: 0, warn: 1, critical: 2 };
export const worstLevel = (levels: Level[]): Level => levels.reduce<Level>((worst, level) => (rank[level] > rank[worst] ? level : worst), 'ok');

export function bytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export type StorageItem = {
  id: 'bucket' | 'disk' | 'database';
  label: string;
  usedBytes: number;
  limitBytes: number | null;
  percent: number | null;
  level: Level;
  detail: string;
};

export type StorageHealth = { checkedAt: string; level: Level; items: StorageItem[]; headline: string | null };

export type HealthDeps = {
  bucketBytes: () => Promise<number | null>;
  mediaBytesOnServer: () => Promise<number>;
  disk: () => Promise<{ totalBytes: number; freeBytes: number }>;
  databaseBytes: () => Promise<number>;
  now: () => Date;
  mode: () => string;
  limitGb: () => number;
};

const GB = 1024 ** 3;

function item(id: StorageItem['id'], label: string, usedBytes: number, limitBytes: number | null, what: string): StorageItem {
  if (limitBytes === null || limitBytes <= 0) {
    return { id, label, usedBytes, limitBytes: null, percent: null, level: 'ok', detail: `${bytesLabel(usedBytes)} used.` };
  }
  const percent = Math.min(100, (usedBytes / limitBytes) * 100);
  const level = levelFor(percent);
  const base = `${bytesLabel(usedBytes)} of ${bytesLabel(limitBytes)} used (${percent.toFixed(0)}%).`;
  const advice =
    level === 'critical'
      ? ` ${what} is almost full. Free up space or increase the limit now, or new files may fail to save.`
      : level === 'warn'
        ? ` ${what} is getting full. Plan to free up space or increase the limit soon.`
        : '';
  return { id, label, usedBytes, limitBytes, percent, level, detail: base + advice };
}

export async function buildStorageHealth(deps: HealthDeps): Promise<StorageHealth> {
  const items: StorageItem[] = [];

  if (deps.mode() === 's3') {
    const bucket = await deps.bucketBytes();
    if (bucket !== null) {
      items.push(item('bucket', 'File storage (R2)', bucket, deps.limitGb() * GB, 'The R2 storage plan'));
    }
  } else {
    items.push(item('bucket', 'Files on this server', await deps.mediaBytesOnServer(), null, ''));
  }

  const disk = await deps.disk();
  items.push(item('disk', 'Server disk', disk.totalBytes - disk.freeBytes, disk.totalBytes, 'The server disk'));
  items.push(item('database', 'CRM database', await deps.databaseBytes(), null, ''));

  const level = worstLevel(items.map((entry) => entry.level));
  const worst = items.find((entry) => entry.level === level && level !== 'ok');
  const headline = worst ? `${worst.label}: ${worst.detail}` : null;
  return { checkedAt: deps.now().toISOString(), level, items, headline };
}
