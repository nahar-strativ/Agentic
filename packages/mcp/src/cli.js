/**
 * `earmark-mcp init` and `earmark-mcp doctor`.
 *
 * init registers the MCP server in the project's `.mcp.json`; doctor answers
 * the only question anyone actually asks — "why can't the agent see my
 * annotations?" — by checking each link in the chain in order.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_HOST, DEFAULT_PORT } from 'earmark-server';

const SERVER_KEY = 'earmark';

/**
 * Add earmark to `.mcp.json`, preserving anything already there.
 *
 * @param {{cwd?: string, port?: number, store?: string}} [options]
 * @returns {Promise<{path: string, created: boolean, alreadyPresent: boolean}>}
 */
export async function initProject(options = {}) {
  const path = resolve(options.cwd || process.cwd(), '.mcp.json');

  /** @type {any} */
  let config = {};
  let created = true;
  try {
    config = JSON.parse(await readFile(path, 'utf8'));
    created = false;
  } catch {
    config = {};
  }

  config.mcpServers = config.mcpServers || {};
  const alreadyPresent = Boolean(config.mcpServers[SERVER_KEY]);

  const args = ['-y', 'earmark-mcp'];
  if (options.port && options.port !== DEFAULT_PORT) args.push('--port', String(options.port));
  if (options.store && options.store !== 'json') args.push('--store', options.store);

  config.mcpServers[SERVER_KEY] = { command: 'npx', args };

  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return { path, created, alreadyPresent };
}

/**
 * Probe for node:sqlite without printing Node's ExperimentalWarning — a
 * diagnostic tool should report the fact, not shout it.
 * @returns {Promise<boolean>}
 */
async function hasSqlite() {
  const original = process.emitWarning;
  process.emitWarning = () => {};
  try {
    await import('node:sqlite');
    return true;
  } catch {
    return false;
  } finally {
    process.emitWarning = original;
  }
}

/**
 * @typedef {{name: string, ok: boolean, detail: string, fix?: string}} Check
 */

/**
 * Run every diagnostic and return the results in the order they matter.
 *
 * @param {{cwd?: string, port?: number, host?: string}} [options]
 * @returns {Promise<Check[]>}
 */
export async function runDoctor(options = {}) {
  const cwd = options.cwd || process.cwd();
  const port = options.port || DEFAULT_PORT;
  const host = options.host || DEFAULT_HOST;
  const base = `http://${host}:${port}`;

  /** @type {Check[]} */
  const checks = [];

  // 1. Runtime
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Node version',
    ok: major >= 20,
    detail: `v${process.versions.node}`,
    fix: major >= 20 ? undefined : 'earmark needs Node 20 or newer.',
  });

  // 2. Optional sqlite backend
  const sqliteOk = await hasSqlite();
  checks.push({
    name: 'sqlite backend',
    ok: true, // never fatal — json is the default
    detail: sqliteOk ? 'available' : 'unavailable (json persistence will be used)',
    fix: sqliteOk ? undefined : 'node:sqlite needs Node 22.5+. Harmless unless you passed --store sqlite.',
  });

  // 3. MCP registration
  let registered = false;
  let mcpDetail = 'no .mcp.json in this directory';
  try {
    const config = JSON.parse(await readFile(resolve(cwd, '.mcp.json'), 'utf8'));
    registered = Boolean(config.mcpServers?.[SERVER_KEY]);
    mcpDetail = registered ? 'earmark is registered in .mcp.json' : '.mcp.json exists but has no earmark entry';
  } catch {
    /* keep the default message */
  }
  checks.push({
    name: 'MCP registration',
    ok: registered,
    detail: mcpDetail,
    fix: registered ? undefined : 'Run `npx earmark-mcp init`, or `claude mcp add earmark -- npx -y earmark-mcp`.',
  });

  // 4. Broker
  /** @type {any} */
  let health = null;
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
    health = response.ok ? await response.json() : null;
  } catch {
    health = null;
  }

  const brokerOk = Boolean(health?.ok);
  checks.push({
    name: 'Broker',
    ok: brokerOk,
    detail: brokerOk
      ? `responding on ${base} (${health.count} annotations, ${health.sessions} sessions)`
      : `nothing answering on ${base}`,
    fix: brokerOk
      ? undefined
      : 'The broker starts with the MCP server. If your agent is not running, start it manually: `npx earmark-server`.',
  });

  // 5. Browser overlay
  if (brokerOk) {
    /** @type {any[]} */
    let sessions = [];
    try {
      const response = await fetch(`${base}/sessions`, { signal: AbortSignal.timeout(2000) });
      sessions = (await response.json()).sessions || [];
    } catch {
      sessions = [];
    }

    const connected = sessions.filter((s) => s.connected);
    checks.push({
      name: 'Browser overlay',
      ok: connected.length > 0,
      detail: connected.length
        ? connected.map((s) => `${s.url} (${s.counts.total} annotations)`).join(', ')
        : sessions.length
          ? `${sessions.length} past session(s), none connected right now`
          : 'no browser tab has ever connected',
      fix: connected.length
        ? undefined
        : `Open your app and mount the overlay: createEarmark({ endpoint: '${base}' })`,
    });
  }

  return checks;
}

/**
 * @param {Check[]} checks
 * @returns {string}
 */
export function formatDoctor(checks) {
  const lines = ['earmark doctor', ''];

  for (const check of checks) {
    lines.push(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
    if (!check.ok && check.fix) lines.push(`    → ${check.fix}`);
    if (check.ok && check.fix) lines.push(`    note: ${check.fix}`);
  }

  const failures = checks.filter((c) => !c.ok);
  lines.push('');
  lines.push(
    failures.length
      ? `${failures.length} problem${failures.length === 1 ? '' : 's'} found.`
      : 'Everything checks out.',
  );
  lines.push('');

  return lines.join('\n');
}
