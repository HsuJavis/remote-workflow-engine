// Issue #82 (partial): `schedule_create({kind:'once', at, seed:[…]})` returned success and the seed
// was discarded — a fired run then had an empty workspace, with nothing on the create reply to say
// so. Neither trigger-creating tool (schedule_create / webhook_create) carries a seed today, so each
// of the four run_start seed keys is refused INVALID_ARGUMENT with the reason and the alternative
// (a workflow-owned asset via workspace_push), and the store's create() is never reached.
// Also pinned: both schemas are CLOSED, so the NEXT undeclared key is refused instead of dropped.
//
// Mock policy (unit): callTool over a fake scheduler/webhook store that records create() calls.
import { describe, it, expect, vi } from 'vitest';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';

type Envelope = { code?: string; error?: { code?: string; message?: string }; result?: unknown };

function depsWith() {
  const scheduleCreate = vi.fn().mockResolvedValue({ result: { id: 's1' } });
  const webhookCreate = vi.fn().mockResolvedValue({ webhookId: 'w1', secret: 'x' });
  const deps = {
    scheduler: { create: scheduleCreate },
    webhooks: { create: webhookCreate },
    webhookBaseUrl: 'http://127.0.0.1:0',
    lookup: {},
    audit: {},
  } as unknown as ToolDeps;
  return { deps, scheduleCreate, webhookCreate };
}

const SEED_ARGS: Record<string, unknown> = {
  seed: [{ path: 'a.txt', contentB64: 'AAAA' }],
  seedManifest: [{ path: 'b.txt', sha256: '0'.repeat(64) }],
  seedManifestRef: 'abc',
  seedRef: { remote: 'https://example.invalid/r.git', ref: 'main' },
};

describe('#82 — trigger-creating tools refuse seed keys instead of dropping them', () => {
  for (const [key, value] of Object.entries(SEED_ARGS)) {
    it(`schedule_create refuses \`${key}\` with INVALID_ARGUMENT naming the alternative; create() is never called`, async () => {
      const { deps, scheduleCreate } = depsWith();
      const at = new Date(Date.now() + 60_000).toISOString();
      const r = (await callTool(deps, 'schedule_create', { kind: 'once', at, [key]: value }, { kind: 'auth-disabled' })) as Envelope;
      expect(scheduleCreate).not.toHaveBeenCalled();
      expect(r.code).toBe('INVALID_ARGUMENT');
      expect(r.error?.message).toContain(key);
      expect(r.error?.message).toMatch(/cannot carry a seed/);
      expect(r.error?.message).toContain('workspace_push');
    });

    it(`webhook_create refuses \`${key}\` the same way`, async () => {
      const { deps, webhookCreate } = depsWith();
      const r = (await callTool(deps, 'webhook_create', { [key]: value }, { kind: 'auth-disabled' })) as Envelope;
      expect(webhookCreate).not.toHaveBeenCalled();
      expect(r.code).toBe('INVALID_ARGUMENT');
      expect(r.error?.message).toMatch(/cannot carry a seed/);
      expect(r.error?.message).toContain('workspace_push');
    });
  }

  it('both schemas are closed: an arbitrary undeclared key is refused, not silently dropped', async () => {
    const { deps, scheduleCreate, webhookCreate } = depsWith();
    const s = (await callTool(deps, 'schedule_create', { cron: '0 3 * * *', bogus: 1 }, { kind: 'auth-disabled' })) as Envelope;
    const w = (await callTool(deps, 'webhook_create', { bogus: 1 }, { kind: 'auth-disabled' })) as Envelope;
    expect(s.code).toBe('INVALID_ARGUMENT');
    expect(w.code).toBe('INVALID_ARGUMENT');
    expect(scheduleCreate).not.toHaveBeenCalled();
    expect(webhookCreate).not.toHaveBeenCalled();
  });

  it('the declared keys still pass: schedule_create {kind,at,enabled,tz,args} and webhook_create {enabled}', async () => {
    const { deps, scheduleCreate, webhookCreate } = depsWith();
    const at = new Date(Date.now() + 60_000).toISOString();
    await callTool(deps, 'schedule_create', { kind: 'once', at, enabled: true, tz: 'UTC', args: { x: 1 } }, { kind: 'auth-disabled' });
    await callTool(deps, 'webhook_create', { enabled: false }, { kind: 'auth-disabled' });
    expect(scheduleCreate).toHaveBeenCalledTimes(1);
    expect(webhookCreate).toHaveBeenCalledTimes(1);
    expect(webhookCreate.mock.calls[0]![0]).toMatchObject({ enabled: false });
  });
});
