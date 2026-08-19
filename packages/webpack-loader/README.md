# earmark-loader

webpack and Turbopack loader that stamps JSX with file:line:col for earmark. The Next.js path.

```js
// next.config.mjs
import { withEarmark } from 'earmark-loader/next';

export default withEarmark({});
```

A pre-loader rather than a Babel plugin, because adding Babel would silently
switch a Next project off SWC and slow every build down.

Both compilations are stamped, client and server. That is deliberate: Next renders
your components on the server, and React hydration will not add an attribute the
server HTML did not have, so a one-sided stamp means a missing attribute and a
hydration mismatch.

Verified against Next 16.3 in both `next dev` and `next build`, where Turbopack is
the only bundler unless you pass `--webpack`. Stamps land in the server-rendered
HTML and in the client DOM, with no hydration warning.

Dev only unless you ask otherwise:

```js
withEarmark(config, { applyInBuild: true, root: process.cwd(), exclude: 'legacy/' });
```

## Documentation

Full reference: https://nahar-strativ.github.io/earmark/docs.html
Overview: https://nahar-strativ.github.io/earmark/

Part of [earmark](https://github.com/nahar-strativ/earmark). MIT licensed.
