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

The landing page and full guide is served alongside it at
http://127.0.0.1:5173/site/ — source in [site/index.html](site/index.html), a
single self-contained file with no dependencies.

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

### TypeScript

Every package ships hand-written declarations — there is no build step here, and
an emitted `.d.ts` would need one. The domain types (`Annotation`, `Target`,
`Session`, `Status`, `Priority`) live in `earmark` and are re-exported by
`earmark-server` and `earmark-mcp`, so an annotation is the same type on both
sides of the wire.

```ts
import { createEarmark, type Annotation } from 'earmark';

const overlay = createEarmark({ theme: 'dark' });
const pending: Annotation[] = overlay.annotations;
```

---

## Using it

| Tool | What it does |
| --- | --- |
| ➤ | Click an element. Shift-click to add more, then click to finish. |
| T | Select text — the exact string is the most greppable thing you can hand an agent. |
| ⛶ | Drag a region. Reports every element inside, or flags an empty area. |
| ❊ | Freeze everything moving — CSS animations, `element.animate()`, `<video>`, `<audio>`. |
| ☰ | Panel: review, delete, answer the agent, copy markdown. |

`⌘↵` saves an annotation, `esc` cancels, `alt+a` toggles picking. Each
annotation can be marked **high**, **normal** or **low** priority; `high` sorts
first for the agent.

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

Or, to write it into the project's `.mcp.json`:

```bash
npx earmark-mcp init
```

That one process runs the MCP server *and* the broker the browser talks to.
When something is not working, ask it why:

```bash
npx earmark-mcp doctor
```

```
✓ Node version: v24.12.0
✓ sqlite backend: available
✓ MCP registration: earmark is registered in .mcp.json
✓ Broker: responding on http://127.0.0.1:7331 — 1 annotations, 2 sessions
✓ Browser overlay: http://localhost:5173/ (1 annotations)
```

Each failing check prints the command that fixes it, and `doctor` exits non-zero
so CI can use it.

### Tools

| Tool | Purpose |
| --- | --- |
| `earmark_list_annotations` | Outstanding work, as markdown (or `format: "json"`); scope with `session` |
| `earmark_watch_annotations` | **Blocks** until the human annotates something |
| `earmark_get_annotation` | One annotation with its full reply thread |
| `earmark_list_sessions` | Which browser tabs are open, and which routes were annotated |
| `earmark_get_session` | One tab with every annotation it produced |
| `earmark_acknowledge` | "I've read it, I'm on it" — the pin turns blue |
| `earmark_ask` | Ask a clarifying question — the pin turns amber |
| `earmark_resolve` | Mark done with a summary — the pin turns green |
| `earmark_dismiss` | Decline with a reason the human sees |
| `earmark_clear` | Delete everything |
| `earmark_status` | Is the overlay connected? What endpoint should it use? |

The fix loop this enables:

```
watch → acknowledge → read the source path → edit the file → resolve → watch
```

`acknowledge` matters on anything slow: without it, an agent halfway through a
refactor looks exactly like an agent that ignored you. Blue pin means picked up,
green means actually done.

When the feedback is ambiguous, `ask` instead of guessing. The question appears
on the pin; the human's answer wakes the next `watch`.

### Statuses

`open` → `acknowledged` → `resolved`, with `needs-input` when the agent is
waiting on a human and `dismissed` when it declines. Pins are colour-coded:
orange, blue, green, amber, grey.

### Sessions

A session is **one browser tab**, not one page load — the id lives in
`sessionStorage`, so it survives reloads. Annotations carry their own
`page.url`, so a session that wandered across three routes gives an agent one
group with three differently-routed items.

SPA navigation is tracked too: `pushState`, `replaceState`, `popstate` and
`hashchange` all update the session's route list. A tab counts as connected for
exactly as long as its SSE stream is open.

```bash
curl http://127.0.0.1:7331/sessions
```

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

### Next.js

Next compiles with SWC, so a Babel plugin would silently switch the whole project
off SWC and slow every build down. `earmark-loader` is a pre-loader instead — it
sees the source you wrote and leaves the rest of the pipeline alone. It covers
both webpack and Turbopack:

```js
// next.config.mjs
import { withEarmark } from 'earmark-loader/next';

export default withEarmark({
  // your config
});
```

```js
withEarmark(config, {
  applyInBuild: true,   // stamp production builds too (off by default)
  root: process.cwd(),  // project root for the reported paths
  exclude: 'legacy/',   // regexp source string
})
```

Both compilations are stamped, client **and** server. That is deliberate: Next
renders your components on the server, and React hydration will not add an
attribute the server HTML did not have — stamping one side only means the
attribute goes missing until something re-renders, with a hydration mismatch on
the way.

The wrapper does not mount the overlay for you. Next has no `index.html` to
inject into, so add it once in a client component:

```jsx
'use client';
import { useEffect } from 'react';

export function Earmark() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    import('earmark').then(({ createEarmark }) => createEarmark());
  }, []);
  return null;
}
```

### Svelte

