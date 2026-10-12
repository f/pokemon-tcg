// Unit tests for the Versus lobby rules and server handlers.
//   node tests/rules.test.mjs        (from versus/)
// shared/*.ts and server/index.ts are bundled with the repo's esbuild. The server runs against an in-memory stand-in
// for the Zero database with the same index/range semantics; `@spacefast/zero/server` is replaced by a tiny shim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const require = createRequire(join(app, "..", "package.json"));
const esbuild = require("esbuild");

const SHIM = `
export const capsule = (d) => d;
export const query = (h) => h;
export const mutation = (h) => h;
export const action = (h) => h;
function field(kind) {
  const f = { kind, optional() { return { ...f, optionalValue: true }; }, default(v) { return { ...f, defaultValue: v }; } };
  return f;
}
export const string = () => field("string");
export const number = () => field("number");
export const boolean = () => field("boolean");
export const userId = () => field("userId");
export const id = (t) => ({ ...field("id"), refTable: t });
export const table = (fields) => {
  const t = { kind: "table", fields, indexes: [], index(name, fs) { t.indexes.push({ name, fields: fs }); return t; } };
  return t;
};
`;

const dir = await mkdtemp(join(tmpdir(), "versus-test-"));
await writeFile(join(dir, "zero-server-shim.mjs"), SHIM);
await writeFile(
  join(dir, "entry.ts"),
  `export * as rules from ${JSON.stringify(join(app, "shared/rules.ts"))};
export * as bridge from ${JSON.stringify(join(app, "shared/bridge.ts"))};
export * as retry from ${JSON.stringify(join(app, "shared/retry.ts"))};
export * as i18n from ${JSON.stringify(join(app, "shared/i18n.ts"))};
export * as config from ${JSON.stringify(join(app, "shared/config.ts"))};
export * as decks from ${JSON.stringify(join(app, "shared/decks.ts"))};
export { default as server } from ${JSON.stringify(join(app, "server/index.ts"))};
`,
);
await esbuild.build({
  entryPoints: [join(dir, "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: join(dir, "bundle.mjs"),
  alias: { "@spacefast/zero/server": join(dir, "zero-server-shim.mjs") },
  logLevel: "warning",
});
const { rules, bridge, retry, i18n, config, decks, server } = await import(pathToFileURL(join(dir, "bundle.mjs")).href);
await rm(dir, { recursive: true, force: true });

// ------------------------------------------------------------------ in-memory Zero database

let clock = Date.UTC(2026, 9, 12, 12, 0, 0);
const realNow = Date.now;
Date.now = () => clock;
const advance = (ms) => {
  clock += ms;
};

function cmp(a, b) {
  const na = a === undefined || a === null;
  const nb = b === undefined || b === null;
  if (na || nb) return na === nb ? 0 : na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function makeDb(schema) {
  const tables = {};
  let seq = 0;
  const api = {};
  for (const [name, def] of Object.entries(schema)) {
    tables[name] = new Map();
    const rows = tables[name];
    const clone = (r) => (r ? structuredClone(r) : null);
    const indexFields = (index) => {
      if (index === "by_creation") return [];
      const found = def.indexes.find((i) => i.name === index);
      if (!found) throw new Error(`Unknown index for ${name}: ${index}`);
      return found.fields;
    };
    api[name] = {
      async get(id) {
        return clone(rows.get(id));
      },
      async insert(value) {
        const row = {};
        for (const [f, spec] of Object.entries(def.fields)) {
          const v = value[f] === null ? undefined : value[f] ?? spec.defaultValue;
          if (v === undefined && !spec.optionalValue) throw new Error(`Field ${name}.${f} is required`);
          if (v !== undefined) row[f] = v;
        }
        for (const k of Object.keys(value)) if (!(k in def.fields)) throw new Error(`Unknown field ${name}.${k}`);
        const at = new Date(clock).toISOString().replace("Z", String(++seq).padStart(6, "0") + "Z");
        Object.assign(row, { id: `${name}_${seq}`, createdAt: at, updatedAt: new Date(clock).toISOString() });
        rows.set(row.id, row);
        return clone(row);
      },
      async update(id, patch) {
        const row = rows.get(id);
        if (!row) return null;
        for (const [k, v] of Object.entries(patch)) {
          if (!(k in def.fields)) throw new Error(`Unknown field ${name}.${k}`);
          if (v === null || v === undefined) delete row[k];
          else row[k] = v;
        }
        row.updatedAt = new Date(clock).toISOString();
        return clone(row);
      },
      async delete(id) {
        return rows.delete(id);
      },
      withIndex(index, range) {
        const fields = [...indexFields(index), "createdAt", "id"];
        const clauses = [];
        let pos = 0;
        const builder = {};
        for (const op of ["eq", "gt", "gte", "lt", "lte"]) {
          builder[op] = (field, value) => {
            if (field !== fields[pos] && !(clauses.length && clauses.at(-1).field === field)) {
              throw new Error(`Index ${name}.${index} expected ${fields[pos]}, received ${field}`);
            }
            clauses.push({ op, field, value });
            if (op === "eq") pos++;
            return builder;
          };
        }
        if (range) range(builder);
        let direction = "asc";
        const run = () => {
          const out = [...rows.values()].filter((r) =>
            clauses.every(({ op, field, value }) => {
              const c = cmp(r[field], value);
              return op === "eq" ? c === 0 : op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
            }),
          );
          out.sort((a, b) => {
            for (const f of fields) {
              const c = cmp(a[f], b[f]);
              if (c) return c;
            }
            return 0;
          });
          if (direction === "desc") out.reverse();
          return out.map(clone);
        };
        const q = {
          order(d) {
            direction = d;
            return q;
          },
          async collect() {
            return run();
          },
          async take(n) {
            return run().slice(0, n);
          },
          async first() {
            return run()[0] ?? null;
          },
          async count() {
            return run().length;
          },
        };
        return q;
      },
    };
  }
  return { api, tables };
}

const SCHEMA = server.schema;
let db;
let invalidations;
function reset() {
  db = makeDb(SCHEMA);
  invalidations = [];
}

const AUTH = {
  out: { userId: null, isSignedIn: false, isGuest: false, displayName: "" },
  local: { userId: "guest:local", isSignedIn: false, isGuest: true, displayName: "Guest" },
  anon: { userId: "guest:anon_0123456789abcdef0123456789abcdef", isSignedIn: false, isGuest: true, displayName: "Guest" },
};
const user = (id) => ({ userId: id, isSignedIn: true, isGuest: false, displayName: id });
const devGuest = (name) => ({ userId: `guest:${name}`, isSignedIn: false, isGuest: true, displayName: name });

function ctx(auth, env = {}) {
  return {
    auth,
    env,
    db: db.api,
    crypto: { sha256: async (s) => createHash("sha256").update(s, "utf8").digest("hex") },
    invalidate: (...names) => invalidations.push(names),
    log: { info() {}, warn() {}, error() {} },
  };
}
const as = (who) => ctx(typeof who === "string" ? user(who) : who);
const Q = (name, who, ...args) => server.queries[name](as(who), ...args);
const M = (name, who, ...args) => server.mutations[name](as(who), ...args);
const A = (name, who, ...args) => server.actions[name](as(who), ...args);

async function errorOf(promise) {
  try {
    await promise;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

function newInvite() {
  const code = rules.encodeInviteCode(randomBytes(16));
  return { code, hash: createHash("sha256").update(code).digest("hex") };
}

async function setupPlayers(...ids) {
  for (const id of ids) await M("setNickname", id, `${id} nick`);
}
async function openMatch(host = "host", deck = "ash") {
  const inv = newInvite();
  const { id } = await M("createMatch", host, deck, inv.hash);
  return { id, ...inv };
}
async function playingMatch(host = "host", guest = "guest", hostDeck = "ash", guestDeck = "brock") {
  const m = await openMatch(host, hostDeck);
  const joined = await M("joinMatch", guest, m.code, guestDeck);
  assert.equal(joined.id, m.id);
  return m;
}

// ------------------------------------------------------------------ identity

test("identity: signed-in users, named dev guests only with ALLOW_DEV_GUESTS=1, never hosted guests", () => {
  assert.equal(rules.callerId(user("u1"), undefined), "u1");
  assert.equal(rules.callerId(devGuest("alice"), "1"), "guest:alice");
  assert.equal(rules.callerId(devGuest("alice"), undefined), null);
  assert.equal(rules.callerId(devGuest("alice"), "0"), null);
  assert.equal(rules.callerId(devGuest("alice"), "true"), null);
  assert.equal(rules.callerId(AUTH.local, "1"), null, "guest:local is every signed-out visitor on a live Space");
  assert.equal(rules.callerId(AUTH.anon, "1"), null, "guest:anon_… is a per-request hosted guest");
  assert.equal(rules.callerId(AUTH.out, "1"), null);
  assert.equal(rules.callerId({ userId: "", isSignedIn: true, isGuest: false }, undefined), null);
  assert.equal(rules.isDevGuestId("guest:Bob.2"), true);
  assert.equal(rules.isDevGuestId("guest:"), false);
  assert.equal(rules.isDevGuestId("guest:ANON_x"), false);
  assert.equal(rules.isDevGuestId("user:alice"), false);
});

test("identity: dev guests reach the handlers only when the env flag is set", async () => {
  reset();
  const alice = devGuest("alice");
  assert.equal(await server.queries.myProfile(ctx(alice, {})), null);
  assert.deepEqual(await server.queries.myProfile(ctx(alice, { ALLOW_DEV_GUESTS: "1" })), { nickname: null });
  assert.equal(await server.queries.myProfile(ctx(AUTH.local, { ALLOW_DEV_GUESTS: "1" })), null);
  assert.equal(await errorOf(server.mutations.setNickname(ctx(AUTH.local, { ALLOW_DEV_GUESTS: "1" }), "x")), rules.DENIED);
});

// ------------------------------------------------------------------ generic denial

test("denial: every handler path gives outsiders the same answer, whatever the reason", async () => {
  reset();
  await setupPlayers("host", "guest", "eve");
  const open = await openMatch("host");
  const playing = await playingMatch("host", "guest");
  const done = await playingMatch("host", "guest", "misty", "brock");
  await M("finishMatch", "host", done.id, "host");
  const expired = await playingMatch("host", "guest", "zap", "brock");
  await db.api.matches.update(expired.id, { expiresAt: clock - 1 });

  const messages = new Set();
  const nulls = [];
  const empties = [];
  // [who, matchId]: outsider, signed out, hosted guest, missing id, malformed id, expired match.
  const callers = [
    ["eve", playing.id],
    [AUTH.out, playing.id],
    [AUTH.local, playing.id],
    ["eve", "matches_999999"],
    ["eve", { not: "a string" }],
    ["host", expired.id],
    ["guest", expired.id],
  ];
  for (const [who, id] of callers) {
    nulls.push(await Q("match", who, id));
    empties.push(await Q("inbox", who, id, 0));
    nulls.push(await A("resume", who, id));
    for (const [name, args] of [
      ["sendMessage", [id, "relay", "x"]],
      ["ackMessages", [id, 10]],
      ["saveState", [id, "a", "b", 99]],
      ["finishMatch", [id, "host"]],
      ["abandonMatch", [id]],
    ]) {
      messages.add(await errorOf(M(name, who, ...args)));
    }
  }
  // Wrong status for a member: sending into an open or finished game, saving or finishing as the guest.
  messages.add(await errorOf(M("sendMessage", "host", open.id, "relay", "x")));
  messages.add(await errorOf(M("sendMessage", "host", done.id, "relay", "x")));
  messages.add(await errorOf(M("saveState", "guest", playing.id, "a", "b", 1)));
  messages.add(await errorOf(M("finishMatch", "guest", playing.id, "guest")));
  messages.add(await errorOf(M("finishMatch", "host", done.id, "host")));
  messages.add(await errorOf(M("abandonMatch", "guest", done.id)));
  messages.add(await errorOf(M("ackMessages", "host", open.id, 1)));
  nulls.push(await A("resume", "host", open.id));
  empties.push(await Q("inbox", "host", open.id, 0));
  empties.push(await Q("inbox", "guest", done.id, 0));

  assert.deepEqual([...messages], [rules.DENIED], "one denial text for every refused write");
  assert.ok(nulls.every((v) => v === null), "reads of a match a caller cannot see are null");
  assert.ok(empties.every((v) => Array.isArray(v) && v.length === 0), "inbox reads are []");
  assert.deepEqual(await Q("myMatches", "eve"), []);
  assert.deepEqual(await Q("myMatches", AUTH.out), []);
  assert.equal(await Q("myProfile", AUTH.out), null);
});

test("denial: arguments of the wrong type are refused before any lookup", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  for (const bad of [undefined, null, 1, [], {}, "x".repeat(65), "a b", "../x"]) {
    assert.equal(await Q("match", "host", bad), null);
    assert.deepEqual(await Q("inbox", "host", bad, 0), []);
    assert.equal(await errorOf(M("sendMessage", "host", bad, "relay", "x")), rules.DENIED);
  }
  for (const seq of [-1, 1.5, "3", NaN, Infinity, null]) assert.deepEqual(await Q("inbox", "guest", m.id, seq), []);
  assert.equal(await errorOf(M("sendMessage", "host", m.id, "evil", "x")), rules.DENIED);
  assert.equal(await errorOf(M("sendMessage", "host", m.id, "relay", { toString: () => "x" })), rules.DENIED);
  assert.equal(await errorOf(M("saveState", "host", m.id, "a", "b", 0)), rules.DENIED);
  assert.equal(await errorOf(M("saveState", "host", m.id, "a", "b", 1.5)), rules.DENIED);
  assert.equal(await errorOf(M("finishMatch", "host", m.id, "nobody")), rules.DENIED);
  assert.equal(await errorOf(M("createMatch", "host", "ash", "ABC")), rules.DENIED);
  assert.equal(await errorOf(M("joinMatch", "guest", "short", "ash")), rules.DENIED);
});

test("projections never carry user ids or the invite hash", async () => {
  reset();
  await M("setNickname", "host-secret-id", "Hana");
  await M("setNickname", "guest-secret-id", "Gus");
  const m = await openMatch("host-secret-id");
  const openView = JSON.stringify([await Q("match", "host-secret-id", m.id), await Q("myMatches", "host-secret-id")]);
  assert.ok(!openView.includes("secret-id"));
  assert.ok(!openView.includes(m.hash));
  await M("joinMatch", "guest-secret-id", m.code, "brock");
  for (const who of ["host-secret-id", "guest-secret-id"]) {
    const s = JSON.stringify([await Q("match", who, m.id), await Q("myMatches", who), await A("resume", who, m.id)]);
    assert.ok(!s.includes("secret-id"), s);
  }
  const view = await Q("match", "host-secret-id", m.id);
  assert.deepEqual(Object.keys(view).sort(), ["format", "guestDeck", "guestNick", "hostDeck", "hostNick", "id", "role", "status", "winner"]);
  const item = (await Q("myMatches", "guest-secret-id"))[0];
  assert.deepEqual(Object.keys(item).sort(), ["format", "id", "lastMoveAt", "myDeck", "myNick", "oppDeck", "oppNick", "role", "status"]);
});

test("the opponent's deck stays hidden while a match is open", async () => {
  reset();
  await setupPlayers("host");
  const m = await openMatch("host");
  await db.api.matches.update(m.id, { guestDeck: "brock" });
  assert.equal((await Q("match", "host", m.id)).guestDeck, null);
  assert.equal((await Q("myMatches", "host"))[0].oppDeck, null);
});

// ------------------------------------------------------------------ joining

test("join: the host cannot join their own match; failures are generic", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await openMatch("host");
  invalidations = [];
  assert.deepEqual(await M("joinMatch", "host", m.code, "brock"), { id: null, error: "not_available" });
  assert.deepEqual(invalidations, [["__none"]], "a refused join refreshes nothing");
  assert.deepEqual(await M("joinMatch", "guest", newInvite().code, "brock"), { id: null, error: "not_available" });
  assert.equal((await Q("match", "host", m.id)).status, "open");
});

test("join: success fills the guest seat, clears the invite and extends the expiry", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await openMatch("host");
  const before = (await db.api.matches.get(m.id)).expiresAt;
  assert.equal(before, clock + rules.OPEN_TTL_MS);
  invalidations = [];
  assert.deepEqual(await M("joinMatch", "guest", m.code, "brock"), { id: m.id });
  const row = await db.api.matches.get(m.id);
  assert.equal(row.status, "playing");
  assert.equal(row.guestId, "guest");
  assert.equal(row.guestNick, "guest nick");
  assert.equal(row.guestDeck, "brock");
  assert.equal(row.inviteHash, undefined);
  assert.equal(row.expiresAt, clock + rules.PLAYING_TTL_MS);
  assert.deepEqual(invalidations, [["__none"], ["match", "myMatches"]]);
  assert.equal(await db.api.matches.withIndex("by_invite", (q) => q.eq("inviteHash", m.hash)).first(), null);
  assert.deepEqual(await M("joinMatch", "guest", m.code, "brock"), { id: null, error: "not_available" }, "a link works once");
});

test("join race: a second joiner holding a stale read loses after the row lock", async () => {
  reset();
  await setupPlayers("host", "first", "second");
  const m = await openMatch("host");
  const stale = await db.api.matches.get(m.id);
  // The second joiner's by_invite read happened before the first joiner committed (a consistent read), but its
  // UPDATE takes the row lock and its re-read sees the committed row: model exactly that.
  const original = db.api.matches.withIndex;
  let served = false;
  db.api.matches.withIndex = function (index, range) {
    if (index === "by_invite" && !served) {
      served = true;
      return { first: async () => structuredClone(stale), take: async () => [structuredClone(stale)], order() { return this; } };
    }
    return original.call(this, index, range);
  };
  assert.deepEqual(await M("joinMatch", "first", m.code, "brock"), { id: m.id }, "first joiner, fresh read");
  served = false;
  const result = await M("joinMatch", "second", m.code, "misty");
  db.api.matches.withIndex = original;
  assert.deepEqual(result, { id: null, error: "not_available" });
  const row = await db.api.matches.get(m.id);
  assert.equal(row.guestId, "first");
  assert.equal(row.guestDeck, "brock");
  assert.equal(await Q("match", "second", m.id), null);
});

test("join verdict (pure): the re-read row decides", () => {
  const now = clock;
  const base = { id: "m1", hostId: "h", hostNick: "H", hostDeck: "ash", format: "classic", status: "open", lastMoveAt: now, expiresAt: now + 1000 };
  assert.equal(rules.joinVerdict(base, "g", "brock", now), "ok");
  assert.equal(rules.joinVerdict({ ...base, guestId: "x" }, "g", "brock", now), "not_available");
  assert.equal(rules.joinVerdict({ ...base, status: "playing" }, "g", "brock", now), "not_available");
  assert.equal(rules.joinVerdict({ ...base, expiresAt: now }, "g", "brock", now), "not_available");
  assert.equal(rules.joinVerdict(base, "h", "brock", now), "not_available");
  assert.equal(rules.joinVerdict(null, "g", "brock", now), "not_available");
  assert.equal(rules.joinVerdict(base, "g", "c30-espeon", now), "wrong_format");
});

test("join: a deck of the other format is refused without spending the link or a failed attempt", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await openMatch("host", "ash");
  assert.deepEqual(await M("joinMatch", "guest", m.code, "c30-espeon"), { id: null, error: "wrong_format", format: "classic" });
  const player = await db.api.players.withIndex("by_user", (q) => q.eq("userId", "guest")).first();
  assert.equal(rules.recentJoinFailures(rules.parseWrites(player.writes), clock), 0);
  assert.deepEqual(await M("joinMatch", "guest", m.code, "brock"), { id: m.id });
});

test("join: 10 failed attempts per 10 minutes, then slow_down until the window passes", async () => {
  reset();
  await setupPlayers("host", "eve");
  const m = await openMatch("host");
  for (let i = 0; i < rules.JOIN_FAIL_LIMIT; i++) {
    assert.deepEqual(await M("joinMatch", "eve", newInvite().code, "brock"), { id: null, error: "not_available" });
    advance(1000);
  }
  assert.deepEqual(await M("joinMatch", "eve", m.code, "brock"), { id: null, error: "slow_down" }, "even a valid code waits");
  assert.equal((await Q("match", "host", m.id)).status, "open");
  advance(rules.JOIN_FAIL_WINDOW_MS);
  assert.deepEqual(await M("joinMatch", "eve", m.code, "brock"), { id: m.id });
});

test("join: needs a nickname; expired open matches cannot be joined", async () => {
  reset();
  await setupPlayers("host");
  const m = await openMatch("host");
  assert.equal(await errorOf(M("joinMatch", "nobody", m.code, "brock")), "nickname required");
  await setupPlayers("guest");
  advance(rules.OPEN_TTL_MS + 1);
  assert.deepEqual(await M("joinMatch", "guest", m.code, "brock"), { id: null, error: "not_available" });
  assert.deepEqual(await Q("myMatches", "host"), [], "expired open matches drop out of My games");
});

// ------------------------------------------------------------------ nicknames, decks, formats

test("nicknames: trimmed, spaces collapsed, letters/digits/space/-/_/. only, 1–24 characters", () => {
  assert.equal(rules.sanitizeNickname("  Ash   Ketchum "), "Ash Ketchum");
  assert.equal(rules.sanitizeNickname("Çağrı_99"), "Çağrı_99");
  assert.equal(rules.sanitizeNickname("ボブ"), "ボブ");
  assert.equal(rules.sanitizeNickname("José-María.2"), "José-María.2");
  assert.equal(rules.sanitizeNickname("x".repeat(24)), "x".repeat(24));
  for (const bad of ["", "   ", "x".repeat(25), "<b>", "a&b", "hi!", "emoji 🎴", "tab\u0000", "___", "..", 42, null, undefined, {}]) {
    assert.equal(rules.sanitizeNickname(bad), null, JSON.stringify(bad));
  }
  assert.equal(rules.sanitizeNickname("é"), "é", "NFC first");
});

test("nicknames: the mutation stores the cleaned name and refuses the rest", async () => {
  reset();
  assert.deepEqual(await M("setNickname", "u", "  Red   Blue "), { nickname: "Red Blue" });
  assert.deepEqual(await Q("myProfile", "u"), { nickname: "Red Blue" });
  assert.equal(await errorOf(M("setNickname", "u", "<img src=x>")), "invalid nickname");
  assert.equal(await errorOf(M("setNickname", "u", ["Red"])), "invalid nickname");
  assert.deepEqual(await M("setNickname", "u", "Green"), { nickname: "Green" });
  assert.equal(db.tables.players.size, 1);
});

test("decks: the allowlist is own keys only and every deck has a format and an https image", () => {
  for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "", "ASH", "ash ", "nope"]) {
    assert.equal(rules.isDeckKey(key), false, key);
  }
  const keys = Object.keys(decks.DECKS);
  assert.ok(keys.length >= 100);
  assert.deepEqual([...decks.CLASSIC_DECKS, ...decks.MODERN_DECKS].sort(), keys.sort());
  for (const key of keys) {
    const d = decks.DECKS[key];
    assert.ok(rules.isDeckKey(key));
    assert.ok(d.format === "classic" || d.format === "modern");
    assert.match(d.img, /^https:\/\/[a-z0-9.-]+\/\S+$/);
    assert.ok(!d.img.includes("img/cards"), `${key} points at a local path`);
    assert.ok(d.name && d.types.length);
  }
  assert.equal(rules.deckFormat("ash"), "classic");
  assert.equal(rules.deckFormat("c30-espeon"), "modern");
  assert.equal(rules.deckFormat("__proto__"), null);
});

