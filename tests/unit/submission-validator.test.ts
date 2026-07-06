// UT-012: SubmissionValidator — one error shape, delegates to modules (DES-012)
import { describe, it, expect } from 'vitest';
import { SubmissionValidator } from '../../src/submission-validator.js';

describe('SubmissionValidator', () => {
  it('valid inline script returns ok:true', async () => {
    const v = new SubmissionValidator();
    const result = await v.validate({ script: 'return 42;' });
    expect(result.ok).toBe(true);
  });

  it('a real Claude workflow starting with `export const meta = {...};` passes (export stripped before parse)', async () => {
    // Real-use gap: every Claude-generated workflow begins with `export const meta = {...}`. The
    // validator wrapped the raw script in an async function and compiled it, but a bare `export` is
    // illegal inside a function body -> PARSE_ERROR "Unexpected token 'export'", so NO real workflow
    // could ever be submitted. The validator must strip the meta first (as the sandbox does).
    const v = new SubmissionValidator();
    const script = `export const meta = { name: 'x', description: 'd', phases: [{ title: 'P' }] };\nphase('P');\nreturn 1;`;
    const result = await v.validate({ script });
    expect(result.ok).toBe(true);
  });

  it('TypeScript syntax in script returns ok:false with PARSE_ERROR', async () => {
    const v = new SubmissionValidator();
    const result = await v.validate({ script: 'const x: number = 1; return x;' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('PARSE_ERROR');
    }
  });

  it('unknown model alias returns ok:false with UNKNOWN_ALIAS error', async () => {
    // Validator must check all agent() opts.model values at submit time
    // Simplest way: include a comment with the alias name or pass it in runSpec metadata
    const v = new SubmissionValidator();
    const result = await v.validate({ script: `return agent('test', {model:'no-such-alias'});` });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('UNKNOWN_ALIAS');
    }
  });

  it('submission with unknown workflow name returns ok:false with UNKNOWN_WORKFLOW', async () => {
    const v = new SubmissionValidator();
    const result = await v.validate({ name: 'nonexistent-workflow-xyz' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('UNKNOWN_WORKFLOW');
    }
  });

  it('errors array entries each have code, message fields', async () => {
    const v = new SubmissionValidator();
    const result = await v.validate({ script: 'const x: number = 1;' });
    if (!result.ok) {
      for (const err of result.errors) {
        expect(typeof err.code).toBe('string');
        expect(typeof err.message).toBe('string');
      }
    }
  });

  it('submit with no name and no script returns ok:false with MISSING_SCRIPT error', async () => {
    const v = new SubmissionValidator();
    const result = await v.validate({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('MISSING_SCRIPT');
    }
  });
});
