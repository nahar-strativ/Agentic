export { uniqueSelector, domPath } from './index.js';

/** The winning test-id attribute for an element, if it has one. */
export function testIdOf(el: Element): { name: string; value: string; selector: string } | null;

/** Class names with build hashes (emotion, CSS Modules, Vite) filtered out. */
export function stableClasses(el: Element): string[];

/** Full `nth-child` path from the document root. The last-resort selector. */
export function absolutePath(el: Element): string;
