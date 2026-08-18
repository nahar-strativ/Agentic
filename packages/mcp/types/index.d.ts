/**
 * Type declarations for earmark-mcp — the MCP server, which runs the broker in
 * the same process so `claude mcp add earmark` is the whole setup (§4.5).
 */

import type { Store, Backend } from 'earmark-server';

export type { Store, Backend };

/**
 * The MCP SDK's low-level `Server`, described structurally rather than imported.
 * The runtime deliberately uses the low-level API to avoid coupling to the SDK's
 * zod version (§8); importing its types here would put that coupling back.
 */
export interface McpServerLike {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

/** The tools an agent sees. */
export type ToolName =
  | 'earmark_list_annotations'
  | 'earmark_list_sessions'
  | 'earmark_get_session'
  | 'earmark_acknowledge'
  | 'earmark_watch_annotations'
  | 'earmark_get_annotation'
  | 'earmark_ask'
  | 'earmark_resolve'
  | 'earmark_dismiss'
  | 'earmark_clear'
  | 'earmark_status';

export interface EarmarkMcp {
  server: McpServerLike;
  store: Store;
  /** Null when the broker could not bind — MCP still works against the store. */
  address: { port: number; host: string; url: string } | null;
  /** Why the broker is not listening, in plain language. */
  httpError: string | null;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function createEarmarkMcp(options?: {
  port?: number;
  host?: string;
  file?: string | null;
  store?: Backend;
  token?: string | null;
  webhooks?: string[];
}): Promise<EarmarkMcp>;
