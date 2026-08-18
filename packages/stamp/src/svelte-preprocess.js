/**
 * Svelte preprocessor, for builds that are not Vite.
 *
 * Vite users (including SvelteKit) get `.svelte` stamping from
 * `vite-plugin-earmark` and need nothing here. This exists for rollup/webpack
 * Svelte setups, and for anyone who would rather configure it in one place:
 *
 *   // svelte.config.js
 *   import { earmarkPreprocess } from 'earmark-stamp'
 *   export default { preprocess: [earmarkPreprocess()] }
 *
 * Stamping is idempotent — an element that already carries the attribute is
 * skipped — so having both the plugin and the preprocessor on is harmless.
 */

import { stampSvelte } from './svelte.js';
import { relativePath } from './path.js';

/**
 * @param {object} [options]
 * @param {string} [options.root] project root (default `process.cwd()`)
 * @param {boolean} [options.dev] stamp only in dev (default: true when
 *   NODE_ENV is not 'production')
 * @returns {{name: string, markup: (input: {content: string, filename?: string}) => {code: string, map: object} | undefined}}
 */
export function earmarkPreprocess(options = {}) {
  const { root = process.cwd(), dev = process.env.NODE_ENV !== 'production' } = options;

  return {
    name: 'earmark',
    markup({ content, filename }) {
      if (!dev || !filename || !filename.endsWith('.svelte')) return;
      if (filename.includes('node_modules')) return;

      const result = stampSvelte(content, { path: relativePath(filename, root), mapSource: filename });
      if (!result) return;
      return { code: result.code, map: result.map };
    },
  };
}
