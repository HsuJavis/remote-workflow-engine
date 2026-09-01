// v9 — workflow discovery helpers (REQ-061 purpose + REQ-062 static DAG skeleton). Pure functions:
// no I/O, never execute the workflow, never throw on odd input. Used by the catalog (store purpose at
// register), the workflow_get MCP tool, and the dashboard's workflow-card drill-in.
import { runInNewContext } from 'node:vm';
import { checkMeta } from './sandbox/guards.js';
import { parseParamContract, type ParamContract, type Err as ParamContractErr } from './params/contract.js';

export interface WorkflowMeta {
  description: string;
  phases: Array<{ title: string }>;
}

/** Extracts {description, phases} from a script's `export const meta = {…}` block. The meta object is
 *  already a validated PURE LITERAL (checkMeta.pureLiteral) — no calls/vars/spreads/templates — so
 *  evaluating it in an empty, timeout-bounded VM context is side-effect-free. Missing/impure/odd meta
 *  degrades to empty (never throws). */
export function parseMeta(script: string): WorkflowMeta {
  const empty: WorkflowMeta = { description: '', phases: [] };
  const m = checkMeta(script);
  if (!m.found || !m.pureLiteral || !m.objectText) return empty;
  let obj: unknown;
  try {
    obj = runInNewContext(`(${m.objectText})`, Object.create(null) as object, { timeout: 50 });
  } catch {
    return empty;
  }
  if (!obj || typeof obj !== 'object') return empty;
  const o = obj as { description?: unknown; phases?: unknown };
  const description = typeof o.description === 'string' ? o.description : '';
  const phases = Array.isArray(o.phases)
    ? o.phases
        .map((p) => (p && typeof p === 'object' && typeof (p as { title?: unknown }).title === 'string'
          ? { title: (p as { title: string }).title }
          : null))
        .filter((p): p is { title: string } => p !== null)
    : [];
  return { description, phases };
}

/** DES-103 (TASK-099): the pre-eval source-size bound (4 KB) for the `meta` literal — measured on
 *  the matched literal TEXT, before `runInNewContext`. Separate from contract.ts's post-eval
 *  structural bounds (DES-101), which only ever see a value that already survived evaluation. */
export const MAX_META_LITERAL_BYTES = 4096;

/** Extracts + validates `meta.params` at registration time (DES-103, ARCH-067). No meta / an
 *  impure meta (rejected elsewhere via INVALID_META) / no declared `params` field all mean
 *  "no contract" — `parseParamContract(undefined, …)` already resolves that to the canonical
 *  4-knob contract (REQ-090 backward compat; the resolver never branches on "contract missing"). */
export function parseMetaParams(
  script: string,
  aliasNames: Set<string>,
): { ok: true; value: ParamContract } | ParamContractErr {
  const m = checkMeta(script);
  if (!m.found || !m.pureLiteral || m.objectText === undefined) {
    return parseParamContract(undefined, aliasNames);
  }
  if (Buffer.byteLength(m.objectText, 'utf8') > MAX_META_LITERAL_BYTES) {
    return {
      ok: false,
      code: 'PARAM_CONTRACT_INVALID',
      message: `meta literal exceeds the ${MAX_META_LITERAL_BYTES}-byte source-size bound`,
      detail: { param: 'meta', reason: 'source too large' },
    };
  }
  let obj: unknown;
  try {
    obj = runInNewContext(`(${m.objectText})`, Object.create(null) as object, { timeout: 50 });
  } catch {
    return parseParamContract(undefined, aliasNames);
  }
  const rawParams = obj && typeof obj === 'object' ? (obj as { params?: unknown }).params : undefined;
  return parseParamContract(rawParams, aliasNames);
}

