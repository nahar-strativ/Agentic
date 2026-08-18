/**
 * The shared stamping transform: extension dispatch, path shaping, and the
 * Svelte scanner.
 *
 * The Svelte cases are mostly about restraint. A stamp in the wrong place does
 * not produce a bad line number, it produces a file that will not compile — so
 * every construct that merely *looks* like markup gets its own test.
 *
 * Run with: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stamp, stampSvelte, earmarkPreprocess, relativePath } from 'earmark-stamp';

/**
 * @param {string} code
 * @param {string} [path]
 */
function svelte(code, path = 'src/Card.svelte') {
  return stampSvelte(code, { path });
}

// ------------------------------------------------------------- dispatch --

test('dispatches on extension and reports a root-relative path', () => {
  const jsx = stamp('export const A = () => <div>x</div>;', {
    filename: '/repo/src/App.tsx',
    root: '/repo',
  });
  assert.match(jsx.code, /data-earmark-src="src\/App\.tsx:1:24"/);

  const markup = stamp('<div>x</div>', { filename: '/repo/src/Card.svelte', root: '/repo' });
  assert.match(markup.code, /<div data-earmark-src="src\/Card\.svelte:1:1"/);
});

test('leaves alone what it does not handle', () => {
  assert.equal(stamp('<div />', { filename: '/repo/src/a.vue', root: '/repo' }), null);
  assert.equal(stamp('<div />', { filename: '/repo/node_modules/x/a.svelte', root: '/repo' }), null);
  assert.equal(stamp('<div />', { filename: '', root: '/repo' }), null);
});

test('strips a bundler query string before deciding', () => {
  const result = stamp('<div>x</div>', {
    filename: '/repo/src/Card.svelte?svelte&type=style',
    root: '/repo',
  });
  assert.match(result.code, /data-earmark-src="src\/Card\.svelte:1:1"/);
});

test('a file outside the root keeps its absolute path rather than a ../.. chain', () => {
  assert.equal(relativePath('/elsewhere/lib/Card.tsx', '/repo'), '/elsewhere/lib/Card.tsx');
  assert.equal(relativePath('/repo/src/Card.tsx', '/repo'), 'src/Card.tsx');
  assert.equal(relativePath('src/Card.tsx', '/repo'), 'src/Card.tsx');
});

// --------------------------------------------------------------- svelte --

test('stamps plain elements with line and column', () => {
  const result = svelte(['<main>', '  <button class="go">Go</button>', '</main>'].join('\n'));
  assert.match(result.code, /<main data-earmark-src="src\/Card\.svelte:1:1"/);
  assert.match(result.code, /<button data-earmark-src="src\/Card\.svelte:2:3"[^>]* class="go">/);
});

test('leaves components and svelte: elements alone', () => {
  assert.equal(svelte('<Card title="x" />'), null);
  assert.equal(svelte('<Icons.Chevron />'), null);
  assert.equal(svelte('<svelte:window on:resize={f} />'), null);
  assert.equal(svelte('<slot name="footer" />'), null);
});

test('a component wrapping real elements still stamps the elements', () => {
  const result = svelte('<Card><p>hi</p></Card>');
  assert.doesNotMatch(result.code, /<Card data-earmark-src/);
  assert.match(result.code, /<p data-earmark-src="src\/Card\.svelte:1:7"/);
});

test('script contents are never stamped — generics are not markup', () => {
  const code = [
    '<script lang="ts">',
    '  const m = new Map<string, number>();',
    '  const ok = 1 < 2;',
    '</script>',
    '',
    '<p>{m.size}</p>',
  ].join('\n');
  const result = svelte(code);
  assert.match(result.code, /<p data-earmark-src="src\/Card\.svelte:6:1"/);
  assert.equal([...result.code.matchAll(/data-earmark-src/g)].length, 1);
  assert.match(result.code, /new Map<string, number>\(\)/);
});

test('style contents are never stamped', () => {
  const code = ['<style>', '  .a > .b { color: red }', '</style>', '<div class="a" />'].join('\n');
  const result = svelte(code);
  assert.match(result.code, /\.a > \.b \{ color: red \}/);
  assert.equal([...result.code.matchAll(/data-earmark-src/g)].length, 1);
});

test('expressions are not markup — {a<b} must survive untouched', () => {
  const result = svelte('<p>{a<b}</p>');
  const stamps = [...result.code.matchAll(/data-earmark-src/g)];
  assert.equal(stamps.length, 1, 'only the <p> gets stamped');
  assert.match(result.code, /\{a<b\}/);
});

