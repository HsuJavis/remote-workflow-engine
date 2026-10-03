// DES-243 (ARCH-159, TASK-241, REQ-213): one typed operational-event sink. Redaction lives HERE,
// not in the emitters — the only way two emitters in two modules (workflow-catalog.ts,
// run-manager.ts) share one audited path. The union is closed on purpose: exactly the four kinds
// v36 emits; a v37 kind is a v37 edit.
import { redact, type SecretValueProvider } from './secret-resolver.js';

export type AuditActor = { id: string | null; bypass: boolean; idSource: 'authenticated' | 'claimed' | 'none' };

export type EngineEvent =
  | { kind: 'catalog.register'; name: string; version: string; actor: AuditActor }
  // Issue #98 item 8: `version` is `string | null` — `workflow_publish({version:null})` clears a
  // channel, and this is the same event `catalog.publish()` (workflow-catalog.ts) emits for that.
  | { kind: 'catalog.publish'; name: string; version: string | null; channel: string; fromVersion: string | null; actor: AuditActor }
  | { kind: 'catalog.deregister'; name: string; version: string; actor: AuditActor }
  | { kind: 'run.terminal'; runId: string; name: string | null; version: string; outcome: string; principal: string | null; code?: string }
  // v37 (ARCH-178, DES-256, TASK-253, REQ-218, ADR-083 owner_decision posture C): the confinement
  // POLICY applied to one agent() attempt — OUR data, unconditional, emitted once per attempt from
  // the object `buildBashConfinement()` (or the unconfined `{enabled:false}`) just returned. `posture`
  // is the field this iteration exists for: an operator reading the log can tell CONFINED from
  // UNCONFINED without inferring it from `enabled`/`allowWrite`, which a 'confined'-but-no-workspace
  // call can also report empty (ARCH-176's own bug class: two different reasons must not read the
  // same). No `AuditActor` — this is an engine fact, not a principal-attributable action.
  // pi harness v1 (spec "Transcript and harness record"): `sdkVersion` is Claude-Agent-SDK-specific
  // (UT-318 pins it to the INSTALLED @anthropic-ai/claude-agent-sdk package.json version) and stays
  // required+unchanged for that gateway. `harnessVersion` is the pi-gateway's own equivalent (the
  // PINNED @earendil-works/pi-coding-agent version, harness-info.ts's PI_HARNESS_VERSION) — a
  // DIFFERENT field, not a renamed one, because the two numbers answer different questions (which
  // SDK CLI vs which pi package) and a reader should never have to guess which gateway produced a
  // given line from an overloaded field. `sdkVersion` widened to optional only so a pi-gateway
  // emission (which has no SDK version at all) is a valid line of this same event shape rather than
  // needing a parallel event kind — every existing sdk-gateway emission is unaffected (it always sets
  // `sdkVersion`, never `harnessVersion`).
  | { kind: 'agent.confinement'; runId: string; agentId: string; attempt: number; posture: 'confined' | 'unconfined'; root?: string; allowWrite: string[]; denyRead: string[]; enabled: boolean; failIfUnavailable: boolean; sdkVersion?: string; harnessVersion?: string }
  // Project configuration (PROJECT_CONFIG_PATHS, bash-confinement.ts) found in the run workspace and
  // removed before this attempt's CLI could load it — something planted it; an operator should know.
  | { kind: 'agent.planted_config_removed'; runId: string; agentId: string; attempt: number; root: string; removed: string[] }
  // send-back item 2 (verify-b, 2026-09-26): raw CLI stderr (Options.stderr, sdk.d.ts ~L1896),
  // bounded to the last 4KB, emitted ONLY on a failed attempt — a "num_turns:0"/opaque
  // `error_during_execution` terminal used to be undiagnosable from the run's own record; this line
  // gives an operator the CLI's own words. Redacted like every other EngineEvent (createEventSink
  // below), never a raw console.error — the only route that would bypass redaction.
  | { kind: 'agent.stderr'; runId: string; agentId: string; attempt: number; tail: string }
  // Issue #106: a declared MCP server was not usable on the session's first turn (not `connected`
  // in the CLI's `system/init`, or none of its tools listed there) — same fact as the harness
  // record's `MCP_SERVER_NOT_CONNECTED` warning, on the operator's journal.
  | { kind: 'agent.mcp_not_connected'; runId: string; agentId: string; attempt: number; server: string; status: string; tools: number };

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