export type SkeletonKind = 'phase' | 'agent' | 'workflow';
export interface SkeletonNode {
  kind: SkeletonKind;
  /** phase title (kind:'phase'). */
  title?: string;
  /** referenced sub-workflow name (kind:'workflow'), when a string literal. */
  workflow?: string;
  /** group id shared by nodes inside the same parallel([...]) call. */
  parallel?: number;
  /** best-effort: the call is inside a for/while/map/if body, so its count/shape is runtime-dependent. */
  dynamic?: boolean;
}

const CALL_RE = /\b(phase|agent|parallel|workflow)\s*\(/g;
const STRING_ARG_RE = /^\s*(['"])(.*?)\1/;
// keyword that opens a runtime-dependent (loop/map/conditional) body — nodes within are `dynamic`.
const DYNAMIC_OPENERS = /\b(for|while|if)\s*\(|\.(map|forEach|filter|reduce)\s*\(/g;

/** Scans the script for the ranges [start,end) that are inside a loop/map/if body — used to mark
 *  skeleton nodes `dynamic`. Best-effort + string/paren-aware enough for typical workflow scripts. */
function dynamicRanges(script: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  DYNAMIC_OPENERS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DYNAMIC_OPENERS.exec(script)) !== null) {
    // find the '(' that starts the head, skip to its matching ')', then span the following block.
    const openParen = script.indexOf('(', m.index);
    if (openParen === -1) continue;
    const afterHead = matchDelimiter(script, openParen, '(', ')');
    if (afterHead === -1) continue;
    // the body is either a `{…}` block (for/while/if) or, for .map(cb), everything up to the ')' —
    // in both cases marking from the opener to the end of the head's matching ')' covers the calls
    // an arrow body `() => agent(...)` inside .map(...) as well.
    let bodyEnd = afterHead;
    let i = afterHead;
    while (i < script.length && /\s/.test(script[i]!)) i++;
    if (script[i] === '{') { const close = matchDelimiter(script, i, '{', '}'); if (close !== -1) bodyEnd = close; }
    ranges.push([m.index, Math.max(bodyEnd, afterHead)]);
  }
  return ranges;
}

/** Returns the index just past the delimiter matching the opener at `openIdx` (string-aware), or -1. */
function matchDelimiter(script: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = openIdx; i < script.length; i++) {
    const c = script[i];
    if (str !== null) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Predicted DAG skeleton — a pure static scan of phase()/agent()/parallel()/workflow() calls in
 *  source order. Nodes inside a parallel([...]) share a `parallel` group id; nodes inside a
 *  loop/map/if body are `dynamic:true` (best-effort — real shape resolves only at run time). Never
 *  executes the script and never throws. */
export function parseWorkflowSkeleton(script: string): SkeletonNode[] {
  const nodes: SkeletonNode[] = [];
  const dyn = dynamicRanges(script);
  const inDynamic = (idx: number): boolean => dyn.some(([s, e]) => idx >= s && idx < e);
  // parallel spans: [start,end) of each parallel(...) call, with a group id.
  const parallelSpans: Array<{ id: number; start: number; end: number }> = [];
  let groupSeq = 0;

  CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_RE.exec(script)) !== null) {
    const kind = m[1] as 'phase' | 'agent' | 'parallel' | 'workflow';
    const callAt = m.index;
    const openParen = script.indexOf('(', callAt);
    if (kind === 'parallel') {
      const end = openParen === -1 ? callAt : matchDelimiter(script, openParen, '(', ')');
      if (end !== -1) parallelSpans.push({ id: ++groupSeq, start: openParen, end });
      continue; // the parallel wrapper itself is not a node — its inner agent/workflow calls are
    }
    const node: SkeletonNode = { kind };
    if (kind === 'phase' || kind === 'workflow') {
      const arg = STRING_ARG_RE.exec(script.slice(openParen + 1));
      if (arg) { if (kind === 'phase') node.title = arg[2]; else node.workflow = arg[2]; }
    }
    const group = parallelSpans.find((p) => callAt > p.start && callAt < p.end);
    if (group) node.parallel = group.id;
    if (inDynamic(callAt)) node.dynamic = true;
    nodes.push(node);
  }
  return nodes;
}
