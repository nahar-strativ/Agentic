/**
 * Framework introspection.
 *
 * Reads whatever the running framework leaves on the DOM node so an agent gets
 * a component name chain, not just a CSS selector. Everything here is
 * best-effort and dev-build dependent — callers must handle nulls.
 *
 * Source-file paths come from the build-time `data-earmark-src` attribute
 * (see @earmark/vite-plugin). React <19 also exposes `_debugSource` at runtime;
 * React 19 removed it, which is why the build plugin exists.
 */

export const SOURCE_ATTR = 'data-earmark-src';

/**
 * The component an element was written in, stamped at build time. Svelte has no
 * runtime equivalent of a React fiber, so for Svelte this attribute is the only
 * way a component chain can exist at all.
 */
export const COMPONENT_ATTR = 'data-earmark-component';

/** Components that are framework plumbing rather than app code. */
const NOISE_COMPONENTS = new Set([
  'Fragment',
  'Suspense',
  'StrictMode',
  'Profiler',
  'ErrorBoundary',
  'Provider',
  'Consumer',
  'ForwardRef',
  'Memo',
  'Router',
  'Routes',
  'Route',
  'Outlet',
  'AppRouter',
  'Anonymous',
]);

/**
 * @param {Element} node
 * @returns {any | null} the React fiber attached to a host node
 */
function reactFiber(node) {
  for (const key of Object.keys(node)) {
    if (key.startsWith('__reactFiber$')) return node[key];
    if (key.startsWith('__reactInternalInstance$')) return node[key];
  }
  return null;
}

/**
 * @param {any} type a fiber `type` field
 * @returns {string | null}
 */
function fiberName(type) {
  if (!type) return null;
  if (typeof type === 'string') return null; // host element (div, span, ...)
  if (typeof type === 'function') return type.displayName || type.name || null;
  if (typeof type === 'object') {
    // memo / forwardRef / lazy wrappers
    if (type.displayName) return type.displayName;
    if (type.render) return type.render.displayName || type.render.name || null;
    if (type.type) return fiberName(type.type);
  }
  return null;
}

/**
 * @param {any} source a fiber `_debugSource` object
 * @returns {string | null} `path:line:col`
 */
