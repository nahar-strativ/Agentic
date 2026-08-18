/**
 * Svelte source stamping.
 *
 * Svelte has no runtime hook that tells you which component or line an element
 * came from, so the only honest answer is to stamp the markup before the
 * compiler sees it. This walks a `.svelte` file's template and adds
 * `data-earmark-src="src/lib/Card.svelte:12:3"` to every plain element.
 *
 * It is a scanner, not a parser. It does not need to understand Svelte — it only
 * needs to be right about four things: where `<script>`/`<style>` blocks are,
 * where comments are, where `{...}` expressions are, and where an opening tag
 * ends. Everything it is unsure about it leaves alone.
 */

import MagicString from 'magic-string';
import { SOURCE_ATTR, COMPONENT_ATTR, SKIP_TAGS } from './jsx.js';

/** Tags that render no element of their own, so a stamp would go nowhere. */
const SVELTE_SKIP = new Set([...SKIP_TAGS, 'slot']);

/**
 * Also stamps the owning component's name. Svelte has no runtime hook that can
 * tell you which component an element came from, so the name has to be written
 * down at build time; the runtime then rebuilds the chain
 * (`App > Dashboard > Card`) by walking ancestors and collecting distinct names.
 *
 * @param {string} code
 * @param {object} options
 * @param {string} options.path repo-relative, forward-slashed path to report
 * @param {string} [options.mapSource]
 * @param {boolean} [options.component] stamp the component name (default true)
 * @returns {import('./jsx.js').StampResult | null}
 */
export function stampSvelte(code, { path, mapSource, component = true }) {
  if (!code.includes('<')) return null;

  /* Card.svelte is the Card component. That is the whole convention, and it is
     the same one the Svelte compiler itself uses for devtools names. */
  const componentName = componentNameFrom(path);

  const magic = new MagicString(code);
  const lineStarts = indexLines(code);
  let stamped = 0;
  let braceDepth = 0;
  let i = 0;

  while (i < code.length) {
    const char = code[i];

    // `{#if}`, `{expr}`, `{@html}` — never stamp inside one. An expression like
    // `{a<b}` would otherwise read as an opening tag named `b`.
    if (char === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      i += 1;
      continue;
    }
    if (braceDepth > 0 || char !== '<') {
      i += 1;
      continue;
    }

    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4);
      i = end === -1 ? code.length : end + 3;
      continue;
    }

    const name = readTagName(code, i + 1);
    if (!name) {
      i += 1;
      continue;
    }

    const lower = name.toLowerCase();
    const tagEnd = findTagEnd(code, i + 1 + name.length);

    // Contents of <script> and <style> are JS and CSS. `Map<string>` and
    // `a < b` in there are not markup, and stamping into them breaks the file.
    if (lower === 'script' || lower === 'style') {
      i = skipRawBlock(code, lower, tagEnd);
      continue;
    }

    if (tagEnd === -1) break; // unterminated tag: nothing after it is trustworthy

    const shouldStamp =
      /^[a-z]/.test(name) && // uppercase means a component, whose props never reach the DOM
      !name.includes(':') && // <svelte:*> renders nothing directly
      !name.includes('.') && // <Foo.Bar> is a component
      !SVELTE_SKIP.has(lower) &&
      !code.slice(i, tagEnd).includes(SOURCE_ATTR);

    if (shouldStamp) {
      const nameEnd = i + 1 + name.length;
      const { line, column } = positionAt(lineStarts, i);
      const own =
        component && componentName ? ` ${COMPONENT_ATTR}="${componentName}"` : '';
      magic.appendLeft(nameEnd, ` ${SOURCE_ATTR}="${path}:${line}:${column}"${own}`);
      stamped += 1;
    }

    i = tagEnd + 1;
  }

  if (!stamped) return null;

  return {
    code: magic.toString(),
    map: magic.generateMap({ hires: true, source: mapSource ?? path }),
    stamped,
  };
}

/**
 * `src/lib/Card.svelte` is the `Card` component. Returns null for a filename that
 * cannot carry a name, rather than inventing one.
 *
 * @param {string} path
 * @returns {string | null}
 */
function componentNameFrom(path) {
  const base = String(path).split('/').pop() || '';
  const name = base.replace(/\.svelte$/, '');
  if (!name || !/^[A-Za-z_$][\w$.-]*$/.test(name)) return null;
  return name;
}

/**
 * Tag name starting at `start`, or null if this `<` does not open one.
 * `<` followed by a space, a digit or `/` is text or a closing tag.
 *
 * @param {string} code
 * @param {number} start
 * @returns {string | null}
 */
function readTagName(code, start) {
  if (!/[A-Za-z]/.test(code[start] ?? '')) return null;
  let end = start;
  while (end < code.length && /[A-Za-z0-9:._-]/.test(code[end])) end += 1;
  return code.slice(start, end);
}

/**
 * Offset of the `>` that closes this opening tag, honouring quoted attribute
 * values and `{...}` expressions — both of which may contain `>`.
 *
 * @param {string} code
 * @param {number} from offset just past the tag name
 * @returns {number} offset of `>`, or -1 if the tag never closes
 */
function findTagEnd(code, from) {
  let quote = '';
  let depth = 0;

  for (let i = from; i < code.length; i += 1) {
    const char = code[i];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (char === '>' && depth === 0) return i;
  }
  return -1;
}

/**
 * Skip past a raw text block (`<script>` / `<style>`), including a
 * self-closing or module-context variant.
 *
 * @param {string} code
 * @param {'script' | 'style'} tag
 * @param {number} tagEnd offset of the opening tag's `>`, or -1
 * @returns {number} offset to resume scanning at
 */
function skipRawBlock(code, tag, tagEnd) {
  if (tagEnd === -1) return code.length;
  if (code[tagEnd - 1] === '/') return tagEnd + 1;

  const close = code.toLowerCase().indexOf(`</${tag}`, tagEnd);
  if (close === -1) return code.length;
  const closeEnd = code.indexOf('>', close);
  return closeEnd === -1 ? code.length : closeEnd + 1;
}

/**
 * Offsets at which each line starts, so a stamp's line/column is one binary
 * search rather than a re-scan of the file.
 *
 * @param {string} code
 * @returns {number[]}
 */
function indexLines(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/**
 * @param {number[]} lineStarts
 * @param {number} offset
 * @returns {{line: number, column: number}} both 1-based, matching the JSX stamp
 */
function positionAt(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - lineStarts[low] + 1 };
}