Vite users — including SvelteKit — get `.svelte` stamping from
`vite-plugin-earmark` with no extra configuration. Every plain element in the
markup is stamped before the Svelte compiler sees it:

```svelte
<button data-earmark-src="src/lib/Card.svelte:12:3" class="go">Go</button>
```

Components, `<svelte:*>`, `<slot>`, comments, `{expressions}` and the contents of
`<script>`/`<style>` are left alone — a stamp in the wrong place there would not
produce a wrong line number, it would produce a file that does not compile.

For a Svelte build that is not Vite, use the preprocessor:

```js
// svelte.config.js
import { earmarkPreprocess } from 'earmark-stamp';

export default { preprocess: [earmarkPreprocess()] };
```

Svelte still has no runtime hook for component names, so stamping is the whole
story there — but CSS rule mapping (below) works regardless.

### Plain HTML and CSS — no build step

A static site has no build to stamp, so earmark resolves the source at
annotation time instead:

- **HTML** — the document is re-fetched and parsed with position tracking, then
  the element's child-index path is walked in the source. Every step is checked
  against the live tag name, so a framework-rendered page (where the served HTML
  is just a shell) reports nothing rather than inventing a line.
- **CSS** — every rule that matches the element, mapped back to the file and
  line that declares it. This one works everywhere, framework or not.

```md
- **Source:** `index.html:101:11` _(resolved from the served HTML)_
- **CSS rules that style it:**
  - `button` → `index.html (inline <style>):49`
    - padding: 7px 13px; border-radius: 8px; border: 1px solid var(--line);
  - `button.primary` → `index.html (inline <style>):59`
    - background: var(--accent); color: rgb(255, 255, 255);
```

The agent now knows the padding it has to change lives at line 49 in the generic
`button` rule, not in `.primary`. Inline `<style>` blocks are offset into their
host document; external stylesheets report their own path; cross-origin
stylesheets are skipped because their contents are unreadable.

---

## Standalone broker

```bash
npx earmark-server --port 7331
curl http://127.0.0.1:7331/markdown
```

| Route | |
| --- | --- |
| `GET /health` | liveness + counts |
| `GET /annotations?status=open&session=ID` | list |
| `POST /annotations` | create (batch) |
| `GET /annotations/wait?since=N&timeout=30000` | long-poll |
| `PATCH /annotations/:id` | update status |
| `POST /annotations/:id/replies` | append to the thread |
| `DELETE /annotations/:id` · `DELETE /annotations` | remove · clear |
| `POST /session` | register a tab / record a route change |
| `GET /sessions` · `GET /sessions/:id` | tabs, with counts and annotations |
| `GET /events?session=ID` | SSE stream; also the tab's liveness signal |
| `GET /markdown` | the agent-facing document |

Flags: `--host --store --file --no-persist --webhook --token --quiet`.

### Storage

`--store json` (default) writes a readable `.earmark/annotations.json` on a
250 ms debounce. `--store sqlite` writes each change immediately to
`.earmark/annotations.db` through `node:sqlite`, so a crash loses at most the
statement in flight — no dependency, Node 22.5+, and it falls back to JSON if
unavailable. `--store memory` keeps nothing.

### Webhooks

```bash
npx earmark-server --webhook https://hooks.example/earmark
```

Also `EARMARK_WEBHOOK_URL` and `EARMARK_WEBHOOKS` (comma-separated). Every
annotation event is POSTed with an `x-earmark-event` header. Delivery is
fire-and-forget with a 5 s timeout and one retry, so a dead endpoint cannot
stall the annotation loop.

---

## Security

This is a development tool.

- The broker binds `127.0.0.1` only. Do not bind it to `0.0.0.0`.
- CORS is open by design — your dev server is on an arbitrary origin.
- Any page open in your browser can reach a loopback port. Pass `--token SECRET`
  if that matters on your machine.
- **Webhooks send annotation content off your machine** — page URLs, element
  text, and whatever you typed. Only configure endpoints you control.
- Source resolution re-fetches your own page and stylesheets from the same
  origin. Nothing is sent anywhere.
- Do not run it on a shared or public host.

---

## Tests

```bash
npm test
```

Eleven suites, 122 tests: store and HTTP behaviour, the MCP surface driven by a
real stdio client, the overlay's sync client, both persistence backends, webhook
delivery, the `init`/`doctor` CLI, the source resolvers, JSX and Svelte stamping,
the webpack/Turbopack loader, and a type-level check of the published
declarations.

```bash
npm run types
```

Type-checks `test/types/check.ts` against the hand-written `.d.ts` files. The
`@ts-expect-error` lines in it are assertions too — they fail the build if the
error they name stops happening.

---

## Not supported

Desktop browsers only. No iframes, no canvas/WebGL internals, no screenshots.
Svelte component *names* are still unavailable (there is no runtime hook) — you
get the file and line instead. See [plan.md](plan.md) for the full open list and
the reasoning behind every design decision.

---

## License

MIT. Clean-room implementation — not derived from any other tool's source.
