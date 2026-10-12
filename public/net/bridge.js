// The game frame (this page, served from a cookie-free origin) and the lobby page around it (the Spacefast Zero app,
// which holds the player's session). They talk only through postMessage, with an exact origin check both ways and
// a fixed set of message shapes (see versus/README.md for the contract).
export const LOBBY_ORIGINS = ['https://pokemon-versus.space.fast'];
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/;
const LANGS = ['en', 'tr', 'ja', 'es'];
const KINDS = ['offer', 'answer', 'bye', 'relay'];
const MAX = 60000;

const isDevFrame = () => ['localhost', '127.0.0.1'].includes(location.hostname);
const allowed = (o) => LOBBY_ORIGINS.includes(o) || (isDevFrame() && DEV_ORIGIN.test(o));
const str = (x, max = 64) => typeof x === 'string' && x.length > 0 && x.length <= max;

function validInit(m) {
  return (m.role === 'host' || m.role === 'guest') && str(m.matchId, 128)
    && m.decks && str(m.decks.host) && str(m.decks.guest)
    && m.nicks && str(m.nicks.host, 24) && str(m.nicks.guest, 24)
    && LANGS.includes(m.lang) && typeof m.relayOnly === 'boolean'
    && (m.resume == null || (typeof m.resume === 'object' && (m.resume.state == null || (typeof m.resume.state === 'string' && m.resume.state.length <= MAX)) && Number.isInteger(m.resume.version)));
}
const validInbox = (msgs) => Array.isArray(msgs) && msgs.length <= 200
  && msgs.every((x) => x && Number.isInteger(x.seq) && KINDS.includes(x.kind) && typeof x.payload === 'string' && x.payload.length <= MAX);

export function createBridge() {
  let lobby = null; // the lobby's origin, fixed by the first valid init
  const handlers = {};
  window.addEventListener('message', (ev) => {
    if (ev.source !== window.parent || !allowed(ev.origin) || (lobby && ev.origin !== lobby)) return;
    const m = ev.data;
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    if (m.type === 'init') {
      if (lobby || !validInit(m)) return;
      lobby = ev.origin;
      handlers.init?.(m);
    } else if (!lobby) {
      return;
    } else if (m.type === 'inbox') {
      if (validInbox(m.msgs)) handlers.inbox?.(m.msgs);
    } else if (m.type === 'status') {
      if (typeof m.status === 'string' && m.status.length < 20) handlers.status?.({ status: m.status, winner: typeof m.winner === 'string' ? m.winner : null });
    }
  });
  const post = (m) => { if (lobby) window.parent.postMessage(m, lobby); };
  return {
    on(type, fn) { handlers[type] = fn; },
    // Before init the lobby's origin is unknown: say "ready" to each allowed lobby (only the real parent receives it).
    ready() {
      if (window.parent === window) return;
      const targets = isDevFrame() ? ['*'] : LOBBY_ORIGINS;
      for (const o of targets) window.parent.postMessage({ type: 'ready' }, o);
    },
    send(kind, payload) { if (KINDS.includes(kind) && payload.length <= MAX) post({ type: 'send', kind, payload }); },
    ack(uptoSeq) { post({ type: 'ack', uptoSeq }); },
    save({ hostState, guestView, version }) { post({ type: 'save', hostState, guestView, version }); },
    over(winner) { post({ type: 'over', winner }); },
    leave() { post({ type: 'leave' }); },
  };
}
