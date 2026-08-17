/**
 * Source resolution for pages with no build step.
 *
 * A Vite/JSX app gets `data-earmark-src` stamped at build time. A plain
 * `.html` + `.css` site has no build, so it would otherwise hand an agent a
 * selector and nothing else. For those pages the served source *is* the source,
 * which means we can map both directions:
 *
 * - **HTML** — re-fetch the document, parse it with position tracking, and walk
 *   the same child-index path the live element sits at. Every step is checked
 *   against the live tag name, so a framework-rendered DOM (where the served
 *   HTML is just a shell) fails the check and reports nothing rather than
 *   inventing a line.
 *
 * - **CSS** — walk `document.styleSheets`, keep the rules that actually match
 *   the element, and map each back to a line in its stylesheet. Works on any
 *   page, framework or not: a `.css` file is a `.css` file.
 *
 * Everything here is best-effort, cached, and degrades to null.
 */

/** Elements that never have children in the source. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose contents are text, not markup. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/**
 * Tags a browser inserts that are usually absent from hand-written HTML.
 * Skipped when the source tree does not have them.
 */
const IMPLIED_TAGS = new Set(['tbody', 'head', 'body']);

const MAX_CSS_RULES = 10;

/** @type {Map<string, Promise<any>>} */
const documentCache = new Map();
/** @type {Map<string, Promise<Map<string, number[]>> | null>} */
const stylesheetCache = new Map();

/** Reset every cache. Call after an edit so the next annotation re-reads. */
export function clearSourceCache() {
  documentCache.clear();
  stylesheetCache.clear();
}

/**
 * Pull the document into cache while the user is still deciding what to click,
 * so saving an annotation does not wait on a network round trip.
 */
export function warmSourceCache() {
  try {
    loadDocument(location.href);
  } catch {
    /* nothing to warm */
  }
}

// ------------------------------------------------------------------ HTML ----

/**
 * Byte offset -> {line, column}, via a prebuilt line table.
 * @param {string} text
 */
function lineTable(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
}

/**
 * Find the `>` that closes a tag, ignoring any inside quoted attribute values.
 * @param {string} source
 * @param {number} from index of the opening `<`
 */
function findTagEnd(source, from) {
  let quote = null;
  for (let i = from + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return source.length;
}

/**
 * Parse HTML into an element tree that remembers where each tag started.
 * Deliberately not a spec-compliant parser — it only has to be right about
 * element nesting and offsets, and any disagreement with the browser is caught
 * by the tag-name check during the walk.
 *
 * @param {string} source
 * @returns {{tag: string, offset: number, children: any[]}}
 */
export function parseHtmlWithPositions(source) {
  const root = { tag: '#document', offset: 0, children: [] };
  const stack = [root];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = source.indexOf('>', lt);
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    if (source.startsWith('</', lt)) {
      const gt = source.indexOf('>', lt);
      const tag = source.slice(lt + 2, gt === -1 ? source.length : gt).trim().toLowerCase();
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].tag === tag) {
          stack.length = depth;
          break;
        }
      }
      i = gt === -1 ? source.length : gt + 1;
      continue;
    }

    const gt = findTagEnd(source, lt);
    const inner = source.slice(lt + 1, gt);
    const tag = (inner.match(/^[a-zA-Z][^\s/>]*/) || [''])[0].toLowerCase();
    if (!tag) {
      i = lt + 1;
      continue;
    }

    const node = { tag, offset: lt, children: [] };
    stack[stack.length - 1].children.push(node);

    const selfClosing = inner.trimEnd().endsWith('/');
    if (!selfClosing && !VOID_TAGS.has(tag)) {
      if (RAW_TEXT_TAGS.has(tag)) {
        // Contents are text; jump past them so `<div>` inside a script is not
        // mistaken for markup.
        const close = source.toLowerCase().indexOf(`</${tag}`, gt);
        i = close === -1 ? source.length : close;
        continue;
      }
      stack.push(node);
    }

    i = gt + 1;
  }

  return root;
}

/**
 * The live element's position as a chain of element-child indices.
 * @param {Element} el
 * @returns {Array<{index: number, tag: string}> | null}
 */
function elementPath(el) {
  /** @type {Array<{index: number, tag: string}>} */
  const path = [];
  let node = el;

  while (node && node !== document.documentElement) {
    const parent = node.parentElement;
    if (!parent) return null;
    path.unshift({
      index: Array.prototype.indexOf.call(parent.children, node),
      tag: node.tagName.toLowerCase(),
    });
    node = parent;
  }

  return path;
}

