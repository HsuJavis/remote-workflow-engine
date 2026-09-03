// TASK-113 / DES-124 (ARCH-080): gateDiagram — the pure allowlist gate over model-authored
// diagram text. Four passes, in order: type -> codepoint -> size -> token. On success returns
// `raw` verbatim (validator, never a transformer).

// UT-127 (v23 Gate 2 re-run, send-back `d294880`, A5): exported — the ONE canonical declaration
// of the diagram vocabulary. Every other consumer (the shipped default systemPrompt, the example
// config) must build off THIS array by interpolation, never re-type it.
export const VOCAB_GLYPHS = ['◇', '⟲', '─', '│', '┬', '┴', '├', '┤', '▶', '╭', '╮', '╰', '╯'];

function buildDiagramCodepoints(): ReadonlySet<string> {
  const codepoints = new Set<string>();
  for (let c = 0x20; c <= 0x7e; c++) {
    const ch = String.fromCharCode(c);
    if (ch === '<' || ch === '>' || ch === '&') continue;
    codepoints.add(ch);
  }
  codepoints.add('\n');
  for (const g of VOCAB_GLYPHS) codepoints.add(g);
  return codepoints;
}

// Printable ASCII 0x20-0x7E minus the three SGML-active characters `<` `>` `&`, plus `\n` and
// the diagram's vocabulary glyphs. Three consumers, elsewhere: this gate, the shipped default
// graphAnalyzer.systemPrompt, and the AUTHORING/tool-description text.
export const DIAGRAM_CODEPOINTS: ReadonlySet<string> = buildDiagramCodepoints();

export type GateDiagramResult =
  | { ok: true; diagram: string }
  | { ok: false; reason: 'GATE_REJECTED_CONTENT' | 'GATE_REJECTED_SHAPE'; gateFail: 'type' | 'codepoint' | 'size' | 'token' };

export function gateDiagram(
  raw: unknown,
  allowedLabels: ReadonlySet<string>,
  limits: { maxBytes: number; maxLines: number },
): GateDiagramResult {
  // Pass 1: type — not a string, or empty/whitespace-only.
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'type' };
  }

  // Pass 2: codepoint — every codepoint must be in DIAGRAM_CODEPOINTS.
  for (const ch of raw) {
    if (!DIAGRAM_CODEPOINTS.has(ch)) {
      return { ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'codepoint' };
    }
  }

  // Pass 3: size — maxBytes on UTF-8 byte length (not .length), maxLines = \n count + 1.
  if (Buffer.byteLength(raw, 'utf8') > limits.maxBytes) {
    return { ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'size' };
  }
  const lineCount = (raw.match(/\n/g) ?? []).length + 1;
  if (lineCount > limits.maxLines) {
    return { ok: false, reason: 'GATE_REJECTED_SHAPE', gateFail: 'size' };
  }

  // Pass 4: token — strip every vocabulary glyph, split the remainder on
  // /[^A-Za-z0-9_.:@\/-]+/, drop empties, and require every remaining token to be an EXACT,
  // case-sensitive member of allowedLabels.
  let stripped = raw;
  for (const g of VOCAB_GLYPHS) {
    stripped = stripped.split(g).join(' ');
  }
  const tokens = stripped.split(/[^A-Za-z0-9_.:@/-]+/).filter((t) => t.length > 0);
  for (const t of tokens) {
    if (!allowedLabels.has(t)) {
      return { ok: false, reason: 'GATE_REJECTED_CONTENT', gateFail: 'token' };
    }
  }

  // Success: return raw verbatim — the gate is a validator, never a transformer.
  return { ok: true, diagram: raw };
}
