// getTriggerBindings (TASK-115, DES-128, ARCH-078): one projected cross-store snapshot over three
// narrow ports (schedules/webhooks/continuations) plus a `runs` port for the chain-upstream join,
// composed into `{bindings, bindingsFp}`. The `webhooks` port type carries NO `secret`, NO `id` —
// enforced in the TYPE, because this snapshot is fed into an LLM prompt (the graph analyzer) and a
// gate downstream would stop it reaching the diagram but nothing would stop it reaching the provider.
import { createHash } from 'node:crypto';

export interface TriggerPorts {
  schedules: { listByWorkflow(name: string): Array<{ cron: string; tz?: string; enabled: boolean }> };
  // NO secret, NO id — in the TYPE: `secret`/`id` pinned to `never` so a port returning them is a
  // tsc error, not merely an excess-property lint (a method-signature return position does not get
  // TypeScript's fresh-object-literal excess-property check the way a direct literal assignment does).
  webhooks: { listByWorkflow(name: string): Array<{ enabled: boolean; secret?: never; id?: never }> };
  continuations: { listPendingByWorkflow(name: string): Array<{ afterRunId: string }> };
  runs: { getWorkflowName(runId: string): string | null };
}

export type TriggerBinding =
  | { kind: 'cron'; cron: string; tz?: string; enabled: boolean }
  | { kind: 'webhook'; enabled: boolean }
  | { kind: 'chain'; upstreamWorkflow: string | null };

/** Fixed JSON key order per binding kind — `JSON.stringify` on an object literal already preserves
 *  insertion order, so each branch just needs to be written with a stable key order; `null` is
 *  serialised explicitly (never omitted), so a named upstream and an unnamed one fingerprint apart. */
function canonicalize(b: TriggerBinding): string {
  switch (b.kind) {
    case 'cron':
      return JSON.stringify({ kind: b.kind, cron: b.cron, tz: b.tz ?? null, enabled: b.enabled });
    case 'webhook':
      return JSON.stringify({ kind: b.kind, enabled: b.enabled });
    case 'chain':
      return JSON.stringify({ kind: b.kind, upstreamWorkflow: b.upstreamWorkflow });
  }
}

export function getTriggerBindings(name: string, ports: TriggerPorts): { bindings: TriggerBinding[]; bindingsFp: string } {
  const bindings: TriggerBinding[] = [
    ...ports.schedules.listByWorkflow(name).map((s): TriggerBinding => ({ kind: 'cron', cron: s.cron, tz: s.tz, enabled: s.enabled })),
    ...ports.webhooks.listByWorkflow(name).map((w): TriggerBinding => ({ kind: 'webhook', enabled: w.enabled })),
    ...ports.continuations
      .listPendingByWorkflow(name)
      .map((c): TriggerBinding => ({ kind: 'chain', upstreamWorkflow: ports.runs.getWorkflowName(c.afterRunId) })),
  ];
  // Sort the CANONICAL strings themselves (not a coarser key) so a different read order produces the
  // identical bindingsFp even for rows a coarser (kind, cron, upstream) key can't distinguish (e.g.
  // two webhook bindings differing only in `enabled`, or two cron rows sharing a cron but differing
  // in `tz`/`enabled`) — a coarser key would leave the fp flapping on exactly those ties.
  const canonical = bindings.map(canonicalize).sort();
  const bindingsFp = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return { bindings, bindingsFp };
}