function formatDebugSource(source) {
  if (!source || !source.fileName) return null;
  const file = source.fileName.replace(/^.*?\/(src|app|pages|components)\//, '$1/');
  const line = source.lineNumber ?? 0;
  const col = source.columnNumber ?? 0;
  return col ? `${file}:${line}:${col}` : `${file}:${line}`;
}

/**
 * Walk the fiber return chain collecting app component names, outermost first.
 * @param {Element} node
 * @returns {{components: string[], source: string | null} | null}
 */
function inspectReact(node) {
  const fiber = reactFiber(node);
  if (!fiber) return null;

  const components = [];
  let source = null;
  let current = fiber;
  let hops = 0;

  while (current && hops < 60) {
    const name = fiberName(current.type);
    if (name && !NOISE_COMPONENTS.has(name) && components[0] !== name) {
      components.unshift(name);
    }
    if (!source) source = formatDebugSource(current._debugSource);
    current = current.return;
    hops += 1;
  }

  return { components: components.slice(-8), source };
}

/**
 * Vue 3 exposes `__vueParentComponent`; Vue 2 exposes `__vue__`.
 * @param {Element} node
 * @returns {{components: string[], source: string | null} | null}
 */
function inspectVue(node) {
  let instance = node.__vueParentComponent;
  if (instance) {
    const components = [];
    let hops = 0;
    while (instance && hops < 60) {
      const type = instance.type || {};
      const name = type.__name || type.name || type.displayName;
      if (name && !NOISE_COMPONENTS.has(name)) components.unshift(name);
      if (!components.length && type.__file) components.unshift(baseName(type.__file));
      instance = instance.parent;
      hops += 1;
    }
    const file = node.__vueParentComponent?.type?.__file || null;
    return { components: components.slice(-8), source: file };
  }

  const legacy = node.__vue__;
  if (legacy) {
    const components = [];
    let vm = legacy;
    let hops = 0;
    while (vm && hops < 60) {
      const name = vm.$options?.name || vm.$options?._componentTag;
      if (name && !NOISE_COMPONENTS.has(name)) components.unshift(name);
      vm = vm.$parent;
      hops += 1;
    }
    return { components: components.slice(-8), source: legacy.$options?.__file || null };
  }

  return null;
}

/**
 * @param {string} path
 * @returns {string}
 */
function baseName(path) {
  return String(path).split('/').pop()?.replace(/\.\w+$/, '') || String(path);
}

/**
 * Angular leaves an `ng-version` attribute on the root and `_ngcontent-*` /
 * `_nghost-*` attributes on components. The host attribute names the component
 * scope, which is enough to grep for.
 * @param {Element} node
 * @returns {{components: string[], source: string | null} | null}
 */
function inspectAngular(node) {
  if (!document.querySelector('[ng-version]')) return null;
  const components = [];
  let current = node;
  let hops = 0;
  while (current && hops < 20) {
    if (current.tagName && current.tagName.includes('-')) {
      const tag = current.tagName.toLowerCase();
      if (!components.includes(tag)) components.unshift(tag);
    }
    current = current.parentElement;
    hops += 1;
  }
  return components.length ? { components: components.slice(-8), source: null } : null;
}

/**
 * Read the build-time source stamp from the element or its nearest ancestor.
 * @param {Element} el
 * @param {number} [maxHops]
 * @returns {{source: string, exact: boolean} | null}
 */
export function sourceStamp(el, maxHops = 5) {
  let node = el;
  let hops = 0;
  while (node && node.nodeType === 1 && hops <= maxHops) {
    const value = node.getAttribute?.(SOURCE_ATTR);
    if (value) return { source: value, exact: hops === 0 };
    node = node.parentElement;
    hops += 1;
  }
  return null;
}

/**
 * Component chain rebuilt from build-time stamps: walk to the root collecting
 * distinct component names, outermost first. Consecutive duplicates collapse,
 * because every element inside a component carries that component's name and
 * `Card > Card > Card` says nothing.
 *
 * @param {Element} el
 * @returns {string[]}
 */
export function stampedComponents(el) {
  /** @type {string[]} */
  const chain = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const name = node.getAttribute?.(COMPONENT_ATTR);
    if (name && name !== chain[0]) chain.unshift(name);
    node = node.parentElement;
  }
  return chain;
}

/**
 * Detect which framework rendered the page.
 * @returns {'react' | 'vue' | 'angular' | 'svelte' | 'unknown'}
 */
export function detectFramework() {
  if (typeof document === 'undefined') return 'unknown';
  if (document.querySelector('[ng-version]')) return 'angular';
  if (window.__VUE__ || document.querySelector('[data-v-app]')) return 'vue';
  if (window.__svelte || document.querySelector('[class*="svelte-"]')) return 'svelte';
  const root = document.body?.firstElementChild;
  if (root && Object.keys(root).some((k) => k.startsWith('__react'))) return 'react';
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size) return 'react';
  return 'unknown';
}

/**
 * Full framework context for one element.
 *
 * @param {Element} el
 * @returns {{framework: string, components: string[], source: string | null, sourceExact: boolean}}
 */
export function inspectElement(el) {
  const stamp = sourceStamp(el);
  const probes = [inspectReact, inspectVue, inspectAngular];

  for (const probe of probes) {
    let result = null;
    try {
      result = probe(el);
    } catch {
      result = null;
    }
    if (result && (result.components.length || result.source)) {
      return {
        framework: probe === inspectReact ? 'react' : probe === inspectVue ? 'vue' : 'angular',
        components: result.components.length ? result.components : stampedComponents(el),
        source: stamp?.source || result.source || null,
        sourceExact: stamp ? stamp.exact : false,
      };
    }
  }

  /* No probe matched. Svelte and any other compile-to-DOM framework land here,
     and a build-time stamp is the only component information that can exist. */
  return {
    framework: detectFramework(),
    components: stampedComponents(el),
    source: stamp?.source || null,
    sourceExact: stamp ? stamp.exact : false,
  };
}
