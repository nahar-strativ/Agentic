# plan.md

Living record of what we are building, what was decided and why, and what is
still open. Updated as work happens — features, decisions, discussions,
references. Newest decisions appended in their section, not rewritten.

---

## 1. What this is

**earmark** — a clean-room build of a visual feedback tool for AI coding agents.
A developer clicks an element in their running app, types what should change,
and an agent receives structured context (CSS selector, source file:line,
component path, computed styles, box geometry) instead of "the button looks
wrong".

Two modes of operation:

- **Copy-paste** — annotations render to markdown, user pastes into the agent chat.
- **Agent sync** — a local broker + MCP server let the agent read annotations
  directly, ask clarifying questions, and mark them resolved.

**Reference product:** [agentation.com](https://www.agentation.com/) — "Visual
feedback. For agents." We are not copying its code (see §5 Legal); we studied
its described behaviour and reimplemented.

---

## 2. Scope decisions (2026-08-17)

Asked the user two scoping questions before writing code:

| Question | Chosen | Rejected |
| --- | --- | --- |
| How far in this pass? | **Full**: overlay + local server + MCP | MVP copy-paste only; spike-first |
| What apps must it attach to? | **Framework-agnostic vanilla** | React-only npm package; Next.js-first |

Consequences of "framework-agnostic vanilla":

- Core overlay is plain DOM + Shadow DOM, zero runtime dependencies, works in
  React/Vue/Svelte/Angular/plain HTML alike.
- Framework introspection is an *enhancement layer* (`frameworks.js`), never a
  requirement. React fiber and Vue instance reading are best-effort and return
  null without breaking anything.

---

## 3. Architecture

```
packages/core          earmark              browser overlay (no deps, no build step)
packages/server        earmark-server       HTTP + SSE broker, JSON persistence
packages/mcp           earmark-mcp          MCP stdio server (embeds the broker)
packages/vite-plugin   vite-plugin-earmark  stamps JSX with file:line:col
examples/vanilla       demo page + static server
test/                  node --test suites
```

### Data flow

```
browser click
  → extract.js  (selector + styles + rect + component path + source stamp)
  → overlay state (sessionStorage)
  ├─ markdown.js → clipboard                      [copy-paste mode]
  └─ transport.js → POST /annotations             [agent sync mode]
        → store.js (in-memory + .earmark/annotations.json)
        → MCP tools: list / watch / ask / resolve / dismiss
        → agent replies push back over SSE → pin turns amber in the browser
```

### Core module responsibilities

| File | Responsibility |
| --- | --- |
| `core/src/selector.js` | Unique, *verified* CSS selectors. Every candidate is checked with `querySelectorAll` before being returned. |
| `core/src/frameworks.js` | React fiber walk, Vue instance walk, Angular tag walk, `data-earmark-src` lookup. |
| `core/src/extract.js` | Turns an element / text range / dragged region into the agent payload. |
| `core/src/markdown.js` | Pure serializer. Shared by browser, broker and MCP so output is byte-identical everywhere. |
| `core/src/picker.js` | Capture-phase input handling for the three pick modes. |
| `core/src/overlay.js` | Shadow-root UI, annotation state, glue. |
| `core/src/transport.js` | HTTP + SSE client with backoff. Every failure degrades to copy-paste mode. |

---

## 4. Design decisions and rationale

### 4.1 Shadow DOM for the overlay
The overlay lives in `#earmark-root` with an open shadow root. Host page CSS
cannot restyle it and its CSS cannot leak into the host page. Only two rules are
injected into the host document (`HOST_CSS`): the crosshair cursor and the
animation-freeze rule, because those must apply to the page's own elements.

### 4.2 `pointer-events: none` + capture-phase listeners
The overlay never intercepts hit-testing. `document.elementFromPoint` therefore
returns the *real* element under the cursor. To stop the host app from reacting
to picking clicks, `picker.js` listens on `document` in the **capture** phase and
calls `preventDefault` + `stopPropagation` + `stopImmediatePropagation`.

Text mode is the deliberate exception: `mousedown` is allowed through so native
text selection still works; only `click` is swallowed.

### 4.3 Source-file mapping is a build-time concern
React <19 exposed `_debugSource` on the fiber; **React 19 removed it**. Runtime
introspection can no longer give a file and line. So `vite-plugin-earmark`
stamps `data-earmark-src="src/Card.tsx:42:7"` onto every intrinsic JSX element
during `vite dev`.

- Uses `@babel/parser` + `magic-string` (insert at offsets, keep source maps)
  rather than parse→generate, which would destroy formatting.
- Hand-rolled AST walk instead of `@babel/traverse` — one less dependency and
  awkward ESM interop avoided.
- Only **intrinsic** elements (lowercase tags) are stamped. Stamping `<Card />`
  would add a React prop that never reaches the DOM.
- A parse failure returns `null` — never break someone's dev server over one file.
- `apply: 'serve'` by default; `applyInBuild: true` opts into production.

`extract.js` falls back to the nearest stamped ancestor (up to 5 levels) and
flags that in the output as `_(nearest stamped ancestor)_` so the agent knows the
path is approximate.

### 4.4 Selector strategy
Priority order, each verified unique before use:
1. test-id attributes (`data-testid`, `data-test`, `data-cy`, `data-qa`, `data-pw`)
2. `id`
3. semantic attributes (`name`, `aria-label`, `href`, `placeholder`, …)
4. structural path with stable classes, anchored on the nearest ancestor that has
   a test id or id
5. absolute `nth-child` path (last resort)

Hashed classes are filtered out (emotion `css-1x2y3z`, CSS Modules
`Card_root__a1b2`, Vite `_abc123`) — a selector containing a build hash is worse
than useless because it changes every build.

### 4.5 One process for MCP + broker
`earmark-mcp` runs the store, the HTTP/SSE endpoint the browser talks to, **and**
the MCP stdio transport in a single process. `claude mcp add earmark` is the only
setup step; there is no second daemon to keep alive. `earmark-server` still
exists standalone for non-MCP use (copy-paste-plus-curl workflows, other editors).

Port clash (`EADDRINUSE`) is handled rather than fatal: MCP keeps working against
its local store and `earmark_status` reports the problem in plain language.

### 4.6 `watch` semantics — bug found and fixed during testing
`earmark_watch_annotations` blocks via long-poll until something newer than a
cursor exists.

First implementation initialised `watchCursor` once at startup, so an agent that
called `list` and then `watch` was immediately handed back the annotations it had
just read instead of blocking. Caught by `test/mcp.test.mjs`.

**Fix:** every non-watch tool call advances `watchCursor` to `store.cursor`.
Semantics are now "tell me what changed since the last time I looked at
anything", which also stops an agent being woken by its own writes.

### 4.7 Markdown is the interface
The serializer is pure and dependency-free, and is imported by the browser, the
broker (`GET /markdown`) and the MCP server. Ordering is deliberate: the
greppable facts (source, selector, exact text) come first, cosmetics last. The
footer tells the agent *how* to use the block.

### 4.8 Computed-style noise reduction
Reporting `flex-direction: row` or `opacity: 1` reads to an agent like an
intentional declaration. So:
- per-property initial values are dropped (`STYLE_DEFAULTS`)
- flex/grid properties only appear on flex/grid containers (`LAYOUT_ONLY`)
- `width`/`height` are dropped — the `Box` line already carries geometry
- font stacks collapse to the first family

### 4.9 Pins track layout, not coordinates
Pins re-resolve their element by selector on every render (`liveRect`) and fall
back to captured page coordinates only when the element is gone. Annotations
therefore stay attached through responsive reflow and re-renders.

### 4.10 Reconnect reconciliation — second bug found during testing
Originally the overlay pushed every stored annotation on connect. If the agent
had replied, resolved or dismissed something while the tab was closed, that
push **overwrote the agent's work** with the browser's stale copy.

**Fix:** `reconcile()` on connect. The broker is authoritative for agent-side
fields (`status`, `replies`); the browser is authoritative for the annotation
itself. Annotations the broker has never seen get pushed up; ones it already
knows get pulled down.

Related: answering the agent from the panel updated the status locally but sent
no status to the broker, so the server sat on `needs-input` forever and the agent
kept believing it was blocked. `transport.reply()` now sends `status: 'open'` by
default. Both are covered by `test/transport.test.mjs`.

### 4.11 Security posture
- Broker binds `127.0.0.1` only.
- CORS is wide open **by design** — the overlay runs on an arbitrary dev origin.
- Any page in the browser can reach a loopback port, so an optional `--token`
  gates every request.
- Documented as a development tool: not for shared or public machines.
- Request bodies capped at 5 MB.
- The demo static server normalises paths so requests cannot escape the repo root.

---

## 5. Legal

Agentation's repository is **PolyForm Shield 1.0.0**, which bars building a
competing product *from their code*. Nothing here is derived from their source —
this is a clean-room implementation from publicly described behaviour. Our
packages are MIT.

### Naming (settled 2026-08-17)

**earmark.** To earmark something is to mark it for a specific purpose — which is
exactly the gesture: you earmark an element for the agent to fix. It also reads
as a dog-eared page corner, which is what the pins look like.

Chosen over `pindrop` (the working name) and over reusing "agentation", which
would collide with the existing product's trademark and npm packages.

All four npm names were verified free at the time of choosing: `earmark`,
`earmark-server`, `earmark-mcp`, `vite-plugin-earmark`. Rejected because taken:
loupe, fovea, redline, nitpick, reticle, spyglass, pinpoint, lorgnette, dogear.

Home: **https://github.com/nahar-strativ/Agentic** (public). The repo name and
the project name differ deliberately — `Agentic` is the account's umbrella repo,
`earmark` is the tool.

---

## 6. Status

### Done and verified
- [x] Shadow-DOM overlay: toolbar, hover highlight, pins, side panel, toasts, dark/light
- [x] Four pick modes: element, shift-click multi-select, text selection, drag region
- [x] Animation freeze
- [x] Verified-unique selector generation with hashed-class filtering
- [x] React / Vue / Angular component-path introspection
- [x] Markdown serializer
- [x] Clipboard copy with `execCommand` fallback for non-secure contexts
- [x] `sessionStorage` persistence + reconnect reconciliation
- [x] Broker: REST + SSE + long-poll + JSON persistence + optional token
- [x] MCP: 8 tools, bidirectional ask/answer, resolve, dismiss
- [x] Vite plugin: JSX source stamping + auto-inject
- [x] 41 tests across four suites, all passing
- [x] Live browser verification of the whole loop, both directions:
      click → broker → markdown, and agent question → SSE → amber pin → human
      answer → broker

### Open / not built
- [ ] **Screenshots.** No element cropping or page capture. Worth adding for
      vision-capable agents; `html2canvas` is heavy, `getDisplayMedia` needs a
      user gesture. Undecided.
- [ ] **Next.js / Turbopack source stamping.** Only Vite has a plugin. Next
      users get selectors but no `file:line` unless they add the attribute by
      hand or run a Babel pass.
- [ ] **Svelte component names.** No reliable runtime hook; relies entirely on
      build-time stamping, which we do not do for `.svelte` files yet.
- [ ] **iframes.** The overlay only sees its own document.
- [ ] **Canvas / WebGL apps.** Nothing to annotate — region mode reports an
      empty area.
- [ ] **Mobile / touch.** Desktop only, same limitation the reference product has.
- [ ] **TypeScript declarations.** Source is JSDoc-typed JS; no `.d.ts` emitted.
- [ ] **Publishing.** Nothing is on npm; everything runs from source.

### Feature audit against the reference product (2026-08-17)

Full read of agentation.com, their repo README and `agentation-mcp`. What they
have that we do not:

| Theirs | Us | Worth taking? |
| --- | --- | --- |
| **Sessions** — annotations grouped per page/tab, with `list_sessions`, `get_session`, `get_all_pending` | Flat list; `sessionId` is stored but never surfaced | **Yes.** Matters the moment you annotate across routes. |
| **`acknowledge`** status — agent has seen it but has not acted | open / needs-input / resolved / dismissed only | **Yes.** Cheap, and it distinguishes "read" from "done". |
| SQLite store (`AGENTATION_STORE=sqlite\|memory`) | JSON file | Later. JSON is fine at this scale. |
| Webhooks (`AGENTATION_WEBHOOK_URL`, `AGENTATION_WEBHOOKS`) | None | Later, if anyone asks. |
| `init` and `doctor` CLI commands | None | `doctor` is nice DX; `earmark_status` already covers most of it. |
| Freezes **JS animations and videos**, not just CSS | CSS animations/transitions only | Yes — cheap to add (`video.pause()`, Web Animations API `getAnimations()`). |
| Priority field on feedback | None | Marginal. |
| Event retention window | None | No. |

What we have that they do not:

- Framework-agnostic, not React-18+-only
- Build-time source stamping that works on **React 19** (their runtime approach
  relies on `_debugSource`, which React 19 removed)
- Multiple targets in a single annotation
- Optional auth token on the broker

Their MCP tool surface, for reference: `list_sessions`, `get_session`,
`get_pending`, `get_all_pending`, `acknowledge`, `resolve`, `dismiss`, `reply`,
`watch_annotations`. Default port 4747 (ours 7331).

---

## 7. Open questions for the user

1. **Sessions + `acknowledge`** — add them? They are the two real gaps.
2. **Screenshots** — worth the dependency weight for vision-model workflows?
3. **Next.js support** — is that the primary target? If so the Turbopack/Babel
   stamping path moves up the list.
4. **Distribution** — publish to npm, keep internal to Strativ, or vendor into a
   specific project?

---

## 8. References

- **Our repo:** https://github.com/nahar-strativ/Agentic (public, account `nahar-strativ`)
- Reference product: https://www.agentation.com/
- Their repo (PolyForm Shield 1.0.0, do **not** copy): https://github.com/benjitaylor/agentation
- Their MCP package: https://www.npmjs.com/package/agentation-mcp
- MCP spec / SDK: `@modelcontextprotocol/sdk` (low-level `Server` API used, so no
  zod version coupling)
- React 19 removed `_debugSource` — the reason `vite-plugin-earmark` exists

---

## 9. Changelog

- **2026-08-17** — Initial build. Scope confirmed with the user (full stack,
  framework-agnostic). All four packages written, 41 tests green, both
  directions of the loop verified in a real browser. Three real bugs found and
  fixed during testing: the `watchCursor` replay (§4.6), the reconnect clobber
  and the missing reply status (§4.10). Reduced computed-style noise (§4.8).
  `plan.md` started at the user's request — maintain it for every feature,
  decision, discussion and reference from here on.
- **2026-08-17** — Audited the reference product's full feature set (§6). Two
  real gaps identified: sessions and `acknowledge`.
- **2026-08-17** — Renamed `pindrop` → **earmark** (§5) and published to
  https://github.com/nahar-strativ/Agentic. All 41 tests re-run green after the
  rename.
