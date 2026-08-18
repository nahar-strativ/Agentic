/**
 * All overlay CSS. Lives inside the shadow root, so nothing here can leak into
 * the host page and nothing in the host page can restyle the overlay.
 *
 * Visual system: AlignUI. Neutral surfaces, one blue primary, semantic status
 * colours, hairline strokes, layered shadows that end in a 1px ring, and a type
 * scale whose labels carry negative tracking. Reimplemented as our own tokens —
 * no stylesheet, font file or asset is taken from anywhere else.
 *
 * Two colours do specific work and are not interchangeable:
 *   --ea-mark     orange, the marking ink — highlights, marquee, an open pin.
 *   --ea-primary  blue, action — primary buttons, and the acknowledged state,
 *                 which has meant "an agent picked this up" since §4.12.
 */

export const OVERLAY_CSS = /* css */ `
:host {
  all: initial;

  /* neutral ramp */
  --ea-bg: #ffffff;
  --ea-bg-elev: #f7f7f7;
  --ea-bg-sub: #ebebeb;
  --ea-fg: #171717;
  --ea-fg-dim: #5c5c5c;
  --ea-fg-soft: #a3a3a3;
  --ea-border: #ebebeb;
  --ea-border-strong: #d1d1d1;

  /* action */
  --ea-primary: #335cff;
  --ea-primary-hover: #2547d0;
  --ea-primary-alpha: rgba(71, 108, 255, 0.16);
  --ea-on-primary: #ffffff;

  /* marking ink */
  --ea-mark: #fa7319;
  --ea-mark-soft: rgba(255, 145, 71, 0.16);

  /* status */
  --ea-away: #f6b51e;
  --ea-success: #1fc16b;
  --ea-error: #fb3748;
  --ea-on-status: #171717;

  /* elevation — layered, closing on a 1px ring so a surface reads as a surface
     even against a page whose background we do not control */
  --ea-shadow:
    0 16px 32px -12px rgba(14, 18, 27, 0.10),
    0 6px 6px -3px rgba(14, 18, 27, 0.04),
    0 3px 3px -1.5px rgba(14, 18, 27, 0.04),
    0 1px 1px -0.5px rgba(14, 18, 27, 0.04),
    0 0 0 1px rgba(14, 18, 27, 0.06),
    0 -1px 1px -0.5px rgba(14, 18, 27, 0.06) inset;
  --ea-shadow-sm:
    0 3px 3px -1.5px rgba(14, 18, 27, 0.08),
    0 1px 1px -0.5px rgba(14, 18, 27, 0.08),
    0 0 0 1px rgba(14, 18, 27, 0.08);
  --ea-ring: 0 0 0 3px var(--ea-primary-alpha);

  /* shape */
  --ea-r-sm: 8px;
  --ea-r: 10px;
  --ea-r-lg: 16px;
  --ea-radius: var(--ea-r-lg);

  /* type — Inter when the machine has it, the system face otherwise. Nothing is
     fetched: a dev tool that waits on a font CDN is a dev tool that flashes. */
  --ea-font: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --ea-mono: "Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, monospace;

  font-family: var(--ea-font);
  color: var(--ea-fg);
  -webkit-font-smoothing: antialiased;
}

@media (prefers-color-scheme: dark) {
  :host {
    --ea-bg: #171717;
    --ea-bg-elev: #262626;
    --ea-bg-sub: #333333;
    --ea-fg: #ffffff;
    --ea-fg-dim: #a3a3a3;
    --ea-fg-soft: #7b7b7b;
    /* AlignUI's dark stroke is #262626; over an unknown page the overlay needs
       one step more definition than a page that owns its own background. */
    --ea-border: #292929;
    --ea-border-strong: #5c5c5c;
    --ea-primary: #4d82ff;
    --ea-primary-hover: #6895ff;
    --ea-mark: #ffa468;
    --ea-away: #ffd268;
    --ea-success: #3ee089;
    --ea-error: #ff6875;
    --ea-shadow:
      0 16px 32px -12px rgba(0, 0, 0, 0.64),
      0 6px 6px -3px rgba(0, 0, 0, 0.32),
      0 1px 1px -0.5px rgba(0, 0, 0, 0.32),
      0 0 0 1px #292929,
      0 -1px 1px -0.5px rgba(255, 255, 255, 0.04) inset;
    --ea-shadow-sm:
      0 3px 3px -1.5px rgba(0, 0, 0, 0.48),
      0 1px 1px -0.5px rgba(0, 0, 0, 0.32),
      0 0 0 1px rgba(255, 255, 255, 0.08);
  }
}

:host([data-theme="dark"]) {
  --ea-bg: #171717;
  --ea-bg-elev: #262626;
  --ea-bg-sub: #333333;
  --ea-fg: #ffffff;
  --ea-fg-dim: #a3a3a3;
  --ea-fg-soft: #7b7b7b;
  --ea-border: #292929;
  --ea-border-strong: #5c5c5c;
  --ea-primary: #4d82ff;
  --ea-primary-hover: #6895ff;
  --ea-mark: #ffa468;
  --ea-away: #ffd268;
  --ea-success: #3ee089;
  --ea-error: #ff6875;
  --ea-shadow:
    0 16px 32px -12px rgba(0, 0, 0, 0.64),
    0 6px 6px -3px rgba(0, 0, 0, 0.32),
    0 1px 1px -0.5px rgba(0, 0, 0, 0.32),
    0 0 0 1px #292929,
    0 -1px 1px -0.5px rgba(255, 255, 255, 0.04) inset;
  --ea-shadow-sm:
    0 3px 3px -1.5px rgba(0, 0, 0, 0.48),
    0 1px 1px -0.5px rgba(0, 0, 0, 0.32),
    0 0 0 1px rgba(255, 255, 255, 0.08);
}

:host([data-theme="light"]) {
  --ea-bg: #ffffff;
  --ea-bg-elev: #f7f7f7;
  --ea-bg-sub: #ebebeb;
  --ea-fg: #171717;
  --ea-fg-dim: #5c5c5c;
  --ea-fg-soft: #a3a3a3;
  --ea-border: #ebebeb;
  --ea-border-strong: #d1d1d1;
  --ea-primary: #335cff;
  --ea-primary-hover: #2547d0;
  --ea-mark: #fa7319;
  --ea-away: #f6b51e;
  --ea-success: #1fc16b;
  --ea-error: #fb3748;
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
  border: 2px solid var(--ea-mark);
  background: var(--ea-mark-soft);
  border-radius: 4px;
  pointer-events: none;
  transition: all 60ms linear;
  display: none;
}

.highlight[data-visible="true"] { display: block; }

.highlight-label {
  position: absolute;
  left: -2px;
  top: -25px;
  max-width: 420px;
  padding: 3px 8px;
  border-radius: var(--ea-r-sm) var(--ea-r-sm) var(--ea-r-sm) 0;
  background: var(--ea-mark);
  color: #ffffff;
  font: 500 11px/1.45 var(--ea-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.highlight[data-flip="true"] .highlight-label {
  top: auto;
  bottom: -25px;
  border-radius: 0 var(--ea-r-sm) var(--ea-r-sm) var(--ea-r-sm);
}

.marquee {
  position: fixed;
  border: 2px dashed var(--ea-mark);
  background: var(--ea-mark-soft);
  border-radius: 4px;
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
  padding: 5px;
  background: var(--ea-bg);
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
.tool:focus-visible { box-shadow: var(--ea-ring); }
.tool[aria-pressed="true"] {
  background: var(--ea-primary);
  color: var(--ea-on-primary);
}
.tool svg { width: 16px; height: 16px; display: block; }

.tool-divider {
  width: 1px;
  height: 20px;
  background: var(--ea-border);
  margin: 0 4px;
}

.count {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ea-primary);
  color: var(--ea-on-primary);
  font: 500 11px/20px var(--ea-font);
  letter-spacing: 0;
  text-align: center;
}

.count[data-empty="true"] { display: none; }

.sync-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  margin: 0 6px 0 2px;
  background: var(--ea-fg-soft);
  flex: none;
}
.sync-dot[data-state="connected"] { background: var(--ea-success); }
.sync-dot[data-state="error"] { background: var(--ea-error); }
.sync-dot[data-state="offline"] { background: var(--ea-fg-soft); opacity: 0.4; }

/* ---------- pins ---------- */

.pin {
  position: absolute;
  width: 24px;
  height: 24px;
  margin: -12px 0 0 -12px;
  border-radius: 999px 999px 999px 2px;
  background: var(--ea-mark);
  color: #ffffff;
  font: 500 12px/24px var(--ea-font);
  letter-spacing: 0;
  text-align: center;
  box-shadow: var(--ea-shadow-sm);
  pointer-events: auto;
  cursor: pointer;
  transition: transform 120ms;
}

.pin:hover { transform: scale(1.15); }
.pin[data-status="acknowledged"] { background: var(--ea-primary); color: var(--ea-on-primary); }
.pin[data-status="needs-input"] { background: var(--ea-away); color: var(--ea-on-status); }
.pin[data-status="resolved"] { background: var(--ea-success); color: var(--ea-on-status); }
.pin[data-status="dismissed"] { background: var(--ea-fg-soft); opacity: 0.6; }

.pin-box {
  position: absolute;
  border: 1.5px dashed var(--ea-mark);
  border-radius: 4px;
  pointer-events: none;
  opacity: 0.55;
}

/* ---------- popover ---------- */

.popover {
  position: fixed;
  width: 320px;
  padding: 12px;
  background: var(--ea-bg);
  border-radius: var(--ea-r-lg);
  box-shadow: var(--ea-shadow);
  pointer-events: auto;
  display: none;
}

.popover[data-open="true"] { display: block; }

.popover-target {
  font: 400 11px/1.55 var(--ea-mono);
  color: var(--ea-fg-dim);
  margin-bottom: 8px;
  word-break: break-all;
}

.popover-target b { color: var(--ea-mark); font-weight: 500; }

.popover textarea {
  width: 100%;
  min-height: 68px;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--ea-border);
  border-radius: var(--ea-r);
  background: var(--ea-bg);
  color: var(--ea-fg);
  font: 400 13px/1.5 var(--ea-font);
  letter-spacing: -0.006em;
  outline: none;
  transition: border-color 120ms, box-shadow 120ms;
}

.popover textarea::placeholder { color: var(--ea-fg-soft); }
.popover textarea:focus {
  border-color: var(--ea-primary);
  box-shadow: var(--ea-ring);
}

.popover-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}

.hint {
  flex: 1;
  font: 400 11px/1.3 var(--ea-font);
  color: var(--ea-fg-soft);
}

.priority {
  all: unset;
  padding: 5px 8px;
  border: 1px solid var(--ea-border);
  border-radius: var(--ea-r-sm);
  background: var(--ea-bg);
  color: var(--ea-fg-dim);
  font: 500 11px/1.3 var(--ea-font);
  cursor: pointer;
  transition: background 120ms, color 120ms;
}
.priority:hover { background: var(--ea-bg-elev); color: var(--ea-fg); }
.priority:focus-visible { box-shadow: var(--ea-ring); }

.item-priority {
  padding: 2px 6px;
  border-radius: 999px;
  font: 500 9.5px/1.5 var(--ea-font);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex: none;
}
.item-priority[data-priority="high"] { background: var(--ea-error); color: #ffffff; }
.item-priority[data-priority="low"] { background: var(--ea-bg-sub); color: var(--ea-fg-dim); }

.btn {
  all: unset;
  padding: 6px 12px;
  border-radius: var(--ea-r);
  font: 500 12px/1.5 var(--ea-font);
  letter-spacing: -0.006em;
  cursor: pointer;
  border: 1px solid var(--ea-border);
  background: var(--ea-bg);
  color: var(--ea-fg);
  transition: background 120ms, border-color 120ms;
}
.btn:hover { background: var(--ea-bg-elev); border-color: var(--ea-border-strong); }
.btn:focus-visible { box-shadow: var(--ea-ring); }
.btn-primary {
  background: var(--ea-primary);
  border-color: var(--ea-primary);
  color: var(--ea-on-primary);
}
.btn-primary:hover {
  background: var(--ea-primary-hover);
  border-color: var(--ea-primary-hover);
}

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
  border-radius: var(--ea-r-lg);
  box-shadow: var(--ea-shadow);
  pointer-events: auto;
  overflow: hidden;
}

.panel[data-open="true"] { display: flex; }

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--ea-border);
}

.panel-title {
  flex: 1;
  font: 500 11px/1.45 var(--ea-font);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ea-fg-soft);
}

.panel-list {
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-empty {
  padding: 28px 16px;
  text-align: center;
  font: 400 12px/1.6 var(--ea-font);
  color: var(--ea-fg-soft);
}

.item {
  padding: 10px;
  border: 1px solid var(--ea-border);
  border-radius: var(--ea-r);
  background: var(--ea-bg);
  cursor: pointer;
  transition: border-color 120ms, background 120ms;
}

.item:hover { background: var(--ea-bg-elev); border-color: var(--ea-border-strong); }

.item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.item-index {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--ea-mark);
  color: #ffffff;
  font: 500 10px/18px var(--ea-font);
  text-align: center;
  flex: none;
}
.item[data-status="acknowledged"] .item-index { background: var(--ea-primary); color: var(--ea-on-primary); }
.item[data-status="needs-input"] .item-index { background: var(--ea-away); color: var(--ea-on-status); }
.item[data-status="resolved"] .item-index { background: var(--ea-success); color: var(--ea-on-status); }
.item[data-status="dismissed"] .item-index { background: var(--ea-fg-soft); }

.item-note {
  flex: 1;
  font: 500 13px/1.45 var(--ea-font);
  letter-spacing: -0.006em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-del {
  all: unset;
  cursor: pointer;
  color: var(--ea-fg-soft);
  font: 400 14px/1 var(--ea-font);
  padding: 0 2px;
  border-radius: 4px;
}
.item-del:hover { color: var(--ea-error); }
.item-del:focus-visible { box-shadow: var(--ea-ring); }

.item-meta {
  font: 400 10.5px/1.55 var(--ea-mono);
  color: var(--ea-fg-soft);
  word-break: break-all;
}

.item-thread {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--ea-border);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.reply {
  font: 400 11.5px/1.5 var(--ea-font);
  letter-spacing: -0.006em;
  color: var(--ea-fg-dim);
}
.reply b { color: var(--ea-primary); font-weight: 500; }
.reply[data-author="agent"] b { color: var(--ea-away); }

.reply-form { display: flex; gap: 5px; margin-top: 4px; }
.reply-form input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--ea-border);
  border-radius: var(--ea-r-sm);
  background: var(--ea-bg);
  color: var(--ea-fg);
  font: 400 11.5px/1.45 var(--ea-font);
  outline: none;
  transition: border-color 120ms, box-shadow 120ms;
}
.reply-form input::placeholder { color: var(--ea-fg-soft); }
.reply-form input:focus {
  border-color: var(--ea-primary);
  box-shadow: var(--ea-ring);
}

.panel-foot {
  display: flex;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid var(--ea-border);
}
.panel-foot .btn { flex: 1; text-align: center; }

.toast {
  position: fixed;
  right: 16px;
  bottom: 60px;
  padding: 8px 12px;
  background: var(--ea-fg);
  color: var(--ea-bg);
  border-radius: var(--ea-r);
  font: 500 12px/1.5 var(--ea-font);
  letter-spacing: -0.006em;
  box-shadow: var(--ea-shadow-sm);
  pointer-events: none;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 160ms, transform 160ms;
}
.toast[data-show="true"] { opacity: 1; transform: translateY(0); }

/* Touch and pen. A 32px control is comfortable with a cursor and a miss with a
   fingertip, so the controls grow and the panel stops assuming a desktop width. */
@media (pointer: coarse) {
  .toolbar {
    right: 12px;
    bottom: 12px;
    padding: 6px;
    gap: 4px;
  }

  .tool {
    width: 44px;
    height: 44px;
  }

  .tool svg { width: 20px; height: 20px; }

  .count {
    min-width: 24px;
    height: 24px;
    font-size: 12px;
    line-height: 24px;
  }

  .pin {
    width: 30px;
    height: 30px;
    margin: -15px 0 0 -15px;
    font-size: 14px;
    line-height: 30px;
  }

  .panel {
    right: 12px;
    left: 12px;
    bottom: 72px;
    width: auto;
    max-height: min(72vh, 620px);
  }

  .popover {
    width: min(340px, calc(100vw - 24px));
    padding: 14px;
  }

  .popover textarea { min-height: 84px; font-size: 16px; }

  /* 16px keeps iOS Safari from zooming the whole page when the field is focused. */
  .reply-form input { font-size: 16px; }

  .btn,
  .priority {
    padding: 9px 14px;
    font-size: 13px;
  }

  .item { padding: 12px; }
  .item-del { padding: 4px 8px; font-size: 18px; }
}
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
/* On a touchscreen the browser would scroll, zoom or long-press-select under the
   finger while picking. Text mode is exempt: native selection is the point there. */
html[data-earmark-picking="element"],
html[data-earmark-picking="region"] {
  touch-action: none;
}
html[data-earmark-picking="element"] *,
html[data-earmark-picking="region"] * {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
html[data-earmark-frozen] *,
html[data-earmark-frozen] *::before,
html[data-earmark-frozen] *::after {
  animation-play-state: paused !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
`;
