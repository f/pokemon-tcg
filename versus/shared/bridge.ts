// The postMessage contract between the lobby (parent) and the game frame. Pure: parsing and message building only.
// The parent never interprets payload contents; it checks shapes, enums and sizes and passes strings through.
import type { Lang } from "./i18n";
import { isMessageKind, isSeq, isStoredText, isVersion, isWinner, type InboxItem, type MessageKind, type Role, type Winner } from "./rules";

export type FrameToParent =
  | { type: "ready" }
  | { type: "send"; kind: MessageKind; payload: string }
  | { type: "ack"; uptoSeq: number }
  | { type: "save"; hostState: string; guestView: string; version: number }
  | { type: "over"; winner: Winner }
  | { type: "leave" };

export type ParentToFrame =
  | {
      type: "init";
      role: Role;
      matchId: string;
      decks: { host: string; guest: string };
      nicks: { host: string; guest: string };
      lang: Lang;
      relayOnly: boolean;
      resume: null | { state: string; version: number };
    }
  | { type: "inbox"; msgs: InboxItem[] }
  | { type: "status"; status: string; winner: string | null };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A message from the frame, or null when any field is missing, of the wrong type, out of range or too long. */
export function parseFrameMessage(data: unknown): FrameToParent | null {
  if (!isPlainObject(data) || typeof data.type !== "string") return null;
  switch (data.type) {
    case "ready":
      return { type: "ready" };
    case "leave":
      return { type: "leave" };
    case "send":
      if (!isMessageKind(data.kind) || !isStoredText(data.payload)) return null;
      return { type: "send", kind: data.kind, payload: data.payload };
    case "ack":
      if (!isSeq(data.uptoSeq)) return null;
      return { type: "ack", uptoSeq: data.uptoSeq };
    case "save":
      if (!isStoredText(data.hostState) || !isStoredText(data.guestView) || !isVersion(data.version)) return null;
      return { type: "save", hostState: data.hostState, guestView: data.guestView, version: data.version };
    case "over":
      if (!isWinner(data.winner)) return null;
      return { type: "over", winner: data.winner };
    default:
      return null;
  }
}

/** Inbox rows from the server, re-checked before they cross into the frame. */
export function cleanInbox(rows: unknown): InboxItem[] | null {
  if (!Array.isArray(rows)) return null;
  const out: InboxItem[] = [];
  for (const r of rows) {
    if (!isPlainObject(r) || !isSeq(r.seq) || typeof r.kind !== "string" || !isMessageKind(r.kind) || typeof r.payload !== "string") continue;
    out.push({ seq: r.seq, kind: r.kind, payload: r.payload });
  }
  return out;
}
