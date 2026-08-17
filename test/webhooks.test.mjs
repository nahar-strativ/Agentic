/**
 * Webhook fan-out. The important properties: a dead endpoint must not stall the
 * annotation loop, and nothing should be sent that the user did not configure.
 *
 * Run with: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, attachWebhooks, resolveWebhookUrls } from 'earmark-server';

const target = { kind: 'element', label: 'button', tag: 'button', selector: '.x', rect: {}, styles: {} };

/** @param {number} ms */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('urls come from options and environment, deduplicated', () => {
  const urls = resolveWebhookUrls(['https://a.example/hook'], {
    EARMARK_WEBHOOK_URL: 'https://b.example/hook',
    EARMARK_WEBHOOKS: 'https://c.example/hook, https://a.example/hook',
  });
  assert.deepEqual(urls, [
    'https://a.example/hook',
    'https://b.example/hook',
    'https://c.example/hook',
  ]);
});

test('malformed and non-http urls are dropped, not delivered to', () => {
  const urls = resolveWebhookUrls(['not a url', 'file:///etc/passwd', 'ftp://x.example'], {});
  assert.deepEqual(urls, []);
});

test('no configuration means no subscription at all', () => {
  const store = createStore({ file: null });
  const hooks = attachWebhooks(store, resolveWebhookUrls([], {}), { quiet: true });
  assert.deepEqual(hooks.urls, []);
  store.create({ note: 'nobody is listening', targets: [target] });
  assert.equal(hooks.delivered(), 0);
});

test('annotation events are POSTed with an event header', async () => {
  const store = createStore({ file: null });
  /** @type {any[]} */
  const calls = [];

  const hooks = attachWebhooks(store, ['https://hook.example/in'], {
    quiet: true,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    },
  });

  const created = store.create({ note: 'padding too tight', targets: [target] });
  store.update(created.id, { status: 'resolved' });
  await wait(20);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://hook.example/in');
  assert.equal(calls[0].init.headers['x-earmark-event'], 'annotation.created');
  assert.equal(calls[1].init.headers['x-earmark-event'], 'annotation.updated');

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.event, 'annotation.created');
  assert.equal(payload.data.note, 'padding too tight');
  assert.ok(payload.at);

  assert.equal(hooks.delivered(), 2);
  hooks.unsubscribe();
});

test('session bookkeeping is not broadcast to webhooks', async () => {
  const store = createStore({ file: null });
  /** @type {any[]} */
  const calls = [];

  attachWebhooks(store, ['https://hook.example/in'], {
    quiet: true,
    fetchImpl: async (url, init) => {
      calls.push(init.headers['x-earmark-event']);
      return { ok: true, status: 200 };
    },
  });

  store.touchSession('tab-1', { page: { url: 'http://localhost/', path: '/' } });
  store.setSessionConnected('tab-1', true);
  await wait(20);

  assert.deepEqual(calls, []);
});

test('a failing endpoint is retried once, then given up on', async () => {
  const store = createStore({ file: null });
  let attempts = 0;

  const hooks = attachWebhooks(store, ['https://down.example/in'], {
    quiet: true,
    fetchImpl: async () => {
      attempts += 1;
      throw new Error('ECONNREFUSED');
    },
  });

  store.create({ note: 'nobody home', targets: [target] });
  await wait(50);

  assert.equal(attempts, 2, 'one attempt plus one retry');
  assert.equal(hooks.failed(), 1);
});

test('a 4xx is not retried — it will not improve', async () => {
  const store = createStore({ file: null });
  let attempts = 0;

  attachWebhooks(store, ['https://wrong.example/in'], {
    quiet: true,
    fetchImpl: async () => {
      attempts += 1;
      return { ok: false, status: 404 };
    },
  });

  store.create({ note: 'bad path', targets: [target] });
  await wait(50);

  assert.equal(attempts, 1);
});

test('a hanging endpoint does not block the store', async () => {
  const store = createStore({ file: null });

  attachWebhooks(store, ['https://slow.example/in'], {
    quiet: true,
    fetchImpl: () => new Promise(() => {}), // never settles
  });

  const started = Date.now();
  for (let i = 0; i < 5; i += 1) store.create({ note: `annotation ${i}`, targets: [target] });
  const elapsed = Date.now() - started;

  assert.equal(store.list().length, 5);
  assert.ok(elapsed < 100, `store stayed responsive (took ${elapsed}ms)`);
});
