import type { StampResult } from './jsx.js';

/**
 * Stamp plain elements in a `.svelte` file's markup. Components, `<svelte:*>`,
 * `<slot>`, comments, `{expressions}` and the contents of `<script>`/`<style>`
 * are left alone. Returns null when nothing was stamped.
 */
export function stampSvelte(
  code: string,
  options: { path: string; mapSource?: string },
): StampResult | null;
