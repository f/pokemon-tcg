// Small browser helpers: retries for Zero calls, the frame address, dev-guest links and the invite code.
import { navigate } from "@spacefast/zero/client";

import { frameOriginFor, frameUrlFor, isLocalHost } from "../shared/config";
import { encodeInviteCode } from "../shared/rules";
import { RETRY_TRIES, isFinalError, retryDelayMs } from "../shared/retry";

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs a Zero mutation or action up to 3 times with jittered backoff (0.5–2 s, or the server's wait). */
export async function withRetry<T>(call: () => Promise<T>, tries = RETRY_TRIES): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await call();
    } catch (error) {
      last = error;
      if (attempt === tries || isFinalError(error)) break;
      await sleep(retryDelayMs(error, Math.random()));
    }
  }
  throw last;
}

/** The game frame: http://127.0.0.1:8791 next to a local lobby, the live play origin everywhere else. */
export function frameUrl(): string {
  return frameUrlFor(location.hostname);
}
export function frameOrigin(): string {
  return frameOriginFor(location.hostname);
}

/**
 * Local `sf dev` testing picks its player from ?guest=alice in the address. Keep that parameter on in-app links so
 * a reload stays the same player. Elsewhere this returns the path unchanged.
 */
export function appHref(path: string): string {
  if (typeof location === "undefined" || !isLocalHost(location.hostname)) return path;
  const guest = new URLSearchParams(location.search).get("guest");
  if (!guest || !/^[A-Za-z0-9._-]{1,32}$/.test(guest)) return path;
  const [base, hash = ""] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}guest=${encodeURIComponent(guest)}${hash ? `#${hash}` : ""}`;
}

export function go(path: string, replace = false) {
  navigate(appHref(path), { replace });
}

/** A random idempotency key for one queued sendMessage (96 bits, base64url, 16 characters). */
export function newNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return encodeInviteCode(bytes);
}

/** A fresh 128-bit invite code (base64url, 22 characters) and its sha256, lowercase hex. */
export async function newInvite(): Promise<{ code: string; hash: string }> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const code = encodeInviteCode(bytes);
  return { code, hash: await sha256Hex(code) };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
}
