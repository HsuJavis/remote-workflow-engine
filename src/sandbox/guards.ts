// Sandbox VM evaluation (DES-005 / TASK-007).
// evaluateScript runs a workflow script in a restricted VM context, enforcing the
// determinism/parse/size/nesting/item-cap guards from the compat spec (DES-005/DES-013).
import * as vm from 'node:vm';
import type { Budget } from '../types.js';

// ── `export const meta = {…}` locator (compat-spec §1) ──────────────────────────────────────────
// Defined HERE (not a separate module) on purpose: guards.ts is loaded by the sandbox CHILD
// (child-entry.ts, run under `node --experimental-transform-types`, which does NOT resolve `.js`→
// `.ts` for value imports the way the tsx main process does), yet guards.ts IS type-checked by tsc
// (child-entry.ts is the only file tsconfig excludes). A cross-file value import satisfies at most
// one of those two — inlining satisfies both. Exported for the submission validator + tests (main
// process) to reuse the SAME scanner, so submission-time and run-time meta handling never diverge.

export interface MetaCheck {
  /** true when an `export const meta =` declaration is present at all. */
  found: boolean;
  /** the full `export const meta = {…}[;]` text to strip from the executed body (when found+parsed). */
  span?: string;
  /** the `{…}` object literal text (when found+parsed). */
  objectText?: string;
  /** true only when meta is a pure object literal (no template literal / spread outside strings). */
  pureLiteral?: boolean;
}

const META_DECL_RE = /export\s+const\s+meta\s*=\s*/;

/** Locates `export const meta = {…}` with a STRING-AWARE brace scan (the object's string values
 *  routinely contain `;`, `{`, `}`), and flags a template literal / spread only when it appears
 *  OUTSIDE a string. Replaces a prior `/[^;]*;/` regex that truncated the object at the first
 *  in-string semicolon and wrongly rejected legitimate workflows (e.g. iso-agile-sdlc's sdlc-run.js
 *  whose description is full of semicolons). */
export function checkMeta(script: string): MetaCheck {
  const m = META_DECL_RE.exec(script);
  if (!m) return { found: false };
  const objStart = m.index + m[0].length;
  if (script[objStart] !== '{') return { found: true, pureLiteral: false }; // not an object literal
  let depth = 0;
  let str: string | null = null;
  let impure = false;
  let i = objStart;
  for (; i < script.length; i++) {
    const c = script[i];
    if (str !== null) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === "'" || c === '"') { str = c; continue; }
    if (c === '`') { impure = true; str = '`'; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; if (depth === 0) { i++; break; } continue; }
    if (c === '.' && script[i + 1] === '.' && script[i + 2] === '.') impure = true;
  }
  if (depth !== 0) return { found: true, pureLiteral: false };
  const objectText = script.slice(objStart, i);
  let end = i;
  while (end < script.length && /\s/.test(script[end]!)) end++;
  if (script[end] === ';') end++;
  return { found: true, span: script.slice(m.index, end), objectText, pureLiteral: !impure };
}

export interface ScriptResult {
  kind: 'done' | 'error';
  value?: unknown;
  error?: { code: string; message: string };
}

export interface SandboxApi {
  /** Called when the script calls agent() — marshalled to the parent via IPC. */
  agent(prompt: string, opts?: unknown): Promise<unknown>;
  /** args value injected by the parent init message. */
  args: unknown;
  /** Read-only budget view. */
  budget: Budget;
  /** Optional: run a named/ref'd workflow inline. Absent (or throwing) at nested levels → NESTING_ERROR. */
  workflow?(nameOrRef: unknown, args?: unknown): Promise<unknown>;
  /** Optional: forwards phase(title) calls to the parent for observability (DES-006/DES-008). */
  phase?(title: string): void;
}

const MAX_SCRIPT_BYTES = 512 * 1024;
const MAX_ITEMS = 4096;

