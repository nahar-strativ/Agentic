/**
 * Type-level test for the hand-written declarations.
 *
 * Nothing here runs. It exists so `npm run types` fails when a `.d.ts` drifts
 * from the JavaScript it describes — a declaration nobody checks is worse than
 * none, because it is believed.
 *
 * `@ts-expect-error` lines are assertions too: they fail the build if the error
 * they name stops happening.
 */

import {
  createEarmark,
  getEarmark,
  batchToMarkdown,
  annotationToMarkdown,
  extractElement,
  pageContext,
  uniqueSelector,
  detectFramework,
  SOURCE_ATTR,
  DEFAULT_ENDPOINT,
  type Annotation,
  type ElementTarget,
  type Status,
  type Priority,
  type Session,
} from 'earmark';
import { createTransport, type SyncState } from 'earmark/transport';
import { resolveStaticSource } from 'earmark/sourcemap';
import { labelFor } from 'earmark/extract';
import {
  createStore,
  createHttpServer,
  startEarmarkServer,
  attachWebhooks,
  resolveWebhookUrls,
  createAdapter,
  STATUSES,
  ACTIVE_STATUSES,
  DEFAULT_PORT,
  type Store,
} from 'earmark-server';
import { createEarmarkMcp, type ToolName } from 'earmark-mcp';
import { initProject, runDoctor, formatDoctor, type Check } from 'earmark-mcp/cli';
import { stamp, stampJsx, stampSvelte, earmarkPreprocess, relativePath, STAMPABLE } from 'earmark-stamp';
import earmarkVite from 'vite-plugin-earmark';
import { withEarmark } from 'earmark-loader/next';

// ------------------------------------------------------------ the overlay --

const overlay = createEarmark({ endpoint: false, theme: 'dark', hotkey: 'alt+a' });
overlay.setMode('element');
overlay.setMode(null);
const md: string = overlay.markdown();
const sessionId: string = overlay.sessionId;
const live: Annotation[] = overlay.annotations;
overlay.destroy();

// @ts-expect-error 'sideways' is not a pick mode
overlay.setMode('sideways');
// @ts-expect-error the endpoint is a string or false, never a number
createEarmark({ endpoint: 7331 });
// @ts-expect-error annotations is read-only
overlay.annotations = [];

const maybe: ReturnType<typeof getEarmark> = getEarmark();
const stillThere: boolean = maybe !== null;
const endpoint: string = DEFAULT_ENDPOINT;
const attr: 'data-earmark-src' = SOURCE_ATTR;

// --------------------------------------------------------------- payloads --

declare const el: Element;
const target: ElementTarget = extractElement(el);
const where: string | null = target.source;
const exact: boolean = target.sourceExact;
const rules = target.cssRules ?? [];
const firstRuleLine: number | null = rules[0]?.line ?? null;
const label: string = labelFor(el);
const selector: string = uniqueSelector(el, { maxDepth: 4 });
const framework = detectFramework();

declare const annotation: Annotation;
const one: string = annotationToMarkdown(annotation, 1);
const batch: string = batchToMarkdown([annotation], pageContext(), { instructions: false });
const status: Status = 'acknowledged';
const priority: Priority = 'high';

// @ts-expect-error 'urgent' is not a priority — the composer offers three
const wrongPriority: Priority = 'urgent';
// @ts-expect-error a region target has no selector to hand an agent
const regionSelector: string = extractElement(el).kind === 'region' ? '' : uniqueSelector(el);

const state: SyncState = 'connected';
const transport = createTransport({
  endpoint: 'http://127.0.0.1:7331',
  sessionId: 'abc',
  onState: (s: SyncState) => void s,
  onEvent: (event) => void event.type,
});
const pushed: Promise<unknown> = transport.push([annotation], pageContext());
const replied: Promise<unknown> = transport.reply('a1', 'moved it left', 'open');
const resolved: Promise<{ html: unknown; css: unknown[] }> = resolveStaticSource(el);

// ---------------------------------------------------------------- broker --

const store: Store = createStore({ store: 'sqlite', file: '.earmark/annotations.db' });
const outstanding: Annotation[] = store.list({ status: ACTIVE_STATUSES as Status[] });
const created: Annotation = store.create({ note: 'tighten the gap' }, { sessionId: 'abc' });
const patched: Annotation | null = store.update(created.id, { status: 'resolved' });
const withReply: Annotation | null = store.addReply(created.id, { author: 'agent', message: 'on it' }, 'acknowledged');
const gone: boolean = store.remove(created.id);
const sessions: Session[] = store.listSessions();
const backend: 'json' | 'sqlite' | 'memory' = store.backend;
const unsubscribe: () => void = store.subscribe((event) => void event.data);

// @ts-expect-error 'stale' is not a status
store.list({ status: 'stale' });
// @ts-expect-error the store is created from options, not a port number
createStore(7331);

const http = createHttpServer(store, { port: DEFAULT_PORT, token: null, quiet: true });
const listening: Promise<{ port: number; host: string; url: string }> = http.listen();
const hooks = attachWebhooks(store, resolveWebhookUrls(['https://example.test/hook']), { quiet: true });
const deliveries: number = hooks.delivered();
const adapterKind: string = createAdapter({ store: 'memory' }).kind;
const server = startEarmarkServer({ store: 'memory', file: null, webhooks: [] });

// ------------------------------------------------------------------- mcp --

const mcp = createEarmarkMcp({ port: 7331, store: 'json' });
const tool: ToolName = 'earmark_watch_annotations';
// @ts-expect-error there is no such tool
const notATool: ToolName = 'earmark_screenshot';

const checks: Promise<Check[]> = runDoctor({ cwd: '.' });
const report: Promise<string> = checks.then(formatDoctor);
const init = initProject({ cwd: '.', port: 7331 });

// --------------------------------------------------------------- stamping --

const jsx = stamp('const a = <div/>;', { filename: 'src/App.tsx', root: '.' });
const stampedCode: string | undefined = jsx?.code;
const count: number | undefined = jsx?.stamped;
const svelte = stampSvelte('<div/>', { path: 'src/Card.svelte' });
const direct = stampJsx('<div/>', { path: 'src/App.jsx', typescript: false });
const pre = earmarkPreprocess({ root: '.', dev: true });
const preOut = pre.markup({ content: '<div/>', filename: 'src/Card.svelte' });
const rel: string = relativePath('/repo/src/App.tsx', '/repo');
const stampable: RegExp = STAMPABLE;

// @ts-expect-error `path` is required — a stamp with no path is useless
stampSvelte('<div/>', {});

const vitePlugin = earmarkVite({ theme: 'auto', applyInBuild: false });
const pluginName: string | undefined = typeof vitePlugin.name === 'string' ? vitePlugin.name : undefined;

const nextConfig = withEarmark({ reactStrictMode: true }, { applyInBuild: false });
const strict: boolean = nextConfig.reactStrictMode;

// Keep every binding used so `noUnusedLocals` stays on and typos still fail.
export const used = [
  md, sessionId, live, stillThere, endpoint, attr, target, where, exact, rules, firstRuleLine,
  label, selector, framework, one, batch, status, priority, wrongPriority, regionSelector, state,
  pushed, replied, resolved, outstanding, created, patched, withReply, gone, sessions, backend,
  unsubscribe, listening, deliveries, adapterKind, server, mcp, tool, notATool, report, init,
  stampedCode, count, svelte, direct, preOut, rel, stampable, pluginName, strict, maybe, overlay,
  transport, hooks, STATUSES, store, http, checks,
];