test("createMatch: deck allowlist, format from the deck, nickname and 5 active matches", async () => {
  reset();
  assert.equal(await errorOf(M("createMatch", "host", "ash", newInvite().hash)), "nickname required");
  await setupPlayers("host");
  assert.equal(await errorOf(M("createMatch", "host", "__proto__", newInvite().hash)), rules.DENIED);
  assert.equal(await errorOf(M("createMatch", "host", "ash", newInvite().hash.toUpperCase())), rules.DENIED);
  const modern = await openMatch("host", "c30-espeon");
  assert.equal((await Q("match", "host", modern.id)).format, "modern");
  assert.equal(await errorOf(M("createMatch", "host", "ash", modern.hash)), rules.DENIED, "hash collisions are refused");
  for (let i = 0; i < 4; i++) await openMatch("host", "ash");
  assert.equal(await errorOf(M("createMatch", "host", "ash", newInvite().hash)), "too many games");
  await M("abandonMatch", "host", modern.id);
  await openMatch("host", "ash");
  const row = [...db.tables.matches.values()].at(-1);
  assert.equal(row.status, "open");
  assert.equal(row.expiresAt, clock + rules.OPEN_TTL_MS);
  assert.equal(row.lastMoveAt, clock);
  assert.equal(row.format, "classic");
});

