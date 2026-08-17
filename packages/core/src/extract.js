/**
 * Turns a DOM element (or a text range, or a screen region) into the structured
 * payload an agent needs to find the corresponding source code.
 */

import { uniqueSelector, domPath, testIdOf, stableClasses } from './selector.js';
import { inspectElement, detectFramework } from './frameworks.js';

/**
 * Computed style properties reported for every target. Width and height are
 * deliberately absent — the Box line already carries the geometry.
 */
const REPORTED_STYLES = [
  'display',
  'position',
  'flexDirection',
  'justifyContent',
  'alignItems',
  'gap',
  'gridTemplateColumns',
  'padding',
  'margin',
  'border',
  'borderRadius',
  'color',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'opacity',
  'overflow',
  'zIndex',
  'boxShadow',
  'transform',
];

/** Values that mean "nothing was set" whichever property they appear on. */
const STYLE_NOISE = new Set([
  'none',
  'normal',
  'auto',
  'rgba(0, 0, 0, 0)',
  '0px',
  'visible',
  'static',
  '',
]);

/**
 * Per-property initial values. Reporting these back to an agent is worse than
 * saying nothing: it reads like an intentional declaration.
 */
const STYLE_DEFAULTS = {
  flexDirection: 'row',
  justifyContent: 'normal',
  alignItems: 'normal',
  gap: 'normal',
  opacity: '1',
  fontWeight: '400',
  letterSpacing: 'normal',
  textAlign: 'start',
  boxShadow: 'none',
};

/** Flex and grid properties only mean something on a flex or grid container. */
const LAYOUT_ONLY = {
  flexDirection: ['flex', 'inline-flex'],
  justifyContent: ['flex', 'inline-flex', 'grid', 'inline-grid'],
  alignItems: ['flex', 'inline-flex', 'grid', 'inline-grid'],
  gap: ['flex', 'inline-flex', 'grid', 'inline-grid'],
  gridTemplateColumns: ['grid', 'inline-grid'],
};

const INTERESTING_ATTRS = [
  'id',
  'name',
  'type',
  'role',
  'href',
  'src',
  'alt',
  'title',
  'placeholder',
  'value',
  'for',
  'disabled',
  'checked',
  'aria-label',
  'aria-describedby',
  'aria-expanded',
  'aria-hidden',
  'contenteditable',
];

/**
 * @param {number} n
 * @returns {number} rounded to 1dp, avoids 12.000000001 noise in output
 */
const round = (n) => Math.round(n * 10) / 10;

/**
 * @param {Element} el
 * @returns {Record<string, string>} non-default computed styles
 */
function computedStyles(el) {
  const style = getComputedStyle(el);
  const display = style.display;
  /** @type {Record<string, string>} */
  const out = {};

  for (const prop of REPORTED_STYLES) {
    const allowed = LAYOUT_ONLY[prop];
    if (allowed && !allowed.includes(display)) continue;

    const value = style[prop];
    if (value == null) continue;
    let text = String(value).trim();
    if (STYLE_NOISE.has(text) || text === STYLE_DEFAULTS[prop]) continue;

    // Collapse `0px 0px 0px 0px` style shorthands back to `0px`.
    const parts = text.split(' ');
    if (parts.length > 1 && parts.every((p) => p === parts[0])) text = parts[0];

    // A full font stack is 100 characters of noise; the first family is the fact.
    if (prop === 'fontFamily') text = text.split(',')[0].replace(/^["']|["']$/g, '');

    if (STYLE_NOISE.has(text) || text === STYLE_DEFAULTS[prop]) continue;
    out[prop] = text;
  }

  return out;
}

/**
 * @param {Element} el
 * @returns {Record<string, string>}
 */
function attributes(el) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of INTERESTING_ATTRS) {
    const value = el.getAttribute?.(name);
    if (value != null && value !== '') out[name] = truncate(value, 120);
  }
  for (const attr of Array.from(el.attributes || [])) {
    if (attr.name.startsWith('data-') && !attr.name.startsWith('data-earmark')) {
      out[attr.name] = truncate(attr.value, 120);
    }
  }
  return out;
}

/**
 * @param {string} value
 * @param {number} max
 */
function truncate(value, max) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @param {Element} el
 * @returns {{x: number, y: number, width: number, height: number, pageX: number, pageY: number}}
 */
export function rectOf(el) {
  const r = el.getBoundingClientRect();
  return {
    x: round(r.left),
    y: round(r.top),
    width: round(r.width),
    height: round(r.height),
    pageX: round(r.left + window.scrollX),
    pageY: round(r.top + window.scrollY),
  };
}

