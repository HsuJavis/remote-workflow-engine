// src/authz-refusal.ts (issue #116, OWNER DECISION b): the ONE place that classifies an
// `authorize()` refusal into an audit row + the facts both call-tool.ts (MCP) and server.ts
// (dashboard `allowed()`) need to decide how to shape their OWN response — kept here, not
// duplicated in each, so the "masked ⇒ leave the body untouched" rule (decision a) and the audit
// row's field set cannot drift between the two surfaces.
import type { Principal } from './authz.js';
import type { AuthzVerdict } from './authz.js';
import type { ErrorCode } from './errors.js';
import type { RefusalAuditEvent } from './types.js';

export interface RefusalAuditWriter {
  appendRefusal(ev: RefusalAuditEvent): void;
}

/** The target the caller NAMED (never the resource's real owner — same non-disclosure convention
 *  `authz.ts`'s own refusal messages already follow), derived from the TRUE internal reason so it
 *  is meaningful even when the response was masked. `'none'` for a role/account refusal that names
 *  no specific run/workflow/trigger. */
export function refusalTarget(args: Record<string, unknown>, internalReason: string | undefined): { targetKind: RefusalAuditEvent['targetKind']; targetId: string | null } {
  const str = (k: string): string | undefined => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
  switch (internalReason) {
    case 'NOT_RUN_OWNER': return { targetKind: 'run', targetId: str('runId') ?? null };
    case 'NOT_WORKFLOW_OWNER': return { targetKind: 'workflow', targetId: str('workflow') ?? str('name') ?? null };
    case 'NOT_TRIGGER_OWNER': return { targetKind: 'trigger', targetId: str('id') ?? null };
    case 'WORKFLOW_NOT_ALLOWED': return { targetKind: 'workflow', targetId: str('workflow') ?? str('name') ?? null };
    default: return { targetKind: 'none', targetId: null };
  }
}

/** `'service-account'` when the caller's id is a service account's own `sa:<name>` client id (the
 *  convention `authz.ts`'s own doc states — never produced by role resolution for a human
 *  principal), absent otherwise. */
export function authMethodFor(principal: Principal): string | undefined {
  return principal.kind !== 'auth-disabled' && principal.kind !== 'loopback-exempt' && principal.id.startsWith('sa:') ? 'service-account' : undefined;
}

export interface RefusalClassification {
  code: ErrorCode;
  reason: string;
  /** True iff `authz.ts` substituted a `*_NOT_FOUND` code/message for a non-admin caller (decision
   *  a) — the caller MUST NOT add a requestId or any other field to the response body in this
   *  case, or the masking is defeated by the very field meant to help trace it. */
  masked: boolean;
}

/** Writes exactly one audit row for an `authorize()` refusal and returns the facts the caller
 *  needs to shape its OWN response. An audit-write failure is caught and logged here — it NEVER
 *  turns the refusal into a success and NEVER throws back to the caller (the opposite disposition
 *  from `audited-read.ts`'s fail-closed rethrow: there, failing to audit a READ must refuse it
 *  because the read would otherwise proceed unaudited; here, the request is ALREADY refused, so
 *  swallowing the audit-write error cannot smuggle through anything it would not already refuse). */
export function recordRefusal(
  writer: RefusalAuditWriter | undefined,
  requestId: string,
  principal: Principal,
  toolName: string,
  args: Record<string, unknown>,
  verdict: AuthzVerdict,
): RefusalClassification {
  const code = (verdict.code ?? 'FORBIDDEN_ROLE') as ErrorCode;
  const reason = verdict.reason ?? 'refused';
  const internalReason = verdict.internalReason ?? code;
  const masked = internalReason !== code;
  const actor = principal.kind === 'auth-disabled' || principal.kind === 'loopback-exempt' ? null : principal.id;
  const { targetKind, targetId } = refusalTarget(args, internalReason);
  if (writer) {
    try {
      writer.appendRefusal({
        ts: new Date().toISOString(), requestId, actor, ...(actor !== null ? { authMethod: authMethodFor(principal) } : {}),
        tool: toolName, targetKind, targetId, realReason: internalReason, returnedCode: code,
      });
    } catch (err) {
      console.error(JSON.stringify({ event: 'refusal_audit_write_failed', requestId, tool: toolName, error: err instanceof Error ? err.message : String(err) }));
    }
  }
  return { code, reason, masked };
}
