/**
 * Overlay -> broker client. Runs in node against a real broker, with the
 * EventSource half left alone (that path is covered by the SSE test).
 *
 * Run with: node --test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startEarmarkServer } from 'earmark-server';
import { createTransport } from 'earmark/transport';

/** @type {Awaited<ReturnType<typeof startEarmarkServer>>} */
let instance;
/** @type {ReturnType<typeof createTransport>} */
let transport;

const target = {
  kind: 'element',
  label: 'button "Export"',
  tag: 'button',
  selector: '[data-testid="export-btn"]',
  rect: { x: 0, y: 0, width: 66, height: 37, pageX: 194, pageY: 376 },
  styles: {},
  attributes: {},
};

const page = {
  url: 'http://localhost:5173/',
  viewport: { width: 1280, height: 720 },
  devicePixelRatio: 2,
  colorScheme: 'dark',
  framework: 'unknown',
  scroll: { x: 0, y: 0 },
};

before(async () => {
  instance = await startEarmarkServer({ port: 0, file: null, quiet: true });
  transport = createTransport({
    endpoint: instance.url,
    sessionId: 'test-session',
    onState: () => {},
    onEvent: () => {},
  });
});

after(async () => {
  transport.destroy();
  await instance.close();
});

test('push sends the batch and the page context', async () => {
  const result = await transport.push([{ note: 'too tight', targets: [target] }], page);
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].sessionId, 'test-session');
  assert.equal(result.annotations[0].page.url, page.url);
});

test('answering the agent also clears needs-input on the server', async () => {
  const { annotations } = await (await fetch(`${instance.url}/annotations`)).json();
  const id = annotations[0].id;

  // The agent asks something.
  await fetch(`${instance.url}/annotations/${id}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ author: 'agent', message: 'min-width or grid?', status: 'needs-input' }),
  });

  await transport.reply(id, 'min-width is fine');

  const updated = await (await fetch(`${instance.url}/annotations/${id}`)).json();
  assert.equal(
    updated.status,
    'open',
    'the agent must stop believing it is blocked once the human has answered',
  );
  assert.equal(updated.replies.at(-1).author, 'human');
});

test('patch and remove reach the server', async () => {
  const { annotations } = await (await fetch(`${instance.url}/annotations`)).json();
  const id = annotations[0].id;

  await transport.patch(id, { status: 'resolved' });
  const patched = await (await fetch(`${instance.url}/annotations/${id}`)).json();
  assert.equal(patched.status, 'resolved');

  await transport.remove(id);
  const gone = await fetch(`${instance.url}/annotations/${id}`);
  assert.equal(gone.status, 404);
});

test('a failed request rejects rather than resolving with junk', async () => {
  await assert.rejects(() => transport.patch('does-not-exist', { status: 'open' }), /404/);
});

test('connect reports false when nothing is listening, without throwing', async () => {
  const dead = createTransport({
    endpoint: 'http://127.0.0.1:1',
    sessionId: 'x',
    onState: () => {},
    onEvent: () => {},
  });
  assert.equal(await dead.connect(), false);
  assert.equal(dead.getState(), 'offline');
  dead.destroy();
});