/**
 * @param {string} url
 * @returns {Promise<{source: string, tree: any, at: (offset: number) => {line: number, column: number}} | null>}
 */
function loadDocument(url) {
  if (!documentCache.has(url)) {
    documentCache.set(
      url,
      fetch(url, { credentials: 'same-origin' })
        .then((res) => {
          const type = res.headers.get('content-type') || '';
          if (!res.ok || !type.includes('html')) return null;
          return res.text();
        })
        .then((source) =>
          source ? { source, tree: parseHtmlWithPositions(source), at: lineTable(source) } : null,
        )
        .catch(() => null),
    );
  }
  return documentCache.get(url);
}

/**
 * Resolve an element to `path/index.html:LINE:COL`, or null when the served
 * HTML does not match the live DOM (which is the normal case for an SPA).
 *
 * @param {Element} el
 * @returns {Promise<{source: string, line: number, column: number} | null>}
 */
export async function resolveHtmlSource(el) {
  const path = elementPath(el);
  if (!path) return null;

  const doc = await loadDocument(location.href);
  if (!doc) return null;

  let node = doc.tree.children.find((child) => child.tag === 'html');
  if (!node) return null;

  for (const step of path) {
    const candidate = node.children[step.index];

    if (candidate && candidate.tag === step.tag) {
      node = candidate;
      continue;
    }

    // The browser inserts <tbody>, <head> and <body> even when the author did
    // not write them. Skip such a step rather than giving up.
    if (IMPLIED_TAGS.has(step.tag)) continue;

    // Anything else means the DOM was built by script — refuse to guess.
    return null;
  }

  const { line, column } = doc.at(node.offset);
  return { source: relativeUrl(location.href), line, column };
}

// ------------------------------------------------------------------- CSS ----

/**
 * Normalise a selector so a CSSOM `selectorText` and the raw source text of the
 * same rule compare equal.
 * @param {string} selector
 */
function normaliseSelector(selector) {
  return selector
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .trim();
}

/**
 * Index every rule in a stylesheet by normalised selector -> line numbers, in
 * source order. Duplicated selectors (the same rule under two media queries)
 * keep one entry per occurrence and are consumed in order.
 *
 * @param {string} text
 * @param {number} lineOffset lines to add, for a <style> block inside a document
 * @returns {Map<string, number[]>}
 */
export function indexStylesheet(text, lineOffset = 0) {
  const at = lineTable(text);
  /** @type {Map<string, number[]>} */
  const index = new Map();

  let i = 0;
  let selectorStart = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '/' && text[i + 1] === '*') {
      const preceding = text.slice(selectorStart, i);
      const end = text.indexOf('*/', i);
      i = end === -1 ? text.length : end + 2;
      // A comment sitting between rules is not part of the next selector, so
      // the reported line must be the selector's, not the comment's.
      if (!preceding.trim()) selectorStart = i;
      continue;
    }

    if (ch === '{') {
      const raw = text.slice(selectorStart, i);
      const selector = normaliseSelector(raw);
      if (selector && !selector.startsWith('@')) {
        // Point at the selector, not the brace.
        const leading = raw.length - raw.trimStart().length;
        const { line } = at(selectorStart + leading);
        const lines = index.get(selector) || [];
        lines.push(line + lineOffset);
        index.set(selector, lines);
      }
      i += 1;
      selectorStart = i;
      continue;
    }

    if (ch === '}' || ch === ';') {
      i += 1;
      selectorStart = i;
      continue;
    }

    i += 1;
  }

  return index;
}

/**
 * @param {CSSStyleSheet} sheet
 * @returns {Promise<Map<string, number[]> | null>}
 */
function loadStylesheetIndex(sheet) {
  const key = sheet.href || `inline:${sheet.ownerNode?.getAttribute?.('data-earmark-sheet') || indexOfSheet(sheet)}`;
  if (stylesheetCache.has(key)) return stylesheetCache.get(key);

  /** @type {Promise<Map<string, number[]> | null>} */
  let promise;

  if (!sheet.href && sheet.ownerNode?.textContent) {
    // An inline <style>: its lines are offset by wherever the tag sits in the
    // HTML file, so annotations point into index.html, not into a phantom file.
    const text = sheet.ownerNode.textContent;
    promise = loadDocument(location.href)
      .then((doc) => {
        let offset = 0;
        if (doc) {
          const probe = text.slice(0, 200);
          const found = probe ? doc.source.indexOf(probe) : -1;
          if (found >= 0) offset = doc.at(found).line - 1;
        }
        return indexStylesheet(text, offset);
      })
      .catch(() => indexStylesheet(text));
  } else if (sheet.href) {
    promise = fetch(sheet.href, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.text() : null))
      .then((text) => (text ? indexStylesheet(text) : null))
      .catch(() => null);
  } else {
    promise = Promise.resolve(null);
  }

  stylesheetCache.set(key, promise);
  return promise;
}

