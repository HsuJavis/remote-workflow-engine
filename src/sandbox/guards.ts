// Sandbox VM evaluation (DES-005 / TASK-007).
// evaluateScript runs a workflow script in a restricted VM context, enforcing the
// determinism/parse/size/nesting/item-cap guards from the compat spec (DES-005/DES-013).
import * as vm from 'node:vm';
import type { Budget } from '../types.js';

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

/** Errors raised by the guard functions themselves — carry the guard's error code through the VM boundary. */
class GuardError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = code;
  }
}

function guardedDate(): typeof Date {
  class GuardedDate extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        throw new GuardError('DETERMINISM_GUARD', 'new Date() without arguments is not allowed inside a workflow script');
      }
      // @ts-expect-error — variadic forwarding to whichever Date overload matches at runtime
      super(...args);
    }
    static override now(): number {
      throw new GuardError('DETERMINISM_GUARD', 'Date.now() is not allowed inside a workflow script');
    }
  }
  return GuardedDate as unknown as typeof Date;
}

function guardedMath(): typeof Math {
  return new Proxy(Math, {
    get(target, prop, receiver) {
      if (prop === 'random') {
        return () => {
          throw new GuardError('DETERMINISM_GUARD', 'Math.random() is not allowed inside a workflow script');
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
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
        } catch {
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
          } catch {
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
      throw new GuardError('NESTING_ERROR', err instanceof Error ? err.message : String(err));
    }
  };
}

// `export const meta = {...}` (compat-spec §1) must be a pure object literal — variables, calls,
// spreads, and template interpolation are rejected. Matched separately (before wrapping the script
// in an async function, since a bare `export` is not legal inside a function body) and stripped out
// of the executed body once validated.
const META_RE = /export\s+const\s+meta\s*=\s*([^;]*);/;

function checkMetaLiteral(script: string): { cleaned: string; error?: { code: string; message: string } } {
  const match = META_RE.exec(script);
  if (!match) return { cleaned: script };
  const raw = match[1].trim();
  const isPureLiteral = raw.startsWith('{') && raw.endsWith('}') && !raw.includes('`') && !raw.includes('...');
  if (!isPureLiteral) {
    return {
      cleaned: script,
      error: { code: 'INVALID_META', message: 'workflow meta must be a pure object literal — variables, calls, spreads, and template interpolation are rejected' },
    };
  }
  return { cleaned: script.replace(match[0], '') };
}

/**
 * Evaluate a workflow script string in a restricted VM context.
 * Guards: Date.now(), Math.random(), new Date() (no args) throw inside the script.
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
    return { kind: 'error', error: { code: 'SCRIPT_ERROR', message: err instanceof Error ? err.message : String(err) } };
  }
}
