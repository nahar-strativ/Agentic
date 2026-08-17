/**
 * earmark MCP server.
 *
 * Runs the annotation store, the HTTP/SSE endpoint the browser overlay talks
 * to, and the MCP stdio transport in one process — so `claude mcp add` is the
 * only setup step and there is no second daemon to keep alive.
 *
 * stdout belongs to the MCP transport. Everything human-readable goes to stderr.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createStore, createHttpServer, DEFAULT_PORT, DEFAULT_HOST } from 'earmark-server';
import { batchToMarkdown, annotationToMarkdown } from 'earmark/markdown';

const STATUS_ENUM = ['open', 'acknowledged', 'needs-input', 'resolved', 'dismissed'];
const ACTIVE_STATUSES = ['open', 'acknowledged', 'needs-input'];

const TOOLS = [
  {
    name: 'earmark_list_annotations',
    description:
      'List UI annotations left by the human in the browser, rendered as markdown with CSS selectors, ' +
      'source file paths, component paths and computed styles. Call this first when the user mentions ' +
      'visual feedback, annotations, or "what I marked on the page". Defaults to outstanding work only ' +
      '(open, acknowledged, needs-input).',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'array',
          items: { type: 'string', enum: STATUS_ENUM },
          description: 'Statuses to include. Defaults to ["open","acknowledged","needs-input"].',
        },
        session: {
          type: 'string',
          description: 'Only annotations from this browser tab. Get ids from earmark_list_sessions.',
        },
        format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'markdown (default, compact and greppable) or json (full raw payload).',
        },
      },
    },
  },
  {
    name: 'earmark_list_sessions',
    description:
      'List browser tabs that have connected, newest activity first, with the routes annotated in each ' +
      'and a per-status count. Use this when the human has been working across several pages and you ' +
      'need to know which tab or route their feedback belongs to.',
    inputSchema: {
      type: 'object',
      properties: {
        connected_only: {
          type: 'boolean',
          description: 'Only tabs with a live connection right now. Default false.',
        },
      },
    },
  },
  {
    name: 'earmark_get_session',
    description:
      'One browser tab with every annotation it produced, as markdown. Use after earmark_list_sessions ' +
      'to focus on a single tab or page.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: {
          type: 'array',
          items: { type: 'string', enum: STATUS_ENUM },
          description: 'Filter the annotations. Defaults to all of them.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'earmark_acknowledge',
    description:
      'Mark an annotation as picked up — you have read it and are working on it, but have not finished. ' +
      'The pin turns blue in the browser. Call this before a long edit so the human can see you are on ' +
      'it; call earmark_resolve when the change is actually made.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        note: { type: 'string', description: 'Optional: what you are about to do.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'earmark_watch_annotations',
    description:
      'Block until the human adds or changes an annotation, then return it. Use this to sit in a ' +
      'fix loop: watch, apply the change, resolve, watch again. Returns an empty list on timeout — ' +
      'call again to keep waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'number',
          description: 'Cursor from a previous call. Omit to receive everything newer than the last call.',
        },
        timeout_seconds: {
          type: 'number',
          description: 'How long to block, 1-600. Default 60.',
        },
      },
    },
  },
  {
    name: 'earmark_get_annotation',
    description: 'Fetch one annotation in full, including every target and the whole reply thread.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'earmark_ask',
    description:
      'Ask the human a clarifying question about an annotation. The question appears on the pin in ' +
      'their browser and the annotation moves to "needs-input". Use this instead of guessing when ' +
      'the feedback is ambiguous.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        question: { type: 'string', description: 'One specific question.' },
      },
      required: ['id', 'question'],
    },
  },
  {
    name: 'earmark_resolve',
    description:
      'Mark an annotation resolved with a summary of the change you made. The pin turns green in the ' +
      "browser. Call this after you have actually edited the code, not before.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        summary: { type: 'string', description: 'What you changed, and in which files.' },
      },
      required: ['id', 'summary'],
    },
  },
  {
    name: 'earmark_dismiss',
    description: 'Dismiss an annotation you are not going to act on, with a reason the human will see.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'earmark_clear',
    description: 'Delete every annotation. Destructive — only call when the human explicitly asks.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'earmark_status',
    description:
      'Report whether the browser overlay is connected, how many annotations exist by status, and the ' +
      'endpoint the overlay should point at. Use this to diagnose "the agent cannot see my annotations".',
    inputSchema: { type: 'object', properties: {} },
  },
];

/**
 * @param {object} [options]
 * @param {number} [options.port]
 * @param {string} [options.host]
 * @param {string | null} [options.file]
 * @param {string | null} [options.token]
 */
