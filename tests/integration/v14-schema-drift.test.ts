// IT-077 (DES-086, DES-087, DES-089, DES-090, ARCH-054, ARCH-055, ARCH-057, ARCH-058, TASK-080..084):
// Schema drift-lock for all v14 tool schema changes. Asserts structured facts over the SERVED
// tools/list (not the raw TOOL_DEFS object) — the same pattern as IT-072 / seedref-schema-drift.
//
// DES-089: asset_push kind description must name HOOKS_UNSUPPORTED and mcp_provision.
// DES-090: workflow_run must NOT advertise scriptSha256 (nor script) — v22 adjudication #3 (M-6):
//          REQ-085 is SUPERSEDED and REQ-098 closed inline script, so this lock inverted from
//          presence to absence rather than being retired.
// DES-087: workflow_run description or property description names seedManifestRef, SEED_SOURCE_CONFLICT,
//           /assets/manifest (cross-reference to the dark REST endpoint).
// DES-086: blob_put description names /assets/blob/ and BLOB_SHA_MISMATCH (the streaming alternative).
//          seed_plan description names /assets/manifest (next-step cross-reference).
//
// Cases (all RED before implementation):
//   1. asset_push kind description contains 'HOOKS_UNSUPPORTED'
//   2. asset_push kind description contains 'mcp_provision'
//   3. workflow_run has NO scriptSha256 property in inputSchema.properties  [inverted, v22 M-6]
//   4. workflow_run has NO script property in inputSchema.properties        [inverted, v22 M-6]
//   5. no workflow_run property description still advertises 'SCRIPT_SHA_MISMATCH' [inverted, v22 M-6]
//   6. workflow_run has seedManifestRef in description OR in properties
//   7. workflow_run description (or seedManifestRef property description) names 'SEED_SOURCE_CONFLICT'
//   8. workflow_run description (or seedManifestRef property description) names '/assets/manifest'
//   9. blob_put description names '/assets/blob/' (route cross-reference)
//  10. blob_put description names 'BLOB_SHA_MISMATCH' (error code of streaming route, NOT BLOB_HASH_MISMATCH)
//  11. seed_plan description names '/assets/manifest' (next-step cross-reference per DES-087)
//
// Trivially passing (pre-existing content):
//   None for the v14 cases above — all are new.
//
// Red reason: server.ts TOOL_DEFS does not yet have:
//   - scriptSha256 property on workflow_run
//   - seedManifestRef cross-reference in workflow_run description
//   - HOOKS_UNSUPPORTED/mcp_provision in asset_push kind description
//   - /assets/blob/ or BLOB_SHA_MISMATCH in blob_put description
//   - /assets/manifest in seed_plan description
// → served tools/list shows the old schema → all structured-fact assertions fail.
//
// Mock policy (integration — DES-091): real `createServer` + real HTTP tools/list round trip.
//   No SUT-boundary mocks (same pattern as IT-072 / seedref-schema-drift.test.ts).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let workRoot: string;
let toolsMap: Record<string, { description: string; inputSchema: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }> } }>;

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it077-'));
  server = await createServer({ workRoot });

  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const body = await res.json() as { result?: { tools?: Array<{ name: string; description: string; inputSchema: any }> } };
  toolsMap = Object.fromEntries(
    (body.result?.tools ?? []).map((t) => [t.name, { description: t.description, inputSchema: t.inputSchema }]),
  );
});

afterAll(async () => {
  await server?.close?.();
  rmSync(workRoot, { recursive: true, force: true });
});

describe('DES-089 — asset_push kind schema honesty (ARCH-057)', () => {
  it('asset_push kind description names HOOKS_UNSUPPORTED', () => {
    const kindProp = toolsMap['asset_push']?.inputSchema?.properties?.['kind'];
    expect(kindProp?.description ?? '').toContain('HOOKS_UNSUPPORTED');
  });

  it('asset_push kind description names mcp_provision as the alternative', () => {
    const kindProp = toolsMap['asset_push']?.inputSchema?.properties?.['kind'];
    expect(kindProp?.description ?? '').toContain('mcp_provision');
  });
});

