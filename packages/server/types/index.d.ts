/**
 * Type declarations for earmark-server — the local broker between the browser
 * overlay and an agent.
 *
 * The domain types live in `earmark` and are re-exported here, so an annotation
 * is the same type on both sides of the wire.
 */

import type { Annotation, PageContext, Session, Status, Reply } from 'earmark';

export type { Annotation, PageContext, Session, Status, Reply };

export const STATUSES: Status[];
/** Statuses that still represent outstanding work — the default `list` filter. */
export const ACTIVE_STATUSES: Status[];
export const DEFAULT_PORT: 7331;
export const DEFAULT_HOST: '127.0.0.1';

export type Backend = 'json' | 'sqlite' | 'memory';

export interface StoreEvent {
  type:
    | 'annotation.created'
    | 'annotation.updated'
    | 'annotation.deleted'
    | 'annotations.cleared'
    | 'session.created'
    | 'session.updated';
  data: any;
}

export interface ListFilter {
  status?: Status | Status[];
  sessionId?: string;
}

export interface Store {
  /** Read persisted state in. Call once before serving. */
  load(): Promise<void>;
  /** Flush pending writes. The json adapter debounces; this forces it. */
  persist(): Promise<void>;
  list(filter?: ListFilter): Annotation[];
  get(id: string): Annotation | null;
  create(input: Partial<Annotation>, context?: { sessionId?: string; page?: PageContext }): Annotation;
  update(id: string, patch: Partial<Annotation>): Annotation | null;
  addReply(id: string, reply: { author: 'agent' | 'human'; message: string }, status?: Status): Annotation | null;
  remove(id: string): boolean;
  clear(): number;
  /** Returns an unsubscribe function. */
  subscribe(fn: (event: StoreEvent) => void): () => void;
  /**
   * Resolves as soon as an annotation newer than `since` exists, or after the
   * timeout with an empty list. This is what makes `earmark_watch_annotations` a
   * long-poll rather than a busy loop.
   */
  waitForChange(options?: {
    since?: number;
    timeoutMs?: number;
    status?: Status | Status[];
  }): Promise<{ annotations: Annotation[]; cursor: number; timedOut: boolean }>;
  touchSession(id: string, info?: { page?: PageContext; connected?: boolean }): Session | null;
  setSessionConnected(id: string, connected: boolean): Session | null;
  listSessions(): Session[];
  getSession(id: string): (Session & { annotations: Annotation[] }) | null;
  close(): Promise<void>;
  readonly backend: Backend;
  readonly sessionCount: number;
  readonly cursor: number;
  readonly size: number;
}

export function createStore(options?: { file?: string | null; store?: Backend }): Store;

export interface HttpServer {
  /** Rejects with EADDRINUSE if the port is taken — callers decide what that means. */
  listen(): Promise<{ port: number; host: string; url: string }>;
  close(): Promise<void>;
}

export function createHttpServer(
  store: Store,
  options?: { port?: number; host?: string; token?: string | null; quiet?: boolean },
): HttpServer;

export interface WebhookHandle {
  urls: string[];
  unsubscribe(): void;
  delivered(): number;
  failed(): number;
}

/** Fire-and-forget delivery of annotation events. Never blocks the store. */
export function attachWebhooks(
  store: Store,
  urls: string[],
  options?: { quiet?: boolean; fetchImpl?: typeof fetch },
): WebhookHandle;

/** Merges explicit urls with EARMARK_WEBHOOK_URL / EARMARK_WEBHOOKS, deduplicated. */
export function resolveWebhookUrls(explicit?: string[], env?: Record<string, string | undefined>): string[];

export interface Adapter {
  kind: Backend;
  load(): Promise<{ cursor: number; annotations: Annotation[]; sessions: Session[] }>;
  onChange(change: { type: string; data: any }, snapshot: () => any): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export function createAdapter(options?: { store?: Backend; file?: string | null }): Adapter;
export function createJsonAdapter(file?: string): Adapter;
/** Falls back to the json adapter when `node:sqlite` is unavailable or locked. */
export function createSqliteAdapter(file?: string): Adapter;

export function startEarmarkServer(options?: {
  port?: number;
  host?: string;
  file?: string | null;
  store?: Backend;
  token?: string | null;
  webhooks?: string[];
  quiet?: boolean;
}): Promise<{
  store: Store;
  webhooks: WebhookHandle;
  port: number;
  host: string;
  url: string;
  close(): Promise<void>;
}>;
