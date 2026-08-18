/**
 * earmark — click-to-annotate overlay that hands AI coding agents structured
 * context about your UI.
 *
 *   import { createEarmark } from 'earmark'
 *   if (import.meta.env.DEV) createEarmark()
 *
 * Or, with no bundler at all:
 *
 *   <script type="module" src="/node_modules/earmark/src/index.js" data-earmark-auto></script>
 */

import { createOverlay } from './overlay.js';

export { batchToMarkdown, annotationToMarkdown } from './markdown.js';
export { extractElement, extractSelection, extractRegion, pageContext } from './extract.js';
export { uniqueSelector, domPath } from './selector.js';
export { inspectElement, detectFramework, SOURCE_ATTR } from './frameworks.js';

export const DEFAULT_ENDPOINT = 'http://127.0.0.1:7331';

/** @type {ReturnType<typeof createOverlay> | null} */
let instance = null;

/**
 * Mount the overlay. Calling it twice returns the existing instance.
 *
 * @param {object} [options]
 * @param {string | false} [options.endpoint] dev-server URL, or false for copy-paste only.
 *   Defaults to http://127.0.0.1:7331 and degrades silently when nothing is listening.
 * @param {string} [options.hotkey] e.g. 'alt+a', 'meta+shift+k'
 * @param {'auto' | 'light' | 'dark'} [options.theme]
 * @param {boolean} [options.persist] keep annotations in sessionStorage across reloads
 * @param {(annotation: object) => void} [options.onAnnotate]
 * @returns {ReturnType<typeof createOverlay>}
 */
export function createEarmark(options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('earmark: createEarmark() must run in a browser');
  }
  if (instance) return instance;

  const endpoint = options.endpoint === false ? null : (options.endpoint ?? DEFAULT_ENDPOINT);

  const start = () => {
    instance = createOverlay({ ...options, endpoint });
    window.earmark = instance;
    return instance;
  };

  if (document.body) return start();

  // Called from <head>: defer until there is a body to attach to.
  const stub = /** @type {any} */ ({ pending: true });
  document.addEventListener('DOMContentLoaded', start, { once: true });
  return stub;
}

/** Tear down the overlay and remove all of its DOM. */
export function destroyEarmark() {
  instance?.destroy();
  instance = null;
  delete window.earmark;
}

/** @returns {ReturnType<typeof createOverlay> | null} */
export function getEarmark() {
  return instance;
}

// Auto-mount when loaded via a <script data-earmark-auto> tag.
//
// `document.currentScript` is null inside an ES module, and the documented
// no-bundler installation is a module script, so relying on it alone meant the
// overlay silently never mounted. The query is the fallback that makes the
// documented path work; currentScript stays first because it is exact when a page
// has more than one earmark tag.
if (typeof document !== 'undefined') {
  const script =
    document.currentScript || document.querySelector('script[data-earmark-auto]');
  if (script && script.hasAttribute('data-earmark-auto')) {
    createEarmark({
      endpoint: script.getAttribute('data-endpoint') ?? undefined,
      hotkey: script.getAttribute('data-hotkey') ?? undefined,
      theme: /** @type {any} */ (script.getAttribute('data-theme')) ?? undefined,
    });
  }
}