// ------------------------------------------------------------------ sizes

test("sizes: 60000 characters at most, and never more than one database operation holds", () => {
  assert.equal(rules.isStoredText("x".repeat(60000)), true);
  assert.equal(rules.isStoredText("x".repeat(60001)), false);
  assert.equal(rules.isStoredText("ゲ".repeat(21000)), true, "63 KB of UTF-8");
  assert.equal(rules.isStoredText("ゲ".repeat(22000)), false, "66 KB of UTF-8");
  assert.equal(rules.isStoredText('"'.repeat(32000)), true);
  assert.equal(rules.isStoredText('"'.repeat(33000)), false, "JSON escaping doubles quotes");
  assert.equal(rules.isStoredText(""), true);
  assert.equal(rules.isStoredText(1), false);
  assert.equal(rules.utf8Length("aé€😀"), 1 + 2 + 3 + 4);
  assert.equal(rules.utf8Length("\ud800x"), 4, "a lone surrogate counts as 3 bytes");
});

test("sizes: oversized payloads and states are refused by the handlers", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  assert.equal(await errorOf(M("sendMessage", "host", m.id, "relay", "x".repeat(60001))), rules.DENIED);
  assert.deepEqual(await M("sendMessage", "host", m.id, "relay", "x".repeat(60000)), { seq: 1 });
  assert.equal(await errorOf(M("saveState", "host", m.id, "x".repeat(60001), "", 1)), rules.DENIED);
  assert.equal(await errorOf(M("saveState", "host", m.id, "", "ゲ".repeat(22000), 1)), rules.DENIED);
});

