const abortError = () => new DOMException('Card image request canceled', 'AbortError');

export function checkCardImageAbort(signal) {
  if (signal?.aborted) throw signal.reason ?? abortError();
}

export async function waitForCardImage(promise, signal) {
  if (!signal) return promise;
  let onAbort;
  const canceled = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason ?? abortError());
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([canceled, promise]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export async function requestCardImage(url, read, { signal, timeout = 6500, ...options } = {}) {
  checkCardImageAbort(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Card image request timed out', 'TimeoutError'));
  }, timeout);
  try {
    // The deadline covers reading the response body as well as receiving headers.
    return await waitForCardImage(fetch(url, { ...options, signal: controller.signal }).then(read), controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
