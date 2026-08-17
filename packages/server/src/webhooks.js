/**
 * Webhook fan-out.
 *
 * Every store event can be POSTed to external services — a Slack relay, a
 * Linear bridge, a CI hook. Deliveries are fire-and-forget with a timeout: a
 * slow or dead endpoint must never stall the annotation loop.
 *
 * Note that a webhook sends annotation content off the machine: page URLs,
 * element text and whatever the human typed. Only configure endpoints you
 * control.
 */

const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 2;

/** Events worth telling an external service about. */
const DELIVERABLE = new Set([
  'annotation.created',
  'annotation.updated',
  'annotation.deleted',
  'annotations.cleared',
]);

/**
 * Collect webhook URLs from explicit options and the environment.
 *
 * @param {string[]} [explicit]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function resolveWebhookUrls(explicit = [], env = process.env) {
  const fromEnv = [
    ...(env.EARMARK_WEBHOOK_URL ? [env.EARMARK_WEBHOOK_URL] : []),
    ...(env.EARMARK_WEBHOOKS ? env.EARMARK_WEBHOOKS.split(',') : []),
  ];

  const all = [...explicit, ...fromEnv].map((url) => url.trim()).filter(Boolean);

  return [...new Set(all)].filter((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      process.stderr.write(`earmark: ignoring malformed webhook url "${url}"\n`);
      return false;
    }
  });
}

/**
 * Subscribe webhook delivery to a store.
 *
 * @param {any} store
 * @param {string[]} urls
 * @param {{quiet?: boolean, fetchImpl?: typeof fetch}} [options]
 * @returns {{urls: string[], unsubscribe: () => void, delivered: () => number, failed: () => number}}
 */
export function attachWebhooks(store, urls, options = {}) {
  const { quiet = false, fetchImpl = fetch } = options;
  let delivered = 0;
  let failed = 0;

  if (!urls.length) {
    return { urls, unsubscribe: () => {}, delivered: () => 0, failed: () => 0 };
  }

  /**
   * @param {string} url
   * @param {object} payload
   */
  async function deliver(url, payload) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'earmark-server',
            'x-earmark-event': payload.event,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.ok) {
          delivered += 1;
          return;
        }
        if (response.status < 500) break; // 4xx will not improve on retry
      } catch {
        /* network error or timeout — retried below */
      }
    }
    failed += 1;
    if (!quiet) process.stderr.write(`earmark: webhook delivery failed — ${url}\n`);
  }

  const unsubscribe = store.subscribe((event) => {
    if (!DELIVERABLE.has(event.type)) return;
    const payload = {
      event: event.type,
      at: new Date().toISOString(),
      data: event.data,
    };
    for (const url of urls) deliver(url, payload);
  });

  if (!quiet) {
    process.stderr.write(`earmark: webhooks enabled → ${urls.join(', ')}\n`);
  }

  return { urls, unsubscribe, delivered: () => delivered, failed: () => failed };
}
