/**
 * The webpack / Turbopack loader and the Next.js config wrapper.
 *
 * There is no webpack in this repo's dependency tree and there does not need to
 * be — a loader is a function that takes source and calls a callback, so it is
 * tested by calling it with a hand-made loader context. What matters is that it
 * never fails the build and that the Next config it produces stamps both
 * compilations.
 *
 * Run with: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const loader = require('earmark-loader');
const { withEarmark } = require('earmark-loader/next');

/**
 * Run the loader the way webpack would.
 *
 * @param {string} source
 * @param {object} [context] loader-context overrides
 * @param {object} [options] loader options
 * @returns {Promise<{code: string, map: any}>}
 */
function run(source, context = {}, options = {}) {
  return new Promise((resolve, reject) => {
    /** @type {any} */
    const self = {
      resourcePath: '/repo/app/page.tsx',
      rootContext: '/repo',
      getOptions: () => options,
      async: () => (err, code, map) => (err ? reject(err) : resolve({ code, map })),
      ...context,
    };
    loader.call(self, source, undefined);
  });
}

test('stamps a Next.js page with a root-relative path', async () => {
  const { code, map } = await run('export default () => <main>hi</main>;');
  assert.match(code, /<main data-earmark-src="app\/page\.tsx:1:22">/);
  assert.equal(map.version, 3);
});

test('a file with nothing to stamp comes back byte-identical', async () => {
  const source = 'export const config = { runtime: "edge" };\n';
  const { code } = await run(source);
  assert.equal(code, source);
});

test('an unparseable file is passed through, not failed', async () => {
  const source = 'export default () => <div className={{{ ;';
  const { code } = await run(source);
  assert.equal(code, source);
});

test('non-matching paths are passed through', async () => {
  const source = 'export const a = 1 < 2;';
  const { code } = await run(source, { resourcePath: '/repo/lib/util.ts' });
  assert.equal(code, source);
  const dep = await run('export default () => <div>x</div>;', {
    resourcePath: '/repo/node_modules/pkg/index.jsx',
  });
  assert.match(dep.code, /<div>x<\/div>/);
  assert.doesNotMatch(dep.code, /data-earmark-src/);
});

test('include and exclude accept strings, because Turbopack options must be JSON', async () => {
  const jsxOnly = await run('export default () => <div>x</div>;', {}, { include: '\\.jsx$' });
  assert.doesNotMatch(jsxOnly.code, /data-earmark-src/, 'a .tsx file is outside \\.jsx$');

  const excluded = await run('export default () => <div>x</div>;', {}, { exclude: 'app/' });
  assert.doesNotMatch(excluded.code, /data-earmark-src/);
});

test('an explicit root option overrides the webpack rootContext', async () => {
  const { code } = await run('export default () => <div>x</div>;', {}, { root: '/repo/app' });
  assert.match(code, /data-earmark-src="page\.tsx:1:22"/);
});

test('survives a loader context that only implements the Turbopack subset', async () => {
  const { code } = await run('export default () => <div>x</div>;', {
    getOptions: undefined,
    rootContext: undefined,
    query: {},
    resource: '/repo/app/page.tsx',
    resourcePath: undefined,
  });
  assert.match(code, /data-earmark-src=/);
});

// ------------------------------------------------------------ withEarmark --

test('wires stamping into both webpack and Turbopack', () => {
  const config = withEarmark({ reactStrictMode: true });
  assert.equal(config.reactStrictMode, true, 'the rest of the config is untouched');

  const rules = Object.keys(config.turbopack.rules);
  assert.deepEqual(rules.sort(), ['*.jsx', '*.tsx']);
  assert.match(config.turbopack.rules['*.tsx'].loaders[0].loader, /loader\.cjs$/);

  const webpackConfig = config.webpack({ module: { rules: [] } }, { dev: true, isServer: false });
  const added = webpackConfig.module.rules.at(-1);
  assert.equal(added.enforce, 'pre', 'must run before next-swc sees the file');
  assert.match(added.use[0].loader, /loader\.cjs$/);
});

test('the server compilation is stamped too, or hydration would mismatch', () => {
  const config = withEarmark({});
  const server = config.webpack({ module: { rules: [] } }, { dev: true, isServer: true });
  assert.equal(server.module.rules.length, 1);
});

test("an existing webpack function is called, not replaced", () => {
  let called = false;
  const config = withEarmark({
    webpack(cfg) {
      called = true;
      cfg.module.rules.push({ test: /\.svg$/ });
      return cfg;
    },
  });
  const result = config.webpack({ module: { rules: [] } }, { dev: true });
  assert.equal(called, true);
  assert.equal(result.module.rules.length, 2, "the caller's rule survives alongside ours");
});

test('existing turbopack rules are preserved', () => {
  const config = withEarmark({ turbopack: { rules: { '*.svg': { loaders: ['svgr'] } } } });
  assert.deepEqual(config.turbopack.rules['*.svg'], { loaders: ['svgr'] });
  assert.ok(config.turbopack.rules['*.tsx']);
});

test('production builds are left alone unless opted in', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const untouched = withEarmark({ reactStrictMode: true });
    assert.deepEqual(untouched, { reactStrictMode: true });
    assert.ok(withEarmark({}, { applyInBuild: true }).turbopack);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
