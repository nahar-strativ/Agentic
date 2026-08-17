#!/usr/bin/env node
/**
 * earmark MCP server entry point.
 *
 * Register with Claude Code:
 *   claude mcp add earmark -- npx -y earmark-mcp
 *
 * Flags: --port --host --file --no-persist --token
 */

import { createEarmarkMcp } from '../src/index.js';

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

const instance = await createEarmarkMcp({
  port: Number(flag('port', '7331')),
  host: flag('host', '127.0.0.1'),
  file: has('no-persist') ? null : flag('file'),
  token: has('token') ? flag('token') : null,
});

await instance.start();

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (closing) process.exit(1);
    closing = true;
    await instance.close();
    process.exit(0);
  });
}
