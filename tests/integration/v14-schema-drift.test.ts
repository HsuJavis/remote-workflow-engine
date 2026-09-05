// IT-077 (DES-086, DES-087, DES-088, DES-089, DES-090, ARCH-054, ARCH-055, ARCH-056, ARCH-057,
// ARCH-058, TASK-080..084): schema drift-lock for v14 tool schema changes. Asserts structured
// facts over the SERVED tools/list (not the raw TOOL_DEFS object) — same pattern as IT-072 /
// seedref-schema-drift.
//
// v24 (TASK-152, DES-159): DES-089 (the old push tool's kind naming HOOKS_UNSUPPORTED and the old
// MCP-provisioning tool), DES-090 (run_start's absent scriptSha256/script), and DES-087/DES-086
// (run_start's seedManifestRef cross-reference, the old blob-upload/seed-plan route cross-
// references) are ALL retired with their subject tools: the pre-v24 asset-push, blob-put and
// seed-plan tools and `run_start`'s seed-source arguments do not exist under those names/shapes in
// the v24 tool surface (they fold into `workspace_push`/`workspace_diff` with per-tool modes,
// REQ-108; `run_start.seedNamespace` and the seed-source arguments are dropped, DES-142; the old
// MCP-provisioning tool is deleted outright, ARCH-101). Their drift-lock blocks are removed rather
// than re-pointed at a differently-shaped tool — there is no v24 tool whose kind/description still
// needs to name the retired HOOKS_UNSUPPORTED-on-push code, the old provisioning tool,
// SEED_SOURCE_CONFLICT, `/assets/manifest`, `/assets/blob/` or BLOB_SHA_MISMATCH the way the
// pre-v24 push/blob-put/seed-plan/run_start tools used to.
//
// DES-088 survives unchanged in substance (only the tool's name moved, `workflow_agent_log` ->
// `run_agent_log`, REQ-107): the secret-marker asymmetry sentence documents live redaction
// behaviour (`redact()`, DES-160 confirms it is unchanged in v24) and is still a real drift risk.
//
// Mock policy (integration — DES-091): real `createServer` + real HTTP tools/list round trip.
//   No SUT-boundary mocks (same pattern as IT-072 / seedref-schema-drift.test.ts).

// v24 (batch B, then CLOSED by the integrator — GREEN now): the case here was — a PRODUCT defect. This file's own v24
// header already ruled DES-088 "survives unchanged in substance (only the tool's name moved)": the
// redaction it documents is live (`secret-resolver.ts:95` `MARKER_PREFIX = '‹secret:'`), and
// `run_agent_log` is a live tool — but its v24 description ("Read one agent's harness log for a
// run; a cross-principal read of another principal's run is audited.") dropped the secret-marker
// asymmetry sentence, so the reader of a transcript is no longer told why a value reads as a marker.
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

describe('DES-088 — run_agent_log secret-marker doc (ARCH-056, TASK-082)', () => {
  // DRIFT-LOCK: run_agent_log description MUST contain the exact ‹secret:NAME› asymmetry
  // sentence per DES-088 consumability (orchestrator decision, option-a: add+test).
  // Exit-gate rule 3: untested doc is silently driftable; this assertion pins the exact phrase.
  it('run_agent_log description contains the secret-marker asymmetry sentence', () => {
    const desc = toolsMap['run_agent_log']?.description ?? '';
    expect(desc).toContain('Secret values are replaced with ‹secret:NAME› markers in persisted transcripts.');
  });
});
