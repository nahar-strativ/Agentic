#!/usr/bin/env node
/**
 * earmark MCP server.
 *
 *   claude mcp add earmark -- npx -y earmark-mcp
 *   npx earmark-mcp init      register in this project's .mcp.json
 *   npx earmark-mcp doctor    diagnose "the agent cannot see my annotations"
 *
 * With no subcommand it speaks MCP over stdio, which is what an agent expects.
 */

import { createEarmarkMcp } from '../src/index.js';
import { initProject, runDoctor, formatDoctor } from '../src/cli.js';

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'server';

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

const port = Number(flag('port', '7331'));
const backend = has('no-persist') ? 'memory' : flag('store', process.env.EARMARK_STORE || 'json');

if (command === 'help' || has('help')) {
  process.stdout.write(
    [
      'earmark-mcp — MCP server for earmark UI annotations',
      '',
      '  earmark-mcp [server]   speak MCP over stdio (default)',
      '  earmark-mcp init       add earmark to .mcp.json in this directory',
      '  earmark-mcp doctor     check runtime, registration, broker and overlay',
      '',
      '  --port <n>      broker port (default 7331)',
      '  --host <addr>   broker interface (default 127.0.0.1)',
      '  --store <kind>  json (default) | sqlite | memory',
      '  --file <path>   persistence file',
      '  --webhook <url> POST every annotation event here; repeatable',
      '  --token <s>     require a token on broker requests',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

if (command === 'init') {
  const result = await initProject({ port, store: backend });
  process.stdout.write(
    [
      result.created ? `Created ${result.path}` : `Updated ${result.path}`,
      result.alreadyPresent ? 'earmark was already registered; the entry has been refreshed.' : '',
      '',
      'Next:',
      '  1. Restart your agent so it picks up the new MCP server.',
      '  2. Mount the overlay in your app:',
      "       import { createEarmark } from 'earmark'",
      '       if (import.meta.env.DEV) createEarmark()',
      '  3. Check everything is wired: npx earmark-mcp doctor',
    ]
      .filter(Boolean)
      .join('\n')
      .concat('\n'),
  );
  process.exit(0);
}

if (command === 'doctor') {
  const checks = await runDoctor({ port, host: flag('host', '127.0.0.1') });
  process.stdout.write(formatDoctor(checks));
  process.exit(checks.some((c) => !c.ok) ? 1 : 0);
}

const instance = await createEarmarkMcp({
  port,
  host: flag('host', '127.0.0.1'),
  store: /** @type {any} */ (backend),
  file: backend === 'memory' ? null : flag('file'),
  token: has('token') ? flag('token') : null,
  webhooks: flags('webhook'),
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
