/**
 * End-to-end MCP surface: a real stdio client drives the real server, and the
 * "browser" is a plain fetch against the broker the MCP process embeds.
 *
 * Run with: node --test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7412;
const BROKER = `http://127.0.0.1:${PORT}`;

/** @type {Client} */
let client;

const target = {
  kind: 'element',
  label: '<RevenueCard>',
  tag: 'section',
  selector: '[data-testid="revenue-card"]',
  testId: 'revenue-card',
  domPath: 'body > main > section',
  text: 'Revenue $48,220',
  attributes: {},
  rect: { x: 32, y: 180, width: 300, height: 168, pageX: 32, pageY: 180 },
  styles: { border: '1px solid rgb(38, 43, 53)', borderRadius: '12px' },
  framework: 'react',
  components: ['App', 'Dashboard', 'RevenueCard'],
  source: 'src/components/RevenueCard.tsx:12:5',
  sourceExact: true,
  ancestors: [],
};

const page = {
  url: 'http://localhost:5173/',
  viewport: { width: 1440, height: 900 },
  devicePixelRatio: 2,
  colorScheme: 'dark',
  framework: 'react',
  scroll: { x: 0, y: 0 },
};

/** Stand in for the browser overlay pushing an annotation. */
async function overlayPush(note) {
  const res = await fetch(`${BROKER}/annotations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'test', page, annotations: [{ note, targets: [target] }] }),
  });
  const body = await res.json();
  return body.annotations[0];
}

/**
 * @param {string} name
 * @param {object} [args]
 * @returns {Promise<string>}
 */
async function callTool(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return result.content.map((c) => c.text).join('\n');
}

before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(repoRoot, 'packages/mcp/bin/earmark-mcp.js'), '--port', String(PORT), '--no-persist'],
    cwd: repoRoot,
  });
  client = new Client({ name: 'earmark-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
});

after(async () => {
  await client.close();
});

test('exposes the agent tool surface', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'earmark_acknowledge',
    'earmark_ask',
    'earmark_clear',
    'earmark_dismiss',
    'earmark_get_annotation',
    'earmark_get_session',
    'earmark_list_annotations',
    'earmark_list_sessions',
    'earmark_resolve',
    'earmark_status',
    'earmark_watch_annotations',
  ]);
  for (const tool of tools) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a usable description`);
    assert.equal(tool.inputSchema.type, 'object');
  }
});

test('status reports the broker endpoint the overlay should use', async () => {
  const output = await callTool('earmark_status');
  assert.match(output, new RegExp(`Broker listening on ${BROKER}`));
  assert.match(output, /open: 0/);
});

test('list is explicit when there is nothing to report', async () => {
  const output = await callTool('earmark_list_annotations');
  assert.match(output, /has not annotated anything yet/);
});

test('annotations pushed by the overlay reach the agent as markdown', async () => {
  await overlayPush('This card should use the elevated surface token');

  const output = await callTool('earmark_list_annotations');
  assert.match(output, /## UI feedback — 1 annotation/);
  assert.match(output, /This card should use the elevated surface token/);
  assert.match(output, /\*\*Source:\*\* `src\/components\/RevenueCard\.tsx:12:5`/);
  assert.match(output, /\*\*Selector:\*\* `\[data-testid="revenue-card"\]`/);
  assert.match(output, /cursor: \d+/);
});

test('json format returns the raw payload', async () => {
  const output = await callTool('earmark_list_annotations', { format: 'json' });
  const parsed = JSON.parse(output);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].targets[0].selector, '[data-testid="revenue-card"]');
});

test('ask moves the annotation to needs-input and records the question', async () => {
  const [existing] = await (await fetch(`${BROKER}/annotations`)).json().then((b) => [b.annotations[0]]);

  const output = await callTool('earmark_ask', {
    id: existing.id,
    question: 'Elevated meaning a shadow, or a lighter background?',
  });
  assert.match(output, /amber/);

  const detail = await callTool('earmark_get_annotation', { id: existing.id });
  assert.match(detail, /Status:\*\* needs-input/);
  assert.match(detail, /_agent_: Elevated meaning a shadow/);
});

