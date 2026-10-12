// The game frame of a two-player match (versus.html, built by scripts/build-versus.mjs). The lobby page around it
// (versus/, a Spacefast Zero app) sends `init` with the match; this page then plays it: the host runs the game, the
// guest sees the host's redacted view (net/*).
import { startVersus, setVersusStatus, setVersusLang, versusNotice } from './ui.js';
import { createBridge } from './net/bridge.js';
import { createTransport } from './net/transport.js';
import { createSession } from './net/session.js';

const bridge = createBridge();
let started = false;

bridge.on('init', (init) => {
  if (started) return;
  started = true;
  setVersusLang(init.lang);
  const transport = createTransport({ role: init.role, bridge, relayOnly: init.relayOnly, onState: (s) => setVersusStatus('vs.' + s) });
  const session = createSession({ role: init.role, transport, onWarn: (w) => console.warn('versus:', w) });
  // A guest who (re)joins says hello; the host answers with a fresh direct connection, the board and the open question.
  if (init.role === 'host') transport.onMessage((m) => { if (m?.t === 'hello') transport.restart(); });
  else session.send({ t: 'hello' });
  bridge.on('status', ({ status }) => { if (status === 'abandoned') versusNotice('vs.abandoned'); });
  startVersus({
    role: init.role, decks: init.decks, nicks: init.nicks, session, resume: init.resume,
    onSave: (s) => bridge.save(s), onOver: (w) => bridge.over(w), onLeave: () => bridge.leave(),
  }).catch((err) => console.error('versus:', err));
});
bridge.ready();
