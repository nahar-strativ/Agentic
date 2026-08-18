import type { EarmarkLoaderOptions } from './index.js';

export interface WithEarmarkOptions {
  /** Stamp production builds too. Off by default — paths leak repo layout. */
  applyInBuild?: boolean;
  root?: string;
  /** Regexp source string for files to skip. */
  exclude?: string;
}

/**
 * Wire stamping into a Next.js config, for both webpack and Turbopack, on both
 * the client and server compilations — a one-sided stamp means a hydration
 * mismatch.
 */
export function withEarmark<T extends object>(nextConfig?: T, options?: WithEarmarkOptions): T;
export default withEarmark;
export type { EarmarkLoaderOptions };
