/**
 * JSX source stamping.
 *
 * Adds `data-earmark-src="src/components/Card.tsx:42:7"` to every intrinsic JSX
 * element. Extracted out of `vite-plugin-earmark` so the Vite plugin, the
 * webpack/Turbopack loader and anything else share one implementation — a
 * difference in stamping between two bundlers would be an agent reading a wrong
 * line number, which is worse than no line number at all.
 */

import { parse } from '@babel/parser';
import MagicString from 'magic-string';

export const SOURCE_ATTR = 'data-earmark-src';

/**
 * The component an element was written in. Only build-time stampers can know
 * this for Svelte, which exposes no runtime equivalent of a React fiber.
 */
export const COMPONENT_ATTR = 'data-earmark-component';

/**
 * Elements that either cannot carry an unknown attribute or where one would be
 * actively harmful.
 */
export const SKIP_TAGS = new Set([
  'html',
  'head',
  'body',
  'title',
  'meta',
  'link',
  'script',
  'style',
]);

/**
 * @typedef {object} StampResult
 * @property {string} code stamped source
 * @property {import('magic-string').SourceMap} map source map for the inserts
 * @property {number} stamped how many elements were stamped
 */

/**
 * Stamp intrinsic JSX elements with their source position.
 *
 * @param {string} code
 * @param {object} options
 * @param {string} options.path repo-relative, forward-slashed path to report
 * @param {boolean} [options.typescript] parse TS syntax rather than Flow
 * @param {string} [options.mapSource] `source` field for the generated map
 * @returns {StampResult | null} null when nothing was stamped or the file could
 *   not be parsed — callers must treat that as "pass the source through".
 */
export function stampJsx(code, { path, typescript, mapSource }) {
  if (!code.includes('<')) return null;

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      errorRecovery: true,
      plugins: [
        'jsx',
        typescript ? 'typescript' : 'flow',
        'decorators-legacy',
        'classProperties',
        'topLevelAwait',
      ],
    });
  } catch {
    // Never break someone's dev server over a file we cannot parse.
    return null;
  }

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

    magic.appendLeft(name.end, ` ${SOURCE_ATTR}="${path}:${loc.line}:${loc.column + 1}"`);
    stamped += 1;
  }

  if (!stamped) return null;

  return {
    code: magic.toString(),
    map: magic.generateMap({ hires: true, source: mapSource ?? path }),
    stamped,
  };
}

/**
 * Depth-first walk of the AST yielding every JSXOpeningElement.
 * Hand-rolled so we do not need @babel/traverse and its ESM interop.
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