// ------------------------------------------------------------------ rate limits

test("rate limit (pure): a bucket of 30, refilled at 10 per second", () => {
  const now = clock;
  let writes = [];
  for (let i = 0; i < 30; i++) {
    assert.ok(rules.bucketAllows(writes, now), `write ${i + 1}`);
    writes = rules.withWrite(writes, now);
  }
  assert.equal(rules.bucketAllows(writes, now), false, "the 31st write in the same instant");
  assert.equal(rules.bucketAllows(writes, now + 99), false);
  assert.equal(rules.bucketAllows(writes, now + 100), true, "one token after 100 ms");
  // Ten writes a second can go on for ever.
  let t = now + 10_000;
  writes = [];
  for (let i = 0; i < 200; i++) {
    assert.ok(rules.bucketAllows(writes, t));
    writes = rules.withWrite(writes, t);
    t += 100;
  }
  assert.ok(writes.length <= rules.WRITES_CAP);
});

test("rate limit (pure): the write log is capped and keeps recent failed joins", () => {
  const now = clock;
  let w = [];
  for (let i = 0; i < 5; i++) w = rules.withJoinFailure(w, now - i);
  for (let i = 0; i < 100; i++) w = rules.withWrite(w, now + i);
  assert.equal(w.length, rules.WRITES_CAP);
  assert.equal(rules.recentJoinFailures(w, now + 100), 5);
  assert.equal(rules.recentJoinFailures(w, now + rules.JOIN_FAIL_WINDOW_MS + 10), 0);
  assert.deepEqual(rules.parseWrites("not json"), []);
  assert.deepEqual(rules.parseWrites(JSON.stringify([1, "x", null, 2, Infinity, 0])), [1, 2]);
  assert.deepEqual(rules.parseWrites(JSON.stringify({ a: 1 })), []);
});

