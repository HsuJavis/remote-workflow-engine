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
// IT-282 (DES-225, ARCH-137, ADR-061, TASK-229, REQ-203): deriveAgentRecords is the other half of
// DES-225's own totality claim ("HARNESS_LEGACY_PRE_V34 must be read through `deriveAgentRecords` +
// the dashboard projection"); IT-175 above only ever fed the fixture straight into `panelModel`.
import { deriveAgentRecords } from '../../src/run-store.ts';
// IT-282 uses the fixture DES-225 names BY NAME (`HARNESS_LEGACY_PRE_V34`, not the local
// `HARNESS_APPLIED` literal below) — explicit `.ts` extension, same precedent as
// `dashboard-lib-strings.test.js:28`'s `DAG_WARNING_EXAMPLES` import.
import { HARNESS_LEGACY_PRE_V34 } from '../fixtures/dashboard-wire.ts';

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

// v34 (DES-225 rationale item 9): kept carrying `systemPrompt` on purpose — it IS the genuine
// pre-v34 legacy shape IT-175 below needs as input, a shape this version of the engine can no
// longer WRITE but must still READ without crashing (INV-V34-3).
const HARNESS_APPLIED = { model: 'm', provider: 'p', prompt: 'user prompt', tools: [], skills: [], mcpServers: [], surfaceType: 'none', timeoutMs: 900000, effortApplied: { param: 'reasoning_effort', value: 'high' }, systemPrompt: { agentType: 'researcher', bytes: 512 } };

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

  // v34 (DES-225, ARCH-137, ADR-061, TASK-229, REQ-203): this pair of cases pinned the retired
  // `systemPromptNote` sentence ("applied…N bytes" / "no record") on both cohorts — 隨機制消失,
  // superseded by IT-175 below, which pins the field's total ABSENCE instead. Not deleted silently:
  // reported as an additional retirement in this task's report (05-tests.md's own v34 retirement
  // register named the two NEW cases it expected here but not this pair's removal).

  // IT-175 (DES-225, ARCH-137, ADR-061, TASK-229, REQ-203): the disclosure surface retires WITH its
  // mechanism (「隨機制消失」) — a legacy pre-v34 row (still carrying `systemPrompt`, read TOTAL per
  // INV-V34-3) renders with NO `systemPromptNote` field at all, never "applied" and never "no
  // record" (both of those sentences describe a mechanism that no longer exists post-cut). This
  // file is `allowJs` without `checkJs` (DES-225 rationale item 10) — `tsc` cannot pin this
  // deletion, so the assertion is the checklist. Red reason: today's `panelModel` sets
  // `vm.systemPromptNote` on BOTH cohorts (present → "applied…N bytes", absent → "no record") — the
  // field always exists today.
  it('v34: a legacy row carrying systemPrompt renders NO systemPromptNote field at all (retired with its mechanism, not a regression)', () => {
    const vm = panelModel(RECORD_DONE_UNPRICED, HARNESS_APPLIED, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect('systemPromptNote' in vm).toBe(false);
  });

  it('v34: panelModel does not crash on a legacy row (no-crash totality over a pre-v34 shape)', () => {
    expect(() => panelModel(RECORD_DONE_UNPRICED, HARNESS_APPLIED, [], false, '2026-09-11T00:01:00.000Z', 'en')).not.toThrow();
  });

  it('mcpUnresolved and record.unmapped counts render as tags', () => {
    const vm = panelModel({ ...RECORD_RUNNING, unmapped: ['thinking_delta'] }, { ...HARNESS_APPLIED, mcpUnresolved: ['missing-server'] }, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect(JSON.stringify(vm)).toMatch(/missing-server/);
    expect(JSON.stringify(vm)).toMatch(/thinking_delta/);
  });
});

