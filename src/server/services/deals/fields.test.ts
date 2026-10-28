import { describe, expect, it } from 'vitest';
import { fitField, type SignField } from './fields';

const box = (patch: Partial<SignField> = {}): SignField => ({ id: 'a', role: 'client', page: 1, x: 0.1, y: 0.7, w: 0.3, h: 0.07, ...patch });

describe('signature boxes', () => {
  it('keeps a box inside its page', () => {
    const f = fitField(box({ x: 0.95, y: 0.99 }));
    expect(f.x + f.w).toBeLessThanOrEqual(1);
    expect(f.y + f.h).toBeLessThanOrEqual(1);
  });
  it('never lets a box shrink to nothing', () => {
    const f = fitField(box({ w: 0, h: 0 }));
    expect(f.w).toBeGreaterThan(0.05);
    expect(f.h).toBeGreaterThan(0.02);
  });
  it('leaves a good box alone', () => {
    expect(fitField(box())).toEqual(box());
  });
});
