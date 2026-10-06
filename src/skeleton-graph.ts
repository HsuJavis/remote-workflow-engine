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
  // issue #155 B3: every ungrouped dynamic (loop/switch-body) agent() call landing in this lane —
  // no static slot (S1-S4 don't apply), but still checkable for LANE placement (and, when the call
  // carries a literal allowedTools, for TOOLS too). Absent/undefined when the lane has none.
  dynamicLabels?: Array<{ label: string; tools?: string[] }>;
}

export interface ExpectedSlot {
  index: number;
  lane: number;
  labels: string[];
  kind: 'single' | 'parallel' | 'alt';
  tools: Record<string, string[] | 'default'>;
  // issue #155 B1: shared by every arm-slot of ONE if/else (`alt`) group whose arms were split
  // across different lanes (each arm opens its own phase()) — lets checkEdges refuse a direct
  // arm-to-arm edge even though the arms are two different slots in two different lanes. Absent
  // for every other slot kind, and for a same-lane alt group (still one merged slot, as before).
  altGroup?: number;
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
  // v26 (M-5 send-back repair): `'UNDECIDABLE_SHAPE'` deleted from this union — it had no producer
  // anywhere in this function (or anywhere else); ADR-039's narrowing cases are already refused via
  // the existing `SCAN_VIOLATION` (workflow-catalog.ts, from `scanAgentCalls`'s own violations),
  // a step BEFORE this function ever runs. See errors.ts's matching deletion for the full reasoning.
  | { ok: false; rule: 'AGENT_BEFORE_PHASE'; line: number; label: string | null; message: string };

type ScanCall = AgentCallScan['calls'][number];

// Positional fallback for a truncated/garbage `scan.calls` (never an array-index throw) — an
// unreachable line/empty label is the honest "we don't know", not a guess.
const FALLBACK_CALL: ScanCall = { line: 0, label: '', index: -1, allowedTools: 'absent', group: undefined };

/** T1: the literal `allowedTools` array SORTED, or `'default'` when the call carries none. */
function toolsFor(allowedTools: ScanCall['allowedTools']): string[] | 'default' {
  return allowedTools === 'absent' || allowedTools === undefined ? 'default' : [...allowedTools].sort();
}

/** issue #155 B3/TOOLS-DOC: the literal `allowedTools` array SORTED, or `undefined` when the call
 *  carries none OR a non-literal (variable) one — unlike `toolsFor`, never `'default'`, since
 *  `ExpectedLane.dynamicLabels[].tools` must distinguish "nothing to check" (undefined, omit the
 *  field) from "default" (`toolsFor`'s sentinel is for a STATIC slot's `tools` map, not this). */
function literalToolsFor(allowedTools: ScanCall['allowedTools']): string[] | undefined {
  return allowedTools === 'absent' || allowedTools === undefined ? undefined : [...allowedTools].sort();
}

/** `deriveExpectedGraph(nodes, scan, contract?) → {ok:true; graph} | {ok:false; rule; line; label;
 *  message}` — TOTAL, never throws for any input (a dashboard read path must not 500; a
 *  registration path must answer with a code). Rules L1/L2/S1–S4/T1/E1 (ARCH-113), adopted
 *  verbatim: (L1) one lane per `phase` node, in source order; a dynamic (runtime-computed) title is
 *  `null`, matched by POSITION, never by the truncated regex match. (L2) an `agent()` before the
 *  first `phase()` refuses `AGENT_BEFORE_PHASE` — UNLESS `contract:'v1'` (below). (S1) a sequential
 *  (ungrouped) `agent()` → one `single` slot. (S2) `parallel([...])` members → one `parallel` slot.
 *  (S3) both arms of one ternary/if-else → one `alt` slot. (S4) `kind:'workflow'` nodes are
 *  TRANSPARENT — no slot, and a `parallel()` of `workflow()` calls yields no slot at all. (T1)
 *  `tools[label]` = the literal `allowedTools` (sorted) or `'default'`. (E1) one edge between every
 *  two CONSECUTIVE slots (by creation order), across lane boundaries too.
 *
 *  `contract` (v26 M-3 send-back repair, INV-V26-3, ARCH-113 "one derivation, two consumers"):
 *  `'v2'` (default) is the REGISTRATION gate's contract — L2 refuses a phase-less script, same as
 *  always. `'v1'` is the READ path's own permissive half of DES-174's stated split (server.ts's DAG
 *  layout, for a pre-v26 script L2 would refuse at registration but which is perfectly legal to run
 *  and to draw, REQ-124): every `agent()` dispatched before the first REAL `phase()` lands in ONE
 *  lazily-created implicit lane (title `null`, never `dynamic`) instead of refusing — replaces the
 *  retired `v1FallbackGraph`, which built that same implicit lane from `scan.calls` directly and
 *  NEVER read `call.group`, so a v1 script's `parallel([a,b,c])` rendered three CHAINED `single`
 *  slots instead of one `parallel` slot. `contract:'v1'` reuses this function's own S1–S4/T1/E1
 *  logic unchanged past the lane-selection point, so `call.group` is honoured exactly as it is for
 *  a `'v2'` script — one derivation, no second shape-decider. */
export function deriveExpectedGraph(nodes: SkeletonNode[], scan: AgentCallScan, contract: 'v1' | 'v2' = 'v2'): DeriveResult {
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

  // issue #155 B1: an `alt` group whose arms land in DIFFERENT lanes (each arm opens its own
  // phase()) cannot be represented as one slot — `ExpectedSlot.lane` is a single scalar. Each arm
  // gets its OWN slot (tagged `altGroup`), but the group's EDGES still need to fan out from the one
  // anchor slot that preceded the whole branch to EVERY arm, and from EVERY arm to whatever slot
  // follows the branch — never arm-to-arm. `altGroupTotal` (a prepass over every call, regardless of
  // lane) is how we know an arm is the group's LAST one, so the group can "close" and hand off its
  // accumulated arm list to whichever slot gets created next.
  const altGroupTotal = new Map<string, number>();
  for (const c of safeCalls) {
    if (c.group?.kind === 'alt') {
      const k = `alt:${c.group.id}`;
      altGroupTotal.set(k, (altGroupTotal.get(k) ?? 0) + 1);
    }
  }
  const altGroupSeen = new Map<string, number>();
  // Every anchor slot this group's arms fan OUT from — usually one (`lastSlotIndex` at the time the
  // group's first arm appeared), but when this group starts IMMEDIATELY after another split alt
  // group just closed (two consecutive if/else branches, each arm its own phase()), its anchors are
  // THAT group's own arm slots: every outcome of branch 1 fans into every arm of branch 2, not just
  // the textually-last one.
  const altGroupAnchor = new Map<string, number[]>();
  const altGroupArms = new Map<string, number[]>();
  // Set once a split alt group has seen its LAST arm — consumed (and cleared) by the NEXT slot this
  // loop creates, which gets edges from every one of that group's arms instead of just `lastSlotIndex`.
  let pendingAltArms: number[] | undefined;

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
      if (contract === 'v1') {
        // v1-contract read path (M-3 repair): lazily open the ONE implicit lane every pre-phase
        // agent() lands in — created here, on first need, rather than unconditionally up front, so
        // a script that DOES open with a real phase() still gets lane 0 from L1 normally.
        lanes.push({ index: lanes.length, title: null, dynamic: false, slots: [] });
        currentLaneIndex = lanes.length - 1;
      } else {
        // L2: an agent() before the first phase() — the layout consumer treats this same negative
        // arm as "v1-contract script" (DES-174's own boundary) and re-derives with `contract:'v1'`.
        return {
          ok: false,
          rule: 'AGENT_BEFORE_PHASE',
          line: call.line,
          label: call.label || null,
          message: 'every agent must be dispatched inside a phase',
        };
      }
    }

