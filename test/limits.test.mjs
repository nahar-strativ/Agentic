/**
 * The three limitations that were closed or narrowed.
 *
 * All of it runs against a hand-built DOM rather than a browser, so these cover
 * the decisions (what is reported, what is refused) rather than the picking
 * itself, which is verified live in a real browser.
 *
 * Run with: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampSvelte, COMPONENT_ATTR } from 'earmark-stamp';
import { annotationToMarkdown } from 'earmark/markdown';

// ------------------------------------------- svelte component chain (build) --

test('a Svelte file stamps its own component name on every element it owns', () => {
  const result = stampSvelte('<main><section><button>Go</button></section></main>', {
    path: 'src/lib/Card.svelte',
  });
  assert.equal([...result.code.matchAll(new RegExp(`${COMPONENT_ATTR}="Card"`, 'g'))].length, 3);
});

test('nested components each stamp their own name, which is what makes a chain', () => {
  const outer = stampSvelte('<div><Card /></div>', { path: 'src/App.svelte' });
  const inner = stampSvelte('<button>Go</button>', { path: 'src/lib/Card.svelte' });
  assert.match(outer.code, /data-earmark-component="App"/);
  assert.doesNotMatch(outer.code, /Card"[^>]*data-earmark-component/, 'the component tag is not stamped');
  assert.match(inner.code, /data-earmark-component="Card"/);
});

// -------------------------------------------------------------- canvas ------

/** @param {object} canvas */
const canvasTarget = (canvas) => ({
  id: 'a1',
  note: 'the orange bar should be blue',
  target: {
    kind: 'element',
    tag: 'canvas',
    label: 'canvas#chart',
    selector: '#chart',
    canvas,
  },
});

test('a canvas reports its coordinate space, which is the only handle it has', () => {
  const out = annotationToMarkdown(
    canvasTarget({
      buffer: { width: 640, height: 360 },
      css: { width: 320, height: 180 },
      scale: { x: 2, y: 2 },
      devicePixelRatio: 2,
      context: '2d',
      library: 'chart.js',
      point: { x: 354, y: 200 },
    }),
  );
  assert.match(out, /buffer 640×360, CSS 320×180 \(2× \/ 2× per CSS pixel, dpr 2\)/);
  assert.match(out, /context: `2d`/);
  assert.match(out, /renderer: chart\.js/);
  assert.match(out, /clicked at buffer pixel \(354, 200\)/);
  assert.match(out, /nothing inside a canvas is in the DOM/);
});

test('a canvas with no detected library says nothing about one', () => {
  const out = annotationToMarkdown(
    canvasTarget({
      buffer: { width: 300, height: 150 },
      css: { width: 300, height: 150 },
      scale: { x: 1, y: 1 },
      devicePixelRatio: 1,
      context: 'webgl2',
      library: null,
    }),
  );
  assert.match(out, /context: `webgl2`/);
  assert.doesNotMatch(out, /renderer:/);
  assert.doesNotMatch(out, /clicked at buffer pixel/);
});

test('an empty region names what it was drawn on instead of only saying empty', () => {
  const out = annotationToMarkdown({
    id: 'a2',
    note: 'this bar is the wrong colour',
    target: {
      kind: 'region',
      label: 'region 120×90',
      rect: { x: 10, y: 10, width: 120, height: 90, pageX: 10, pageY: 10 },
      elements: [],
      emptyRegion: true,
      container: {
        label: 'canvas#chart',
        tag: 'canvas',
        selector: '#chart',
        source: null,
        rect: { x: 0, y: 0, width: 320, height: 180, pageX: 0, pageY: 0 },
        canvas: {
          buffer: { width: 640, height: 360 },
          css: { width: 320, height: 180 },
          scale: { x: 2, y: 2 },
          devicePixelRatio: 2,
          context: '2d',
          library: null,
          region: { x: 40, y: 40, width: 240, height: 180 },
        },
      },
    },
  });
  assert.match(out, /no elements fully inside this region/);
  assert.match(out, /\*\*Drawn on:\*\* canvas#chart/);
  assert.match(out, /region in buffer pixels: 240×180 at \(40, 40\)/);
});

test('an empty region over nothing at all still reports honestly', () => {
  const out = annotationToMarkdown({
    id: 'a3',
    note: 'too much space here',
    target: {
      kind: 'region',
      label: 'region 40×40',
      rect: { x: 0, y: 0, width: 40, height: 40, pageX: 0, pageY: 0 },
      elements: [],
      emptyRegion: true,
    },
  });
  assert.match(out, /no elements fully inside this region/);
  assert.doesNotMatch(out, /Drawn on/);
});

// -------------------------------------------------------------- iframes -----

test('a framed element says which document its selector belongs to', () => {
  const out = annotationToMarkdown({
    id: 'a4',
    note: 'Save button is too small',
    target: {
      kind: 'element',
      tag: 'button',
      label: 'button "Save"',
      selector: '[data-testid="frame-save"]',
      frame: {
        selector: '#preview',
        name: 'preview',
        url: 'http://localhost:5173/examples/frames/child.html',
        title: 'Preview pane',
      },
    },
  });
  assert.match(out, /\*\*Inside iframe:\*\* `#preview` \(preview\)/);
  assert.match(out, /frame document: http:\/\/localhost:5173\/examples\/frames\/child\.html/);
  assert.match(out, /resolves inside that frame, not the top page/);
});

test('an unframed element says nothing about frames', () => {
  const out = annotationToMarkdown({
    id: 'a5',
    note: 'x',
    target: { kind: 'element', tag: 'button', label: 'button', selector: '#b' },
  });
  assert.doesNotMatch(out, /iframe/i);
});
