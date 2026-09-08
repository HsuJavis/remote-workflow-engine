// v9 — workflow discovery helpers (REQ-061 purpose + REQ-062 static DAG skeleton). Pure functions:
// no I/O, never execute the workflow, never throw on odd input. Used by the catalog (store purpose at
// register), the workflow_get MCP tool, and the dashboard's workflow-card drill-in.
import { runInNewContext } from 'node:vm';
import { checkMeta } from './sandbox/guards.js';
import { parseParamContract, retiredDefaults, TUNABLE_KEYS, type ParamContract, type Err as ParamContractErr } from './params/contract.js';
// v25 (#55): the scanner's accepted-key set is derived from the AgentOpts TYPE, so the two
// cannot drift apart (see AGENT_OPT_KEYS below).
import type { AgentOpts } from './types.js';

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
  // v24 Gate 7.5 (D-2, REQ-110 / ADR-035): `meta.defaults` is a SIBLING of `params`, so
  // `parseParamContract` — whose first argument IS `meta.params` — never saw it, and a script
  // declaring one registered `completed` with the whole object silently dropped. The authoring
  // guide states in as many words that `meta.params.knobs` and `meta.defaults` are both refused
  // DEFAULTS_RETIRED; only the first of the two was true. Checked HERE, the one place the whole
  // evaluated meta object is in hand.
  if (obj && typeof obj === 'object' && (obj as { defaults?: unknown }).defaults !== undefined) {
    return retiredDefaults('meta.defaults');
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
  | 'PARAM_IN_SCRIPT'
  /** v25 (#55, adjudication #9 I-1.4): an options key that is neither an `AgentOpts` field nor a
   *  tunable — same ruling `meta.params` has enforced since v21, now on the side that had it
   *  ZERO times. A key that reads as accepted and reaches nothing is the defect. */
  | 'PARAM_UNKNOWN';

export interface AgentCallViolation {
  line: number;
  code: AgentCallViolationCode;
  /** The offending option key. Closed to the tunables for `PARAM_IN_SCRIPT`; free-form for
   *  `PARAM_UNKNOWN`, whose whole job is to hand back the name the author actually wrote. */
  key?: string;
  hint: string;
}

export interface AgentCallScan {
  labels: string[];
  calls: Array<{
    line: number;
    label: string;
    /** DES-174 (TASK-184): the AGENT_CALL_RE match character offset — the skeleton↔scan join key
     *  (character offset, not label: two calls may legally share a label, e.g. a retry shape). */
    index: number;
    /** DES-174: the literal array when the options object carries `allowedTools` (including `[]`,
     *  recorded verbatim); `'absent'` when the call has no `allowedTools` key at all. */
    allowedTools?: string[] | 'absent';
    /** DES-174: both arms of one ternary or one if/else, or every member of one `parallel([...])`,
     *  share one `{kind, id}` — detected with the same string-aware `matchDelimiter` below. Absent
     *  for a plain sequential call. */
    group?: { kind: 'parallel' | 'alt'; id: number };
  }>;
  violations: AgentCallViolation[];
}

const AGENT_CALL_RE = /(?<!\.)\bagent\s*\(/g;
const AGENT_LABEL_FORMAT_RE = /^[A-Za-z_][\w-]*$/;
// v25 (#55): derived from `TUNABLE_KEYS` rather than transcribed. The literal that stood here knew
// three of the four tunables, so `appendPrompt` written inside an `agent()` call was accepted and
// dropped — the same silence #55 is about, in the file that is supposed to catch it.
const LOCKED_PARAM_KEYS = new Set<string>(TUNABLE_KEYS);

/** v25 (#55, adjudication #9 I-1.4): the CLOSED set of keys an `agent()` options literal may carry
 *  — every `AgentOpts` field plus `prompt`, which the options object carries but the type does not
 *  (the sandbox marshals it beside the label, `run-manager.ts:_handleAgentRequest`).
 *
 *  Written as a `Record<keyof AgentOpts | 'prompt', true>` on purpose: adding a field to `AgentOpts`
 *  without adding it here is a COMPILE error, so the accepted set cannot silently fall behind the
 *  type the way `LOCKED_KEYS`'s `tools` fell behind `allowedTools` for three iterations. Same
 *  closed-class move as `AUTHZ_ERROR_CODES satisfies readonly ErrorCode[]` (TASK-162), for the same
 *  reason: this ledger has now recorded one-directional vocabulary drift four times. */
const AGENT_OPT_KEYS: Record<keyof AgentOpts | 'prompt', true> = {
  prompt: true, label: true, phase: true, schema: true, model: true, effort: true,
  timeoutMs: true, isolation: true, agentType: true, mcp: true, allowedTools: true,
};

/** The keys an author may actually write, in the refusal message: the closed set MINUS the tunables,
 *  which have their own more specific `PARAM_IN_SCRIPT` refusal naming the declaration site. */
export const WRITABLE_AGENT_OPT_KEYS = Object.keys(AGENT_OPT_KEYS).filter((k) => !LOCKED_PARAM_KEYS.has(k));

/** Near-miss pointers: a name an author is likely to reach for, and the one that works. `tools` is
 *  not hypothetical — it is `LOCKED_KEYS`'s own former spelling and what the v24 cold subject wrote
 *  before spending fifteen minutes routing around a capability it already had (#55). */
const AGENT_OPT_NEAR_MISSES: Record<string, string> = {
  tools: 'allowedTools',
  allowed_tools: 'allowedTools',
  tool: 'allowedTools',
  system: 'agentType',
  systemPrompt: 'agentType',
  name: 'label',
  timeout: 'timeoutMs',
  // `skills` is advertised in `LOCKED_KEYS` but is not an `agent()` option — it is declared per
  // label in the contract. Same incident shape as `tools`: a name the surface shows an author, in a
  // place that never read it.
  skills: 'meta.params.agents.<label>.skills',
};
const WORKFLOW_CALL_RE = /(?<!\.)\bworkflow\s*\(/g;

/** DES-143 boundary: "calls inside a nested `workflow(` argument list are NOT scanned" means a
 *  call to ANOTHER named sub-workflow (`workflow("name", …)` — first arg a string literal), whose
 *  whole argument-list span (including any inline callback body) is excluded. It does NOT mean the
 *  top-level bootstrap wrapper (`workflow(() => { … })`, no string first arg) — that one's `agent()`
 *  calls ARE scanned (UT-145 case 1). */
function nestedWorkflowSpans(script: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  WORKFLOW_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORKFLOW_CALL_RE.exec(script)) !== null) {
    const openParen = script.indexOf('(', m.index);
    const closeParen = matchDelimiter(script, openParen, '(', ')');
    if (closeParen === -1) continue;
    const [firstArg] = splitTopLevel(script.slice(openParen + 1, closeParen - 1));
    if (firstArg !== undefined && literalStringValue(firstArg) !== null) spans.push([openParen, closeParen]);
  }
  return spans;
}

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

/** `null` unless `text` is, in full, a `[...]` literal of quoted string tokens — used to read
 *  `allowedTools: [...]` verbatim (DES-174/TASK-184) without a JS parser dependency. `[]` returns
 *  `[]`, not `null` — `allowedTools: []` must be recorded, not treated as absent. */
function parseStringArrayLiteral(text: string): string[] | null {
  const t = text.trim();
  if (!(t.startsWith('[') && t.endsWith(']'))) return null;
  const out: string[] = [];
  for (const item of splitTopLevel(t.slice(1, -1))) {
    const v = literalStringValue(item);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

const GROUP_PARALLEL_CALL_RE = /(?<!\.)\bparallel\s*\(/g;

/** DES-174 (TASK-184): the `[start,end)` argument-list span of every `parallel([...])` call, each
 *  with its own group id — every `agent()` call whose AGENT_CALL_RE offset falls inside one span
 *  shares `{kind:'parallel', id}`. Independent of `parseWorkflowSkeleton`'s own parallel-span scan
 *  (that one groups SkeletonNodes, this one groups scanned agent() calls). */
function parallelCallSpans(script: string): Array<{ id: number; start: number; end: number }> {
  const spans: Array<{ id: number; start: number; end: number }> = [];
  GROUP_PARALLEL_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let seq = 0;
  while ((m = GROUP_PARALLEL_CALL_RE.exec(script)) !== null) {
    const openParen = script.indexOf('(', m.index);
    if (openParen === -1) continue;
    const end = matchDelimiter(script, openParen, '(', ')');
    if (end === -1) continue;
    spans.push({ id: ++seq, start: openParen, end });
  }
  return spans;
}

interface AltSpan { id: number; armAStart: number; armAEnd: number; armBStart: number; armBEnd: number }

/** From `start` (just after a ternary's '?'), scans forward tracking bracket depth and strings for
 *  the ':' that closes the "then" arm at relative depth 0 (an object literal's own `key: value`
 *  colon sits at depth > 0 and is skipped). -1 if the arm exits its enclosing bracket unmatched. */
function findMatchingColon(script: string, start: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = start; i < script.length; i++) {
    const c = script[i];
    if (str !== null) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { if (depth === 0) return -1; depth--; }
    else if (c === ':' && depth === 0) return i;
  }
  return -1;
}

/** From `start` (just after the ternary's ':'), scans forward for the end of the "else" arm: the
 *  first `;`/`,` at relative depth 0, or an enclosing close-bracket the arm does not own. */
function findArmEnd(script: string, start: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = start; i < script.length; i++) {
    const c = script[i];
    if (str !== null) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { if (depth === 0) return i; depth--; }
    else if ((c === ';' || c === ',') && depth === 0) return i;
  }
  return script.length;
}

const IF_RE = /\bif\s*\(/g;

/** DES-174/ARCH-113 rule S3 (TASK-184): the two arms of one ternary or one `if (…) {…} else {…}`
 *  at the same delimiter depth — every `agent()` call whose offset falls inside either arm shares
 *  `{kind:'alt', id}`. Best-effort, matching this file's existing regex+matchDelimiter scanning
 *  style: an `else if` chain (no `{…}` immediately after `else`) is not recognized. */
function altSpans(script: string): AltSpan[] {
  const spans: AltSpan[] = [];
  let seq = 0;

  IF_RE.lastIndex = 0;
  let mi: RegExpExecArray | null;
  while ((mi = IF_RE.exec(script)) !== null) {
    const condOpen = script.indexOf('(', mi.index);
    const condClose = matchDelimiter(script, condOpen, '(', ')');
    if (condClose === -1) continue;
    let i = condClose;
    while (i < script.length && /\s/.test(script[i]!)) i++;
    if (script[i] !== '{') continue;
    const ifBodyStart = i;
    const ifBodyEnd = matchDelimiter(script, i, '{', '}');
    if (ifBodyEnd === -1) continue;
    let j = ifBodyEnd;
    while (j < script.length && /\s/.test(script[j]!)) j++;
    if (script.slice(j, j + 4) !== 'else') continue;
    j += 4;
    while (j < script.length && /\s/.test(script[j]!)) j++;
    if (script[j] !== '{') continue;
    const elseBodyStart = j;
    const elseBodyEnd = matchDelimiter(script, j, '{', '}');
    if (elseBodyEnd === -1) continue;
    spans.push({ id: ++seq, armAStart: ifBodyStart, armAEnd: ifBodyEnd, armBStart: elseBodyStart, armBEnd: elseBodyEnd });
  }

  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    if (c === "'" || c === '"' || c === '`') {
      // skip the whole string literal so a '?' inside it is never mistaken for a ternary.
      let j = i + 1;
      while (j < script.length && script[j] !== c) { if (script[j] === '\\') j++; j++; }
      i = j;
      continue;
    }
    // skip optional chaining (`?.`), and BOTH characters of nullish coalescing (`??`) — without
    // the `i - 1` check the second `?` of `a ?? b` reads as a ternary start of its own.
    if (c !== '?' || script[i + 1] === '.' || script[i + 1] === '?' || script[i - 1] === '?') continue;
    const colonIdx = findMatchingColon(script, i + 1);
    if (colonIdx === -1) continue;
    const armEnd = findArmEnd(script, colonIdx + 1);
    spans.push({ id: ++seq, armAStart: i + 1, armAEnd: colonIdx, armBStart: colonIdx + 1, armBEnd: armEnd });
  }

  return spans;
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
  const calls: AgentCallScan['calls'] = [];
  const violations: AgentCallViolation[] = [];

  const lineAt = (idx: number): number => script.slice(0, idx).split('\n').length;
  const nestedSpans = nestedWorkflowSpans(script);
  const inNestedWorkflow = (idx: number): boolean => nestedSpans.some(([s, e]) => idx >= s && idx < e);
  const parallelSpans = parallelCallSpans(script);
  const altSpansList = altSpans(script);
  const groupFor = (idx: number): { kind: 'parallel' | 'alt'; id: number } | undefined => {
    const par = parallelSpans.find((p) => idx > p.start && idx < p.end);
    if (par) return { kind: 'parallel', id: par.id };
    const alt = altSpansList.find((a) => (idx >= a.armAStart && idx < a.armAEnd) || (idx >= a.armBStart && idx < a.armBEnd));
    if (alt) return { kind: 'alt', id: alt.id };
    return undefined;
  };

  AGENT_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AGENT_CALL_RE.exec(script)) !== null) {
    if (inNestedWorkflow(m.index)) continue;
    const index = m.index;
    const line = lineAt(index);
    const group = groupFor(index);
    const openParen = script.indexOf('(', m.index);
    const closeParen = matchDelimiter(script, openParen, '(', ')');
    if (closeParen === -1) continue; // unbalanced — not a well-formed call, nothing to report
    const args = splitTopLevel(script.slice(openParen + 1, closeParen - 1));

    if (args.length < 2) {
      violations.push({ line, code: 'AGENT_LABEL_REQUIRED', hint: 'agent() needs a literal label and an options object: agent("label", { … })' });
      calls.push({ line, label: '', index, allowedTools: 'absent', group });
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

    let allowedTools: string[] | 'absent' = 'absent';
    const optsText = optsArg!.trim();
    if (!(optsText.startsWith('{') && optsText.endsWith('}'))) {
      violations.push({ line, code: 'AGENT_OPTS_NOT_LITERAL', hint: 'the options argument must be a literal object: { … }' });
    } else {
      for (const entry of splitTopLevel(optsText.slice(1, -1))) {
        const colonIdx = entry.indexOf(':');
        if (colonIdx === -1) continue;
        let key = entry.slice(0, colonIdx).trim();
        if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
        if (key === 'allowedTools') {
          const parsed = parseStringArrayLiteral(entry.slice(colonIdx + 1));
          if (parsed !== null) allowedTools = parsed;
        }
        if (LOCKED_PARAM_KEYS.has(key)) {
          const label = validLabel ?? '<label>';
          violations.push({
            line,
            code: 'PARAM_IN_SCRIPT',
            key,
            hint: `move '${key}' to meta.params.agents.${label}.${key}.default`,
          });
        } else if (!Object.hasOwn(AGENT_OPT_KEYS, key)) {
          // v25 (#55, adjudication #9 I-1.4). `Object.hasOwn`, not `key in` — `constructor` and
          // `toString` are `in` every object literal and would be waved through.
          const nearMiss = AGENT_OPT_NEAR_MISSES[key];
          const lead = nearMiss !== undefined
            ? `'${key}' is not an agent() option — did you mean '${nearMiss}'?`
            : `'${key}' is not an agent() option.`;
          violations.push({
            line,
            code: 'PARAM_UNKNOWN',
            key,
            hint:
              `${lead} Accepted: ${WRITABLE_AGENT_OPT_KEYS.join(', ')}` +
              `. ${[...LOCKED_PARAM_KEYS].join('/')} belong in meta.params.agents.<label>.<key>.default`,
          });
        }
      }
    }

    calls.push({ line, label: validLabel ?? labelVal ?? '', index, allowedTools, group });
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
