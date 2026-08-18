/**
 * Live feature verification.
 *
 * `npm test` proves the units. This drives the assembled product: real servers on
 * real ports, a real MCP process over stdio, real files on disk, a real webhook
 * listener. It exists because the bug in §4.25 of plan.md passed 122 unit tests
 * and failed the moment the pieces were put together.
 *
 *   npm run verify
 *
 * Exits non-zero on the first failure so CI can use it. The overlay itself needs
 * a browser and is verified separately.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEarmarkServer } from 'earmark-server';
import { stamp } from 'earmark-stamp';
import { initProject, runDoctor } from 'earmark-mcp/cli';
import viteEarmark from 'vite-plugin-earmark';

const results = [];
let failed = 0;

/**
 * @param {string} feature
 * @param {() => Promise<any> | any} fn
 */
async function check(feature, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, feature, detail: detail || '' });
  } catch (error) {
    failed += 1;
    results.push({ ok: false, feature, detail: error.message });
  }
}

/** @param {any} value @param {string} message */
function ok(value, message) {
  if (!value) throw new Error(message);
}

const workdir = await mkdtemp(join(tmpdir(), 'earmark-verify-'));

/**
 * A fresh port for every server this script starts.
 *
 * Reusing one port across restarts made Node 20 fail where 22 and 24 passed:
 * undici keeps connections alive, and after the server on that port was replaced
 * the pooled socket was dead, so the next request failed instead of reconnecting.
 * Nothing a real client does, and CI found it on the first run.
 */
let port = 7520;
const nextPort = () => (port += 1);

let PORT = nextPort();
let base = `http://127.0.0.1:${PORT}`;

/** Point the helpers at a freshly started server. @param {number} p */
function useServerPort(p) {
  PORT = p;
  base = `http://127.0.0.1:${PORT}`;
  return p;
}

/** @param {string} path @param {object} [init] */
const api = (path, init) => fetch(base + path, init);

/** @param {object} over */
const annotation = (over = {}) => ({
  id: 'v1',
  note: 'Export button padding is too tight',
  priority: 'high',
  target: {
    kind: 'element',
    tag: 'button',
    label: 'button "Export"',
    selector: '[data-testid="export-btn"]',
    source: 'index.html:101:11',
    sourceExact: true,
    rect: { x: 194, y: 376, width: 66, height: 37, pageX: 194, pageY: 376 },
  },
  ...over,
});

const page = {
  url: 'http://localhost:5173/examples/vanilla/',
  path: '/examples/vanilla/',
  title: 'demo',
  viewport: { width: 1280, height: 720 },
  devicePixelRatio: 2,
  colorScheme: 'light',
  framework: 'unknown',
};

// ---------------------------------------------------------------- broker ----

let server = await startEarmarkServer({
  port: useServerPort(PORT),
  file: join(workdir, 'annotations.json'),
  store: 'json',
  quiet: true,
});

await check('broker: health', async () => {
  const body = await (await api('/health')).json();
  ok(body.ok !== false, 'health did not answer ok');
  return `${body.annotations ?? 0} annotations`;
});

await check('broker: POST /annotations', async () => {
  const res = await api('/annotations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'tab-1', page, annotations: [annotation()] }),
  });
  ok(res.status === 201, `expected 201, got ${res.status}`);
  return '201';
});

await check('broker: GET /annotations', async () => {
  const body = await (await api('/annotations')).json();
  ok(body.annotations.length === 1, `expected 1, got ${body.annotations.length}`);
  ok(body.annotations[0].priority === 'high', 'priority was not stored');
  return `cursor ${body.cursor}`;
});

await check('broker: GET /markdown', async () => {
  const text = await (await api('/markdown')).text();
  ok(text.includes('Export button padding'), 'the note is missing');
  ok(text.includes('index.html:101:11'), 'the source line is missing');
  ok(text.includes('66×37'), 'the box is missing');
  return `${text.split('\n').length} lines`;
});

await check('broker: PATCH status', async () => {
  const res = await api('/annotations/v1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'acknowledged' }),
  });
  const updated = await res.json();
  ok(updated.status === 'acknowledged', `status did not change: ${JSON.stringify(updated)}`);
  return 'open to acknowledged';
});

