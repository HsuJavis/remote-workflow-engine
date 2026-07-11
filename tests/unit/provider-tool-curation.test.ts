// UT (A): per-provider tool curation — non-Anthropic models get the quirky Read tool dropped +
// Bash ensured; Anthropic/unknown providers are unchanged.
import { describe, it, expect } from 'vitest';
import { curateToolsForProvider, providerOf } from '../../src/gateway/claude-agent-sdk-client.js';
import type { AliasMap } from '../../src/gateway/client.js';

const ALIASES: AliasMap = {
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
  gpt: { provider: 'openai', model: 'gpt-4.1' },
  sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet' },
};

describe('curateToolsForProvider (A)', () => {
  it('drops Read for a non-Anthropic provider and keeps the rest', () => {
    expect(curateToolsForProvider(['Read', 'Write', 'Edit', 'Grep', 'Bash'], 'openai'))
      .toEqual(['Write', 'Edit', 'Grep', 'Bash']);
    expect(curateToolsForProvider(['Read', 'Write', 'Edit', 'Grep', 'Bash'], 'ollama'))
      .not.toContain('Read');
  });
  it('ENSURES Bash for a non-Anthropic provider even if the base set lacked it', () => {
    expect(curateToolsForProvider(['Read', 'Write'], 'openai')).toEqual(['Write', 'Bash']);
  });
  it('leaves Anthropic UNCHANGED (native tools, incl. Read)', () => {
    expect(curateToolsForProvider(['Read', 'Write', 'Bash'], 'anthropic')).toEqual(['Read', 'Write', 'Bash']);
  });
  it('leaves an unknown/undefined provider unchanged (direct/test callers unaffected)', () => {
    expect(curateToolsForProvider(['Read', 'Write'], undefined)).toEqual(['Read', 'Write']);
  });
  it('providerOf resolves the alias table', () => {
    expect(providerOf(ALIASES, 'gpt')).toBe('openai');
    expect(providerOf(ALIASES, 'sonnet')).toBe('anthropic');
    expect(providerOf(ALIASES, 'nope')).toBeUndefined();
    expect(providerOf(undefined, 'gpt')).toBeUndefined();
  });
});
