/**
 * Persistence adapters. Both backends must survive a restart with identical
 * state, which is the only property that actually matters here.
 *
 * Run with: node --test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from 'earmark-server';

let dir;

const target = {
  kind: 'element',
  label: 'button "Export"',
  tag: 'button',
  selector: '[data-testid="export-btn"]',
  rect: { x: 0, y: 0, width: 66, height: 37, pageX: 194, pageY: 376 },
  styles: {},
  attributes: {},
};

const page = { url: 'http://localhost:5173/dash', path: '/dash', viewport: { width: 1440, height: 900 } };

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'earmark-persist-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Write some state, close, reopen, and hand back the reloaded store.
 * @param {'json' | 'sqlite'} backend
 * @param {string} file
 */
async function roundTrip(backend, file) {
  const first = createStore({ store: backend, file });
  await first.load();

  const kept = first.create({ note: 'keep me', targets: [target] }, { sessionId: 's1', page });
  const doomed = first.create({ note: 'delete me', targets: [target] }, { sessionId: 's1', page });
  first.update(kept.id, { status: 'acknowledged' });
  first.remove(doomed.id);
  first.touchSession('s1', { page });

  await first.persist();
  await first.close();

  const second = createStore({ store: backend, file });
  await second.load();
  return second;
}

test('json persistence survives a restart', async () => {
  const file = join(dir, 'annotations.json');
  const store = await roundTrip('json', file);

  const items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].note, 'keep me');
  assert.equal(items[0].status, 'acknowledged');
  assert.equal(store.getSession('s1').routes[0], '/dash');
  assert.ok(store.cursor > 0);

  // Readable on disk — deleting it by hand must be an obvious option.
  const raw = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(raw.annotations.length, 1);

  await store.close();
});

test('sqlite persistence survives a restart', async (t) => {
  try {
    await import('node:sqlite');
  } catch {
    t.skip('node:sqlite unavailable on this runtime');
    return;
  }

  const store = await roundTrip('sqlite', join(dir, 'annotations.db'));

  const items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].note, 'keep me');
  assert.equal(items[0].status, 'acknowledged');
  assert.equal(store.getSession('s1').routes[0], '/dash');
  assert.ok(store.cursor > 0);
  assert.equal(store.backend, 'sqlite');

  await store.close();
});

test('sqlite writes incrementally rather than on a debounce', async (t) => {
  try {
    await import('node:sqlite');
  } catch {
    t.skip('node:sqlite unavailable on this runtime');
    return;
  }

  const file = join(dir, 'incremental.db');
  const store = createStore({ store: 'sqlite', file });
  await store.load();
  store.create({ note: 'written immediately', targets: [target] }, { page });

  // No persist(), no close() — a crash here must not lose the annotation.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  const rows = db.prepare('SELECT data FROM annotations').all();
  db.close();

  assert.equal(rows.length, 1);
  assert.match(rows[0].data, /written immediately/);

  await store.close();
});

test('a cleared store is cleared on disk too', async () => {
  const file = join(dir, 'cleared.json');
  const store = createStore({ store: 'json', file });
  await store.load();
  store.create({ note: 'temporary', targets: [target] }, { page });
  store.clear();
  await store.persist();
  await store.close();

  const reopened = createStore({ store: 'json', file });
  await reopened.load();
  assert.deepEqual(reopened.list(), []);
  await reopened.close();
});

test('memory backend keeps nothing', async () => {
  const store = createStore({ file: null });
  await store.load();
  store.create({ note: 'ephemeral', targets: [target] }, { page });
  assert.equal(store.backend, 'memory');
  assert.equal(store.list().length, 1);

  await store.persist();
  await store.close();

  const reopened = createStore({ file: null });
  await reopened.load();
  assert.deepEqual(reopened.list(), []);
});
