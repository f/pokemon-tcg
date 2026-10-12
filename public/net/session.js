// One side of a two-player game, on top of a transport (net/transport.js, or an in-memory pair in tests).
// The host asks the guest for decisions here: each prompt has an id, only a valid answer to the pending prompt is
// accepted, and an unanswered prompt falls back to a safe default when the decision clock runs out.
import { validFromGuest, validFromHost, validAnswer, defaultAnswer, guestPrompt } from './protocol.js';

export const DECISION_MS = 3 * 60 * 1000;

export function createSession({ role, transport, decisionMs = DECISION_MS, onWarn = () => {} }) {
  const inbound = [];
  let listener = null;
  let nextPrompt = 1;
  let pending = null; // host: { id, kind, body, wire, resolve, timer, bad }

  const send = (m) => transport.send(m);

  transport.onMessage((m) => {
    if (role === 'host') {
      if (!validFromGuest(m)) return onWarn('bad message from guest');
      if (m.t === 'answer') return answer(m);
      if (m.t === 'hello') { session.onHello?.(); return; }
      return;
    }
    if (!validFromHost(m)) return onWarn('bad message from host');
    if (listener) listener(m); else inbound.push(m);
  });

  function answer(m) {
    if (!pending || m.id !== pending.id) return; // a late or duplicate answer
    if (!validAnswer(pending.kind, pending.body, m.value)) {
      pending.bad++;
      onWarn(`invalid answer (${pending.bad})`);
      if (pending.bad >= 3) return settle(defaultAnswer(pending.kind, pending.body));
      return send(pending.wire); // ask again
    }
    settle(m.value);
  }
  function settle(value) {
    const p = pending;
    if (!p) return;
    pending = null;
    clearTimeout(p.timer);
    p.resolve(value);
  }

  const session = {
    role,
    send,
    // Host: ask the guest. `kind` is 'action' | 'choose' | 'bench'; `body` holds the live objects.
    ask(kind, body) {
      return new Promise((resolve) => {
        const id = nextPrompt++;
        const wire = { t: 'prompt', id, ...guestPrompt(kind, body) };
        pending = { id, kind, body, wire, resolve, bad: 0, timer: setTimeout(() => { onWarn('decision timed out'); settle(defaultAnswer(kind, body)); }, decisionMs) };
        send(wire);
      });
    },
    // Host: after a reconnect, the guest gets the question it is waiting on again.
    resendPending() { if (pending) send(pending.wire); },
    hasPending: () => !!pending,
    // Guest: messages from the host, in order (queued until a listener is attached).
    listen(fn) { listener = fn; while (inbound.length && listener) listener(inbound.shift()); },
    reply(id, value) { send({ t: 'answer', id, value }); },
    close() { if (pending) clearTimeout(pending.timer); pending = null; transport.close?.(); },
    onHello: null,
  };
  return session;
}

// Two transports wired to each other in memory (tests, and a same-page loopback for development).
export function memoryPair({ delay = 0 } = {}) {
  const make = () => ({ handlers: [], other: null });
  const a = make(), b = make();
  a.other = b; b.other = a;
  const wrap = (side) => ({
    send(m) {
      const copy = JSON.parse(JSON.stringify(m)); // what really travels is JSON
      const deliver = () => side.other.handlers.forEach((h) => h(copy));
      if (delay) setTimeout(deliver, delay); else queueMicrotask(deliver);
    },
    onMessage(h) { side.handlers.push(h); },
    close() {},
  });
  return [wrap(a), wrap(b)];
}
