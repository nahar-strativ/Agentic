/**
 * The overlay: shadow-root UI, annotation state, and the glue between the
 * picker, the extractor, the markdown serializer and the sync transport.
 */

import { OVERLAY_CSS, HOST_CSS } from './styles.js';
import { createPicker } from './picker.js';
import { createTransport } from './transport.js';
import {
  extractElement,
  extractSelection,
  extractRegion,
  pageContext,
  rectOf,
} from './extract.js';
import { batchToMarkdown } from './markdown.js';

const ROOT_ID = 'earmark-root';
const HOST_STYLE_ID = 'earmark-host-css';
const STORAGE_KEY = 'earmark:annotations';

const ICONS = {
  pick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.5 18 2.2-7.3L20 11.5z"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6V4h16v2M12 4v16M9 20h6"/></svg>',
  region:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/></svg>',
  freeze:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
};

/** @param {string} tag */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value != null && value !== false) {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const uid = () =>
  (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36))
    .replace(/-/g, '')
    .slice(0, 10);

/**
 * @param {object} config see createEarmark options
 */
export function createOverlay(config) {
  const {
    endpoint = null,
    hotkey = 'alt+a',
    theme = 'auto',
    persist = true,
    onAnnotate = null,
  } = config;

  if (document.getElementById(ROOT_ID)) {
    throw new Error('earmark: an overlay is already mounted on this page');
  }

  const sessionId = uid();

  /** @type {object[]} */
  let annotations = persist ? loadStored() : [];
  /** @type {{targets: object[], point: {x: number, y: number}} | null} */
  let draft = null;
  let panelOpen = false;
  let frozen = false;
  /** @type {string | null} */
  let focusedReplyId = null;

  // ---------------------------------------------------------------- DOM ----

  const host = h('div', { id: ROOT_ID });
  if (theme !== 'auto') host.setAttribute('data-theme', theme);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(h('style', { html: OVERLAY_CSS }));

  const hostStyle = h('style', { id: HOST_STYLE_ID, html: HOST_CSS });
  document.head.append(hostStyle);

  const pinLayer = h('div', { class: 'layer-page' });
  const highlightLabel = h('div', { class: 'highlight-label' });
  const highlight = h('div', { class: 'highlight' }, highlightLabel);
  const marquee = h('div', { class: 'marquee' });
  const toast = h('div', { class: 'toast' });

  const syncDot = h('div', { class: 'sync-dot', 'data-state': 'offline' });
  const countBadge = h('div', { class: 'count', 'data-empty': 'true' }, '0');

  const btnPick = toolButton('pick', 'Pick element  (click, shift-click to multi-select)');
  const btnText = toolButton('text', 'Select text');
  const btnRegion = toolButton('region', 'Drag a region');
  const btnFreeze = toolButton('freeze', 'Freeze animations and transitions');
  const btnPanel = toolButton('list', 'Annotations');

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    syncDot,
    btnPick,
    btnText,
    btnRegion,
    h('div', { class: 'tool-divider' }),
    btnFreeze,
    h('div', { class: 'tool-divider' }),
    btnPanel,
    countBadge,
  );

  const noteInput = h('textarea', {
    placeholder: 'What should change here?',
    rows: '3',
    spellcheck: 'false',
  });
  const popoverTarget = h('div', { class: 'popover-target' });
  const popover = h(
    'div',
    { class: 'popover' },
    popoverTarget,
    noteInput,
    h(
      'div',
      { class: 'popover-actions' },
      h('span', { class: 'hint' }, '⌘↵ save · esc cancel'),
      h('button', { class: 'btn', onclick: cancelDraft }, 'Cancel'),
      h('button', { class: 'btn btn-primary', onclick: commitDraft }, 'Add'),
    ),
  );

  const panelList = h('div', { class: 'panel-list' });
  const panel = h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel-head' },
      h('div', { class: 'panel-title' }, 'Annotations'),
      h('button', { class: 'btn', onclick: () => togglePanel(false) }, 'Close'),
    ),
    panelList,
    h(
      'div',
      { class: 'panel-foot' },
      h('button', { class: 'btn btn-primary', onclick: copyAll }, 'Copy markdown'),
      h('button', { class: 'btn', onclick: clearAll }, 'Clear'),
    ),
  );

  const fixedLayer = h('div', { class: 'layer-fixed' }, highlight, marquee, toolbar, panel, popover, toast);
  shadow.append(pinLayer, fixedLayer);
  document.body.append(host);

  /**
   * @param {keyof typeof ICONS} icon
   * @param {string} title
   */
  function toolButton(icon, title) {
    return h('button', {
      class: 'tool',
      title,
      'aria-pressed': 'false',
      html: ICONS[icon],
    });
  }

  // ------------------------------------------------------------ transport --

  const transport = endpoint
    ? createTransport({
        endpoint,
        sessionId,
        onState: (state) => syncDot.setAttribute('data-state', state),
        onEvent: handleServerEvent,
      })
    : null;

  if (transport) {
    transport.connect().then((ok) => {
      if (ok) reconcile();
    });
  }

  /**
   * On (re)connect the broker is authoritative for agent-side fields — status
   * and the reply thread may have moved on while this tab was closed. Anything
   * the broker has never seen gets pushed up; anything it already knows about
   * gets pulled down. Blindly pushing would erase the agent's replies.
   */
  async function reconcile() {
    if (!transport) return;
    try {
      const { annotations: remote } = await transport.list();
      const byId = new Map(remote.map((a) => [a.id, a]));

      const unknown = annotations.filter((a) => !byId.has(a.id));
      annotations = annotations.map((local) => {
        const server = byId.get(local.id);
        return server ? { ...local, status: server.status, replies: server.replies || [] } : local;
      });

      save();
      render();

      if (unknown.length) await transport.push(unknown, pageContext());
    } catch {
      /* broker went away mid-handshake — stay in copy-paste mode */
    }
  }

  /** @param {{type: string, data: any}} event */
  function handleServerEvent(event) {
    const { type, data } = event;
    if (type === 'annotation.updated' && data?.id) {
      const index = annotations.findIndex((a) => a.id === data.id);
      if (index >= 0) {
        annotations[index] = { ...annotations[index], ...data };
        save();
        render();
        if (data.status === 'needs-input') showToast('Agent asked a question');
        if (data.status === 'resolved') showToast('Agent resolved an annotation');
      }
      return;
    }
    if (type === 'annotation.deleted' && data?.id) {
      annotations = annotations.filter((a) => a.id !== data.id);
      save();
      render();
      return;
    }
    if (type === 'annotations.cleared') {
      annotations = [];
      save();
      render();
    }
  }

  // --------------------------------------------------------------- picker --

  const picker = createPicker({
    isOverlay: (node) =>
      node === host || (node instanceof Node && (host.contains(node) || node.getRootNode?.() === shadow)),
    onHover: (el) => {
      if (!el) return hideHighlight();
      const rect = el.getBoundingClientRect();
      showHighlight(rect, describe(el));
    },
    onPendingChange: (elements) => {
      renderPending(elements);
    },
    onRegionChange: (rect) => {
      if (!rect) {
        marquee.style.display = 'none';
        return;
      }
      Object.assign(marquee.style, {
        display: 'block',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    },
    onPick: (payload, point) => openDraft(payload, point),
    onCancel: () => setMode(null),
  });

  /** @param {Element} el */
  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = Array.from(el.classList)
      .filter((c) => !c.startsWith('earmark-'))
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('');
    const r = el.getBoundingClientRect();
    return `${tag}${id}${cls}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  /**
   * @param {DOMRect | {x: number, y: number, width: number, height: number}} rect
   * @param {string} label
   */
  function showHighlight(rect, label) {
    const top = 'top' in rect ? rect.top : rect.y;
    const left = 'left' in rect ? rect.left : rect.x;
    Object.assign(highlight.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    highlight.setAttribute('data-visible', 'true');
    highlight.setAttribute('data-flip', top < 26 ? 'true' : 'false');
    highlightLabel.textContent = label;
  }

  function hideHighlight() {
    highlight.setAttribute('data-visible', 'false');
  }

  /** @type {HTMLElement[]} */
  let pendingBoxes = [];

  /** @param {Element[]} elements */
  function renderPending(elements) {
    pendingBoxes.forEach((box) => box.remove());
    pendingBoxes = elements.map((el) => {
      const r = rectOf(el);
      const box = h('div', { class: 'pin-box' });
      Object.assign(box.style, {
        left: `${r.pageX}px`,
        top: `${r.pageY}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      pinLayer.append(box);
      return box;
    });
  }

  // ---------------------------------------------------------------- draft --

  /**
   * @param {object} payload from the picker
   * @param {{x: number, y: number}} point
   */
  function openDraft(payload, point) {
    /** @type {object[]} */
    let targets = [];

    if (payload.type === 'elements') {
      targets = payload.elements.map(extractElement);
    } else if (payload.type === 'text') {
      const extracted = extractSelection(payload.selection);
      if (!extracted) return;
      targets = [extracted];
    } else if (payload.type === 'region') {
      targets = [extractRegion(payload.rect)];
    }

    if (!targets.length) return;

    draft = { targets, point };
    const summary = targets.map((t) => t.label).join(', ');
    const source = targets.find((t) => t.source)?.source;
    popoverTarget.innerHTML = '';
    popoverTarget.append(h('b', {}, summary));
    if (source) popoverTarget.append(document.createTextNode(`  ${source}`));

    noteInput.value = '';
    popover.setAttribute('data-open', 'true');
    positionPopover(point);
    hideHighlight();
    noteInput.focus();
  }

  /** @param {{x: number, y: number}} point */
  function positionPopover(point) {
    const width = 320;
    const height = popover.offsetHeight || 150;
    const left = Math.min(Math.max(8, point.x + 12), window.innerWidth - width - 8);
    const top = Math.min(Math.max(8, point.y + 12), window.innerHeight - height - 8);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function cancelDraft() {
    draft = null;
    popover.setAttribute('data-open', 'false');
    picker.clearPending();
  }

  function commitDraft() {
    if (!draft) return;
    const annotation = {
      id: uid(),
      note: noteInput.value.trim(),
      status: 'open',
      createdAt: new Date().toISOString(),
      page: pageContext(),
      targets: draft.targets,
      replies: [],
    };
    annotations.push(annotation);
    draft = null;
    popover.setAttribute('data-open', 'false');
    picker.clearPending();
    save();
    render();
    transport?.push([annotation], annotation.page).catch(() => {});
    onAnnotate?.(annotation);
  }

  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitDraft();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelDraft();
    }
    e.stopPropagation();
  });

  // ---------------------------------------------------------------- modes --

  /** @param {import('./picker.js').PickMode} next */
  function setMode(next) {
    const current = picker.getMode();
    const mode = current === next ? null : next;
    picker.setMode(mode);
    btnPick.setAttribute('aria-pressed', String(mode === 'element'));
    btnText.setAttribute('aria-pressed', String(mode === 'text'));
    btnRegion.setAttribute('aria-pressed', String(mode === 'region'));
    if (!mode) {
      hideHighlight();
      marquee.style.display = 'none';
    }
  }

  btnPick.addEventListener('click', () => setMode('element'));
  btnText.addEventListener('click', () => setMode('text'));
  btnRegion.addEventListener('click', () => setMode('region'));
  btnPanel.addEventListener('click', () => togglePanel());
  btnFreeze.addEventListener('click', () => {
    frozen = !frozen;
    btnFreeze.setAttribute('aria-pressed', String(frozen));
    if (frozen) document.documentElement.setAttribute('data-earmark-frozen', '');
    else document.documentElement.removeAttribute('data-earmark-frozen');
  });

  /** @param {boolean} [force] */
  function togglePanel(force) {
    panelOpen = force ?? !panelOpen;
    panel.setAttribute('data-open', String(panelOpen));
    btnPanel.setAttribute('aria-pressed', String(panelOpen));
    if (panelOpen) render();
  }

  // ------------------------------------------------------------- rendering --

  function render() {
    countBadge.textContent = String(annotations.length);
    countBadge.setAttribute('data-empty', String(annotations.length === 0));
    renderPins();
    if (panelOpen) renderPanel();
  }

  /**
   * Re-resolve a target's live position so pins follow layout changes; fall
   * back to the captured coordinates when the element is gone.
   * @param {object} target
   */
  function liveRect(target) {
    if (target.selector) {
      try {
        const el = document.querySelector(target.selector);
        if (el) return rectOf(el);
      } catch {
        /* stale selector */
      }
    }
    return target.rect;
  }

  function renderPins() {
    pinLayer.innerHTML = '';
    pendingBoxes = [];
    annotations.forEach((annotation, index) => {
      annotation.targets.forEach((target, targetIndex) => {
        const r = liveRect(target);
        const box = h('div', { class: 'pin-box' });
        Object.assign(box.style, {
          left: `${r.pageX}px`,
          top: `${r.pageY}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
        pinLayer.append(box);

        if (targetIndex > 0) return;
        const pin = h(
          'div',
          {
            class: 'pin',
            'data-status': annotation.status,
            title: annotation.note || target.label,
            onclick: () => {
              togglePanel(true);
              highlightItem(annotation.id);
            },
          },
          String(index + 1),
        );
        Object.assign(pin.style, { left: `${r.pageX}px`, top: `${r.pageY}px` });
        pinLayer.append(pin);
      });
    });
  }

  function renderPanel() {
    panelList.innerHTML = '';

    if (!annotations.length) {
      panelList.append(
        h(
          'div',
          { class: 'panel-empty' },
          'No annotations yet. Click the arrow, then click anything on the page.',
        ),
      );
      return;
    }

    annotations.forEach((annotation, index) => {
      const target = annotation.targets[0];
      const meta = target.source
        ? target.source
        : target.selector || `${target.elements?.length ?? 0} elements`;

      const item = h(
        'div',
        {
          class: 'item',
          'data-status': annotation.status,
          'data-id': annotation.id,
          onclick: () => scrollToAnnotation(annotation),
        },
        h(
          'div',
          { class: 'item-head' },
          h('div', { class: 'item-index' }, String(index + 1)),
          h('div', { class: 'item-note' }, annotation.note || target.label),
          h(
            'button',
            {
              class: 'item-del',
              title: 'Delete',
              onclick: (e) => {
                e.stopPropagation();
                remove(annotation.id);
              },
            },
            '×',
          ),
        ),
        h('div', { class: 'item-meta' }, meta),
      );

      if (annotation.replies?.length) {
        const thread = h('div', { class: 'item-thread' });
        for (const reply of annotation.replies) {
          thread.append(
            h(
              'div',
              { class: 'reply', 'data-author': reply.author },
              h('b', {}, `${reply.author}: `),
              reply.message,
            ),
          );
        }
        if (annotation.status === 'needs-input') {
          const input = h('input', { placeholder: 'Answer the agent…', 'data-reply-for': annotation.id });
          input.addEventListener('click', (e) => e.stopPropagation());
          input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key !== 'Enter' || !input.value.trim()) return;
            addReply(annotation.id, input.value.trim());
            input.value = '';
          });
          input.addEventListener('focus', () => (focusedReplyId = annotation.id));
          input.addEventListener('blur', () => {
            if (focusedReplyId === annotation.id) focusedReplyId = null;
          });
          thread.append(h('div', { class: 'reply-form' }, input));
        }
        item.append(thread);
      }

      panelList.append(item);
    });

    if (focusedReplyId) {
      const input = panelList.querySelector(`input[data-reply-for="${focusedReplyId}"]`);
      /** @type {HTMLInputElement | null} */ (input)?.focus();
    }
  }

  /** @param {string} id */
  function highlightItem(id) {
    const item = panelList.querySelector(`.item[data-id="${id}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }

  /** @param {object} annotation */
  function scrollToAnnotation(annotation) {
    const target = annotation.targets[0];
    const el = target.selector ? safeQuery(target.selector) : null;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const r = el.getBoundingClientRect();
      showHighlight(r, annotation.note || target.label);
      setTimeout(hideHighlight, 1400);
    } else {
      window.scrollTo({ top: Math.max(0, target.rect.pageY - 150), behavior: 'smooth' });
    }
  }

  /** @param {string} selector */
  function safeQuery(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- state --

  /** @param {string} id */
  function remove(id) {
    annotations = annotations.filter((a) => a.id !== id);
    save();
    render();
    transport?.remove(id).catch(() => {});
  }

  function clearAll() {
    if (!annotations.length) return;
    const ids = annotations.map((a) => a.id);
    annotations = [];
    save();
    render();
    ids.forEach((id) => transport?.remove(id).catch(() => {}));
  }

  /**
   * @param {string} id
   * @param {string} message
   */
  function addReply(id, message) {
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation) return;
    annotation.replies = [...(annotation.replies || []), { author: 'human', message, at: new Date().toISOString() }];
    annotation.status = 'open';
    save();
    render();
    transport?.reply(id, message, 'open').catch(() => {});
  }

  function markdown() {
    return batchToMarkdown(annotations, pageContext());
  }

  async function copyAll() {
    if (!annotations.length) return showToast('Nothing to copy');
    const text = markdown();
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Copied ${annotations.length} annotation${annotations.length === 1 ? '' : 's'}`);
    } catch {
      // Clipboard API needs a secure context; fall back to a hidden textarea.
      const area = h('textarea', {});
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      showToast('Copied');
    }
  }

  /** @param {string} message */
  function showToast(message) {
    toast.textContent = message;
    toast.setAttribute('data-show', 'true');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.setAttribute('data-show', 'false'), 1800);
  }

  function save() {
    if (!persist) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(annotations));
    } catch {
      /* quota or disabled storage — annotations stay in memory */
    }
  }

  function loadStored() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------- shortcuts --

  const hotkeyParts = hotkey.toLowerCase().split('+');
  const hotkeyKey = hotkeyParts.at(-1);

  /** @param {KeyboardEvent} e */
  function onGlobalKey(e) {
    const wantsAlt = hotkeyParts.includes('alt');
    const wantsMeta = hotkeyParts.includes('meta') || hotkeyParts.includes('cmd');
    const wantsCtrl = hotkeyParts.includes('ctrl');
    const wantsShift = hotkeyParts.includes('shift');
    if (
      e.key.toLowerCase() === hotkeyKey &&
      e.altKey === wantsAlt &&
      e.metaKey === wantsMeta &&
      e.ctrlKey === wantsCtrl &&
      e.shiftKey === wantsShift
    ) {
      e.preventDefault();
      setMode('element');
    }
  }

  window.addEventListener('keydown', onGlobalKey);

  const onLayoutChange = () => {
    if (annotations.length) renderPins();
  };
  window.addEventListener('resize', onLayoutChange);

  render();

  // ------------------------------------------------------------------ api --

  return {
    get annotations() {
      return annotations.map((a) => ({ ...a }));
    },
    markdown,
    copy: copyAll,
    clear: clearAll,
    /** @param {import('./picker.js').PickMode} mode */
    setMode,
    openPanel: () => togglePanel(true),
    closePanel: () => togglePanel(false),
    destroy() {
      picker.destroy();
      transport?.destroy();
      window.removeEventListener('keydown', onGlobalKey);
      window.removeEventListener('resize', onLayoutChange);
      document.documentElement.removeAttribute('data-earmark-frozen');
      hostStyle.remove();
      host.remove();
    },
  };
}