    const group = call.group;
    if (group === undefined && node.dynamic === true) {
      // An UNGROUPED dynamic (loop-body) call forces the frame-grouped fallback: the lane itself is
      // marked dynamic and this call contributes no static slot. A GROUPED (alt/parallel) call is
      // never treated as dynamic even when `parseWorkflowSkeleton`'s own loop-body detection also
      // fired on it (an if/else arm sits inside a DYNAMIC_OPENERS `if (` span) — `scan.calls[i].group`
      // is the more specific signal and wins.
      const lane = lanes[currentLaneIndex]!;
      lane.dynamic = true;
      // issue #155 B3/TOOLS-DOC: still record the label (and, when literal, the allowedTools) so
      // checkLanes/checkTools can keep checking PLACEMENT (and, when literal, TOOLS) for this call
      // even though it gets no static slot — rules 3(conditionally)/4 remain exempt, unchanged.
      const tools = literalToolsFor(call.allowedTools);
      const entry: { label: string; tools?: string[] } = { label: call.label };
      if (tools !== undefined) entry.tools = tools;
      (lane.dynamicLabels ??= []).push(entry);
      continue;
    }

    const label = call.label;
    const groupKey = group !== undefined ? `${group.kind}:${group.id}` : undefined;
    if (groupKey !== undefined && groupKey === openGroupKey && lastSlotIndex !== undefined && slots[lastSlotIndex]!.lane === currentLaneIndex) {
      // S2/S3: another member of the group already open, in the SAME lane (no intervening phase())
      // — extend that one slot, exactly as before this fix.
      const slot = slots[lastSlotIndex]!;
      slot.labels.push(label);
      slot.tools[label] = toolsFor(call.allowedTools);
      if (group!.kind === 'alt') altGroupSeen.set(groupKey, (altGroupSeen.get(groupKey) ?? 0) + 1);
      continue;
    }

