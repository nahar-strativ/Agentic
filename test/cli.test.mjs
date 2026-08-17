/**
 * `earmark-mcp init` and `earmark-mcp doctor`.
 *
 * Run with: node --test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject, runDoctor, formatDoctor } from 'earmark-mcp/cli';
import { startEarmarkServer } from 'earmark-server';

let dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'earmark-cli-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** @param {string} path */
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('init creates .mcp.json with an npx entry', async () => {
  const result = await initProject({ cwd: dir });
  assert.equal(result.created, true);
  assert.equal(result.alreadyPresent, false);

  const config = await readJson(result.path);
  assert.deepEqual(config.mcpServers.earmark, { command: 'npx', args: ['-y', 'earmark-mcp'] });
});

test('init preserves other servers already registered', async () => {
  await writeFile(
    join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { other: { command: 'node', args: ['other.js'] } } }, null, 2),
  );

  const result = await initProject({ cwd: dir });
  assert.equal(result.created, false);

  const config = await readJson(result.path);
  assert.deepEqual(config.mcpServers.other, { command: 'node', args: ['other.js'] });
  assert.ok(config.mcpServers.earmark);
});

test('init reports when earmark was already there, and refreshes the entry', async () => {
  const result = await initProject({ cwd: dir, port: 9999, store: 'sqlite' });
  assert.equal(result.alreadyPresent, true);

  const config = await readJson(result.path);
  assert.deepEqual(config.mcpServers.earmark.args, [
    '-y',
    'earmark-mcp',
    '--port',
    '9999',
    '--store',
    'sqlite',
  ]);
});

test('doctor reports a missing broker with a fix', async () => {
  // Port 1 is privileged and certainly not an earmark broker.
  const checks = await runDoctor({ cwd: dir, port: 1 });
  const broker = checks.find((c) => c.name === 'Broker');

  assert.equal(broker.ok, false);
  assert.match(broker.fix, /earmark-server/);

  // The overlay check is skipped entirely when there is no broker to ask.
  assert.equal(checks.some((c) => c.name === 'Browser overlay'), false);
});

test('doctor finds a running broker and reports no connected tab', async () => {
  const instance = await startEarmarkServer({ port: 0, file: null, quiet: true });
  try {
    const checks = await runDoctor({ cwd: dir, port: instance.port });

    const broker = checks.find((c) => c.name === 'Broker');
    assert.equal(broker.ok, true);
    assert.match(broker.detail, /0 annotations/);

    const overlay = checks.find((c) => c.name === 'Browser overlay');
    assert.equal(overlay.ok, false);
    assert.match(overlay.detail, /no browser tab has ever connected/);
    assert.match(overlay.fix, /createEarmark/);
  } finally {
    await instance.close();
  }
});

test('doctor sees a connected tab once one registers', async () => {
  const instance = await startEarmarkServer({ port: 0, file: null, quiet: true });
  const controller = new AbortController();

  try {
    await fetch(`${instance.url}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'tab-1', page: { url: 'http://localhost:5173/', path: '/' } }),
    });

    const res = await fetch(`${instance.url}/events?session=tab-1`, { signal: controller.signal });
    await res.body.getReader().read();

    const checks = await runDoctor({ cwd: dir, port: instance.port });
    const overlay = checks.find((c) => c.name === 'Browser overlay');
    assert.equal(overlay.ok, true);
    assert.match(overlay.detail, /http:\/\/localhost:5173\//);
  } finally {
    controller.abort();
    await instance.close();
  }
});

test('doctor flags a project with no MCP registration', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'earmark-bare-'));
  try {
    const checks = await runDoctor({ cwd: empty, port: 1 });
    const registration = checks.find((c) => c.name === 'MCP registration');
    assert.equal(registration.ok, false);
    assert.match(registration.detail, /no \.mcp\.json/);
    assert.match(registration.fix, /earmark-mcp init/);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test('the report marks failures and counts them', async () => {
  const output = formatDoctor([
    { name: 'Node version', ok: true, detail: 'v24.0.0' },
    { name: 'Broker', ok: false, detail: 'nothing answering', fix: 'start it' },
  ]);

  assert.match(output, /✓ Node version: v24\.0\.0/);
  assert.match(output, /✗ Broker: nothing answering/);
  assert.match(output, /→ start it/);
  assert.match(output, /1 problem found/);
});

test('a clean report says so', () => {
  const output = formatDoctor([{ name: 'Node version', ok: true, detail: 'v24.0.0' }]);
  assert.match(output, /Everything checks out/);
});
