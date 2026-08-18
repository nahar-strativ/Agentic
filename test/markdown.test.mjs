/**
 * The markdown serializer, fed payloads the overlay would never send.
 *
 * The broker accepts annotations over plain HTTP, so curl, another editor or a
 * script can push one with `rect`, `viewport` or `tag` missing. Found live: a
 * payload with no `page.viewport` made `earmark_list_annotations` return
 * "earmark: Cannot read properties of undefined (reading 'width')" instead of the
 * agent's work list, while the JSON format returned the data perfectly. A missing
 * optional field must cost a line of output, never the whole report.
 *
 * Run with: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchToMarkdown, annotationToMarkdown } from 'earmark/markdown';

/** The minimum a third party might realistically post. */
const sparse = {
  id: 'a1',
  note: 'Export button padding is too tight',
  priority: 'high',
  status: 'open',
  target: {
    kind: 'element',
    label: 'button',
    selector: '[data-testid="export-btn"]',
    source: 'index.html:101:11',
  },
};

test('a page with no viewport still renders', () => {
  const out = batchToMarkdown([sparse], { url: 'http://localhost:5173/' });
  assert.match(out, /\*\*Page:\*\* http:\/\/localhost:5173\//);
  assert.doesNotMatch(out, /Viewport/);
  assert.match(out, /Export button padding is too tight/);
});

test('a target with no rect omits the Box line rather than emitting an empty one', () => {
  const out = annotationToMarkdown(sparse);
  assert.doesNotMatch(out, /\*\*Box:\*\*/);
});

test('a target with no tag does not report `<undefined>`', () => {
  const out = annotationToMarkdown(sparse);
  assert.doesNotMatch(out, /undefined/);
  assert.match(out, /\*\*Element:\*\* button/);
});

test('an absent sourceExact makes no claim either way', () => {
  const out = annotationToMarkdown(sparse);
  assert.match(out, /\*\*Source:\*\* `index\.html:101:11`$/m);
  assert.doesNotMatch(out, /nearest stamped ancestor/);
});

test('sourceExact false still says the path is approximate', () => {
  const out = annotationToMarkdown({
    ...sparse,
    target: { ...sparse.target, sourceExact: false },
  });
  assert.match(out, /_\(nearest stamped ancestor\)_/);
});

test('a resolved HTML source is still labelled as such', () => {
  const out = annotationToMarkdown({
    ...sparse,
    target: { ...sparse.target, sourceExact: true, sourceFrom: 'html' },
  });
  assert.match(out, /_\(resolved from the served HTML\)_/);
});

test('a full overlay payload is unchanged by the guards', () => {
  const out = annotationToMarkdown({
    ...sparse,
    target: {
      ...sparse.target,
      tag: 'button',
      sourceExact: true,
      rect: { x: 194, y: 376, width: 66, height: 37, pageX: 194, pageY: 376 },
    },
  });
  assert.match(out, /\*\*Element:\*\* `<button>` button/);
  assert.match(out, /\*\*Box:\*\* 66×37 at \(194, 376\)/);
});

test('no target at all is reported, not thrown', () => {
  const out = batchToMarkdown([{ id: 'a2', note: 'the whole page feels cramped' }], null);
  assert.match(out, /the whole page feels cramped/);
});
