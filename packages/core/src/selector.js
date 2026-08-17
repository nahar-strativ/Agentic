/**
 * Unique-CSS-selector generation.
 *
 * Priority: test ids > stable id > semantic attributes > scoped structural path.
 * Every candidate is verified with querySelectorAll before it is returned, so a
 * returned selector always resolves to exactly the element it was built from.
 */

const TEST_ID_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-cy',
  'data-qa',
  'data-pw',
];

/** Attributes that are meaningful to an agent grepping for the element. */
const SEMANTIC_ATTRS = [
  'name',
  'aria-label',
  'aria-labelledby',
  'placeholder',
  'href',
  'for',
  'type',
  'role',
  'title',
  'alt',
];

/**
 * Classes emitted by CSS-in-JS / CSS Modules / bundler hashing. They change on
 * every build, so a selector containing one is worse than useless to an agent.
 */
const HASHED_CLASS_PATTERNS = [
  /^(css|sc|emotion|jsx|svelte)-[a-z0-9]{4,}$/i, // emotion, styled-components, svelte
  /^[\w-]+__[\w-]+___?[a-zA-Z0-9_-]{4,}$/, // css-modules verbose pattern
  /^[\w-]+_[\w-]+__[a-zA-Z0-9]{4,}$/, // css-modules short pattern
  /^_[a-zA-Z0-9]{6,}$/, // vite/rollup scoped
  /^[a-z]{1,3}[0-9a-f]{6,}$/i, // generic hash-looking
];

/** Utility-first frameworks produce many short classes; they are stable but noisy. */
const MAX_CLASSES_IN_SEGMENT = 2;

/**
 * @param {string} cls
 * @returns {boolean} true when the class looks build-generated and unstable
 */
function isHashedClass(cls) {
  if (!cls || cls.length > 60) return true;
  return HASHED_CLASS_PATTERNS.some((re) => re.test(cls));
}

/**
 * @param {Element} el
 * @returns {string[]} classes worth putting in a selector, most specific first
 */
export function stableClasses(el) {
  const list = Array.from(el.classList || []);
  return list
    .filter((c) => !isHashedClass(c))
    .filter((c) => !c.startsWith('earmark-'))
    .sort((a, b) => b.length - a.length);
}

/**
 * CSS.escape with a fallback for older engines.
 * @param {string} value
 */
function esc(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value).replace(/([^\w-])/g, '\\$1');
}

/**
 * @param {string} selector
 * @param {Element} el
 * @param {ParentNode} root
 * @returns {boolean} selector resolves to el and nothing else
 */
function isUnique(selector, el, root) {
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/**
 * Returns the `[data-testid="..."]` style selector for an element, if it has one.
 * @param {Element} el
 * @returns {{attr: string, value: string, selector: string} | null}
 */
export function testIdOf(el) {
  for (const attr of TEST_ID_ATTRS) {
    const value = el.getAttribute?.(attr);
    if (value) {
      return { attr, value, selector: `[${attr}="${value.replace(/"/g, '\\"')}"]` };
    }
  }
  return null;
}

/**
 * Build one path segment for an element: tag, plus whichever of id / classes /
 * nth-of-type is needed to disambiguate it among its siblings.
 * @param {Element} el
 * @returns {string}
 */
function segmentFor(el) {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;

  if (el.id && !/^\d/.test(el.id) && !/[:.\s]/.test(el.id)) {
    return `${tag}#${esc(el.id)}`;
  }

  const classes = stableClasses(el).slice(0, MAX_CLASSES_IN_SEGMENT);
  let segment = tag + classes.map((c) => `.${esc(c)}`).join('');

  if (!parent) return segment;

  // Only add :nth-of-type when siblings would otherwise collide.
  const siblings = Array.from(parent.children).filter((sib) => {
    if (sib.tagName !== el.tagName) return false;
    if (!classes.length) return true;
    return classes.every((c) => sib.classList.contains(c));
  });

  if (siblings.length > 1) {
    const sameTag = Array.from(parent.children).filter((s) => s.tagName === el.tagName);
    segment += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
  }

  return segment;
}

/**
 * Generate the shortest verified-unique selector for an element.
 *
 * @param {Element} el
 * @param {{maxDepth?: number, root?: ParentNode}} [options]
 * @returns {string}
 */
export function uniqueSelector(el, options = {}) {
  const { maxDepth = 8 } = options;
  const root = options.root || el.getRootNode?.() || document;
  if (!el || el.nodeType !== 1) return '';

  const testId = testIdOf(el);
  if (testId && isUnique(testId.selector, el, root)) return testId.selector;

  if (el.id && !/^\d/.test(el.id)) {
    const byId = `#${esc(el.id)}`;
    if (isUnique(byId, el, root)) return byId;
  }

  const tag = el.tagName.toLowerCase();
  for (const attr of SEMANTIC_ATTRS) {
    const value = el.getAttribute?.(attr);
    if (!value || value.length > 80) continue;
    const candidate = `${tag}[${attr}="${value.replace(/"/g, '\\"')}"]`;
    if (isUnique(candidate, el, root)) return candidate;
  }

  // Walk ancestors, prepending segments until the path resolves uniquely.
  const segments = [];
  let node = el;
  let depth = 0;

  while (node && node.nodeType === 1 && depth < maxDepth) {
    segments.unshift(segmentFor(node));
    const candidate = segments.join(' > ');
    if (isUnique(candidate, el, root)) return candidate;

    // An ancestor with a test id or id anchors the path and stops the walk.
    const parent = node.parentElement;
    if (parent) {
      const parentTestId = testIdOf(parent);
      const anchor = parentTestId
        ? parentTestId.selector
        : parent.id && !/^\d/.test(parent.id)
          ? `#${esc(parent.id)}`
          : null;
      if (anchor) {
        const anchored = `${anchor} > ${segments.join(' > ')}`;
        if (isUnique(anchored, el, root)) return anchored;
      }
    }

    node = parent;
    depth += 1;
  }

  // Last resort: absolute nth-child path from the document root.
  return absolutePath(el);
}

/**
 * Deterministic nth-child path. Always unique, never pretty.
 * @param {Element} el
 * @returns {string}
 */
export function absolutePath(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    const parent = node.parentElement;
    if (!parent) break;
    const index = Array.from(parent.children).indexOf(node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    node = parent;
  }
  return ['html', ...parts].join(' > ');
}

/**
 * Human-readable ancestor breadcrumb, e.g. `body > #root > main > .card`.
 * @param {Element} el
 * @param {number} [depth]
 * @returns {string}
 */
export function domPath(el, depth = 6) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < depth) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : '';
    const cls = id ? '' : stableClasses(node).slice(0, 1).map((c) => `.${c}`).join('');
    parts.unshift(tag + id + cls);
    node = node.parentElement;
  }
  return parts.join(' > ');
}
