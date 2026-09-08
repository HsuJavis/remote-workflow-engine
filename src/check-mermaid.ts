// TASK-138 / DES-147 (ARCH-097, ADR-023, ADR-029): checkMermaid — the pure allowlist gate over an
// author-supplied Mermaid diagram. Replaces the retired model-authored diagram gate
// (`diagram-gate.ts`'s `gateDiagram`/`VOCAB_GLYPHS`/`DIAGRAM_CODEPOINTS`, TASK-139): the diagram is
// now author-supplied at registration, not model-generated, so the check is a structural/semantic
// grammar over a real (subset of) Mermaid rather than a codepoint allowlist.
//
// Pure: no I/O, no clock, no VM, no randomness. Order, per DES-147: (1) size (2) line classifier
// (3) node table (4) edge table (5) agent node text vs AGENT_LABEL_RE (6) bidirectional label diff
// (7) value triple (8) cycles (9) subgraph title / unmatched end.

// v26 (DES-184, ARCH-119, ADR-043, TASK-189): local structural copy of ARCH-113's predicted-graph
// shape (lane/slot/edge) — NOT an import of its canonical TASK-185 home, which UT-115's guard test
// (ADR-022) closes to an exactly-four-file allowlist this file is not on; a value/type import would
// put the forbidden word in this file's own source text regardless of import kind. Same convention
// `tests/fixtures/expected-graph-fixtures.ts` and `dashboard.ts` already use for the same reason.
interface ExpectedLane {
  index: number;
  title: string | null;
  dynamic: boolean;
  slots: number[];
}
interface ExpectedSlot {
  index: number;
  lane: number;
  labels: string[];
  kind: 'single' | 'parallel' | 'alt';
  tools: Record<string, string[] | 'default'>;
}
interface ExpectedGraph {
  lanes: ExpectedLane[];
  slots: ExpectedSlot[];
  edges: Array<{ from: number; to: number }>;
}

// Every distinct `rule` literal this file can emit — v1 (unchanged) plus the four v26 v2 rules.
// `RULE_CODE` (workflow-catalog.ts) is `Record<Rule, ErrorCode>`, so a new rule added here without
// a matching RULE_CODE entry is a compile error there (the DES's "never exhaustiveness check").
export type Rule =
  | 'SIZE' | 'SUBGRAPH_TITLE' | 'MERMAID_INVALID' | 'DUPLICATE_NODE' | 'COLLAPSED_EDGE'
  | 'UNDECLARED_NODE' | 'AGENT_LABEL_FORMAT' | 'DIAGRAM_SCRIPT_MISMATCH' | 'VALUE_MISMATCH'
  | 'LOOP_LABEL' | 'DIAGRAM_DIRECTION' | 'LANE_MISMATCH' | 'TOOLS_MISMATCH' | 'EDGE_MISMATCH';