test('a human answer flips it back to open and the agent sees the thread', async () => {
  const { annotations } = await (await fetch(`${BROKER}/annotations`)).json();
  const id = annotations[0].id;

  await fetch(`${BROKER}/annotations/${id}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ author: 'human', message: 'lighter background', status: 'open' }),
  });

  const detail = await callTool('earmark_get_annotation', { id });
  assert.match(detail, /_human_: lighter background/);
  assert.doesNotMatch(detail, /Status:\*\* needs-input/);
});

test('resolve reports how many annotations remain', async () => {
  const { annotations } = await (await fetch(`${BROKER}/annotations`)).json();
  const output = await callTool('earmark_resolve', {
    id: annotations[0].id,
    summary: 'Swapped the border for --surface-elevated',
  });
  assert.match(output, /Resolved/);
  assert.match(output, /0 annotations still outstanding/);
});

test('acknowledge marks work in progress without claiming it is done', async () => {
  const created = await overlayPush('The churn card is missing a trend line');

  const output = await callTool('earmark_acknowledge', {
    id: created.id,
    note: 'Adding a sparkline to ChurnCard',
  });
  assert.match(output, /Acknowledged/);
  assert.match(output, /blue/);

  const detail = await callTool('earmark_get_annotation', { id: created.id });
  assert.match(detail, /Status:\*\* acknowledged/);
  assert.match(detail, /_agent_: Adding a sparkline to ChurnCard/);

  // Still outstanding — an acknowledged item is not a finished one.
  const listed = await callTool('earmark_list_annotations');
  assert.match(listed, /The churn card is missing a trend line/);

  await callTool('earmark_resolve', { id: created.id, summary: 'Added the sparkline' });
});

test('acknowledge defaults to a note rather than an empty reply', async () => {
  const created = await overlayPush('Reset button should be secondary');
  await callTool('earmark_acknowledge', { id: created.id });

  const detail = await callTool('earmark_get_annotation', { id: created.id });
  assert.match(detail, /_agent_: Picked up — working on it\./);

  await callTool('earmark_dismiss', { id: created.id, reason: 'test cleanup' });
});

test('watch blocks and returns the annotation the human just added', async () => {
  const started = Date.now();
  const pending = callTool('earmark_watch_annotations', { timeout_seconds: 8 });

  setTimeout(() => overlayPush('The spinner is off-centre'), 150);

  const output = await pending;
  const elapsed = Date.now() - started;

  assert.match(output, /The spinner is off-centre/);
  assert.ok(elapsed < 6000, `watch should wake on the event (took ${elapsed}ms)`);
});

test('watch reports a timeout instead of pretending nothing exists', async () => {
  const output = await callTool('earmark_watch_annotations', { timeout_seconds: 1 });
  assert.match(output, /No new annotations in 1s/);
});

test('dismiss and clear', async () => {
  const { annotations } = await (await fetch(`${BROKER}/annotations?status=open`)).json();
  assert.ok(annotations.length > 0);

  const dismissed = await callTool('earmark_dismiss', {
    id: annotations[0].id,
    reason: 'intentional, matches the spec',
  });
  assert.match(dismissed, /Dismissed/);

  const cleared = await callTool('earmark_clear');
  assert.match(cleared, /Cleared \d+ annotations/);

  const after = await callTool('earmark_status');
  assert.match(after, /open: 0, acknowledged: 0, needs-input: 0, resolved: 0, dismissed: 0/);
});

test('sessions group annotations by browser tab', async () => {
  await overlayPush('Dashboard header is misaligned');

  const listed = await callTool('earmark_list_sessions');
  assert.match(listed, /### Session `test`/);
  assert.match(listed, /\*\*URL:\*\* http:\/\/localhost:5173\//);
  assert.match(listed, /\*\*Annotations:\*\* 1 total, 1 outstanding/);
});

test('a session records every route the human annotated', async () => {
  // The overlay posts this on connect and on each SPA navigation.
  for (const path of ['/settings', '/billing']) {
    await fetch(`${BROKER}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test',
        page: { ...page, url: `http://localhost:5173${path}`, path, title: `Page ${path}` },
      }),
    });
  }

  const listed = await callTool('earmark_list_sessions');
  assert.match(listed, /\*\*Routes annotated:\*\* \/, \/settings, \/billing/);
  assert.match(listed, /\*\*URL:\*\* http:\/\/localhost:5173\/billing/);
});

test('get_session returns that tab and only that tab', async () => {
  // A second tab, with its own annotation.
  await fetch(`${BROKER}/annotations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'other-tab',
      page: { ...page, url: 'http://localhost:5173/admin' },
      annotations: [{ note: 'Admin table overflows', targets: [target] }],
    }),
  });

  const one = await callTool('earmark_get_session', { id: 'test' });
  assert.match(one, /### Session `test`/);
  assert.match(one, /Dashboard header is misaligned/);
  assert.doesNotMatch(one, /Admin table overflows/);

  const two = await callTool('earmark_get_session', { id: 'other-tab' });
  assert.match(two, /Admin table overflows/);
  assert.doesNotMatch(two, /Dashboard header is misaligned/);
});

test('list_annotations can be scoped to one session', async () => {
  const scoped = await callTool('earmark_list_annotations', { session: 'other-tab' });
  assert.match(scoped, /Admin table overflows/);
  assert.doesNotMatch(scoped, /Dashboard header is misaligned/);

  const both = await callTool('earmark_list_annotations');
  assert.match(both, /Admin table overflows/);
  assert.match(both, /Dashboard header is misaligned/);
});

test('unknown session ids fail loudly', async () => {
  const result = await client.callTool({ name: 'earmark_get_session', arguments: { id: 'nope' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No session with id "nope"/);
});

test('connected_only reports honestly when no browser is attached', async () => {
  // These sessions were created over plain HTTP; none holds an SSE stream.
  const output = await callTool('earmark_list_sessions', { connected_only: true });
  assert.match(output, /No browser tab is connected right now/);
});

test('unknown ids fail loudly rather than silently', async () => {
  const result = await client.callTool({ name: 'earmark_resolve', arguments: { id: 'nope', summary: 'x' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No annotation with id "nope"/);
});
