# earmark

Click-to-annotate overlay that hands AI coding agents structured context about your UI.

```bash
npm install -D earmark
```

```js
import { createEarmark } from 'earmark';

if (import.meta.env.DEV) createEarmark();
```

No bundler needed:

```html
<script type="module" src="/node_modules/earmark/src/index.js" data-earmark-auto></script>
```

Click an element in your running app, say what should change, and your agent gets
the verified selector, the source file and line, the component path, the computed
styles and the exact box, instead of "the button on the right looks wrong".

Zero runtime dependencies, no build step. Works in React, Vue, Svelte, Angular
and plain HTML alike. Falls back to copying markdown whenever no broker is
listening, so it never breaks your app.

- Overlay: four pick modes, freeze, pins that survive re-renders, side panel
- Output: one markdown serializer shared by browser, broker and agent
- Optional sync: point `endpoint` at a local broker and an agent can read,
  ask questions and resolve annotations directly

## Documentation

Full reference: https://nahar-strativ.github.io/earmark/docs.html
Overview: https://nahar-strativ.github.io/earmark/

Part of [earmark](https://github.com/nahar-strativ/earmark). MIT licensed.
