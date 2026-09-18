// UT-247 (DES-205, ARCH-124/131/129, TASK-207, REQ-135/136): `lib/agent.js` — `panelModel` (the
// panel is a projection of the RECORD, not a reconstruction from the DOM), `eventListModel`,
// `clipText`. The system-prompt sentence must be TRUE on both cohorts: present -> "applied,
// N bytes, not shown"; ABSENT -> "no system-prompt record" (NOT "not applied" — a pre-v27 record's
// absence means "unknown", not "no").
//
// Tier: unit, `.js`, pure — a literal-fixture oracle (`tests/fixtures/dashboard-wire.ts`'s shapes,
// re-declared here as plain-object literals since a `.js` test cannot import a `.ts` fixture's
// TYPES, only its runtime values — DES-192's own `.ts`-fixture/`.js`-test split).
//
// Red reason (measured): `src/dashboard/lib/agent.js` does not exist (whole-file import failure).
import { describe, it, expect } from 'vitest';
import { panelModel, eventListModel, clipText } from '../../src/dashboard/lib/agent.js';

const RECORD_RUNNING = {
  agentId: 'a1', state: 'running', provider: 'anthropic', model: 'claude-3-5-sonnet-20241022',
  tokens: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2 }, startedAt: '2026-09-11T00:00:00.000Z', lastActivityAt: '2026-09-11T00:00:30.000Z',
};
const RECORD_DONE_UNPRICED = {
  agentId: 'a2', state: 'done', provider: 'ollama', model: 'unknown-model', unpriced: true,
  tokens: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 },
};
const RECORD_FAILED = {
  agentId: 'a3', state: 'failed', provider: 'anthropic', model: 'm', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, detail: 'provider 500',
};
const RECORD_REFUSED = {
  agentId: 'a4', state: 'refused', provider: '', model: '', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasonCode: 'BUDGET_EXCEEDED',
};

const HARNESS_APPLIED = { model: 'm', provider: 'p', prompt: 'user prompt', tools: [], skills: [], mcpServers: [], surfaceType: 'none', timeoutMs: 900000, effortApplied: { param: 'reasoning_effort', value: 'high' }, systemPrompt: { agentType: 'researcher', bytes: 512 } };
const HARNESS_NO_SYSTEM_PROMPT = { ...HARNESS_APPLIED, systemPrompt: undefined };

