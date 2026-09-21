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
  | { kind: 'run.terminal'; runId: string; name: string | null; version: string; outcome: string; principal: string | null; code?: string };

export type EventSink = (event: EngineEvent) => void;

/** `write` defaults to `console.log`, `now` to a bare ISO timestamp — every existing
 *  `new RunManager(...)` / `new WorkflowCatalog(...)` site keeps compiling with no sink passed. */
export function createEventSink(deps: {
  secrets?: SecretValueProvider;
  write?: (line: string) => void;
  now?: () => string;
}): EventSink {
  const write = deps.write ?? ((line: string) => console.log(line));
  const now = deps.now ?? (() => new Date().toISOString());
  return (event: EngineEvent) => {
    const line = JSON.stringify(redact({ ...event, at: now() }, deps.secrets?.entries() ?? []));
    write(line);
  };
}
