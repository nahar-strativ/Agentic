/**
 * Path shaping for stamps. Its own module so `svelte-preprocess.js` and
 * `index.js` can share it without an import cycle.
 */

import { relative, isAbsolute } from 'node:path';

/**
 * Path as it should appear in the stamp: relative to the project root and
 * forward-slashed, because an agent is going to paste it into a file open.
 * A path outside the root keeps its absolute form — wrong-but-absolute beats a
 * `../../..` chain nobody can resolve.
 *
 * @param {string} file
 * @param {string} root
 * @returns {string}
 */
export function relativePath(file, root) {
  if (!isAbsolute(file)) return file.split('\\').join('/');
  const rel = relative(root, file).split('\\').join('/');
  return rel && !rel.startsWith('../') ? rel : file.split('\\').join('/');
}
