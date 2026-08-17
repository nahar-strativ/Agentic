/**
 * Store + HTTP behaviour. Run with: node --test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startEarmarkServer } from 'earmark-server';

/** @type {Awaited<ReturnType<typeof startEarmarkServer>>} */
let instance;
let base;

const sampleTarget = {
  kind: 'element',
  label: '<ExportButton>',
  tag: 'button',
  selector: '[data-testid="export-btn"]',
  testId: 'export-btn',
  domPath: 'body > main > section > button',
  text: 'Export',
  attributes: { type: 'button' },
  rect: { x: 10, y: 20, width: 88, height: 30, pageX: 10, pageY: 20 },
  styles: { padding: '7px 13px', fontSize: '13px' },
  framework: 'react',
  components: ['App', 'Dashboard', 'ExportButton'],
  source: 'src/components/Card.tsx:42:7',
  sourceExact: true,
  ancestors: [],
};

const samplePage = {
  url: 'http://localhost:5173/dash',
  viewport: { width: 1440, height: 900 },
  devicePixelRatio: 2,
  colorScheme: 'dark',
  framework: 'react',
  scroll: { x: 0, y: 0 },
};

before(async () => {
  instance = await startEarmarkServer({ port: 0, file: null, quiet: true });
  base = instance.url;
});

after(async () => {
  await instance.close();
});

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function api(path, init) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

test('health reports service metadata', async () => {
  const { status, body } = await api('/health');
  assert.equal(status, 200);
  assert.equal(body.service, 'earmark-server');
  assert.equal(body.count, 0);
});

test('POST /annotations assigns ids and a monotonic seq', async () => {
  const { status, body } = await api('/annotations', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 's1',
      page: samplePage,
      annotations: [
        { note: 'padding too tight', targets: [sampleTarget] },
        { note: 'wrong colour', targets: [sampleTarget] },
      ],
    }),
  });

  assert.equal(status, 201);
  assert.equal(body.annotations.length, 2);
  assert.ok(body.annotations[0].id);
  assert.equal(body.annotations[0].status, 'open');
  assert.ok(body.annotations[1].seq > body.annotations[0].seq);
  assert.equal(body.annotations[0].page.url, samplePage.url);
});

test('GET /annotations filters by status', async () => {
  const all = await api('/annotations');
  assert.equal(all.body.annotations.length, 2);

  const id = all.body.annotations[0].id;
  await api(`/annotations/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });

  const open = await api('/annotations?status=open');
  assert.equal(open.body.annotations.length, 1);

  const resolved = await api('/annotations?status=resolved');
  assert.equal(resolved.body.annotations.length, 1);
  assert.equal(resolved.body.annotations[0].id, id);
});

test('PATCH rejects an unknown status', async () => {
  const { body } = await api('/annotations');
  const id = body.annotations[0].id;
  const res = await api(`/annotations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'banana' }),
  });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /invalid status/);
});

test('replies append to the thread and can move the status', async () => {
  const { body } = await api('/annotations?status=open');
  const id = body.annotations[0].id;

  const asked = await api(`/annotations/${id}/replies`, {
    method: 'POST',
    body: JSON.stringify({ author: 'agent', message: 'vertical or both?', status: 'needs-input' }),
  });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.status, 'needs-input');
  assert.equal(asked.body.replies.at(-1).author, 'agent');

  const answered = await api(`/annotations/${id}/replies`, {
    method: 'POST',
    body: JSON.stringify({ author: 'human', message: 'both', status: 'open' }),
  });
  assert.equal(answered.body.replies.length, 2);
  assert.equal(answered.body.status, 'open');
});

test('/annotations/wait blocks until something changes', async () => {
  const { body: current } = await api('/health');
  const started = Date.now();

  const waiting = api(`/annotations/wait?since=${current.cursor}&timeout=5000`);

  setTimeout(() => {
    api('/annotations', {
      method: 'POST',
      body: JSON.stringify({ page: samplePage, annotations: [{ note: 'late arrival', targets: [sampleTarget] }] }),
    });
  }, 120);

  const { body } = await waiting;
  const elapsed = Date.now() - started;

  assert.equal(body.timedOut, false);
  assert.equal(body.annotations.length, 1);
  assert.equal(body.annotations[0].note, 'late arrival');
  assert.ok(elapsed < 4000, `should resolve on the event, not the timeout (took ${elapsed}ms)`);
});

test('/annotations/wait times out with an empty list', async () => {
  const { body: health } = await api('/health');
  const { body } = await api(`/annotations/wait?since=${health.cursor}&timeout=1000`);
  assert.equal(body.timedOut, true);
  assert.deepEqual(body.annotations, []);
});