test("rate limit: sendMessage allows a burst of 30 and then says slow down", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  advance(10_000);
  for (let i = 0; i < 30; i++) await M("sendMessage", "host", m.id, "relay", `m${i}`);
  assert.equal(await errorOf(M("sendMessage", "host", m.id, "relay", "one too many")), rules.SLOW_DOWN);
  advance(200);
  assert.deepEqual(await M("sendMessage", "host", m.id, "relay", "later"), { seq: 31 }, "the refused write took no number");
});

test("rate limit: saveState about once a second, versions only go up", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  assert.deepEqual(await M("saveState", "host", m.id, "h1", "g1", 1), { version: 1 });
  assert.equal(await errorOf(M("saveState", "host", m.id, "h2", "g2", 2)), rules.SLOW_DOWN);
  advance(rules.SAVE_MIN_INTERVAL_MS);
  assert.equal(await errorOf(M("saveState", "host", m.id, "old", "old", 1)), "stale version");
  assert.deepEqual(await M("saveState", "host", m.id, "h2", "g2", 2), { version: 2 });
  assert.equal(db.tables.states.size, 1, "one states row per match");
  const row = [...db.tables.states.values()][0];
  assert.equal(row.hostState, "h2");
  assert.equal(row.guestView, "g2");
  assert.equal(row.version, 2);
  assert.ok(rules.saveAllowed(null, clock));
  assert.ok(rules.saveAllowed("garbage", clock));
});

// ------------------------------------------------------------------ messages and seq

test("seq: one counter per match for both directions, inbox per recipient, ascending", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  invalidations = [];
  assert.deepEqual(await M("sendMessage", "host", m.id, "offer", "o"), { seq: 1 });
  assert.deepEqual(await M("sendMessage", "guest", m.id, "answer", "a"), { seq: 2 });
  assert.deepEqual(await M("sendMessage", "host", m.id, "relay", "r"), { seq: 3 });
  assert.deepEqual(invalidations, [["inbox"], ["inbox"], ["inbox"]]);
  assert.deepEqual(await Q("inbox", "guest", m.id, 0), [
    { seq: 1, kind: "offer", payload: "o" },
    { seq: 3, kind: "relay", payload: "r" },
  ]);
  assert.deepEqual(await Q("inbox", "host", m.id, 0), [{ seq: 2, kind: "answer", payload: "a" }]);
  assert.deepEqual(await Q("inbox", "guest", m.id, 1), [{ seq: 3, kind: "relay", payload: "r" }]);
  const stored = [...db.tables.messages.values()].find((r) => r.seq === 1);
  assert.equal(stored.fromRole, "host");
  assert.equal(stored.toId, "guest");
  assert.equal(stored.expiresAt, clock + rules.MESSAGE_TTL_MS);
});

test("seq: numbers keep growing after every message is acknowledged and deleted", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  for (let i = 0; i < 3; i++) await M("sendMessage", "host", m.id, "relay", `x${i}`);
  invalidations = [];
  assert.deepEqual(await M("ackMessages", "guest", m.id, 3), { deleted: 3 });
  assert.deepEqual(invalidations, [["__none"]]);
  assert.equal(db.tables.messages.size, 0);
  assert.deepEqual(await M("sendMessage", "guest", m.id, "relay", "y"), { seq: 4 });
  assert.deepEqual(await Q("inbox", "host", m.id, 3), [{ seq: 4, kind: "relay", payload: "y" }]);
  assert.equal(rules.nextSeq(0), 1);
  assert.equal(rules.nextSeq(7, 3), 8);
  assert.equal(rules.nextSeq(2, 9), 10);
  assert.equal(rules.nextSeq(undefined), 1);
});

test("ack: deletes only the caller's own messages up to the number given", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  await M("sendMessage", "host", m.id, "relay", "1");
  await M("sendMessage", "guest", m.id, "relay", "2");
  await M("sendMessage", "host", m.id, "relay", "3");
  assert.deepEqual(await M("ackMessages", "host", m.id, 99), { deleted: 1 }, "the host only had seq 2");
  assert.deepEqual(await M("ackMessages", "guest", m.id, 1), { deleted: 1 });
  assert.deepEqual((await Q("inbox", "guest", m.id, 0)).map((x) => x.seq), [3]);
});

test("inbox: expired messages are hidden and swept; results stay under the response cap", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  advance(10_000);
  await M("sendMessage", "host", m.id, "relay", "old");
  advance(rules.MESSAGE_TTL_MS + 1);
  assert.deepEqual(await Q("inbox", "guest", m.id, 0), []);
  await M("sendMessage", "host", m.id, "relay", "new");
  assert.deepEqual((await Q("inbox", "guest", m.id, 0)).map((x) => x.payload), ["new"]);
  assert.equal([...db.tables.messages.values()].some((r) => r.payload === "old"), false, "swept from the recipient's queue");

  const rows = Array.from({ length: 60 }, (_, i) => ({ toId: "g", seq: i + 1, kind: "relay", payload: "z".repeat(59_000), expiresAt: clock + 1 }));
  const capped = rules.inboxView(rows, "g", 0, clock);
  assert.ok(capped.length >= 1 && capped.length < 50);
  assert.ok(capped.reduce((n, r) => n + r.payload.length, 0) <= rules.INBOX_MAX_BYTES);
  assert.deepEqual(capped.map((r) => r.seq), capped.map((_, i) => i + 1));
  const small = rules.inboxView(rows.map((r) => ({ ...r, payload: "s" })), "g", 0, clock);
  assert.equal(small.length, rules.INBOX_TAKE);
  assert.deepEqual(rules.inboxView(rows, "other", 0, clock), []);
});

