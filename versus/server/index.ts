import { action, capsule, id, mutation, number, query, string, table, userId } from "@spacefast/zero/server";
import type { ActionServerContext, QueryServerContext, ReadDatabaseOf, ServerContext, WriteDatabaseOf } from "@spacefast/zero/server";

import {
  ACK_MAX,
  ACTIVE_SCAN_MAX,
  FINISHED_TTL_MS,
  FINISH_DELETE_MAX,
  INBOX_TAKE,
  MAX_ACTIVE_MATCHES,
  MESSAGE_TTL_MS,
  MY_MATCHES_MAX,
  OPEN_TTL_MS,
  PENDING_MAX,
  PLAYING_TTL_MS,
  SLOW_DOWN,
  SWEEP_MAX,
  abandonPlan,
  bucketAllows,
  callerId,
  chunkAt,
  countActive,
  deckFormat,
  deny,
  inboxRole,
  inboxView,
  isDeckKey,
  isInviteCode,
  isInviteHash,
  isMatchId,
  isMessageKind,
  isNonce,
  isPlayingHost,
  isSeq,
  isStoredText,
  isVersion,
  isWinner,
  joinAllowed,
  joinVerdict,
  matchView,
  myMatchesView,
  nextSeq,
  otherMember,
  parseWrites,
  playingRole,
  sanitizeNickname,
  saveAllowed,
  withJoinFailure,
  withWrite,
  type JoinResult,
  type MatchRow,
} from "../shared/rules";

// Field notes. players.writes: JSON array of recent write times in ms (failed join attempts stored negated), at most
// 40 entries. matches.format is derived from hostDeck; matches.msgSeq is the highest message number handed out in
// the match, so numbers keep growing after acknowledged messages are deleted. messages.nonce is the sender's optional
// idempotency key, so a retried sendMessage whose first response was lost does not store the message twice.
// Strings are length-checked in handlers.
//
// Lock order inside a mutation: the match row first, then the caller's players row.
const schema = {
  players: table({
    userId: userId(),
    nickname: string(),
    writes: string(),
  }).index("by_user", ["userId"]),
  matches: table({
    hostId: userId(),
    guestId: userId().optional(),
    hostNick: string(),
    guestNick: string().optional(),
    inviteHash: string().optional(),
    hostDeck: string(),
    guestDeck: string().optional(),
    format: string(),
    status: string(),
    winner: string().optional(),
    lastMoveAt: number(),
    expiresAt: number(),
    msgSeq: number().default(0),
  })
    .index("by_host", ["hostId"])
    .index("by_guest", ["guestId"])
    .index("by_host_status", ["hostId", "status"])
    .index("by_guest_status", ["guestId", "status"])
    .index("by_invite", ["inviteHash"])
    .index("by_status_expiry", ["status", "expiresAt"]),
  messages: table({
    matchId: id("matches"),
    toId: userId(),
    fromRole: string(),
    seq: number(),
    kind: string(),
    payload: string(),
    expiresAt: number(),
    nonce: string().optional(),
  }).index("by_match_to_seq", ["matchId", "toId", "seq"]),
  states: table({
    matchId: id("matches"),
    hostState: string(),
    guestView: string(),
    version: number(),
  }).index("by_match", ["matchId"]),
};

type Definition = { schema: typeof schema };
type ReadDb = ReadDatabaseOf<Definition>;
type WriteDb = WriteDatabaseOf<Definition>;
type QueryCtx = QueryServerContext<ReadDb>;
type MutationCtx = ServerContext<WriteDb>;
type ActionCtx = ActionServerContext<ReadDb>;
type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

/** The caller's user id: signed in, or a named `sf dev ?guest=` player when ALLOW_DEV_GUESTS is '1'. */
function me(ctx: AnyCtx): string | null {
  return callerId(ctx.auth, ctx.env.ALLOW_DEV_GUESTS);
}
function meOrDeny(ctx: AnyCtx): string {
  const uid = me(ctx);
  if (!uid) throw deny();
  return uid;
}

function asMatch(row: unknown): MatchRow | null {
  return (row as MatchRow | null) ?? null;
}

async function playerOf(ctx: AnyCtx, uid: string) {
  return ctx.db.players.withIndex("by_user", (q) => q.eq("userId", uid)).first();
}

/**
 * The caller's players row under its row lock, re-read after the lock, or null without a nickname. Rate-limit
 * decisions use this row, so parallel calls (in different matches) wait for each other instead of each passing on a
 * stale write log and overwriting the others' entries.
 */
