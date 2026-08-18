/**
 * Type declarations for vite-plugin-earmark.
 */

import type { Plugin } from 'vite';

export interface EarmarkPluginOptions {
  /** Auto-mount the overlay in dev. Default true. */
  inject?: boolean;
  /** Broker endpoint passed through to createEarmark. */
  endpoint?: string;
  theme?: 'auto' | 'light' | 'dark';
  hotkey?: string;
  /** Files to stamp. Default /\.(jsx|tsx|svelte)$/ */
  include?: RegExp;
  /** Files to skip. Default /node_modules/ */
  exclude?: RegExp;
  /** Stamp production builds too. Default false. */
  applyInBuild?: boolean;
}

export default function earmark(options?: EarmarkPluginOptions): Plugin;

export const SOURCE_ATTR: 'data-earmark-src';
