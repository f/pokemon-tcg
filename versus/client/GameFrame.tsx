// The game frame and its postMessage bridge. The frame is a different, cookie-free origin; this side relays its
// signaling and relay messages through Zero, saves the host's state and reports the result. It never reads payloads.
import { useEffect, useRef } from "preact/hooks";
import { useAction, useMutation } from "@spacefast/zero/client";

import { cleanInbox, parseFrameMessage, type ParentToFrame } from "../shared/bridge";
import type { Lang } from "../shared/i18n";
import { retryDelayMs } from "../shared/retry";
import type { InboxItem, MatchView, MessageKind, Winner } from "../shared/rules";
import { frameOrigin, frameUrl, go, newNonce, sleep, withRetry } from "./util";

type ResumeChunk = null | { role: string; version: number; state: string | null; next: number | null };
type Resume = null | { state: string; version: number };

const SEND_QUEUE_MAX = 200;
const SEND_ROUNDS = 5;
const SAVE_GAP_MS = 1100;
/** How long a reloaded frame's resume waits for a save already on its way. */
const SAVE_DRAIN_MS = 10_000;

/** resume(matchId) in chunks (Zero caps an action result at 48 KiB); restarts if a save lands in between. */
async function loadResume(call: (matchId: string, offset: number) => Promise<ResumeChunk>, matchId: string): Promise<Resume> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await withRetry(() => call(matchId, 0));
    if (!first || typeof first.state !== "string" || typeof first.version !== "number" || first.version <= 0) return null;
    let state = first.state;
    let next = first.next;
    let consistent = true;
    for (let guard = 0; typeof next === "number" && guard < 64; guard++) {
      const offset: number = next;
      const part = await withRetry(() => call(matchId, offset));
      if (!part || part.version !== first.version || typeof part.state !== "string") {
        consistent = false;
        break;
      }
      state += part.state;
      next = part.next;
    }
    if (consistent && next === null) return { state, version: first.version };
  }
  return null;
}