// ------------------------------------------------------------------ finishing, abandoning, resuming

test("finishMatch: host only; marks done, deletes the saved state and the host's messages, keeps the guest's last moves", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  await M("sendMessage", "guest", m.id, "relay", "to host");
  await M("sendMessage", "host", m.id, "relay", "final moves");
  await M("saveState", "host", m.id, "h", "g", 1);
  invalidations = [];
  assert.deepEqual(await M("finishMatch", "host", m.id, "draw"), { ok: true });
  assert.deepEqual(invalidations, [["match", "myMatches"]]);
  const view = await Q("match", "guest", m.id);
  assert.equal(view.status, "done");
  assert.equal(view.winner, "draw");
  assert.equal((await db.api.matches.get(m.id)).expiresAt, clock + rules.FINISHED_TTL_MS, "finished games stay 7 days");
  assert.equal(db.tables.states.size, 0);
  assert.deepEqual([...db.tables.messages.values()].map((r) => r.payload), ["final moves"], "only the guest's waiting messages stay");
  // The guest still reads and acknowledges the host's last batch after the game ended.
  assert.deepEqual(await Q("inbox", "guest", m.id, 0), [{ seq: 2, kind: "relay", payload: "final moves" }]);
  assert.deepEqual(await Q("inbox", "host", m.id, 0), []);
  assert.deepEqual(await M("ackMessages", "guest", m.id, 2), { deleted: 1 });
  assert.equal(db.tables.messages.size, 0);
  // Sending stays closed.
  assert.equal(await errorOf(M("sendMessage", "host", m.id, "relay", "late")), rules.DENIED);
  assert.equal(await A("resume", "guest", m.id), null, "no resume once the game is over");
});

test("abandonMatch: open matches are deleted; a game in play goes to the other side", async () => {
  reset();
  await setupPlayers("host", "guest");
  const open = await openMatch("host");
  assert.deepEqual(await M("abandonMatch", "host", open.id), { ok: true });
  assert.equal(await db.api.matches.get(open.id), null);
  const m = await playingMatch();
  await M("saveState", "host", m.id, "h", "g", 1);
  await M("abandonMatch", "guest", m.id);
  const view = await Q("match", "host", m.id);
  assert.equal(view.status, "abandoned");
  assert.equal(view.winner, "host");
  assert.equal(db.tables.states.size, 0);
  const m2 = await playingMatch("host", "guest", "misty", "brock");
  await M("abandonMatch", "host", m2.id);
  assert.equal((await Q("match", "guest", m2.id)).winner, "guest");
});

test("abandonMatch: deletes the leaver's messages; the opponent's waiting ones stay; kept 7 days", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  await M("sendMessage", "host", m.id, "relay", "for guest");
  await M("sendMessage", "guest", m.id, "relay", "for host");
  await M("abandonMatch", "guest", m.id);
  assert.deepEqual([...db.tables.messages.values()].map((r) => r.payload), ["for host"]);
  assert.deepEqual((await Q("inbox", "host", m.id, 0)).map((x) => x.payload), ["for host"]);
  assert.equal((await db.api.matches.get(m.id)).expiresAt, clock + rules.FINISHED_TTL_MS);
});

test("pending cap: at most 64 messages wait for one recipient; acknowledging makes room", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  for (let i = 0; i < rules.PENDING_MAX; i++) {
    advance(200);
    await M("sendMessage", "host", m.id, "relay", `m${i}`);
  }
  advance(200);
  assert.equal(await errorOf(M("sendMessage", "host", m.id, "relay", "too many")), rules.SLOW_DOWN);
  assert.equal(db.tables.messages.size, rules.PENDING_MAX);
  // The cap is per recipient: the other direction still works.
  assert.deepEqual(await M("sendMessage", "guest", m.id, "relay", "reply"), { seq: rules.PENDING_MAX + 1 });
  advance(200);
  assert.deepEqual(await M("ackMessages", "guest", m.id, 10), { deleted: 10 });
  advance(200);
  assert.deepEqual(await M("sendMessage", "host", m.id, "relay", "room again"), { seq: rules.PENDING_MAX + 2 });
  // Expired messages free their places too.
  advance(rules.MESSAGE_TTL_MS + 1);
  for (let i = 0; i < 3; i++) {
    advance(200);
    await M("sendMessage", "host", m.id, "relay", `after ${i}`);
  }
});

test("nonce: a retried send with the same key is stored once and gets the same seq", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  assert.deepEqual(await M("sendMessage", "host", m.id, "relay", "a", "nonce-AAAA1111"), { seq: 1 });
  assert.deepEqual(await M("sendMessage", "host", m.id, "relay", "a", "nonce-AAAA1111"), { seq: 1 }, "retry");
  assert.equal(db.tables.messages.size, 1);
  assert.deepEqual(await M("sendMessage", "host", m.id, "relay", "b", "nonce-BBBB2222"), { seq: 2 });
  assert.deepEqual(await M("sendMessage", "host", m.id, "relay", "c"), { seq: 3 }, "the key is optional");
  assert.deepEqual(await M("sendMessage", "host", m.id, "relay", "c", null), { seq: 4 });
  // Another sender's key never matches this sender's message.
  assert.deepEqual(await M("sendMessage", "guest", m.id, "relay", "x", "nonce-BBBB2222"), { seq: 5 });
  for (const bad of ["short", "has space!", "x".repeat(33), 12345678, {}]) {
    assert.equal(await errorOf(M("sendMessage", "host", m.id, "relay", "d", bad)), rules.DENIED, JSON.stringify(bad));
  }
  assert.equal(rules.isNonce("abcdEFGH_-12"), true);
});

