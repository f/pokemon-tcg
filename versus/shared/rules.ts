// Pure authorization, validation and rate-limit rules for the Versus lobby.
// The server calls these with rows it read; tests/rules.test.mjs runs them directly. No imports beyond relative files,
// no browser or host globals: this file runs in the Zero server runtime and in Node.
import { DECKS, type DeckFormat } from "./decks";

/** The one answer every denied read or write gives: signed out, not a member, missing id, expired, wrong status. */
export const DENIED = "not available";
export const SLOW_DOWN = "slow down";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const OPEN_TTL_MS = DAY;
export const PLAYING_TTL_MS = 30 * DAY;
/** Finished and abandoned games stay in My games this long, then the sweep removes them. */
export const FINISHED_TTL_MS = 7 * DAY;
export const MESSAGE_TTL_MS = 10 * MINUTE;

export const NICK_MIN = 1;
export const NICK_MAX = 24;
export const TEXT_MAX_CHARS = 60_000;
/**
 * Zero refuses a single database operation over 64 KiB (the JSON of the statement, UTF-8). A text column is written
 * in an operation of its own, so its JSON-encoded size must leave room for the rest of that statement.
 */
export const TEXT_MAX_DB_BYTES = 64 * 1024 - 1024;
/** Zero refuses an action result over 48 KiB, so resume() hands a saved state out in chunks of at most this. */
export const RESUME_CHUNK_BYTES = 40_000;
/** Zero refuses a runner response over 1 MiB; inbox() stops adding messages well before that. */
export const INBOX_MAX_BYTES = 600_000;
export const INBOX_TAKE = 50;
export const MY_MATCHES_MAX = 20;
export const MAX_ACTIVE_MATCHES = 5;
export const SWEEP_MAX = 10;
export const ACK_MAX = 50;
export const FINISH_DELETE_MAX = 100;
/** Unacknowledged messages one player may have waiting for the other in one match; sendMessage refuses beyond it. */
export const PENDING_MAX = 64;
/** Rows read per (role, status) when collecting a player's open and playing games. */
export const ACTIVE_SCAN_MAX = 20;

/** Writes per user: a token bucket refilled at 10 per second, holding at most 30. */
export const WRITE_RATE_PER_SEC = 10;
export const WRITE_BURST = 30;
/** Failed join attempts per user: at most 10 in 10 minutes. */
export const JOIN_FAIL_LIMIT = 10;
export const JOIN_FAIL_WINDOW_MS = 10 * MINUTE;
/** saveState: about one per second per match. */
export const SAVE_MIN_INTERVAL_MS = 900;
/** players.writes keeps at most this many entries. */
export const WRITES_CAP = 40;

export const MESSAGE_KINDS = ["offer", "answer", "bye", "relay"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export const WINNERS = ["host", "guest", "draw"] as const;
export type Winner = (typeof WINNERS)[number];
export type Role = "host" | "guest";
export type MatchStatus = "open" | "playing" | "done" | "abandoned";

export function deny(): Error {
  return new Error(DENIED);
}

// ---------------------------------------------------------------- identity

export type AuthLike = { userId: string | null; isSignedIn: boolean; isGuest: boolean };

/**
 * Local `sf dev ?guest=alice` identities. `guest:local` and `guest:anon_<hex>` are refused as well, but this filter is
 * defence in depth only: what keeps strangers out of a live Space is that ALLOW_DEV_GUESTS is never set there.
 */
export function isDevGuestId(userId: unknown): boolean {
  if (typeof userId !== "string") return false;
  const m = /^guest:([A-Za-z][A-Za-z0-9._-]{0,31})$/.exec(userId);
  if (!m) return false;
  const name = m[1].toLowerCase();
  return name !== "local" && !name.startsWith("anon_");
}

/** The caller's user id, or null: signed in, or a named dev guest when ALLOW_DEV_GUESTS is '1'. */
export function callerId(auth: AuthLike | null | undefined, allowDevGuests: string | undefined): string | null {
  if (!auth || typeof auth.userId !== "string" || auth.userId === "") return null;
  if (auth.isSignedIn === true) return auth.userId;
  if (auth.isGuest === true && allowDevGuests === "1" && isDevGuestId(auth.userId)) return auth.userId;
  return null;
}

// ---------------------------------------------------------------- argument validation

export function isMatchId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
/** A 128-bit invite code, base64url without padding. */
export function isInviteCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(value);
}
/** sha256 of the invite code, lowercase hex. */
export function isInviteHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
export function isDeckKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= 48 && Object.prototype.hasOwnProperty.call(DECKS, value);
}
export function deckFormat(key: string): DeckFormat | null {
  return isDeckKey(key) ? DECKS[key].format : null;
}
export function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === "string" && (MESSAGE_KINDS as readonly string[]).includes(value);
}
export function isWinner(value: unknown): value is Winner {
  return typeof value === "string" && (WINNERS as readonly string[]).includes(value);
}
/** sendMessage's optional idempotency key: the client's own id for one queued message (base64url, 8–32 chars). */
export function isNonce(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,32}$/.test(value);
}
/** A message sequence number or cursor: a non-negative safe integer. */
export function isSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** A saved state version: a positive safe integer. */
export function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** UTF-8 byte length, computed by hand: the server runtime has no TextEncoder guarantee. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
/** Bytes this string takes inside a JSON document (quotes and escapes included). */
export function jsonBytes(text: string): number {
  return utf8Length(JSON.stringify(text));
}
/** payload, hostState and guestView: a string of at most 60000 characters that also fits one database operation. */
export function isStoredText(value: unknown): value is string {
  return typeof value === "string" && value.length <= TEXT_MAX_CHARS && jsonBytes(value) <= TEXT_MAX_DB_BYTES;
}

