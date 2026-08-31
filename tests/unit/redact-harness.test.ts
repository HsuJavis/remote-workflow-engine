// UT-070: pure `redactHarness` — tier-1 no-secret proof (DES-066, ARCH-044, TASK-069)
//
// `redactHarness(resolved) → HarnessDescriptor` is the security-load-bearing pure transform:
//   - Input: the resolved gateway surface (curatedTools[], mergedMcp[], modelName, prompt, surfaceType)
//   - Output: HarnessDescriptor { prompt:string, tools:string[], skills:string[], mcpServers:string[], surfaceType }
//   - Names ONLY — never a resolved MCP config value, never a provider key, never a ${secret:} value
//   - 4KB prompt cap: first 2KB + "…[truncated]…" + last 2KB (tail survives, not truncated away).
//     v21 Gate 8 re-review (review §R2, R-G9): the cap RELOCATED out of `redactHarness` into the
//     exported `capPrompt`, applied at the persist site AFTER `redact()` — capping first could cut a
//     secret across a seam and defeat the value-exact match. Same assertions, new home (below).
//   - surfaceType:'curated' for SDK post-curation; surfaceType:'none' + empty arrays for direct-fetch
//
// Boundary conditions from DES-066/ARCH-044/ARCH-045:
//   1. Given a resolved MCP config carrying a secret VALUE, output contains server NAME only
//   2. Prompt ≤ 4096 chars → returned as-is; prompt > 4096 → first 2048 + marker + last 2048
//   3. surfaceType:'none' → tools/skills/mcpServers all []
//   4. tools array = curated tool names only (never configs/secrets)
//
// Mock policy (unit): pure function, no I/O.
// Red reason: `redactHarness` is not yet exported from `src/agent-executor.ts`
//   → ESM SyntaxError "does not provide an export named 'redactHarness'" at collect time.
import { describe, it, expect } from 'vitest';
import { redactHarness, capPrompt } from '../../src/agent-executor.js';
import { redact } from '../../src/secret-resolver.js';

const SHORT_PROMPT = 'Summarize this document.';
const LONG_PROMPT = 'A'.repeat(2048) + 'SECRET-VALUE-IN-MIDDLE' + 'B'.repeat(2048);

describe('redactHarness — pure no-secret transform (UT-070, DES-066)', () => {
  it('tier-1 no-secret: given MCP config with a secret URL value, output contains server name only', () => {
    // This is the primary security invariant: a resolved MCP config has the actual server URL/token;
    // redactHarness must strip all of that, keeping only the logical server name.
    const resolved = {
      surfaceType: 'curated' as const,
      modelName: 'claude-3-haiku',
      prompt: SHORT_PROMPT,
      curatedTools: ['bash', 'read_file'],
      mergedMcp: [
        { name: 'github', url: 'https://api.github.com?token=ghp_SECRET12345', key: 'SECRET_KEY' },
      ],
      skills: [],
    };
    const result = redactHarness(resolved);
    // Tool names only
    expect(result.tools).toEqual(['bash', 'read_file']);
    // MCP server name only — no URL, no key, no secret value anywhere
    expect(result.mcpServers).toEqual(['github']);
    const json = JSON.stringify(result);
    expect(json).not.toContain('ghp_SECRET12345');
    expect(json).not.toContain('SECRET_KEY');
    expect(json).not.toContain('api.github.com');
  });

  it('prompt ≤ 4096 chars → returned verbatim (no truncation marker)', () => {
    const resolved = {
      surfaceType: 'curated' as const,
      modelName: 'm',
      prompt: SHORT_PROMPT,
      curatedTools: [],
      mergedMcp: [],
      skills: [],
    };
    const result = redactHarness(resolved);
    expect(result.prompt).toBe(SHORT_PROMPT);
    expect(result.prompt).not.toContain('[truncated]');
  });

  it('prompt > 4096 chars → passed through UNCUT (the cap moved to the persist site, R-G9)', () => {
    // v21 Gate 8 re-review (review §R2, R-G10... R-G9): `redactHarness` no longer caps. Capping here
    // ran BEFORE the persist-site `redact()`, so a secret straddling a 2048-char seam was cut in two
    // and neither half matched `redact()`'s value-exact substring test. The cap now runs last, on the
    // redacted descriptor (`capPrompt`, asserted below with the same strength).
    const resolved = {
      surfaceType: 'curated' as const,
      modelName: 'm',
      prompt: LONG_PROMPT,
      curatedTools: [],
      mergedMcp: [],
      skills: [],
    };
    const result = redactHarness(resolved);
    expect(result.prompt).toBe(LONG_PROMPT);
    expect(result.prompt).not.toContain('[truncated]');
  });

  it('surfaceType:"none" (direct-fetch) → tools/skills/mcpServers all empty arrays', () => {
    // Direct-fetch gateway emits surfaceType:'none' (DES-066 / R2 decided)
    const resolved = {
      surfaceType: 'none' as const,
      modelName: 'm',
      prompt: SHORT_PROMPT,
      curatedTools: [],
      mergedMcp: [],
      skills: [],
    };
    const result = redactHarness(resolved);
    expect(result.surfaceType).toBe('none');
    expect(result.tools).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.mcpServers).toEqual([]);
  });

  it('surfaceType:"curated" → surfaceType field is "curated" in output', () => {
    const resolved = {
      surfaceType: 'curated' as const,
      modelName: 'claude-3-sonnet',
      prompt: 'hello',
      curatedTools: ['bash'],
      mergedMcp: [],
      skills: ['web-search'],
    };
    const result = redactHarness(resolved);
    expect(result.surfaceType).toBe('curated');
    expect(result.skills).toEqual(['web-search']);
  });
});