async function lockPlayer(ctx: MutationCtx, uid: string) {
  const found = await playerOf(ctx, uid);
  if (!found) return null;
  try {
    await ctx.db.players.update(found.id, {});
  } catch {
    // A runtime that refuses an empty patch still gets the re-read below, only without the lock.
  }
  return (await ctx.db.players.get(found.id)) ?? found;
}

/** Spends one write from the caller's bucket (a row from lockPlayer), or throws "slow down". */
async function spendWrite(ctx: MutationCtx, player: { id: string; writes: string }, now: number) {
  const writes = parseWrites(player.writes);
  if (!bucketAllows(writes, now)) throw new Error(SLOW_DOWN);
  await ctx.db.players.update(player.id, { writes: JSON.stringify(withWrite(writes, now)) });
}

/** Takes the match row lock (an UPDATE as the first statement), then re-reads the row explicitly. */
async function lockMatch(ctx: MutationCtx, matchId: string, now: number): Promise<MatchRow | null> {
  if (!(await ctx.db.matches.update(matchId, { lastMoveAt: now }))) return null;
  return asMatch(await ctx.db.matches.get(matchId));
}

/** Deletes a match's saved state and messages: all of them, or only those addressed to `onlyToId`. Bounded. */
async function deleteMatchData(ctx: MutationCtx, matchId: string, onlyToId: string | null) {
  const states = await ctx.db.states.withIndex("by_match", (q) => q.eq("matchId", matchId)).take(5);
  for (const s of states) await ctx.db.states.delete(s.id);
  const messages = await ctx.db.messages
    .withIndex("by_match_to_seq", (q) => (onlyToId ? q.eq("matchId", matchId).eq("toId", onlyToId) : q.eq("matchId", matchId)))
    .take(FINISH_DELETE_MAX);
  for (const msg of messages) await ctx.db.messages.delete(msg.id);
}

/**
 * A bounded clean-up: up to SWEEP_MAX expired matches of any status (with their saved state and messages), then up
 * to SWEEP_MAX expired messages (all messages share one TTL, so the oldest ones expire first). Messages a swept match
 * still had beyond the per-match bound are expired already or soon will be, and go with the message sweep.
 */
async function sweepExpired(ctx: MutationCtx, now: number) {
  let budget = SWEEP_MAX;
  for (const status of ["open", "done", "abandoned", "playing"]) {
    if (budget <= 0) break;
    const expired = await ctx.db.matches
      .withIndex("by_status_expiry", (q) => q.eq("status", status).lt("expiresAt", now))
      .take(budget);
    for (const m of expired) {
      if (status !== "open") await deleteMatchData(ctx, m.id, null);
      await ctx.db.matches.delete(m.id);
      budget--;
    }
  }
  const oldest = await ctx.db.messages.withIndex("by_creation").order("asc").take(SWEEP_MAX);
  for (const msg of oldest) if (msg.expiresAt <= now) await ctx.db.messages.delete(msg.id);
}

/** The caller's open and playing games, by status, however old (a guest is never in an open game). */
async function activeMatchesOf(ctx: AnyCtx, uid: string): Promise<MatchRow[]> {
  const rows = [
    ...(await ctx.db.matches.withIndex("by_host_status", (q) => q.eq("hostId", uid).eq("status", "open")).take(ACTIVE_SCAN_MAX)),
    ...(await ctx.db.matches.withIndex("by_host_status", (q) => q.eq("hostId", uid).eq("status", "playing")).take(ACTIVE_SCAN_MAX)),
    ...(await ctx.db.matches.withIndex("by_guest_status", (q) => q.eq("guestId", uid).eq("status", "playing")).take(ACTIVE_SCAN_MAX)),
  ];
  return rows.map((r) => r as MatchRow);
}

/** My games: every open and playing game, plus the newest ones of any status to fill the list. */
async function myMatchRows(ctx: AnyCtx, uid: string): Promise<MatchRow[]> {
  const hosted = await ctx.db.matches.withIndex("by_host", (q) => q.eq("hostId", uid)).order("desc").take(MY_MATCHES_MAX);
  const joined = await ctx.db.matches.withIndex("by_guest", (q) => q.eq("guestId", uid)).order("desc").take(MY_MATCHES_MAX);
  return [...(await activeMatchesOf(ctx, uid)), ...hosted.map((r) => r as MatchRow), ...joined.map((r) => r as MatchRow)];
}

