/**
 * Annotation -> markdown serializer.
 *
 * Pure and dependency-free so the browser overlay, the dev server and the MCP
 * server all emit byte-identical output. Optimised for an agent reading it:
 * the greppable facts (selector, source, exact text) come first, the cosmetic
 * detail comes last.
 */

/**
 * @param {Record<string, string>} styles
 * @returns {string}
 */
function styleLine(styles) {
  return Object.entries(styles || {})
    .map(([k, v]) => `${kebab(k)}: ${v}`)
    .join('; ');
}

/** @param {string} s */
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * @param {string} text
 * @param {number} max
 */
const clip = (text, max) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** @param {any} rect */
const boxOf = (rect) =>
  rect ? `${Math.round(rect.width)}×${Math.round(rect.height)} at (${Math.round(rect.pageX ?? rect.x)}, ${Math.round(rect.pageY ?? rect.y)})` : '';

/**
 * @param {object} target
 * @returns {string[]} bullet lines describing one target
 */
function targetLines(target) {
  const lines = [];

  if (target.kind === 'region') {
    lines.push(`- **Target:** screen region ${boxOf(target.rect)}`);
    if (target.emptyRegion) {
      lines.push('- **Contents:** no elements fully inside this region');
      if (target.container) {
        const src = target.container.source ? ` — \`${target.container.source}\`` : '';
        lines.push(
          `- **Drawn on:** ${target.container.label} → \`${target.container.selector}\`${src}`,
        );
        lines.push(...canvasLines(target.container.canvas));
      }
    } else {
      lines.push('- **Elements inside:**');
      for (const el of target.elements || []) {
        const src = el.source ? ` — \`${el.source}\`` : '';
        lines.push(`  - ${el.label} → \`${el.selector}\`${src}`);
      }
    }
    return lines;
  }

  const tag = target.tag ? `\`<${target.tag}>\` ` : '';
  lines.push(`- **Element:** ${tag}${target.label}`);
  lines.push(`- **Selector:** \`${target.selector}\``);

  /* No CSS selector crosses a shadow boundary, so the selector above cannot be
     run as-is. Hand over the expression that can. */
  if (target.shadow) {
    lines.push(`- **Inside shadow DOM:** ${target.shadow.hosts.map((h) => `\`${h}\``).join(' › ')}`);
    lines.push(`  - reach it with: \`${target.shadow.expression}\``);
    lines.push('  - the selector above is unique inside that shadow root, not in the document');
  }

  /* A selector is unique within one document. Saying which document has to come
     with it, or the agent runs it in the wrong one. */
  if (target.frame) {
    const where = target.frame.name ? ` (${target.frame.name})` : '';
    lines.push(`- **Inside iframe:** \`${target.frame.selector}\`${where}`);
    if (target.frame.url) lines.push(`  - frame document: ${target.frame.url}`);
    lines.push('  - the selector above resolves inside that frame, not the top page');
  }

  if (target.source) {
    // `sourceExact: false` is a claim the overlay makes deliberately. Absent is
    // not the same as false, and guessing "nearest stamped ancestor" for an
    // annotation that never said either way puts a fabricated caveat in front of
    // the agent.
    const qualifier =
      target.sourceExact === false
        ? ' _(nearest stamped ancestor)_'
        : target.sourceExact && target.sourceFrom === 'html'
          ? ' _(resolved from the served HTML)_'
          : '';
    lines.push(`- **Source:** \`${target.source}\`${qualifier}`);
  }

  if (target.cssRules?.length) {
    lines.push('- **CSS rules that style it:**');
    for (const rule of target.cssRules) {
      const where = rule.line ? `${rule.file}:${rule.line}` : rule.file;
      const condition = rule.condition ? ` \`@media ${rule.condition}\`` : '';
      lines.push(`  - \`${rule.selector}\` → \`${where}\`${condition}`);
      if (rule.declarations) lines.push(`    - ${clip(rule.declarations, 240)}`);
    }
  }
  if (target.components?.length) {
    lines.push(`- **Component path:** ${target.components.join(' › ')}`);
  }
  if (target.kind === 'text' && target.selectedText) {
    lines.push(`- **Selected text:** "${target.selectedText}"`);
  } else if (target.text) {
    lines.push(`- **Text:** "${target.text}"`);
  }
  if (target.testId) lines.push(`- **Test id:** \`${target.testId}\``);

  const box = boxOf(target.rect);
  if (box) lines.push(`- **Box:** ${box}`);

  lines.push(...canvasLines(target.canvas));

  const styles = styleLine(target.styles);
  if (styles) lines.push(`- **Computed:** ${styles}`);

  const attrs = Object.entries(target.attributes || {})
    .filter(([k]) => k !== 'id')
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  if (attrs) lines.push(`- **Attributes:** ${attrs}`);

  if (target.ancestors?.length) {
    const chain = target.ancestors
      .map((a) => {
        const name = a.component
          ? a.component
          : a.tag + (a.id ? `#${a.id}` : a.classes?.length ? `.${a.classes[0]}` : '');
        return a.source ? `${name} (\`${a.source}\`)` : name;
      })
      .join(' ← ');
    lines.push(`- **Ancestors:** ${chain}`);
  }

  if (!target.source) {
    lines.push(`- **DOM path:** \`${target.domPath}\``);
  }

  return lines;
}