/**
 * Short ancestor summaries — often the container, not the clicked node, is what
 * the developer actually wants changed.
 * @param {Element} el
 * @param {number} count
 */
function ancestors(el, count = 3) {
  const out = [];
  let node = el.parentElement;
  while (node && out.length < count && node !== document.documentElement) {
    const info = inspectElement(node);
    out.push({
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      classes: stableClasses(node).slice(0, 4),
      component: info.components.at(-1) || null,
      source: info.source,
    });
    node = node.parentElement;
  }
  return out;
}

/**
 * A one-line human label for the element, used in the UI and in output headers.
 * @param {Element} el
 * @returns {string}
 */
export function labelFor(el) {
  const tag = el.tagName.toLowerCase();
  const info = inspectElement(el);
  const component = info.components.at(-1);
  const testId = testIdOf(el);
  if (component) return `<${component}>`;
  if (testId) return `${tag}[${testId.value}]`;
  const text = truncate(el.textContent || '', 28);
  if (text) return `${tag} "${text}"`;
  const cls = stableClasses(el)[0];
  return cls ? `${tag}.${cls}` : tag;
}

/**
 * Full structured context for a single element target.
 *
 * @param {Element} el
 * @returns {object}
 */
export function extractElement(el) {
  const info = inspectElement(el);
  return {
    kind: 'element',
    label: labelFor(el),
    tag: el.tagName.toLowerCase(),
    selector: uniqueSelector(el),
    testId: testIdOf(el)?.value || null,
    domPath: domPath(el),
    text: truncate(el.textContent || '', 200) || null,
    attributes: attributes(el),
    classes: Array.from(el.classList || []),
    rect: rectOf(el),
    styles: computedStyles(el),
    framework: info.framework,
    components: info.components,
    source: info.source,
    sourceExact: info.sourceExact,
    ancestors: ancestors(el),
  };
}

/**
 * Context for a text selection: the surrounding element plus the exact string,
 * which is the single most greppable thing a developer can hand an agent.
 *
 * @param {Selection} selection
 * @returns {object | null}
 */
export function extractSelection(selection) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const container =
    range.commonAncestorContainer.nodeType === 1
      ? /** @type {Element} */ (range.commonAncestorContainer)
      : range.commonAncestorContainer.parentElement;
  if (!container) return null;

  const r = range.getBoundingClientRect();
  return {
    ...extractElement(container),
    kind: 'text',
    label: `text "${truncate(selection.toString(), 28)}"`,
    selectedText: truncate(selection.toString(), 500),
    rect: {
      x: round(r.left),
      y: round(r.top),
      width: round(r.width),
      height: round(r.height),
      pageX: round(r.left + window.scrollX),
      pageY: round(r.top + window.scrollY),
    },
  };
}

/**
 * Context for a dragged region: every element whose box meaningfully overlaps
 * the region, deduplicated so nested children do not each report the same box.
 *
 * @param {{x: number, y: number, width: number, height: number}} region viewport coords
 * @returns {object}
 */
export function extractRegion(region) {
  const { x, y, width, height } = region;
  const right = x + width;
  const bottom = y + height;

  const all = Array.from(document.body.querySelectorAll('*'));
  const hits = [];

  for (const el of all) {
    if (el.closest('#earmark-root')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const overlapW = Math.min(right, r.right) - Math.max(x, r.left);
    const overlapH = Math.min(bottom, r.bottom) - Math.max(y, r.top);
    if (overlapW <= 0 || overlapH <= 0) continue;
    // Require the element to be mostly inside the region, so we do not report
    // <body> and every layout wrapper for a small drag.
    const coverage = (overlapW * overlapH) / (r.width * r.height);
    if (coverage < 0.6) continue;
    hits.push(el);
  }

  // Drop elements whose parent is also a hit: keep the outermost of each subtree.
  const outermost = hits.filter((el) => !hits.some((other) => other !== el && other.contains(el)));

  return {
    kind: 'region',
    label: `region ${Math.round(width)}×${Math.round(height)}`,
    rect: {
      x: round(x),
      y: round(y),
      width: round(width),
      height: round(height),
      pageX: round(x + window.scrollX),
      pageY: round(y + window.scrollY),
    },
    framework: detectFramework(),
    elements: outermost.slice(0, 12).map((el) => ({
      label: labelFor(el),
      selector: uniqueSelector(el),
      source: inspectElement(el).source,
      rect: rectOf(el),
    })),
    emptyRegion: outermost.length === 0,
  };
}

/**
 * Page-level context attached to every batch of annotations.
 * @returns {object}
 */
export function pageContext() {
  return {
    url: location.href,
    path: location.pathname,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    framework: detectFramework(),
    userAgent: navigator.userAgent,
  };
}
