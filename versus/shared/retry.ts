// Retry policy for Zero mutation and action calls: 3 tries, jittered backoff of 0.5–2 s, and the server's wait when an
// error says how long (a 429 with Retry-After, or the server's own "slow down"). Pure: the client supplies the clock.
import { DENIED, SLOW_DOWN } from "./rules";

export const RETRY_TRIES = 3;

/** Errors that mean the same thing on every try. The hosted client hides server messages, so most errors retry. */
export function isFinalError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message === DENIED || message === "stale version" || message === "invalid nickname" || message === "nickname required" || message === "too many games";
}

function retryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { status?: unknown; retryAfter?: unknown; headers?: { get?: (name: string) => string | null }; message?: unknown };
  let seconds: number | null = null;
  if (typeof e.retryAfter === "number" && Number.isFinite(e.retryAfter)) seconds = e.retryAfter;
  else if (typeof e.retryAfter === "string" && /^\d+(\.\d+)?$/.test(e.retryAfter)) seconds = Number(e.retryAfter);
  else if (e.headers && typeof e.headers.get === "function") {
    const h = e.headers.get("retry-after");
    if (h && /^\d+(\.\d+)?$/.test(h)) seconds = Number(h);
  }
  if (seconds !== null) return Math.min(30_000, Math.max(0, seconds * 1000));
  if (e.status === 429 || e.message === SLOW_DOWN) return 2000;
  return null;
}

/** How long to wait before the next try. `random` is a number in [0, 1). */
export function retryDelayMs(error: unknown, random: number): number {
  const r = Math.min(Math.max(random, 0), 0.999999);
  const told = retryAfterMs(error);
  if (told !== null) return Math.round(told + r * 500);
  return Math.round(500 + r * 1500);
}