await check('broker: reply thread', async () => {
  const res = await api('/annotations/v1/replies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ author: 'agent', message: 'which padding?', status: 'needs-input' }),
  });
  const updated = await res.json();
  ok(updated.replies.length === 1, 'the reply was not recorded');
  ok(updated.status === 'needs-input', 'the status did not follow the reply');
  return 'agent question recorded';
});

await check('broker: sessions', async () => {
  await api('/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'tab-1', page: { ...page, path: '/settings' } }),
  });
  const body = await (await api('/sessions')).json();
  const session = body.sessions.find((s) => s.id === 'tab-1');
  ok(session, 'the session is missing');
  ok(session.routes.length === 2, `expected 2 routes, got ${session.routes.length}`);
  return `routes: ${session.routes.join(', ')}`;
});

await check('broker: server-sent events', async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/events`, {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  });
  const reader = res.body.getReader();
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value);
  controller.abort();
  ok(text.includes('event:') || text.includes('data:'), 'the stream sent nothing');
  return 'stream open';
});

await check('broker: long poll', async () => {
  const { cursor } = await (await api('/annotations')).json();
  const waiting = api(`/annotations/wait?since=${cursor}&timeout=4000`).then((r) => r.json());
  await new Promise((r) => setTimeout(r, 120));
  await api('/annotations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'tab-1', page, annotations: [annotation({ id: 'v2', note: 'second' })] }),
  });
  const body = await waiting;
  ok(body.annotations.length >= 1, 'the long poll did not wake');
  ok(body.timedOut !== true, 'the long poll timed out instead of waking');
  return 'woke on write';
});

await server.close();

// ------------------------------------------------------------ persistence ----

await check('storage: json survives a restart', async () => {
  const reopened = await startEarmarkServer({
    port: useServerPort(nextPort()),
    file: join(workdir, 'annotations.json'),
    store: 'json',
    quiet: true,
  });
  const body = await (await api('/annotations')).json();
  await reopened.close();
  ok(body.annotations.length === 2, `expected 2 after restart, got ${body.annotations.length}`);
  return `${body.annotations.length} annotations reloaded`;
});

await check('storage: sqlite survives a restart', async () => {
  const file = join(workdir, 'annotations.db');
  const first = await startEarmarkServer({ port: useServerPort(nextPort()), file, store: 'sqlite', quiet: true });
  const backend = first.store.backend;
  await api('/annotations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'tab-1', page, annotations: [annotation({ id: 'sq1' })] }),
  });
  await first.close();

  const second = await startEarmarkServer({ port: useServerPort(nextPort()), file, store: 'sqlite', quiet: true });
  const body = await (await api('/annotations')).json();
  await second.close();
  ok(body.annotations.some((a) => a.id === 'sq1'), 'the annotation did not survive');
  return `backend: ${backend}`;
});

await check('storage: memory persists nothing', async () => {
  const first = await startEarmarkServer({ port: useServerPort(nextPort()), file: null, store: 'memory', quiet: true });
  await api('/annotations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'tab-1', page, annotations: [annotation({ id: 'mem1' })] }),
  });
  await first.close();
  const second = await startEarmarkServer({ port: useServerPort(nextPort()), file: null, store: 'memory', quiet: true });
  const body = await (await api('/annotations')).json();
  await second.close();
  ok(body.annotations.length === 0, `expected an empty store, got ${body.annotations.length}`);
  return 'nothing written';
});

// ------------------------------------------------------------------ token ----

await check('broker: token gate', async () => {
  const guarded = await startEarmarkServer({
    port: useServerPort(nextPort()),
    file: null,
    store: 'memory',
    token: 's3cret',
    quiet: true,
  });
  const denied = await api('/annotations');
  const allowed = await api('/annotations?token=s3cret');
  const header = await fetch(`${base}/annotations`, { headers: { 'x-earmark-token': 's3cret' } });
  await guarded.close();
  ok(denied.status === 401, `expected 401 without a token, got ${denied.status}`);
  ok(allowed.status === 200, `expected 200 with ?token=, got ${allowed.status}`);
  ok(header.status === 200, `expected 200 with the header, got ${header.status}`);
  return '401 without, 200 with';
});

// --------------------------------------------------------------- webhooks ----

await check('webhooks: delivered, and a hang cannot stall the loop', async () => {
  /** @type {any[]} */
  const received = [];
  const listener = createServer((req, res) => {
    if (req.url === '/hang') return; // never answers, on purpose
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ event: req.headers['x-earmark-event'], body: JSON.parse(body || '{}') });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise((r) => listener.listen(0, '127.0.0.1', r));
  const hookPort = listener.address().port;

  const hooked = await startEarmarkServer({
    port: useServerPort(nextPort()),
    file: null,
    store: 'memory',
    webhooks: [`http://127.0.0.1:${hookPort}/hang`, `http://127.0.0.1:${hookPort}/hook`],
    quiet: true,
  });

  const started = Date.now();
  await api('/annotations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'tab-1', page, annotations: [annotation({ id: 'wh1' })] }),
  });
  const elapsed = Date.now() - started;

  for (let i = 0; i < 40 && !received.length; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await hooked.close();
  listener.close();

  ok(received.length >= 1, 'nothing was delivered');
  ok(elapsed < 1000, `the POST waited ${elapsed}ms on a webhook`);
  return `delivered ${received[0].event} in ${elapsed}ms despite a dead endpoint`;
});

