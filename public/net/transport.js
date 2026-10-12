// How game messages travel between the two players: a WebRTC data channel when the browsers can reach each other,
// otherwise batched through the lobby's Spacefast messages (the relay). Signaling (the SDP offer and answer) always
// goes through the lobby. The host offers; a guest who (re)joins says hello and gets a fresh offer.
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
// Over the relay only what matters survives a batch: the newest snapshot, logs, questions and answers, and the few
// events whose screens wait for them (coin, Rock-Paper-Scissors, a Prize card). Attack and play animations are skipped.
const RELAY_EVENTS = new Set(['onCoin', 'onRps', 'onPrize']);
const URGENT = new Set(['prompt', 'answer', 'over', 'hello']);
// A relay batch is one Spacefast message (one database write, at most 64 KiB once JSON-escaped): stay well under it.
const CHUNK = 30000;
const GATHER_MS = 2500;
const DIRECT_MS = 10000;

export function createTransport({ role, bridge, relayOnly = false, onState = () => {} }) {
  const handlers = [];
  let pc = null, dc = null, state = '';
  let offerId = ''; // the host's current offer: an answer to an older one is ignored
  let lastSeq = 0;
  let out = [], flushTimer = null, directTimer = null;

  const setState = (s) => { if (s !== state) { state = s; onState(s); } };
  const deliver = (m) => handlers.forEach((h) => h(m));

  // ---------------- Relay ----------------
  function relay(m) {
    out.push(m);
    if (URGENT.has(m.t)) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 400);
  }
  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!out.length) return;
    const lastSnap = out.findLastIndex((m) => m.t === 'snap');
    const keep = out.filter((m, i) => (m.t !== 'snap' || i === lastSnap) && (m.t !== 'ev' || RELAY_EVENTS.has(m.name)));
    out = [];
    let batch = [], size = 2;
    const send = () => { if (batch.length) bridge.send('relay', `[${batch.join(',')}]`); batch = []; size = 2; };
    for (const m of keep) {
      const j = JSON.stringify(m);
      if (j.length > CHUNK) continue; // never happens with real game messages; never block the queue on one
      if (size + j.length + 1 > CHUNK) send();
      batch.push(j);
      size += j.length + 1;
    }
    send();
  }

  // ---------------- WebRTC ----------------
  function closePeer() {
    try { dc?.close(); } catch { /* already closed */ }
    try { pc?.close(); } catch { /* already closed */ }
    pc = null; dc = null;
  }
  function gathered(peer) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { peer.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (peer.iceGatheringState === 'complete') done(); };
      peer.addEventListener('icegatheringstatechange', check);
      setTimeout(done, GATHER_MS);
    });
  }
  function wire(channel) {
    dc = channel;
    dc.onopen = () => { clearTimeout(directTimer); setState('direct'); flush(); };
    dc.onclose = () => { if (dc === channel) { dc = null; setState('relay'); } };
    dc.onmessage = (e) => { try { deliver(JSON.parse(e.data)); } catch { /* not ours */ } };
  }
  function newPeer() {
    closePeer();
    setState('connecting');
    const peer = new RTCPeerConnection({ iceServers: ICE });
    pc = peer;
    clearTimeout(directTimer);
    directTimer = setTimeout(() => { if (state !== 'direct') setState('relay'); }, DIRECT_MS);
    return peer;
  }
  async function offer() {
    if (relayOnly || typeof RTCPeerConnection === 'undefined') return setState('relay');
    const peer = newPeer();
    const id = (offerId = crypto.randomUUID());
    wire(peer.createDataChannel('game', { ordered: true }));
    await peer.setLocalDescription(await peer.createOffer());
    await gathered(peer);
    if (pc === peer) bridge.send('offer', JSON.stringify({ id, type: 'offer', sdp: peer.localDescription.sdp }));
  }
  async function answer(offer) {
    if (relayOnly || typeof RTCPeerConnection === 'undefined') return setState('relay');
    const peer = newPeer();
    peer.ondatachannel = (e) => { if (pc === peer) wire(e.channel); };
    await peer.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    await peer.setLocalDescription(await peer.createAnswer());
    await gathered(peer);
    if (pc === peer) bridge.send('answer', JSON.stringify({ id: offer.id, type: 'answer', sdp: peer.localDescription.sdp }));
  }
  async function accept(ans) {
    if (ans.id !== offerId || pc?.signalingState !== 'have-local-offer') return; // an answer to an older offer
    try { await pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp }); } catch { /* a broken answer: the relay carries on */ }
  }
  const parseSdp = (s) => {
    try {
      const d = JSON.parse(s);
      return d && (d.type === 'offer' || d.type === 'answer') && typeof d.id === 'string' && d.id.length <= 64 && typeof d.sdp === 'string' && d.sdp.length < 20000
        ? { id: d.id, type: d.type, sdp: d.sdp } : null;
    } catch { return null; }
  };

  // ---------------- Inbound (from the lobby's inbox) ----------------
  bridge.on('inbox', (msgs) => {
    let upto = lastSeq;
    const fresh = [...msgs].filter((x) => x.seq > lastSeq).sort((a, b) => a.seq - b.seq);
    const newestOffer = fresh.findLast((x) => x.kind === 'offer');
    for (const x of fresh) {
      if (x.seq <= lastSeq) continue;
      upto = Math.max(upto, x.seq);
      if (x.kind === 'relay') {
        try { const batch = JSON.parse(x.payload); if (Array.isArray(batch)) batch.forEach(deliver); } catch { /* a broken batch */ }
      } else if (x.kind === 'offer' && role === 'guest' && x === newestOffer) {
        const sdp = parseSdp(x.payload);
        if (sdp?.type === 'offer') answer(sdp).catch(() => setState('relay'));
      } else if (x.kind === 'answer' && role === 'host') {
        const sdp = parseSdp(x.payload);
        if (sdp?.type === 'answer') accept(sdp);
      } else if (x.kind === 'bye') {
        deliver({ t: 'bye' });
      }
    }
    if (upto > lastSeq) { lastSeq = upto; bridge.ack(upto); }
  });

  if (role === 'host') offer().catch(() => setState('relay'));
  else setState(relayOnly ? 'relay' : 'connecting');

  return {
    get state() { return state; },
    send(m) {
      if (dc?.readyState === 'open') { try { dc.send(JSON.stringify(m)); return; } catch { /* fall back to the relay */ } }
      relay(m);
    },
    onMessage(h) { handlers.push(h); },
    // Host: a guest said hello, so start a fresh direct connection for them (unless one is open).
    restart() { if (role === 'host' && dc?.readyState !== 'open') offer().catch(() => setState('relay')); },
    close() { flush(); closePeer(); },
  };
}