export function GameFrame({
  matchId,
  match,
  inbox,
  lang,
  relayOnly,
  onAck,
}: {
  matchId: string;
  match: MatchView;
  inbox: InboxItem[] | undefined;
  lang: Lang;
  relayOnly: boolean;
  onAck: (uptoSeq: number) => void;
}) {
  const sendMessage = useMutation<[string, MessageKind, string, string], { seq: number }>("sendMessage");
  const ackMessages = useMutation<[string, number], { deleted: number }>("ackMessages");
  const saveState = useMutation<[string, string, string, number], { version: number }>("saveState");
  const finishMatch = useMutation<[string, string], { ok: true }>("finishMatch");
  const resume = useAction<[string, number], ResumeChunk>("resume");

  const frame = useRef<HTMLIFrameElement>(null);
  const alive = useRef(true);
  const ready = useRef(false);
  const initSent = useRef(false);
  // undefined while resume() is loading; bumping resumeGen discards a load that a newer one replaced.
  const resumeData = useRef<Resume | undefined>(undefined);
  const resumeGen = useRef(0);
  const latest = useRef({ match, inbox, lang, relayOnly });
  latest.current = { match, inbox, lang, relayOnly };

  // Each queued message carries its own idempotency key, reused by every retry of that message.
  const sendQueue = useRef<{ kind: MessageKind; payload: string; nonce: string }[]>([]);
  const sending = useRef(false);
  const pendingSave = useRef<{ hostState: string; guestView: string; version: number; tries: number } | null>(null);
  const saving = useRef(false);
  const lastSaveAt = useRef(0);
  const acked = useRef(0);
  const maxPostedSeq = useRef(0);
  const finishing = useRef(false);
  // The host's result waits here until every queued message is sent, so the last relay batch is stored first.
  const pendingOver = useRef<Winner | null>(null);

  function post(message: ParentToFrame) {
    frame.current?.contentWindow?.postMessage(message, frameOrigin());
  }

  function postInbox() {
    const msgs = cleanInbox(latest.current.inbox);
    if (!msgs) return;
    for (const m of msgs) if (m.seq > maxPostedSeq.current) maxPostedSeq.current = m.seq;
    post({ type: "inbox", msgs });
  }

  function maybeInit() {
    const { match: m, lang: l, relayOnly: relay } = latest.current;
    if (initSent.current || !ready.current || resumeData.current === undefined || m.status !== "playing") return;
    initSent.current = true;
    post({
      type: "init",
      role: m.role,
      matchId,
      decks: { host: m.hostDeck, guest: m.guestDeck ?? "" },
      nicks: { host: m.hostNick, guest: m.guestNick ?? "" },
      lang: l,
      relayOnly: relay,
      resume: resumeData.current,
    });
    postInbox();
  }

  async function pumpSends() {
    if (sending.current) return;
    sending.current = true;
    try {
      let rounds = 0;
      while (alive.current && sendQueue.current.length > 0) {
        if (latest.current.match.status !== "playing") {
          sendQueue.current.length = 0;
          break;
        }
        const item = sendQueue.current[0];
        try {
          await withRetry(() => sendMessage(matchId, item.kind, item.payload, item.nonce));
          sendQueue.current.shift();
          rounds = 0;
        } catch (error) {
          rounds++;
          if (rounds >= SEND_ROUNDS) {
            sendQueue.current.shift();
            rounds = 0;
            continue;
          }
          await sleep(retryDelayMs(error, Math.random()) + 1500);
        }
      }
    } finally {
      sending.current = false;
      maybeFinish();
    }
  }

  /** finishMatch once the send queue is idle: finishing first would drop or strand the last queued messages. */
  function maybeFinish() {
    const winner = pendingOver.current;
    if (!winner || !alive.current || finishing.current || sending.current || sendQueue.current.length > 0) return;
    pendingOver.current = null;
    finishing.current = true;
    void withRetry(() => finishMatch(matchId, winner))
      .catch(() => undefined)
      .finally(() => {
        finishing.current = false;
      });
  }

  async function pumpSaves() {
    if (saving.current) return;
    saving.current = true;
    try {
      while (alive.current && pendingSave.current) {
        const wait = lastSaveAt.current + SAVE_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        const save = pendingSave.current;
        if (!save) break;
        pendingSave.current = null;
        try {
          await withRetry(() => saveState(matchId, save.hostState, save.guestView, save.version));
        } catch {
          // A newer save supersedes this one; otherwise try it once more after the gap.
          if (!pendingSave.current && save.tries < 2) pendingSave.current = { ...save, tries: save.tries + 1 };
        }
        lastSaveAt.current = Date.now();
      }
    } finally {
      saving.current = false;
    }
  }

  /**
   * (Re)loads the saved state for the next init. After a frame reload the save the old frame queued goes out first,
   * so the new frame resumes from the latest state and its next save is not refused as stale.
   */
  function refreshResume(drainSaves: boolean) {
    const gen = ++resumeGen.current;
    resumeData.current = undefined;
    void (async () => {
      const until = Date.now() + SAVE_DRAIN_MS;
      while (drainSaves && alive.current && (saving.current || pendingSave.current) && Date.now() < until) await sleep(200);
      const data = await loadResume((id, offset) => resume(id, offset), matchId).catch(() => null);
      if (gen !== resumeGen.current) return;
      resumeData.current = data;
      maybeInit();
    })();
  }

  // resume() once on mount, and again whenever the frame reloads (see "ready").
  useEffect(() => {
    refreshResume(false);
    return () => {
      resumeGen.current++;
    };
  }, [matchId]);

  // The bridge: only messages from this iframe's window and the frame origin, every field checked.
  useEffect(() => {
    alive.current = true;
    function onMessage(event: MessageEvent) {
      if (event.origin !== frameOrigin() || !frame.current || event.source !== frame.current.contentWindow) return;
      const message = parseFrameMessage(event.data);
      if (!message) {
        // Shape, enum or size check failed. Name the type only; payloads stay private.
        const type = event.data && typeof event.data === "object" ? String((event.data as { type?: unknown }).type).slice(0, 20) : typeof event.data;
        console.warn(`versus: dropped a frame message (${type}): wrong shape or over the size limit`);
        return;
      }
      const role = latest.current.match.role;
      switch (message.type) {
        case "ready": {
          // A second ready means the frame reloaded: its init needs the state saved since, not the one from mount.
          const reloaded = ready.current;
          ready.current = true;
          initSent.current = false;
          if (reloaded) refreshResume(true);
          else maybeInit();
          break;
        }
        case "send":
          if (sendQueue.current.length >= SEND_QUEUE_MAX) return;
          sendQueue.current.push({ kind: message.kind, payload: message.payload, nonce: newNonce() });
          void pumpSends();
          break;
        case "ack": {
          // Only messages this side has actually handed to the frame can be acknowledged (and so deleted).
          const upto = Math.min(message.uptoSeq, maxPostedSeq.current);
          if (upto <= acked.current) return;
          acked.current = upto;
          onAck(upto);
          void withRetry(() => ackMessages(matchId, upto)).catch(() => undefined);
          break;
        }
        case "save":
          if (role !== "host") return;
          pendingSave.current = { hostState: message.hostState, guestView: message.guestView, version: message.version, tries: 0 };
          void pumpSaves();
          break;
        case "over":
          if (role !== "host" || finishing.current) return;
          pendingOver.current = message.winner;
          maybeFinish();
          break;
        case "leave":
          go("/");
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      alive.current = false;
      window.removeEventListener("message", onMessage);
    };
  }, [matchId]);

  useEffect(() => {
    if (initSent.current) postInbox();
  }, [inbox]);

  useEffect(() => {
    if (initSent.current) post({ type: "status", status: match.status, winner: match.winner });
    else maybeInit();
  }, [match.status, match.winner]);

  return (
    <iframe
      ref={frame}
      src={frameUrl()}
      title="Pokémon TCG Academy game"
      allow="clipboard-write"
      referrerpolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin allow-popups"
      class="w-full"
      style="height: calc(100dvh - 120px); border: 0"
    />
  );
}