/** @param {CSSStyleSheet} sheet */
function indexOfSheet(sheet) {
  return Array.prototype.indexOf.call(document.styleSheets, sheet);
}

/**
 * Make an absolute URL readable — same-origin URLs become repo-relative paths.
 * @param {string} url
 */
export function relativeUrl(url) {
  try {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== location.origin) return url;
    const path = parsed.pathname.replace(/^\//, '');
    // A directory URL is served by its index file; naming it makes the path
    // something an agent can actually open.
    if (!path || path.endsWith('/')) return `${path}index.html`;
    return path;
  } catch {
    return url;
  }
}

/**
 * Every CSS rule that matches an element, with the file and line that declares
 * it. This is the piece that makes a hand-written stylesheet as actionable as a
 * JSX component path.
 *
 * @param {Element} el
 * @returns {Promise<Array<{file: string, line: number | null, selector: string, condition: string | null, declarations: string}>>}
 */
export async function resolveCssRules(el) {
  /** @type {any[]} */
  const matches = [];

  for (const sheet of Array.from(document.styleSheets)) {
    // Never report our own overlay styles back to the user.
    if (sheet.ownerNode?.id === 'earmark-host-css') continue;

    /** @type {CSSRuleList} */
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet, contents unreadable
    }
    if (!rules) continue;

    const file = sheet.href ? relativeUrl(sheet.href) : `${relativeUrl(location.href)} (inline <style>)`;
    const index = await loadStylesheetIndex(sheet);
    /** @type {Map<string, number>} */
    const consumed = new Map();

    collectMatchingRules(rules, el, null, (rule, condition) => {
      const selector = normaliseSelector(rule.selectorText);
      let line = null;
      if (index?.has(selector)) {
        const lines = index.get(selector);
        const used = consumed.get(selector) || 0;
        line = lines[Math.min(used, lines.length - 1)] ?? null;
        consumed.set(selector, used + 1);
      }
      matches.push({
        file,
        line,
        selector: rule.selectorText,
        condition,
        declarations: rule.style?.cssText || '',
      });
    });
  }

  return matches.slice(-MAX_CSS_RULES);
}

/**
 * Walk a rule list, descending into @media / @supports / @layer, and report
 * every style rule the element matches.
 *
 * @param {CSSRuleList} rules
 * @param {Element} el
 * @param {string | null} condition
 * @param {(rule: any, condition: string | null) => void} onMatch
 */
function collectMatchingRules(rules, el, condition, onMatch) {
  for (const rule of Array.from(rules)) {
    const selectorText = /** @type {any} */ (rule).selectorText;

    if (selectorText) {
      try {
        if (el.matches(selectorText)) onMatch(rule, condition);
      } catch {
        // Vendor pseudo-elements, `& .child` nesting selectors, and anything
        // else matches() rejects.
      }
    }

    // Since CSS Nesting, a plain CSSStyleRule also exposes `cssRules` — an
    // empty list, which is truthy. Testing selectorText first and length here
    // is what keeps ordinary rules from being treated as grouping rules and
    // skipped entirely.
    const nested = /** @type {any} */ (rule).cssRules;
    if (!nested || nested.length === 0) continue;

    const own = /** @type {any} */ (rule).conditionText || /** @type {any} */ (rule).media?.mediaText;
    const next = selectorText ? condition : [condition, own].filter(Boolean).join(' and ') || null;
    collectMatchingRules(nested, el, next, onMatch);
  }
}

/**
 * Resolve everything a build-step-free page can offer for one element.
 *
 * @param {Element} el
 * @returns {Promise<{html: object | null, css: any[]}>}
 */
export async function resolveStaticSource(el) {
  const [html, css] = await Promise.all([
    resolveHtmlSource(el).catch(() => null),
    resolveCssRules(el).catch(() => []),
  ]);
  return { html, css };
}
