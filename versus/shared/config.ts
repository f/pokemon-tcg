// Where the game frame lives. It is a different, cookie-free origin: the lobby talks to it only through postMessage.
// shared/ code may not touch browser globals such as `location` (Zero refuses them here), so the hostname is passed
// in; client/frame.ts wraps these as frameUrl() / frameOrigin() for the current page.
export const LOCAL_FRAME_URL = "http://127.0.0.1:8791/play/versus.html";
export const LIVE_FRAME_URL = "https://pokemon-versus-play.space.fast/play/versus.html";
export const ACADEMY_URL = "https://pokemon.space.fast";

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function frameUrlFor(hostname: string): string {
  return isLocalHost(hostname) ? LOCAL_FRAME_URL : LIVE_FRAME_URL;
}

export function frameOriginFor(hostname: string): string {
  return new URL(frameUrlFor(hostname)).origin;
}
