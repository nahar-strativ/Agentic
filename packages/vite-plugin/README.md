# vite-plugin-earmark

Stamps JSX and Svelte elements with their source file, line and column for earmark.

```js
// vite.config.js
import earmark from 'vite-plugin-earmark';

export default { plugins: [react(), earmark()] };
```

Adds `data-earmark-src="src/Card.tsx:42:7"` to every intrinsic JSX element, and to
every plain element in a `.svelte` file, during `vite dev`. It also injects the
overlay, so calling `createEarmark()` in your app code is optional.

Why a build plugin at all: React 19 removed the `_debugSource` fiber field that
runtime approaches rely on. Stamping at build time works on React 19, Preact,
Solid, Svelte and anything else that compiles to DOM.

```js
earmark({
  inject: false,        // do not auto-mount the overlay
  endpoint: '…',        // passed through to createEarmark
  applyInBuild: true,   // also stamp production builds (off by default)
})
```

SvelteKit needs no extra configuration: `enforce: 'pre'` means the markup is
stamped before the Svelte compiler sees it.

## Documentation

Full reference: https://nahar-strativ.github.io/Agentic/docs.html
Overview: https://nahar-strativ.github.io/Agentic/

Part of [earmark](https://github.com/nahar-strativ/Agentic). MIT licensed.
