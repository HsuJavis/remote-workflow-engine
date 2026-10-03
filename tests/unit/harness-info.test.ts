// pi harness v1 (spec "Disclosure") — buildHarnessAnnounce() is the ONE source system_info
// (MCP tool + /api/system), the authoring guide and DEPLOY.md all read disclosure facts from.
import { describe, it, expect } from 'vitest';
import { buildHarnessAnnounce, PI_HARNESS_VERSION, PI_UNSUPPORTED_TOOLS, piUnsupportedToolNames } from '../../src/harness-info.js';

describe('buildHarnessAnnounce (pi harness v1 disclosure)', () => {
  it('reports the sdk harness with all three providers and no pi-specific caveats when harnessProviders is absent', () => {
    const a = buildHarnessAnnounce(undefined);
    expect(a.name).toBe('sdk');
    expect([...a.providers].sort()).toEqual(['anthropic', 'ollama', 'openrouter']);
    expect(a.unsupportedTools).toBeUndefined();
    expect(a.version).toBeUndefined();
  });

  it('reports the pi harness with only openrouter/ollama, the pinned version, and unsupported tools', () => {
    const a = buildHarnessAnnounce(['openrouter', 'ollama']);
    expect(a.name).toBe('pi');
    expect(a.version).toBe(PI_HARNESS_VERSION);
    expect([...a.providers].sort()).toEqual(['ollama', 'openrouter']);
    expect(a.providers).not.toContain('anthropic');
    expect(a.unsupportedTools).toEqual(PI_UNSUPPORTED_TOOLS);
  });

  it('states effort and usage semantics in prose under pi, absent under sdk', () => {
    const pi = buildHarnessAnnounce(['openrouter', 'ollama']);
    expect(typeof pi.effort).toBe('string');
    expect(typeof pi.usage).toBe('string');
    const sdk = buildHarnessAnnounce(undefined);
    expect(sdk.effort).toBeUndefined();
    expect(sdk.usage).toBeUndefined();
  });
});

describe('piUnsupportedToolNames (review M3 — registration-time tool refusal)', () => {
  it('finds every PI_UNSUPPORTED_TOOLS name present, never just the first', () => {
    expect(piUnsupportedToolNames(['Read', 'WebFetch', 'Bash', 'Task'])).toEqual(['WebFetch', 'Task']);
  });

  it('accepts every base tool pi supports (Read/Write/Edit/Bash/Grep/Glob/LS)', () => {
    expect(piUnsupportedToolNames(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'LS'])).toEqual([]);
  });

  it('accepts an mcp__<server>__<tool> entry (review M2 parity — never flagged as unsupported)', () => {
    expect(piUnsupportedToolNames(['Read', 'mcp__everything__echo'])).toEqual([]);
  });

  it('an empty list is trivially supported', () => {
    expect(piUnsupportedToolNames([])).toEqual([]);
  });

  it('every PI_UNSUPPORTED_TOOLS entry is independently confirmed unsupported, one at a time', () => {
    for (const name of PI_UNSUPPORTED_TOOLS) expect(piUnsupportedToolNames([name])).toEqual([name]);
  });
});
