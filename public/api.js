// One door to the game's backend. In the browser it is the local Node server (server.js, plain fetch); in the
// macOS app it is the Rust side (src-tauri), reached through Tauri's invoke. Both answer the same paths:
//   GET /api/engine · POST /api/engine · POST /api/engine/stop · POST /api/decide
export const inApp = typeof window !== 'undefined' && !!window.__TAURI__?.core;

export async function api(path, { method = 'GET', body } = {}) {
  if (inApp) {
    const r = await window.__TAURI__.core.invoke('api', { method, path, body: body ?? null });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }
  return fetch(path, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}

// Jev is a hosted model: without internet only the CPU engine and local models can play.
export const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
