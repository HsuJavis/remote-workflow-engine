// UT-070: pure `redactHarness` — tier-1 no-secret proof (DES-066, ARCH-044, TASK-069)
//
// `redactHarness(resolved) → HarnessDescriptor` is the security-load-bearing pure transform:
//   - Input: the resolved gateway surface (curatedTools[], mergedMcp[], modelName, prompt, surfaceType)
//   - Output: HarnessDescriptor { prompt:string, tools:string[], skills:string[], mcpServers:string[], surfaceType }
//   - Names ONLY — never a resolved MCP config value, never a provider key, never a ${secret:} value
//   - 4KB prompt cap: first 2KB + "…[truncated]…" + last 2KB (tail survives, not truncated away)
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
import { redactHarness } from '../../src/agent-executor.js';

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

  it('prompt > 4096 chars → first 2048 + "…[truncated]…" + last 2048 (tail preserved)', () => {
    // The 4KB cap is head + tail (DES-066: task instructions land at the tail → tail must survive).
    const resolved = {
      surfaceType: 'curated' as const,
      modelName: 'm',
      prompt: LONG_PROMPT,
      curatedTools: [],
      mergedMcp: [],
      skills: [],
    };
    const result = redactHarness(resolved);
    expect(result.prompt.length).toBeLessThanOrEqual(4096 + 50); // room for the marker
    expect(result.prompt.startsWith('A'.repeat(2048))).toBe(true);
    expect(result.prompt.endsWith('B'.repeat(2048))).toBe(true);
    expect(result.prompt).toContain('[truncated]');
    // The secret-in-middle is NOT in the output
    expect(result.prompt).not.toContain('SECRET-VALUE-IN-MIDDLE');
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
