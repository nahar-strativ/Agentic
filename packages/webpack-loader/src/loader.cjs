/**
 * earmark-loader — webpack / Turbopack loader that stamps JSX with its source
 * position, for the bundlers Vite users do not have.
 *
 * This is the Next.js story. Next compiles with SWC, not Babel, so adding a
 * Babel plugin would silently switch the whole project off SWC and slow every
 * build down. A pre-loader runs on the raw source *before* SWC and leaves the
 * rest of the pipeline exactly as it was.
 *
 * Written as CommonJS on purpose: webpack and Turbopack both `require()` loaders,
 * and Turbopack only supports a subset of the loader API. The transform itself is
 * ESM, so it is pulled in with a dynamic import inside an async loader — which is
 * also why this file does the minimum and delegates immediately.
 */

'use strict';

/** @type {Promise<any> | null} */
let stampModule = null;

/**
 * @this {any} webpack loader context
 * @param {string} source
 * @param {object} [inputMap]
 */
module.exports = function earmarkLoader(source, inputMap) {
  const callback = this.async();
  const options = (typeof this.getOptions === 'function' ? this.getOptions() : this.query) || {};

  const filename = this.resourcePath || this.resource || '';
  const root = options.root || this.rootContext || process.cwd();

  const done = (code, map) => callback(null, code, map);
  const passthrough = () => done(source, inputMap);

  if (!stampModule) stampModule = import('earmark-stamp');

  stampModule.then(
    ({ stamp, STAMPABLE, DEFAULT_EXCLUDE }) => {
      let result = null;
      try {
        result = stamp(source, {
          filename,
          root,
          include: toRegExp(options.include) || STAMPABLE,
          exclude: toRegExp(options.exclude) || DEFAULT_EXCLUDE,
        });
      } catch {
        // A stamp is a nicety. A broken build is not.
        return passthrough();
      }
      if (!result) return passthrough();
      done(result.code, result.map || inputMap);
    },
    // earmark-stamp missing or unloadable: hand the file back untouched.
    passthrough,
  );
};

/**
 * Turbopack loader options have to be JSON-serialisable, so `include` and
 * `exclude` may arrive as strings. webpack users can still pass real RegExps.
 *
 * @param {unknown} value
 * @returns {RegExp | null}
 */
function toRegExp(value) {
  if (!value) return null;
  if (value instanceof RegExp) return value;
  if (typeof value === 'string') {
    try {
      return new RegExp(value);
    } catch {
      return null;
    }
  }
  return null;
}