// IT-282 (DES-225, ARCH-137, ADR-061, TASK-229, REQ-203): DES-225 states the legacy fixture "must be
// read through `deriveAgentRecords` + the dashboard projection → clean render, disclosure line
// absent, no crash" — IT-175 above proves only the projection half (a hand-built record fed
// straight into `panelModel`). This describe drives the SAME two-step pipeline
// `McpFacade.runAgentLog` actually uses in production (`src/mcp-facade.ts:688-717`): the agent
// RECORD comes from `deriveAgentRecords(transcripts, status)` over the persisted transcript, and the
// HARNESS descriptor comes from that same transcript's last `harness` event's `descriptor` field
// (read independently, never through `deriveAgentRecords` — `deriveAgentRecords` itself only ever
// lifts `model`/`provider`/`label`/`phase`/`phaseIndex` off that descriptor, never `systemPrompt`,
// so it is read-total over the legacy shape by construction; the crash risk this test actually rules
// out lives entirely in `panelModel`, the same place IT-175 covers). Uses `HARNESS_LEGACY_PRE_V34`
// BY NAME, the exact export DES-225 itself names (`tests/fixtures/dashboard-wire.ts:60`, an alias of
// that file's own `HARNESS_APPLIED`) — not this file's local `HARNESS_APPLIED` literal, so the test
// literally exercises the fixture the design points at, not a lookalike. It still carries
// `systemPrompt`, a field this version of the engine can no longer WRITE but must still READ without
// crashing (INV-V34-3).
//
// Tier: unit (per IT-175's own house convention — an `IT-` id whose test is a pure literal-fixture
// oracle, no I/O; `deriveAgentRecords` is pure over its `Map`/`RunStatus` arguments).
describe('lib/agent.js + run-store.js: a legacy pre-v34 harness record survives the real derive+projection pipeline (IT-282, DES-225)', () => {
  const legacyTranscripts = new Map([
    ['a5', [{ ts: '2026-09-11T00:00:00.000Z', kind: 'harness', data: { agentId: 'a5', descriptor: HARNESS_LEGACY_PRE_V34 } }]],
  ]);

  it('deriveAgentRecords does not crash reading the legacy descriptor and derives a running record', () => {
    const records = deriveAgentRecords(legacyTranscripts, 'running');
    expect(records).toHaveLength(1);
    expect(records[0].agentId).toBe('a5');
    expect(records[0].state).toBe('running');
    expect(records[0].model).toBe(HARNESS_LEGACY_PRE_V34.model);
  });

  it('panelModel over the derived record + the legacy harness descriptor: clean render, no crash, disclosure line absent', () => {
    const [record] = deriveAgentRecords(legacyTranscripts, 'running');
    expect(() => panelModel(record, HARNESS_LEGACY_PRE_V34, [], false, '2026-09-11T00:01:00.000Z', 'en')).not.toThrow();
    const vm = panelModel(record, HARNESS_LEGACY_PRE_V34, [], false, '2026-09-11T00:01:00.000Z', 'en');
    expect('systemPromptNote' in vm).toBe(false);
    // "clean render": the panel's core stat cards are populated (six cards, REQ-135) and the model
    // line names the record's own model/provider (both multi-character, non-vacuous values on this
    // fixture — 'claude-3-5-sonnet-20241022' · 'anthropic'), not blank/undefined — over a record this
    // pipeline just reconstructed from a legacy transcript.
    expect(vm.stats.length).toBe(6);
    const modelStat = vm.stats.find((s) => s.label === 'Model');
    expect(modelStat.value).toBe(`${HARNESS_LEGACY_PRE_V34.model} — ${HARNESS_LEGACY_PRE_V34.provider} · —`);
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
    // REQ-135: the Tokens card carries the TOTAL as well as the four-column breakdown.
    expect(vm.stats.find((x) => x.label === 'Tokens').value).toMatch(/^\d/);
    expect(labels).toContain('模型');
  });
  it('en labels are unchanged — a missing translation, not a relocation', () => {
    const vm = panelModel(rec, undefined, [], false, Date.now(), 'en');
    // [v30, REQ-166 — ORACLE RE-DERIVED] This listed the six cards the implementation happened to
    // build, in its order. REQ-135's acceptance (and README §3, which it restates verbatim) names
    // a different set AND order: Model / Effort / Timeout / Duration / Tokens / Cost — no
    // `Activity` card, and `Duration` was missing entirely. Written in v29 c3 by me, from the
    // build; the same shape as the ground-colour and fmtBytes rows re-derived earlier this round.
    expect(vm.stats.map((s) => s.label)).toEqual(['Model', 'Effort', 'Timeout', 'Duration', 'Tokens', 'Cost']);
  });
});