export async function createEarmarkMcp(options = {}) {
  const store = createStore({ file: options.file });
  await store.load();

  const http = createHttpServer(store, {
    port: options.port ?? DEFAULT_PORT,
    host: options.host ?? DEFAULT_HOST,
    token: options.token ?? null,
    quiet: true,
  });

  /** @type {{port: number, host: string, url: string} | null} */
  let address = null;
  /** @type {string | null} */
  let httpError = null;

  try {
    address = await http.listen();
  } catch (error) {
    // A port clash usually means a second editor already started the broker.
    // MCP still works against the local store; the overlay just cannot sync.
    httpError = error.code === 'EADDRINUSE'
      ? `port ${options.port ?? DEFAULT_PORT} is already in use — another earmark broker is probably running`
      : String(error.message || error);
  }

  // Track when the overlay last talked to us so earmark_status can be honest.
  let lastBrowserEvent = 0;
  store.subscribe((event) => {
    if (event.type === 'annotation.created') lastBrowserEvent = Date.now();
  });

  const server = new Server(
    { name: 'earmark', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = request.params.arguments || {};
    try {
      const result = await call(name, args);
      // Anything the agent just looked at, or just wrote itself, counts as seen —
      // otherwise the next watch immediately replays it instead of blocking.
      if (name !== 'earmark_watch_annotations') watchCursor = store.cursor;
      return result;
    } catch (error) {
      return text(`earmark: ${error.message}`, true);
    }
  });

  // Advances on every watch call so a bare earmark_watch_annotations() only
  // reports things the agent has not already seen.
  let watchCursor = store.cursor;

  /**
   * @param {string} name
   * @param {any} args
   */
  async function call(name, args) {
    switch (name) {
      case 'earmark_list_annotations': {
        const status = args.status?.length ? args.status : ACTIVE_STATUSES;
        const items = store.list({ status, ...(args.session ? { sessionId: args.session } : {}) });
        if (!items.length) {
          const scope = args.session ? ` in session ${args.session}` : '';
          return text(
            `No ${status.join('/')} annotations${scope}. ` +
              (store.size ? `${store.size} exist with other statuses.` : 'The human has not annotated anything yet.'),
          );
        }
        if (args.format === 'json') return text(JSON.stringify(items, null, 2));
        return text(`${batchToMarkdown(items, items[0].page)}\ncursor: ${store.cursor}`);
      }

      case 'earmark_list_sessions': {
        let sessions = store.listSessions();
        if (args.connected_only) sessions = sessions.filter((s) => s.connected);
        if (!sessions.length) {
          return text(
            args.connected_only
              ? 'No browser tab is connected right now. Ask the human to open the app with the earmark overlay mounted.'
              : 'No sessions yet — no browser tab has ever connected to this broker.',
          );
        }
        return text(sessions.map(sessionToMarkdown).join('\n'));
      }

      case 'earmark_get_session': {
        const session = store.getSession(args.id);
        if (!session) return text(`No session with id "${args.id}".`, true);

        const items = args.status?.length
          ? session.annotations.filter((a) => args.status.includes(a.status))
          : session.annotations;

        const header = sessionToMarkdown(session);
        if (!items.length) return text(`${header}\nNo annotations match that filter.`);
        return text(`${header}\n${batchToMarkdown(items, items[0].page, { instructions: false })}`);
      }

      case 'earmark_acknowledge': {
        const updated = store.addReply(
          args.id,
          { author: 'agent', message: args.note || 'Picked up — working on it.' },
          'acknowledged',
        );
        if (!updated) return text(`No annotation with id "${args.id}".`, true);
        return text(
          `Acknowledged ${args.id} — the pin is blue in the browser. ` +
            'Call earmark_resolve once the edit is actually made.',
        );
      }

      case 'earmark_watch_annotations': {
        const timeoutMs = Math.min(Math.max((args.timeout_seconds ?? 60) * 1000, 1000), 600000);
        const since = args.since ?? watchCursor;
        const result = await store.waitForChange({ since, timeoutMs });
        watchCursor = result.cursor;
        if (!result.annotations.length) {
          return text(
            `No new annotations in ${Math.round(timeoutMs / 1000)}s (cursor ${result.cursor}). ` +
              'Call earmark_watch_annotations again to keep waiting.',
          );
        }
        return text(
          `${batchToMarkdown(result.annotations, result.annotations[0].page)}\ncursor: ${result.cursor}`,
        );
      }

      case 'earmark_get_annotation': {
        const found = store.get(args.id);
        if (!found) return text(`No annotation with id "${args.id}".`, true);
        return text(annotationToMarkdown(found, 1));
      }

      case 'earmark_ask': {
        const updated = store.addReply(
          args.id,
          { author: 'agent', message: args.question },
          'needs-input',
        );
        if (!updated) return text(`No annotation with id "${args.id}".`, true);
        return text(
          `Asked the human on annotation ${args.id}. The pin is now amber in their browser. ` +
            'Their answer arrives via earmark_watch_annotations.',
        );
      }

      case 'earmark_resolve': {
        const updated = store.addReply(args.id, { author: 'agent', message: args.summary }, 'resolved');
        if (!updated) return text(`No annotation with id "${args.id}".`, true);
        const open = store.list({ status: ACTIVE_STATUSES }).length;
        return text(`Resolved ${args.id}. ${open} annotation${open === 1 ? '' : 's'} still outstanding.`);
      }

      case 'earmark_dismiss': {
        const updated = store.addReply(args.id, { author: 'agent', message: args.reason }, 'dismissed');
        if (!updated) return text(`No annotation with id "${args.id}".`, true);
        return text(`Dismissed ${args.id}.`);
      }

      case 'earmark_clear': {
        return text(`Cleared ${store.clear()} annotations.`);
      }

      case 'earmark_status': {
        const byStatus = STATUS_ENUM.map((s) => `${s}: ${store.list({ status: s }).length}`).join(', ');
        const sessions = store.listSessions();
        const live = sessions.filter((s) => s.connected);
        const lines = [
          address ? `Broker listening on ${address.url}` : `Broker NOT listening — ${httpError}`,
          `Annotations — ${byStatus}`,
          `Sessions — ${sessions.length} known, ${live.length} connected`,
          ...live.map((s) => `  · ${s.id} ${s.url || '(unknown url)'} — ${s.counts.total} annotations`),
          `Cursor: ${store.cursor}`,
          lastBrowserEvent
            ? `Last annotation received ${Math.round((Date.now() - lastBrowserEvent) / 1000)}s ago`
            : 'No annotations received from a browser yet in this session.',
          '',
          'If the overlay is not syncing, check it was mounted with:',
          `  createEarmark({ endpoint: '${address?.url ?? `http://${DEFAULT_HOST}:${DEFAULT_PORT}`}' })`,
        ];
        return text(lines.join('\n'));
      }

      default:
        return text(`Unknown tool "${name}".`, true);
    }
  }

  return {
    server,
    store,
    address,
    httpError,
    async start() {
      await server.connect(new StdioServerTransport());
      process.stderr.write(
        address
          ? `earmark-mcp ready — broker on ${address.url}\n`
          : `earmark-mcp ready — broker unavailable (${httpError})\n`,
      );
    },
    async close() {
      await http.close();
      await store.persist();
      await server.close();
    },
  };
}

