/**
 * All overlay CSS. Lives inside the shadow root, so nothing here can leak into
 * the host page and nothing in the host page can restyle the overlay.
 */

export const OVERLAY_CSS = /* css */ `
:host {
  all: initial;
  --ea-accent: #f97316;
  --ea-accent-soft: rgba(249, 115, 22, 0.16);
  --ea-amber: #f5b73d;
  --ea-green: #34d399;
  --ea-blue: #60a5fa;
  --ea-bg: #ffffff;
  --ea-bg-elev: #f6f7f9;
  --ea-fg: #16181d;
  --ea-fg-dim: #62676f;
  --ea-border: rgba(0, 0, 0, 0.12);
  --ea-shadow: 0 8px 28px rgba(15, 18, 24, 0.16), 0 2px 6px rgba(15, 18, 24, 0.08);
  --ea-radius: 10px;
  --ea-font: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  --ea-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-family: var(--ea-font);
  color: var(--ea-fg);
}

@media (prefers-color-scheme: dark) {
  :host {
    --ea-bg: #16181d;
    --ea-bg-elev: #1f2229;
    --ea-fg: #eceef2;
    --ea-fg-dim: #9aa1ac;
    --ea-border: rgba(255, 255, 255, 0.14);
    --ea-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.35);
  }
}

:host([data-theme="dark"]) {
  --ea-bg: #16181d;
  --ea-bg-elev: #1f2229;
  --ea-fg: #eceef2;
  --ea-fg-dim: #9aa1ac;
  --ea-border: rgba(255, 255, 255, 0.14);
  --ea-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.35);
}

:host([data-theme="light"]) {
  --ea-bg: #ffffff;
  --ea-bg-elev: #f6f7f9;
  --ea-fg: #16181d;
  --ea-fg-dim: #62676f;
  --ea-border: rgba(0, 0, 0, 0.12);
}

* { box-sizing: border-box; }

.layer-fixed {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
}

.layer-page {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 2147482999;
}

/* ---------- highlight ---------- */

.highlight {
  position: fixed;
  border: 2px solid var(--ea-accent);
  background: var(--ea-accent-soft);
  border-radius: 3px;
  pointer-events: none;
  transition: all 60ms linear;
  display: none;
}

.highlight[data-visible="true"] { display: block; }

.highlight-label {
  position: absolute;
  left: -2px;
  top: -24px;
  max-width: 420px;
  padding: 3px 7px;
  border-radius: 5px 5px 5px 0;
  background: var(--ea-accent);
  color: #fff;
  font: 500 11px/1.4 var(--ea-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.highlight[data-flip="true"] .highlight-label {
  top: auto;
  bottom: -24px;
  border-radius: 0 5px 5px 5px;
}

.marquee {
  position: fixed;
  border: 2px dashed var(--ea-accent);
  background: var(--ea-accent-soft);
  pointer-events: none;
  display: none;
}

/* ---------- toolbar ---------- */

.toolbar {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--ea-bg);
  border: 1px solid var(--ea-border);
  border-radius: 999px;
  box-shadow: var(--ea-shadow);
  pointer-events: auto;
  user-select: none;
}

.tool {
  all: unset;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--ea-fg-dim);
  transition: background 120ms, color 120ms;
}

.tool:hover { background: var(--ea-bg-elev); color: var(--ea-fg); }
.tool[aria-pressed="true"] { background: var(--ea-accent); color: #fff; }
.tool svg { width: 16px; height: 16px; display: block; }

.tool-divider {
  width: 1px;
  height: 20px;
  background: var(--ea-border);
  margin: 0 3px;
}

.count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--ea-accent);
  color: #fff;
  font: 600 11px/18px var(--ea-font);
  text-align: center;
}

.count[data-empty="true"] { display: none; }

.sync-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  margin: 0 6px 0 2px;
  background: var(--ea-fg-dim);
  flex: none;
}
.sync-dot[data-state="connected"] { background: var(--ea-green); }
.sync-dot[data-state="error"] { background: #ef4444; }
.sync-dot[data-state="offline"] { background: var(--ea-fg-dim); opacity: 0.4; }

/* ---------- pins ---------- */

.pin {
  position: absolute;
  width: 24px;
  height: 24px;
  margin: -12px 0 0 -12px;
  border-radius: 999px 999px 999px 2px;
  background: var(--ea-accent);
  color: #fff;
  font: 600 12px/24px var(--ea-font);
  text-align: center;
  box-shadow: var(--ea-shadow);
  pointer-events: auto;
  cursor: pointer;
  transition: transform 120ms;
}

.pin:hover { transform: scale(1.15); }
.pin[data-status="acknowledged"] { background: var(--ea-blue); color: #16181d; }
.pin[data-status="needs-input"] { background: var(--ea-amber); color: #16181d; }
.pin[data-status="resolved"] { background: var(--ea-green); color: #16181d; }
.pin[data-status="dismissed"] { background: var(--ea-fg-dim); opacity: 0.6; }

.pin-box {
  position: absolute;
  border: 1.5px dashed var(--ea-accent);
  border-radius: 3px;
  pointer-events: none;
  opacity: 0.55;
}

/* ---------- popover ---------- */

.popover {
  position: fixed;
  width: 320px;
  padding: 10px;
  background: var(--ea-bg);
  border: 1px solid var(--ea-border);
  border-radius: var(--ea-radius);
  box-shadow: var(--ea-shadow);
  pointer-events: auto;
  display: none;
}

.popover[data-open="true"] { display: block; }

.popover-target {
  font: 500 11px/1.5 var(--ea-mono);
  color: var(--ea-fg-dim);
  margin-bottom: 7px;
  word-break: break-all;
}

.popover-target b { color: var(--ea-accent); font-weight: 600; }

.popover textarea {
  width: 100%;
  min-height: 68px;
  resize: vertical;
  padding: 7px 8px;
  border: 1px solid var(--ea-border);
  border-radius: 7px;
  background: var(--ea-bg-elev);
  color: var(--ea-fg);
  font: 400 13px/1.45 var(--ea-font);
  outline: none;
}

.popover textarea:focus { border-color: var(--ea-accent); }

.popover-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.hint {
  flex: 1;
  font: 400 11px/1 var(--ea-font);
  color: var(--ea-fg-dim);
}

.priority {
  all: unset;
  padding: 4px 6px;
  border: 1px solid var(--ea-border);
  border-radius: 6px;
  background: var(--ea-bg-elev);
  color: var(--ea-fg-dim);
  font: 500 11px/1.3 var(--ea-font);
  cursor: pointer;
}
.priority:hover { color: var(--ea-fg); }

.item-priority {
  padding: 1px 5px;
  border-radius: 4px;
  font: 600 9.5px/1.5 var(--ea-font);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex: none;
}
.item-priority[data-priority="high"] { background: #ef4444; color: #fff; }
.item-priority[data-priority="low"] { background: var(--ea-border); color: var(--ea-fg-dim); }

.btn {
  all: unset;
  padding: 5px 11px;
  border-radius: 7px;
  font: 500 12px/1.4 var(--ea-font);
  cursor: pointer;
  border: 1px solid var(--ea-border);
  color: var(--ea-fg);
}
.btn:hover { background: var(--ea-bg-elev); }
.btn-primary {
  background: var(--ea-accent);
  border-color: var(--ea-accent);
  color: #fff;
}
.btn-primary:hover { filter: brightness(1.08); background: var(--ea-accent); }

/* ---------- panel ---------- */

.panel {
  position: fixed;
  right: 16px;
  bottom: 60px;
  width: 340px;
  max-height: min(70vh, 620px);
  display: none;
  flex-direction: column;
  background: var(--ea-bg);
  border: 1px solid var(--ea-border);
  border-radius: var(--ea-radius);
  box-shadow: var(--ea-shadow);
  pointer-events: auto;
  overflow: hidden;
}

.panel[data-open="true"] { display: flex; }

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--ea-border);
}

.panel-title {
  flex: 1;
  font: 600 12px/1.4 var(--ea-font);
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ea-fg-dim);
}

.panel-list {
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.panel-empty {
  padding: 26px 16px;
  text-align: center;
  font: 400 12px/1.6 var(--ea-font);
  color: var(--ea-fg-dim);
}

.item {
  padding: 8px 9px;
  border: 1px solid var(--ea-border);
  border-radius: 8px;
  background: var(--ea-bg-elev);
  cursor: pointer;
}

.item:hover { border-color: var(--ea-accent); }

.item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}

.item-index {
  width: 17px;
  height: 17px;
  border-radius: 999px;
  background: var(--ea-accent);
  color: #fff;
  font: 600 10px/17px var(--ea-font);
  text-align: center;
  flex: none;
}
.item[data-status="acknowledged"] .item-index { background: var(--ea-blue); color: #16181d; }
.item[data-status="needs-input"] .item-index { background: var(--ea-amber); color: #16181d; }
.item[data-status="resolved"] .item-index { background: var(--ea-green); color: #16181d; }
.item[data-status="dismissed"] .item-index { background: var(--ea-fg-dim); }

.item-note {
  flex: 1;
  font: 500 12.5px/1.4 var(--ea-font);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-del {
  all: unset;
  cursor: pointer;
  color: var(--ea-fg-dim);
  font: 400 14px/1 var(--ea-font);
  padding: 0 2px;
}
.item-del:hover { color: #ef4444; }

.item-meta {
  font: 400 10.5px/1.5 var(--ea-mono);
  color: var(--ea-fg-dim);
  word-break: break-all;
}

.item-thread {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--ea-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reply {
  font: 400 11.5px/1.45 var(--ea-font);
  color: var(--ea-fg);
}
.reply b { color: var(--ea-accent); font-weight: 600; }
.reply[data-author="agent"] b { color: var(--ea-amber); }

.reply-form { display: flex; gap: 4px; margin-top: 4px; }
.reply-form input {
  flex: 1;
  padding: 4px 7px;
  border: 1px solid var(--ea-border);
  border-radius: 6px;
  background: var(--ea-bg);
  color: var(--ea-fg);
  font: 400 11.5px/1.4 var(--ea-font);
  outline: none;
}
.reply-form input:focus { border-color: var(--ea-accent); }

.panel-foot {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--ea-border);
}
.panel-foot .btn { flex: 1; text-align: center; }

.toast {
  position: fixed;
  right: 16px;
  bottom: 60px;
  padding: 7px 12px;
  background: var(--ea-fg);
  color: var(--ea-bg);
  border-radius: 7px;
  font: 500 12px/1.4 var(--ea-font);
  pointer-events: none;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 160ms, transform 160ms;
}
.toast[data-show="true"] { opacity: 1; transform: translateY(0); }
`;

/**
 * Injected into the *host* document (not the shadow root) — these need to apply
 * to the page's own elements.
 */
export const HOST_CSS = /* css */ `
html[data-earmark-picking] * {
  cursor: crosshair !important;
}
html[data-earmark-picking="text"] * {
  cursor: text !important;
}
html[data-earmark-frozen] *,
html[data-earmark-frozen] *::before,
html[data-earmark-frozen] *::after {
  animation-play-state: paused !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
`;
