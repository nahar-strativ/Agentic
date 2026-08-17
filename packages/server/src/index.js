/**
 * Convenience wiring: a loaded store, optional webhook fan-out, and a
 * listening HTTP server.
 */

import { createStore } from './store.js';
import { createHttpServer, DEFAULT_PORT, DEFAULT_HOST } from './http.js';
import { attachWebhooks, resolveWebhookUrls } from './webhooks.js';

export { createStore, STATUSES, ACTIVE_STATUSES } from './store.js';
export { createHttpServer, DEFAULT_PORT, DEFAULT_HOST } from './http.js';
export { attachWebhooks, resolveWebhookUrls } from './webhooks.js';
export { createAdapter, createJsonAdapter, createSqliteAdapter } from './persistence.js';

/**
 * @param {object} [options]
 * @param {number} [options.port]
 * @param {string} [options.host]
 * @param {string | null} [options.file]
 * @param {'json' | 'sqlite' | 'memory'} [options.store]
 * @param {string | null} [options.token]
 * @param {string[]} [options.webhooks]
 * @param {boolean} [options.quiet]
 */
export async function startEarmarkServer(options = {}) {
  const store = createStore({ file: options.file, store: options.store });
  await store.load();

  const webhooks = attachWebhooks(store, resolveWebhookUrls(options.webhooks), {
    quiet: options.quiet,
  });

  const http = createHttpServer(store, {
    port: options.port ?? DEFAULT_PORT,
    host: options.host ?? DEFAULT_HOST,
    token: options.token ?? null,
    quiet: options.quiet ?? false,
  });

  const address = await http.listen();

  return {
    store,
    webhooks,
    ...address,
    async close() {
      webhooks.unsubscribe();
      await http.close();
      await store.persist();
      await store.close();
    },
  };
}
