/**
 * vite-plugin-earmark
 *
 * Adds `data-earmark-src="src/components/Card.tsx:42:7"` to every intrinsic JSX
 * element during `vite dev`. This is the piece that turns "the button on the
 * right" into an exact file and line for an agent.
 *
 * Why a build plugin at all: React <19 exposed `_debugSource` on the fiber at
 * runtime, and React 19 removed it. Stamping at build time works on React 19,
 * Preact, Solid and anything else that compiles JSX, and survives production
 * builds if you ever want it there (you normally do not — this plugin is
 * `apply: 'serve'` by default).
 *
 *   // vite.config.js
 *   import earmark from 'vite-plugin-earmark'
 *   export default { plugins: [react(), earmark()] }
 */

import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import { relative } from 'node:path';

const SOURCE_ATTR = 'data-earmark-src';
const JSX_FILE = /\.(jsx|tsx)$/;

/**
 * Elements that either cannot carry an unknown attribute or where one would be
 * actively harmful.
 */
const SKIP_TAGS = new Set(['html', 'head', 'body', 'title', 'meta', 'link', 'script', 'style']);

/**
 * @param {object} [options]
 * @param {boolean} [options.inject] auto-mount the overlay in dev (default true)
 * @param {string} [options.endpoint] endpoint passed to createEarmark
 * @param {'auto'|'light'|'dark'} [options.theme]
 * @param {string} [options.hotkey]
 * @param {RegExp} [options.include] files to stamp (default /\.(jsx|tsx)$/)
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
    include = JSX_FILE,
    exclude = /node_modules/,
    applyInBuild = false,
  } = options;

  let root = process.cwd();

  return {
    name: 'vite-plugin-earmark',
    apply: applyInBuild ? undefined : 'serve',
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
    },

    transform(code, id) {
      const file = id.split('?')[0];
      if (!include.test(file) || exclude.test(file)) return null;
      if (!code.includes('<')) return null;

      let ast;
      try {
        ast = parse(code, {
          sourceType: 'module',
          errorRecovery: true,
          plugins: [
            'jsx',
            file.endsWith('.tsx') ? 'typescript' : 'flow',
            'decorators-legacy',
            'classProperties',
            'topLevelAwait',
          ],
        });
      } catch {
        // Never break the dev server over a file we cannot parse.
        return null;
      }

      const relativePath = relative(root, file).split('\\').join('/');
      const magic = new MagicString(code);
      let stamped = 0;

      for (const node of findJsxOpeningElements(ast.program)) {
        const name = node.name;
        if (name?.type !== 'JSXIdentifier') continue; // <Foo.Bar/> and <this.x/> are components
        if (!/^[a-z]/.test(name.name)) continue; // component, not a DOM element
        if (SKIP_TAGS.has(name.name)) continue;
        if (node.attributes?.some((a) => a.type === 'JSXAttribute' && a.name?.name === SOURCE_ATTR)) {
          continue;
        }

        const loc = node.loc?.start;
        if (!loc) continue;

        const value = `${relativePath}:${loc.line}:${loc.column + 1}`;
        magic.appendLeft(name.end, ` ${SOURCE_ATTR}="${value}"`);
        stamped += 1;
      }

      if (!stamped) return null;

      return {
        code: magic.toString(),
        map: magic.generateMap({ hires: true, source: id }),
      };
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

/**
 * Depth-first walk of the AST yielding every JSXOpeningElement.
 * Hand-rolled so the plugin does not need @babel/traverse.
 *
 * @param {any} node
 * @returns {Generator<any>}
 */
function* findJsxOpeningElements(node) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const child of node) yield* findJsxOpeningElements(child);
    return;
  }

  if (node.type === 'JSXOpeningElement') yield node;

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const value = node[key];
    if (value && typeof value === 'object') yield* findJsxOpeningElements(value);
  }
}

export { SOURCE_ATTR };