// A flat (non-discriminated) shape rather than a `{ok:true} | {ok:false; rule...}` union: callers
// commonly assert `result.ok` and `result.rule` in separate statements (no `if` narrowing between
// them), which a strict discriminated union would reject at the type level for no runtime benefit
// — `rule`/`line`/etc. are simply absent (`undefined`) on an `ok:true` result.
export interface CheckMermaidResult {
  ok: boolean;
  rule?: Rule;
  line?: number;
  onlyInScript?: string[];
  onlyInDiagram?: string[];
  // v26 (DES-184): every v2 refusal carries the expected lane/slot/edge STRUCTURE as data — never
  // corrected Mermaid (REQ-111: handing back passing text would defeat the point of authoring it).
  expected?: unknown;
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

/** v26 (DES-184): one TOP-LEVEL `subgraph` block, tracked only for the `v2` lane checks — `nodeIds`
 *  collects every node (nested subgraphs included, by design: only the outermost lane matters here)
 *  declared while this block is open. */
interface SubgraphBlock {
  title: string;
  line: number;
  nodeIds: Set<string>;
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

function err(rule: Rule, extra?: Omit<CheckMermaidResult, 'ok' | 'rule'>): CheckMermaidResult {
  return { ok: false, rule, ...extra };
}

export function checkMermaid(
  src: string,
  scriptLabels: string[],
  agentDefaults: Record<string, { model?: string; effort?: string; timeoutMs?: number }>,
  limits: { maxBytes: number; maxLines: number },
  // v26 (DES-184, ARCH-119, TASK-189): steps (10)-(13) below run ONLY when present — a v1 caller
  // (every pre-v26 call site) passes nothing and gets exactly the pre-v26 checks.
  v2?: { expected: ExpectedGraph },
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
  // v26 (DES-184): TOP-LEVEL subgraph blocks, in source order — the `v2` lane checks' only input.
  const subgraphStack: SubgraphBlock[] = [];
  const subgraphBlocks: SubgraphBlock[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!.trim();
    const lineNo = i + 1;
    if (line === '' || line.startsWith('%%')) continue;
    if (i === 0 && HEADER_RE.test(line)) continue; // header

    const subMatch = SUBGRAPH_RE.exec(line);
    if (subMatch) {
      openSubgraphs++;
      if (subMatch[1] === '') { classifyErr = err('SUBGRAPH_TITLE', { line: lineNo }); break; }
      subgraphStack.push({ title: subMatch[1]!, line: lineNo, nodeIds: new Set() });
      continue;
    }
    if (line === 'end') {
      if (openSubgraphs === 0) { classifyErr = err('MERMAID_INVALID', { line: lineNo }); break; }
      openSubgraphs--;
      const closed = subgraphStack.pop();
      if (closed && subgraphStack.length === 0) subgraphBlocks.push(closed);
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
      if (subgraphStack.length > 0) subgraphStack[0]!.nodeIds.add(id!);
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
  // v26 integration (DES-174's own "duplicate labels — two distinct slots joined by offset, not
  // label" fixture): ONE label may legitimately appear in several lanes — the guide's canonical
  // `draft, critique, revise` example dispatches the SAME `writer` in two phases, so its diagram
  // declares two stadium nodes carrying that label. `labelToNode` (latest-wins) is fine for the v1
  // set/triple checks below, which are per-LABEL; the v2 lane/tools/edge checks are per-SLOT and
  // must resolve the node that sits in THAT slot's lane, which needs every node for the label.
  const labelToNodes = new Map<string, NodeRecord[]>();
  for (const n of nodes.values()) {
    if (n.shape !== 'stadium') continue;
    const label = n.text.split('<br/>')[0]!;
    diagramLabels.add(label);
    labelToNode.set(label, n);
    const arr = labelToNodes.get(label) ?? [];
    arr.push(n);
    labelToNodes.set(label, arr);
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

  // (10)-(13) v26 (DES-184): only when the caller supplies `v2` — the script's derived expected
  // lane/slot/edge shape. Order pinned by DES-184's boundary: direction FIRST (a TD diagram's
  // lanes are meaningless, so a LANE_MISMATCH would send the author to the wrong fix).
  if (v2) {
    const headerLine = rawLines[0]?.trim() ?? '';
    const directionErr = checkDirection(headerLine);
    if (directionErr) return directionErr;

    const laneErr = checkLanes(v2.expected, subgraphBlocks, labelToNodes);
    if (laneErr) return laneErr;

    const toolsErr = checkTools(v2.expected, subgraphBlocks, labelToNodes);
    if (toolsErr) return toolsErr;

    const edgeErr = checkEdges(v2.expected, nodes, edges, subgraphBlocks, labelToNodes);
    if (edgeErr) return edgeErr;
  }

  return { ok: true };
}

/** (10) DIAGRAM_DIRECTION: the header's direction token must be exactly `LR` (a trailing `;`, as
 *  `synthesizeMermaid` emits on pre-v26 `graph TD;` diagrams, is tolerated). */
function checkDirection(headerLine: string): CheckMermaidResult | null {
  const m = /^(graph|flowchart)\s+(\S+?);?$/.exec(headerLine);
  if (m?.[2] !== 'LR') {
    return err('DIAGRAM_DIRECTION', { line: 1, expected: { direction: 'LR' } });
  }
  return null;
}

/** (11) LANE_MISMATCH: the count/order/title of top-level `subgraph` blocks vs `expected.lanes`,
 *  then — for every expected slot — that its labelled stadium node(s) are actually declared inside
 *  the subgraph at `slot.lane`'s position. */
/** v26 integration: the stadium node carrying `label` that is declared INSIDE `block` — the only
 *  correct resolution once one label may have several nodes (see `labelToNodes` above). */
function nodeInLane(labelNodes: NodeRecord[] | undefined, block: SubgraphBlock | undefined): NodeRecord | undefined {
  if (labelNodes === undefined || block === undefined) return undefined;
  return labelNodes.find((n) => block.nodeIds.has(n.id));
}

function checkLanes(expected: ExpectedGraph, subgraphBlocks: SubgraphBlock[], labelToNodes: Map<string, NodeRecord[]>): CheckMermaidResult | null {
  if (subgraphBlocks.length !== expected.lanes.length) {
    return err('LANE_MISMATCH', { line: 1, expected: expected.lanes });
  }
  for (const lane of expected.lanes) {
    const block = subgraphBlocks[lane.index]!;
    // A `null` title (a dynamic phase() title) accepts any non-empty title at that position —
    // SUBGRAPH_TITLE (step 2) already refused an empty one, so `block.title` is never ''.
    if (lane.title !== null && block.title !== lane.title) {
      return err('LANE_MISMATCH', { line: block.line, expected: lane });
    }
  }
  for (const slot of expected.slots) {
    for (const label of slot.labels) {
      const block = subgraphBlocks[slot.lane];
      if (nodeInLane(labelToNodes.get(label), block) === undefined) {
        return err('LANE_MISMATCH', { line: labelToNodes.get(label)?.[0]?.line ?? 1, expected: slot });
      }
    }
  }
  return null;
}

/** (12) TOOLS_MISMATCH: the stadium's third `<br/>` segment vs `slot.tools[label]` — `'default'`
 *  is SKIPPED ENTIRELY (never read, never partially compared). */
function checkTools(expected: ExpectedGraph, subgraphBlocks: SubgraphBlock[], labelToNodes: Map<string, NodeRecord[]>): CheckMermaidResult | null {
  for (const slot of expected.slots) {
    for (const label of slot.labels) {
      const toolsExpected = slot.tools[label];
      if (toolsExpected === undefined || toolsExpected === 'default') continue;
      // The node in THIS slot's lane — the same label in another lane is another slot's business.
      const node = nodeInLane(labelToNodes.get(label), subgraphBlocks[slot.lane]);
      const expectedStr = toolsExpected.length === 0 ? 'tools: none' : `tools: ${[...toolsExpected].sort().join(', ')}`;
      const actual = node?.text.split('<br/>')[2]?.trim();
      if (actual !== expectedStr) {
        return err('TOOLS_MISMATCH', { line: node?.line ?? 1, expected: { label, tools: toolsExpected } });
      }
    }
  }
  return null;
}

/** (13) EDGE_MISMATCH: (a) every expected consecutive-slot edge is realised by a path from one of
 *  its `from` slot's nodes to one of its `to` slot's nodes through non-agent intermediates only;
 *  (b) no DIRECT agent→agent edge links non-consecutive slots unless it carries `|label|`; (c) no
 *  two members of the SAME `parallel`/`alt` slot are directly edge-connected. */
function checkEdges(
  expected: ExpectedGraph,
  nodes: Map<string, NodeRecord>,
  edges: EdgeRecord[],
  subgraphBlocks: SubgraphBlock[],
  labelToNodes: Map<string, NodeRecord[]>,
): CheckMermaidResult | null {
  // Every id resolution below is per-SLOT (the node in that slot's own lane), so a label reused in
  // two lanes contributes a DIFFERENT node to each of its two slots.
  const idsForSlot = (slot: ExpectedSlot): string[] =>
    slot.labels
      .map((l) => nodeInLane(labelToNodes.get(l), subgraphBlocks[slot.lane])?.id)
      .filter((id): id is string => id !== undefined);
  const adj = new Map<string, string[]>();
  const addEdge = (from: string, to: string) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  };
  for (const e of edges) {
    addEdge(e.from, e.to);
    if (e.arrow === '<-->') addEdge(e.to, e.from);
  }

  const slotById = new Map<number, ExpectedSlot>(expected.slots.map((s) => [s.index, s]));
  const nodeToSlot = new Map<string, number>();
  for (const slot of expected.slots) {
    for (const id of idsForSlot(slot)) nodeToSlot.set(id, slot.index);
  }

  // (a) reachability through non-agent intermediates.
  for (const ee of expected.edges) {
    const fromSlot = slotById.get(ee.from);
    const toSlot = slotById.get(ee.to);
    if (!fromSlot || !toSlot) continue;
    const targets = new Set(idsForSlot(toSlot));
    const starts = idsForSlot(fromSlot);
    const reached = starts.some((startId) => pathThroughNonAgents(startId, targets, adj, nodes));
    if (!reached) return err('EDGE_MISMATCH', { line: 1, expected: ee });
  }

  // (b) a direct agent→agent edge linking non-consecutive slots needs a `|label|`.
  for (const e of edges) {
    if (nodes.get(e.from)?.shape !== 'stadium' || nodes.get(e.to)?.shape !== 'stadium') continue;
    const fromSlot = nodeToSlot.get(e.from);
    const toSlot = nodeToSlot.get(e.to);
    if (fromSlot === undefined || toSlot === undefined) continue;
    if (Math.abs(fromSlot - toSlot) !== 1 && !e.label) {
      return err('EDGE_MISMATCH', { line: e.line, expected: { from: fromSlot, to: toSlot } });
    }
  }

  // (c) no edges among members of the SAME parallel/alt slot.
  for (const slot of expected.slots) {
    if (slot.kind === 'single' || slot.labels.length < 2) continue;
    const ids = new Set(idsForSlot(slot));
    for (const e of edges) {
      if (ids.has(e.from) && ids.has(e.to)) return err('EDGE_MISMATCH', { line: e.line, expected: slot });
    }
  }

  return null;
}

/** BFS from `startId`: reaches a member of `targets` while every intermediate hop (never `startId`
 *  itself, never a `targets` member) is a non-agent (non-stadium) shape. */
function pathThroughNonAgents(startId: string, targets: Set<string>, adj: Map<string, string[]>, nodes: Map<string, NodeRecord>): boolean {
  if (targets.has(startId)) return true;
  const visited = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const to of adj.get(cur) ?? []) {
      if (targets.has(to)) return true;
      if (nodes.get(to)?.shape === 'stadium') continue; // only non-agent intermediates allowed
      if (!visited.has(to)) { visited.add(to); queue.push(to); }
    }
  }
  return false;
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
