// src/owner-lookup.ts (v24 DES-139, ARCH-088, TASK-147 composition wiring): the concrete
// OwnerLookup wired into ToolDeps. authz.ts owns the interface + the pure authorize() decision;
// binding it to the real `runs.principal` / `workflows.owner` / trigger-store `createdBy` columns
// is a composition-root concern, built once in server.ts's createServer() and injected here.
import type { OwnerLookup } from './authz.js';

export interface OwnerLookupDeps {
  /** Synchronous read of one run's owner — `undefined` = no such run, `null` = exists with no
   *  recorded owner (a pre-v15 row). */
  runOwner(runId: string): string | null | undefined;
  /** Synchronous read of one workflow's owner. */
  workflowOwner(name: string): string | null | undefined;
  scheduler: { ownerOf(id: string): string | null | undefined };
  webhooks: { ownerOf(id: string): string | null | undefined };
}

/** `triggerOwner` probes both trigger stores — schedule ids and webhook ids are drawn from
 *  disjoint UUID spaces (DES-139), so scheduler-then-webhooks is total and never ambiguous. */
export function createOwnerLookup(deps: OwnerLookupDeps): OwnerLookup {
  return {
    runOwner: (runId) => deps.runOwner(runId),
    workflowOwner: (name) => deps.workflowOwner(name),
    triggerOwner: (id) => {
      const fromScheduler = deps.scheduler.ownerOf(id);
      if (fromScheduler !== undefined) return fromScheduler;
      return deps.webhooks.ownerOf(id);
    },
  };
}
