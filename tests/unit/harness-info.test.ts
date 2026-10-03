// pi harness v1 (spec "Disclosure") — buildHarnessAnnounce() is the ONE source system_info
// (MCP tool + /api/system), the authoring guide and DEPLOY.md all read disclosure facts from.
import { describe, it, expect } from 'vitest';
import { buildHarnessAnnounce, PI_HARNESS_VERSION, PI_UNSUPPORTED_TOOLS } from '../../src/harness-info.js';

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
