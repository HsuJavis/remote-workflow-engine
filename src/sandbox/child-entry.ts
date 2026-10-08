// Sandbox child entry point (DES-005/DES-006, TASK-006). Executed in its own OS process
// (spawned by SandboxHost) so a hung/looping script can be terminated from outside the V8
// isolate — something an in-process vm context cannot guarantee. Runs the untrusted script
// inside the restricted VM context (guards.ts) and forwards agent()/workflow() calls to the
// trusted parent over the IPC channel; holds no secrets/store/network access itself.
//
// NOTE: this file is executed directly by `node --experimental-transform-types` (not through
// the project's vitest/bundler TS resolution), so — unlike the rest of the codebase — its
// relative imports use explicit `.ts` extensions, which is what plain Node's loader resolves.
import { evaluateScript, markEngineRefusal } from './guards.ts';
import type { SandboxApi } from './guards.ts';
import type { SandboxBudget } from '../types.ts';

// v26 (DES-182, ARCH-118, TASK-182): the live `{usd, tokens}` spend snapshot — piggybacked onto
// both the initial `start` message (a frame that never calls agent(), e.g. a nested workflow()
// reading `budget.spent()` cold, would otherwise see no accounting at all) and every subsequent
// `agentResult`. Inlined (not imported from `run-guard.ts`'s `ZERO_TOKENS`) — this module does not
// resolve local `.js`→`.ts` value imports (see the `checkMeta` note in `guards.ts`).
interface Spend { usd: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } }
const ZERO_SPEND: Spend = { usd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

// F-2: the SAME safe-message strategy as guards.ts's own `safeMessage` (inlined, not imported, for
// the identical reason `ZERO_SPEND` above is inlined) — `String(err)` throws on `Object.create(null)`
// or a stringification-poisoned object, so a classification exception here must never itself throw.
function safeMessage(err: unknown): string {
  try {
    if (err instanceof Error) return err.message;
  } catch { /* fall through to the next strategy */ }
  try {
    return String(err);
  } catch {
    return 'the script threw a value that could not be converted to a message';
  }
}

// Extends the DES-006 ParentMsg 'init' shape with the fields a standalone child process needs
// at spawn time (script text, runId) that the seam's steady-state protocol doesn't carry.
interface StartMsg {
  t: 'start';
  runId: string;
  script: string;
  args: unknown;
  /** v26 (DES-182, ADR-037): was `budgetTotal: number | null` (a bare token count) — now the two
   *  independent limits, or `null` for unbounded on both. */
  budget: { usd: number | null; tokens: number | null } | null;
  /** v26 (DES-182): the live spend as of run start (absent -> the dry-run seam, treated as zero). */
  spent?: Spend;
}
interface AgentResultMsg { t: 'agentResult'; callSeq: number; value: unknown; spent?: Spend }
interface AgentThrowMsg { t: 'agentThrow'; callSeq: number; error: { code: string; message: string } }
interface WorkflowResultMsg { t: 'workflowResult'; callSeq: number; value: unknown }
interface AbortMsg { t: 'abort'; reason: 'suspend' | 'stop' }

type InMsg = StartMsg | AgentResultMsg | AgentThrowMsg | WorkflowResultMsg | AbortMsg;

let nextCallSeq = 0;
const pendingAgent = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const pendingWorkflow = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
// D-F8 / v26 (DES-182): live script-visible budget accounting, kept current by the `spent` field
// piggybacked onto the initial `start` message and onto every agentResult message (the parent's
// real accounting as of that call) — never a hard-coded stub.
let spentSoFar: Spend = ZERO_SPEND;

// issue #162 A/B: the engine's documented return-value size cap (AUTHORING.md) — generous for an
// ordinary summary/result object while bounding the IPC message Node has to serialize and the
// parent has to buffer.
const MAX_RESULT_BYTES = 10 * 1024 * 1024;

// issues #162 B / #163 B1 (concurrency/large-payload result loss — TDD): `process.send()` writes to
// the IPC socket ASYNCHRONOUSLY — a message that doesn't fit the kernel socket's send buffer in one
// syscall (empirically, `/proc/sys/net/core/wmem_default` on a typical Linux box is ~208KB; the
// framed JSON for anything much past ~160KB routinely exceeds it) is queued internally and finished
// off the event loop. The OLD code (`process.send?.(msg)` followed immediately by `process.exit(0)`
// in every caller) tore the process down before that queued write ever reached the kernel, silently
// DROPPING the message — confirmed by a deterministic repro (a real `fork()`, a 300KB
// `process.send()` immediately followed by `process.exit(0)`): the parent's 'message' listener never
// fires at all, 0/N over repeated runs, while a run finishing in a single synchronous syscall (a
// small payload, an idle host) looks fine — exactly the "160KB OK, 200KB ABORTED" / "worse under
// concurrent load" signature both issues report, since CPU contention under load slows the same
// flush the same way a large payload does. `process.send(msg, callback)` resolves ITS callback only
// once the write actually completes (same empirical repro, fixed: 5/5), so `send()` now returns a
// Promise every caller `await`s before calling `process.exit()` — see `main()` below.
//
// #158 F4 / #163 B1 / #162 B (fix-of-the-fix): the callback is the PRIMARY signal and fires on
// success OR on the channel having failed (parent crash/SIGKILL -> EPIPE/ECONNRESET on the next
// write attempt) — there is no case where this child has more to do and the callback just never
// comes. The original 2000ms bound was reasoned about as "a parent that vanished mid-write", but a
// real-engine check under concurrent load (~150 sandbox forks + ~48 pi children, no global
// backpressure) showed the PARENT's own process, not this child, stalling for 6-8+ seconds at a
// time — `process.send()`'s queued OS-level write doesn't complete until the parent's event loop
// actually drains its end of the socket, so a 2s bound routinely fired while the write was still
// genuinely in flight (not abandoned), and the `process.exit()` right after it then dropped that
// queued write for real. `SEND_FLUSH_TIMEOUT_MS` is now a hung-parent valve only (the parent is
// truly gone and will never read again), not a flush deadline — set long enough that it is never
// confused with ordinary contention, never so long that a genuinely abandoned child lingers.
const SEND_FLUSH_TIMEOUT_MS = 60_000;

function rawSend(msg: unknown): Promise<void> {
  return new Promise((resolve) => {
    if (typeof process.send !== 'function') { resolve(); return; }
    let done = false;
    const finish = (): void => { if (!done) { done = true; resolve(); } };
    const bound = setTimeout(finish, SEND_FLUSH_TIMEOUT_MS);
    bound.unref?.();
    // The callback fires once the message is actually written (success OR the channel having
    // failed) — either way there is nothing more this child can do, so both resolve the same way.
    process.send(msg, () => { clearTimeout(bound); finish(); });
  });
}

// g2 minor (sandbox robustness sweep, item 4): `send()` is now the RUN-TERMINATING path only —
// 'ready'/'phase' (small literals, never unserializable in practice) and the run's own final
// 'done'/'error' (child-entry.ts's `main()` already pre-checks 'done' with JSON.stringify; 'error'
// envelopes are small catalogued literals this process built itself). `trySend` below is the one
// non-terminating path: an agent()/workflow() call REQUEST, whose opts/args are script-authored
// values that can carry the same shape (a circular reference, a BigInt) — for THAT case the failure
// must reject the one call, not end the run (see `trySend`'s own doc).
//
// Returns a Promise so every caller can wait for the write to actually flush before exiting the
// process (issues #162 B / #163 B1 above) — never rejects; every failure path resolves once it has
// done everything it can.
async function send(msg: unknown): Promise<void> {
  try {
    await rawSend(msg);
  } catch (e) {
    // issue #162 A/B: `process.send()` throws SYNCHRONOUSLY when its argument is not
    // JSON-serializable (a circular reference, a BigInt) — Node's own IPC 'json' serialization,
    // with a raw stack trace through `node:internal/child_process/serialization` (file paths, line
    // numbers, the running Node version: internal engine implementation details). Before this, that
    // throw was never caught anywhere — every caller of `send()` is itself called from `main()`,
    // which is invoked un-awaited (`void main(msg)` below) — so it became an UNHANDLED REJECTION in
    // this child process, which Node's default handling can turn into a crash, printing that raw
    // stack to stderr; `host.ts`'s `stderrTail` then spliced it verbatim into the caller-visible
    // ABORTED message (a trust-boundary leak — see host.ts's `sanitizeStderrTail` for the second,
    // defense-in-depth layer of this same fix). Falls back to a SANITIZED, catalogued error carrying
    // no stack/internal path; a second `process.send` failure (the sanitized object is a small plain
    // literal and should never itself be unserializable) is swallowed — there is genuinely nothing
    // more this process can do, and it still exits below.
    const runId = (msg as { runId?: unknown } | null)?.runId;
    try {
      await rawSend({
        t: 'error',
        runId,
        error: { code: 'RESULT_NOT_SERIALIZABLE', message: `a value sent to the parent is not JSON-serializable: ${safeMessage(e)}` },
      });
    } catch {
      /* already sanitized; nothing more to do */
    }
  }
}

/** g2 minor item 4: a NON-terminal outbound message — today, only an agent()/workflow() call
 *  REQUEST — whose payload fails Node's IPC 'json' serialization. Before this fix, `send()`'s single
 *  generic catch treated this identically to a failure sending the run's own final result: it ended
 *  the WHOLE RUN with `RESULT_NOT_SERIALIZABLE`, even though the actual defect is entirely local to
 *  the script's own `agent()`/`workflow()` call (a circular or BigInt value the script itself built
 *  and handed to one call) and is exactly the kind of recoverable, catalogued failure a script's own
 *  `try/catch` is supposed to be able to handle (same precedent as a BUDGET_EXCEEDED refusal,
 *  IT-140). Returns `true` on success, or the coded failure to reject that one call with — never
 *  sends the run-terminating fallback and never touches `process.exit`. */
function trySend(msg: unknown): true | { code: string; message: string } {
  try {
    process.send?.(msg);
    return true;
  } catch (e) {
    return { code: 'RESULT_NOT_SERIALIZABLE', message: `the value passed to this call is not JSON-serializable: ${safeMessage(e)}` };
  }
}

process.on('message', (msg: InMsg) => {
  switch (msg.t) {
    case 'agentResult': {
      if (msg.spent !== undefined) spentSoFar = msg.spent;
      const p = pendingAgent.get(msg.callSeq);
      if (!p) return;
      pendingAgent.delete(msg.callSeq);
      p.resolve(msg.value);
      return;
    }
    case 'agentThrow': {
      // 'agentThrow' correlates by callSeq to EITHER a pending agent() or a pending workflow()
      // call (DES-006: one shared throw-signal for budget/nesting/unknown-name errors) — the two
      // pending maps share the same callSeq counter, so exactly one of them holds this entry.
      const p = pendingAgent.get(msg.callSeq) ?? pendingWorkflow.get(msg.callSeq);
      if (!p) return;
      pendingAgent.delete(msg.callSeq);
      pendingWorkflow.delete(msg.callSeq);
      // v25 (DES-169, REQ-120, issue #63): the catalog code is written to BOTH `code` and `name`.
      // Until now only `name` was set, so the guide's own recovery example
      // (`if (e.code !== 'BUDGET_EXCEEDED') throw e;`) rethrew every time — a script following the
      // documentation failed the run in exactly the case it was told it could handle. `.code` is
      // what every other surface of this engine uses for a catalog code (`run_result.error.code`,
      // `reasonCode`, `ipcErrorCode`), so it is the field the script gets too. `name` STAYS: it has
      // been the only handle scripts had, `String(e)` renders from it, and `refusalCode()` in
      // guards.ts reads it. Every refusal a script can catch off this seam is fixed at this one
      // line — BUDGET_EXCEEDED from agent(), and NESTING_DEPTH_EXCEEDED / NESTING_CYCLE /
      // DESCENDANT_CAP_EXCEEDED from workflow() (which additionally re-wrap in a GuardError).
      // v36 (DES-248, ARCH-165, TASK-246): mark BEFORE reject — the ref rides on THIS object's
      // identity, so a script that catches and rethrows it (even after forging `e.refusalRef = 99`
      // on the object) still surfaces the map's answer, never the forgery.
      const rejectErr = Object.assign(new Error(msg.error.message), { name: msg.error.code, code: msg.error.code });
      markEngineRefusal(rejectErr, msg.callSeq);
      p.reject(rejectErr);
      return;
    }
    case 'workflowResult': {
      const p = pendingWorkflow.get(msg.callSeq);
      if (!p) return;
      pendingWorkflow.delete(msg.callSeq);
      p.resolve(msg.value);
      return;
    }
    case 'abort':
      process.exit(0);
      break;
    case 'start':
      if (msg.spent !== undefined) spentSoFar = msg.spent;
      void main(msg);
      break;
  }
});

async function main(msg: StartMsg): Promise<void> {
  // v26 (DES-182, ARCH-118, ADR-037): `total`/`spent()`/`remaining()` are USD (the alias/unit the
  // architecture keeps on these three names); `limits`/`tokens()` are the new accessors — a
  // tokens-only budget shows up as `limits.usd === null` / `total === null` / `remaining() ===
  // null` (never `Infinity` — see `SandboxBudget`'s own doc) while `limits.tokens` is a number.
  // Built via a NAMED, explicitly-typed variable (not an inline object literal in `api` below) so
  // its extra fields over `Budget` (`SandboxApi.budget`'s own declared type) don't trip TS's
  // excess-property check.
  const limits = { usd: msg.budget?.usd ?? null, tokens: msg.budget?.tokens ?? null };
  const sandboxBudget: SandboxBudget = {
    limits,
    total: limits.usd,
    spent: () => spentSoFar.usd,
    remaining: () => (limits.usd === null ? null : limits.usd - spentSoFar.usd),
    tokens: () => {
      const t = spentSoFar.tokens;
      return { ...t, sum: t.input + t.output + t.cacheRead + t.cacheWrite };
    },
  };

  const api: SandboxApi = {
    async agent(prompt: string, opts?: unknown): Promise<unknown> {
      const callSeq = nextCallSeq++;
      const result = new Promise<unknown>((resolve, reject) => pendingAgent.set(callSeq, { resolve, reject }));
      // g2 minor item 4: a non-serializable `opts` (circular reference, BigInt) rejects THIS call —
      // the pending entry is removed (nothing will ever resolve/reject it over IPC) and the error is
      // thrown synchronously, which an `async` function turns into a rejected `result` for the
      // caller's own try/catch — never a run-terminating message.
      const sent = trySend({ t: 'agent', runId: msg.runId, callSeq, prompt, opts: opts ?? {} });
      if (sent !== true) {
        pendingAgent.delete(callSeq);
        throw Object.assign(new Error(sent.message), { name: sent.code, code: sent.code });
      }
      return result;
    },
    args: msg.args,
    budget: sandboxBudget,
    async workflow(nameOrRef: unknown, wfArgs?: unknown): Promise<unknown> {
      const callSeq = nextCallSeq++;
      const result = new Promise<unknown>((resolve, reject) => pendingWorkflow.set(callSeq, { resolve, reject }));
      // g2 minor item 4: same non-terminal handling as agent() above — a non-serializable `wfArgs`
      // rejects THIS workflow() call only.
      const sent = trySend({ t: 'workflow', runId: msg.runId, callSeq, ref: nameOrRef, args: wfArgs });
      if (sent !== true) {
        pendingWorkflow.delete(callSeq);
        throw Object.assign(new Error(sent.message), { name: sent.code, code: sent.code });
      }
      return result;
    },
    phase(title: string): void {
      // g2 minor item 4: `phase()` is synchronous (void), not awaited — a non-serializable `title`
      // (typed `string` at compile time only; a script can hand it anything at runtime) rejects
      // THIS call synchronously, same non-terminal handling as agent()/workflow() above, never the
      // run-terminating send().
      const sent = trySend({ t: 'phase', runId: msg.runId, title });
      if (sent !== true) {
        throw Object.assign(new Error(sent.message), { name: sent.code, code: sent.code });
      }
    },
  };

  // F-2 (defense in depth): `evaluateScript` classifies every script-thrown value internally (its
  // own try/catch, hardened not to itself throw on a non-stringifiable thrown value — see guards.ts
  // `safeMessage`) and is expected to always RESOLVE with a `ScriptResult`, never reject. This
  // wrapper is the second, independent layer: if some future regression (or an unanticipated failure
  // during `vm.createContext`/context setup, before the script's own try/catch is even entered) ever
  // makes it reject anyway, that exception must not propagate out of `main()` uncaught — `main()` is
  // invoked un-awaited (`void main(msg)` below), so an uncaught rejection here would crash this child
  // process the same way issue #162's `send()` throw once did. Always yields SCRIPT_ERROR, with the
  // SAME safe, fixed-fallback message extraction guards.ts uses (inlined — this module does not
  // resolve local `.js`→`.ts` value imports, see the `checkMeta` note in guards.ts).
  let result: Awaited<ReturnType<typeof evaluateScript>>;
  try {
    result = await evaluateScript(msg.script, api);
  } catch (e) {
    result = { kind: 'error', error: { code: 'SCRIPT_ERROR', message: safeMessage(e) } };
  }
  if (result.kind === 'done') {
    // issue #162 A/B: an explicit pre-check (mirrors guards.ts's own MAX_SCRIPT_BYTES pattern) —
    // computing `JSON.stringify` here ALSO catches a circular/BigInt return value with a controlled
    // code+message for the single most common case (the script's own `return`), rather than relying
    // only on `send()`'s generic catch above (which still covers every OTHER outbound message).
    let serialized: string;
    try {
      serialized = JSON.stringify(result.value) ?? 'null';
    } catch (e) {
      await send({ t: 'error', runId: msg.runId, error: { code: 'RESULT_NOT_SERIALIZABLE', message: `the returned value is not JSON-serializable: ${e instanceof Error ? e.message : String(e)}` } });
      process.exit(0);
      return;
    }
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > MAX_RESULT_BYTES) {
      await send({ t: 'error', runId: msg.runId, error: { code: 'RESULT_TOO_LARGE', message: `the returned value is ${bytes} bytes, exceeding the ${MAX_RESULT_BYTES}-byte return-value cap` } });
      process.exit(0);
      return;
    }
    // issues #162 B / #163 B1: `send()` above is now ALWAYS awaited before `process.exit()` — see
    // `rawSend`'s own doc for why a large/under-contention write that hasn't yet reached the kernel
    // must not be torn down by an immediate exit.
    await send({ t: 'done', runId: msg.runId, result: result.value });
  } else {
    // v36 (DES-248): `refusalRef` hoisted to a SIBLING of `error` on the wire — `host.ts`'s
    // `RunOutcome` reads `msg.refusalRef`, not a nested field, so the parent ledger lookup at
    // settle time has a plain number to key on.
    await send({ t: 'error', runId: msg.runId, error: result.error, ...(result.error?.refusalRef !== undefined ? { refusalRef: result.error.refusalRef } : {}) });
  }
  process.exit(0);
}

// Tell the parent we're ready to receive the 'start' message (avoids a lost-message race
// where the parent sends before this process has attached its 'message' listener). Fire-and-forget
// is fine here — unlike the run-terminating sends in `main()` above, nothing exits right after this.
void send({ t: 'ready' });
