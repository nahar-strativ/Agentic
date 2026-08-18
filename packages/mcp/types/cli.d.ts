/** `earmark-mcp init` and `earmark-mcp doctor`, as functions (§4.16). */

/** One diagnostic result. `fix` is a command to run when `ok` is false. */
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string | null;
}

/** Merge earmark into the project's `.mcp.json`, preserving other servers. */
export function initProject(options?: {
  cwd?: string;
  port?: number;
  store?: string;
}): Promise<{ path: string; created: boolean; alreadyPresent: boolean }>;

/**
 * Check the chain in the order it breaks: Node version → sqlite → MCP
 * registration → broker reachable → browser tab connected.
 */
export function runDoctor(options?: { cwd?: string; port?: number; host?: string }): Promise<Check[]>;

export function formatDoctor(checks: Check[]): string;
