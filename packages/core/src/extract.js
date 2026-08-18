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
export function rectOf(el, frame = null) {
  const r = el.getBoundingClientRect();
  /* An element inside an iframe reports coordinates in the frame's viewport. The
     overlay draws in the top window, so the frame's own offset is added here
     rather than in every caller. */
  const offset = frame ? frame.el.getBoundingClientRect() : null;
  const left = r.left + (offset ? offset.left : 0);
  const top = r.top + (offset ? offset.top : 0);
  return {
    x: round(left),
    y: round(top),
    width: round(r.width),
    height: round(r.height),
    pageX: round(left + window.scrollX),
    pageY: round(top + window.scrollY),
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
/**
 * Renderer libraries worth naming, detected from globals the page has already
 * loaded. Knowing it is three.js rather than Chart.js changes which file an agent
 * opens, and it is the difference between "somewhere in the canvas" and a lead.
 */
const CANVAS_LIBRARIES = [
  ['three', () => 'THREE' in window],
  ['chart.js', () => 'Chart' in window],
  ['pixi', () => 'PIXI' in window],
  ['d3', () => 'd3' in window],
  ['fabric', () => 'fabric' in window],
  ['konva', () => 'Konva' in window],
  ['babylon', () => 'BABYLON' in window],
  ['p5', () => 'p5' in window],
  ['matter', () => 'Matter' in window],
  ['phaser', () => 'Phaser' in window],
];

/** @returns {string | null} */
function canvasLibrary() {
  for (const [name, present] of CANVAS_LIBRARIES) {
    try {
      if (present()) return name;
    } catch {
      /* a getter on window threw; it is not the library we are looking for */
    }
  }
  return null;
}

/**
 * Which context a canvas is already using. Asking for a context that has not been
 * created would create one, so this only ever *probes* by asking for the same
 * kind back: `getContext` returns null when a different kind is already bound.
 *
 * @param {HTMLCanvasElement} el
 * @returns {string | null}
 */
function canvasContextKind(el) {
  for (const kind of ['2d', 'webgl2', 'webgl', 'bitmaprenderer']) {
    try {
      if (el.getContext(kind)) return kind;
    } catch {
      /* some contexts throw rather than returning null */
    }
  }
  return null;
}

/**
 * What a canvas can honestly tell an agent.
 *
 * There is no DOM inside a canvas, so there is nothing to select and no source
 * line to find. What *is* actionable is the coordinate space the drawing code
 * works in: a click at viewport (x, y) maps to a pixel in the canvas's own
 * buffer, and that buffer is often a different size from the element's CSS box.
 * Reporting both, plus the ratio between them, is what lets an agent reason about
 * hit-testing code it cannot see.
 *
 * @param {HTMLCanvasElement} el
 * @param {{x: number, y: number} | null} [point] viewport coordinates
 * @param {{x: number, y: number, width: number, height: number} | null} [region] viewport rect
 */
function canvasInfo(el, point, region) {
  const box = el.getBoundingClientRect();
  const scaleX = box.width ? el.width / box.width : 1;
  const scaleY = box.height ? el.height / box.height : 1;

  /** @param {number} vx @param {number} vy */
  const toBuffer = (vx, vy) => ({
    x: Math.round((vx - box.left) * scaleX),
    y: Math.round((vy - box.top) * scaleY),
  });

  const info = {
    /** The drawing buffer, which is what canvas code uses. */
    buffer: { width: el.width, height: el.height },
    /** The CSS box, which is what the user pointed at. */
    css: { width: round(box.width), height: round(box.height) },
    /** Buffer pixels per CSS pixel. Not always devicePixelRatio. */
    scale: { x: round(scaleX * 100) / 100, y: round(scaleY * 100) / 100 },
    devicePixelRatio: window.devicePixelRatio || 1,
    context: canvasContextKind(el),
    library: canvasLibrary(),
  };

  if (point) info.point = toBuffer(point.x, point.y);
  if (region) {
    const topLeft = toBuffer(region.x, region.y);
    info.region = {
      x: topLeft.x,
      y: topLeft.y,
      width: Math.round(region.width * scaleX),
      height: Math.round(region.height * scaleY),
    };
  }
  return info;
}

export function extractElement(el, options = {}) {
  const info = inspectElement(el);
  const isCanvas = el.tagName === 'CANVAS';
  const frame = options.frame || null;
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
    rect: rectOf(el, frame),
    styles: computedStyles(el),
    framework: info.framework,
    components: info.components,
    source: info.source,
    sourceExact: info.sourceExact,
    ancestors: ancestors(el),
    ...(isCanvas
      ? { canvas: canvasInfo(/** @type {HTMLCanvasElement} */ (el), options.point || null, null) }
      : {}),
    /* A selector is only unique within its document, so an agent that is handed
       one for a framed element needs to be told which document to run it in. */
    ...(frame ? { frame: frameInfo(frame) } : {}),
  };
}

/**
 * Where a framed element lives: how to reach the frame from the top document, and
 * what the frame is showing.
 *
 * @param {{el: HTMLIFrameElement, doc: Document}} frame
 */
function frameInfo(frame) {
  let url = null;
  try {
    url = frame.doc.location?.href || frame.el.getAttribute('src');
  } catch {
    url = frame.el.getAttribute('src');
  }
  return {
    selector: uniqueSelector(frame.el),
    name: frame.el.getAttribute('name') || frame.el.getAttribute('id') || null,
    url,
    title: frame.el.getAttribute('title') || null,
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
    /* A region over a canvas, a WebGL scene or plain empty space contains no
       elements. Reporting only "empty" wastes the one thing the user did tell us:
       where they dragged. So name the element the region was drawn *on top of*,
       and if that is a canvas, map the region into its drawing buffer. */
    ...(outermost.length === 0 ? containerFor(region) : {}),
  };
}

/**
 * The element under the centre of an empty region, described as a container
 * rather than a hit, plus canvas coordinates when it is a canvas.
 *
 * @param {{x: number, y: number, width: number, height: number}} region
 */
function containerFor(region) {
  const centre = { x: region.x + region.width / 2, y: region.y + region.height / 2 };
  const el = document.elementFromPoint(centre.x, centre.y);
  if (!el || el.closest?.('#earmark-root')) return {};

  const container = {
    label: labelFor(el),
    tag: el.tagName.toLowerCase(),
    selector: uniqueSelector(el),
    source: inspectElement(el).source,
    rect: rectOf(el),
  };

  if (el.tagName === 'CANVAS') {
    container.canvas = canvasInfo(/** @type {HTMLCanvasElement} */ (el), centre, region);
  }
  return { container };
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