/** Trim, collapse spaces, allow letters, digits, space, '-', '_', '.'; 1–24 characters. Null when it cannot be used. */
export function sanitizeNickname(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  const clean = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (clean.length < NICK_MIN || clean.length > NICK_MAX) return null;
  if (!/^[\p{L}\p{N} ._-]+$/u.test(clean)) return null;
  if (!/[\p{L}\p{N}]/u.test(clean)) return null;
  return clean;
}

// ---------------------------------------------------------------- matches

export type MatchRow = {
  id: string;
  createdAt?: string;
  hostId: string;
  guestId?: string | null;
  hostNick: string;
  guestNick?: string | null;
  inviteHash?: string | null;
  hostDeck: string;
  guestDeck?: string | null;
  format: string;
  status: string;
  winner?: string | null;
  lastMoveAt: number;
  expiresAt: number;
  msgSeq?: number | null;
};

export function isLive(match: { expiresAt: number } | null | undefined, now: number): boolean {
  return !!match && typeof match.expiresAt === "number" && match.expiresAt > now;
}

/** The caller's side of a match, or null. Ignores expiry and status. */
export function roleOf(match: MatchRow | null | undefined, uid: string | null): Role | null {
  if (!match || !uid) return null;
  if (match.hostId === uid) return "host";
  if (match.guestId && match.guestId === uid) return "guest";
  return null;
}

/** A member of a live match that is being played: may send, save (host), finish (host) and resume. */
export function playingRole(match: MatchRow | null | undefined, uid: string | null, now: number): Role | null {
  const role = roleOf(match, uid);
  if (!role || !isLive(match, now) || match!.status !== "playing") return null;
  return role;
}

/**
 * A member of a live match that has started (playing, done or abandoned): may read and acknowledge their inbox.
 * Messages sent just before the end stay readable until they expire or are acknowledged.
 */
export function inboxRole(match: MatchRow | null | undefined, uid: string | null, now: number): Role | null {
  const role = roleOf(match, uid);
  if (!role || !isLive(match, now) || match!.status === "open") return null;
  return role;
}

export function isActive(match: MatchRow, now: number): boolean {
  return (match.status === "open" || match.status === "playing") && isLive(match, now);
}

export function countActive(matches: readonly MatchRow[], now: number): number {
  const seen = new Set<string>();
  for (const m of matches) if (isActive(m, now)) seen.add(m.id);
  return seen.size;
}

export type MatchView = {
  id: string;
  role: Role;
  status: string;
  hostNick: string;
  guestNick: string | null;
  hostDeck: string;
  guestDeck: string | null;
  format: string;
  winner: string | null;
};

/** What match(id) returns: an allowlist of fields, never user ids or the invite hash. */
export function matchView(match: MatchRow | null | undefined, uid: string | null, now: number): MatchView | null {
  const role = roleOf(match, uid);
  if (!role || !isLive(match, now)) return null;
  const m = match!;
  const open = m.status === "open";
  return {
    id: m.id,
    role,
    status: m.status,
    hostNick: m.hostNick,
    guestNick: m.guestNick ?? null,
    hostDeck: m.hostDeck,
    guestDeck: open ? null : m.guestDeck ?? null,
    format: m.format,
    winner: m.winner ?? null,
  };
}

