#!/usr/bin/env node
/**
 * earmark-server — standalone annotation broker.
 *
 * Usage:
 *   npx earmark-server [--port 7331] [--host 127.0.0.1] [--store json|sqlite|memory]
 *                      [--file PATH] [--token SECRET] [--webhook URL] [--quiet]
 */

import { startEarmarkServer } from '../src/index.js';

const argv = process.argv.slice(2);

/**
 * @param {string} name
 * @param {string} [fallback]
 */
function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : 'true';
}

/** Repeatable flags, e.g. --webhook A --webhook B */
function flags(name) {
  const out = [];
  argv.forEach((arg, index) => {
    if (arg !== `--${name}`) return;
    const value = argv[index + 1];
    if (value && !value.startsWith('--')) out.push(value);
  });
  return out;
}

const has = (/** @type {string} */ name) => argv.includes(`--${name}`);

if (has('help')) {
  process.stdout.write(
    [
      'earmark-server — local annotation broker for the earmark overlay',
      '',
      '  --port <n>      port to listen on (default 7331)',
      '  --host <addr>   interface to bind (default 127.0.0.1; loopback only is intended)',
      '  --store <kind>  json (default) | sqlite | memory',
      '  --file <path>   persistence file (default .earmark/annotations.json or .db)',
      '  --no-persist    alias for --store memory',
      '  --webhook <url> POST every annotation event here; repeatable',
      '  --token <s>     require ?token= or x-earmark-token on every request',
      '  --quiet         suppress request logging',
      '',
      'Environment: EARMARK_STORE, EARMARK_WEBHOOK_URL, EARMARK_WEBHOOKS',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const backend = has('no-persist') ? 'memory' : flag('store', process.env.EARMARK_STORE || 'json');

const instance = await startEarmarkServer({
  port: Number(flag('port', '7331')),
  host: flag('host', '127.0.0.1'),
  store: /** @type {any} */ (backend),
  file: backend === 'memory' ? null : flag('file'),
  token: has('token') ? flag('token') : null,
  webhooks: flags('webhook'),
  quiet: has('quiet'),
});

process.stderr.write(
  `earmark-server listening on ${instance.url}\n` +
    `  storage:  ${instance.store.backend}\n` +
    `  overlay:  createEarmark({ endpoint: '${instance.url}' })\n` +
    `  markdown: curl ${instance.url}/markdown\n`,
);

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (closing) process.exit(1);
    closing = true;
    process.stderr.write('\nearmark-server shutting down…\n');
    await instance.close();
    process.exit(0);
  });
}
