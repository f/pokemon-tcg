import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutParagraph } from '../public/card-image/flow.js';
import { hasPrintedDimensions, hasPrintedSource, printedResource } from '../public/card-image/printed.js';
import { requestCardImage } from '../public/card-image/request.js';
import { localizedCardImage } from '../public/card-image/source.js';

test('reviewed TCGdex high-resolution cards meet the printed image size threshold', () => {
  const url = 'https://assets.tcgdex.net/zh-tw/S/SJ/018/high.png';
  const card = { url, width: 600, height: 825, sha256: 'a'.repeat(64) };
  assert.ok(hasPrintedSource(card));
  assert.ok(!hasPrintedSource({ ...card, width: 599 }));
  assert.ok(!hasPrintedSource({ ...card, height: 824 }));
  assert.ok(!hasPrintedSource(card, 601));
  assert.equal(printedResource(new URL(url)), 'tcgdex');
  assert.equal(printedResource(new URL(url.replace('high.png', 'low.png'))), undefined);
  assert.equal(printedResource(new URL(url + '?size=small')), undefined);
});

test('printed JPEG dimensions are verified from the frame header', () => {
  const bytes = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xc2,
    0x00, 0x0b, 0x08, 0x03, 0x39, 0x02, 0x58, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
  const card = { format: 'jpeg', width: 600, height: 825 };
  assert.ok(hasPrintedDimensions(bytes, card));
  assert.ok(!hasPrintedDimensions(bytes, { ...card, height: 824 }));
  assert.ok(!hasPrintedDimensions(bytes.subarray(0, 18), card));
});
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
