#!/usr/bin/env node
/**
 * Derive an embeddable fragment from the standalone landing page.
 *
 * `site/index.html` is the single source of truth — it is a complete document
 * so it can be served by GitHub Pages or any static host. Some embedding
 * targets (Claude artifacts among them) supply their own document skeleton and
 * reject `<html>` / `<head>` / `<body>`, so this strips the wrapper and keeps
 * the title, the styles and the body content in that order.
 *
 *   node site/build-fragment.js [outfile]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, 'index.html');
const destination = resolve(process.argv[2] || resolve(here, 'fragment.html'));

const html = await readFile(source, 'utf8');

/**
 * @param {RegExp} pattern
 * @param {string} what
 */
function required(pattern, what) {
  const match = html.match(pattern);
  if (!match) throw new Error(`site/index.html has no ${what}`);
  return match;
}

const title = required(/<title>[\s\S]*?<\/title>/, '<title>')[0];
const style = required(/<style>[\s\S]*?<\/style>/, '<style>')[0];
const body = required(/<body>([\s\S]*)<\/body>/, '<body>')[1];

const fragment = `${title}\n${style}\n${body.trim()}\n`;

if (/<!doctype|<html|<head>|<body>/i.test(fragment)) {
  throw new Error('fragment still contains document wrapper tags');
}

await writeFile(destination, fragment);
process.stdout.write(`${destination} — ${(fragment.length / 1024).toFixed(1)} KB\n`);