/**
 * A canvas has no DOM inside it and no source line to point at, so what an agent
 * can actually use is the coordinate space its drawing code works in. The buffer
 * is frequently a different size from the CSS box, and that ratio is exactly what
 * hit-testing bugs live in.
 *
 * @param {any} canvas
 * @returns {string[]}
 */
function canvasLines(canvas) {
  if (!canvas) return [];
  const lines = ['- **Canvas:**'];
  lines.push(
    `  - buffer ${canvas.buffer.width}×${canvas.buffer.height}, CSS ${canvas.css.width}×${canvas.css.height}` +
      ` (${canvas.scale.x}× / ${canvas.scale.y}× per CSS pixel, dpr ${canvas.devicePixelRatio})`,
  );
  if (canvas.context) lines.push(`  - context: \`${canvas.context}\``);
  if (canvas.library) lines.push(`  - renderer: ${canvas.library}`);
  if (canvas.point) {
    lines.push(`  - clicked at buffer pixel (${canvas.point.x}, ${canvas.point.y})`);
  }
  if (canvas.region) {
    lines.push(
      `  - region in buffer pixels: ${canvas.region.width}×${canvas.region.height} at (${canvas.region.x}, ${canvas.region.y})`,
    );
  }
  lines.push('  - nothing inside a canvas is in the DOM; these coordinates are the handle');
  return lines;
}

/**
 * Render one annotation.
 *
 * @param {object} annotation
 * @param {number} index 1-based position in the batch
 * @returns {string}
 */
export function annotationToMarkdown(annotation, index = 1) {
  const heading = annotation.note?.trim()
    ? `### ${index}. ${annotation.note.trim()}`
    : `### ${index}. ${annotation.target?.label ?? 'Annotation'}`;

  const lines = [heading, ''];

  if (annotation.id) lines.push(`- **Annotation id:** \`${annotation.id}\``);
  if (annotation.priority && annotation.priority !== 'normal') {
    lines.push(`- **Priority:** ${annotation.priority}`);
  }
  if (annotation.status && annotation.status !== 'open') {
    lines.push(`- **Status:** ${annotation.status}`);
  }

  const targets = annotation.targets?.length ? annotation.targets : [annotation.target];
  targets.filter(Boolean).forEach((target, i) => {
    if (targets.length > 1) lines.push(`- **Target ${i + 1}:**`);
    lines.push(...targetLines(target).map((l) => (targets.length > 1 ? `  ${l}` : l)));
  });

  if (annotation.replies?.length) {
    lines.push('- **Thread:**');
    for (const reply of annotation.replies) {
      lines.push(`  - _${reply.author}_: ${reply.message}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Render a full batch: page context header + every annotation + a short
 * instruction block telling the agent what to do with it.
 *
 * @param {object[]} annotations
 * @param {object} page result of pageContext()
 * @param {{instructions?: boolean}} [options]
 * @returns {string}
 */
export function batchToMarkdown(annotations, page, options = {}) {
  const { instructions = true } = options;
  const out = [];

  out.push(`## UI feedback — ${annotations.length} annotation${annotations.length === 1 ? '' : 's'}`);
  out.push('');

  if (page) {
    out.push(`- **Page:** ${page.url}`);
    if (page.viewport) {
      out.push(
        `- **Viewport:** ${page.viewport.width}×${page.viewport.height} @${page.devicePixelRatio}x, ${page.colorScheme} mode`,
      );
    }
    if (page.framework && page.framework !== 'unknown') {
      out.push(`- **Framework:** ${page.framework}`);
    }
    if (page.scroll && (page.scroll.x || page.scroll.y)) {
      out.push(`- **Scroll:** ${page.scroll.x}, ${page.scroll.y}`);
    }
    out.push('');
  }

  annotations.forEach((a, i) => out.push(annotationToMarkdown(a, i + 1)));

  if (instructions) {
    out.push('---');
    out.push('');
    out.push(
      'Locate each element by its **Source** path when present; otherwise grep for the ' +
        'selector, test id, or quoted text. Coordinates are page coordinates in CSS pixels. ' +
        'Apply the change described in each heading.',
    );
    out.push('');
  }

  return out.join('\n');
}
