# earmark

Click an element in your running app, say what should change, and your coding
agent gets the CSS selector, the source file and line, the component path, the
computed styles and the box geometry — instead of "the button on the right looks
wrong".

Works in any framework. No build step required for the overlay.

```
┌─ browser ──────────────┐        ┌─ broker ────────┐        ┌─ agent ─────────┐
│ click → annotate       │ POST   │ store + SSE     │  MCP   │ list / watch    │
│ pins, panel, markdown  │───────▶│ long-poll       │◀──────▶│ ask / resolve   │
│                        │◀───────│ .earmark/*.json │        │ dismiss         │
└────────────────────────┘  SSE   └─────────────────┘        └─────────────────┘
```

---

## Try it in 30 seconds

```bash
npm install && npm run example
```

Open http://127.0.0.1:5173/examples/vanilla/, click the arrow in the toolbar
(bottom right) or press `alt+a`, then click anything on the page.

For live agent sync, run the broker in a second terminal:

```bash
npm run server
```

---

## Install

```bash
npm install -D earmark
```

```js
import { createEarmark } from 'earmark';

if (import.meta.env.DEV) {
  createEarmark();
}
```

No bundler:

```html
<script type="module" src="/node_modules/earmark/src/index.js" data-earmark-auto></script>
```

### Options

```js
createEarmark({
  endpoint: 'http://127.0.0.1:7331', // or false for copy-paste only
  hotkey: 'alt+a',
  theme: 'auto',                     // 'auto' | 'light' | 'dark'
  persist: true,                     // keep annotations across reloads
  onAnnotate: (annotation) => {},
});
```

The endpoint defaults to the local broker and **degrades silently** when nothing
is listening — the overlay still works, the sync dot just goes grey.

---

## Using it

| Tool | What it does |
| --- | --- |
| ➤ | Click an element. Shift-click to add more, then click to finish. |
| T | Select text — the exact string is the most greppable thing you can hand an agent. |
| ⛶ | Drag a region. Reports every element inside, or flags an empty area. |
| ❊ | Freeze animations and transitions so you can annotate a moving element. |
| ☰ | Panel: review, delete, answer the agent, copy markdown. |

`⌘↵` saves an annotation, `esc` cancels, `alt+a` toggles picking.

---

## Copy-paste mode

Click **Copy markdown** in the panel and paste into your agent:

```md
## UI feedback — 1 annotation

- **Page:** http://localhost:5173/dashboard
- **Viewport:** 1440×900 @2x, dark mode
- **Framework:** react

### 1. Export button padding is too tight — needs 10px 16px

- **Element:** `<button>` <ExportButton>
- **Selector:** `[data-testid="export-btn"]`
- **Source:** `src/components/Card.tsx:42:7`
- **Component path:** App › Dashboard › Card › ExportButton
- **Text:** "Export"
- **Box:** 66×37 at (194, 376)
- **Computed:** padding: 7px 13px; border-radius: 8px; font-size: 13px
- **Ancestors:** div.row ← section.card ← main
```

---

## Agent sync mode (MCP)

```bash
claude mcp add earmark -- npx -y earmark-mcp
```

That one process runs the MCP server *and* the broker the browser talks to.

### Tools

| Tool | Purpose |
| --- | --- |
| `earmark_list_annotations` | Everything open, as markdown (or `format: "json"`) |
| `earmark_watch_annotations` | **Blocks** until the human annotates something |
| `earmark_get_annotation` | One annotation with its full reply thread |
| `earmark_ask` | Ask a clarifying question — the pin turns amber in the browser |
| `earmark_resolve` | Mark done with a summary — the pin turns green |
| `earmark_dismiss` | Decline with a reason the human sees |
| `earmark_clear` | Delete everything |
| `earmark_status` | Is the overlay connected? What endpoint should it use? |

The fix loop this enables:

```
watch → read the source path → edit the file → resolve → watch
```

and when the feedback is ambiguous, `ask` instead of guessing. The question
appears on the pin; the human's answer wakes the next `watch`.

---

## Source file paths

Selectors tell an agent what to grep for. **Source paths tell it exactly where to
look**, which is the difference between one edit and three greps.

React 19 removed the runtime `_debugSource` fiber field, so this is done at build
time:

```js
// vite.config.js
import earmark from 'vite-plugin-earmark';

export default {
  plugins: [react(), earmark()],
};
```

Every intrinsic JSX element gets `data-earmark-src="src/Card.tsx:42:7"` during
`vite dev`. The plugin also injects the overlay, so `createEarmark()` in your app
code becomes optional.

```js
earmark({
  inject: false,        // do not auto-mount the overlay
  endpoint: '…',        // passed through to createEarmark
  applyInBuild: true,   // also stamp production builds (off by default)
})
```

Without the plugin everything still works — you get selectors, component names
and text, just not `file:line`. You can also add `data-earmark-src` by hand.

---

## Standalone broker

```bash
npx earmark-server --port 7331
curl http://127.0.0.1:7331/markdown
```

| Route | |
| --- | --- |
| `GET /health` | liveness + counts |
| `GET /annotations?status=open` | list |
| `POST /annotations` | create (batch) |
| `GET /annotations/wait?since=N&timeout=30000` | long-poll |
| `PATCH /annotations/:id` | update status |
| `POST /annotations/:id/replies` | append to the thread |
| `DELETE /annotations/:id` · `DELETE /annotations` | remove · clear |
| `GET /events` | SSE stream |
| `GET /markdown` | the agent-facing document |

Flags: `--host --file --no-persist --token --quiet`.

---

## Security

This is a development tool.

- The broker binds `127.0.0.1` only. Do not bind it to `0.0.0.0`.
- CORS is open by design — your dev server is on an arbitrary origin.
- Any page open in your browser can reach a loopback port. Pass `--token SECRET`
  if that matters on your machine.
- Do not run it on a shared or public host.

---

## Tests

```bash
npm test
```

Four suites: store/HTTP behaviour, the MCP surface driven by a real stdio
client, the overlay's sync client, and the source-stamping transform.

---

## Not supported

Desktop browsers only. No iframes, no canvas/WebGL internals, no screenshots.
See [plan.md](plan.md) for the full open list and the reasoning behind every
design decision.

---

## License

MIT. Clean-room implementation — not derived from any other tool's source.