// v21 Gate 8 re-review (review §R2, R-G9): the 4KB cap relocated out of `redactHarness` to the one
// persist site, where it runs AFTER `redact()`. The cap's own semantics are unchanged and asserted
// here with the same strength UT-070 asserted them with before the move; the seam case below is the
// defect R-G9 named, which the old ordering could not satisfy.
describe('capPrompt — the 4KB descriptor bound, applied after redaction (UT-070, DES-066, R-G9)', () => {
  it('prompt > 4096 chars → first 2048 + "…[truncated]…" + last 2048 (tail preserved)', () => {
    // The 4KB cap is head + tail (DES-066: task instructions land at the tail → tail must survive).
    const result = capPrompt(LONG_PROMPT);
    expect(result.length).toBeLessThanOrEqual(4096 + 50); // room for the marker
    expect(result.startsWith('A'.repeat(2048))).toBe(true);
    expect(result.endsWith('B'.repeat(2048))).toBe(true);
    expect(result).toContain('[truncated]');
    // The secret-in-middle is NOT in the output
    expect(result).not.toContain('SECRET-VALUE-IN-MIDDLE');
  });

  it('prompt ≤ 4096 chars → returned verbatim (no truncation marker)', () => {
    expect(capPrompt(SHORT_PROMPT)).toBe(SHORT_PROMPT);
    expect(capPrompt(SHORT_PROMPT)).not.toContain('[truncated]');
  });

  it('R-G9: a secret straddling the head seam is fully markered when redact() runs FIRST, and leaves partial bytes when the cap runs first', () => {
    // The secret starts at offset 2030 and ends at 2070 — it spans the 2048-char head cut. (The
    // 12-char marker that replaces it fits entirely before 2048, so redact-first leaves it intact;
    // a marker that DID straddle the seam would be split, which is harmless — a halved marker
    // carries no credential material, which is the whole point of ordering it this way.)
    const SECRET = 'sk-live-' + 'X'.repeat(32);
    const prompt = 'A'.repeat(2030) + SECRET + 'B'.repeat(3000);
    expect(prompt.indexOf(SECRET)).toBeLessThan(2048);
    expect(prompt.indexOf(SECRET) + SECRET.length).toBeGreaterThan(2048);
    const secrets = [{ name: 'TOK', value: SECRET }];

    // WRONG order (what shipped before this fix): cap, then redact. The cut splits the secret, the
    // value-exact match finds neither half, and the first 8 bytes of a live credential persist.
    const capFirst = redact(capPrompt(prompt), secrets) as string;
    expect(capFirst).toContain('sk-live-'); // partial credential material survived
    expect(capFirst).not.toContain('‹secret:TOK›');

    // CORRECT order (R-G9): redact, then cap. The whole secret matches and is replaced by the
    // marker; the cap then bounds the already-safe string.
    const redactFirst = capPrompt(redact(prompt, secrets) as string);
    expect(redactFirst).toContain('‹secret:TOK›');
    expect(redactFirst).not.toContain('sk-live-');
    expect(redactFirst.length).toBeLessThanOrEqual(4096 + 50);
  });
});
