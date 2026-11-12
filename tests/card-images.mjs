import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutParagraph } from '../public/card-image/flow.js';
import { requestCardImage } from '../public/card-image/request.js';
import { localizedCardImage } from '../public/card-image/source.js';

test('mixed-weight paragraphs wrap the same before and after measuring body text', () => {
  const context = {
    font: '',
    measureText() { return { width: this.font.startsWith('500 ') ? 20 : 40 }; },
  };
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const settings = { size: 10, minSize: 10 };
    const paragraph = (font) => layoutParagraph('文字文字', [0, 0, 55, 80], font, { ...settings, heading: '标题' });
    const cold = paragraph('Cold');
    layoutParagraph('文字文字', [0, 0, 80, 80], 'Warm', settings);
    assert.equal(cold, paragraph('Warm'));
  } finally {
    delete globalThis.document;
  }
});

test('the scan deadline includes reading the body', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    blob: () => new Promise(() => {}),
  }));
  await assert.rejects(requestCardImage('https://example.test/scan', (response) => response.blob(), {
    timeout: 10,
  }), { name: 'TimeoutError' });
});

test('canceling a card releases the queue while another caller still needs the same manifest', async (t) => {
  globalThis.document = { baseURI: 'https://example.test/' };
  t.after(() => { delete globalThis.document; });
  let sendResponse;
  const pending = new Promise((resolve) => { sendResponse = resolve; });
  const request = t.mock.method(globalThis, 'fetch', () => pending);
  const first = new AbortController();
  const second = new AbortController();
  const load = (signal) => localizedCardImage({ id: 'gym1-82' }, {
    locale: 'zh-Hans', downloads: true, generation: false, signal,
  });
  const canceled = load(first.signal);
  const remaining = load(second.signal);
  try {
    first.abort();
    await assert.rejects(canceled, { name: 'AbortError' });
    assert.equal(request.mock.callCount(), 1);
  } finally {
    sendResponse(Response.json({ cards: {} }));
    await remaining;
  }
});

test('a temporary manifest failure can retry and a missing locale is memoized', async (t) => {
  globalThis.document = { baseURI: 'https://example.test/' };
  t.after(() => { delete globalThis.document; });
  let status = 503;
  const request = t.mock.method(globalThis, 'fetch', async () => {
    const response = new Response(null, { status });
    status = 404;
    return response;
  });
  const load = () => localizedCardImage({ id: 'gym1-82', source: 'scan.webp' }, {
    locale: 'zh-Hant', downloads: false, generation: true, signal: new AbortController().signal,
  });
  await assert.rejects(load(), /Localized card index unavailable/);
  assert.equal(await load(), undefined);
  assert.equal(await load(), undefined);
  assert.equal(request.mock.callCount(), 2);
});
