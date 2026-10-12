# Pokémon TCG Academy · Versus

The lobby for two-player games: sign-in, nicknames, private invites, the list of your games, and the relay that
carries messages between the two players. It is a Spacefast Zero app (`@spacefast/zero` 0.5.0).

The game itself does not run here. `/play` embeds the **game frame**, a page served from a different, cookie-free
origin (`https://pokemon-versus-play.space.fast/play/versus.html`, or `http://127.0.0.1:8791/play/versus.html` next
to a local lobby). The frame runs the rules engine and talks to the opponent's frame over WebRTC. This app only
signals the WebRTC connection, relays batched messages when a direct connection fails or is not wanted, keeps the
host's saved state, and records the result.

```
versus/
  sf.jsonc, theme.json      Zero app config; dark palette
  server/index.ts           tables, queries, mutations, the resume action
  shared/rules.ts           pure authorization, validation and rate-limit rules (unit-tested)
  shared/bridge.ts          the postMessage contract: parsing frame messages
  shared/retry.ts           retry policy for Zero calls
  shared/i18n.ts            every lobby string in EN, TR, JA, ES
  shared/config.ts          frame URLs
  shared/decks.ts           generated deck catalogue and server allowlist (node ../scripts/gen-versus-decks.mjs)
  client/                   layout, language store, deck picker, the game frame bridge
  pages/index.tsx           sign in, nickname, new game, invite link, waiting room, my games
  pages/join.tsx            join with an invite link
  pages/play.tsx            the game: opponent, IP notice, leave, the frame
  tests/rules.test.mjs      unit tests (rules and server handlers on an in-memory database)
```

## Local development

```sh
cd versus
npm install
cp .env.server.example .env.server        # ALLOW_DEV_GUESTS=1, local only
npx -y spacefast@0.5.0 dev                # or `sf dev` with a 0.5 CLI
```

`sf dev` prints a private URL (`http://127.0.0.1:4173/#zero-dev-capability=…`). Open it once to unlock the dev
server in that browser, then use two tabs as two players:

- `http://127.0.0.1:4173/?guest=alice`
- `http://127.0.0.1:4173/?guest=bob`

Alice creates a game. The waiting room shows the invite link and, on a local host, the same link for Bob
(`/join?guest=bob#<code>`). In-app links keep the `guest` parameter, so reloads stay the same player. Without
`ALLOW_DEV_GUESTS=1`, or without a `?guest=` name, the app treats you as signed out.

The game frame must be served at `http://127.0.0.1:8791/play/versus.html` (start it with the frame's own local
server). Without it the lobby still works; `/play` shows an empty frame.

State lives in memory and resets when `sf dev` restarts or reloads after a source change
(`--state-backend sqlite` keeps it). For scripted checks the dev server also answers
`POST /__zero/run?guest=<name>` with `{ "op": "mutation.run" | "query.run" | "action.run", "name", "args" }`.

Checks:

```sh
npx tsc --noEmit                          # types
node tests/rules.test.mjs                 # unit tests
node ../scripts/gen-versus-decks.mjs      # regenerate shared/decks.ts after deck changes
```

## Data

| Table | Fields | Notes |
| --- | --- | --- |
| players | userId, nickname, writes | `writes`: JSON array of recent write times (ms) for rate limiting; failed join attempts are stored negated; at most 40 entries |
| matches | hostId, guestId?, hostNick, guestNick?, inviteHash?, hostDeck, guestDeck?, format, status, winner?, lastMoveAt, expiresAt, msgSeq | status `open` → `playing` → `done` / `abandoned`; `msgSeq` is the highest message number handed out; extra indexes `by_host_status`, `by_guest_status` (My games and the 5-game cap read open and playing games however old) and `by_status_expiry` (the sweep) |
| messages | matchId, toId, fromRole, seq, kind, payload, expiresAt, nonce? | kept 10 minutes or until acknowledged; at most 64 waiting per recipient and match; `nonce` is the sender's optional idempotency key |
| states | matchId, hostState, guestView, version | one row per match while it is played |

`msgSeq` and `nonce` (and the indexes past `by_host`, `by_guest`, `by_invite`) go beyond the original table spec.

Every read drops rows past `expiresAt`: open matches 24 hours, games in play 30 days from the last save, finished and
abandoned games 7 days, messages 10 minutes. `createMatch` and `joinMatch` run a bounded sweep each time: up to 10
expired matches of any status (with their saved state and messages) and up to 10 expired messages.

