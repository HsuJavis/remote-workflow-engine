// R-1 regression (Gate 8 v2 review, quality-dimensions): DEFAULT_ALIASES had drifted across three
// modules (run-manager / main / submission-validator). They now all import the ONE table in
// src/default-aliases.ts. This pins that (a) the shared table is the real-Anthropic-ID version and
// (b) an UNCONFIGURED deployment resolves exactly those default keys — proving the engine validates
// against the same source the gateway routes through, not a stale private copy.
//
// v22 adjudication #3 (M-6): case (b) used to assert through `new SubmissionValidator()`, whose own
// fallback was DEFAULT_ALIASES. REQ-099/ADR-013 moved the alias check to registration
// (`script-checks.ts` via `WorkflowCatalog.register`), and the catalog takes its `aliasNames` by
// injection — so the "same source" claim now holds at exactly ONE place: the composition root
// (server.ts's `aliasNames: new Set(Object.keys(config?.aliases ?? DEFAULT_ALIASES))`). Asserting it
// against a hand-built catalog would test the table against itself, so this case boots a real
// server with NO alias config, which is the deployment shape the claim is about. That makes this one
// case integration-tier in a unit-tier file — deliberate, and cheaper than losing the wiring proof.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
//
// v24 (batch B migration): the FIXTURE moved, the oracle did not. The old fixture registered
// `return agent('t', {model:'<alias>'})` with no `meta` and no diagram — three separate v24
// refusals (`SCAN_VIOLATION`/PARAM_IN_SCRIPT for a param key inside an `agent()` options literal,
// `AGENT_UNDECLARED` for a label with no `meta.params.agents.<label>`, `MERMAID_REQUIRED` for a
// registration with no diagram), none of them about aliases. v24 reads the alias from
// `meta.params.agents.<label>.model.default` (script-checks.ts via `WorkflowCatalog.register`),
// which is exactly where `synthesizeMeta(script, alias)` puts it — so the migrated fixture still
// makes the SAME claim: an unconfigured server resolves every DEFAULT_ALIASES key without
// UNKNOWN_ALIAS, through its own composition root's `aliasNames`.
import { DEFAULT_ALIASES } from '../../src/default-aliases.js';
import { createServer } from '../../src/server.js';
import { synthesizeMeta, synthesizeMermaid, synthesizePhase } from '../helpers/workflow-fixtures.js';

describe('DEFAULT_ALIASES single source (R-1)', () => {
  it('exposes the 4 documented anthropic default aliases with real model IDs (no stale placeholders)', () => {
    expect(Object.keys(DEFAULT_ALIASES).sort()).toEqual(['default', 'haiku', 'opus', 'sonnet']);
    for (const alias of Object.values(DEFAULT_ALIASES)) {
      expect(alias.provider).toBe('anthropic');
    }
    // The stale copy used bare `claude-sonnet`/`claude-haiku`/`claude-opus`; the canonical table
    // carries the pinned real IDs the gateway actually routes.
    expect(DEFAULT_ALIASES.sonnet.model).toBe('claude-3-5-sonnet-20241022');
    expect(DEFAULT_ALIASES.haiku.model).toBe('claude-3-5-haiku-20241022');
    expect(DEFAULT_ALIASES.opus.model).toBe('claude-opus-4-5');
    expect(DEFAULT_ALIASES.default.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('an unconfigured server registers a workflow naming every default alias key (no UNKNOWN_ALIAS)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-r1-'));
    const server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: dir }); // NO aliases config
    try {
      for (const alias of Object.keys(DEFAULT_ALIASES)) {
        // The alias under test is the declared `model.default` of the script's one agent label —
        // v24's single alias-resolution site.
        // v26 (REQ-128): rule L2 — the fixture helper's own phase synthesis, same as every other
        // registration path in this suite.
        const script = synthesizeMeta(synthesizePhase(`return await agent('t', { prompt: 'hi' });`), alias);
        const mermaid = synthesizeMermaid(script);
        const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'tools/call',
            params: { name: 'workflow_register', arguments: { name: `r1-${alias}`, script, mermaid } },
          }),
        });
        const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
        const out = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as { code?: string; error?: { code?: string } };
        expect(out.error?.code ?? out.code, `alias '${alias}' should resolve against the shared default table`).toBeUndefined();
      }
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
