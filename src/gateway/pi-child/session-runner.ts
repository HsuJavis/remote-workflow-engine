// src/gateway/pi-child/session-runner.ts (pi harness v1, slice c). The REAL per-dispatch pi session
// logic — kept in its own typechecked module (unlike entry.ts, which is excluded from both
// tsconfigs the same way src/sandbox/child-entry.ts is) so this file gets full tsc coverage. Loaded
// by entry.ts via an explicit `.ts` specifier (raw `node --experimental-transform-types`); the ONLY
// local import here is `import type` from protocol.ts, which is erased by type-stripping and so
// never triggers a runtime module resolution that extension would otherwise break (see protocol.ts's
// own header comment).
//
// v1-c scope (this file): ollama text-only, no tools (`noTools:'all'`) — proves the child/gateway
// skeleton with a real model call. Bash/file tools (slice d/e), MCP (slice g) and skills (slice h)
// extend `buildSession` below without changing this file's shape.
import {
  createAgentSession, createExtensionRuntime, ModelRuntime,
  SessionManager, SettingsManager, type ResourceLoader,
} from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';
import type { PiChildConfig, PiChildEvent } from './protocol.js';

const emptyResourceLoader = (systemPrompt: string): ResourceLoader => ({
  // Full-control (spec "Inside the child"): no discovery, no context files — the engine supplies
  // the whole system prompt; skills (slice h) extend getSkills() with an explicit list, never
  // directory discovery.
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => systemPrompt,
  getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  extendResources: () => {},
  reload: async () => {},
});

/** pi-spike-report.md design change 5: `registerProvider()`'s typed API requires a COMPLETE
 *  `ProviderModelConfig` (id/name/input/cost/reasoning/contextWindow/maxTokens all mandatory) — the
 *  bare `{id}` shorthand pi's OWN file-based `models.json` docs show throws at REQUEST time, not
 *  registration time, through this path. Built once per dispatch (one child = one model = one
 *  registration), never the file-based shorthand. `cost` is all-zero: the engine prices usage itself
 *  (spec "Usage" — "the engine prices usage; ignore pi's own cost figure"), never pi's advisory
 *  figure. `contextWindow`/`maxTokens` are conservative, pi-internal-only defaults (truncation/
 *  context bookkeeping) — they do not reach the engine's own accounting. */
export function buildModelConfig(modelId: string, reasoning: boolean): {
  id: string; name: string; input: ('text' | 'image')[]; cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  reasoning: boolean; contextWindow: number; maxTokens: number;
} {
  return {
    id: modelId, name: modelId, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning, contextWindow: 128_000, maxTokens: 8192,
  };
}

async function resolveModel(config: PiChildConfig, runtime: ModelRuntime) {
  if (config.model.provider === 'ollama') {
    runtime.registerProvider('ollama-runtime', {
      baseUrl: `${config.model.baseUrl}/v1`,
      api: 'openai-completions',
      apiKey: 'ollama', // ollama ignores the key; openai-completions requires SOME value
      models: [buildModelConfig(config.model.model, false)],
    });
    const model = runtime.getModel('ollama-runtime', config.model.model);
    if (!model) throw new Error(`MODEL_REGISTRATION_FAILED: ollama/${config.model.model} did not register`);
    return model;
  }
  // openrouter (slice i extends this arm with openrouterBaseUrl / recording-fake-server support).
  runtime.registerProvider('openrouter', {
    baseUrl: config.openrouterBaseUrl ?? 'https://openrouter.ai/api/v1',
    apiKey: config.apiKey,
    models: [buildModelConfig(config.model.model, true)],
  });
  const model = runtime.getModel('openrouter', config.model.model);
  if (!model) throw new Error(`MODEL_REGISTRATION_FAILED: openrouter/${config.model.model} did not register`);
  return model;
}

/** Runs ONE agent() dispatch end to end inside the child process, streaming `PiChildEvent`s to
 *  `emit` as pi's own session reports them, and resolving when the prompt settles (success, error or
 *  abort). Never throws for a provider/session failure — those become `{t:'error'}`/`{t:'fatal'}`
 *  events so entry.ts's wire protocol stays uniform; a thrown error here means a programming defect,
 *  not a dispatch failure. */
export async function runPiChildSession(config: PiChildConfig, emit: (event: PiChildEvent) => void): Promise<void> {
  const runtime = await ModelRuntime.create({
    authPath: join(config.agentDir, 'auth.json'),
    modelsPath: join(config.agentDir, 'models.json'),
  });
  if (config.apiKey !== undefined) {
    // Owner decision 3: the key lives ONLY in this child's memory, injected via setRuntimeApiKey —
    // never written to agentDir/auth.json (which stays `{}` — ModelRuntime.create above never wrote
    // one), never passed to bash (bash-env.ts's allowlist has no provider-key key at all).
    await runtime.setRuntimeApiKey(config.model.provider, config.apiKey);
  }
  const model = await resolveModel(config, runtime);

  const { session } = await createAgentSession({
    cwd: config.cwd,
    agentDir: config.agentDir,
    model,
    thinkingLevel: 'off',
    modelRuntime: runtime,
    resourceLoader: emptyResourceLoader(config.systemPrompt),
    noTools: 'all',
    sessionManager: SessionManager.inMemory(config.cwd),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 } }),
  });

  // pi-spike-report.md design changes 7/8: no stable message id exists; key on an adapter-owned
  // sequence counter, incremented on every ASSISTANT message_end (message_end fires for every role).
  let seq = 0;
  session.subscribe((event) => {
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
    const msg = event.message;
    const text = msg.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text').map((c) => c.text).join('');
    const usage = { input: msg.usage.input, output: msg.usage.output, cacheRead: msg.usage.cacheRead, cacheWrite: msg.usage.cacheWrite };
    seq += 1;
    if (msg.stopReason === 'error') {
      emit({ t: 'error', message: msg.errorMessage ?? 'pi reported stopReason:"error" with no errorMessage', stopReason: msg.stopReason });
      return;
    }
    emit({ t: 'message_end', seq, text, usage, stopReason: msg.stopReason });
  });

  try {
    await session.prompt(config.prompt);
  } catch (err) {
    emit({ t: 'error', message: err instanceof Error ? err.message : String(err) });
    session.dispose();
    return;
  }

  const last = session.getLastAssistantText?.();
  emit({
    t: 'final',
    seq,
    text: last ?? '',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // the parent sums message_end usage; this is a text-only convenience field
    stopReason: 'stop',
  });
  session.dispose();
}
