# earmark-stamp

Bundler-agnostic source stamping for earmark: adds file:line:col to JSX and Svelte elements.

The transform behind `vite-plugin-earmark` and `earmark-loader`, with no bundler
attached. Every integration calls into here, so a stamp means the same thing
whatever built the app.

```js
import { stamp } from 'earmark-stamp';

const result = stamp(code, { filename: '/repo/src/Card.tsx', root: '/repo' });
if (result) ({ code, map } = result);
```

Svelte builds that are not Vite can use the preprocessor:

```js
// svelte.config.js
import { earmarkPreprocess } from 'earmark-stamp';

export default { preprocess: [earmarkPreprocess()] };
```

It also stamps the owning component name, which is the only way a Svelte
annotation can carry a component chain: Svelte exposes no runtime equivalent of a
React fiber.

Components, `<svelte:*>`, `<slot>`, comments, `{expressions}` and the contents of
`<script>` and `<style>` are never stamped. A misplaced stamp there would not
produce a wrong line number, it would produce a file that does not compile.

## Documentation

Full reference: https://nahar-strativ.github.io/Agentic/docs.html
Overview: https://nahar-strativ.github.io/Agentic/

Part of [earmark](https://github.com/nahar-strativ/Agentic). MIT licensed.