/**
 * One browser tab, summarised for an agent: where it is, whether it is still
 * open, which routes were annotated, and how much work is outstanding.
 *
 * @param {any} session
 * @returns {string}
 */
function sessionToMarkdown(session) {
  const counts = session.counts || {};
  const outstanding = ACTIVE_STATUSES.reduce((sum, s) => sum + (counts[s] || 0), 0);

  const lines = [
    `### Session \`${session.id}\`${session.connected ? ' — connected' : ''}`,
    '',
    `- **URL:** ${session.url || 'unknown'}`,
  ];

  if (session.title) lines.push(`- **Title:** ${session.title}`);
  if (session.routes?.length > 1) lines.push(`- **Routes annotated:** ${session.routes.join(', ')}`);
  if (session.framework && session.framework !== 'unknown') {
    lines.push(`- **Framework:** ${session.framework}`);
  }
  if (session.viewport) {
    lines.push(`- **Viewport:** ${session.viewport.width}×${session.viewport.height}`);
  }

  lines.push(
    `- **Annotations:** ${counts.total ?? 0} total, ${outstanding} outstanding` +
      (counts.resolved ? `, ${counts.resolved} resolved` : ''),
  );
  lines.push(`- **Last seen:** ${session.lastSeenAt}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * @param {string} body
 * @param {boolean} [isError]
 */
function text(body, isError = false) {
  return { content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) };
}
