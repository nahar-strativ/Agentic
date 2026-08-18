export interface StampResult {
  /** The source with `data-earmark-src` attributes inserted. */
  code: string;
  /** Source map for the inserts, so stack traces keep pointing at the original. */
  map: { version: number; mappings: string; sources: string[]; [key: string]: unknown };
  /** How many elements were stamped. */
  stamped: number;
}

export const SOURCE_ATTR: 'data-earmark-src';

/** Tags that cannot usefully carry the attribute (html, head, script, …). */
export const SKIP_TAGS: Set<string>;

/**
 * Stamp intrinsic JSX elements. Returns null when there was nothing to stamp or
 * the file could not be parsed — callers must pass the source through unchanged.
 */
export function stampJsx(
  code: string,
  options: { path: string; typescript?: boolean; mapSource?: string },
): StampResult | null;
