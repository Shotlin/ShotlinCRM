import { describe, expect, it } from 'vitest';
import { backupDue, backupKey, expiredBackups } from './backup';

describe('nightly backup', () => {
  it('keeps the newest seven and only touches its own files', () => {
    const keys = Array.from({ length: 9 }, (_, i) => `w/backups/db-2026-10-${String(10 + i).padStart(2, '0')}.dump`);
    keys.push('w/backups/notes.txt');
    expect(expiredBackups(keys)).toEqual(['w/backups/db-2026-10-11.dump', 'w/backups/db-2026-10-10.dump']);
  });
  it('names by India date and waits until 2am there', () => {
    expect(backupKey('w', new Date('2026-10-28T21:00:00Z'))).toBe('w/backups/db-2026-10-29.dump');
    expect(backupDue(new Date('2026-10-28T19:00:00Z'))).toBe(false);
    expect(backupDue(new Date('2026-10-28T21:00:00Z'))).toBe(true);
  });
});
