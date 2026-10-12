// The host's side of a two-player game (no DOM): the guest's seat as a controller, and the game hooks forwarded to
// the guest, mirrored and redacted (net/protocol.js). ui.js wraps both with its pacing and screens.
import { guestEvent, guestLog, guestParams, guestSnapshot, swapSeat } from './protocol.js';

const FORWARDED = ['onCoin', 'onRps', 'onAttack', 'onHit', 'onAttackEnd', 'onAttach', 'onEvolve', 'onBench', 'onTrainer', 'onPrize'];

// The guest's seat (always seat 1 on the host). Before each question the guest gets the board as it is right now.
export class RemoteController {
  constructor(session) { this.session = session; }
  snap(g) { this.session.send({ t: 'snap', s: guestSnapshot(g) }); }
  async chooseAction(g, p, actions) {
    this.snap(g);
    const key = await this.session.ask('action', { actions });
    return actions.find((a) => a.key === key) || actions.find((a) => a.kind === 'end') || actions.at(-1);
  }
  async choose(g, p, prompt) {
    this.snap(g);
    return this.session.ask('choose', { prompt });
  }
  async setupBench(g, p, basics) {
    this.snap(g);
    return this.session.ask('bench', { cards: basics });
  }
}

// Every hook still runs on the host's own screen; the guest gets its copy first, so both screens animate together.
export function forwardHooks(hooks, session) {
  const out = { ...hooks };
  for (const name of FORWARDED) {
    out[name] = (...args) => {
      const a = guestEvent(name, args);
      if (a) session.send({ t: 'ev', name, a });
      return hooks[name]?.(...args);
    };
  }
  out.onLog = (e) => { session.send({ t: 'log', e: guestLog(e) }); return hooks.onLog?.(e); };
  out.onUpdate = (g) => { session.send({ t: 'snap', s: guestSnapshot(g) }); return hooks.onUpdate?.(g); };
  out.onGameOver = (g) => {
    session.send({ t: 'snap', s: guestSnapshot(g) });
    session.send({
      t: 'over', winner: g.winner === 'draw' ? 'draw' : swapSeat(g.winner.idx),
      reason: { key: g.winReason?.key || 'log.draw', params: guestParams(g.winReason?.params || {}) },
    });
    return hooks.onGameOver?.(g);
  };
  return out;
}
