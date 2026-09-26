// IT-075 (DES-088, ARCH-056, TASK-082): completeness sweep — transcript persist sinks are redacted.
// This is the DEFINITION-OF-DONE for DES-088 / ARCH-056 per the design.
//
// Approach: fake GatewayClient (legal at integration tier — mocks third-party LLM network)
//   that calls `req.onEvent?.()` with transcript events containing the known secret value,
//   then reads back the transcript from the real InMemoryRunStore. The secret-free store output
//   is the key assertion.
//
// Sinks tested:
//   (1) Per-agent transcript (appendTranscript path): onEvent → AgentTranscriptSink._emit → store
//   (2) Negative control: a same-shape non-secret string NOT redacted (no over-redaction)
//   (3) SecretValueProvider injection: RunManager/AgentExecutor accepts SecretValueProvider dep
//
// Cases:
//   A. Fake gateway emits {kind:'message', data:{role:'assistant', content: SECRET_VALUE}} →
//      transcript stored via appendTranscript → store.getTranscript returns redacted transcript
//      (raw value ABSENT, ‹secret:NAME› PRESENT)
//   B. Fake gateway emits {kind:'usage', data:{...}} with SECRET_VALUE embedded →
//      transcript must not contain raw value
//   C. Negative control: same-shape non-secret string passes through unchanged (no over-redaction)
//   D. Perf bound (DES-088 S-S3 — 20 secrets × 200 events < 50ms): cross-ref to UT-089.
//      Here: timing guard on a 3-event run stays < 2000ms total (generous; sink I/O, not compute).
//
// Red reason: `AgentTranscriptSink` (AgentExecutor._emit → store.appendTranscript) does NOT
//   currently call `redact()` before storing events → `store.getTranscript()` returns the raw
//   event with the secret value → assertion "not.toContain(SECRET_VALUE)" fails for the correct
//   unimplemented reason. SecretValueProvider injection slot on AgentExecutor/RunManager also
//   doesn't exist → injection fails.
//
// Mock policy (integration — DES-091): fake GatewayClient that calls req.onEvent() synchronously
//   (no real LLM network call); real AgentExecutor + real InMemoryRunStore + real AgentTranscriptSink;
//   fake SecretValueProvider (in-table). No sandbox/spawner.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentExecutor } from '../../src/agent-executor.js';
import type { HarnessDescriptor } from '../../src/types.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { RunManager } from '../../src/run-manager.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { TranscriptEvent } from '../../src/types.js';
import { defaultRunParams } from '../../src/params/resolve.js';

const SECRET_NAME = 'IT075_TOKEN';
const SECRET_VALUE = 'it075-secret-tok-zyx321abc';
const SECRET_MARKER = `‹secret:${SECRET_NAME}›`;
const ORDINARY_STRING = 'it075-ordinary-tok-zyx321xy'; // same shape, different value
const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));

/** SecretValueProvider interface (DES-088 — does not exist yet, injection slot unimplemented) */
interface SecretValueProvider {
  entries(): ReadonlyArray<{ name: string; value: string }>;
}

const secretProvider: SecretValueProvider = {
  entries: () => [{ name: SECRET_NAME, value: SECRET_VALUE }],
};

/** Fake GatewayClient that emits controlled transcript events via onEvent before returning. */
function makeSecretEchoGateway(eventsToEmit: TranscriptEvent[]): GatewayClient {
  return {
    async invoke(req): Promise<GatewayResult> {
      const ts = clock.isoNow();
      for (const ev of eventsToEmit) {
        await req.onEvent?.({ ...ev, ts });
      }
      return { ok: true, provider: 'fake', model: 'fake-model', tokens: { input: 1, output: 1 }, content: 'ok' };
    },
  };
}