test('a > inside an attribute does not end the tag early', () => {
  const quoted = svelte('<a href="/x?a=>b" class="link">go</a>');
  assert.match(quoted.code, /<a data-earmark-src="src\/Card\.svelte:1:1"[^>]* href="\/x\?a=>b" class="link">/);

  const braced = svelte("<div class={a > b ? 'x' : 'y'}>hi</div>");
  assert.match(braced.code, /<div data-earmark-src="src\/Card\.svelte:1:1"[^>]* class=\{a > b \? 'x' : 'y'\}>/);
  assert.equal([...braced.code.matchAll(/data-earmark-src/g)].length, 1);
});

test('block markup is stamped, block tags are not', () => {
  const code = ['{#if open}', '  <dialog>hi</dialog>', '{/if}'].join('\n');
  const result = svelte(code);
  assert.match(result.code, /<dialog data-earmark-src="src\/Card\.svelte:2:3"/);
  assert.equal([...result.code.matchAll(/data-earmark-src/g)].length, 1);
});

test('comments are skipped, including ones containing markup', () => {
  const result = svelte('<!-- <div>ignored</div> -->\n<span>real</span>');
  assert.match(result.code, /<span data-earmark-src="src\/Card\.svelte:2:1"/);
  assert.equal([...result.code.matchAll(/data-earmark-src/g)].length, 1);
});

test('document-level and metadata tags are skipped', () => {
  assert.equal(svelte('<svelte:head><title>t</title><meta name="a" content="b" /></svelte:head>'), null);
});

test('does not double-stamp', () => {
  assert.equal(svelte('<div data-earmark-src="manual">x</div>'), null);
  const once = svelte('<div>x</div>');
  assert.equal(svelte(once.code), null);
});

test('an unterminated tag stops the scan instead of guessing', () => {
  const result = svelte('<p>ok</p>\n<div class="broken');
  assert.match(result.code, /<p data-earmark-src/);
  assert.equal([...result.code.matchAll(/data-earmark-src/g)].length, 1);
});

test('emits a source map', () => {
  const result = svelte('<div>x</div>');
  assert.equal(result.map.version, 3);
});

test('nothing to stamp returns null so the caller can pass the file through', () => {
  assert.equal(svelte('just text, no elements'), null);
  assert.equal(svelte(''), null);
});

// ---------------------------------------------------------- preprocessor --

test('the svelte preprocessor stamps markup and respects its gates', () => {
  const pre = earmarkPreprocess({ root: '/repo' });
  assert.equal(pre.name, 'earmark');

  const out = pre.markup({ content: '<div>x</div>', filename: '/repo/src/Card.svelte' });
  assert.match(out.code, /data-earmark-src="src\/Card\.svelte:1:1"/);

  assert.equal(pre.markup({ content: '<div>x</div>', filename: undefined }), undefined);
  assert.equal(
    pre.markup({ content: '<div>x</div>', filename: '/repo/node_modules/x/C.svelte' }),
    undefined,
  );
  assert.equal(pre.markup({ content: '<div>x</div>', filename: '/repo/src/a.js' }), undefined);
});

test('the preprocessor is off in production builds', () => {
  const pre = earmarkPreprocess({ root: '/repo', dev: false });
  assert.equal(pre.markup({ content: '<div>x</div>', filename: '/repo/src/Card.svelte' }), undefined);
});

// -------------------------------------------------- component chain stamp --

test('stamps the owning component name, which is the only way Svelte can have one', () => {
  const result = stampSvelte('<main><button>Go</button></main>', { path: 'src/lib/Card.svelte' });
  assert.equal([...result.code.matchAll(/data-earmark-component="Card"/g)].length, 2);
});

test('the component name comes from the filename, not the path', () => {
  const result = stampSvelte('<p>x</p>', { path: 'src/routes/settings/BillingPanel.svelte' });
  assert.match(result.code, /data-earmark-component="BillingPanel"/);
});

test('component stamping can be turned off without losing the source stamp', () => {
  const result = stampSvelte('<p>x</p>', { path: 'src/Card.svelte', component: false });
  assert.match(result.code, /data-earmark-src=/);
  assert.doesNotMatch(result.code, /data-earmark-component/);
});

test('a filename that cannot be a component name is left without one', () => {
  const result = stampSvelte('<p>x</p>', { path: 'src/2-weird name.svelte' });
  assert.match(result.code, /data-earmark-src=/);
  assert.doesNotMatch(result.code, /data-earmark-component/);
});
