// UT-012: SubmissionValidator — one error shape, delegates to modules (DES-012)
//
// v22 adjudication #3 (M-6): this file's SUBJECT split in two. The parse / alias / MCP checks that
// used to live in SubmissionValidator's `if (spec.script)` block MOVED to `src/script-checks.ts`,
// enforced once at `WorkflowCatalog.register()` (ADR-013, REQ-099) — they were not deleted, so the
// cases that pinned them are not deleted either: they are re-sited onto `validateScriptEntry`, the
// function that now performs them. What remains genuinely SubmissionValidator's is the submission
// shape itself (a registered `name` must be supplied and must exist).
import { describe, it, expect } from 'vitest';
import { SubmissionValidator } from '../../src/submission-validator.js';
import { validateScriptEntry } from '../../src/script-checks.js';

const PORTS = {
  aliases: new Set(['sonnet', 'haiku', 'opus', 'default']),
  openrouterPassthrough: true,
  mcpLookup: () => true,
};

describe('the moved script checks (ADR-013: script-checks.ts, enforced at catalog.register)', () => {
  it('valid script returns ok:true', () => {
    const result = validateScriptEntry('return 42;', PORTS);
    expect(result.ok).toBe(true);
  });

  it('a real Claude workflow starting with `export const meta = {...};` passes (export stripped before parse)', () => {
    // Real-use gap: every Claude-generated workflow begins with `export const meta = {...}`. The
    // check wraps the raw script in an async function and compiles it, but a bare `export` is
    // illegal inside a function body -> PARSE_ERROR "Unexpected token 'export'", so NO real workflow
    // could ever be registered. The check must strip the meta first (as the sandbox does).
    const script = `export const meta = { name: 'x', description: 'd', phases: [{ title: 'P' }] };\nphase('P');\nreturn 1;`;
    const result = validateScriptEntry(script, PORTS);
    expect(result.ok).toBe(true);
  });

  it('TypeScript syntax in script returns ok:false with PARSE_ERROR', () => {
    const result = validateScriptEntry('const x: number = 1; return x;', PORTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('PARSE_ERROR');
    }
  });

  it('unknown model alias returns ok:false with UNKNOWN_ALIAS error', () => {
    // The check must scan all agent() opts.model values in the script.
    const result = validateScriptEntry(`return agent('test', {model:'no-such-alias'});`, PORTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('UNKNOWN_ALIAS');
    }
  });

  it('errors array entries each have code, message fields', () => {
    const result = validateScriptEntry('const x: number = 1;', PORTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const err of result.errors) {
        expect(typeof err.code).toBe('string');
        expect(typeof err.message).toBe('string');
      }
    }
  });
});

describe('SubmissionValidator', () => {
  it('submission with unknown workflow name returns ok:false with UNKNOWN_WORKFLOW', async () => {
    const v = new SubmissionValidator();
    const result = await v.validate({ name: 'nonexistent-workflow-xyz' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('UNKNOWN_WORKFLOW');
    }
  });

  it('submit with no name returns ok:false with MISSING_NAME error', async () => {
    // v22 (DES-117): this code was MISSING_SCRIPT until REQ-098 closed inline script. The old
    // code/message named a parameter (`script`) that no longer exists and would teach an agent to
    // retry with it; the renamed code is the contract now, so it is what this pins.
    const v = new SubmissionValidator();
    const result = await v.validate({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('MISSING_NAME');
    }
  });
});
