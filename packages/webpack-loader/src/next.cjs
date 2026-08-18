/**
 * `withEarmark` — Next.js config wrapper.
 *
 *   // next.config.js
 *   const { withEarmark } = require('earmark-loader/next')
 *   module.exports = withEarmark({ /* your config *\/ })
 *
 *   // next.config.mjs
 *   import { withEarmark } from 'earmark-loader/next'
 *   export default withEarmark({})
 *
 * Two things about this that are deliberate:
 *
 * 1. **Both compilations get stamped, server and client.** It is tempting to skip
 *    the server pass since the overlay is a browser thing — but Next renders your
 *    components on the server, and React hydration will not add an attribute the
 *    server HTML did not have. Stamping one side only means the attribute is
 *    missing until something re-renders, and a hydration mismatch on the way.
 *
 * 2. **Dev only, unless asked.** Shipping file paths to production tells the
 *    world how your repo is laid out. `applyInBuild: true` opts in.
 */

'use strict';

const LOADER = require.resolve('./loader.cjs');
const TEST = /\.(jsx|tsx)$/;

/**
 * @param {object} [nextConfig]
 * @param {object} [options]
 * @param {boolean} [options.applyInBuild] stamp production builds too (default false)
 * @param {string} [options.root] project root for the reported paths
 * @param {string} [options.exclude] source regexp string for files to skip
 * @returns {object} the config, with stamping wired into webpack and Turbopack
 */
function withEarmark(nextConfig = {}, options = {}) {
  const { applyInBuild = false, root, exclude } = options;
  const loaderOptions = {
    ...(root ? { root } : {}),
    ...(exclude ? { exclude } : {}),
  };

  // `next dev` sets NODE_ENV=development; `next build` sets production. There is
  // no dev flag available at config-evaluation time for the Turbopack branch, so
  // this is the signal both branches agree on.
  const enabled = applyInBuild || process.env.NODE_ENV !== 'production';
  if (!enabled) return nextConfig;

  const previousWebpack = nextConfig.webpack;

  return {
    ...nextConfig,

    // Turbopack (`next dev --turbo`, and the default from Next 15.3 on).
    turbopack: {
      ...(nextConfig.turbopack || {}),
      rules: {
        ...((nextConfig.turbopack && nextConfig.turbopack.rules) || {}),
        '*.jsx': turbopackRule(loaderOptions),
        '*.tsx': turbopackRule(loaderOptions),
      },
    },

    webpack(config, context) {
      const merged = previousWebpack ? previousWebpack(config, context) : config;
      merged.module = merged.module || {};
      merged.module.rules = merged.module.rules || [];
      // `enforce: 'pre'` puts us ahead of next-swc, so we see the source the
      // developer actually wrote.
      merged.module.rules.push({
        test: TEST,
        exclude: /node_modules/,
        enforce: 'pre',
        use: [{ loader: LOADER, options: loaderOptions }],
      });
      return merged;
    },
  };
}

/**
 * @param {object} loaderOptions
 * @returns {{loaders: Array<{loader: string, options: object}>}}
 */
function turbopackRule(loaderOptions) {
  return { loaders: [{ loader: LOADER, options: loaderOptions }] };
}

module.exports = withEarmark;
module.exports.withEarmark = withEarmark;
module.exports.default = withEarmark;