export type MyMatchItem = {
  id: string;
  role: Role;
  status: string;
  myNick: string;
  oppNick: string | null;
  myDeck: string;
  oppDeck: string | null;
  format: string;
  lastMoveAt: number;
};

export function myMatchItem(match: MatchRow, uid: string, now: number): MyMatchItem | null {
  const role = roleOf(match, uid);
  if (!role || !isLive(match, now)) return null;
  const host = role === "host";
  const open = match.status === "open";
  return {
    id: match.id,
    role,
    status: match.status,
    myNick: host ? match.hostNick : match.guestNick ?? "",
    oppNick: (host ? match.guestNick : match.hostNick) ?? null,
    myDeck: host ? match.hostDeck : match.guestDeck ?? "",
    oppDeck: open ? null : (host ? match.guestDeck : match.hostDeck) ?? null,
    format: match.format,
    lastMoveAt: match.lastMoveAt,
  };
}

/**
 * myMatches(): both roles merged, de-duplicated, expired ones dropped, newest first, at most 20. Open and playing games
 * always make the cut, however old, so a game in play can be resumed; finished ones fill the remaining places.
 */
export function myMatchesView(rows: readonly MatchRow[], uid: string, now: number): MyMatchItem[] {
  const byId = new Map<string, MatchRow>();
  for (const r of rows) byId.set(r.id, r);
  const items = [...byId.values()]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.lastMoveAt - a.lastMoveAt)
    .map((m) => myMatchItem(m, uid, now))
    .filter((m): m is MyMatchItem => m !== null);
  const active = items.filter((m) => m.status === "open" || m.status === "playing");
  const finished = items.filter((m) => m.status !== "open" && m.status !== "playing");
  const keep = new Set([...active, ...finished].slice(0, MY_MATCHES_MAX).map((m) => m.id));
  return items.filter((m) => keep.has(m.id));
}

export type JoinVerdict = "ok" | "not_available" | "wrong_format";

/**
 * Whether `uid` may take the guest seat with `deck`. Run on the row re-read after the row lock, so a second joiner
 * sees the first one's write. The host never joins their own match.
 */
export function joinVerdict(match: MatchRow | null | undefined, uid: string, deck: string, now: number): JoinVerdict {
  if (!match || !isLive(match, now) || match.status !== "open" || match.guestId) return "not_available";
  if (match.hostId === uid) return "not_available";
  if (!isDeckKey(deck)) return "not_available";
  if (deckFormat(deck) !== match.format) return "wrong_format";
  return "ok";
}

export type AbandonPlan = { kind: "delete" } | { kind: "abandon"; winner: Winner };

/** Open matches (only the host is in one) are deleted; a game in play goes to the other side. */
export function abandonPlan(match: MatchRow | null | undefined, uid: string, now: number): AbandonPlan | null {
  const role = roleOf(match, uid);
  if (!role || !isLive(match, now)) return null;
  if (match!.status === "open") return role === "host" ? { kind: "delete" } : null;
  if (match!.status === "playing") return { kind: "abandon", winner: role === "host" ? "guest" : "host" };
  return null;
}

/** finishMatch and saveState: the host of a live match in play. */
export function isPlayingHost(match: MatchRow | null | undefined, uid: string, now: number): boolean {
  return playingRole(match, uid, now) === "host";
}

/** The other member's user id. */
export function otherMember(match: MatchRow, role: Role): string | null {
  return role === "host" ? match.guestId ?? null : match.hostId;
}

// ---------------------------------------------------------------- messages

/**
 * The next message number. `msgSeq` on the match is the highest number ever handed out, so numbers keep growing
 * after acknowledged messages are deleted; `maxExisting` covers rows written before the counter.
 */
export function nextSeq(msgSeq: number | null | undefined, maxExisting = 0): number {
  const a = typeof msgSeq === "number" && Number.isSafeInteger(msgSeq) && msgSeq > 0 ? msgSeq : 0;
  const b = Number.isSafeInteger(maxExisting) && maxExisting > 0 ? maxExisting : 0;
  return Math.max(a, b) + 1;
}

export type MessageRow = { toId: string; seq: number; kind: string; payload: string; expiresAt: number };
export type InboxItem = { seq: number; kind: string; payload: string };