// v26 (DES-187, ARCH-121, TASK-193, REQ-130/121/127/001): the sandbox's exposed globals, as DATA —
// the authoring guide (src/authoring-guide.ts) renders this list instead of re-typing one that can
// drift from the `sandbox` object literal `evaluateScript` actually constructs below. Exports only
// — no new value import enters this file, which the sandbox CHILD also loads (see the checkMeta
// note at the top: it does not resolve `.js`→`.ts` for value imports).
export const SANDBOX_GLOBALS = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'Date', 'Math'] as const;

/** One of the three calls `guardedDate`/`guardedMath` above refuse, plus the guide-facing reasoning
 *  DES-187 asks for: WHY it is refused (the resume-replay hazard both guards share) and INSTEAD
 *  (what an author writes to get the same value safely). */
export interface DeterminismGuard {
  /** a script fragment that trips the guard when evaluated. */
  call: string;
  why: string;
  instead: string;
}

export const DETERMINISM_GUARDED: readonly DeterminismGuard[] = [
  {
    call: 'Date.now()', // det:allow — the guard TABLE names the API it blocks inside a script; this file calls none of them
    why: "resume replays agent() calls keyed by prompt+opts, so a wall-clock value baked into that key would change it on replay and re-dispatch an already-paid call.",
    instead: 'read a timestamp off run_status/run_result, or pass one in via args.',
  },
  {
    call: 'Math.random()', // det:allow — guard-table literal, not a call
    why: 'the same replay-key hazard as Date.now() — a random value baked into the key changes on every run.', // det:allow — guard-table literal, not a call
    instead: 'pass a seed in via args.',
  },
  {
    call: 'new Date()', // det:allow — guard-table literal, not a call
    why: 'called with no arguments this reads the wall clock, the same hazard as Date.now().',
    instead: "pass an argument — new Date('2026-01-01') is allowed.",
  },
];

/** Errors raised by the guard functions themselves — carry the guard's error code through the VM boundary. */
class GuardError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = code;
  }
}

// V5 (Gate 8 v2 review, adversarial finding, LOW — accepted architectural limitation, documented
// here as its resolution): these `Date`/`Math` overrides are DETERMINISM HYGIENE for replay/resume
// caching, NOT a security boundary. A `node:vm` context is not a sandbox (Node's own docs say so):
// a script can reach the context realm's UN-guarded intrinsics via a Function-constructor escape,
// e.g. `Function('return Date')().now()`, defeating THESE guards. That is acceptable because the
// worst outcome is the script's own run becomes non-replayable — a self-inflicted correctness issue,
// not a privilege escalation. The real containment is the PROCESS boundary (ARCH-003): SandboxHost
// forks a per-run child holding no secrets/store/network handle, cwd jailed to the run workspace, so
// the SAME escape cannot reach `process`/`require`/`fs`/host env — those are simply absent from the
// context, not merely shadowed (proven by sandbox-guards.test.ts's realm-escape + no-fs/require cases).
function guardedDate(): typeof Date {
  class GuardedDate extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        throw new GuardError('DETERMINISM_GUARD', 'new Date() without arguments is not allowed inside a workflow script'); // det:allow — refusal message naming the blocked API, not a call
      }
      // @ts-expect-error — variadic forwarding to whichever Date overload matches at runtime
      super(...args);
    }
    static override now(): number {
      throw new GuardError('DETERMINISM_GUARD', 'Date.now() is not allowed inside a workflow script'); // det:allow — refusal message naming the blocked API, not a call
    }
  }
  return GuardedDate as unknown as typeof Date;
}