describe('redact-at-capture completeness sweep — sink (1): appendTranscript (DES-088, IT-075)', () => {
  let store: InMemoryRunStore;
  let runId: string;

  beforeEach(async () => {
    store = new InMemoryRunStore(clock);
    runId = await store.createRun({ origin: 'local', script: 'return 1;' }, 'v1');
  });

  it('A. message event with secret value → transcript stored has ‹secret:NAME›, not raw value', async () => {
    const secretEvent: TranscriptEvent = {
      kind: 'message',
      ts: clock.isoNow(),
      data: { role: 'assistant', content: `The token is ${SECRET_VALUE} and that is it.` },
    };
    const gateway = makeSecretEchoGateway([secretEvent]);

    // AgentExecutor must accept a secretValueProvider dep (doesn't exist yet → red once injected)
    const executor = new AgentExecutor({
      gateway,
      store,
      clock,
      // This injection slot doesn't exist yet → dep is silently ignored → no redaction → red
      secretValueProvider: secretProvider,
    } as any);

    const agentId = 'agent-001';
    await executor.run({
      runId,
      agentId,
      prompt: 'echo the token',
      opts: {},
      workspace: '/tmp',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    const transcript = await store.getTranscript(runId, agentId);
    const json = JSON.stringify(transcript);

    // Raw secret must NOT appear in the stored transcript
    expect(json).not.toContain(SECRET_VALUE);
    // Marker must appear (where the secret was)
    expect(json).toContain(SECRET_MARKER);
  });

  it('B. usage event with secret embedded → transcript stored without raw value', async () => {
    // Unusual but defensive: a usage event whose provider string happens to contain a secret token
    const usageEvent: TranscriptEvent = {
      kind: 'usage',
      ts: clock.isoNow(),
      data: { tokens: { input: 1, output: 1 }, provider: `prov-${SECRET_VALUE}`, model: 'fake' },
    };
    const gateway = makeSecretEchoGateway([usageEvent]);
    const executor = new AgentExecutor({ gateway, store, clock, secretValueProvider: secretProvider } as any);

    await executor.run({
      runId, agentId: 'agent-002', prompt: 'test', opts: {}, workspace: '/tmp',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    const transcript = await store.getTranscript(runId, 'agent-002');
    expect(JSON.stringify(transcript)).not.toContain(SECRET_VALUE);
  });

  it('C. negative control: ordinary non-secret string passes through unchanged (no over-redaction)', async () => {
    const ordinaryEvent: TranscriptEvent = {
      kind: 'message',
      ts: clock.isoNow(),
      data: { role: 'assistant', content: `Ordinary content: ${ORDINARY_STRING} here.` },
    };
    const gateway = makeSecretEchoGateway([ordinaryEvent]);
    const executor = new AgentExecutor({ gateway, store, clock, secretValueProvider: secretProvider } as any);

    await executor.run({
      runId, agentId: 'agent-003', prompt: 'ordinary', opts: {}, workspace: '/tmp',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    const transcript = await store.getTranscript(runId, 'agent-003');
    const json = JSON.stringify(transcript);

    // Ordinary string passes through unchanged
    expect(json).toContain(ORDINARY_STRING);
    // No secret marker applied to non-secret text
    expect(json).not.toContain(SECRET_MARKER);
  });
});

// ── Sinks (2) saveSnapshot + (4) appendJournal (DES-088 completeness sweep, IT-075) ─────────────
// These sinks live in RunManager (not AgentExecutor), so they need a real RunManager + on-disk
// SqliteRunStore + real sandbox child; only the GatewayClient is faked (integration mock policy,
// DES-091). The redaction is a PERSIST-ONLY transform: the in-memory records/journal keep the raw
// value (replay correctness, DES-088 invariant b), only the durable snapshot/journal.jsonl is redacted.

/** Fake gateway that returns a fixed content string (default: the secret value). */
function makeContentGateway(content: string): GatewayClient {
  return {
    async invoke(): Promise<GatewayResult> {
      return { ok: true, provider: 'fake', model: 'fake-model', tokens: { input: 1, output: 1 }, content };
    },
  };
}

async function pollStatus(mgr: RunManager, runId: string, want: string, tries = 300): Promise<string> {
  let v = await mgr.status(runId);
  for (let i = 0; i < tries && v.status !== want; i++) {
    await new Promise((r) => setTimeout(r, 20));
    v = await mgr.status(runId);
  }
  return v.status;
}

describe('redact-at-capture completeness sweep — sink (4): appendJournal (DES-088, IT-075)', () => {
  it('a JournalEntry.value carrying a provisioned secret is persisted redacted (raw ABSENT), while the in-memory replay value stays raw', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it075-journal-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), clock);
      // Secret rides BOTH the call KEY (prompt) and the RETURNED value: the prompt embeds the secret
      // (key.prompt) and the gateway returns it as content (journalEntry.value). The whole persisted
      // entry must be redacted — key.prompt was the live-Ollama Gate-7.5 leak (only .value was redacted).
      const gateway = makeContentGateway(SECRET_VALUE);
      const mgr = new RunManager({ store, clock, workRoot: dir, gateway, secretValueProvider: secretProvider } as any);
      // v24 (ADR-029): `agent(LABEL, {prompt})` — the label is a literal identifier and the secret
      // rides `options.prompt`, which is exactly what run-manager.ts marshals into `CallKey.prompt`
      // (`prompt = rawOpts.prompt ?? positional`). Same sink, same oracle, new spelling.
      const runId = await startScript(mgr, `const a = await agent('use', { prompt: ${JSON.stringify('use token ' + SECRET_VALUE)} }); return a;`);
      expect(await pollStatus(mgr, runId, 'completed')).toBe('completed');

      // Persisted journal.jsonl (the REPLAY source) is redacted — sink (4).
      const entries = await store.getJournal(runId);
      const json = JSON.stringify(entries);
      expect(json).not.toContain(SECRET_VALUE);
      expect(json).toContain(SECRET_MARKER);

      // Persist-only invariant (DES-088 b): the run's actual result — the in-memory return value the
      // script produced — is the RAW secret, not the marker (redaction never altered agent behaviour).
      const result = await mgr.result(runId);
      expect(result.ok && result.value).toBe(SECRET_VALUE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe('redact-at-capture completeness sweep — sink (2): saveSnapshot (DES-088, IT-075)', () => {
  it('an AgentRecord field carrying a secret is redacted in the persisted terminal snapshot (cross-restart GET /api/runs/:id must not leak)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it075-snapshot-'));
    try {
      const store1 = new SqliteRunStore(join(dir, 'store'), clock);
      // Secret rides an AgentRecord field (label), NOT the content — isolates sink (2) from (1)/(4).
      const gateway = makeContentGateway('ok');
      const mgr1 = new RunManager({ store: store1, clock, workRoot: dir, gateway, secretValueProvider: secretProvider } as any);
      const label = `lbl-${SECRET_VALUE}`;
      const runId = await startScript(mgr1, `await agent('A', { label: ${JSON.stringify(label)} }); return 1;`);
      expect(await pollStatus(mgr1, runId, 'completed')).toBe('completed');

      // "Restart": a fresh store reads the persisted terminal snapshot (getRun returns snap.agents
      // when a snapshot exists — sqlite-run-store.ts). The snapshot's AgentRecord[] must be redacted.
      const store2 = new SqliteRunStore(join(dir, 'store'), clock);
      await store2.hydrateAll();
      const view = await store2.getRun(runId);
      const agentsJson = JSON.stringify(view?.agents ?? []);
      expect(agentsJson).not.toContain(SECRET_VALUE);
      expect(agentsJson).toContain(SECRET_MARKER);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

// v21 Gate 5 addendum (B-4, DES-104, REQ-083, HIGHEST-VALUE item of the addendum): the run's
// admission-time effectiveParams snapshot is a NEW persist sink (run-manager.ts:411-413 already
// calls redact() on it before createRun) — but this sweep was never extended with a case for it.
// A secret value riding a user-supplied `appendPrompt` override must be redacted in the persisted
// snapshot exactly as it is in the other 4 sinks; the sweep is what catches a sink shipping without
// this coverage, per REQ-083's own purpose.
describe('redact-at-capture completeness sweep — sink (5): effectiveParams snapshot (DES-104, IT-075)', () => {
  it('a secret value in a user-supplied appendPrompt override is redacted in the persisted effectiveParams snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it075-params-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), clock);
      const gateway = makeContentGateway('ok');
      const mgr = new RunManager({ store, clock, workRoot: dir, gateway, secretValueProvider: secretProvider } as any);
      const appendPrompt = `use token ${SECRET_VALUE}`;
      // v24 (DES-145/DES-146): `overrides` is PER-AGENT — `{agents:{'<label>':{appendPrompt}}}`; the
      // old flat shape is refused PARAM_UNKNOWN. An `appendPrompt` override is only admissible on a
      // label whose contract DECLARES the key (contract.ts `validateOneAgentOverride`: an undeclared
      // key on a declared label is PARAM_UNKNOWN), and the fixture helper only synthesizes
      // model/effort/timeoutMs — so this script carries its own `meta`. The sink under test is
      // unchanged: the admission snapshot persisted by `createRun` must not contain the raw secret.
      const script = [
        "export const meta = { params: { agents: { work: {",
        "  model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' },",
        "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
        "  timeoutMs: { type: 'number', default: 60000 },",
        "  appendPrompt: { type: 'string' } } } } };",
        "return await agent('work', {});",
      ].join('\n');
      const runId = await startScript(mgr, script, {}, { agents: { work: { appendPrompt } } });
      expect(await pollStatus(mgr, runId, 'completed')).toBe('completed');

      const persisted = await store.getEffectiveParams(runId);
      const json = JSON.stringify(persisted);
      expect(json).not.toContain(SECRET_VALUE);
      expect(json).toContain(SECRET_MARKER);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

// v21 Gate 8 send-back re-run (2026-09-01, review §4 B3 ≡ adversarial F3, "the non-negotiable item
// of the batch"): the `kind:'harness'` transcript sink (agent-executor.ts:406-412, `onHarness`)
// persists the gateway-emitted `HarnessDescriptor` (which carries `prompt` — the composed
// [agentType systemPrompt]+[defaults.prompt]+[script prompt]+[framed appendPrompt], REQ-094) with
// NO `redact()` call at all — `redactHarness` never touches secret VALUES. `onEvent`'s
// `kind!=='harness'` guard excluded this sink from redaction on a "double-redaction exclusivity"
// premise the review found false (onHarness never redacted either) — so a secret riding a
// user-supplied `appendPrompt` reached the persisted harness transcript entry raw. Extends this
// sweep with sink (6), same fake-gateway convention as sink (1)/(2)/(3) above but calling
// `req.onHarness()` instead of `req.onEvent()`.
//
// STATE AS OF THE §R2 RE-REVIEW CLOSEOUT (the paragraph above is the RED-time rationale, kept):
// `onHarness` now redacts, and the two `kind!=='harness'` guards are DELETED (R-G10) — redaction is
// no longer kind-gated at any sink. `redactHarness` is a purely STRUCTURAL strip and no longer
// truncates: the 4KB cap is the exported `capPrompt`, applied at this persist site AFTER `redact()`
// (R-G9), because capping first could split a secret across the 2048-char seam and defeat
// `redact()`'s value-exact match. This test is unchanged and still green.
describe('redact-at-capture completeness sweep — sink (6): kind:\'harness\' transcript descriptor (DES-088 inv-5 sink-completeness, review §4 B3)', () => {
  it('a secret riding the harness descriptor.prompt is redacted in the persisted kind:\'harness\' transcript entry', async () => {
    const store = new InMemoryRunStore(clock);
    const runId = await store.createRun({ origin: 'local', script: 'return 1;' }, 'v1');

    const descriptor: HarnessDescriptor = {
      model: 'fake-model',
      provider: 'fake',
      prompt: `use token ${SECRET_VALUE}`,
      tools: [],
      skills: [],
      mcpServers: [],
      surfaceType: 'none',
    };
    const gateway: GatewayClient = {
      async invoke(req): Promise<GatewayResult> {
        await req.onHarness?.(descriptor);
        return { ok: true, provider: 'fake', model: 'fake-model', tokens: { input: 1, output: 1 }, content: 'ok' };
      },
    };
    const executor = new AgentExecutor({ gateway, store, clock, secretValueProvider: secretProvider } as any);

    const agentId = 'agent-006';
    await executor.run({
      runId, agentId, prompt: 'echo the token', opts: {}, workspace: '/tmp',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    const transcript = await store.getTranscript(runId, agentId);
    const harnessEntries = transcript.filter((e) => e.kind === 'harness');
    expect(harnessEntries.length).toBeGreaterThan(0);
    const json = JSON.stringify(harnessEntries);

    expect(json).not.toContain(SECRET_VALUE);
    expect(json).toContain(SECRET_MARKER);
  });
});

// H-3 send-back repair (2026-09-10, ARCH-111, DES-171, INV-V26-5): `AgentRecord.detail` and the
// failed-branch `usage` event's `data.detail` used to be CAPPED at build time, inside
// `claude-agent-sdk-client.ts`'s `_drain`, before `redact()` ever saw the string — a secret
// straddling the 1024-byte seam was cut in half and `redact()`'s value-exact match then failed on
// BOTH fragments. Under that bug, `not.toContain(SECRET_VALUE)` still PASSES (the two cut fragments
// don't equal the whole secret either), so the discriminating assertion is SECRET_MARKER PRESENCE,
// not raw-value absence — a case that only checks absence proves nothing (review's own wording).
// A dedicated, longer secret for the straddle case — its MARKER (`‹secret:<name>›`, fixed-length,
// independent of the secret's own length) must fit entirely below the 1024-byte cutoff so capping
// the (already-redacted, now-shorter) string cannot ALSO clip the marker itself and produce a false
// negative. The RAW secret is long enough that it still straddles byte 1024 either way.
const BIG_SECRET_NAME = 'IT075_STRADDLE_TOKEN';
const BIG_SECRET_VALUE = `it075-straddle-${'Z'.repeat(90)}`; // 105 bytes
const BIG_SECRET_MARKER = `‹secret:${BIG_SECRET_NAME}›`;
const bigSecretProvider: SecretValueProvider = {
  entries: () => [{ name: BIG_SECRET_NAME, value: BIG_SECRET_VALUE }],
};

describe('redact-at-capture completeness sweep — sink (7): AgentRecord.detail (H-3 send-back repair, INV-V26-5)', () => {
  it('a secret STRADDLING the 1024-byte detail cap boundary is still redacted — the marker survives on both the AgentRecord and the failed-branch usage event', async () => {
    const store = new InMemoryRunStore(clock);
    const runId = await store.createRun({ origin: 'local', script: 'return 1;' }, 'v1');
    // Secret (105 bytes) spans bytes 950..1055 — straddles the 1024-byte cutoff with margin on both
    // sides, while its marker (29 bytes) spans 950..979, comfortably below the cutoff once redacted.
    // A cap-first bug slices the RAW secret into two fragments, neither a value-exact match, so
    // SECRET_MARKER never appears anywhere in the output under the old order.
    const detail = `${'x'.repeat(950)}${BIG_SECRET_VALUE}${'y'.repeat(200)}`;
    const gateway: GatewayClient = {
      async invoke(): Promise<GatewayResult> {
        return { ok: false, provider: 'fake', reason: 'terminal', detail };
      },
    };
    const executor = new AgentExecutor({ gateway, store, clock, secretValueProvider: bigSecretProvider } as any);

    const agentId = 'agent-007';
    await executor.run({
      runId, agentId, prompt: 'x', opts: {}, workspace: '/tmp',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    const record = executor.getRecord(agentId);
    expect(record?.detail).not.toContain(BIG_SECRET_VALUE);
    expect(record?.detail).toContain(BIG_SECRET_MARKER);
    // Cap still bounds the size — the redacted string (950 filler + 29-byte marker + 200 filler =
    // 1179 bytes) is still over 1024, so the "…[truncated]" suffix is expected; this pins the bound
    // stays enforced (byte length, not `.length`/UTF-16 units — the suffix's `…` is a 3-byte glyph).
    expect(Buffer.byteLength(record?.detail ?? '', 'utf8')).toBeLessThanOrEqual(1024 + Buffer.byteLength('…[truncated]', 'utf8'));

    const transcript = await store.getTranscript(runId, agentId);
    const json = JSON.stringify(transcript);
    expect(json).not.toContain(BIG_SECRET_VALUE);
    expect(json).toContain(BIG_SECRET_MARKER);
  });

  // INV-V26-5's second named surface. This is a LOCK, not a red→green: the real order-sensitive step
  // for an unmapped subtype is `sanitizeSubtype`'s `[a-z0-9_.-]` whitelist inside
  // `claude-agent-sdk-client.ts`'s `_drain` (unreachable through a fake `GatewayClient` — a unit
  // concern, not this integration sweep's), which mangles any realistic secret before `redact()` ever
  // runs regardless of order. What this DOES prove, at the persist site every `unmapped` entry
  // reaches: `redact()` still applies to `AgentRecord.unmapped`/the usage event's `data.unmapped`
  // whatever built the string, even one straddling the 64-byte cap `sanitizeSubtype` itself applies.
  it('a secret straddling the 64-byte unmapped-subtype cap boundary is redacted at the persist site (lock)', async () => {
    const store = new InMemoryRunStore(clock);
    const runId = await store.createRun({ origin: 'local', script: 'return 1;' }, 'v1');
    // Secret spans bytes 50..76 — straddles sanitizeSubtype's own 64-byte cap.
    const unmappedEntry = `${'a'.repeat(50)}${SECRET_VALUE}`;
    const gateway: GatewayClient = {
      async invoke(): Promise<GatewayResult> {
        return { ok: true, provider: 'fake', model: 'fake-model', tokens: { input: 1, output: 1 }, content: 'ok', unmapped: [unmappedEntry] };
      },
    };
    const executor = new AgentExecutor({ gateway, store, clock, secretValueProvider: secretProvider } as any);

    const agentId = 'agent-008';
    await executor.run({
      runId, agentId, prompt: 'x', opts: {}, workspace: '/tmp',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    const transcript = await store.getTranscript(runId, agentId);
    const json = JSON.stringify(transcript);
    expect(json).not.toContain(SECRET_VALUE);
    expect(json).toContain(SECRET_MARKER);
  });
});