/** inbox(): the caller's unexpired messages after `afterSeq`, ascending, at most 50 and well under the response cap. */
export function inboxView(rows: readonly MessageRow[], uid: string, afterSeq: number, now: number): InboxItem[] {
  const out: InboxItem[] = [];
  let bytes = 0;
  const sorted = rows
    .filter((r) => r.toId === uid && r.seq > afterSeq && r.expiresAt > now)
    .sort((a, b) => a.seq - b.seq);
  for (const r of sorted) {
    if (out.length >= INBOX_TAKE) break;
    const size = jsonBytes(r.payload) + 48;
    if (out.length > 0 && bytes + size > INBOX_MAX_BYTES) break;
    bytes += size;
    out.push({ seq: r.seq, kind: r.kind, payload: r.payload });
  }
  return out;
}

// ---------------------------------------------------------------- rate limits

/** players.writes: positive entries are write times (ms), negative entries are failed join attempts (-ms). */
export function parseWrites(json: unknown): number[] {
  if (typeof json !== "string" || json.length > 4000) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n !== 0).slice(-WRITES_CAP);
  } catch {
    return [];
  }
}

/** Token bucket replayed over the logged write times: `rate` per second, at most `burst` saved up. */
export function bucketAllows(writes: readonly number[], now: number, rate = WRITE_RATE_PER_SEC, burst = WRITE_BURST): boolean {
  const times = writes.filter((t) => t > 0 && t <= now).sort((a, b) => a - b);
  let tokens = burst;
  let last = times.length ? times[0] : now;
  for (const t of times) {
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * rate) - 1;
    last = t;
  }
  tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
  return tokens >= 1;
}

export function recentJoinFailures(writes: readonly number[], now: number): number {
  return writes.filter((t) => t < 0 && now + t < JOIN_FAIL_WINDOW_MS).length;
}

export function joinAllowed(writes: readonly number[], now: number): boolean {
  return recentJoinFailures(writes, now) < JOIN_FAIL_LIMIT;
}

function capWrites(writes: readonly number[], now: number): number[] {
  const fails = writes.filter((t) => t < 0 && now + t < JOIN_FAIL_WINDOW_MS).slice(-JOIN_FAIL_LIMIT);
  const oks = writes.filter((t) => t > 0).sort((a, b) => a - b).slice(-(WRITES_CAP - fails.length));
  return [...fails, ...oks];
}

export function withWrite(writes: readonly number[], now: number): number[] {
  return capWrites([...writes, now], now);
}

export function withJoinFailure(writes: readonly number[], now: number): number[] {
  return capWrites([...writes, -now], now);
}

/** saveState: refused when the last save of this match was under SAVE_MIN_INTERVAL_MS ago. */
export function saveAllowed(lastSavedAtIso: string | null | undefined, now: number): boolean {
  if (!lastSavedAtIso) return true;
  const at = Date.parse(lastSavedAtIso);
  if (!Number.isFinite(at)) return true;
  return now - at >= SAVE_MIN_INTERVAL_MS || at > now;
}

// ---------------------------------------------------------------- resume chunks

/**
 * The slice of `text` starting at `offset` whose JSON encoding fits in `maxBytes`, never splitting a surrogate pair,
 * and where the next slice starts (null after the last one).
 */
export function chunkAt(text: string, offset: number, maxBytes = RESUME_CHUNK_BYTES): { text: string; next: number | null } {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return { text: "", next: null };
  let bytes = 2;
  let end = offset;
  while (end < text.length) {
    const c = text.charCodeAt(end);
    let width = 1;
    let size: number;
    if (c === 0x22 || c === 0x5c) size = 2;
    else if (c < 0x20) size = 6;
    else if (c < 0x80) size = 1;
    else if (c < 0x800) size = 2;
    else if (c >= 0xd800 && c <= 0xdbff && end + 1 < text.length) {
      const d = text.charCodeAt(end + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        width = 2;
        size = 4;
      } else size = 6;
    } else if (c >= 0xd800 && c <= 0xdfff) size = 6;
    else size = 3;
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += width;
  }
  if (end === offset && offset < text.length) end = Math.min(text.length, offset + 1);
  return { text: text.slice(offset, end), next: end < text.length ? end : null };
}

// ---------------------------------------------------------------- client-side helpers (also pure)

export type JoinResult =
  | { id: string }
  | { id: null; error: "not_available" | "wrong_format" | "slow_down" | "too_many"; format?: string };

/** base64url of 16 random bytes: the invite code (22 characters). */
export function encodeInviteCode(bytes: ArrayLike<number>): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63] + alphabet[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63];
  }
  return out;
}