// v22 adjudication #3 (M-6): this block used to pin the PRESENCE of `scriptSha256` and its
// description. REQ-085 is `[SUPERSEDED v22, owner-confirmed 2026-09-02]` — REQ-098 closed the
// on-the-wire script the sha guarded, so the parameter is unreachable by construction and was
// removed (adjudication #1 K-4). The drift-lock is not retired with it: it INVERTS. A schema-reading
// client must not learn that `script`/`scriptSha256` exist, so their absence is what is pinned now
// (the same property IT-087 locks for v22; kept here too because this file is the v14 schema's own
// lock and a re-added field must fail both).
describe('DES-090 / REQ-085 SUPERSEDED — workflow_run no longer advertises scriptSha256 (ARCH-058, v22 ADR-010/K-4)', () => {
  it('workflow_run has NO scriptSha256 property in inputSchema', () => {
    const props = toolsMap['workflow_run']?.inputSchema?.properties ?? {};
    expect(Object.keys(props)).not.toContain('scriptSha256');
  });

  it('workflow_run has NO script property in inputSchema (REQ-098: inline script is closed)', () => {
    const props = toolsMap['workflow_run']?.inputSchema?.properties ?? {};
    expect(Object.keys(props)).not.toContain('script');
  });

  it('no other advertised workflow_run parameter re-introduces SCRIPT_SHA_MISMATCH as a live contract', () => {
    const propDescs = Object.values(toolsMap['workflow_run']?.inputSchema?.properties ?? {})
      .map((p) => p.description ?? '')
      .join(' ');
    expect(propDescs).not.toContain('SCRIPT_SHA_MISMATCH');
  });
});

describe('DES-087 — workflow_run seedManifestRef cross-reference (ARCH-055)', () => {
  it('workflow_run schema (description or properties) names seedManifestRef', () => {
    const toolDesc = toolsMap['workflow_run']?.description ?? '';
    const props = toolsMap['workflow_run']?.inputSchema?.properties ?? {};
    const hasSeedManifestRef =
      toolDesc.includes('seedManifestRef') ||
      'seedManifestRef' in props ||
      Object.values(props).some((p) => (p.description ?? '').includes('seedManifestRef'));
    expect(hasSeedManifestRef).toBe(true);
  });

  it('workflow_run schema names SEED_SOURCE_CONFLICT (mutual exclusion error code)', () => {
    const toolDesc = toolsMap['workflow_run']?.description ?? '';
    const propDescs = Object.values(toolsMap['workflow_run']?.inputSchema?.properties ?? {})
      .map((p) => p.description ?? '')
      .join(' ');
    expect(toolDesc + ' ' + propDescs).toContain('SEED_SOURCE_CONFLICT');
  });

  it('workflow_run schema names /assets/manifest (dark REST endpoint cross-reference)', () => {
    const toolDesc = toolsMap['workflow_run']?.description ?? '';
    const propDescs = Object.values(toolsMap['workflow_run']?.inputSchema?.properties ?? {})
      .map((p) => p.description ?? '')
      .join(' ');
    expect(toolDesc + ' ' + propDescs).toContain('/assets/manifest');
  });
});

describe('DES-086 — blob_put / seed_plan cross-references to raw endpoints (ARCH-054/055)', () => {
  it('blob_put description names /assets/blob/ (the streaming alternative)', () => {
    const desc = toolsMap['blob_put']?.description ?? '';
    expect(desc).toContain('/assets/blob/');
  });

  it('blob_put description names BLOB_SHA_MISMATCH (error code of streaming route)', () => {
    const desc = toolsMap['blob_put']?.description ?? '';
    // Note: blob_put uses BLOB_HASH_MISMATCH for its own path; the streaming route is BLOB_SHA_MISMATCH
    // The description should name BLOB_SHA_MISMATCH as the streaming-route error code.
    expect(desc).toContain('BLOB_SHA_MISMATCH');
  });

  it('seed_plan description names /assets/manifest (next-step cross-reference per DES-087)', () => {
    const desc = toolsMap['seed_plan']?.description ?? '';
    expect(desc).toContain('/assets/manifest');
  });
});

describe('DES-088 — workflow_agent_log secret-marker doc (ARCH-056, TASK-082)', () => {
  // DRIFT-LOCK: workflow_agent_log description MUST contain the exact ‹secret:NAME› asymmetry
  // sentence per DES-088 consumability (orchestrator decision, option-a: add+test).
  // Exit-gate rule 3: untested doc is silently driftable; this assertion pins the exact phrase.
  it('workflow_agent_log description contains the secret-marker asymmetry sentence', () => {
    const desc = toolsMap['workflow_agent_log']?.description ?? '';
    expect(desc).toContain('Secret values are replaced with ‹secret:NAME› markers in persisted transcripts.');
  });
});
