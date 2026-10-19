// Enkel spärr mot lösenordsgissning: högst 10 misslyckade försök per
// e-postadress på 15 minuter, per serverinstans. Ren logik med inskickad klocka.
export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60_000;

export function createThrottle(max = MAX_FAILURES, windowMs = WINDOW_MS) {
  const failures = new Map<string, number[]>();
  const recent = (key: string, now: number) => (failures.get(key) ?? []).filter((t) => now - t < windowMs);
  return {
    blocked(key: string, now = Date.now()) {
      return recent(key, now).length >= max;
    },
    fail(key: string, now = Date.now()) {
      const list = recent(key, now);
      list.push(now);
      failures.set(key, list);
    },
    reset(key: string) {
      failures.delete(key);
    },
  };
}

export const loginThrottle = createThrottle();
