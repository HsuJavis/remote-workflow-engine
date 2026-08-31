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
import { InMemoryRunStore } from '../../src/run-store.js';
import { RunManager } from '../../src/run-manager.js';
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
    runId = await store.createRun({ script: 'return 1;' }, 'v1');
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
      const runId = await mgr.start({ script: `const a = await agent(${JSON.stringify('use token ' + SECRET_VALUE)}); return a;` });
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
      const runId = await mgr1.start({ script: `await agent('A', { label: ${JSON.stringify(label)} }); return 1;` });
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
