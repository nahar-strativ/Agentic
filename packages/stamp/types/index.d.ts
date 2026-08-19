/**
 * Type declarations for earmark-stamp — the bundler-agnostic source stamp.
 */

import type { StampResult } from './jsx.js';

export type { StampResult };
export { stampJsx, SOURCE_ATTR, COMPONENT_ATTR, SKIP_TAGS } from './jsx.js';
export { stampSvelte } from './svelte.js';

/** Extensions `stamp()` handles: /\.(jsx|tsx|svelte)$/ */
export const STAMPABLE: RegExp;

/** /node_modules/ — a line number you cannot edit is noise. */
export const DEFAULT_EXCLUDE: RegExp;

/**
 * Stamp a file, choosing the transform from its extension. Null means "leave
 * this file alone": unsupported extension, excluded path, parse failure, or
 * simply nothing to stamp.
 */
export function stamp(
  code: string,
  options: { filename: string; root?: string; include?: RegExp; exclude?: RegExp },
): StampResult | null;

/** Root-relative, forward-slashed. Paths outside the root stay absolute. */
export function relativePath(file: string, root: string): string;

export interface SveltePreprocessor {
  name: 'earmark';
  markup(input: { content: string; filename?: string }): { code: string; map: object } | undefined;
}

/** Svelte preprocessor, for Svelte builds that are not Vite. */
export function earmarkPreprocess(options?: { root?: string; dev?: boolean }): SveltePreprocessor;
