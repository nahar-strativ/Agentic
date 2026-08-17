/**
 * The pure halves of the no-build source resolver: the HTML position parser and
 * the stylesheet line index. Both run without a DOM, so they are tested
 * directly rather than through a browser.
 *
 * Run with: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtmlWithPositions, indexStylesheet } from 'earmark/sourcemap';

/**
 * Walk a parsed tree by element-child index.
 * @param {any} tree
 * @param {number[]} path
 */
function at(tree, path) {
  let node = tree;
  for (const index of path) node = node.children[index];
  return node;
}

test('records every element with its offset', () => {
  const html = ['<html>', '  <body>', '    <div>hi</div>', '  </body>', '</html>'].join('\n');
  const tree = parseHtmlWithPositions(html);

  const root = tree.children[0];
  assert.equal(root.tag, 'html');
  assert.equal(at(tree, [0, 0]).tag, 'body');
  assert.equal(at(tree, [0, 0, 0]).tag, 'div');
  assert.equal(html.slice(at(tree, [0, 0, 0]).offset, at(tree, [0, 0, 0]).offset + 5), '<div>');
});

test('void elements do not swallow their siblings', () => {
  const tree = parseHtmlWithPositions('<div><img src="a.png"><br><span>after</span></div>');
  const div = tree.children[0];
  assert.deepEqual(
    div.children.map((c) => c.tag),
    ['img', 'br', 'span'],
  );
});

test('self-closing syntax is handled', () => {
  const tree = parseHtmlWithPositions('<div><custom-el /><p>next</p></div>');
  assert.deepEqual(
    tree.children[0].children.map((c) => c.tag),
    ['custom-el', 'p'],
  );
});

test('markup inside a script is not parsed as markup', () => {
  const tree = parseHtmlWithPositions(
    '<body><script>const a = "<div>fake</div>";</script><p>real</p></body>',
  );
  assert.deepEqual(
    tree.children[0].children.map((c) => c.tag),
    ['script', 'p'],
  );
  assert.equal(tree.children[0].children[0].children.length, 0);
});

test('a > inside an attribute value does not end the tag early', () => {
  const tree = parseHtmlWithPositions('<div data-x="a > b"><span>inside</span></div>');
  assert.equal(tree.children[0].tag, 'div');
  assert.equal(tree.children[0].children[0].tag, 'span');
});

test('comments and the doctype are skipped', () => {
  const tree = parseHtmlWithPositions('<!doctype html><!-- <div>ignored</div> --><html><body></body></html>');
  assert.deepEqual(
    tree.children.map((c) => c.tag),
    ['html'],
  );
});

test('unclosed tags do not derail the rest of the document', () => {
  const tree = parseHtmlWithPositions('<div><p>one<p>two</div><footer>end</footer>');
  // The parser is tolerant rather than spec-exact; what matters is that the
  // sibling after the malformed block is still found.
  const tags = [];
  const walk = (node) => {
    for (const child of node.children) {
      tags.push(child.tag);
      walk(child);
    }
  };
  walk(tree);
  assert.ok(tags.includes('footer'));
});

test('indexes selectors to their line number', () => {
  const css = [
    '.card {',
    '  padding: 18px;',
    '}',
    '',
    'button.primary {',
    '  background: orange;',
    '}',
  ].join('\n');

  const index = indexStylesheet(css);
  assert.deepEqual(index.get('.card'), [1]);
  assert.deepEqual(index.get('button.primary'), [5]);
});

test('normalises whitespace so CSSOM selector text matches the source', () => {
  const index = indexStylesheet('.a   >   .b ,\n.c {\n  color: red;\n}');
  assert.deepEqual(index.get('.a>.b,.c'), [1]);
});

test('rules inside a media block are indexed too', () => {
  const css = ['.card { color: red; }', '', '@media (max-width: 700px) {', '  .card {', '    color: blue;', '  }', '}'].join('\n');
  const index = indexStylesheet(css);
  assert.deepEqual(index.get('.card'), [1, 4], 'both occurrences, in source order');
});

test('comments do not shift line numbers', () => {
  const css = ['/* a', '   multi-line', '   comment */', '.late {', '  color: red;', '}'].join('\n');
  assert.deepEqual(indexStylesheet(css).get('.late'), [4]);
});

test('a line offset relocates an inline <style> into its host document', () => {
  const index = indexStylesheet('.card {\n  padding: 4px;\n}', 20);
  assert.deepEqual(index.get('.card'), [21]);
});

test('at-rules without a selector are not indexed as selectors', () => {
  const index = indexStylesheet('@keyframes spin { to { transform: rotate(360deg); } }\n.after { color: red; }');
  assert.equal(index.has('@keyframes spin'), false);
  assert.deepEqual(index.get('.after'), [2]);
});