// UT-279 (v32, REQ-197, F11): an absent `lastActivityAt` means NOBODY HAS REPORTED YET — not frozen.
//
// Measured on a real run: a healthy ollama call read 「無活動」 at t+67s and went on to finish at
// 3m38s. Its record carried `startedAt` and no `lastActivityAt`, because the gateway emitted its
// first event 3m38s in — a provider that does not stream mid-call has nothing to report until it
// returns. `lastMs` fell back to `startMs`, so `advancing` was false by construction and the 60s
// staleness test did the rest.
//
// Owner ruling 2026-09-20: absence is "unknown". Same class as R30-A1 (an un-measured figure is
// absent, not zero) moved to the time axis. "No activity" is reserved for a call that DID advance
// and then froze. The 60s threshold itself is unchanged.
describe('lib/agent.js: never-reported activity is unknown, not frozen (UT-279, v32, REQ-197)', () => {
  const base = { agentId: 'a-1', label: 'triage', state: 'running', provider: 'ollama', model: 'qwen2.5:7b' };
  const start = '2026-09-20T10:00:00.000Z';
  // a running call has no `endedAt`, so `durationText` hands off to `activityText` (REQ-166's ruled
  // fallback) — the 耗時 card IS where this signal surfaces, which is where the audit measured it.
  const durationOf = (rec, now) => panelModel(rec, null, [], false, now, 'zh').stats.find((x) => x.label === '耗時').value;

  it('a running call that has never reported, well past the threshold, is not called inactive', () => {
    const value = durationOf({ ...base, startedAt: start }, '2026-09-20T10:05:00.000Z');
    expect(value, 'a healthy non-streaming call was labelled frozen').not.toBe('無活動');
  });

  it('it says so: never reported is its own answer, not silence and not progress', () => {
    expect(durationOf({ ...base, startedAt: start }, '2026-09-20T10:05:00.000Z')).toBe('尚無回報');
  });

  it('a call that advanced and then froze past the threshold IS inactive — the distinction stands', () => {
    const rec = { ...base, startedAt: start, lastActivityAt: '2026-09-20T10:00:30.000Z' };
    expect(durationOf(rec, '2026-09-20T10:05:00.000Z')).toBe('無活動');
  });

  it('a call that reported recently is progressing', () => {
    const rec = { ...base, startedAt: start, lastActivityAt: '2026-09-20T10:04:50.000Z' };
    expect(durationOf(rec, '2026-09-20T10:05:00.000Z')).toBe('進行中');
  });
});

// UT-280 (v32, REQ-199, F13): README §3 names the Duration card "Duration (start → end)". The six
// cards are flat `{label, value}` pairs, so the timestamps have nowhere to go. Only the DURATION
// card's pair is in scope — the single-line Timeout is ruled (`agent.js:12-19`).
describe('lib/agent.js: the Duration card carries its start → end (UT-280, v32, REQ-199)', () => {
  const rec = {
    agentId: 'a-1', label: 'triage', state: 'done', provider: 'anthropic', model: 'haiku',
    startedAt: '2026-09-07T18:25:26.000Z', endedAt: '2026-09-07T18:26:25.000Z',
    tokens: { input: 392, output: 4987 },
  };

  it('a finished call shows both timestamps under the duration value', () => {
    const vm = panelModel(rec, null, [], false, '2026-09-07T18:30:00.000Z', 'zh');
    const dur = vm.stats.find((x) => x.label === '耗時');
    expect(dur.value).toMatch(/\d/);
    expect(dur.meta, 'README §3: "Duration (start → end)"').toMatch(/→/);
  });

  it('a call with no end timestamp claims no end — absent, not a fabricated now', () => {
    const running = { ...rec, state: 'running', endedAt: undefined };
    const vm = panelModel(running, null, [], false, '2026-09-07T18:30:00.000Z', 'zh');
    const dur = vm.stats.find((x) => x.label === '耗時');
    expect(dur.meta ?? '').not.toMatch(/→\s*\d/);
  });
});