describe('lib/agent.js: panelModel over four record states (UT-247, DES-205)', () => {
  it('running with advancing activity: six stat cards including timeout shown TWICE and four token columns', () => {
    const vm = panelModel(RECORD_RUNNING, HARNESS_APPLIED, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(vm.stats.length).toBe(6);
    const timeoutStat = JSON.stringify(vm.stats.find((s) => /timeout/i.test(s.label ?? '')));
    expect(timeoutStat).toMatch(/15m/);
    expect(timeoutStat).toMatch(/900,000/);
    const tokensStat = vm.stats.find((s) => /token/i.test(s.label ?? ''));
    expect(JSON.stringify(tokensStat)).toMatch(/10/);
    expect(JSON.stringify(tokensStat)).toMatch(/5/);
  });

  it('effortApplied renders on BOTH branches — applied AND not-applied', () => {
    const applied = panelModel(RECORD_RUNNING, HARNESS_APPLIED, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(JSON.stringify(applied)).toMatch(/high/);
    const notApplied = panelModel(RECORD_RUNNING, { ...HARNESS_APPLIED, effortApplied: { reason: 'no dial for this provider' } }, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(JSON.stringify(notApplied)).toMatch(/no dial for this provider/);
  });

  it('the model line reads "provider · transport (· proxyModel)"', () => {
    const vm = panelModel({ ...RECORD_RUNNING, transport: 'direct-fetch', proxyModel: 'rwe-proxy-x' }, HARNESS_APPLIED, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(JSON.stringify(vm)).toMatch(/direct-fetch/);
    expect(JSON.stringify(vm)).toMatch(/rwe-proxy-x/);
  });

  it('done+unpriced: cost renders via fmtCost, never a confident $0.00', () => {
    const vm = panelModel(RECORD_DONE_UNPRICED, null, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(JSON.stringify(vm)).not.toMatch(/\$0\.00/);
  });

  it('failed with detail: the detail string is present for the red block', () => {
    const vm = panelModel(RECORD_FAILED, null, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(vm.detail).toBe('provider 500');
  });

  it('refused with reasonCode: reasonCode is surfaced beside the state', () => {
    const vm = panelModel(RECORD_REFUSED, null, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(vm.reasonCode).toBe('BUDGET_EXCEEDED');
  });

  it('systemPrompt PRESENT: the sentence says "applied" and names bytes, never the content', () => {
    const vm = panelModel(RECORD_DONE_UNPRICED, HARNESS_APPLIED, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(vm.systemPromptNote).toMatch(/512/);
    expect(vm.systemPromptNote).not.toContain('You are a researcher');
  });

  it('systemPrompt ABSENT: the sentence says "no record" — NEVER "not applied" (pre-v27 cohort is UNKNOWN, not "no")', () => {
    const vm = panelModel(RECORD_DONE_UNPRICED, HARNESS_NO_SYSTEM_PROMPT, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(vm.systemPromptNote.toLowerCase()).not.toContain('not applied');
  });

  it('mcpUnresolved and record.unmapped counts render as tags', () => {
    const vm = panelModel({ ...RECORD_RUNNING, unmapped: ['thinking_delta'] }, { ...HARNESS_APPLIED, mcpUnresolved: ['missing-server'] }, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(JSON.stringify(vm)).toMatch(/missing-server/);
    expect(JSON.stringify(vm)).toMatch(/thinking_delta/);
  });
});

describe('lib/agent.js: eventListModel / clipText (UT-247, DES-205)', () => {
  it('eventListModel with hasMore true renders a marker; false renders none', () => {
    const events = [{ ts: '2026-09-11T00:00:00.000Z', kind: 'message', data: {} }];
    expect(eventListModel(events, true).marker).not.toBeNull();
    expect(eventListModel(events, false).marker).toBeNull();
  });

  it('clipText at exactly the boundary: 2047 unclipped, 2048 unclipped (boundary inclusive), 2049 clipped', () => {
    expect(clipText('a'.repeat(2047), 2048).clipped).toBe(false);
    expect(clipText('a'.repeat(2048), 2048).clipped).toBe(false);
    expect(clipText('a'.repeat(2049), 2048).clipped).toBe(true);
  });
});

describe('lib/agent.js: the panel’s six stat labels render in the viewer’s language (UT-267, v29, REQ-150)', () => {
  const rec = { agentId: 'a-1', label: 'triage', state: 'done', provider: 'anthropic', model: 'haiku', tokens: { input: 392, output: 4987 } };
  it('zh labels carry no English', () => {
    const vm = panelModel(rec, undefined, [], false, Date.now(), 'zh');
    const labels = vm.stats.map((s) => s.label);
    // `Tokens` is deliberately NOT in this set: the handoff's own STR.zh keeps it in Latin
    // (`tokens: 'Tokens'`), and the running reference renders 「TOKENS」 in its zh panel. Asserting
    // it away would be translating past the design.
    expect(labels.some((l) => /^(Model|Cost|Timeout|Effort|Activity)$/.test(l))).toBe(false);
    expect(labels).toContain('Tokens');
    expect(labels).toContain('模型');
  });
  it('en labels are unchanged — a missing translation, not a relocation', () => {
    const vm = panelModel(rec, undefined, [], false, Date.now(), 'en');
    expect(vm.stats.map((s) => s.label)).toEqual(['Model', 'Tokens', 'Cost', 'Timeout', 'Effort', 'Activity']);
  });
});
