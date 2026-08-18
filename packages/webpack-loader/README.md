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

Dev only unless you ask otherwise:

```js
withEarmark(config, { applyInBuild: true, root: process.cwd(), exclude: 'legacy/' });
```

## Documentation

Full reference: https://nahar-strativ.github.io/Agentic/docs.html
Overview: https://nahar-strativ.github.io/Agentic/

Part of [earmark](https://github.com/nahar-strativ/Agentic). MIT licensed.
