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

/** Extracts + validates `meta.params` at registration time (DES-103, ARCH-067, DES-144). No meta /
 *  an impure meta (rejected elsewhere via INVALID_META) / no declared `params` field all mean
 *  "no contract" — `parseParamContract(undefined, scriptLabels, …)` resolves that to the zero-label
 *  contract when the script has no `agent()` calls, or refuses `AGENT_UNDECLARED` per label
 *  otherwise (v24; REQ-090's old unconditional canonical-contract compat is retired by DES-144). */
export function parseMetaParams(
  script: string,
  aliasNames: Set<string>,
): { ok: true; value: ParamContract } | ParamContractErr {
  const labels = scanAgentCalls(script).labels;
  const m = checkMeta(script);
  if (!m.found || !m.pureLiteral || m.objectText === undefined) {
    return parseParamContract(undefined, labels, aliasNames);
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
    return parseParamContract(undefined, labels, aliasNames);
  }
  const rawParams = obj && typeof obj === 'object' ? (obj as { params?: unknown }).params : undefined;
  return parseParamContract(rawParams, labels, aliasNames);
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

export type AgentCallViolationCode =
  | 'AGENT_LABEL_REQUIRED'
  | 'AGENT_LABEL_NOT_LITERAL'
  | 'AGENT_LABEL_FORMAT'
  | 'AGENT_OPTS_NOT_LITERAL'
  | 'PARAM_IN_SCRIPT';

export interface AgentCallViolation {
  line: number;
  code: AgentCallViolationCode;
  key?: 'model' | 'effort' | 'timeoutMs';
  hint: string;
}

export interface AgentCallScan {
  labels: string[];
  calls: Array<{ line: number; label: string }>;
  violations: AgentCallViolation[];
}

const AGENT_CALL_RE = /(?<!\.)\bagent\s*\(/g;
const AGENT_LABEL_FORMAT_RE = /^[A-Za-z_][\w-]*$/;
const LOCKED_PARAM_KEYS = new Set(['model', 'effort', 'timeoutMs']);

/** Splits `text` on its TOP-LEVEL commas (string/template/paren/brace/bracket-aware — the same
 *  depth-tracking idiom as `matchDelimiter`, generalized to multiple delimiter kinds at once since
 *  an argument list or an object literal's entries can nest any of them). Used both to split an
 *  `agent(...)`'s argument list and an options object literal's `key: value` entries. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let str: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (str !== null) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  const last = text.slice(start);
  if (last.trim() !== '') parts.push(last);
  return parts.map((p) => p.trim());
}

/** `null` unless `text` is, in full, one quoted string literal token (splitTopLevel already
 *  isolates a single argument, so no further string-awareness is needed here). */
function literalStringValue(text: string): string | null {
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text[text.length - 1] === text[0]) {
    return text.slice(1, -1);
  }
  return null;
}

/** DES-143/ARCH-096 (TASK-135): what "literal" means for an `agent(label, {options})` call, and the
 *  1-based line number on every violation. A call is `agent(<expr>, <balanced {…} literal>)`,
 *  matched with the same string-aware `matchDelimiter` used by `parseWorkflowSkeleton` plus a
 *  key/value scan — no JS parser dependency (a template/variable label or a non-literal options
 *  object cannot be checked statically, so both are refused rather than silently accepted).
 *  `x.agent(`/`agentFoo(` are not calls (the regex requires a preceding non-word/non-dot boundary);
 *  a commented-out `agent(` IS matched (accepted — the refusal names the line). Duplicate labels are
 *  legal: `labels` is de-duplicated, `calls` is not. */
export function scanAgentCalls(script: string): AgentCallScan {
  const labels: string[] = [];
  const calls: Array<{ line: number; label: string }> = [];
  const violations: AgentCallViolation[] = [];

  const lineAt = (idx: number): number => script.slice(0, idx).split('\n').length;

  AGENT_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AGENT_CALL_RE.exec(script)) !== null) {
    const line = lineAt(m.index);
    const openParen = script.indexOf('(', m.index);
    const closeParen = matchDelimiter(script, openParen, '(', ')');
    if (closeParen === -1) continue; // unbalanced — not a well-formed call, nothing to report
    const args = splitTopLevel(script.slice(openParen + 1, closeParen - 1));

    if (args.length < 2) {
      violations.push({ line, code: 'AGENT_LABEL_REQUIRED', hint: 'agent() needs a literal label and an options object: agent("label", { … })' });
      calls.push({ line, label: '' });
      continue;
    }

    const [labelArg, optsArg] = args;
    const labelVal = literalStringValue(labelArg!);
    let validLabel: string | null = null;
    if (labelVal === null) {
      violations.push({ line, code: 'AGENT_LABEL_NOT_LITERAL', hint: 'the label must be a literal string, not a template or a variable' });
    } else if (!AGENT_LABEL_FORMAT_RE.test(labelVal)) {
      violations.push({ line, code: 'AGENT_LABEL_FORMAT', hint: 'a label must match /^[A-Za-z_][\\w-]*$/' });
    } else {
      validLabel = labelVal;
    }

    const optsText = optsArg!.trim();
    if (!(optsText.startsWith('{') && optsText.endsWith('}'))) {
      violations.push({ line, code: 'AGENT_OPTS_NOT_LITERAL', hint: 'the options argument must be a literal object: { … }' });
    } else {
      for (const entry of splitTopLevel(optsText.slice(1, -1))) {
        const colonIdx = entry.indexOf(':');
        if (colonIdx === -1) continue;
        let key = entry.slice(0, colonIdx).trim();
        if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
        if (LOCKED_PARAM_KEYS.has(key)) {
          const label = validLabel ?? '<label>';
          violations.push({
            line,
            code: 'PARAM_IN_SCRIPT',
            key: key as 'model' | 'effort' | 'timeoutMs',
            hint: `move '${key}' to meta.params.agents.${label}.${key}.default`,
          });
        }
      }
    }

    calls.push({ line, label: validLabel ?? labelVal ?? '' });
    if (validLabel && !labels.includes(validLabel)) labels.push(validLabel);
  }

  return { labels, calls, violations };
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
