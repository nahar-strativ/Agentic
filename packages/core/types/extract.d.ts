import type { Rect } from './index.js';

export { extractElement, extractSelection, extractRegion, pageContext } from './index.js';

/**
 * @param frame the same-origin iframe the element lives in, whose offset is added
 *   so the rect lands in the top window where the overlay draws
 */
export function rectOf(el: Element, frame?: { el: HTMLIFrameElement; doc: Document } | null): Rect;

/** One-line human label, e.g. `<Card>`, `button "Export"`, `div.panel`. */
export function labelFor(el: Element): string;
