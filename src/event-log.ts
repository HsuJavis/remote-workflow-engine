// DES-243 (ARCH-159, TASK-241, REQ-213): one typed operational-event sink. Redaction lives HERE,
// not in the emitters — the only way two emitters in two modules (workflow-catalog.ts,
// run-manager.ts) share one audited path. The union is closed on purpose: exactly the four kinds
// v36 emits; a v37 kind is a v37 edit.
import { redact, type SecretValueProvider } from './secret-resolver.js';

export type AuditActor = { id: string | null; bypass: boolean; idSource: 'authenticated' | 'claimed' | 'none' };

export type EngineEvent =
  | { kind: 'catalog.register'; name: string; version: string; actor: AuditActor }
  | { kind: 'catalog.publish'; name: string; version: string; channel: string; fromVersion: string | null; actor: AuditActor }
  | { kind: 'catalog.deregister'; name: string; version: string; actor: AuditActor }
  | { kind: 'run.terminal'; runId: string; name: string | null; version: string; outcome: string; principal: string | null; code?: string }
  // v37 (ARCH-178, DES-256, TASK-253, REQ-218, ADR-083 owner_decision posture C): the confinement
  // POLICY applied to one agent() attempt — OUR data, unconditional, emitted once per attempt from
  // the object `buildBashConfinement()` (or the unconfined `{enabled:false}`) just returned. `posture`
  // is the field this iteration exists for: an operator reading the log can tell CONFINED from
  // UNCONFINED without inferring it from `enabled`/`allowWrite`, which a 'confined'-but-no-workspace
  // call can also report empty (ARCH-176's own bug class: two different reasons must not read the
  // same). No `AuditActor` — this is an engine fact, not a principal-attributable action.
  | { kind: 'agent.confinement'; runId: string; agentId: string; attempt: number; posture: 'confined' | 'unconfined'; root?: string; allowWrite: string[]; denyRead: string[]; enabled: boolean; failIfUnavailable: boolean; sdkVersion: string };

export type EventSink = (event: EngineEvent) => void;

/** `write` defaults to `console.log`, `now` to a bare ISO timestamp — every existing
 *  `new RunManager(...)` / `new WorkflowCatalog(...)` site keeps compiling with no sink passed. */
export function createEventSink(deps: {
  secrets?: SecretValueProvider;
  write?: (line: string) => void;
  now?: () => string;
}): EventSink {
  const write = deps.write ?? ((line: string) => console.log(line));
  // Timestamps WHEN this audit line was written (never read back for an expired/future decision);
  // the real composition root (server.ts) always passes its own injected `now: () => clock.isoNow()`,
  // so this bare wall-clock fallback fires only when a caller omits `now` entirely.
  const now = deps.now ?? (() => new Date().toISOString()); // det:allow — event-timestamp, not a decision input
  return (event: EngineEvent) => {
    const line = JSON.stringify(redact({ ...event, at: now() }, deps.secrets?.entries() ?? []));
    write(line);
  };
}