## Server API

Queries return field allowlists and never user ids or the invite hash.

| Name | Returns |
| --- | --- |
| `myProfile()` | `null` (not signed in) or `{ nickname: string \| null }` |
| `myMatches()` | up to 20 of the caller's games, newest first: `{ id, role, status, myNick, oppNick, myDeck, oppDeck, format, lastMoveAt }`; `oppDeck` is null while open |
| `match(id)` | `null` or `{ id, role, status, hostNick, guestNick, hostDeck, guestDeck, format, winner }`; `guestDeck` is null while open |
| `inbox(id, afterSeq)` | the caller's messages with `seq > afterSeq`, ascending, at most 50 (fewer when payloads are large); for members of a game that has started, also after it ended, so the last moves sent before the end still arrive |

| Mutation | Who | Effect |
| --- | --- | --- |
| `setNickname(name)` | anyone signed in | trims, collapses spaces; letters, digits, space, `-` `_` `.`; 1–24 characters |
| `createMatch(deck, inviteHash)` | needs a nickname | open match, 24 h; at most 5 open or playing games per player. The lobby does not retry it: a lost answer would leave a game whose link can't be shown, so the player is sent to My games instead |
| `joinMatch(code, deck)` | needs a nickname | `{ id }`, or `{ id: null, error: "not_available" \| "wrong_format" \| "slow_down" \| "too_many", format? }`; the 5-game cap applies to the joiner too |
| `sendMessage(id, kind, payload, nonce?)` | either player, game in play | `{ seq }`; kind `offer`, `answer`, `bye` or `relay`. `slow down` when 64 messages already wait for the other player. `nonce` (optional, 8–32 base64url characters) makes a retry idempotent: if the newest waiting message carries the same key, its `seq` comes back and nothing is stored twice |
| `ackMessages(id, uptoSeq)` | either player, game started | deletes the caller's messages up to `uptoSeq`; counts against the write limit |
| `saveState(id, hostState, guestView, version)` | host, game in play | version must grow; about once a second |
| `finishMatch(id, winner)` | host, game in play | `done`, kept 7 days; deletes the saved state and the host's messages. Messages waiting for the guest stay until acknowledged or expired (10 minutes), so the guest gets the final moves |
| `abandonMatch(id)` | either player | open games are deleted; a game in play is `abandoned`, won by the other side and kept 7 days; the saved state and the leaver's messages are deleted |

Action: `resume(id, offset = 0)` → `null` or `{ role, version, state, next }`. The host gets `hostState`, the guest
`guestView` (`state` is null and `version` 0 before the first save). Long states come in pieces: call again with
`offset: next` until `next` is null, and start over if `version` changes.

Every refused read or write gives the same answer whatever the reason (signed out, not a member, unknown id,
expired, wrong status): queries return `null` or `[]`, mutations throw `not available`. Other errors are
`invalid nickname`, `nickname required`, `too many games`, `stale version` and `slow down`.

Rate limits and caps are decided on locked rows: a mutation locks the match row first (an UPDATE, then an explicit
re-read), then the caller's `players` row the same way, so parallel calls wait for each other instead of each
passing on a stale write log.

## The game frame bridge

The lobby posts to the frame with `targetOrigin` set to the frame origin and accepts a message only when
`event.origin` is the frame origin and `event.source` is the iframe's window. Every field is checked (type, enum,
length) before it is used; payloads are passed through, never read.

```html
<iframe src="{frameUrl}" title="Pokémon TCG Academy game" allow="clipboard-write" referrerpolicy="no-referrer"
  sandbox="allow-scripts allow-same-origin allow-popups" class="w-full" style="height: calc(100dvh - 120px); border: 0">
```

Lobby → frame:

| Message | When |
| --- | --- |
| `{ type: "init", role, matchId, decks: { host, guest }, nicks: { host, guest }, lang, relayOnly, resume: null \| { state, version } }` | after each `ready` once the game is in play and `resume()` has answered. A second `ready` (the frame reloaded) loads `resume()` again, after any save already on its way, so the frame never restarts from an older state |
| `{ type: "inbox", msgs: [{ seq, kind, payload }] }` | whenever the inbox query changes (the whole current result; the frame de-duplicates by `seq`) |
| `{ type: "status", status, winner }` | when the match status or winner changes |

