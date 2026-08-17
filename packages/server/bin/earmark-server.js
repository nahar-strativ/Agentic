#!/usr/bin/env node
/**
 * earmark-server — standalone annotation broker.
 *
 * Usage:
 *   npx earmark-server [--port 7331] [--host 127.0.0.1] [--file .earmark/annotations.json]
 *                      [--token SECRET] [--no-persist] [--quiet]
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

const has = (/** @type {string} */ name) => argv.includes(`--${name}`);

if (has('help')) {
  process.stdout.write(
    [
      'earmark-server — local annotation broker for the earmark overlay',
      '',
      '  --port <n>     port to listen on (default 7331)',
      '  --host <addr>  interface to bind (default 127.0.0.1; loopback only is intended)',
      '  --file <path>  persistence file (default .earmark/annotations.json)',
      '  --no-persist   keep annotations in memory only',
      '  --token <s>    require ?token= or x-earmark-token on every request',
      '  --quiet        suppress request logging',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const instance = await startEarmarkServer({
  port: Number(flag('port', '7331')),
  host: flag('host', '127.0.0.1'),
  file: has('no-persist') ? null : flag('file'),
  token: has('token') ? flag('token') : null,
  quiet: has('quiet'),
});

process.stderr.write(
  `earmark-server listening on ${instance.url}\n` +
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
