import { describe, expect, it } from 'vitest';
import { createLoginThrottle } from './loginThrottle';

describe('login throttle', () => {
  it('blocks after eight failed attempts in the window', () => {
    const throttle = createLoginThrottle({ maxAttempts: 8, windowMs: 15 * 60_000 });
    const now = 1_000_000;
    for (let count = 0; count < 8; count += 1) {
      expect(throttle.allow('owner@example.com', now)).toBe(true);
      throttle.recordFailure('owner@example.com', now);
    }
    expect(throttle.allow('owner@example.com', now)).toBe(false);
  });

  it('does not count successful sign-ins toward the failure limit', () => {
    const throttle = createLoginThrottle({ maxAttempts: 2, windowMs: 15 * 60_000 });
    const now = 1_000_000;
    throttle.recordFailure('owner@example.com', now);
    throttle.reset('owner@example.com');
    expect(throttle.allow('owner@example.com', now)).toBe(true);
    throttle.reset('owner@example.com');
    expect(throttle.allow('owner@example.com', now)).toBe(true);
  });

  it('forgets attempts after the window expires', () => {
    const throttle = createLoginThrottle({ maxAttempts: 1, windowMs: 1_000 });
    throttle.recordFailure('owner@example.com', 1_000);
    expect(throttle.allow('owner@example.com', 1_001)).toBe(false);
    expect(throttle.allow('owner@example.com', 2_001)).toBe(true);
  });
});
