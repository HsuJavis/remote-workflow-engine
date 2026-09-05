// TASK-138 / DES-147 (ARCH-097, ADR-023, ADR-029): checkMermaid — the pure allowlist gate over an
// author-supplied Mermaid diagram. Replaces the retired model-authored diagram gate
// (`diagram-gate.ts`'s `gateDiagram`/`VOCAB_GLYPHS`/`DIAGRAM_CODEPOINTS`, TASK-139): the diagram is
// now author-supplied at registration, not model-generated, so the check is a structural/semantic
// grammar over a real (subset of) Mermaid rather than a codepoint allowlist.
//
// Pure: no I/O, no clock, no VM, no randomness. Order, per DES-147: (1) size (2) line classifier
// (3) node table (4) edge table (5) agent node text vs AGENT_LABEL_RE (6) bidirectional label diff
// (7) value triple (8) cycles (9) subgraph title / unmatched end.

// A flat (non-discriminated) shape rather than a `{ok:true} | {ok:false; rule...}` union: callers
// commonly assert `result.ok` and `result.rule` in separate statements (no `if` narrowing between
// them), which a strict discriminated union would reject at the type level for no runtime benefit
// — `rule`/`line`/etc. are simply absent (`undefined`) on an `ok:true` result.
export interface CheckMermaidResult {
  ok: boolean;
  rule?: string;
  line?: number;
  onlyInScript?: string[];
  onlyInDiagram?: string[];
}

interface NodeRecord {
  id: string;
  shape: 'stadium' | 'rectangle' | 'trapezoid' | 'diamond' | 'aggregation';
  text: string;
  line: number;
}

interface EdgeRecord {
  from: string;
  to: string;
  arrow: '-->' | '<-->' | '-.->';
  label?: string;
  line: number;
}

/** Agent (stadium) node shape: `id(["text"])` — the only shape that participates in the
 *  script/diagram label diff and the value-triple check. */
const STADIUM_RE = /^(\w+)\(\["(.*)"\]\)$/;
/** Black-box rectangle: `id["free text"]` — excluded from the diff, text is unconstrained. */
const RECTANGLE_RE = /^(\w+)\["(.*)"\]$/;
/** Trapezoid: `id[/"text"/]` — used for non-agent nodes (e.g. a trigger/output). */
const TRAPEZOID_RE = /^(\w+)\[\/"(.*)"\/\]$/;
/** Diamond (conditional) node: `id{"text"}`. */
const DIAMOND_RE = /^(\w+)\{"(.*)"\}$/;
/** Aggregation (non-agent) node: `id{{"text"}}` — checked BEFORE `DIAMOND_RE` in the classifier
 *  since a bare `{"…"}` regex would otherwise stop one brace short and mis-parse the wrapping pair. */
const AGGREGATION_RE = /^(\w+)\{\{"(.*)"\}\}$/;
export const HEADER_RE = /^(graph|flowchart)\s+\S+$/;
const SUBGRAPH_RE = /^subgraph\s+"([^"]*)"$/;
const ARROW_TOKEN_RE = /<-->|-\.->|-->/;
const EDGE_RE = /^(\w+)\s*(<-->|-\.->|-->)\s*(?:\|([^|]*)\|\s*)?(.+)$/;
/** DES-143's own label-format rule, reused here: the diagram's agent (stadium) node label —
 *  everything before the first `<br/>` — must match the same grammar `scanAgentCalls` enforces on
 *  the script side, so a diagram label that could never legally appear in the script is refused at
 *  the diagram gate rather than surfacing later as a silent DIAGRAM_SCRIPT_MISMATCH. */
export const AGENT_LABEL_RE = /^[A-Za-z_][\w-]*$/;

/** The five node shapes `checkMermaid` recognizes, each with its token pair and role (ARCH-097's
 *  closed grammar; DES-147's single declaration — `authoring-guide.ts` (TASK-151) interpolates
 *  this rather than re-typing the grammar). */
export const SHAPES = [
  { name: 'trapezoid', open: '[/"', close: '"/]', role: 'trigger / output' },
  { name: 'stadium', open: '(["', close: '"])', role: 'agent node — participates in the label diff + value triple' },
  { name: 'diamond', open: '{"', close: '"}', role: 'conditional' },
  { name: 'aggregation', open: '{{"', close: '"}}', role: 'non-agent aggregation' },
  { name: 'rectangle', open: '["', close: '"]', role: "nested workflow() black box — free text, excluded from the diff" },
] as const;

