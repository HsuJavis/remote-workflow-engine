// UT-305 (DES-249, ARCH-171, TASK-247, REQ-216/K6+K7, REQ-207): one shared `attemptsFor(retries,
// timeoutMs)` formula on the `GatewayClient` PORT module (`src/gateway/client.ts`, where the
// interface itself is declared) — `timeoutMs === undefined ? 1 : 1 + Math.max(0, retries ?? 0)`.
// `claude-agent-sdk-client.ts` already follows this rule; `client.ts` today retries an UNTIMED
// call unconditionally (`1 + Math.max(0, this._config.retries)`, no `timeoutMs` gate at all) —
// the deviant implementation, per the guide's own promise that an untimed call gets ONE attempt.
//
// Red reason: `attemptsFor` is not exported from `src/gateway/client.ts`.
//
// Mock policy (unit): a pure table test against the exported formula, plus a per-conformer
// assertion that each transport's SOURCE calls the shared export (not a behavioural cross-transport
// matrix — mocking both `fetch` and the Agent SDK to prove an import is the expensive form K7
// explicitly declines).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attemptsFor } from '../../src/gateway/client.js';

describe('UT-305: attemptsFor — one formula on the port, both conformers call it', () => {
  it('the four quadrants: timed/untimed × retries 0/N, plus a negative retries clamps to 0', () => {
    expect(attemptsFor(undefined, undefined)).toBe(1); // untimed, any retries -> ONE attempt
    expect(attemptsFor(3, undefined)).toBe(1);
    expect(attemptsFor(0, 5000)).toBe(1); // timed, 0 retries -> 1 attempt
    expect(attemptsFor(3, 5000)).toBe(4); // timed, 3 retries -> 4 attempts
    expect(attemptsFor(-2, 5000)).toBe(1); // negative retries clamps to 0 extra attempts
  });

  it('per-conformer: both client.ts and claude-agent-sdk-client.ts call the shared export (source-text)', () => {
    const clientSrc = readFileSync(join(__dirname, '..', '..', 'src', 'gateway', 'client.ts'), 'utf8');
    const sdkSrc = readFileSync(join(__dirname, '..', '..', 'src', 'gateway', 'claude-agent-sdk-client.ts'), 'utf8');
    expect(clientSrc).toMatch(/attemptsFor\(/);
    expect(sdkSrc).toMatch(/attemptsFor\(/);
    // the deviant formula (client.ts's old unconditional retry) must be GONE.
    expect(clientSrc).not.toMatch(/1\s*\+\s*Math\.max\(0,\s*this\._config\.retries\)/);
  });
});
