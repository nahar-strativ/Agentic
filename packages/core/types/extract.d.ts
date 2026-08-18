import type { Rect } from './index.js';

export { extractElement, extractSelection, extractRegion, pageContext } from './index.js';

export function rectOf(el: Element): Rect;

/** One-line human label, e.g. `<Card>`, `button "Export"`, `div.panel`. */
export function labelFor(el: Element): string;
