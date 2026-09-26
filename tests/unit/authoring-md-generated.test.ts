// UT-160 (DES-157, v24): docs/AUTHORING.md is GENERATED from buildAuthoringGuide() — a drift
// lock (oracle-from-code), not hand-maintained. Written test-first (Gate 5, RED) —
// scripts/gen-authoring-md.ts does not exist yet, and today's docs/AUTHORING.md is hand-written
// (v23), so it will not byte-match a builder that doesn't exist.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildAuthoringGuide } from '../../src/authoring-guide.js';
// v25 (DES-168, REQ-120): same rule for the per-run fan-out width the guide now states — this lock
// must pass the DOCUMENTED default, not a literal, or it locks a different document than the one
// `npm run gen:authoring` writes.
import { DEFAULT_RUN_CONCURRENCY } from '../../src/run-manager.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('docs/AUTHORING.md is generated, not hand-maintained (UT-160, DES-157)', () => {
  // 2026-09-26 (alias mechanism removed): the model-ref rule is now static text — no per-deployment
  // alias table to interpolate, so this lock no longer needs one.
  it('docs/AUTHORING.md byte-equals buildAuthoringGuide() over the SAME resolved ceilings DEPLOY.md documents', () => {
    const onDisk = readFileSync(join(ROOT, 'docs/AUTHORING.md'), 'utf-8');
    const generated = buildAuthoringGuide({ maxTimeoutMs: 600000, maxAppendPromptBytes: 1024, maxEffort: 'high', runConcurrency: DEFAULT_RUN_CONCURRENCY });
    expect(onDisk).toBe(generated);
  });
});
