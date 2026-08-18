/**
 * Input capture for the three picking modes.
 *
 * The overlay renders with `pointer-events: none`, so hit-testing hits the real
 * page and `event.target` is the element the user is actually pointing at. To
 * stop the host app from reacting we listen in the capture phase and kill the
 * event before it reaches application handlers.
 */

const MIN_REGION = 8;

/**
 * @typedef {'element' | 'text' | 'region' | null} PickMode
 */

/**
 * @param {object} handlers
 * @param {(el: Element | null) => void} handlers.onHover
 * @param {(payload: object, point: {x: number, y: number}) => void} handlers.onPick
 * @param {(rect: DOMRectReadOnly | null) => void} handlers.onRegionChange
 * @param {(elements: Element[]) => void} handlers.onPendingChange
 * @param {() => void} handlers.onCancel
 * @param {(node: EventTarget | null) => boolean} handlers.isOverlay
 */
export function createPicker(handlers) {
  /** @type {PickMode} */
  let mode = null;
  /** @type {Element[]} */
  let pending = [];
  /** @type {{x: number, y: number} | null} */
  let dragStart = null;
  let hovered = /** @type {Element | null} */ (null);

  const root = document.documentElement;

  /**
   * Same-origin iframes the overlay can see into.
   *
   * Cross-origin frames are a browser security boundary, not a gap to work
   * around: `contentDocument` throws or returns null and there is nothing
   * further to try. Those are skipped, and the limitation is honest.
   *
   * @returns {Array<{el: HTMLIFrameElement, doc: Document}>}
   */
  function sameOriginFrames() {
    /** @type {Array<{el: HTMLIFrameElement, doc: Document}>} */
    const frames = [];
    for (const el of Array.from(document.querySelectorAll('iframe'))) {
      if (el.closest('#earmark-root')) continue;
      try {
        const doc = el.contentDocument;
        if (doc && doc.documentElement) frames.push({ el, doc });
      } catch {
        /* cross-origin: not ours to read */
      }
    }
    return frames;
  }

  /** Documents currently wired up, so detach can be exact. @type {Document[]} */
  let wired = [];

  /**
   * The frame an element lives in, or null for the top document. Used to convert
   * child coordinates into the top window's, and to tell an agent where to look.
   *
   * @param {Element | null} el
   */
  function frameOf(el) {
    if (!el) return null;
    const doc = el.ownerDocument;
    if (!doc || doc === document) return null;
    for (const frame of sameOriginFrames()) {
      if (frame.doc === doc) return frame;
    }
    return null;
  }

  /** @param {Event} e */
  const fromOverlay = (e) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return path.some((n) => handlers.isOverlay(n)) || handlers.isOverlay(e.target);
  };

  /**
   * The element under the pointer, descending into same-origin iframes.
   *
   * An event from a child document carries coordinates in *that* document's
   * viewport, so hit-testing has to happen in the document the event came from.
   *
   * @param {MouseEvent} e
   */
  const targetAt = (e) => {
    const doc = /** @type {Document} */ (
      (e.target && /** @type {Node} */ (e.target).ownerDocument) || document
    );
    let el = doc.elementFromPoint(e.clientX, e.clientY);

    /* An iframe is one element to the parent document. Descend into it so the
       user picks what they are actually looking at. */
    let guard = 0;
    while (el && el.tagName === 'IFRAME' && guard < 4) {
      guard += 1;
      try {
        const inner = /** @type {HTMLIFrameElement} */ (el).contentDocument;
        if (!inner) break;
        const box = el.getBoundingClientRect();
        const next = inner.elementFromPoint(e.clientX - box.left, e.clientY - box.top);
        if (!next) break;
        el = next;
      } catch {
        break; // cross-origin
      }
    }

    if (!el || handlers.isOverlay(el)) return null;
    return el;
  };

  /** @param {MouseEvent} e */
  function onMouseMove(e) {
    if (!mode || fromOverlay(e)) return;

    if (mode === 'region' && dragStart) {
      handlers.onRegionChange(rectFromPoints(dragStart, { x: e.clientX, y: e.clientY }));
      return;
    }
    if (mode === 'region') return;

    const el = targetAt(e);
    if (el !== hovered) {
      hovered = el;
      handlers.onHover(el);
    }
  }

  /** @param {MouseEvent} e */
  function onMouseDown(e) {
    if (!mode || fromOverlay(e) || e.button !== 0) return;

    if (mode === 'region') {
      dragStart = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (mode === 'element') {
      // Suppress host mousedown handlers (drag starts, focus steals, menus).
      e.preventDefault();
      e.stopPropagation();
    }
    // Text mode deliberately lets mousedown through so native selection works.
  }

  /** @param {MouseEvent} e */
  function onMouseUp(e) {
    if (!mode) return;

    if (mode === 'region' && dragStart) {
      const rect = rectFromPoints(dragStart, { x: e.clientX, y: e.clientY });
      dragStart = null;
      handlers.onRegionChange(null);
      e.preventDefault();
      e.stopPropagation();
      if (rect.width >= MIN_REGION && rect.height >= MIN_REGION) {
        handlers.onPick(
          { type: 'region', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } },
          { x: e.clientX, y: e.clientY },
        );
      }
      return;
    }

    if (mode === 'text' && !fromOverlay(e)) {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) {
        handlers.onPick({ type: 'text', selection }, { x: e.clientX, y: e.clientY });
      }
    }
  }

  /** @param {MouseEvent} e */
  function onClick(e) {
    if (!mode || fromOverlay(e)) return;

    // Always swallow the click so the host app never navigates or submits.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (mode !== 'element') return;

    const el = targetAt(e);
    if (!el) return;

    if (e.shiftKey) {
      const index = pending.indexOf(el);
      if (index >= 0) pending.splice(index, 1);
      else pending.push(el);
      handlers.onPendingChange([...pending]);
      return;
    }

    const elements = pending.includes(el) ? [...pending] : [...pending, el];
    pending = [];
    handlers.onPendingChange([]);
    handlers.onPick({ type: 'elements', elements }, { x: e.clientX, y: e.clientY });
  }

  /** @param {KeyboardEvent} e */
  function onKeyDown(e) {
    if (!mode) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      reset();
      handlers.onCancel();
    }
  }

  function onScroll() {
    if (mode === 'element' && hovered) handlers.onHover(hovered);
  }

  const events = /** @type {const} */ ([
    ['mousemove', onMouseMove],
    ['mousedown', onMouseDown],
    ['mouseup', onMouseUp],
    ['click', onClick],
    ['keydown', onKeyDown],
  ]);

  /** @param {Document} doc */
  function wire(doc) {
    for (const [name, fn] of events) doc.addEventListener(name, fn, true);
    wired.push(doc);
  }

  /**
   * Same-origin frames get the same capture-phase listeners as the top document,
   * so a click inside one is picked and swallowed exactly like any other.
   * Frames that load later are picked up by the load listener below.
   */
  function wireFrames() {
    for (const { doc } of sameOriginFrames()) {
      if (!wired.includes(doc)) wire(doc);
    }
  }

  /** A frame that navigates gets a brand new document, which needs wiring again. */
  function onFrameLoad() {
    wireFrames();
  }

  function attach() {
    wire(document);
    wireFrames();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);
    window.addEventListener('load', onFrameLoad, true);
  }

  function detach() {
    for (const doc of wired) {
      for (const [name, fn] of events) doc.removeEventListener(name, fn, true);
    }
    wired = [];
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll, true);
    window.removeEventListener('load', onFrameLoad, true);
  }

  function reset() {
    pending = [];
    dragStart = null;
    hovered = null;
    handlers.onPendingChange([]);
    handlers.onRegionChange(null);
    handlers.onHover(null);
  }

  attach();

  return {
    /** @param {PickMode} next */
    setMode(next) {
      if (mode === next) return;
      mode = next;
      reset();
      if (mode) {
        /* Re-scan on every mode change: an SPA may have mounted a preview frame
           since the overlay started. */
        wireFrames();
        root.setAttribute('data-earmark-picking', mode);
        for (const { doc } of sameOriginFrames()) {
          doc.documentElement.setAttribute('data-earmark-picking', mode);
        }
      } else {
        root.removeAttribute('data-earmark-picking');
        for (const { doc } of sameOriginFrames()) {
          doc.documentElement.removeAttribute('data-earmark-picking');
        }
      }
    },
    /** The frame an element belongs to, or null for the top document. */
    frameOf,
    sameOriginFrames,
    getMode: () => mode,
    clearPending: () => {
      pending = [];
      handlers.onPendingChange([]);
    },
    destroy() {
      detach();
      root.removeAttribute('data-earmark-picking');
    },
  };
}

/**
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 */
function rectFromPoints(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
