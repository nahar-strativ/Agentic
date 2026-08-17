/**
 * Persistence adapters for the annotation store.
 *
 * Two shapes, one interface:
 *
 * - **json** — debounced full rewrite of a single file. Human-readable, easy to
 *   delete, fine for the hundreds of annotations a dev session produces.
 * - **sqlite** — incremental upserts through `node:sqlite`, so a crash loses at
 *   most the statement in flight rather than everything since the last debounce.
 *   Built into Node 22.5+, so it costs no dependency.
 *
 * Both are optional: `memory` keeps nothing.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const WRITE_DEBOUNCE_MS = 250;

/** @typedef {{type: string, data: any}} Change */

/**
 * @typedef {object} Adapter
 * @property {string} kind
 * @property {() => Promise<{cursor: number, annotations: any[], sessions: any[]}>} load
 * @property {(change: Change, snapshot: () => any) => void} onChange
 * @property {() => Promise<void>} flush
 * @property {() => Promise<void>} close
 */

/**
 * @param {{store?: 'json' | 'sqlite' | 'memory', file?: string | null}} [options]
 * @returns {Adapter}
 */
export function createAdapter(options = {}) {
  const kind = options.store || (options.file === null ? 'memory' : 'json');

  if (kind === 'memory' || options.file === null) return createMemoryAdapter();
  if (kind === 'sqlite') return createSqliteAdapter(options.file);
  return createJsonAdapter(options.file);
}

/** @returns {Adapter} */
function createMemoryAdapter() {
  return {
    kind: 'memory',
    async load() {
      return { cursor: 0, annotations: [], sessions: [] };
    },
    onChange() {},
    async flush() {},
    async close() {},
  };
}

/**
 * @param {string} [file]
 * @returns {Adapter}
 */
export function createJsonAdapter(file) {
  const path = resolve(file || '.earmark/annotations.json');
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  /** @type {(() => any) | null} */
  let pending = null;

  async function write(snapshot) {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(snapshot(), null, 2));
    } catch (error) {
      process.stderr.write(`earmark: could not persist annotations — ${error.message}\n`);
    }
  }

  return {
    kind: 'json',

    async load() {
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        return {
          cursor: parsed.cursor || 0,
          annotations: parsed.annotations || [],
          sessions: parsed.sessions || [],
        };
      } catch {
        return { cursor: 0, annotations: [], sessions: [] };
      }
    },

    onChange(_change, snapshot) {
      pending = snapshot;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending) write(pending);
      }, WRITE_DEBOUNCE_MS);
      timer.unref?.();
    },

    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending) await write(pending);
    },

    async close() {
      await this.flush();
    },
  };
}

/**
 * @param {string} [file]
 * @returns {Adapter}
 */
export function createSqliteAdapter(file) {
  const path = resolve(file || '.earmark/annotations.db');
  /** @type {any} */
  let db = null;
  /** @type {Record<string, any>} */
  let statements = {};
  /** @type {Adapter | null} */
  let fallback = null;

  /** Everything routes through here so a missing node:sqlite degrades instead of crashing. */
  function guard(fn) {
    if (fallback) return null;
    try {
      return fn();
    } catch (error) {
      process.stderr.write(`earmark: sqlite write failed — ${error.message}\n`);
      return null;
    }
  }

  return {
    kind: 'sqlite',

    async load() {
      // node:sqlite emits an ExperimentalWarning on import. Silence it for the
      // duration — a dev tool choosing a storage backend is not news.
      const emitWarning = process.emitWarning;
      process.emitWarning = () => {};
      try {
        const { DatabaseSync } = await import('node:sqlite');
        process.emitWarning = emitWarning;
        await mkdir(dirname(path), { recursive: true });
        db = new DatabaseSync(path);
        db.exec(`
          CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY, seq INTEGER, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS annotations_seq ON annotations (seq);
        `);
        statements = {
          putAnnotation: db.prepare(
            'INSERT INTO annotations (id, seq, data) VALUES (?, ?, ?) ' +
              'ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, data = excluded.data',
          ),
          deleteAnnotation: db.prepare('DELETE FROM annotations WHERE id = ?'),
          clearAnnotations: db.prepare('DELETE FROM annotations'),
          putSession: db.prepare(
            'INSERT INTO sessions (id, data) VALUES (?, ?) ' +
              'ON CONFLICT(id) DO UPDATE SET data = excluded.data',
          ),
          putMeta: db.prepare(
            'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ),
        };
      } catch (error) {
        process.emitWarning = emitWarning;
        // node:sqlite landed in Node 22.5. Anything older, or a locked file,
        // falls back to JSON rather than losing the user's annotations.
        process.stderr.write(
          `earmark: sqlite unavailable (${error.message}) — falling back to JSON persistence\n`,
        );
        fallback = createJsonAdapter(path.replace(/\.db$/, '.json'));
        return fallback.load();
      }

      const cursorRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('cursor');
      return {
        cursor: cursorRow ? Number(cursorRow.value) : 0,
        annotations: db
          .prepare('SELECT data FROM annotations ORDER BY seq')
          .all()
          .map((row) => JSON.parse(row.data)),
        sessions: db
          .prepare('SELECT data FROM sessions')
          .all()
          .map((row) => JSON.parse(row.data)),
      };
    },

    onChange(change, snapshot) {
      if (fallback) return fallback.onChange(change, snapshot);

      guard(() => {
        const { type, data } = change;

        if (type === 'annotation.created' || type === 'annotation.updated') {
          statements.putAnnotation.run(data.id, data.seq ?? 0, JSON.stringify(data));
        } else if (type === 'annotation.deleted') {
          statements.deleteAnnotation.run(data.id);
        } else if (type === 'annotations.cleared') {
          statements.clearAnnotations.run();
        } else if (type === 'session.created' || type === 'session.updated') {
          statements.putSession.run(data.id, JSON.stringify(data));
        }

        statements.putMeta.run('cursor', String(snapshot().cursor ?? 0));
      });
    },

    async flush() {
      if (fallback) return fallback.flush();
    },

    async close() {
      if (fallback) return fallback.close();
      guard(() => db?.close());
      db = null;
    },
  };
}
