/**
 * Type declarations for earmark-loader — the webpack / Turbopack loader.
 *
 * Loaders are called by the bundler, not by you; this exists so the package
 * resolves types at all, and for anyone wiring the loader up by hand.
 */

export interface EarmarkLoaderOptions {
  /** Project root for the reported paths. Defaults to webpack's rootContext. */
  root?: string;
  /** Regexp source string, or a RegExp under webpack. Turbopack needs the string. */
  include?: string | RegExp;
  exclude?: string | RegExp;
}

declare function earmarkLoader(this: any, source: string, map?: object): void;
export default earmarkLoader;
