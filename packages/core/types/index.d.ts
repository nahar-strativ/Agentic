/**
 * Type declarations for earmark.
 *
 * Hand-written rather than emitted. The source is JSDoc-typed JavaScript with no
 * build step, and generating these would mean adding one — so instead these
 * describe the *contract*: the shapes that cross a boundary (browser → broker →
 * agent) and that a consumer is entitled to rely on. Internals stay loose on
 * purpose, and anything genuinely open-ended is `unknown` rather than a lie.
 */

// ---------------------------------------------------------------- domain --

/** Where an annotation stands. See §4.12 of plan.md for why `acknowledged` exists. */
export type Status = 'open' | 'acknowledged' | 'needs-input' | 'resolved' | 'dismissed';

/** Statuses that still represent outstanding work. */
export type ActiveStatus = 'open' | 'acknowledged' | 'needs-input';

export type Priority = 'high' | 'normal' | 'low';

export type Framework = 'react' | 'vue' | 'angular' | 'svelte' | 'unknown';

export type PickMode = 'element' | 'text' | 'region' | null;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Document coordinates — survives scrolling, unlike `x`/`y`. */
  pageX: number;
  pageY: number;
}

export interface AncestorSummary {
  tag: string;
  id: string | null;
  classes: string[];
  component: string | null;
  source: string | null;
}

/** One thing the human pointed at. */
export interface ElementTarget {
  kind: 'element' | 'text';
  label: string;
  tag: string;
  /** Verified unique at capture time. */
  selector: string;
  testId: string | null;
  domPath: string;
  text: string | null;
  /** Present on `kind: 'text'` — the exact selected string. */
  selectedText?: string;
  attributes: Record<string, string>;
  classes: string[];
  rect: Rect;
  /** Only properties that differ from their initial value. */
  styles: Record<string, string>;
  framework: Framework;
  /** Outermost first, e.g. `['App', 'Dashboard', 'Card']`. */
  components: string[];
  /** `src/components/Card.tsx:42:7`, when it could be established. */
  source: string | null;
  /** False when `source` came from a stamped ancestor rather than the element. */
  sourceExact: boolean;
  /** How `source` was established. Absent means a build-time stamp. */
  sourceFrom?: 'html';
  ancestors: AncestorSummary[];
  /** Rules that style the element, resolved with no build step (§4.13). */
  cssRules?: CssRuleMatch[];
}

/** A stylesheet rule the element matches, mapped back to where it is declared. */
export interface CssRuleMatch {
  file: string;
  /** Null when the rule could not be located in the source text. */
  line: number | null;
  selector: string;
  /** The `@media` condition the rule sits under, if any. */
  condition: string | null;
  declarations: string;
}

export interface RegionTarget {
  kind: 'region';
  label: string;
  rect: Rect;
  framework: Framework;
  elements: Array<{ label: string; selector: string; source: string | null; rect: Rect }>;
  /** True when a drag caught nothing — a canvas, or empty space. */
  emptyRegion: boolean;
}

export type Target = ElementTarget | RegionTarget;

export interface Reply {
  author: 'agent' | 'human';
  message: string;
  at: string;
}

export interface Annotation {
  id: string;
  /** Monotonic per store. Cursors and `watch` compare against this. */
  seq?: number;
  note: string;
  status: Status;
  priority: Priority;
  target: Target;
  /** Present when one annotation covers several elements. */
  targets?: Target[];
  replies: Reply[];
  page: PageContext | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface PageContext {
  url: string;
  path: string;
  title: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  scroll: { x: number; y: number };
  colorScheme: 'light' | 'dark';
  framework: Framework;
  userAgent: string;
}

/** One browser tab, not one page load (§4.11). */
export interface Session {
  id: string;
  startedAt: string;
  /** True for exactly as long as the tab's SSE stream is open. */
  connected: boolean;
  url: string | null;
  title: string | null;
  framework: Framework | null;
  viewport: { width: number; height: number } | null;
  colorScheme: 'light' | 'dark' | null;
  /** Pathnames visited in this tab, in order of first visit. */
  routes: string[];
  lastSeenAt: string;
  counts?: Record<string, number>;
}

// ------------------------------------------------------------- the overlay --

export interface EarmarkOptions {
  /** Broker URL, or `false` for copy-paste only. Defaults to the local broker. */
  endpoint?: string | false;
  /** e.g. `'alt+a'`, `'meta+shift+k'`. */
  hotkey?: string;
  theme?: 'auto' | 'light' | 'dark';
  /** Keep annotations in sessionStorage across reloads. Default true. */
  persist?: boolean;
  onAnnotate?: (annotation: Annotation) => void;
}

export interface EarmarkInstance {
  /** A copy — mutating it does not affect the overlay. */
  readonly annotations: Annotation[];
  markdown(): string;
  copy(): Promise<void>;
  clear(): void;
  setMode(mode: PickMode): void;
  openPanel(): void;
  closePanel(): void;
  readonly sessionId: string;
  destroy(): void;
}

export const DEFAULT_ENDPOINT: string;

/** Mount the overlay. Calling it twice returns the existing instance. */
export function createEarmark(options?: EarmarkOptions): EarmarkInstance;
export function destroyEarmark(): void;
export function getEarmark(): EarmarkInstance | null;

// ------------------------------------------------------------ the pieces --

export function batchToMarkdown(
  annotations: Annotation[],
  page?: PageContext | null,
  options?: { instructions?: boolean },
): string;
export function annotationToMarkdown(annotation: Annotation, index?: number): string;

export function extractElement(el: Element): ElementTarget;
export function extractSelection(selection: Selection | null): ElementTarget | null;
export function extractRegion(region: { x: number; y: number; width: number; height: number }): RegionTarget;
export function pageContext(): PageContext;

export function uniqueSelector(el: Element, options?: { maxDepth?: number; root?: ParentNode }): string;
export function domPath(el: Element, depth?: number): string;

export function inspectElement(el: Element): {
  framework: Framework;
  components: string[];
  source: string | null;
  sourceExact: boolean;
};
export function detectFramework(): Framework;

export const SOURCE_ATTR: 'data-earmark-src';

declare global {
  interface Window {
    earmark?: EarmarkInstance;
  }
}
