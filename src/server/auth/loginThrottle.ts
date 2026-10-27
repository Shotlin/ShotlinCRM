type Attempt = { count: number; resetAt: number };

export function createLoginThrottle({
  maxAttempts = 8,
  windowMs = 15 * 60_000,
}: {
  maxAttempts?: number;
  windowMs?: number;
} = {}) {
  const attempts = new Map<string, Attempt>();

  return {
    allow(email: string, now = Date.now()) {
      const current = attempts.get(email);
      if (!current || current.resetAt <= now) {
        attempts.delete(email);
        return true;
      }
      return current.count < maxAttempts;
    },
    recordFailure(email: string, now = Date.now()) {
      const current = attempts.get(email);
      if (!current || current.resetAt <= now) {
        attempts.set(email, { count: 1, resetAt: now + windowMs });
        return;
      }
      current.count += 1;
    },
    reset(email: string) {
      attempts.delete(email);
    },
  };
}
