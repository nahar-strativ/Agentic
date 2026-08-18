/**
 * vite-plugin-earmark
 *
 * Adds `data-earmark-src="src/components/Card.tsx:42:7"` to every intrinsic JSX
 * element — and to every plain element in a `.svelte` file — during `vite dev`.
 * This is the piece that turns "the button on the right" into an exact file and
 * line for an agent.
 *
 * Why a build plugin at all: React <19 exposed `_debugSource` on the fiber at
 * runtime, and React 19 removed it. Stamping at build time works on React 19,
 * Preact, Solid, Svelte and anything else that compiles to DOM, and survives
 * production builds if you ever want it there (you normally do not — this plugin
 * is `apply: 'serve'` by default).
 *
 *   // vite.config.js
 *   import earmark from 'vite-plugin-earmark'
 *   export default { plugins: [react(), earmark()] }
 *
 * The transform itself lives in `earmark-stamp`, shared with the webpack /
 * Turbopack loader so a stamp means the same thing in Next.js as it does here.
 */

import { stamp, STAMPABLE, DEFAULT_EXCLUDE, SOURCE_ATTR } from 'earmark-stamp';

/**
 * @param {object} [options]
 * @param {boolean} [options.inject] auto-mount the overlay in dev (default true)
 * @param {string} [options.endpoint] endpoint passed to createEarmark
 * @param {'auto'|'light'|'dark'} [options.theme]
 * @param {string} [options.hotkey]
 * @param {RegExp} [options.include] files to stamp (default /\.(jsx|tsx|svelte)$/)
 * @param {RegExp} [options.exclude] files to skip (default node_modules)
 * @param {boolean} [options.applyInBuild] also stamp production builds (default false)
 * @returns {import('vite').Plugin}
 */
export default function earmark(options = {}) {
  const {
    inject = true,
    endpoint,
    theme,
    hotkey,
    include = STAMPABLE,
    exclude = DEFAULT_EXCLUDE,
    applyInBuild = false,
  } = options;

  let root = process.cwd();

  return {
    name: 'vite-plugin-earmark',
    apply: applyInBuild ? undefined : 'serve',
    // `pre` matters for Svelte: the markup has to be stamped before
    // @sveltejs/vite-plugin-svelte compiles it away.
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
    },

    transform(code, id) {
      const result = stamp(code, { filename: id, root, include, exclude });
      if (!result) return null;
      return { code: result.code, map: result.map };
    },

    transformIndexHtml() {
      if (!inject) return;
      const config = JSON.stringify({
        ...(endpoint !== undefined ? { endpoint } : {}),
        ...(theme ? { theme } : {}),
        ...(hotkey ? { hotkey } : {}),
      });
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          injectTo: 'body',
          children:
            `import { createEarmark } from 'earmark';\n` +
            `createEarmark(${config});\n`,
        },
      ];
    },
  };
}

export { SOURCE_ATTR };