function guardedMath(): typeof Math {
  return new Proxy(Math, {
    get(target, prop, receiver) {
      if (prop === 'random') {
        return () => {
          throw new GuardError('DETERMINISM_GUARD', 'Math.random() is not allowed inside a workflow script'); // det:allow — refusal message naming the blocked API, not a call
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

// v25 (DES-167, REQ-120, issue #61): codes the ENGINE raises when it REFUSED to dispatch a call at
// all. They are NOT failures of the author's own code, and `parallel()`/`pipeline()` must not fold
// them into their documented null-for-a-throwing-thunk contract — doing so is what made the owner's
// lost third researcher invisible (no code, no log, no event; the only trace was a callSeq gap).
// The set is deliberately tiny: a call that reached a gateway and FAILED there (timeout, provider
// error) is still a thunk that threw, and still nulls.
// Inlined rather than imported from ../errors.js on purpose — this module is loaded by the sandbox
// CHILD, which does not resolve `.js`→`.ts` for value imports (see the checkMeta note at the top).
const ENGINE_REFUSAL_CODES = new Set(['BUDGET_EXCEEDED']);

/** The refusal code carried by `err`, or null when `err` is anything else. `code` is the live field
 *  for both sources since v25 (DES-169, issue #63): child-entry rejects an `agentThrow` with the IPC
 *  code on `code` AND `name`, and an in-process GuardError carries `code` as an own property. The
 *  `name` fallback is kept deliberately — it costs nothing and covers any error that reaches here
 *  carrying only the older shape. */
function refusalCode(err: unknown): string | null {
  const e = err as { code?: unknown; name?: unknown } | null | undefined;
  const code = (typeof e?.code === 'string' && e.code) || (typeof e?.name === 'string' && e.name) || '';
  return ENGINE_REFUSAL_CODES.has(code) ? code : null;
}

type Thunk = () => Promise<unknown>;
type Stage = (prev: unknown, item: unknown, index: number) => Promise<unknown>;

function makeParallel() {
  return async (thunks: Thunk[]): Promise<Array<unknown | null>> => {
    if (!Array.isArray(thunks)) {
      throw new GuardError('ITEM_CAP_EXCEEDED', 'parallel() requires an array of thunks');
    }
    if (thunks.length > MAX_ITEMS) {
      throw new GuardError('ITEM_CAP_EXCEEDED', `parallel() exceeds the ${MAX_ITEMS}-item cap (${thunks.length})`);
    }
    return Promise.all(
      thunks.map(async (thunk) => {
        try {
          return await thunk();
        } catch (err) {
          // An engine REFUSAL is not the author's thunk failing — propagate it with its code so the
          // caller (and the run's terminal error) says why. Everything else keeps the documented
          // null-for-a-throwing-thunk contract.
          if (refusalCode(err) !== null) throw err;
          return null;
        }
      }),
    );
  };
}

function makePipeline() {
  return async (items: unknown[], ...stages: Stage[]): Promise<Array<unknown | null>> => {
    if (!Array.isArray(items)) {
      throw new GuardError('ITEM_CAP_EXCEEDED', 'pipeline() requires an array of items');
    }
    if (items.length > MAX_ITEMS) {
      throw new GuardError('ITEM_CAP_EXCEEDED', `pipeline() exceeds the ${MAX_ITEMS}-item cap (${items.length})`);
    }
    return Promise.all(
      items.map(async (item, index) => {
        let prev: unknown = item;
        for (const stage of stages) {
          try {
            prev = await stage(prev, item, index);
          } catch (err) {
            if (refusalCode(err) !== null) throw err; // same rule as parallel() above
            return null;
          }
        }
        return prev;
      }),
    );
  };
}

function makeWorkflow(api: SandboxApi) {
  const delegate = api.workflow;
  return async (nameOrRef: unknown, args?: unknown): Promise<unknown> => {
    if (!delegate) {
      throw new GuardError('NESTING_ERROR', 'workflow() nesting is limited to one level');
    }
    try {
      return await delegate(nameOrRef, args);
    } catch (err) {
      // C-2: a delegate failure is not itself a nesting violation (the true one-level limit is the
      // !delegate branch above → NESTING_ERROR). Preserve the delegate error's own code (child-entry
      // sets it as .name on the rejection) so a caller can branch on CatalogNotFoundError etc. Inline
      // (no import) — this module is loaded by the sandbox child, which doesn't resolve .js→.ts value imports.
      const e = err as { code?: unknown; name?: unknown } | null;
      const code =
        (e && typeof e.code === 'string' && e.code) ? e.code :
        (e && typeof e.name === 'string' && e.name && e.name !== 'Error') ? e.name :
        'WORKFLOW_ERROR';
      throw new GuardError(code, err instanceof Error ? err.message : String(err));
    }
  };
}

// `export const meta = {...}` (compat-spec §1) must be a pure object literal — variables, calls,
// spreads, and template interpolation are rejected. Matched separately (before wrapping the script
// in an async function, since a bare `export` is not legal inside a function body) and stripped out
// of the executed body once validated. Uses the string-aware `checkMeta` scanner above — a prior
// `/[^;]*;/` regex truncated the object at the first semicolon inside a string VALUE and wrongly
// rejected legitimate workflows whose description contained a `;` (e.g. sdlc-run.js).
function checkMetaLiteral(script: string): { cleaned: string; error?: { code: string; message: string } } {
  const meta = checkMeta(script);
  if (!meta.found) return { cleaned: script };
  if (!meta.pureLiteral || meta.span === undefined) {
    return {
      cleaned: script,
      error: { code: 'INVALID_META', message: 'workflow meta must be a pure object literal — variables, calls, spreads, and template interpolation are rejected' },
    };
  }
  return { cleaned: script.replace(meta.span, '') };
}

/**
 * Evaluate a workflow script string in a restricted VM context.
 * Guards: Date.now(), Math.random(), new Date() (no args) throw inside the script. det:allow — a doc comment naming the blocked APIs, not a call
 * TS syntax, >512KB scripts, and >4096-item parallel()/pipeline() calls are rejected.
 */
export async function evaluateScript(script: string, api: SandboxApi): Promise<ScriptResult> {
  if (Buffer.byteLength(script, 'utf8') > MAX_SCRIPT_BYTES) {
    return { kind: 'error', error: { code: 'SIZE_EXCEEDED', message: `script exceeds the ${MAX_SCRIPT_BYTES}-byte cap` } };
  }

  const meta = checkMetaLiteral(script);
  if (meta.error) {
    return { kind: 'error', error: meta.error };
  }
  const body = meta.cleaned;

  const sandbox: Record<string, unknown> = {
    agent: api.agent.bind(api),
    parallel: makeParallel(),
    pipeline: makePipeline(),
    phase: (title: string) => { api.phase?.(title); },
    log: () => {},
    args: api.args,
    budget: api.budget,
    workflow: makeWorkflow(api),
    Date: guardedDate(),
    Math: guardedMath(),
  };
  const context = vm.createContext(sandbox);

  let compiled: vm.Script;
  try {
    compiled = new vm.Script(`(async () => {\n${body}\n})`, { filename: 'workflow-script.js' });
  } catch (err) {
    return { kind: 'error', error: { code: 'PARSE_ERROR', message: err instanceof Error ? err.message : String(err) } };
  }

  try {
    const runScript = compiled.runInContext(context) as () => Promise<unknown>;
    const value = await runScript();
    return { kind: 'done', value };
  } catch (err) {
    if (err instanceof GuardError) {
      return { kind: 'error', error: { code: err.code, message: err.message } };
    }
    // v25 (DES-167, REQ-120): an uncaught engine REFUSAL keeps its own code instead of flattening to
    // SCRIPT_ERROR (which run-manager's toErrorCode would then map to INTERNAL_ERROR). This is what
    // makes `run_result.error.code === 'BUDGET_EXCEEDED'` true for the caller — the owner's ask:
    // 「如果是 budget 問題 應該 fail 時 client 知道」. Covers both the sequential `await agent()` and
    // the refusal parallel()/pipeline() re-threw above.
    const refusal = refusalCode(err);
    if (refusal !== null) {
      return { kind: 'error', error: { code: refusal, message: err instanceof Error ? err.message : String(err) } };
    }
    return { kind: 'error', error: { code: 'SCRIPT_ERROR', message: err instanceof Error ? err.message : String(err) } };
  }
}