/** The three edge forms `checkMermaid` recognizes (DES-147's single declaration). */
export const EDGE_FORMS = [
  { token: '-->', role: 'directed edge — participates in cycle detection' },
  { token: '-.->', role: 'directed dashed edge (e.g. a skipped path) — participates in cycle detection' },
  { token: '<-->', role: 'bidirectional edge (e.g. a debate) — EXCLUDED from cycle detection' },
] as const;

/** `120s` / `120000` / `120000ms` — a bare digit string means milliseconds already. */
function parseTimeout(v: string): number | null {
  const m = /^(\d+)(ms|s)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 's' ? n * 1000 : n;
}

function err(rule: string, extra?: Omit<CheckMermaidResult, 'ok' | 'rule'>): CheckMermaidResult {
  return { ok: false, rule, ...extra };
}

export function checkMermaid(
  src: string,
  scriptLabels: string[],
  agentDefaults: Record<string, { model?: string; effort?: string; timeoutMs?: number }>,
  limits: { maxBytes: number; maxLines: number },
): CheckMermaidResult {
  // (1) normalize + size — checked before anything else touches the text.
  const normalized = src.replace(/\r\n/g, '\n');
  if (Buffer.byteLength(normalized, 'utf8') > limits.maxBytes) return err('SIZE');
  const rawLines = normalized.split('\n');
  if (rawLines.length > limits.maxLines) return err('SIZE');

  // (2) line classifier + (3) node table + (9, partial) subgraph/end structural bookkeeping.
  const nodes = new Map<string, NodeRecord>();
  const edgeLines: Array<{ text: string; line: number }> = [];
  let classifyErr: CheckMermaidResult | null = null;
  let openSubgraphs = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!.trim();
    const lineNo = i + 1;
    if (line === '' || line.startsWith('%%')) continue;
    if (i === 0 && HEADER_RE.test(line)) continue; // header

    const subMatch = SUBGRAPH_RE.exec(line);
    if (subMatch) {
      openSubgraphs++;
      if (subMatch[1] === '') { classifyErr = err('SUBGRAPH_TITLE', { line: lineNo }); break; }
      continue;
    }
    if (line === 'end') {
      if (openSubgraphs === 0) { classifyErr = err('MERMAID_INVALID', { line: lineNo }); break; }
      openSubgraphs--;
      continue;
    }
    if (ARROW_TOKEN_RE.test(line)) {
      edgeLines.push({ text: line, line: lineNo });
      continue;
    }
    const stadium = STADIUM_RE.exec(line);
    const trapezoid = !stadium ? TRAPEZOID_RE.exec(line) : null;
    const aggregation = !stadium && !trapezoid ? AGGREGATION_RE.exec(line) : null;
    const diamond = !stadium && !trapezoid && !aggregation ? DIAMOND_RE.exec(line) : null;
    const rectangle = !stadium && !trapezoid && !aggregation && !diamond ? RECTANGLE_RE.exec(line) : null;
    const match = stadium ?? trapezoid ?? aggregation ?? diamond ?? rectangle;
    if (match) {
      const [, id, text] = match;
      if (nodes.has(id!)) { classifyErr = err('DUPLICATE_NODE', { line: lineNo }); break; }
      const shape: NodeRecord['shape'] = stadium
        ? 'stadium'
        : trapezoid
          ? 'trapezoid'
          : aggregation
            ? 'aggregation'
            : diamond
              ? 'diamond'
              : 'rectangle';
      nodes.set(id!, { id: id!, shape, text: text!, line: lineNo });
      continue;
    }
    // Unrecognized shape — not exercised by this task's test scope; MERMAID_INVALID is the
    // documented catch-all (DES-147 step 2).
    classifyErr = err('MERMAID_INVALID', { line: lineNo });
    break;
  }
  if (classifyErr) return classifyErr;

  // (4) edge table: '&' collapsed fan-out, then undeclared-id membership.
  const edges: EdgeRecord[] = [];
  for (const { text, line } of edgeLines) {
    const m = EDGE_RE.exec(text);
    if (!m) return err('MERMAID_INVALID', { line });
    const [, from, arrow, label, rest] = m;
    if (rest!.includes('&')) return err('COLLAPSED_EDGE', { line });
    const to = rest!.trim();
    if (!nodes.has(from!)) return err('UNDECLARED_NODE', { line });
    if (!nodes.has(to)) return err('UNDECLARED_NODE', { line });
    edges.push({ from: from!, to, arrow: arrow as EdgeRecord['arrow'], label, line });
  }

  // (5) agent (stadium) node text vs AGENT_LABEL_RE — the label portion (before the first
  // `<br/>`) must match the same grammar `scanAgentCalls` enforces on the script side.
  for (const n of nodes.values()) {
    if (n.shape !== 'stadium') continue;
    const label = n.text.split('<br/>')[0]!;
    if (!AGENT_LABEL_RE.test(label)) return err('AGENT_LABEL_FORMAT', { line: n.line });
  }

  // (6) bidirectional label diff — agent (stadium) node labels vs the script's own agent labels.
  // Rectangle/trapezoid nodes are free text, excluded (DES-147 boundary).
  const diagramLabels = new Set<string>();
  const labelToNode = new Map<string, NodeRecord>();
  for (const n of nodes.values()) {
    if (n.shape !== 'stadium') continue;
    const label = n.text.split('<br/>')[0]!;
    diagramLabels.add(label);
    labelToNode.set(label, n);
  }
  const scriptSet = new Set(scriptLabels);
  const onlyInScript = [...scriptSet].filter((l) => !diagramLabels.has(l));
  const onlyInDiagram = [...diagramLabels].filter((l) => !scriptSet.has(l));
  if (onlyInScript.length > 0 || onlyInDiagram.length > 0) {
    return err('DIAGRAM_SCRIPT_MISMATCH', { onlyInScript, onlyInDiagram });
  }

  // (7) value triple: `<label><br/><model> · <effort> · <timeout>` vs the contract default.
  for (const [label, node] of labelToNode) {
    const parts = node.text.split('<br/>');
    if (parts.length < 2) continue; // no meta on this node — nothing to compare
    const def = agentDefaults[label];
    if (!def) continue;
    const triple = parts[1]!.split(' · ').map((s) => s.trim());
    if (triple.length !== 3) return err('MERMAID_INVALID', { line: node.line });
    const [model, effort, timeoutStr] = triple;
    const timeoutMs = parseTimeout(timeoutStr!);
    if (
      (def.model !== undefined && model !== def.model) ||
      (def.effort !== undefined && effort !== def.effort) ||
      (def.timeoutMs !== undefined && timeoutMs !== def.timeoutMs)
    ) {
      return err('VALUE_MISMATCH', { line: node.line });
    }
  }

  // (8) cycles: directed graph over `-->`/`-.->` only (`<-->` excluded); every edge inside a
  // non-trivial SCC (or a self-loop) must carry `|label|`.
  const directed = edges.filter((e) => e.arrow !== '<-->');
  const cycleErr = checkCycleLabels(directed);
  if (cycleErr) return cycleErr;

  return { ok: true };
}