    // S1/S2/S3: a fresh slot — a plain sequential call (S1), the FIRST member of a new
    // parallel/alt group (S2/S3), or (B1) a LATER arm of an alt group whose previous arm sits in a
    // DIFFERENT lane (an intervening phase() means it can't be merged into that arm's slot).
    const slotIndex = slots.length;
    const isAltArm = group !== undefined && group.kind === 'alt';
    const altKey = isAltArm ? `alt:${group!.id}` : undefined;
    const isAltContinuation = altKey !== undefined && altGroupArms.has(altKey);
    slots.push({
      index: slotIndex,
      lane: currentLaneIndex,
      labels: [label],
      kind: group !== undefined ? group.kind : 'single',
      tools: { [label]: toolsFor(call.allowedTools) },
      ...(altKey !== undefined ? { altGroup: group!.id } : {}),
    });
    lanes[currentLaneIndex]!.slots.push(slotIndex);

    if (altKey !== undefined) {
      // B1: fan OUT from this group's anchor slot(s) to every arm — never arm-to-arm — and track
      // the arm so the slot that eventually follows the branch can fan IN from every one of them.
      if (isAltContinuation) {
        for (const anchor of altGroupAnchor.get(altKey) ?? []) edges.push({ from: anchor, to: slotIndex });
        altGroupArms.get(altKey)!.push(slotIndex);
      } else {
        // The anchor is normally just `lastSlotIndex`; when a split alt group JUST closed right
        // before this one opened, `pendingAltArms` holds ITS arms — every one of them is an anchor
        // for this group too (two consecutive branches fan fully into each other, not through only
        // the textually-last arm of the first).
        const anchors = pendingAltArms ?? (lastSlotIndex !== undefined ? [lastSlotIndex] : []);
        altGroupAnchor.set(altKey, anchors);
        altGroupArms.set(altKey, [slotIndex]);
        for (const anchor of anchors) edges.push({ from: anchor, to: slotIndex });
        pendingAltArms = undefined; // consumed — this group now owns the "what's pending" slot
      }
      altGroupSeen.set(altKey, (altGroupSeen.get(altKey) ?? 0) + 1);
      if (altGroupSeen.get(altKey) === altGroupTotal.get(altKey)) pendingAltArms = altGroupArms.get(altKey);
    } else if (pendingAltArms !== undefined) {
      // This slot is whatever follows a NOW-COMPLETE split alt group — fan IN from every arm.
      for (const armSlot of pendingAltArms) edges.push({ from: armSlot, to: slotIndex });
      pendingAltArms = undefined;
    } else {
      // E1 (unchanged): one edge between consecutive slots, across lane boundaries too.
      if (lastSlotIndex !== undefined) edges.push({ from: lastSlotIndex, to: slotIndex });
    }
    lastSlotIndex = slotIndex;
    openGroupKey = groupKey;
  }

  return { ok: true, graph: { lanes, slots, edges } };
}

