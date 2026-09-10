// UT-202 (DES-188, ARCH-114/115/118/111, ADR-046, TASK-188, v26, REQ-124/125/127/120): the restart-
// reconstruction seam — `deriveAgentRecords` gains a FOURTH branch (`refused`) and every branch now
// fills `tokens`/`costUSD`/`unpriced`/`transport`/`proxyModel`/`phase`/`phaseIndex`/`frame`/`label`
// through one local `base()` helper so no branch can forget a field. Written test-first (Gate 5,
// RED): today's `deriveAgentRecords` has exactly two branches (usage, harness-only) — no `refused`
// branch at all, and neither branch fills the v26 fields.
// Mock policy (unit): pure function, hand-written transcript fixtures, no I/O.
import { describe, it, expect } from 'vitest';
import { deriveAgentRecords } from '../../src/run-store.js';

describe('deriveAgentRecords — four branches, one base() helper (UT-202, DES-188)', () => {
  it('a legacy two-column usage event derives zeros in the cache columns and unpriced:true', () => {
    const transcripts = new Map([
      ['a1', [
        { ts: 't0', kind: 'harness' as const, data: { agentId: 'a1', descriptor: { model: 'm', provider: 'anthropic', label: 'x' } } },
        { ts: 't1', kind: 'usage' as const, data: { tokens: { input: 10, output: 5 }, provider: 'anthropic', model: 'm' } },
      ]],
    ]);
    const records = deriveAgentRecords(transcripts, 'completed');
    const record = records.find((r) => r.agentId === 'a1') as any;
    expect(record.tokens).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
    expect(record.costUSD).toBe(0);
    expect(record.unpriced).toBe(true);
  });

  it('a harness-less refused event derives state:refused with reasonCode, ZERO_TOKENS, costUSD:0, unpriced:false', () => {
    const transcripts = new Map([
      ['a2', [
        { ts: 't0', kind: 'refused' as const, data: { reasonCode: 'BUDGET_EXCEEDED', label: 'y', phase: 'one', phaseIndex: 0, frame: '' } },
      ]],
    ]);
    const records = deriveAgentRecords(transcripts, 'completed');
    const record = records.find((r) => r.agentId === 'a2') as any;
    expect(record.state).toBe('refused');
    expect(record.reasonCode).toBe('BUDGET_EXCEEDED');
    expect(record.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(record.costUSD).toBe(0);
    expect(record.unpriced).toBe(false);
    expect(record.label).toBe('y');
    expect(record.phase).toBe('one');
  });

  it('startedAt is read from the FIRST harness event ts, endedAt from the usage event ts', () => {
    const transcripts = new Map([
      ['a3', [
        { ts: 't-start', kind: 'harness' as const, data: { agentId: 'a3', descriptor: { model: 'm', provider: 'anthropic' } } },
        { ts: 't-end', kind: 'usage' as const, data: { tokens: { input: 1, output: 1 }, provider: 'anthropic', model: 'm' } },
      ]],
    ]);
    const records = deriveAgentRecords(transcripts, 'completed');
    const record = records.find((r) => r.agentId === 'a3') as any;
    expect(record.startedAt).toBe('t-start');
    expect(record.endedAt).toBe('t-end');
  });

  it('a failed usage event keeps the harness-resolved model, not empty string', () => {
    const transcripts = new Map([
      ['a4', [
        { ts: 't0', kind: 'harness' as const, data: { agentId: 'a4', descriptor: { model: 'the-model', provider: 'anthropic' } } },
        { ts: 't1', kind: 'usage' as const, data: { reason: 'terminal', provider: 'anthropic', detail: 'x' } },
      ]],
    ]);
    const records = deriveAgentRecords(transcripts, 'completed');
    const record = records.find((r) => r.agentId === 'a4') as any;
    expect(record.state).toBe('failed');
    expect(record.model).toBe('the-model');
  });

  // H-3/M-2 send-back repair (DES-188 lock, ARCH-115): a restart-reconstructed FAILED record must
  // carry `detail`/`unmapped` exactly like the live one `capture()` builds — otherwise the derived≡
  // snapshot lock goes false the moment a failed call carries either, and "answerable from the
  // record alone" (ARCH-115) is false after a restart specifically.
  it('a failed usage event\'s detail and unmapped survive into the reconstructed record', () => {
    const transcripts = new Map([
      ['a5', [
        { ts: 't0', kind: 'harness' as const, data: { agentId: 'a5', descriptor: { model: 'the-model', provider: 'anthropic' } } },
        { ts: 't1', kind: 'usage' as const, data: { reason: 'terminal', provider: 'anthropic', detail: '401 Unauthorized', unmapped: ['weird_subtype'] } },
      ]],
    ]);
    const records = deriveAgentRecords(transcripts, 'completed');
    const record = records.find((r) => r.agentId === 'a5') as any;
    expect(record.state).toBe('failed');
    expect(record.detail).toBe('401 Unauthorized');
    expect(record.unmapped).toEqual(['weird_subtype']);
  });

  it('a failed usage event with neither detail nor unmapped carries neither field (absent, never defaulted)', () => {
    const transcripts = new Map([
      ['a6', [
        { ts: 't0', kind: 'harness' as const, data: { agentId: 'a6', descriptor: { model: 'the-model', provider: 'anthropic' } } },
        { ts: 't1', kind: 'usage' as const, data: { reason: 'timeout', provider: 'anthropic' } },
      ]],
    ]);
    const records = deriveAgentRecords(transcripts, 'completed');
    const record = records.find((r) => r.agentId === 'a6') as any;
    expect(record.state).toBe('failed');
    expect('detail' in record).toBe(false);
    expect('unmapped' in record).toBe(false);
  });
});
