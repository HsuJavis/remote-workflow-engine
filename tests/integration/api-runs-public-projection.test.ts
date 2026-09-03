// IT-121 (DES-162, v24): toPublicRunView(view) strips `principal` (and the general rule —
// principal/adminReads/pushedBy/createdBy/claimedBy never serialize over an UNGATED /api/* route);
// MCP run_status still carries adminReads for the owner. Written test-first (Gate 5, RED) —
// toPublicRunView does not exist yet.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// @ts-expect-error — toPublicRunView does not exist yet (v24 DES-162/TASK-147)
import { toPublicRunView } from '../../src/run-view.js';

const SERVER_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/server.ts'), 'utf-8');

describe('toPublicRunView — no identity field on an ungated /api/* route (IT-121, DES-162)', () => {
  it('strips principal from a RunStatusView, keeping every other field', () => {
    const view = { runId: 'r1', status: 'completed', principal: 'bob@x.com', phases: [], agents: [] };
    const publicView = toPublicRunView(view);
    expect(publicView).not.toHaveProperty('principal');
    expect(publicView.runId).toBe('r1');
  });

  it('adminReads is never on the input (DES-151 attaches it only at the MCP facade projection) and stays absent on output', () => {
    const view = { runId: 'r1', status: 'completed', phases: [], agents: [] };
    const publicView = toPublicRunView(view);
    expect(publicView).not.toHaveProperty('adminReads');
  });

  it('source-text guard: no /api/ handler in server.ts serializes createdBy|claimedBy|pushedBy', () => {
    // A crude but real guard over the dispatchDashboard function body — sendJson calls carrying
    // one of these raw field names would be a leak; today this is vacuously true (they don't
    // exist yet), a legitimate green regression pin that v24 must not break.
    expect(SERVER_SRC).not.toMatch(/sendJson\([^)]*\b(createdBy|claimedBy|pushedBy)\b/);
  });
});