Frame → lobby:

| Message | Lobby does |
| --- | --- |
| `{ type: "ready" }` | sends `init` |
| `{ type: "send", kind, payload }` | `sendMessage`, one at a time in order, retrying with jittered backoff (about 2 s after `slow down`); each message gets its own idempotency key, reused by its retries |
| `{ type: "ack", uptoSeq }` | `ackMessages` and moves the inbox subscription past `uptoSeq`, capped at the highest `seq` already posted to the frame |
| `{ type: "save", hostState, guestView, version }` | host only (ignored for the guest); only the latest pending save is sent, at most about once a second |
| `{ type: "over", winner }` | host only: `finishMatch`, once every queued `send` has gone out |
| `{ type: "leave" }` | goes to the lobby |

Size limits. `payload`, `hostState` and `guestView` may each be at most 60000 characters **and** at most 63 KiB once
JSON-encoded as UTF-8: Zero refuses any single database operation over 64 KiB, so text with many quotes,
backslashes or non-ASCII characters reaches that limit before 60000 characters. Larger messages are dropped with
a console warning naming only the message type. Keep relay batches and saved states well under the limit.

## Security and privacy

- **Identity.** Every handler resolves the caller with `me(ctx)`: a signed-in user, or a named `sf dev` guest when
  `ALLOW_DEV_GUESTS=1`. The protection on a live Space is that this variable is **never set there**. The Zero client
  forwards `?guest=` on every host, and nothing confirms how a hosted runtime names guests, so if the flag reached a
  Space anyone might act as any `guest:<name>`. The code also refuses `guest:local` and `guest:anon_…`, but that is
  defence in depth, not the safeguard. See Publishing.
- **Invites.** The browser makes a 128-bit code and sends only its SHA-256. The code travels in the URL fragment,
  which never reaches a server; the join page wipes it from the address bar at once and keeps it in memory (in this
  tab's sessionStorage only while the player signs in). A link works once and for 24 hours. Failed joins are
  limited to 10 per 10 minutes per player.
- **Joining twice at once.** `joinMatch` takes the match row lock (an UPDATE) before it re-reads and checks the row,
  so a second joiner sees the first one's seat and is refused.
- **Messages.** Only the two players can read a match, its inbox or its saved state, and only through these
  handlers. Writes (sends, acknowledgements, saves, nickname changes, new games) are limited to about 10 per second
  with bursts of 30 per player, at most 64 messages wait per recipient and match, and a player has at most 5 open or
  playing games, so one player cannot fill the database.
- **What stays outside that.** The Space is public, and Zero's realtime invalidation frames go to every connected
  client. They carry which queries and tables changed and the mutation's name, so any visitor can tell *when* games
  send messages, save or finish (never what they contain or who plays). The Space owner can read the database (for
  example `sf db dump`), including relayed messages for up to 10 minutes and the saved state of games in play. The
  lobby therefore says only that "only you and your opponent can see the game in this app".
- **IP addresses.** A direct WebRTC connection shows each player the other's IP address. "Don't share my IP" is on
  until the player turns it off (remembered in this browser), so the frame relays everything through this app and
  nothing connects directly before the player has chosen that.
- **Rendering.** Nicknames and every other user string render as text. Nothing uses `dangerouslySetInnerHTML`.

## Publishing

`sf publish` uploads `.env.server` as secret Space variables, and it only adds or updates them: deleting the file
after one publish does not remove a variable from the Space. So, every time:

1. Guard: `npm run check-publish` (in `versus/`) must pass. It fails while `.env.server` sets `ALLOW_DEV_GUESTS` at
   all; delete the file (or the line) before publishing.
2. From the repository root: `sf publish versus --space <spaceId>` (omit `--space` the first time to create a Space).
3. Check the Space: `sf env ls --space <spaceId>` must not list `ALLOW_DEV_GUESTS`. If it does, remove it with
   `sf env rm ALLOW_DEV_GUESTS --space <spaceId>` before sharing the link.
4. In the Space settings, turn on Spacefast Users with Google if you want "Continue with Google"; Spacefast accounts
   always work.
5. Serve the game frame at `https://pokemon-versus-play.space.fast/play/versus.html`, or change
   `shared/config.ts` to where it lives.