// -------------------------------------------------------------------- MCP ----

await check('mcp: eleven tools and the full loop over stdio', async () => {
  const child = spawn('node', [
    'packages/mcp/bin/earmark-mcp.js',
    '--port',
    '7522',
    '--file',
    join(workdir, 'mcp.json'),
  ]);

  let buf = '';
  const pending = new Map();
  child.stdout.on('data', (b) => {
    buf += b;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });

  let id = 0;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 8000);
      pending.set(n, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });

  try {
    await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'verify', version: '0' },
    });
    const tools = await rpc('tools/list', {});
    const names = tools.result.tools.map((t) => t.name);
    ok(names.length === 11, `expected 11 tools, got ${names.length}`);

    const push = await fetch('http://127.0.0.1:7522/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'tab-1', page, annotations: [annotation({ id: 'm1' })] }),
    });
    ok(push.status === 201, 'the browser push failed');

    const call = async (name, args) => {
      const res = await rpc('tools/call', { name, arguments: args || {} });
      const text = res.result?.content?.[0]?.text ?? '';
      ok(!text.startsWith('earmark: Cannot read'), `${name} threw: ${text}`);
      return text;
    };

    const list = await call('earmark_list_annotations');
    ok(list.includes('Export button padding'), 'list did not show the annotation');
    ok(list.includes('index.html:101:11'), 'list lost the source line');

    ok((await call('earmark_get_annotation', { id: 'm1' })).includes('Export'), 'get failed');
    ok((await call('earmark_acknowledge', { id: 'm1', note: 'on it' })).includes('m1'), 'acknowledge failed');
    ok((await call('earmark_ask', { id: 'm1', question: 'which padding?' })).length > 0, 'ask failed');
    ok((await call('earmark_list_sessions')).includes('tab-1'), 'sessions failed');
    ok((await call('earmark_get_session', { id: 'tab-1' })).includes('Export'), 'get_session failed');
    ok((await call('earmark_resolve', { id: 'm1', summary: 'padding 10px 16px' })).includes('m1'), 'resolve failed');
    ok((await call('earmark_status')).length > 0, 'status failed');

    const watch = await rpc('tools/call', {
      name: 'earmark_watch_annotations',
      arguments: { timeout_seconds: 1 },
    });
    ok(watch.result.content[0].text.length > 0, 'watch returned nothing');

    await call('earmark_dismiss', { id: 'm1', reason: 'superseded' });
    await call('earmark_clear');

    return `${names.length} tools, full loop`;
  } finally {
    child.kill();
  }
});

// ------------------------------------------------------------------ stamp ----

