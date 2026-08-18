import type { CssRuleMatch } from './index.js';

/** Where an element sits in the served HTML. */
export interface HtmlSource {
  /** Repo-relative path of the document, e.g. `index.html`. */
  source: string;
  line: number;
  column: number;
}

/** Element position in the served HTML, or null when the walk did not verify. */
export function resolveHtmlSource(el: Element): Promise<HtmlSource | null>;

/** Stylesheet rules the element matches, each mapped back to a file and line. */
export function resolveCssRules(el: Element): Promise<CssRuleMatch[]>;

/** Everything a page with no build step can offer for one element. */
export function resolveStaticSource(el: Element): Promise<{ html: HtmlSource | null; css: CssRuleMatch[] }>;

/** Fetch the document into cache before the user commits an annotation. */
export function warmSourceCache(): void;

/** Reset every cache — call after an edit so the next annotation re-reads. */
export function clearSourceCache(): void;

/** Normalised selector → the line each occurrence is declared on, in source order. */
export function indexStylesheet(text: string, lineOffset?: number): Map<string, number[]>;

/** Offset-tracking HTML parse. Correct about nesting and offsets, nothing else. */
export function parseHtmlWithPositions(source: string): {
  tag: string;
  offset: number;
  children: any[];
};

/** Same-origin URLs become repo-relative paths; others are returned as given. */
export function relativeUrl(url: string): string;
