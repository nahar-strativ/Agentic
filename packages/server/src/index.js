/**
 * Convenience wiring: a loaded store plus a listening HTTP server.
 */

import { createStore } from './store.js';
import { createHttpServer, DEFAULT_PORT, DEFAULT_HOST } from './http.js';

export { createStore } from './store.js';
export { createHttpServer, DEFAULT_PORT, DEFAULT_HOST } from './http.js';

/**
 * @param {object} [options]
 * @param {number} [options.port]
 * @param {string} [options.host]
 * @param {string | null} [options.file]
 * @param {string | null} [options.token]
 * @param {boolean} [options.quiet]
 */
export async function startEarmarkServer(options = {}) {
  const store = createStore({ file: options.file });
  await store.load();

  const http = createHttpServer(store, {
    port: options.port ?? DEFAULT_PORT,
    host: options.host ?? DEFAULT_HOST,
    token: options.token ?? null,
    quiet: options.quiet ?? false,
  });

  const address = await http.listen();

  return {
    store,
    ...address,
    async close() {
      await http.close();
      await store.persist();
    },
  };
}