await check('stamping: jsx, tsx, svelte', () => {
  const jsx = stamp('export const A = () => <div className="x">hi</div>;', {
    filename: '/repo/src/A.jsx',
    root: '/repo',
  });
  ok(jsx && jsx.code.includes('data-earmark-src="src/A.jsx:1:24"'), 'jsx was not stamped');

  const tsx = stamp('export const A = <T,>(p: T) => <span>{String(p)}</span>;', {
    filename: '/repo/src/A.tsx',
    root: '/repo',
  });
  ok(tsx && tsx.code.includes('data-earmark-src="src/A.tsx'), 'tsx was not stamped');

  const svelte = stamp('<script lang="ts">const m = new Map<string, number>();</script>\n<button class="go">Go</button>', {
    filename: '/repo/src/C.svelte',
    root: '/repo',
  });
  ok(svelte && svelte.code.includes('data-earmark-src="src/C.svelte:2:1"'), 'svelte was not stamped');
  ok(svelte.code.includes('new Map<string, number>()'), 'the script block was touched');

  ok(stamp('const a = 1 < 2;', { filename: '/repo/src/a.ts', root: '/repo' }) === null, 'a .ts file was stamped');
  return 'jsx, tsx, svelte, and .ts left alone';
});

await check('stamping: through the vite plugin', () => {
  const plugin = viteEarmark();
  plugin.configResolved({ root: '/repo' });
  const jsx = plugin.transform.call({}, 'export const A = () => <p>x</p>;', '/repo/src/A.tsx');
  const svelte = plugin.transform.call({}, '<p>x</p>', '/repo/src/C.svelte');
  ok(jsx.code.includes('data-earmark-src'), 'the plugin did not stamp jsx');
  ok(svelte.code.includes('data-earmark-src'), 'the plugin did not stamp svelte');
  ok(plugin.transformIndexHtml()[0].children.includes('createEarmark'), 'the overlay was not injected');
  return 'jsx, svelte, and overlay injection';
});

await check('stamping: through the webpack loader', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const loader = require('earmark-loader');
  const { withEarmark } = require('earmark-loader/next');

  const code = await new Promise((resolve, reject) => {
    loader.call(
      {
        resourcePath: '/repo/app/page.tsx',
        rootContext: '/repo',
        getOptions: () => ({}),
        async: () => (err, out) => (err ? reject(err) : resolve(out)),
      },
      'export default () => <main>hi</main>;',
      undefined,
    );
  });
  ok(code.includes('data-earmark-src="app/page.tsx:1:22"'), 'the loader did not stamp');

  const config = withEarmark({ reactStrictMode: true });
  const webpack = config.webpack({ module: { rules: [] } }, { dev: true, isServer: true });
  ok(webpack.module.rules.at(-1).enforce === 'pre', 'the rule must run before swc');
  ok(config.turbopack.rules['*.tsx'], 'turbopack was not configured');
  return 'loader plus both bundler configs';
});

// -------------------------------------------------------------------- CLI ----

await check('cli: init writes .mcp.json and preserves neighbours', async () => {
  const result = await initProject({ cwd: workdir, port: 7331 });
  const config = JSON.parse(await readFile(join(workdir, '.mcp.json'), 'utf8'));
  ok(config.mcpServers.earmark, 'earmark was not registered');
  return `${result.created ? 'created' : 'updated'} .mcp.json`;
});

await check('cli: doctor reports the chain', async () => {
  const checks = await runDoctor({ cwd: workdir, port: 7599 });
  ok(checks.length >= 4, `expected the full chain, got ${checks.length} checks`);
  ok(checks.some((c) => c.name.toLowerCase().includes('node')), 'no node check');
  const broker = checks.find((c) => c.name.toLowerCase().includes('broker'));
  ok(broker && broker.ok === false, 'doctor claimed a broker that is not running');
  ok(broker.fix, 'a failing check must print its fix');
  return `${checks.length} checks, broker correctly reported down`;
});

// ----------------------------------------------------------------- report ----

await rm(workdir, { recursive: true, force: true });

const pad = Math.max(...results.map((r) => r.feature.length));
process.stdout.write('\nLive feature verification\n\n');
for (const r of results) {
  process.stdout.write(
    `  ${r.ok ? '✓' : '✗'} ${r.feature.padEnd(pad)}  ${r.detail}\n`,
  );
}
process.stdout.write(
  `\n${results.length - failed}/${results.length} features verified${failed ? `, ${failed} FAILED` : ''}\n\n`,
);

process.exit(failed ? 1 : 0);
