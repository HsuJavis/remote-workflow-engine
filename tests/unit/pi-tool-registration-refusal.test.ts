// pi harness v1, review M3: the spec says an unsupported tool (WebFetch/WebSearch/Task/NotebookEdit)
// is refused "at registration AND dispatch" — before this fix only dispatch refused
// (PiGatewayClient.invoke's own mapTools), so a workflow declaring allowedTools:['Read','WebFetch']
// registered successfully and only failed once a run actually tried to dispatch that agent (the run
// stayed `completed`, only the agent `failed`). A REAL WorkflowCatalog on a tmp sqlite, gated the SAME
// way checkModelRef's own anthropic-provider gate is: `catalog.harnessProviders !== undefined`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { EMPTY_MODEL_CATALOG } from '../../src/providers.js';

const CLOCK = new FixedClock(new Date('2026-10-03T10:00:00.000Z'));

const AGENT_DECL =
  "model: { type: 'string', default: 'ollama/qwen2.5:7b' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 }";

function scriptWithTools(tools: string[]): string {
  return (
    `export const meta = { description: 'd', phases: [{ title: 'P' }], params: { agents: { a: { ${AGENT_DECL} } } } };\n` +
    "phase('P');\n" +
    `return await agent('a', { prompt: 'p', allowedTools: ${JSON.stringify(tools)} });`
  );
}
// Never actually reached when the tool refusal fires first (which is what most cases below check),
// so an imprecise mermaid is fine for those — only the "registers fine under sdk" case needs a real
// one, built the same way bash-readonly-registration.test.ts's own `mermaid()` helper does.
function mermaidFor(tools: string[]): string {
  const seg = tools.length === 0 ? 'none' : [...tools].sort().join(', ');
  return `graph LR\nsubgraph "P"\na(["a<br/>ollama/qwen2.5:7b · low · 60000<br/>tools: ${seg}"])\nend`;
}

async function errorCodeOf(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; } catch (err) { return (err as { code?: string }).code; }
}

let workRoot: string;
function piCatalog(): WorkflowCatalog {
  return new WorkflowCatalog(workRoot, CLOCK, { catalogSnapshot: async () => ({ ...EMPTY_MODEL_CATALOG, harnessProviders: ['openrouter', 'ollama'] }) });
}
function sdkCatalog(): WorkflowCatalog {
  return new WorkflowCatalog(workRoot, CLOCK); // harnessProviders absent -> sdk gateway, unchanged
}
beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-pi-tool-reg-')); });
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

describe('WorkflowCatalog.register — pi tool refusal at REGISTRATION time (review M3)', () => {
  it('under gateway:"pi", allowedTools:[\'Read\',\'WebFetch\'] is refused TOOL_UNSUPPORTED_BY_HARNESS at registration, never reaching mermaid/insert', async () => {
    const catalog = piCatalog();
    const code = await errorCodeOf(catalog.register({ name: 'pi-web', script: scriptWithTools(['Read', 'WebFetch']), mermaid: mermaidFor(['Read', 'WebFetch']) }));
    expect(code).toBe('TOOL_UNSUPPORTED_BY_HARNESS');
  });

  it('names every unsupported tool, not just the first', async () => {
    const catalog = piCatalog();
    let detail: unknown;
    try {
      await catalog.register({ name: 'pi-web2', script: scriptWithTools(['Task', 'WebSearch', 'NotebookEdit']), mermaid: mermaidFor(['Task', 'WebSearch', 'NotebookEdit']) });
    } catch (err) {
      detail = (err as { detail?: unknown }).detail;
    }
    expect((detail as { unsupported?: string[] })?.unsupported).toEqual(['Task', 'WebSearch', 'NotebookEdit']);
  });

  it('an mcp__<server>__<tool> entry is NOT refused as unsupported under pi (review M2 parity, at registration too)', async () => {
    const catalog = piCatalog();
    const code = await errorCodeOf(catalog.register({ name: 'pi-mcp-tool', script: scriptWithTools(['Read', 'mcp__everything__echo']), mermaid: mermaidFor(['Read', 'mcp__everything__echo']) }));
    expect(code).not.toBe('TOOL_UNSUPPORTED_BY_HARNESS');
  });

  it('under gateway:"sdk" (harnessProviders absent), the SAME WebFetch declaration is NOT refused as unsupported — zero behavior change there', async () => {
    const catalog = sdkCatalog();
    const code = await errorCodeOf(catalog.register({ name: 'sdk-web', script: scriptWithTools(['Read', 'WebFetch']), mermaid: mermaidFor(['Read', 'WebFetch']) }));
    expect(code).not.toBe('TOOL_UNSUPPORTED_BY_HARNESS');
  });

  it('an agent with NO allowedTools at all (the deployment default) is never checked — nothing to flag', async () => {
    const catalog = piCatalog();
    const script =
      `export const meta = { description: 'd', phases: [{ title: 'P' }], params: { agents: { a: { ${AGENT_DECL} } } } };\n` +
      "phase('P');\n" +
      "return await agent('a', { prompt: 'p' });";
    const code = await errorCodeOf(catalog.register({ name: 'pi-default-tools', script, mermaid: 'graph LR\nsubgraph "P"\na(["a<br/>ollama/qwen2.5:7b · low · 60000"])\nend' }));
    expect(code).not.toBe('TOOL_UNSUPPORTED_BY_HARNESS');
  });
});
