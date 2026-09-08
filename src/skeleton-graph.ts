// skeleton-graph.ts (DES-174, ARCH-113, TASK-185, v26): `deriveExpectedGraph` — the ONE pure
// derivation of a script's predicted lane/slot/edge shape, consumed by BOTH the registration
// checker (DES-184, at registration a refusal is an error code) and the run-DAG layout (DES-176, at
// layout the same negative arm means "v1-contract script" and the layout falls back with a
// warning) — before v26 the checker knew nothing about phases and the layout knew nothing about the
// checker; this is the one object that lets the two never disagree.
//
// Pure text analysis over TWO independent regex scans of the SAME script — `parseWorkflowSkeleton`
// (phase/agent/workflow nodes in source order, `.dynamic`/`.parallel` from loop-body/parallel([...])
// detection) and `scanAgentCalls` (per-agent-call label/allowedTools/character-offset/group, where
// `group` covers BOTH `parallel([...])` and ternary/if-else `alt` spans). Neither carries the OTHER
// scan's join key (no character offset on SkeletonNode) — the only join available is POSITIONAL:
// walking `nodes` in source order and consuming `scan.calls` in the same order one-for-one, exactly
// as many `agent`-kind nodes as `scan.calls` entries for every fixture in the shared corpus. This is
// weaker than a true character-offset join (DES-174's own text says "by character offset, not
// label") and can drift out of lockstep only where the two scans disagree about which `agent(`
// occurrences count at all — e.g. `x.agent(` (matches `parseWorkflowSkeleton`'s CALL_RE, which has
// no word-boundary-before guard) vs an `agent()` textually inside a nested `workflow("name", …)`
// argument list (scanned by `parseWorkflowSkeleton`, EXCLUDED by `scanAgentCalls`'s
// `nestedWorkflowSpans`). Neither case appears in the shared corpus; a defensive fallback (never an
// array-index throw) is the mitigation, not a fix — a real fix is a shared join key on both scans,
// out of this task's scope.
import type { SkeletonNode, AgentCallScan } from './workflow-meta.js';

export interface ExpectedLane {
  index: number;
  title: string | null;
  dynamic: boolean;
  slots: number[];
}

export interface ExpectedSlot {
  index: number;
  lane: number;
  labels: string[];
  kind: 'single' | 'parallel' | 'alt';
  tools: Record<string, string[] | 'default'>;
}

export interface ExpectedEdge {
  from: number;
  to: number;
}

export interface ExpectedGraph {
  lanes: ExpectedLane[];
  slots: ExpectedSlot[];
  edges: ExpectedEdge[];
}

export type DeriveResult =
  | { ok: true; graph: ExpectedGraph }
  | { ok: false; rule: 'AGENT_BEFORE_PHASE' | 'UNDECIDABLE_SHAPE'; line: number; label: string | null; message: string };

type ScanCall = AgentCallScan['calls'][number];

// Positional fallback for a truncated/garbage `scan.calls` (never an array-index throw) — an
// unreachable line/empty label is the honest "we don't know", not a guess.
const FALLBACK_CALL: ScanCall = { line: 0, label: '', index: -1, allowedTools: 'absent', group: undefined };

/** T1: the literal `allowedTools` array SORTED, or `'default'` when the call carries none. */
function toolsFor(allowedTools: ScanCall['allowedTools']): string[] | 'default' {
  return allowedTools === 'absent' || allowedTools === undefined ? 'default' : [...allowedTools].sort();
}

/** `deriveExpectedGraph(nodes, scan) → {ok:true; graph} | {ok:false; rule; line; label; message}` —
 *  TOTAL, never throws for any input (a dashboard read path must not 500; a registration path must
 *  answer with a code). Rules L1/L2/S1–S4/T1/E1 (ARCH-113), adopted verbatim:
 *  (L1) one lane per `phase` node, in source order; a dynamic (runtime-computed) title is `null`,
 *  matched by POSITION, never by the truncated regex match. (L2) an `agent()` before the first
 *  `phase()` refuses `AGENT_BEFORE_PHASE`. (S1) a sequential (ungrouped) `agent()` → one `single`
 *  slot. (S2) `parallel([...])` members → one `parallel` slot. (S3) both arms of one ternary/
 *  if-else → one `alt` slot. (S4) `kind:'workflow'` nodes are TRANSPARENT — no slot, and a
 *  `parallel()` of `workflow()` calls yields no slot at all. (T1) `tools[label]` = the literal
 *  `allowedTools` (sorted) or `'default'`. (E1) one edge between every two CONSECUTIVE slots
 *  (by creation order), across lane boundaries too. */
