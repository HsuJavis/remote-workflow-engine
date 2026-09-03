// IT-098 (TASK-126, DES-125/127/131/134, ARCH-078/079/081): the unowned composition root
// (v23 adjudication #2, R-1/R-2). `GraphAnalyzer` and real `TriggerPorts` are built and exported but
// `createServer()` never constructs/wires either into `new McpFacade(...)` (server.ts:1398) — an
// unwired call site that trace.py cannot see because an unowned construction site is not a broken
// link. R-2 additionally rules that `McpFacadeDeps.triggerPorts`/`.graphAnalyzer` must become
// REQUIRED (not `?:`), and `triggerPorts ?? NO_TRIGGER_PORTS` deleted, so the NEXT unwired call site
// is a `tsc` error instead of this same silent degrade recurring a third time.
//
// Mock policy (integration, DES-119): real `createServer`, real `/mcp` over live HTTP for the
// behavioral case (no live LLM needed — `workflow_regenerate_diagram` only has to return its
// immediate `{queued, status:'pending'}` envelope, per its own advertised contract of never waiting
// for the draw; the background draw itself is REQ-102/VAL-113's own concern). The two structural
// cases are pure static-text reads over `src/**`, same convention as UT-115/UT-117.
//
// Red reason: TODAY `new GraphAnalyzer(` appears zero times in `src/` (case 1 fails: 0 !== 1);
// `McpFacadeDeps.triggerPorts`/`.graphAnalyzer` are both still declared optional and
// `?? NO_TRIGGER_PORTS` is still present in `mcp-facade.ts` (case 2 fails); and with
// `graphAnalyzer.enabled:true` on `createServer`'s own config, `workflow_regenerate_diagram` STILL
// returns `ANALYZER_DISABLED` — the facade's `graphAnalyzer` dep is `undefined` regardless of what
// the config says, because nothing ever constructs and passes it (case 3 fails for the genuine
// unimplemented reason, not a config or auth mistake).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { DEFAULT_ALIASES } from '../../src/default-aliases.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listTsFiles(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('TASK-126: composition root — structural (grep-level, no server boot)', () => {
  it('`new GraphAnalyzer(` appears EXACTLY ONCE across src/** — the one construction site `createServer()` owns', () => {
    const hits: string[] = [];
    for (const file of listTsFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      const matches = text.match(/new GraphAnalyzer\(/g);
      if (matches) hits.push(...matches.map(() => file));
    }
    expect(hits.length).toBe(1);
  });

  it('`McpFacadeDeps.triggerPorts`/`.graphAnalyzer` are REQUIRED (not `?:`), and the `?? NO_TRIGGER_PORTS` degrade is gone', () => {
    const text = readFileSync(join(SRC_ROOT, 'mcp-facade.ts'), 'utf8');
    expect(/\btriggerPorts\?:/.test(text)).toBe(false);
    expect(/\bgraphAnalyzer\?:/.test(text)).toBe(false);
    expect(text.includes('?? NO_TRIGGER_PORTS')).toBe(false);
  });
});

describe('TASK-126: composition root — behavioral (real createServer, real /mcp, no live LLM needed)', () => {
  let server: Server;
  let workRoot: string;

  async function call(name: string, args: unknown): Promise<any> {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
  }

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it098-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot, graphAnalyzer: { enabled: true } } as never);
  });
  afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it('with graphAnalyzer.enabled:true in config, workflow_regenerate_diagram is NOT ANALYZER_DISABLED — the config actually reaches the facade', async () => {
    const { version } = await registerPublishedVia(call, 'it098-flow', `return 1;`);
    const resp = await call('workflow_regenerate_diagram', { name: 'it098-flow', version });
    expect(resp.code).not.toBe('ANALYZER_DISABLED');
    expect(resp.queued).toBe(true);
    expect(resp.status).toBe('pending');
  });
});