test("join: the 5-game cap applies to the joiner; the link stays usable", async () => {
  reset();
  await setupPlayers("host", "busy", "free");
  const m = await openMatch("host");
  const mine = [];
  for (let i = 0; i < rules.MAX_ACTIVE_MATCHES; i++) mine.push(await openMatch("busy"));
  assert.deepEqual(await M("joinMatch", "busy", m.code, "brock"), { id: null, error: "too_many" });
  assert.equal((await Q("match", "host", m.id)).status, "open");
  const busy = await db.api.players.withIndex("by_user", (q) => q.eq("userId", "busy")).first();
  assert.equal(rules.recentJoinFailures(rules.parseWrites(busy.writes), clock), 0, "not a failed attempt");
  await M("abandonMatch", "busy", mine[0].id);
  assert.deepEqual(await M("joinMatch", "busy", m.code, "brock"), { id: m.id });
  // A sixth game cannot be created either, whether hosted or joined.
  assert.equal(await errorOf(M("createMatch", "busy", "ash", newInvite().hash)), "too many games");
});

test("my games: an old game in play stays listed and counted however many newer games exist", async () => {
  reset();
  await setupPlayers("host", "guest");
  const old = await playingMatch();
  for (let i = 0; i < 24; i++) {
    advance(1000);
    const g = await playingMatch("host", "guest", "misty", "brock");
    await M("finishMatch", "host", g.id, "host");
  }
  for (const who of ["host", "guest"]) {
    const list = await Q("myMatches", who);
    assert.equal(list.length, rules.MY_MATCHES_MAX);
    assert.ok(list.some((g) => g.id === old.id && g.status === "playing"), `${who} still sees the old game`);
    assert.equal(list.at(-1).id, old.id, "still newest first");
  }
  for (let i = 0; i < rules.MAX_ACTIVE_MATCHES - 1; i++) await openMatch("host");
  assert.equal(await errorOf(M("createMatch", "host", "ash", newInvite().hash)), "too many games", "the old game counts");
  // Pure: active games win places over finished ones without changing the order.
  const now = clock;
  const row = (id, status, createdAt) => ({ id, createdAt, status, hostId: "u", hostNick: "U", hostDeck: "ash", format: "classic", lastMoveAt: 0, expiresAt: now + 1 });
  const rows = [row("old", "playing", "2026-01-01"), ...Array.from({ length: 30 }, (_, i) => row(`d${i}`, "done", `2026-02-${String(i + 1).padStart(2, "0")}`))];
  const view = rules.myMatchesView(rows, "u", now);
  assert.equal(view.length, rules.MY_MATCHES_MAX);
  assert.equal(view.at(-1).id, "old");
  assert.equal(view[0].id, "d29");
});

test("expiry sweep: finished, abandoned and expired games in play go too, with their saved state", async () => {
  reset();
  await setupPlayers("host", "guest", "other");
  const playing = await playingMatch();
  await M("saveState", "host", playing.id, "h", "g", 1);
  const done = await playingMatch("host", "guest", "misty", "brock");
  await M("finishMatch", "host", done.id, "guest");
  const gone = await playingMatch("host", "guest", "zap", "brock");
  await M("abandonMatch", "guest", gone.id);
  advance(rules.FINISHED_TTL_MS + 1);
  await openMatch("other");
  let ids = [...db.tables.matches.keys()];
  assert.ok(!ids.includes(done.id) && !ids.includes(gone.id), "finished and abandoned games are swept after 7 days");
  assert.ok(ids.includes(playing.id), "a game in play stays until its own expiry");
  advance(rules.PLAYING_TTL_MS);
  await openMatch("other");
  ids = [...db.tables.matches.keys()];
  assert.ok(!ids.includes(playing.id), "an expired game in play is swept");
  assert.equal(db.tables.states.size, 0, "with its saved state");
});

test("rate limit: acknowledgements count against the write limit", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  advance(10_000);
  for (let i = 0; i < rules.WRITE_BURST; i++) await M("ackMessages", "guest", m.id, 0);
  assert.equal(await errorOf(M("ackMessages", "guest", m.id, 0)), rules.SLOW_DOWN);
});

test("locks: the player row is locked with an update before its write log is read", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  const calls = [];
  const update = db.api.players.update;
  db.api.players.update = async function (id, patch) {
    calls.push(Object.keys(patch).join(",") || "{}");
    return update.call(this, id, patch);
  };
  await M("sendMessage", "host", m.id, "relay", "x");
  assert.deepEqual(calls, ["{}", "writes"]);
  // A runtime that refused an empty patch still works (without the lock).
  db.api.players.update = async function (id, patch) {
    if (!Object.keys(patch).length) throw new Error("empty patch");
    return update.call(this, id, patch);
  };
  assert.deepEqual(await M("sendMessage", "host", m.id, "relay", "y"), { seq: 2 });
  db.api.players.update = update;
  // The match lock is an update followed by an explicit re-read.
  const order = [];
  const mu = db.api.matches.update;
  const mg = db.api.matches.get;
  db.api.matches.update = async function (id, patch) {
    order.push(`update:${Object.keys(patch).join(",")}`);
    return mu.call(this, id, patch);
  };
  db.api.matches.get = async function (id) {
    order.push("get");
    return mg.call(this, id);
  };
  await M("sendMessage", "guest", m.id, "relay", "z");
  db.api.matches.update = mu;
  db.api.matches.get = mg;
  assert.deepEqual(order.slice(0, 2), ["update:lastMoveAt", "get"]);
});

test("resume: host gets hostState, guest gets guestView, in chunks that each fit an action result", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  assert.deepEqual(await A("resume", "guest", m.id), { role: "guest", version: 0, state: null, next: null });
  const host = JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ c: `card-${i}`, q: '"' }))).slice(0, 44_000);
  const guest = "ゲーム😀".repeat(4500);
  assert.ok(rules.isStoredText(host) && rules.isStoredText(guest));
  await M("saveState", "host", m.id, host, guest, 7);
  for (const [who, expected, role] of [["host", host, "host"], ["guest", guest, "guest"]]) {
    let offset = 0;
    let text = "";
    let parts = 0;
    for (;;) {
      const r = await A("resume", who, m.id, offset);
      assert.equal(r.role, role);
      assert.equal(r.version, 7);
      assert.ok(rules.jsonBytes(r.state) <= rules.RESUME_CHUNK_BYTES);
      text += r.state;
      parts++;
      if (r.next === null) break;
      offset = r.next;
    }
    assert.equal(text, expected);
    assert.ok(parts >= 2, `${who} state needed ${parts} parts`);
  }
  assert.equal(await A("resume", "host", m.id, -1), null);
  assert.equal(await A("resume", "host", m.id, "0"), null);
});

