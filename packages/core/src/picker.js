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

  /** @param {Event} e */
  const fromOverlay = (e) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return path.some((n) => handlers.isOverlay(n)) || handlers.isOverlay(e.target);
  };

  /** @param {MouseEvent} e */
  const targetAt = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || handlers.isOverlay(el)) return null;
    if (el === document.documentElement || el === document.body) return el;
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

  function attach() {
    for (const [name, fn] of events) document.addEventListener(name, fn, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);
  }

  function detach() {
    for (const [name, fn] of events) document.removeEventListener(name, fn, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll, true);
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
      if (mode) root.setAttribute('data-earmark-picking', mode);
      else root.removeAttribute('data-earmark-picking');
    },
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
