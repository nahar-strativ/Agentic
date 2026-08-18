/**
 * Source stamping. This is the piece that turns a click into a file and line,
 * so it gets tested at the transform level rather than through a dev server.
 *
 * Run with: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import earmark from 'vite-plugin-earmark';

const plugin = earmark();
plugin.configResolved({ root: '/repo' });

/**
 * @param {string} code
 * @param {string} [id]
 */
function transform(code, id = '/repo/src/Card.tsx') {
  return plugin.transform.call({}, code, id);
}

test('stamps intrinsic elements with path, line and column', () => {
  const result = transform(
    ['export function Card() {', '  return <div className="card">hi</div>;', '}'].join('\n'),
  );
  assert.match(result.code, /<div data-earmark-src="src\/Card\.tsx:2:10"[^>]* className="card">/);
});

test('leaves components alone — the attribute would never reach the DOM', () => {
  const result = transform('export const A = () => <Card title="x" />;');
  assert.equal(result, null);
});

test('stamps host elements nested inside components', () => {
  const result = transform(
    ['export const A = () => (', '  <Layout>', '    <button>Go</button>', '  </Layout>', ');'].join('\n'),
  );
  assert.doesNotMatch(result.code, /<Layout data-earmark-src/);
  assert.match(result.code, /<button data-earmark-src="src\/Card\.tsx:3:5"/);
});

test('skips document-level and metadata tags', () => {
  const result = transform('export const A = () => <><title>t</title><script src="x" /></>;');
  assert.equal(result, null);
});

test('does not double-stamp an element that already has the attribute', () => {
  const code = 'export const A = () => <div data-earmark-src="manual">x</div>;';
  const result = transform(code);
  assert.equal(result, null);
});

test('ignores non-JSX files and node_modules', () => {
  assert.equal(transform('const a = 1 < 2;', '/repo/src/util.ts'), null);
  assert.equal(
    transform('export const A = () => <div />;', '/repo/node_modules/pkg/index.jsx'),
    null,
  );
});

test('survives a file it cannot parse instead of breaking the dev server', () => {
  assert.equal(transform('export const A = () => <div className={{{ };'), null);
});

test('emits a source map so stack traces still point at the original file', () => {
  const result = transform('export const A = () => <div>x</div>;');
  assert.ok(result.map);
  assert.equal(result.map.version, 3);
});

test('handles TypeScript generics and satisfies without choking', () => {
  const code = [
    'type P = { a: string }',
    'export const A = <T,>(p: T) => <span data-x="1">{String(p)}</span> satisfies unknown;',
  ].join('\n');
  const result = transform(code);
  assert.match(result.code, /<span data-earmark-src="src\/Card\.tsx:2:32"[^>]* data-x="1">/);
});

test('multiple elements on one line get distinct columns', () => {
  const result = transform('export const A = () => <div><em>a</em><em>b</em></div>;');
  const stamps = [...result.code.matchAll(/data-earmark-src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(stamps.length, 3);
  assert.equal(new Set(stamps).size, 3, 'each element needs its own column');
});

test('applies only to the dev server unless explicitly opted in', () => {
  assert.equal(earmark().apply, 'serve');
  assert.equal(earmark({ applyInBuild: true }).apply, undefined);
});

test('injects the overlay bootstrap into index.html', () => {
  const tags = earmark({ endpoint: 'http://127.0.0.1:7331', theme: 'dark' }).transformIndexHtml();
  assert.equal(tags.length, 1);
  assert.match(tags[0].children, /createEarmark\(\{"endpoint":"http:\/\/127\.0\.0\.1:7331","theme":"dark"\}\)/);
  assert.equal(tags[0].injectTo, 'body');
});

test('injection can be turned off', () => {
  assert.equal(earmark({ inject: false }).transformIndexHtml(), undefined);
});

test('stamps .svelte markup too — before vite-plugin-svelte compiles it away', () => {
  const result = transform('<button class="go">Go</button>', '/repo/src/lib/Card.svelte');
  assert.match(result.code, /<button data-earmark-src="src\/lib\/Card\.svelte:1:1"[^>]* class="go">/);
  assert.equal(earmark().enforce, 'pre', 'ordering is what makes svelte stamping possible');
});

test('stamps the component each element is written in, for chains in production builds', () => {
  const result = transform(
    ['export function Card() {', '  return <div><button>Go</button></div>;', '}'].join('\n'),
    '/repo/src/Card.tsx',
  );
  assert.equal([...result.code.matchAll(/data-earmark-component="Card"/g)].length, 2);
});

test('an element inherits the nearest named component, not the file', () => {
  const result = transform(
    [
      'export function Outer() {',
      '  const Inner = () => <span>inner</span>;',
      '  return <div><Inner /></div>;',
      '}',
    ].join('\n'),
    '/repo/src/Two.tsx',
  );
  assert.match(result.code, /<span data-earmark-src="[^"]*" data-earmark-component="Inner"/);
  assert.match(result.code, /<div data-earmark-src="[^"]*" data-earmark-component="Outer"/);
});

test('a lowercase function is a helper, not a component', () => {
  const result = transform('function helper() { return <div>x</div>; }', '/repo/src/h.jsx');
  assert.match(result.code, /data-earmark-src=/);
  assert.doesNotMatch(result.code, /data-earmark-component/);
});
