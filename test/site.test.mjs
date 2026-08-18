/**
 * The two site pages.
 *
 * index.html and docs.html each carry their own copy of the design tokens,
 * because both are deliberately self-contained: index.html is exported as an
 * embeddable fragment, and the CSP on embedding targets blocks external
 * stylesheets. Duplication that nobody checks drifts, so this checks it.
 *
 * Also guards the two properties the pages promise: no external requests, and
 * no em dashes.
 *
 * Run with: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const index = readFileSync(join(root, 'site', 'index.html'), 'utf8');
const docs = readFileSync(join(root, 'site', 'docs.html'), 'utf8');

/**
 * Custom properties declared in the page's light `:root` block.
 *
 * @param {string} html
 * @returns {Map<string, string>}
 */
function rootTokens(html) {
  const block = html.slice(html.indexOf(':root {'), html.indexOf('color-scheme: light'));
  const tokens = new Map();
  for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    tokens.set(name, value.replace(/\s+/g, ' ').trim());
  }
  return tokens;
}

test('both pages declare the same value for every token they share', () => {
  const a = rootTokens(index);
  const b = rootTokens(docs);
  assert.ok(a.size > 25, `expected a full token set, found ${a.size}`);

  const shared = [...b.keys()].filter((name) => a.has(name));
  assert.ok(shared.length > 25, `expected the docs page to reuse the system, shared ${shared.length}`);

  const drifted = shared.filter((name) => a.get(name) !== b.get(name));
  assert.deepEqual(drifted, [], `these tokens disagree between the two pages: ${drifted.join(', ')}`);
});

test('the docs page carries the identity tokens, not just any colours', () => {
  const b = rootTokens(docs);
  assert.equal(b.get('primary'), '#335cff');
  assert.equal(b.get('mark'), '#fa7319', 'orange is the marking ink and must not drift');
  assert.equal(b.get('ground'), '#f7f7f7');
});

test('neither page fetches anything', () => {
  for (const [name, html] of [['index.html', index], ['docs.html', docs]]) {
    const external = [...html.matchAll(/(?:src|href)="(https?:)?\/\/([^"]+)"/g)]
      .map((m) => m[2])
      .filter((url) => !url.startsWith('github.com'));
    assert.deepEqual(external, [], `${name} would fetch: ${external.join(', ')}`);
  }
});

test('neither page contains an em dash', () => {
  assert.equal(index.includes('—'), false, 'index.html has an em dash');
  assert.equal(docs.includes('—'), false, 'docs.html has an em dash');
});

test('the pages link to each other', () => {
  assert.match(index, /href="\.\/docs\.html"/);
  assert.match(docs, /href="\.\/"/);
});

test('every table-of-contents entry on the docs page resolves to a section', () => {
  const targets = [...docs.matchAll(/<a href="#([a-z]+)">/g)].map((m) => m[1]);
  assert.ok(targets.length >= 15, `expected a full contents list, found ${targets.length}`);
  for (const id of targets) {
    assert.match(docs, new RegExp(`<section id="${id}">`), `#${id} has no section`);
  }
});

test('the scroll-spy on both pages is optional, not load-bearing', () => {
  for (const [name, html] of [['index.html', index], ['docs.html', docs]]) {
    const script = html.slice(html.lastIndexOf('<script>'), html.lastIndexOf('</script>'));
    assert.match(script, /aria-current/, `${name} should drive state through aria-current`);
    // A bare return when there is nothing to work with, rather than throwing
    // inside a page that otherwise renders fine.
    assert.match(script, /if \(!links\.length\) return;/, `${name} must bail out quietly`);
  }
});

test('the Pages workflow publishes both pages and nothing else', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(workflow, /cp site\/index\.html _site\/index\.html/);
  assert.match(workflow, /cp site\/docs\.html _site\/docs\.html/);
  assert.doesNotMatch(workflow, /cp -r site/, 'build-fragment.js must not be served');
});

test('both pages share the same masthead chrome', () => {
  // Asked directly why the docs nav looked different. It was: no version chip, and
  // an older filled button instead of the bordered pill. Pinned here so the two
  // pages cannot drift apart again without a failure.
  for (const [name, html] of [['index.html', index], ['docs.html', docs]]) {
    const head = html.slice(html.indexOf('<header class="masthead">'), html.indexOf('</header>'));
    assert.match(head, /class="wordmark"/, `${name} masthead needs the wordmark`);
    assert.match(head, /class="tag">v0\.1</, `${name} masthead needs the version chip`);
    assert.match(head, /class="is-cta"/, `${name} action must be the bordered pill`);
    assert.match(head, /&#8250;|›/, `${name} action needs its chevron`);
    assert.doesNotMatch(head, /class="is-primary"/, `${name} still has the old filled button`);
  }

  for (const rule of ['.tag {', '.masthead nav a.is-cta {', '.rail {']) {
    assert.ok(index.includes(rule), `index.html is missing ${rule}`);
    assert.ok(docs.includes(rule), `docs.html is missing ${rule}`);
  }
});

test('every code block on both pages can be copied', () => {
  for (const [name, html] of [['index.html', index], ['docs.html', docs]]) {
    // Created in script, so it is never in the markup: check the maker and the rule.
    assert.match(html, /button\.className = 'copy';/, `${name} does not create a copy button`);
    assert.ok(html.includes('.copy {'), `${name} has no styles for the copy button`);
    // Captured before the button exists, or the button's own label gets copied on
    // touch devices where it is permanently visible.
    assert.match(html, /var text = pre\.innerText;/, `${name} must snapshot the text`);
    assert.doesNotMatch(html, /target\.read\(\)/, `${name} still reads at click time`);
  }
  assert.match(index, /data-copy="npm install -D earmark"/, 'the install command must be copyable');
});