/** Tarjan's SCC over the directed (non-`<-->`) edges; every edge whose endpoints share a
 *  non-trivial SCC (size > 1, or a size-1 SCC with a self-loop) must carry `|label|`. */
function checkCycleLabels(edges: EdgeRecord[]): CheckMermaidResult | null {
  const adj = new Map<string, EdgeRecord[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e);
  }
  const nodeIds = new Set<string>();
  for (const e of edges) { nodeIds.add(e.from); nodeIds.add(e.to); }

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccOf = new Map<string, number>();
  const sccs: string[][] = [];

  function strongconnect(v: string): void {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const e of adj.get(v) ?? []) {
      const w = e.to;
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }
    if (lowlink.get(v) === indices.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      const sccId = sccs.length;
      sccs.push(comp);
      for (const n of comp) sccOf.set(n, sccId);
    }
  }
  for (const v of nodeIds) if (!indices.has(v)) strongconnect(v);

  for (const e of edges) {
    const sameScc = sccOf.get(e.from) === sccOf.get(e.to);
    const selfLoop = e.from === e.to;
    const nonTrivial = selfLoop || (sameScc && sccs[sccOf.get(e.from)!]!.length > 1);
    if (nonTrivial && !e.label) return { ok: false, rule: 'LOOP_LABEL', line: e.line };
  }
  return null;
}
