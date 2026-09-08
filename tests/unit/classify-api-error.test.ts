// UT-176 (DES-171, ARCH-111, ADR-040, TASK-176, v26, issue #65): `classifyApiError` — pure, total
// over the SDK's closed `SDKAssistantMessageError` union (pinned against the installed
// @anthropic-ai/claude-agent-sdk@0.3.199's sdk.d.ts at Gate 5: 'authentication_failed' |
// 'oauth_org_not_allowed' | 'billing_error' | 'rate_limit' | 'overloaded' | 'invalid_request' |
// 'model_not_found' | 'server_error' | 'unknown' | 'max_output_tokens'). Written test-first (Gate 5,
// RED): `classifyApiError` does not exist yet in src/gateway/claude-agent-sdk-client.ts — whole-file
// import failure.
// Mock policy (unit): pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { classifyApiError } from '../../src/gateway/claude-agent-sdk-client.js';

describe('classifyApiError — total over the closed SDK error union (UT-176, DES-171)', () => {
  const rows: Array<[string, number | null, 'terminal' | 'retry']> = [
    ['authentication_failed', 401, 'terminal'],
    ['oauth_org_not_allowed', 403, 'terminal'],
    ['billing_error', 402, 'terminal'],
    ['invalid_request', 400, 'terminal'],
    ['model_not_found', 404, 'terminal'],
    ['rate_limit', 429, 'retry'],
    ['overloaded', 529, 'retry'],
    ['server_error', 500, 'retry'],
    ['max_output_tokens', null, 'retry'],
    // `unknown` and a garbage string: retry unless status ∈ 400..499 and status ∉ {408, 429}.
    ['unknown', 401, 'terminal'],
    ['unknown', 408, 'retry'],
    ['unknown', 429, 'retry'],
    ['unknown', 500, 'retry'],
    ['unknown', null, 'retry'],
    ['some-future-sdk-error-kind', 422, 'terminal'],
  ];

  it.each(rows)('classifyApiError(%s, %s) → %s', (kind, status, expected) => {
    expect(classifyApiError(kind as any, status)).toBe(expected);
  });

  it('never throws on any input', () => {
    expect(() => classifyApiError('' as any, null)).not.toThrow();
    expect(() => classifyApiError(undefined as any, undefined as any)).not.toThrow();
  });
});
