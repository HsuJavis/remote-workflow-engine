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
import { DEFAULT_ALIASES } from '../../src/default-aliases.js';
import { createServer } from '../../src/server.js';

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
        const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'tools/call',
            params: { name: 'workflow_register', arguments: { name: `r1-${alias}`, script: `return agent('t', {model:'${alias}'});` } },
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
