/**
 * Annotation store: in-memory, JSON-persisted, with change notification for
 * both SSE subscribers (browser) and long-poll waiters (MCP `watch`).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** @typedef {'open' | 'needs-input' | 'resolved' | 'dismissed'} Status */

export const STATUSES = ['open', 'needs-input', 'resolved', 'dismissed'];

const WRITE_DEBOUNCE_MS = 250;

/**
 * @param {object} [options]
 * @param {string} [options.file] path to the JSON persistence file; pass null to disable
 */
export function createStore(options = {}) {
  const file = options.file === null ? null : resolve(options.file || '.earmark/annotations.json');

  /** @type {Map<string, any>} */
  const annotations = new Map();
  /** @type {Set<(event: {type: string, data: any}) => void>} */
  const subscribers = new Set();
  /** @type {Array<{since: number, resolve: (v: any) => void, timer: NodeJS.Timeout, filter: any}>} */
  let waiters = [];

  let cursor = 0;
  /** @type {NodeJS.Timeout | null} */
  let writeTimer = null;

  /** @param {{type: string, data: any}} event */
  function emit(event) {
    for (const fn of subscribers) {
      try {
        fn(event);
      } catch {
        /* a dead subscriber must not break the others */
      }
    }
    wakeWaiters();
    schedulePersist();
  }

  function wakeWaiters() {
    if (!waiters.length) return;
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) {
      const changed = list(waiter.filter).filter((a) => a.seq > waiter.since);
      if (changed.length) {
        clearTimeout(waiter.timer);
        waiter.resolve({ annotations: changed, cursor });
      } else {
        waiters.push(waiter);
      }
    }
  }

  function schedulePersist() {
    if (!file) return;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(persist, WRITE_DEBOUNCE_MS);
    writeTimer.unref?.();
  }

  async function persist() {
    if (!file) return;
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ cursor, annotations: [...annotations.values()] }, null, 2));
    } catch (error) {
      process.stderr.write(`earmark: could not persist annotations — ${error.message}\n`);
    }
  }

  async function load() {
    if (!file) return;
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      cursor = parsed.cursor || 0;
      for (const annotation of parsed.annotations || []) {
        annotations.set(annotation.id, annotation);
      }
    } catch {
      /* no prior state — start empty */
    }
  }

  /**
   * @param {{status?: Status | Status[], sessionId?: string}} [filter]
   * @returns {any[]}
   */
  function list(filter = {}) {
    let items = [...annotations.values()];
    if (filter.status) {
      const wanted = Array.isArray(filter.status) ? filter.status : [filter.status];
      items = items.filter((a) => wanted.includes(a.status));
    }
    if (filter.sessionId) items = items.filter((a) => a.sessionId === filter.sessionId);
    return items.sort((a, b) => a.seq - b.seq);
  }

  /**
   * @param {any} input
   * @param {{sessionId?: string, page?: object}} [context]
   */
  function create(input, context = {}) {
    cursor += 1;
    const annotation = {
      status: 'open',
      replies: [],
      createdAt: new Date().toISOString(),
      ...input,
      id: input.id || `a${cursor}${Math.random().toString(36).slice(2, 6)}`,
      sessionId: input.sessionId || context.sessionId || null,
      page: input.page || context.page || null,
      seq: cursor,
      updatedAt: new Date().toISOString(),
    };
    annotations.set(annotation.id, annotation);
    emit({ type: 'annotation.created', data: annotation });
    return annotation;
  }

  /**
   * @param {string} id
   * @param {object} patch
   */
  function update(id, patch) {
    const existing = annotations.get(id);
    if (!existing) return null;
    cursor += 1;
    const next = {
      ...existing,
      ...patch,
      id: existing.id,
      seq: cursor,
      updatedAt: new Date().toISOString(),
    };
    if (patch.status && !STATUSES.includes(patch.status)) {
      throw new Error(`invalid status "${patch.status}" (expected one of ${STATUSES.join(', ')})`);
    }
    annotations.set(id, next);
    emit({ type: 'annotation.updated', data: next });
    return next;
  }

  /**
   * @param {string} id
   * @param {{author: 'agent' | 'human', message: string}} reply
   * @param {Status} [status] status to move the annotation to
   */
  function addReply(id, reply, status) {
    const existing = annotations.get(id);
    if (!existing) return null;
    const replies = [...(existing.replies || []), { ...reply, at: new Date().toISOString() }];
    return update(id, status ? { replies, status } : { replies });
  }

  /** @param {string} id */
  function remove(id) {
    const existing = annotations.get(id);
    if (!existing) return false;
    annotations.delete(id);
    cursor += 1;
    emit({ type: 'annotation.deleted', data: { id } });
    return true;
  }

  function clear() {
    const count = annotations.size;
    annotations.clear();
    cursor += 1;
    emit({ type: 'annotations.cleared', data: { count } });
    return count;
  }

  /**
   * Resolve as soon as an annotation newer than `since` exists, or after the
   * timeout with an empty list.
   *
   * @param {{since?: number, timeoutMs?: number, status?: Status | Status[]}} [options]
   * @returns {Promise<{annotations: any[], cursor: number, timedOut: boolean}>}
   */
  function waitForChange(options = {}) {
    const since = options.since ?? 0;
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30000, 1000), 600000);
    const filter = options.status ? { status: options.status } : {};

    const immediate = list(filter).filter((a) => a.seq > since);
    if (immediate.length) {
      return Promise.resolve({ annotations: immediate, cursor, timedOut: false });
    }

    return new Promise((resolveWait) => {
      const waiter = {
        since,
        filter,
        resolve: (value) => resolveWait({ ...value, timedOut: false }),
        timer: setTimeout(() => {
          waiters = waiters.filter((w) => w !== waiter);
          resolveWait({ annotations: [], cursor, timedOut: true });
        }, timeoutMs),
      };
      waiter.timer.unref?.();
      waiters.push(waiter);
    });
  }

  /** @param {(event: {type: string, data: any}) => void} fn */
  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return {
    load,
    persist,
    list,
    get: (/** @type {string} */ id) => annotations.get(id) || null,
    create,
    update,
    addReply,
    remove,
    clear,
    subscribe,
    waitForChange,
    get cursor() {
      return cursor;
    },
    get size() {
      return annotations.size;
    },
  };
}
