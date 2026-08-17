/**
 * HTTP + SSE front end for the annotation store.
 *
 * Binds to the loopback interface only. It is a development tool: there is no
 * authentication unless you pass a token, and any page open in your browser can
 * reach a loopback port. Do not run it on a shared or public machine, and do
 * not bind it to 0.0.0.0.
 */

import { createServer } from 'node:http';
import { batchToMarkdown } from 'earmark/markdown';

export const DEFAULT_PORT = 7331;
export const DEFAULT_HOST = '127.0.0.1';

/**
 * @param {import('./store.js').createStore extends (...a: any) => infer R ? R : never} store
 * @param {object} [options]
 * @param {number} [options.port]
 * @param {string} [options.host]
 * @param {string | null} [options.token] optional shared secret; when set, every
 *   request must carry `?token=` or an `x-earmark-token` header
 * @param {boolean} [options.quiet]
 */
export function createHttpServer(store, options = {}) {
  const {
    port = DEFAULT_PORT,
    host = DEFAULT_HOST,
    token = null,
    quiet = false,
  } = options;

  /** @param {string} message */
  const log = (message) => {
    if (!quiet) process.stderr.write(`earmark: ${message}\n`);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    cors(req, res);
    if (req.method === 'OPTIONS') return end(res, 204);

    if (token) {
      const provided = url.searchParams.get('token') || req.headers['x-earmark-token'];
      if (provided !== token) return json(res, 401, { error: 'invalid token' });
    }

    try {
      await route(req, res, url);
    } catch (error) {
      log(`request failed — ${error.stack || error.message}`);
      if (!res.headersSent) json(res, 500, { error: String(error.message || error) });
    }
  });

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   */
  async function route(req, res, url) {
    const { pathname } = url;
    const method = req.method || 'GET';

    if (pathname === '/health') {
      return json(res, 200, {
        ok: true,
        service: 'earmark-server',
        version: '0.1.0',
        count: store.size,
        sessions: store.sessionCount,
        cursor: store.cursor,
      });
    }

    if (pathname === '/events' && method === 'GET') {
      return stream(req, res, url);
    }

    if (pathname === '/session' && method === 'POST') {
      const body = await readJson(req);
      const session = store.touchSession(body.sessionId, { page: body.page });
      return session ? json(res, 200, session) : json(res, 400, { error: 'sessionId required' });
    }

    if (pathname === '/sessions' && method === 'GET') {
      return json(res, 200, { sessions: store.listSessions() });
    }

    const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch && method === 'GET') {
      const session = store.getSession(decodeURIComponent(sessionMatch[1]));
      return session ? json(res, 200, session) : json(res, 404, { error: 'not found' });
    }

    if (pathname === '/markdown' && method === 'GET') {
      const items = store.list(filterFrom(url));
      const body = items.length
        ? batchToMarkdown(items, items[0].page)
        : '## UI feedback\n\nNo annotations.\n';
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      return res.end(body);
    }

    if (pathname === '/annotations/wait' && method === 'GET') {
      const result = await store.waitForChange({
        since: Number(url.searchParams.get('since') || 0),
        timeoutMs: Number(url.searchParams.get('timeout') || 30000),
        status: url.searchParams.getAll('status').length ? url.searchParams.getAll('status') : undefined,
      });
      return json(res, 200, result);
    }

    if (pathname === '/annotations') {
      if (method === 'GET') {
        const items = store.list(filterFrom(url));
        return json(res, 200, { annotations: items, cursor: store.cursor });
      }
      if (method === 'POST') {
        const body = await readJson(req);
        const incoming = Array.isArray(body.annotations) ? body.annotations : [body];
        const created = incoming.map((a) =>
          store.create(a, { sessionId: body.sessionId, page: body.page }),
        );
        log(`+${created.length} annotation${created.length === 1 ? '' : 's'} (${store.size} total)`);
        return json(res, 201, { annotations: created, cursor: store.cursor });
      }
      if (method === 'DELETE') {
        return json(res, 200, { cleared: store.clear() });
      }
      return json(res, 405, { error: 'method not allowed' });
    }

    const replyMatch = pathname.match(/^\/annotations\/([^/]+)\/replies$/);
    if (replyMatch && method === 'POST') {
      const body = await readJson(req);
      const updated = store.addReply(
        decodeURIComponent(replyMatch[1]),
        { author: body.author === 'agent' ? 'agent' : 'human', message: String(body.message || '') },
        body.status,
      );
      return updated ? json(res, 200, updated) : json(res, 404, { error: 'not found' });
    }

    const idMatch = pathname.match(/^\/annotations\/([^/]+)$/);
    if (idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      if (method === 'GET') {
        const found = store.get(id);
        return found ? json(res, 200, found) : json(res, 404, { error: 'not found' });
      }
      if (method === 'PATCH') {
        const body = await readJson(req);
        const updated = store.update(id, body);
        return updated ? json(res, 200, updated) : json(res, 404, { error: 'not found' });
      }
      if (method === 'DELETE') {
        return store.remove(id) ? end(res, 204) : json(res, 404, { error: 'not found' });
      }
    }

    return json(res, 404, { error: `no route for ${method} ${pathname}` });
  }

  /**
   * Server-sent events: one long-lived response per connected browser tab.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   */
  function stream(req, res, url) {
    // The SSE connection *is* the liveness signal for a tab: it opens when the
    // overlay mounts and closes when the tab does.
    const sessionId = url.searchParams.get('session');
    if (sessionId) store.setSessionConnected(sessionId, true);

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`retry: 2000\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'hello', data: { cursor: store.cursor } })}\n\n`);

    const unsubscribe = store.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Comment frames keep proxies and idle-socket timeouts from closing us.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    heartbeat.unref?.();

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (sessionId) store.setSessionConnected(sessionId, false);
    });
  }

  return {
    server,
    /** @returns {Promise<{port: number, host: string, url: string}>} */
    listen() {
      return new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          const address = server.address();
          const actualPort = typeof address === 'object' && address ? address.port : port;
          resolvePromise({ port: actualPort, host, url: `http://${host}:${actualPort}` });
        });
      });
    },
    close() {
      return new Promise((resolvePromise) => server.close(() => resolvePromise(undefined)));
    },
  };
}

/** @param {URL} url */
function filterFrom(url) {
  const status = url.searchParams.getAll('status');
  const sessionId = url.searchParams.get('session');
  return {
    ...(status.length ? { status } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function cors(req, res) {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-earmark-token');
  res.setHeader('vary', 'origin');
}

/** @param {import('node:http').IncomingMessage} req */
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Annotation batches are small; anything larger is a bug or an attack.
    if (size > 5_000_000) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {any} body
 */
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 */
function end(res, status) {
  res.writeHead(status);
  res.end();
}