export default capsule({
  name: "Pokémon TCG Academy · Versus",
  schema,
  queries: {
    myProfile: query(async (ctx: QueryCtx) => {
      const uid = me(ctx);
      if (!uid) return null;
      const player = await playerOf(ctx, uid);
      return { nickname: player ? player.nickname : null };
    }),

    myMatches: query(async (ctx: QueryCtx) => {
      const uid = me(ctx);
      if (!uid) return [];
      return myMatchesView(await myMatchRows(ctx, uid), uid, Date.now());
    }),

    match: query(async (ctx: QueryCtx, matchId: string) => {
      if (!isMatchId(matchId)) return null;
      const uid = me(ctx);
      if (!uid) return null;
      return matchView(asMatch(await ctx.db.matches.get(matchId)), uid, Date.now());
    }),

    // Members of a started match read their own messages, also after the game ended: the last relay batch sent
    // before finishMatch stays here until it expires or is acknowledged.
    inbox: query(async (ctx: QueryCtx, matchId: string, afterSeq: number) => {
      if (!isMatchId(matchId) || !isSeq(afterSeq)) return [];
      const uid = me(ctx);
      if (!uid) return [];
      const now = Date.now();
      if (!inboxRole(asMatch(await ctx.db.matches.get(matchId)), uid, now)) return [];
      const rows = await ctx.db.messages
        .withIndex("by_match_to_seq", (q) => q.eq("matchId", matchId).eq("toId", uid).gt("seq", afterSeq))
        .order("asc")
        .take(INBOX_TAKE);
      return inboxView(rows, uid, afterSeq, now);
    }),
  },

  mutations: {
    setNickname: mutation(async (ctx: MutationCtx, nickname: string) => {
      const uid = meOrDeny(ctx);
      const clean = sanitizeNickname(nickname);
      if (!clean) throw new Error("invalid nickname");
      const now = Date.now();
      const player = await lockPlayer(ctx, uid);
      if (player) {
        await spendWrite(ctx, player, now);
        await ctx.db.players.update(player.id, { nickname: clean });
      } else {
        await ctx.db.players.insert({ userId: uid, nickname: clean, writes: JSON.stringify([now]) });
      }
      ctx.invalidate("myProfile");
      return { nickname: clean };
    }),

    createMatch: mutation(async (ctx: MutationCtx, deck: string, inviteHash: string) => {
      if (!isDeckKey(deck) || !isInviteHash(inviteHash)) throw deny();
      const uid = meOrDeny(ctx);
      const now = Date.now();
      // The player lock comes first, so parallel creates wait here and then count each other's games.
      const player = await lockPlayer(ctx, uid);
      if (!player) throw new Error("nickname required");
      await spendWrite(ctx, player, now);
      if (countActive(await activeMatchesOf(ctx, uid), now) >= MAX_ACTIVE_MATCHES) throw new Error("too many games");
      if (await ctx.db.matches.withIndex("by_invite", (q) => q.eq("inviteHash", inviteHash)).first()) throw deny();
      await sweepExpired(ctx, now);
      const created = await ctx.db.matches.insert({
        hostId: uid,
        hostNick: player.nickname,
        inviteHash,
        hostDeck: deck,
        format: deckFormat(deck)!,
        status: "open",
        lastMoveAt: now,
        expiresAt: now + OPEN_TTL_MS,
        msgSeq: 0,
      });
      ctx.invalidate("match", "myMatches");
      return { id: created.id };
    }),

    // Failures return { id: null, error } instead of throwing, so the failed-attempt count commits and the page can
    // tell a deck of the wrong format from a dead link. The page trusts only the match query afterwards.
    joinMatch: mutation(async (ctx: MutationCtx, code: string, deck: string): Promise<JoinResult> => {
      if (!isInviteCode(code) || !isDeckKey(deck)) throw deny();
      const uid = meOrDeny(ctx);
      // A refused join still commits (the failed-attempt count), and must not refresh every live query.
      ctx.invalidate("__none");
      const now = Date.now();
      const hash = await ctx.crypto.sha256(code);
      const found = await ctx.db.matches.withIndex("by_invite", (q) => q.eq("inviteHash", hash)).first();
      // Row lock first, then the explicit re-read: a second joiner waits here and then sees the first one's guestId.
      const match = found ? await lockMatch(ctx, found.id, now) : null;
      // Then the player lock (match row, then player row), so the attempt count and the game cap are exact.
      const player = await lockPlayer(ctx, uid);
      if (!player) throw new Error("nickname required");
      const writes = parseWrites(player.writes);
      if (!joinAllowed(writes, now)) return { id: null, error: "slow_down" };
      const verdict = joinVerdict(match, uid, deck, now);
      if (verdict === "wrong_format") return { id: null, error: "wrong_format", format: match!.format };
      if (verdict !== "ok") {
        await ctx.db.players.update(player.id, { writes: JSON.stringify(withJoinFailure(writes, now)) });
        return { id: null, error: "not_available" };
      }
      if (countActive(await activeMatchesOf(ctx, uid), now) >= MAX_ACTIVE_MATCHES) return { id: null, error: "too_many" };
      await ctx.db.matches.update(match!.id, {
        guestId: uid,
        guestNick: player.nickname,
        guestDeck: deck,
        inviteHash: null,
        status: "playing",
        expiresAt: now + PLAYING_TTL_MS,
      });
      await ctx.db.players.update(player.id, { writes: JSON.stringify(withWrite(writes, now)) });
      await sweepExpired(ctx, now);
      ctx.invalidate("match", "myMatches");
      return { id: match!.id };
    }),

    sendMessage: mutation(async (ctx: MutationCtx, matchId: string, kind: string, payload: string, nonce?: string | null) => {
      if (!isMatchId(matchId) || !isMessageKind(kind) || !isStoredText(payload)) throw deny();
      if (nonce !== undefined && nonce !== null && !isNonce(nonce)) throw deny();
      const uid = meOrDeny(ctx);
      const now = Date.now();
      // First statement: the match row lock, so concurrent senders take numbers one after another.
      const match = await lockMatch(ctx, matchId, now);
      const role = playingRole(match, uid, now);
      if (!match || !role) throw deny();
      const toId = otherMember(match, role);
      if (!toId) throw deny();
      const player = await lockPlayer(ctx, uid);
      if (!player) throw deny();
      await spendWrite(ctx, player, now);
      // A retry of a send that committed but whose response was lost: the newest message waiting for the other
      // player is this sender's (one send in flight per client), so a matching key means it is already stored.
      if (nonce) {
        const last = await ctx.db.messages
          .withIndex("by_match_to_seq", (q) => q.eq("matchId", matchId).eq("toId", toId))
          .order("desc")
          .first();
        if (last && last.nonce === nonce && last.fromRole === role) {
          ctx.invalidate("__none");
          return { seq: last.seq };
        }
      }
      // Keep the recipient's queue head clean: expired messages there would hide newer ones from inbox().
      const head = await ctx.db.messages
        .withIndex("by_match_to_seq", (q) => q.eq("matchId", matchId).eq("toId", toId))
        .order("asc")
        .take(SWEEP_MAX);
      for (const msg of head) if (msg.expiresAt <= now) await ctx.db.messages.delete(msg.id);
      // At most PENDING_MAX unacknowledged messages per recipient: a player who never acknowledges (or a second
      // account of the sender) cannot make the database grow beyond that.
      const pending = await ctx.db.messages.withIndex("by_match_to_seq", (q) => q.eq("matchId", matchId).eq("toId", toId)).count();
      if (pending >= PENDING_MAX) throw new Error(SLOW_DOWN);
      const seq = nextSeq(match.msgSeq);
      await ctx.db.messages.insert({
        matchId,
        toId,
        fromRole: role,
        seq,
        kind,
        payload,
        expiresAt: now + MESSAGE_TTL_MS,
        ...(nonce ? { nonce } : {}),
      });
      await ctx.db.matches.update(matchId, { msgSeq: seq });
      ctx.invalidate("inbox");
      return { seq };
    }),

    ackMessages: mutation(async (ctx: MutationCtx, matchId: string, uptoSeq: number) => {
      if (!isMatchId(matchId) || !isSeq(uptoSeq)) throw deny();
      const uid = meOrDeny(ctx);
      const now = Date.now();
      if (!inboxRole(asMatch(await ctx.db.matches.get(matchId)), uid, now)) throw deny();
      const player = await lockPlayer(ctx, uid);
      if (!player) throw deny();
      await spendWrite(ctx, player, now);
      const rows = await ctx.db.messages
        .withIndex("by_match_to_seq", (q) => q.eq("matchId", matchId).eq("toId", uid).lte("seq", uptoSeq))
        .order("asc")
        .take(ACK_MAX);
      let deleted = 0;
      for (const msg of rows) if (await ctx.db.messages.delete(msg.id)) deleted++;
      ctx.invalidate("__none");
      return { deleted };
    }),

    saveState: mutation(async (ctx: MutationCtx, matchId: string, hostState: string, guestView: string, version: number) => {
      if (!isMatchId(matchId) || !isStoredText(hostState) || !isStoredText(guestView) || !isVersion(version)) throw deny();
      const uid = meOrDeny(ctx);
      const now = Date.now();
      const match = await lockMatch(ctx, matchId, now);
      if (!isPlayingHost(match, uid, now)) throw deny();
      const player = await lockPlayer(ctx, uid);
      if (!player) throw deny();
      const stored = await ctx.db.states.withIndex("by_match", (q) => q.eq("matchId", matchId)).first();
      if (stored && version <= stored.version) throw new Error("stale version");
      if (stored && !saveAllowed(stored.updatedAt, now)) throw new Error(SLOW_DOWN);
      await spendWrite(ctx, player, now);
      // Each large string goes in an operation of its own: Zero caps one database operation at 64 KiB.
      if (stored) {
        await ctx.db.states.update(stored.id, { hostState });
        await ctx.db.states.update(stored.id, { guestView, version });
      } else {
        const row = await ctx.db.states.insert({ matchId, hostState, guestView: "", version });
        await ctx.db.states.update(row.id, { guestView });
      }
      await ctx.db.matches.update(matchId, { expiresAt: Math.max(match!.expiresAt, now + PLAYING_TTL_MS) });
      ctx.invalidate("__none");
      return { version };
    }),

    // The saved state and the host's own messages go now. Messages waiting for the guest (the host's last relay
    // batch) stay until the guest acknowledges them or they expire, so the guest sees the final moves.
    finishMatch: mutation(async (ctx: MutationCtx, matchId: string, winner: string) => {
      if (!isMatchId(matchId) || !isWinner(winner)) throw deny();
      const uid = meOrDeny(ctx);
      const now = Date.now();
      const match = await lockMatch(ctx, matchId, now);
      if (!isPlayingHost(match, uid, now)) throw deny();
      await ctx.db.matches.update(matchId, { status: "done", winner, expiresAt: now + FINISHED_TTL_MS });
      await deleteMatchData(ctx, matchId, uid);
      ctx.invalidate("match", "myMatches");
      return { ok: true as const };
    }),

    abandonMatch: mutation(async (ctx: MutationCtx, matchId: string) => {
      if (!isMatchId(matchId)) throw deny();
      const uid = meOrDeny(ctx);
      const now = Date.now();
      const match = await lockMatch(ctx, matchId, now);
      const plan = abandonPlan(match, uid, now);
      if (!plan) throw deny();
      if (plan.kind === "delete") {
        await ctx.db.matches.delete(matchId);
      } else {
        await ctx.db.matches.update(matchId, {
          status: "abandoned",
          winner: plan.winner,
          inviteHash: null,
          expiresAt: now + FINISHED_TTL_MS,
        });
        // The leaver's messages and the saved state go now; the opponent's pending messages expire on their own.
        await deleteMatchData(ctx, matchId, uid);
      }
      ctx.invalidate("match", "myMatches");
      return { ok: true as const };
    }),
  },

  actions: {
    // The saved state for the caller's side: hostState for the host, guestView for the guest. Zero caps an action
    // result at 48 KiB, so a long state comes in chunks: call again with `offset: next` until next is null.
    resume: action(async (ctx: ActionCtx, matchId: string, offset?: number) => {
      if (!isMatchId(matchId)) return null;
      const start = offset === undefined || offset === null ? 0 : offset;
      if (!isSeq(start)) return null;
      const uid = me(ctx);
      if (!uid) return null;
      const role = playingRole(asMatch(await ctx.db.matches.get(matchId)), uid, Date.now());
      if (!role) return null;
      const stored = await ctx.db.states.withIndex("by_match", (q) => q.eq("matchId", matchId)).first();
      if (!stored) return { role, version: 0, state: null, next: null };
      const chunk = chunkAt(role === "host" ? stored.hostState : stored.guestView, start);
      return { role, version: stored.version, state: chunk.text, next: chunk.next };
    }),
  },
});