export function deriveExpectedGraph(nodes: SkeletonNode[], scan: AgentCallScan): DeriveResult {
  const safeNodes: SkeletonNode[] = Array.isArray(nodes) ? nodes : [];
  const safeCalls: ScanCall[] = Array.isArray(scan?.calls) ? scan.calls : [];

  const lanes: ExpectedLane[] = [];
  const slots: ExpectedSlot[] = [];
  const edges: ExpectedEdge[] = [];
  let currentLaneIndex: number | undefined;
  let scanPtr = 0;
  // The group key ('parallel:<id>' | 'alt:<id>') the MOST RECENTLY created slot belongs to — a
  // following agent() sharing the SAME key extends that slot (S2/S3); anything else (including two
  // consecutive ungrouped agents, S1) starts a fresh slot.
  let openGroupKey: string | undefined;
  let lastSlotIndex: number | undefined;

  for (const node of safeNodes) {
    if (!node || typeof node !== 'object') continue;

    if (node.kind === 'phase') {
      lanes.push({ index: lanes.length, title: node.title ?? null, dynamic: false, slots: [] });
      currentLaneIndex = lanes.length - 1;
      openGroupKey = undefined;
      continue;
    }

    if (node.kind === 'workflow') {
      // S4: transparent — no slot, no lane, and (by construction below) no effect on the currently
      // open group either way: a `parallel([...])` of ONLY workflow() members opens no slot at all.
      continue;
    }

    // node.kind === 'agent'
    const call = safeCalls[scanPtr] ?? FALLBACK_CALL;
    scanPtr++;

    if (currentLaneIndex === undefined) {
      // L2: an agent() before the first phase() — the layout consumer treats this same negative arm
      // as "v1-contract script" (DES-174's own boundary); this function always returns the refusal.
      return {
        ok: false,
        rule: 'AGENT_BEFORE_PHASE',
        line: call.line,
        label: call.label || null,
        message: 'every agent must be dispatched inside a phase',
      };
    }

    const group = call.group;
    if (group === undefined && node.dynamic === true) {
      // An UNGROUPED dynamic (loop-body) call forces the frame-grouped fallback: the lane itself is
      // marked dynamic and this call contributes no static slot. A GROUPED (alt/parallel) call is
      // never treated as dynamic even when `parseWorkflowSkeleton`'s own loop-body detection also
      // fired on it (an if/else arm sits inside a DYNAMIC_OPENERS `if (` span) — `scan.calls[i].group`
      // is the more specific signal and wins.
      lanes[currentLaneIndex]!.dynamic = true;
      continue;
    }

    const label = call.label;
    const groupKey = group !== undefined ? `${group.kind}:${group.id}` : undefined;
    if (groupKey !== undefined && groupKey === openGroupKey && lastSlotIndex !== undefined) {
      // S2/S3: another member of the group already open at the top of the stack — extend it.
      const slot = slots[lastSlotIndex]!;
      slot.labels.push(label);
      slot.tools[label] = toolsFor(call.allowedTools);
      continue;
    }

    // S1/S2/S3: a fresh slot — a plain sequential call (S1) or the FIRST member of a new
    // parallel/alt group (S2/S3).
    const slotIndex = slots.length;
    slots.push({
      index: slotIndex,
      lane: currentLaneIndex,
      labels: [label],
      kind: group !== undefined ? group.kind : 'single',
      tools: { [label]: toolsFor(call.allowedTools) },
    });
    lanes[currentLaneIndex]!.slots.push(slotIndex);
    // E1: one edge between consecutive slots, across lane boundaries too.
    if (lastSlotIndex !== undefined) edges.push({ from: lastSlotIndex, to: slotIndex });
    lastSlotIndex = slotIndex;
    openGroupKey = groupKey;
  }

  return { ok: true, graph: { lanes, slots, edges } };
}