test('SSE streams store events to connected browsers', async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/events`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  // First frames are the retry directive and the hello payload.
  const hello = decoder.decode((await reader.read()).value);
  assert.match(hello, /"type":"hello"/);

  await api('/annotations', {
    method: 'POST',
    body: JSON.stringify({ page: samplePage, annotations: [{ note: 'sse probe', targets: [sampleTarget] }] }),
  });

  let received = '';
  while (!received.includes('annotation.created')) {
    received += decoder.decode((await reader.read()).value);
  }
  assert.match(received, /"note":"sse probe"/);

  controller.abort();
});

test('an SSE connection marks its session connected, and closing marks it gone', async () => {
  await api('/session', {
    method: 'POST',
    body: JSON.stringify({ sessionId: 'tab-1', page: samplePage }),
  });

  const before = await api('/sessions/tab-1');
  assert.equal(before.body.connected, false);

  const controller = new AbortController();
  const res = await fetch(`${base}/events?session=tab-1`, { signal: controller.signal });
  const reader = res.body.getReader();
  await reader.read(); // wait for the hello frame so the handler has run

  const during = await api('/sessions/tab-1');
  assert.equal(during.body.connected, true);

  controller.abort();

  // The close handler runs on the next tick or two.
  for (let i = 0; i < 20; i += 1) {
    const check = await api('/sessions/tab-1');
    if (check.body.connected === false) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const after = await api('/sessions/tab-1');
  assert.equal(after.body.connected, false);
});

test('sessions carry their routes, counts and annotations', async () => {
  await api('/annotations', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'tab-1',
      page: { ...samplePage, url: 'http://localhost:5173/reports', path: '/reports' },
      annotations: [{ note: 'report filter is cramped', targets: [sampleTarget] }],
    }),
  });

  const { body } = await api('/sessions/tab-1');
  assert.ok(body.routes.includes('/dash'));
  assert.ok(body.routes.includes('/reports'));
  assert.equal(body.counts.total, 1);
  assert.equal(body.counts.open, 1);
  assert.equal(body.annotations[0].note, 'report filter is cramped');

  const all = await api('/sessions');
  assert.ok(all.body.sessions.some((s) => s.id === 'tab-1'));
});

test('acknowledged is a real status, distinct from resolved', async () => {
  const { body } = await api('/annotations?status=open');
  const id = body.annotations[0].id;

  const acked = await api(`/annotations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'acknowledged' }),
  });
  assert.equal(acked.status, 200);
  assert.equal(acked.body.status, 'acknowledged');

  const listed = await api('/annotations?status=acknowledged');
  assert.equal(listed.body.annotations.length, 1);

  const resolved = await api('/annotations?status=resolved');
  assert.ok(!resolved.body.annotations.some((a) => a.id === id));
});

test('POST /session without an id is rejected', async () => {
  const { status } = await api('/session', { method: 'POST', body: JSON.stringify({ page: samplePage }) });
  assert.equal(status, 400);
});

test('GET /markdown renders the agent-facing document', async () => {
  const res = await fetch(`${base}/markdown?status=open`);
  const body = await res.text();
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  assert.match(body, /## UI feedback/);
  assert.match(body, /\*\*Selector:\*\* `\[data-testid="export-btn"\]`/);
  assert.match(body, /\*\*Source:\*\* `src\/components\/Card\.tsx:42:7`/);
  assert.match(body, /\*\*Component path:\*\* App › Dashboard › ExportButton/);
});

test('DELETE removes one annotation and the collection', async () => {
  const { body } = await api('/annotations');
  const id = body.annotations[0].id;

  const removed = await api(`/annotations/${id}`, { method: 'DELETE' });
  assert.equal(removed.status, 204);

  const missing = await api(`/annotations/${id}`);
  assert.equal(missing.status, 404);

  const cleared = await api('/annotations', { method: 'DELETE' });
  assert.ok(cleared.body.cleared > 0);

  const empty = await api('/annotations');
  assert.deepEqual(empty.body.annotations, []);
});

test('a token, when configured, gates every request', async () => {
  const guarded = await startEarmarkServer({ port: 0, file: null, quiet: true, token: 'secret' });
  try {
    const denied = await fetch(`${guarded.url}/health`);
    assert.equal(denied.status, 401);

    const allowed = await fetch(`${guarded.url}/health?token=secret`);
    assert.equal(allowed.status, 200);

    const viaHeader = await fetch(`${guarded.url}/health`, { headers: { 'x-earmark-token': 'secret' } });
    assert.equal(viaHeader.status, 200);
  } finally {
    await guarded.close();
  }
});
