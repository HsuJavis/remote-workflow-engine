// IT (DES-237, ARCH-149, TASK-233, REQ-208): the six REQ-208 non-code cases register CLEAN through
// the REAL `workflow_register` path (`WorkflowCatalog.register`, the same catalog-v24.test.ts
// precedent for "real"), and a genuinely unlabeled `agent(` is still refused with its own real
// line. Written test-first (Gate 5, RED) — `scanAgentCalls` does not consult any span oracle today,
// so every one of these currently trips a spurious `SCAN_VIOLATION`.
//
// Mock policy (integration): real SQLite-backed WorkflowCatalog (better-sqlite3), no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

describe('WorkflowCatalog.register — the six REQ-208 non-code cases register clean (IT, DES-237)', () => {
  let dir: string;
  let catalog: WorkflowCatalog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-it-scan-spans-'));
    catalog = new WorkflowCatalog(dir);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('1. a regex literal containing "agent(" text registers clean', async () => {
    const script = "const re = /agent\\(/;\nphase('main');\nawait agent('real', {});";
    await expect(registerPublished(catalog, 'it208-regex', script)).resolves.toBeDefined();
  });

  it('2. a template ${…} substitution around a real call registers clean', async () => {
    const script = "phase('main');\nconst msg = `result: ${await agent('real', {})}`;";
    await expect(registerPublished(catalog, 'it208-template', script)).resolves.toBeDefined();
  });

  it('3. an escaped quote inside a string registers clean', async () => {
    const script = 'const s = "he said \\"agent (mode A)\\"";\nphase(\'main\');\nawait agent(\'real\', {});';
    await expect(registerPublished(catalog, 'it208-escaped-quote', script)).resolves.toBeDefined();
  });

  it('4. a comment apostrophe near "agent (" text registers clean', async () => {
    const script = "// the author's agent (informal note)\nphase('main');\nawait agent('real', {});";
    await expect(registerPublished(catalog, 'it208-comment', script)).resolves.toBeDefined();
  });

  it('5. the real-world DEPLOY.md recipe: a prompt string embedding "...verifier agent (mode A)..." registers clean', async () => {
    const script = "phase('main');\nawait agent('verifier', { prompt: \"...sdlc-verifier agent (mode A)...\" });";
    await expect(registerPublished(catalog, 'it208-deploy-recipe', script)).resolves.toBeDefined();
  });

  it('6. a sloppy-mode-only script (var let = 1;) registers clean', async () => {
    const script = "var let = 1;\nphase('main');\nawait agent('real', {});";
    await expect(registerPublished(catalog, 'it208-sloppy', script)).resolves.toBeDefined();
  });

  it('regression: a genuinely unlabeled agent( after a literal-heavy prelude is STILL refused SCAN_VIOLATION, with its own real line', async () => {
    const script = "const a = \"agent (fake, not a call)\";\nconst b = /agent\\(/;\nphase('main');\nagent(\"only-one-arg\");";
    await expect(catalog.register({ name: 'it208-genuine-violation', script, mermaid: 'graph LR\na(["only-one-arg"])' }))
      .rejects.toMatchObject({ code: 'SCAN_VIOLATION', detail: expect.objectContaining({ line: 4 }) });
  });
});