test("chunkAt: reassembles any string without splitting surrogate pairs", () => {
  const pieces = ["a", '"', "\\", "\n", "\u0001", "é", "ゲ", "😀", "\ud800", "\udc00"];
  for (let round = 0; round < 50; round++) {
    let s = "";
    const n = 200 + Math.floor(Math.random() * 3000);
    for (let i = 0; i < n; i++) s += pieces[Math.floor(Math.random() * pieces.length)];
    const max = 50 + Math.floor(Math.random() * 400);
    let offset = 0;
    let out = "";
    for (let guard = 0; guard < 100_000; guard++) {
      const c = rules.chunkAt(s, offset, max);
      assert.ok(rules.jsonBytes(c.text) <= max || c.text.length === 1);
      const last = c.text.charCodeAt(c.text.length - 1);
      const next = s.charCodeAt(offset + c.text.length);
      assert.ok(!(last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff), "split a surrogate pair");
      out += c.text;
      if (c.next === null) break;
      offset = c.next;
    }
    assert.equal(out, s);
  }
  assert.deepEqual(rules.chunkAt("abc", 10), { text: "", next: null });
});

test("expiry sweep: creating a match clears a bounded number of expired open matches and messages", async () => {
  reset();
  await setupPlayers("host", "guest", "other");
  for (let i = 0; i < 3; i++) await openMatch("other");
  const m = await playingMatch();
  await M("sendMessage", "host", m.id, "relay", "old");
  advance(rules.OPEN_TTL_MS + 1);
  await openMatch("host");
  const rows = [...db.tables.matches.values()];
  assert.equal(rows.filter((r) => r.hostId === "other").length, 0, "expired open matches are gone");
  assert.equal(rows.filter((r) => r.id === m.id).length, 1, "games in play stay");
  assert.equal([...db.tables.messages.values()].length, 0, "expired messages are gone");
});

test("saveState keeps an active game alive", async () => {
  reset();
  await setupPlayers("host", "guest");
  const m = await playingMatch();
  advance(rules.PLAYING_TTL_MS - 1000);
  await M("saveState", "host", m.id, "h", "g", 1);
  advance(5000);
  assert.equal((await Q("match", "guest", m.id)).status, "playing");
});

// ------------------------------------------------------------------ bridge, retry, i18n, config

test("bridge: frame messages are checked field by field", () => {
  const ok = [
    [{ type: "ready" }, { type: "ready" }],
    [{ type: "leave", extra: 1 }, { type: "leave" }],
    [{ type: "send", kind: "relay", payload: "p" }, { type: "send", kind: "relay", payload: "p" }],
    [{ type: "ack", uptoSeq: 4 }, { type: "ack", uptoSeq: 4 }],
    [{ type: "save", hostState: "h", guestView: "g", version: 2 }, { type: "save", hostState: "h", guestView: "g", version: 2 }],
    [{ type: "over", winner: "draw" }, { type: "over", winner: "draw" }],
  ];
  for (const [input, output] of ok) assert.deepEqual(bridge.parseFrameMessage(input), output);
  const bad = [
    null,
    "ready",
    [],
    { type: "init" },
    { type: "send", kind: "evil", payload: "p" },
    { type: "send", kind: "relay", payload: 5 },
    { type: "send", kind: "relay", payload: "x".repeat(60001) },
    { type: "ack", uptoSeq: -1 },
    { type: "ack", uptoSeq: "3" },
    { type: "save", hostState: "h", guestView: "g", version: 0 },
    { type: "save", hostState: "h", guestView: null, version: 1 },
    { type: "over", winner: "me" },
    Object.assign(Object.create({ type: "ready" }), {}),
  ];
  for (const input of bad) assert.equal(bridge.parseFrameMessage(input), null, JSON.stringify(input));
  assert.deepEqual(bridge.cleanInbox([{ seq: 1, kind: "relay", payload: "a" }, { seq: -1, kind: "relay", payload: "b" }, { seq: 2, kind: "x", payload: "c" }]), [
    { seq: 1, kind: "relay", payload: "a" },
  ]);
  assert.equal(bridge.cleanInbox(undefined), null);
});

test("retry: jittered 0.5–2 s, the server's wait when it gives one, no retry on final errors", () => {
  for (const r of [0, 0.3, 0.999]) {
    const d = retry.retryDelayMs(new Error("Zero mutation.run request failed."), r);
    assert.ok(d >= 500 && d <= 2000, String(d));
  }
  assert.ok(retry.retryDelayMs(new Error(rules.SLOW_DOWN), 0) >= 2000);
  assert.ok(retry.retryDelayMs(Object.assign(new Error("x"), { status: 429 }), 0.5) >= 2000);
  assert.equal(retry.retryDelayMs(Object.assign(new Error("x"), { retryAfter: 5 }), 0), 5000);
  assert.equal(retry.retryDelayMs({ headers: { get: () => "3" } }, 0), 3000);
  assert.equal(retry.isFinalError(new Error(rules.DENIED)), true);
  assert.equal(retry.isFinalError(new Error("stale version")), true);
  assert.equal(retry.isFinalError(new Error(rules.SLOW_DOWN)), false);
  assert.equal(retry.RETRY_TRIES, 3);
});

test("i18n: every language has every string, placeholders fill in", () => {
  const keys = Object.keys(i18n.MESSAGES.en);
  for (const lang of i18n.LANGS) {
    assert.deepEqual(Object.keys(i18n.MESSAGES[lang]).sort(), [...keys].sort(), lang);
    for (const k of keys) assert.ok(i18n.MESSAGES[lang][k].trim(), `${lang}.${k}`);
    assert.ok(i18n.translate(lang, "err_wrong_format", { format: "X" }).includes("X"));
  }
  assert.ok(!JSON.stringify(i18n.MESSAGES).includes("Gary"));
  assert.equal(i18n.langFromTag("tr-TR"), "tr");
  assert.equal(i18n.langFromTag("ja"), "ja");
  assert.equal(i18n.langFromTag("de-DE"), "en");
  assert.equal(i18n.langFromTag(undefined), "en");
});

test("config and invite codes", () => {
  assert.equal(config.frameUrlFor("localhost"), "http://127.0.0.1:8791/play/versus.html");
  assert.equal(config.frameUrlFor("127.0.0.1"), "http://127.0.0.1:8791/play/versus.html");
  assert.equal(config.frameUrlFor("versus.space.fast"), "https://pokemon-versus-play.space.fast/play/versus.html");
  assert.equal(config.frameOriginFor("versus.space.fast"), "https://pokemon-versus-play.space.fast");
  for (let i = 0; i < 200; i++) {
    const bytes = randomBytes(16);
    const code = rules.encodeInviteCode(bytes);
    assert.equal(code, bytes.toString("base64url"));
    assert.ok(rules.isInviteCode(code), code);
  }
  assert.equal(rules.isInviteCode("A".repeat(22)), true);
  assert.equal(rules.isInviteCode("A".repeat(21) + "B"), false, "not a canonical 16-byte code");
  assert.equal(rules.isInviteCode("A".repeat(23)), false);
  assert.equal(rules.isInviteHash("a".repeat(64)), true);
  assert.equal(rules.isInviteHash("A".repeat(64)), false);
});

test.after(() => {
  Date.now = realNow;
});