// TASK-127 (DES-122, ARCH-079, ARCH-085): DES-122's zero-config fail-closed rule — "with
// `graphAnalyzer.enabled` and no resolvable `workRoot`, `tools` is forced to `[]` regardless of what
// the operator configured, and the boot line states the downgrade and its reason". Today
// `graphAnalyzerConfig.tools` (server.ts:1462-1475) applies `config?.graphAnalyzer?.tools ?? []`
// unconditionally — never consulting `config?.workRoot` — so an operator who configures
// `graphAnalyzer.tools` without also configuring `workRoot` (the exact zero-config shape: `main.ts`'s
// own SDK-gateway `cwd` falls back to `undefined`, i.e. "nothing to enforce against, allow", per the
// docblock DES-122 cites) gets their configured tools through UNCURATED. This is a real gap, not a
// hypothetical: the SAME `graphAnalyzer.model: 'default'` alias this suite's other case relies on
// resolves to `provider: 'anthropic'` (`default-aliases.ts`), and `curateToolsForProvider` is a
// no-op for `'anthropic'` (`claude-agent-sdk-client.ts:224`) — so no existing curation layer masks
// the missing guard.
//
// Mock policy (integration, DES-119): real `createServer`, real boot; the only thing spied is
// `console.log` to read the two already-shipped boot lines (DES-131's own "two boot lines, same
// stdout convention") — same convention as UT-111's journal-line spy.
//
// Red reason: TODAY the `graph-analyzer effective tools=` boot line prints `["Bash"]` (the
// configured value, unfiltered) instead of `[]`, because server.ts never branches on `config?.workRoot`
// when computing `graphAnalyzerConfig.tools` — the guard TASK-127 exists to build is simply absent.
describe('TASK-127: DES-122 zero-config fail-closed guard — graphAnalyzer.tools forced to [] with no resolvable workRoot', () => {
  it('graphAnalyzer.enabled:true + a configured non-empty tools list + NO config.workRoot -> effective tools forced to [], and the boot line names workRoot as the reason', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let server: Server | undefined;
    try {
      // Deliberately omits `workRoot` — the exact zero-config shape DES-122 names ("on a zero-config
      // install the jail root is unresolvable"). `createServer` still mkdtemps an internal fallback
      // (server.ts:1290) for its OWN storage needs, but that is a different thing from the operator
      // having configured a real, certified `workRoot` — DES-122's rule keys off the latter
      // (`config?.workRoot`, the value `main.ts`'s own `analyzerScratchCwd` guard already keys off).
      server = await createServer({
        port: 0, bind: '127.0.0.1',
        graphAnalyzer: { enabled: true, tools: ['Bash'] },
      } as never);
      const emittedLines = logSpy.mock.calls.map((c) => c.join(' '));
      const toolsLine = emittedLines.find((l) => l.includes('graph-analyzer effective tools='));
      expect(toolsLine).toBeDefined();
      expect(toolsLine).toContain('effective tools=[]');
      // The reason must be stated somewhere in the boot output, not silently applied.
      expect(emittedLines.some((l) => /workRoot/i.test(l))).toBe(true);
    } finally {
      logSpy.mockRestore();
      await server?.close();
    }
  });
});

// IT-100 (Gate 6.5+7 system-level addition, 2026-09-03 — REQ-102, ARCH-005, DES-131): the
// system-level half of V-2, only writable now that V-2 is implemented. UT-121 pins that a listener
// is attached to the spawned child; this pins the CONSEQUENCE on the real wire, through the real
// server: with the MANAGED-proxy gateway (`useLiteLLMProxy`, the documented default deployment
// shape) wired as the analyzer's gateway, `workflow_register` alone reaches a real `litellm` spawn —
// and on a host without that binary the ENOENT 'error' event, with no listener, was an uncaught
// process-level exception that took the ENGINE down. That is how the validator met it.
//
// `PATH` is emptied for the duration so the spawn is a guaranteed ENOENT on any host (including one
// that does have `litellm`), then restored. Verified NON-VACUOUS the only way that means anything:
// run against the pre-V-2 tree it kills the worker; against this tree the engine keeps answering
// and the diagram settles `unavailable` with an engine-authored note — a degraded feature, not a
// dead process.
describe('IT-100: a workflow_register on a host with no `litellm` binary must not take the engine down (REQ-102, ARCH-005)', () => {
  it('the analyzer job fails, the diagram settles unavailable with a note, and the server still answers', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it100-'));
    const emptyBinDir = mkdtempSync(join(tmpdir(), 'rwe-it100-nopath-'));
    const realPath = process.env.PATH;
    process.env.PATH = emptyBinDir; // set BEFORE the gateway exists: `litellm` is unresolvable
    // `aliases` and no `gateway`: createServer itself builds the LiteLLMGatewayClient with
    // `useLiteLLMProxy: config?.useLiteLLMProxy ?? true` (server.ts:1383, D-R1 — the production
    // default), and `analyzerGateway` is that same client. This is the deployed shape, not a
    // gateway hand-built by the test.
    const server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot, aliases: DEFAULT_ALIASES, graphAnalyzer: { enabled: true },
    } as never);
    async function call(name: string, args: unknown): Promise<any> {
      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      });
      const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
      return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
    }
    try {
      await registerPublishedVia(call, 'it100-flow', `return 1;`);
      // Poll the engine itself — every answered poll is also the survival assertion.
      let view: any;
      for (let i = 0; i < 20 && (view?.diagramStatus ?? 'pending') === 'pending'; i++) {
        await new Promise((r) => setTimeout(r, 250));
        view = (await call('workflow_describe', { name: 'it100-flow' })).result;
      }
      expect(view.diagramStatus).toBe('unavailable');
      expect(view.diagramNote).toMatch(/\S/); // an engine-authored note, never an empty string
    } finally {
      process.env.PATH = realPath;
      await server.close();
      rmSync(workRoot, { recursive: true, force: true });
      rmSync(emptyBinDir, { recursive: true, force: true });
    }
  });
});

