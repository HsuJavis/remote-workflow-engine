// Domain error types. Implemented fully — pure value classes, no business logic.

/** A branchable Error carrying a `.code` (surfaced to the calling script via the sandbox IPC's code
 *  derivation — see host.ts ipcErrorCode / child-entry). One shared factory so run-manager, cas-store,
 *  and the tools never drift on the coded-error shape. */
export function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export class NotImplementedError extends Error {
  constructor(name: string) {
    super(`${name}: not implemented`);
    this.name = 'NotImplementedError';
  }
}

export class AgentCapError extends Error {
  constructor() {
    super('Agent count cap (1000) exceeded for this run');
    this.name = 'AgentCapError';
  }
}

export class BudgetExceededError extends Error {
  constructor(spent: number, total: number) {
    super(`Budget exceeded: spent ${spent} >= total ${total}`);
    this.name = 'BudgetExceededError';
  }
}

export class IllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal state transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export class CatalogNotFoundError extends Error {
  constructor(name: string) {
    super(`Workflow not found in catalog: ${name}`);
    this.name = 'CatalogNotFoundError';
  }
}

export class WorkspaceEscapeError extends Error {
  constructor(path: string) {
    super(`Path escapes run workspace: ${path}`);
    this.name = 'WorkspaceEscapeError';
  }
}

/** v22 Gate 6.5 simplify: one shared shaper for "a `catalog.resolve()` call at a create-time
 *  ingress (schedule_create, webhook_create) rejected" — `Scheduler.create()` and
 *  `WebhookRegistry.create()` each hand-rolled this same not-found/coded/unknown ladder
 *  (07-review.md §4.2 H4 + §8.1 second site). `extra` carries the one shape difference between the
 *  two call sites (`Scheduler`'s `{field:'workflow'}`). No separate "err isn't an Error" branch:
 *  `resolve()`'s only real implementation (`WorkflowCatalog`) only ever throws `codedError()`
 *  (always an `Error`) or `CatalogNotFoundError` — optional chaining below folds that
 *  never-actually-happens shape into the same line as the coded-error case instead of carrying an
 *  untestable defensive branch for it (Karpathy: no error handling for unrealistic edge cases). */
export function catalogResolveErrorEnvelope(
  err: unknown,
  workflowName: string,
  extra?: Record<string, unknown>,
): { code: string; message: string } & Record<string, unknown> {
  if (err instanceof CatalogNotFoundError) {
    return { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${workflowName}`, ...extra };
  }
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof e?.code === 'string' && e.code ? e.code : 'INTERNAL_ERROR';
  return { code, message: typeof e?.message === 'string' ? e.message : String(err), ...extra };
}
