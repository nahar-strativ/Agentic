/**
 * earmark-stamp — the source-stamping transform, with no bundler attached.
 *
 * Every integration (Vite plugin, webpack/Turbopack loader, Svelte
 * preprocessor) calls into here, so a stamp means the same thing whatever built
 * the app.
 *
 *   import { stamp } from 'earmark-stamp'
 *   const result = stamp(code, { filename: '/repo/src/Card.tsx', root: '/repo' })
 *   if (result) ({ code, map } = result)
 */

import { stampJsx, SOURCE_ATTR, SKIP_TAGS } from './jsx.js';
import { stampSvelte } from './svelte.js';
import { relativePath } from './path.js';

export { stampJsx, stampSvelte, SOURCE_ATTR, SKIP_TAGS, relativePath };
export { earmarkPreprocess } from './svelte-preprocess.js';

/** Files worth handing to `stamp()`. */
export const STAMPABLE = /\.(jsx|tsx|svelte)$/;

/** Never stamp dependencies — you cannot edit them, so a line number is noise. */
export const DEFAULT_EXCLUDE = /node_modules/;

/**
 * Stamp a file, choosing the transform from its extension.
 *
 * @param {string} code
 * @param {object} options
 * @param {string} options.filename absolute or repo-relative path of this file
 * @param {string} [options.root] project root, used to shorten the reported path
 * @param {RegExp} [options.include] default /\.(jsx|tsx|svelte)$/
 * @param {RegExp} [options.exclude] default /node_modules/
 * @returns {import('./jsx.js').StampResult | null} null means "leave this file
 *   alone" — an unsupported extension, an exclusion, a parse failure, or simply
 *   nothing to stamp.
 */
export function stamp(code, { filename, root = process.cwd(), include = STAMPABLE, exclude = DEFAULT_EXCLUDE } = {}) {
  const file = String(filename ?? '').split('?')[0];
  if (!file) return null;
  if (!include.test(file) || exclude.test(file)) return null;

  const path = relativePath(file, root);

  if (file.endsWith('.svelte')) return stampSvelte(code, { path, mapSource: filename });
  return stampJsx(code, { path, typescript: file.endsWith('.tsx'), mapSource: filename });
}

