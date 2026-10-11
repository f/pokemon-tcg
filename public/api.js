// One door to the game's backend. In the browser it is the local Node server (server.js, plain fetch); in the
// macOS app it is the Rust side (src-tauri), reached through Tauri's invoke. Both answer the same paths:
//   GET /api/engine · POST /api/engine · POST /api/engine/stop · POST /api/decide
// The hosted web version (scripts/build-web.mjs marks its page with <meta name="tcg-build" content="web">) has no
// backend at all: Gary and the Professor play with the CPU engine, and the decision models come with the macOS app.
export const inApp = typeof window !== 'undefined' && !!window.__TAURI__?.core;
export const webOnly = !inApp && typeof document !== 'undefined' && document.querySelector('meta[name="tcg-build"]')?.content === 'web';

const WEB_ENGINE = { engine: 'cpu', model: null, jevKeySet: false, models: [], local: { status: 'stopped', model: null }, web: true };

export async function api(path, { method = 'GET', body } = {}) {
  if (webOnly) {
    const [status, data] = path === '/api/engine' || path === '/api/engine/stop'
      ? [200, WEB_ENGINE]
      : [409, { error: 'the web version plays with the CPU engine' }];
    return { ok: status === 200, status, json: async () => data };
  }
  if (inApp) {
    const r = await window.__TAURI__.core.invoke('api', { method, path, body: body ?? null });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }
  return fetch(path, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}

// Jev is a hosted model: without internet only the CPU engine and local models can play.
export const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

// Where the web version sends players who want the smarter engines (the landing page's download section).
export const MAC_DOWNLOAD = '../#download';
