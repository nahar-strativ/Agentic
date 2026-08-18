/**
 * The `data-earmark-auto` script tag.
 *
 * This is a source-level check on purpose. Auto-mount runs at import time against
 * a live document, and `node --test` has no DOM, so there is nothing to import
 * here without inventing one. What can be checked is the mistake that actually
 * shipped: relying on `document.currentScript` alone.
 *
 * `document.currentScript` is null inside an ES module. The documented no-bundler
 * installation is a module script, so the overlay silently never mounted on the
 * one setup that has no other way to start it. Found by building a plain HTML
 * project and using it, not by reading the code.
 *
 * Run with: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'packages', 'core', 'src', 'index.js'), 'utf8');

test('auto-mount does not depend on currentScript alone', () => {
  assert.match(
    source,
    /document\.currentScript\s*\|\|\s*\n?\s*document\.querySelector\('script\[data-earmark-auto\]'\)/,
    'a module script has no currentScript, so there must be a query fallback',
  );
});

test('the attribute is still verified before mounting', () => {
  assert.match(source, /hasAttribute\('data-earmark-auto'\)/);
});

test('the documented tag in the README is the one the code looks for', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(readme, /<script type="module"[^>]*data-earmark-auto/);
  assert.match(source, /script\[data-earmark-auto\]/);
});