// IT-103 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, R-3): the R-3 ruling keeps `server.ts:955`'s
// `graphAnalyzer.enabled` check as explicit DEFENCE-IN-DEPTH under the choke-point fix ("`server.ts:955`
// and `mcp-facade.ts:462` STAY as defence-in-depth ... and EACH EARNS A ONE-LINE ASSERTION" — 02-
// architecture.md, ARCH-079 inv 11). `mcp-facade.ts:462`'s guard is ALREADY pinned by
// `tests/unit/workflow-describe-facade.test.ts:98` ("an owner-authorised call on a disabled analyzer
// is refused ANALYZER_DISABLED") — cited here, not duplicated, per this send-back's own inv 8 rule
// (an oracle's scope lives on the item's own scope line, never rediscovered by a second test). This
// item is the OTHER half: the dispatch-level guard at the `workflow_register` handler.
//
// Status note, not a red-because-unimplemented item (IT-102's own precedent in this exact ledger for
// a legitimate immediate green — a drift-lock/defence-in-depth hardening, not a missing feature):
// verified this already holds today — `server.ts:955`'s `if (out['status'] === 'completed' &&
// graphAnalyzer.enabled)` guard runs before `graphAnalyzer.enqueue(...)` is ever reached, so an
// injected gateway's `invoke` is never called when the port's `enabled` is `false`. `npx vitest run
// tests/integration/graph-analyzer-composition-root.test.ts -t 'IT-103'` -> pass today.
describe('IT-103: server.ts:955 defence-in-depth — a disabled analyzer never reaches the injected gateway on register', () => {
  it('registering with graphAnalyzer.enabled:false never calls gateway.invoke', async () => {
    const invoke = vi.fn(async () => ({
      ok: true as const, provider: 'anthropic', model: 'sonnet-5', tokens: { input: 1, output: 1 }, content: '╭─Draft─╮',
    }));
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it103-'));
    const server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot, gateway: { invoke },
      graphAnalyzer: { enabled: false },
    } as never);
    async function call(name: string, args: unknown): Promise<any> {
      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      });
      const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
      return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
    }
    try {
      await registerPublishedVia(call, 'it103-flow', `return 1;`);
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      await server.close();
      rmSync(workRoot, { recursive: true, force: true });
    }
  });
});

// IT-104 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, SUS-2, ADR-020): "Gate 5 owes the mirror
// rows — a warn-level line when `tools` is non-empty, and none when empty — without which this
// drops silently a second time." Verified against primary source: `server.ts:1512` is the ONLY
// analyzer-tools boot line and it is an unconditional `console.log`, byte-identical in form for
// `tools:[]` and `tools:["Bash"]`; the only `console.warn` in this block fires for the UNRELATED
// unknown-alias case at `:1497`.
//
// Fixture: `model` is left at its default (`'default'` alias -> `'anthropic'`, a KNOWN alias, so
// the unrelated unknown-alias warn at `:1497` never fires and cannot pollute this assertion), and
// `curateToolsForProvider` is a documented no-op for `'anthropic'`
// (`claude-agent-sdk-client.ts:224` — the SAME fact TASK-127's own fixture above already relies
// on), so the EFFECTIVE tool set equals the CONFIGURED one here — the simplest fixture that still
// keys the warning off the effective set per the amendment ("keyed off the effective set because
// three sets are in play").
//
// Red reason (measured): `npx vitest run tests/integration/graph-analyzer-composition-root.test.ts
// -t 'IT-104'` -> the non-empty-tools case fails: no `console.warn` call mentions the analyzer's
// tool surface at all today, in either fixture.
describe('IT-104: ADR-020 mirror rows — a boot-time console.warn when the EFFECTIVE analyzer tool set is non-empty, none when empty', () => {
  async function bootWithTools(tools: string[]): Promise<{ warnLines: string[] }> {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it104-'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let server: Server | undefined;
    try {
      server = await createServer({
        port: 0, bind: '127.0.0.1', workRoot,
        graphAnalyzer: { enabled: true, tools },
      } as never);
      return { warnLines: warnSpy.mock.calls.map((c) => c.join(' ')) };
    } finally {
      warnSpy.mockRestore();
      await server?.close();
      rmSync(workRoot, { recursive: true, force: true });
    }
  }

  it('a non-empty configured tools list (default model -> a known alias, no curation change) emits a warn line naming the risk', async () => {
    const { warnLines } = await bootWithTools(['Bash']);
    const riskLine = warnLines.find((l) => l.includes('graph-analyzer') && /Bash/.test(l) && /tool/i.test(l));
    expect(riskLine).toBeDefined();
  });

  it('an empty (default) tools list emits no such warn line', async () => {
    const { warnLines } = await bootWithTools([]);
    const riskLine = warnLines.find((l) => l.includes('graph-analyzer') && /tool/i.test(l));
    expect(riskLine).toBeUndefined();
  });
});
