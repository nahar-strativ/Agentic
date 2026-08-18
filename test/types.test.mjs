/**
 * The declarations are hand-written, so they are only as good as this check.
 *
 * `test/types/check.ts` imports every package's public surface and asserts both
 * directions: what must type, and — via `@ts-expect-error` — what must not.
 * tsc is a devDependency, so a bare checkout without `npm install` skips rather
 * than fails.
 *
 * Run with: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsc = join(root, 'node_modules', '.bin', 'tsc');

test('the type declarations match the code they describe', { skip: !existsSync(tsc) && 'typescript is not installed' }, async () => {
  try {
    await run(tsc, ['-p', join(root, 'tsconfig.json')], { cwd: root });
  } catch (error) {
    assert.fail(`tsc reported errors:\n${error.stdout || error.message}`);
  }
});
