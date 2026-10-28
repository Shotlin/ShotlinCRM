import { describe, expect, it } from 'vitest';
import { buildStorageHealth, bytesLabel, levelFor, worstLevel, type HealthDeps } from './storageLevels';

const GB = 1024 ** 3;
const deps = (over: Partial<HealthDeps> = {}): HealthDeps => ({
  mode: () => 's3',
  now: () => new Date('2026-10-28T10:00:00Z'),
  limitGb: () => 10,
  bucketBytes: async () => 1 * GB,
  mediaBytesOnServer: async () => 4_000_000,
  disk: async () => ({ totalBytes: 200 * GB, freeBytes: 150 * GB }),
  databaseBytes: async () => 50_000_000,
  ...over,
});

describe('levelFor', () => {
  it('warns at 80% and is critical at 95%', () => {
    expect(levelFor(0)).toBe('ok');
    expect(levelFor(79.9)).toBe('ok');
    expect(levelFor(80)).toBe('warn');
    expect(levelFor(94.9)).toBe('warn');
    expect(levelFor(95)).toBe('critical');
    expect(levelFor(100)).toBe('critical');
  });

  it('reports the worst of several levels', () => {
    expect(worstLevel([])).toBe('ok');
    expect(worstLevel(['ok', 'warn', 'ok'])).toBe('warn');
    expect(worstLevel(['warn', 'critical', 'ok'])).toBe('critical');
  });
});

describe('bytesLabel', () => {
  it('writes sizes people can read', () => {
    expect(bytesLabel(512)).toBe('512 B');
    expect(bytesLabel(3_800_000)).toBe('3.6 MB');
    expect(bytesLabel(1.5 * GB)).toBe('1.5 GB');
    expect(bytesLabel(150 * GB)).toBe('150 GB');
  });
});

describe('buildStorageHealth', () => {
  it('is all clear when there is plenty of space', async () => {
    const health = await buildStorageHealth(deps());
    expect(health.level).toBe('ok');
    expect(health.headline).toBeNull();
    expect(health.items.map((i) => i.id)).toEqual(['bucket', 'disk', 'database']);
    expect(health.items[0]).toMatchObject({ label: 'File storage (R2)', percent: 10 });
  });

  it('warns when the bucket passes 80% of its limit', async () => {
    const health = await buildStorageHealth(deps({ bucketBytes: async () => 8.4 * GB }));
    expect(health.level).toBe('warn');
    expect(health.headline).toMatch(/File storage \(R2\): 8\.4 GB of 10\.0 GB used \(84%\)/);
    expect(health.headline).toMatch(/getting full/);
  });

  it('turns critical at 95% and says what could go wrong', async () => {
    const health = await buildStorageHealth(deps({ bucketBytes: async () => 9.7 * GB }));
    expect(health.level).toBe('critical');
    expect(health.headline).toMatch(/almost full/);
    expect(health.headline).toMatch(/may fail to save/);
  });

  it('uses the limit that is configured', async () => {
    const health = await buildStorageHealth(deps({ bucketBytes: async () => 1 * GB, limitGb: () => 1.02 }));
    expect(health.level).toBe('critical');
  });

  it('watches the server disk as well', async () => {
    const health = await buildStorageHealth(deps({ disk: async () => ({ totalBytes: 100 * GB, freeBytes: 12 * GB }) }));
    expect(health.level).toBe('warn');
    expect(health.items.find((i) => i.id === 'disk')?.percent).toBe(88);
    expect(health.headline).toMatch(/^Server disk:/);
  });

  it('headlines the worst problem, not the first', async () => {
    const health = await buildStorageHealth(
      deps({ bucketBytes: async () => 8.5 * GB, disk: async () => ({ totalBytes: 100 * GB, freeBytes: 2 * GB }) }),
    );
    expect(health.level).toBe('critical');
    expect(health.headline).toMatch(/^Server disk:/);
  });

  it('shows plain file usage without a limit when files are still on this server', async () => {
    const health = await buildStorageHealth(deps({ mode: () => 'local' }));
    expect(health.items[0]).toMatchObject({ id: 'bucket', label: 'Files on this server', limitBytes: null, percent: null, level: 'ok' });
  });

  it('skips the bucket line if it cannot be counted', async () => {
    const health = await buildStorageHealth(deps({ bucketBytes: async () => null }));
    expect(health.items.map((i) => i.id)).toEqual(['disk', 'database']);
  });
});
