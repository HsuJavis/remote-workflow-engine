// src/authoring-guide.ts (DES-157, ARCH-107, TASK-150, v24)
//
// buildAuthoringGuide(ceilings) — the ONE source of authoring truth. It is PURE over its
// `ceilings` argument (the caller passes the RESOLVED, operator-overridable ServerConfig
// ceilings, never a hard-coded literal — proved by tests/unit/authoring-guide.test.ts's FAKE
// ceiling interpolation case). It DOES import the closed vocabulary modules (LOCKED_KEYS,
// TUNABLE_KEYS, ERROR_CATALOG) directly — those are structural facts the validators themselves
// read, not tunable inputs, so rendering them from the modules (rather than re-typing them here)
// is what keeps the guide from drifting the way v23's hand-written AUTHORING.md did (ADR-032).
//
// `docs/AUTHORING.md` is generated from this SAME builder by scripts/gen-authoring-md.ts — never
// hand-edited (tests/unit/authoring-md-generated.test.ts is the diff lock).
import { LOCKED_KEYS, TUNABLE_KEYS, type Effort } from './params/contract.js';
// v25 (#55): the accepted `agent()` option keys the guide lists come from the scanner that
// enforces them, so the manual cannot teach a set the engine does not check.
import { WRITABLE_AGENT_OPT_KEYS } from './workflow-meta.js';
import { ERROR_CATALOG } from './errors.js';
// v24 Gate 7.5 (D-4): the diagram grammar is READ from the checker, not re-typed here. Both consts
// carry a comment saying this file should interpolate them; it did not, and the hand-written prose
// taught three of the five shapes `checkMermaid` accepts.
import { SHAPES, EDGE_FORMS } from './check-mermaid.js';
// v26 (DES-187, ARCH-121, TASK-193): the sandbox's own exported globals list and determinism-guard
// data — rendered here rather than re-typed, so this section cannot drift from what evaluateScript
// actually builds (guards.ts exports these; no new import enters the sandbox child).
import { SANDBOX_GLOBALS, DETERMINISM_GUARDED } from './sandbox/guards.js';
// v26 (DES-187, ARCH-121, TASK-193): the three seed shapes and workspace_push's own description,
// read from the SAME schema `tools/list` serves — a cold client's only documentation (ADR-032).
import { TOOL_SPECS } from './tool-specs.js';
// issue #146: the SAME enforced byte bound workspace_list's own description states (tool-specs.ts)
// — interpolated here too, not transcribed, so the two can never say a different number.
import { GLOBAL_SKILL_BODY_MAX_BYTES } from './asset-sync.js';
// v26 (DES-187, ARCH-121, TASK-193, ADR-041) — 2026-09-26 (alias mechanism removed): the provider
// capability table, read from the same data `parseModelRef`/`checkModelRef` check against.
import { PROVIDER_CAPS, PROVIDERS } from './providers.js';
import type { Provider } from './providers.js';
import { PI_UNSUPPORTED_TOOLS } from './harness-info.js';

export interface GuideCeilings {
  maxTimeoutMs: number;
  maxAppendPromptBytes: number;
  maxEffort: Effort;
  /** v25 (DES-168, REQ-120, issue #61): this deployment's per-RUN in-flight `agent()` cap — how wide
   *  a `parallel()` actually runs at once (`runConcurrency`, default DEFAULT_RUN_CONCURRENCY). It
   *  belongs here for the same reason the other ceilings do: an author sizing a fan-out has no other
   *  way to learn it, and issue #61 was reported by an author who could not. Resolved, never a
   *  literal — a deployment that raises it renders its own number. */
  runConcurrency: number;
  /** v37 (DES-258 owner ruling 2026-09-22, ARCH-181, ADR-083 posture C): this deployment's MEASURED
   *  Bash-confinement posture (`probeConfinement()`, boot-time, never hardcoded, never a config
   *  key) — `'confined'` on a host with a working nested sandbox, `'unconfined'` when the boot
   *  probe found none (this host's own measurement, per ADR-083's owner_decision). `undefined` when
   *  no measurement is in scope at render time — `scripts/gen-authoring-md.ts` builds
   *  `docs/AUTHORING.md` before any host boots, so it cannot know which deployment will serve the
   *  page; the guide then describes BOTH postures rather than asserting one. Forwarded from
   *  `ServerConfig.confinementPosture` (already set by `main.ts`'s boot probe for the
   *  remote-submission door, ARCH-181/DES-262) — a second reader of the SAME value, not a new
   *  `ServerConfig` field (ARCH-177's rule against opening one for a value nobody reads stands,
   *  uncorrected: this value already has a reader). */
  confinementPosture?: 'confined' | 'unconfined';
  /** issue #150: this deployment's `ServerConfig.harnessProviders` — present (`['openrouter',
   *  'ollama']`) only under `gateway:"pi"`, same as every other harness-gated signal in this engine
   *  (`models_list`'s anthropic-row filter, `ModelCatalogSnapshot.harnessProviders`). `undefined` at
   *  render time means either the sdk gateway (openrouter's `reasoning.effort` never reaches the
   *  wire — VAL-186, unchanged) OR `scripts/gen-authoring-md.ts` building `docs/AUTHORING.md` before
   *  any host boots (same "cannot know which deployment will serve this page" limit
   *  `confinementPosture` above already has) — the live `workflow_authoring_guide` MCP response
   *  (mcp-facade.ts) is the one render that actually has this value. */
  harnessProviders?: readonly Provider[];
  /** Issue #147: this deployment's ACTUAL harness — `'sdk'` (default) or `'pi'`. Forwarded from
   *  `server.ts`'s `activeHarness` (the direct gateway-transport signal issue #138 introduced for
   *  the probe/observed-stats wiring — a second reader of the SAME value, not a new fact), via
   *  `McpFacadeDeps.activeHarness`. `undefined` when no measurement is in scope at render time
   *  (`scripts/gen-authoring-md.ts` builds `docs/AUTHORING.md` once, before any host boots, so it
   *  cannot know which gateway a given deployment will configure) — the Skills section then
   *  describes BOTH harnesses, clearly labelled, same "can't know yet, so show both" convention as
   *  `confinementPosture`/`hostPathGrantsBody` above. The sdk/Skill-tool activation rule and the pi
   *  `SKILL_REQUIRES_READ_TOOL` rule are NOT interchangeable (issue #147): sdk's `allowedTools: []`
   *  plus a declared skill works; the identical shape on pi is refused before dispatch. Rendering
   *  only one, unconditionally, previously taught whichever rule is wrong for the other harness. */
  activeHarness?: 'sdk' | 'pi';
}

export interface GuideExample {
  title: string;
  script: string;
  mermaid: string;
  expectRegister: 'ok';
}

// 2026-09-26 (alias mechanism removed, owner decision 1): every model is now a full
// `<provider>/<model-id>` ref — no alias table, so every example declares the SAME static
// anthropic ref (a static-table id — `checkModelRef` accepts it with no catalog lookup and no
// warning, so this constant never depends on what any deployment's live catalog holds). Chosen
// over an ollama/openrouter ref specifically because a GENERATED docs page
// (`scripts/gen-authoring-md.ts`) and a `workflow_authoring_guide` response must both render the
// SAME text regardless of which providers a given deployment has actually reachable.
export const EXAMPLE_MODEL = 'anthropic/claude-haiku-4-5-20251001';

// One agent contract block, reused verbatim by every example below (DES-144: model/effort/
// timeoutMs are all REQUIRED with a `.default`).
function agentSpec(effort: 'low' | 'medium' | 'high', timeoutMs: number): string {
  return `{ model: { type: 'string', default: '${EXAMPLE_MODEL}' }, effort: { type: 'enum', enum: ['low','medium','high'], default: '${effort}' }, timeoutMs: { type: 'number', default: ${timeoutMs} } }`;
}

/** v26 (DES-185, ARCH-119, TASK-190): a v2-conformant stadium (agent) node —
 *  `id(["label<br/>model · effort · timeoutMs<br/>tools: …"])`. The middle segment must literally
 *  equal the agent's resolved `model.default`/`effort.default`/`timeoutMs.default` (checkMermaid's
 *  existing v1 value-triple check, step 7) — `EXAMPLE_MODEL` itself, since 2026-09-26 every example
 *  declares the same full ref. `tools` is the sorted, comma-space `allowedTools` array, `'none'`
 *  for `[]`, or `'default'` when the call carries no `allowedTools` key — ARCH-119 rule (12) skips
 *  comparing the 'default' case entirely, so the exact text there is never checked, but writing it
 *  out keeps every example visually consistent. */
function stadiumNode(id: string, label: string, effort: string, timeoutMs: number, tools: 'default' | 'none' | string[]): string {
  const toolsText = tools === 'default' ? 'tools: default' : tools === 'none' ? 'tools: none' : `tools: ${[...tools].sort().join(', ')}`;
  return `${id}(["${label}<br/>${EXAMPLE_MODEL} · ${effort} · ${timeoutMs}<br/>${toolsText}"])`;
}

// v26 (DES-185, ARCH-119/107, ADR-039, TASK-190): the thirteen named patterns, each a real script +
// a real author-supplied LR SWIMLANE Mermaid diagram, registered over a booted engine by
// tests/integration/guide-examples-register.test.ts — the guide examples ARE the v2 conformance
// corpus (a guide that teaches an invalid example is worse than none, v23's own defect). Every
// v2 construct (phase lane, `parallel` slot, `alt` slot via ternary AND if/else, `tools: none`,
// `tools: default`, a dynamic title, a nested `workflow()` rectangle) and all five of ADR-039's
// contract edges (agent-before-phase, nested `workflow()`, `parallel()` of `workflow()`, tools
// absent, dynamic title) appear here in their LEGAL, registering form — no negative fixture.
export const GUIDE_EXAMPLES: GuideExample[] = [
  {
    title: 'single agent',
    script:
      `export const meta = {\n` +
      `  description: 'Summarize the given topic in one paragraph',\n` +
      `  phases: [{ title: 'summarize' }],\n` +
      `  params: { agents: { writer: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `phase('summarize');\n` +
      `return await agent('writer', { prompt: 'Summarize the topic' });`,
    mermaid:
      `graph LR\n` +
      `subgraph "summarize"\n${stadiumNode('writer', 'writer', 'low', 60000, 'default')}\nend`,
    expectRegister: 'ok',
  },
  {
    title: 'three-stage pipeline',
    script:
      `export const meta = {\n` +
      `  description: 'Draft, then edit, then finalize a piece of text',\n` +
      `  phases: [{ title: 'draft' }, { title: 'edit' }, { title: 'final' }],\n` +
      `  params: { agents: { draft: ${agentSpec('low', 60000)}, edit: ${agentSpec('low', 60000)}, final: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `phase('draft');\n` +
      `const drafted = await agent('draft', { prompt: 'Write a first draft' });\n` +
      `phase('edit');\n` +
      `const edited = await agent('edit', { prompt: 'Improve the draft: ' + drafted });\n` +
      `phase('final');\n` +
      `return await agent('final', { prompt: 'Polish: ' + edited });`,
    mermaid:
      `graph LR\n` +
      `subgraph "draft"\n${stadiumNode('draft', 'draft', 'low', 60000, 'default')}\nend\n` +
      `subgraph "edit"\n${stadiumNode('edit', 'edit', 'low', 60000, 'default')}\nend\n` +
      `subgraph "final"\n${stadiumNode('final', 'final', 'low', 60000, 'default')}\nend\n` +
      `draft-->edit\nedit-->final`,
    expectRegister: 'ok',
  },
  {
    title: 'fan-out/fan-in',
    script:
      `export const meta = {\n` +
      `  description: 'Fan out research to three topics in parallel, then combine the results',\n` +
      `  phases: [{ title: 'research' }, { title: 'combine' }],\n` +
      `  params: { agents: { alpha: ${agentSpec('low', 60000)}, beta: ${agentSpec('low', 60000)}, gamma: ${agentSpec('low', 60000)}, combiner: ${agentSpec('medium', 90000)} } },\n` +
      `};\n` +
      `phase('research');\n` +
      `const results = await parallel([\n` +
      `  () => agent('alpha', { prompt: 'Research topic A' }),\n` +
      `  () => agent('beta', { prompt: 'Research topic B' }),\n` +
      `  () => agent('gamma', { prompt: 'Research topic C' }),\n` +
      `]);\n` +
      `phase('combine');\n` +
      `return await agent('combiner', { prompt: 'Combine: ' + results.join(', ') });`,
    mermaid:
      `graph LR\n` +
      `subgraph "research"\n` +
      `${stadiumNode('alpha', 'alpha', 'low', 60000, 'default')}\n${stadiumNode('beta', 'beta', 'low', 60000, 'default')}\n${stadiumNode('gamma', 'gamma', 'low', 60000, 'default')}\n` +
      `end\n` +
      `subgraph "combine"\n${stadiumNode('combiner', 'combiner', 'medium', 90000, 'default')}\nend\n` +
      `alpha-->combiner\nbeta-->combiner\ngamma-->combiner`,
    expectRegister: 'ok',
  },
  {
    title: 'ternary routing',
    script:
      `export const meta = {\n` +
      `  description: 'Classify urgency, then route to a fast or thorough agent',\n` +
      `  phases: [{ title: 'classify' }, { title: 'route' }],\n` +
      `  params: { agents: { classifier: ${agentSpec('low', 60000)}, fast: ${agentSpec('low', 60000)}, thorough: ${agentSpec('high', 120000)} } },\n` +
      `};\n` +
      `phase('classify');\n` +
      `const urgency = await agent('classifier', { prompt: 'Classify urgency: fast or thorough?' });\n` +
      `phase('route');\n` +
      `return await (urgency === 'fast' ? agent('fast', { prompt: 'Answer quickly' }) : agent('thorough', { prompt: 'Answer thoroughly' }));`,
    // REQ-128's own rule: a ternary/if branch draws as a diamond with LABELLED edges to each arm
    // (`三元/if→菱形加標籤邊`) — the diamond is the non-agent intermediate node EDGE_MISMATCH allows
    // on a path between consecutive slots.
    mermaid:
      `graph LR\n` +
      `subgraph "classify"\n${stadiumNode('classifier', 'classifier', 'low', 60000, 'default')}\nend\n` +
      `subgraph "route"\nrouteChoice{"fast or thorough?"}\n${stadiumNode('fast', 'fast', 'low', 60000, 'default')}\n${stadiumNode('thorough', 'thorough', 'high', 120000, 'default')}\nend\n` +
      `classifier-->routeChoice\nrouteChoice-->|fast|fast\nrouteChoice-->|thorough|thorough`,
    expectRegister: 'ok',
  },
  {
    title: 'conditional',
    script:
      `export const meta = {\n` +
      `  description: 'Classify the input, then branch to one of two agents',\n` +
      `  phases: [{ title: 'classify' }, { title: 'handle' }],\n` +
      `  params: { agents: { classifier: ${agentSpec('low', 60000)}, simple: ${agentSpec('low', 60000)}, complex: ${agentSpec('high', 120000)} } },\n` +
      `};\n` +
      `phase('classify');\n` +
      `const kind = await agent('classifier', { prompt: 'Classify the request' });\n` +
      `phase('handle');\n` +
      `if (kind === 'simple') {\n` +
      `  return await agent('simple', { prompt: 'Handle the simple case' });\n` +
      `} else {\n` +
      `  return await agent('complex', { prompt: 'Handle the complex case' });\n` +
      `}`,
    mermaid:
      `graph LR\n` +
      `subgraph "classify"\n${stadiumNode('classifier', 'classifier', 'low', 60000, 'default')}\nend\n` +
      `subgraph "handle"\nhandleChoice{"simple or complex?"}\n${stadiumNode('simple', 'simple', 'low', 60000, 'default')}\n${stadiumNode('complex', 'complex', 'high', 120000, 'default')}\nend\n` +
      `classifier-->handleChoice\nhandleChoice-->|simple|simple\nhandleChoice-->|complex|complex`,
    expectRegister: 'ok',
  },
  {
    title: 'non-agent aggregation',
    script:
      `export const meta = {\n` +
      `  description: 'Score three candidates with an agent, then pick the best score without another agent call',\n` +
      `  phases: [{ title: 'score' }],\n` +
      `  params: { agents: { scorerX: ${agentSpec('low', 60000)}, scorerY: ${agentSpec('low', 60000)}, scorerZ: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `phase('score');\n` +
      `const scores = await parallel([\n` +
      `  () => agent('scorerX', { prompt: 'Score candidate X' }),\n` +
      `  () => agent('scorerY', { prompt: 'Score candidate Y' }),\n` +
      `  () => agent('scorerZ', { prompt: 'Score candidate Z' }),\n` +
      `]);\n` +
      `return scores.reduce((best, s) => (Number(s) > Number(best) ? s : best), scores[0]);`,
    // v24 adjudication #6 F-4: the aggregation is drawn as a RECTANGLE `aggregate["…"]`, the shape
    // this same guide's SHAPES table reserves for the nested-workflow black box. `checkMermaid`
    // accepts either (both free text), so only a reader notices — and the only reader this guide
    // has is a cold model with no other documentation. `{{"…"}}` is the shape the table declares
    // for exactly this node, and it is what the example teaches now.
    mermaid:
      `graph LR\n` +
      `subgraph "score"\n` +
      `${stadiumNode('scorerX', 'scorerX', 'low', 60000, 'default')}\n${stadiumNode('scorerY', 'scorerY', 'low', 60000, 'default')}\n${stadiumNode('scorerZ', 'scorerZ', 'low', 60000, 'default')}\n` +
      `aggregate{{"pick the best score (no agent call)"}}\n` +
      `end\n` +
      `scorerX-->aggregate\nscorerY-->aggregate\nscorerZ-->aggregate`,
    expectRegister: 'ok',
  },
  {
    title: 'draft, critique, revise',
    script:
      `export const meta = {\n` +
      `  description: 'Write a draft, get one round of critique, then revise — an unrolled fixed-length sequence (an agent call inside a loop body cannot be statically checked)',\n` +
      `  phases: [{ title: 'draft' }, { title: 'critique' }, { title: 'revise' }],\n` +
      `  params: { agents: { writer: ${agentSpec('low', 60000)}, critic: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `phase('draft');\n` +
      `const drafted = await agent('writer', { prompt: 'Write a draft' });\n` +
      `phase('critique');\n` +
      `const verdict = await agent('critic', { prompt: 'Critique: ' + drafted });\n` +
      `phase('revise');\n` +
      `return await agent('writer', { prompt: 'Revise using: ' + verdict });`,
    mermaid:
      `graph LR\n` +
      `subgraph "draft"\n${stadiumNode('writer1', 'writer', 'low', 60000, 'default')}\nend\n` +
      `subgraph "critique"\n${stadiumNode('critic', 'critic', 'low', 60000, 'default')}\nend\n` +
      `subgraph "revise"\n${stadiumNode('writer2', 'writer', 'low', 60000, 'default')}\nend\n` +
      `writer1-->critic\ncritic-->writer2`,
    expectRegister: 'ok',
  },
  {
    title: 'nested workflow() black box',
    script:
      `export const meta = {\n` +
      `  description: 'Delegates to another registered workflow, then summarizes its result',\n` +
      `  phases: [{ title: 'delegate' }, { title: 'summarize' }],\n` +
      `  params: { agents: { summarizer: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `phase('delegate');\n` +
      `const child = await workflow('other-team-etl', { since: 'yesterday' });\n` +
      `phase('summarize');\n` +
      `return await agent('summarizer', { prompt: 'Summarize: ' + JSON.stringify(child) });`,
    mermaid:
      `graph LR\n` +
      `subgraph "delegate"\netl["workflow: other-team-etl (black box)"]\nend\n` +
      `subgraph "summarize"\n${stadiumNode('summarizer', 'summarizer', 'low', 60000, 'default')}\nend`,
    expectRegister: 'ok',
  },
  {
    title: 'parallel workflow() delegation',
    script:
      `export const meta = {\n` +
      `  description: 'Delegates to two other registered workflows in parallel — a parallel() of workflow() calls yields no agent slot',\n` +
      `  phases: [{ title: 'delegate' }],\n` +
      `  params: { agents: {} },\n` +
      `};\n` +
      `phase('delegate');\n` +
      `const [a, b] = await parallel([\n` +
      `  () => workflow('sub-a', {}),\n` +
      `  () => workflow('sub-b', {}),\n` +
      `]);\n` +
      `return { a, b };`,
    mermaid:
      `graph LR\n` +
      `subgraph "delegate"\nsubA["workflow: sub-a (black box)"]\nsubB["workflow: sub-b (black box)"]\nend`,
    expectRegister: 'ok',
  },
  {
    title: 'declared args',
    script:
      `export const meta = {\n` +
      `  description: 'Uses a declared arg to steer the single agent call',\n` +
      `  phases: [{ title: 'write' }],\n` +
      `  params: { args: { topic: { type: 'string' } }, agents: { writer: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `phase('write');\n` +
      `return await agent('writer', { prompt: 'Write about: ' + args.topic });`,
    mermaid:
      `graph LR\n` +
      `subgraph "write"\n${stadiumNode('writer', 'writer', 'low', 60000, 'default')}\nend`,
    expectRegister: 'ok',
  },
  {
    title: 'dynamic phase title',
    script:
      `export const meta = {\n` +
      // v39: this phase() call's title is computed at runtime — a static scan cannot know it in
      // advance, so meta.phases[0].title may be ANY non-empty string at that position (only the
      // POSITION is checked, mirroring the diagram's own LANE_MISMATCH rule for a dynamic lane).
      // 'processing' is chosen to match the mermaid subgraph title below.
      `  description: 'The phase title is computed from a declared arg — a static scan cannot know it in advance',\n` +
      `  phases: [{ title: 'processing' }],\n` +
      `  params: { args: { tier: { type: 'string' } }, agents: { worker: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `phase('tier:' + args.tier);\n` +
      `return await agent('worker', { prompt: 'Handle the request' });`,
    mermaid:
      `graph LR\n` +
      `subgraph "processing"\n${stadiumNode('worker', 'worker', 'low', 60000, 'default')}\nend`,
    expectRegister: 'ok',
  },
  {
    title: 'skills and mcp',
    script:
      `export const meta = {\n` +
      `  description: 'An agent declared with a skill and an mcp server and NO file tools — the declared skill is still reachable, through the Skill tool',\n` +
      `  phases: [{ title: 'code' }],\n` +
      `  params: { agents: { coder: { model: { type: 'string', default: '${EXAMPLE_MODEL}' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 120000 }, skills: ['repo-search'], mcp: ['project-tracker'] } } },\n` +
      `};\n` +
      `phase('code');\n` +
      `return await agent('coder', { prompt: 'Use the repo-search skill to say where the retry policy is defined', allowedTools: [] });`,
    mermaid:
      `graph LR\n` +
      `subgraph "code"\n${stadiumNode('coder', 'coder', 'medium', 120000, 'none')}\nend`,
    expectRegister: 'ok',
  },
  {
    title: 'no tools — pure reasoning',
    script:
      `export const meta = {\n` +
      `  description: 'A judge agent restricted to no tools at all — pure text reasoning',\n` +
      `  phases: [{ title: 'judge' }],\n` +
      `  params: { agents: { judge: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `phase('judge');\n` +
      `return await agent('judge', { prompt: 'Answer PASS or FAIL', allowedTools: [] });`,
    mermaid:
      `graph LR\n` +
      `subgraph "judge"\n${stadiumNode('judge', 'judge', 'low', 60000, 'none')}\nend`,
    expectRegister: 'ok',
  },
];

function section(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
}

// issue #89 item 1: the "Locked vs. tunable" section used to hand-type "six" while LOCKED_KEYS
// (params/contract.ts) grew a seventh member (`bash`, issue #78(c)) — the count word must track the
// constant's own length so a future LOCKED_KEYS edit cannot silently leave the prose stale again.
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

// v37 (DES-258 owner ruling 2026-09-22, ARCH-181, ADR-083 posture C): the "Host path grants"
// section used to state fact (a) — "Bash may write inside the run workspace and nowhere else" —
// unconditionally, which is FALSE on a deployment whose boot probe measures 'unconfined' (this
// host's own measurement). The owner's ruling was to render the POSTURE live, leaving the grant
// list itself static (no GuideCeilings.grantedHostPaths, no new ServerConfig hop — that half of
// DES-258's original question stays unresolved, deliberately). These two bodies are the two
// truths that can each be actually true on some deployment; `hostPathGrantsBody` below picks one,
// or (when the posture is not known at render time) states both.
const HOST_PATH_GRANTS_CONFINED =
  '`Bash` may write inside the run workspace and nowhere else. A write outside it arrives as ' +
  // issue #159 (DOC): the confinement mechanism denies by mounting the denied region READ-ONLY
  // (bwrap/srt — see gateway/bash-confinement.ts's own "Read-only file system" comments), which
  // surfaces at the syscall level as EROFS, not an EACCES permission-bit denial. Corrected from
  // the previous (wrong) "an ordinary EACCES" claim.
  "an ordinary `EROFS` (read-only filesystem) inside the agent's own tool result, not as an " +
  'engine refusal — a script that shells out to a global cache sees a failed command, not a ' +
  'special error your script can branch on.\n\n' +
  'A shared host path is possible but is an **operator grant** in `rwe.config.json`, never ' +
  "something a script requests — the list applied to a given run appears in that run's own " +
  '`agent.confinement` log line.';

const HOST_PATH_GRANTS_UNCONFINED =
  'On this deployment, `Bash` is **not confined**: the boot-time probe found no working sandbox ' +
  'on this host, so `Bash` runs with the same filesystem access as the engine process itself — ' +
  'not limited to the run workspace, and not limited to any operator-granted host path either. ' +
  'A **locally-submitted** run of a **locally-registered** script still executes exactly this ' +
  "way; that is the accepted cost of this deployment's posture, not a bug. Every run this " +
  'workflow can trigger is refused identically when EITHER its trigger OR its resolved script ' +
  "version's registering submission was remote — `run_start`/`run_resume` (a remote MCP caller, " +
  'or a LOCAL caller naming a workflow version that was itself registered remotely), a webhook ' +
  'delivery (`POST /hooks/:id` → HTTP 403), and a schedule firing (surfaced in ' +
  // issue #89 item 3: RE-VERIFIED against server.ts's ticker driver (not just the issue's initial
  // framing) — a schedule firing's CONFINEMENT_UNAVAILABLE is thrown by RunManager.start() and
  // falls into the ticker's GENERIC `.catch()`, which calls `scheduler.markFailed(firing, code)`
  // (server.ts's own comment: "a thrown CONFINEMENT_UNAVAILABLE falls into the SAME generic
  // .catch() below markFailed already handles"). `markFailed` sets `lastError` — never the
  // refusalCount/lastRefusedAt/lastRefusalReason trio, which `markRefused` writes only for
  // resolveScheduleTarget's OWN pre-dispatch reasons (UNCLAIMED/CHANNEL_UNPUBLISHED/
  // CLAIMED_WORKFLOW_MISSING/NOT_IN_RELEASE — never CONFINEMENT_UNAVAILABLE). So `lastError` is the
  // ACCURATE claim here, unlike a webhook delivery's CONFINEMENT_UNAVAILABLE (webhook-registry.ts
  // DOES special-case it into that same trio) — the two admission routes genuinely differ; this is
  // not a copy-paste of one onto the other.
  '`schedule_list`\'s `lastError`) all return `CONFINEMENT_UNAVAILABLE` — **regardless of what ' +
  'tools any agent in the workflow declares.** A workflow whose every agent declares ' +
  "`allowedTools: []` (no `Bash`, no file tools, nothing) is refused identically to one that " +
  'declares `Bash`: this rule gates every admission route by submission/trigger/version ' +
  'provenance, never by the requested tool surface — there is no tool-free door around it.';

/** Issue #78(c): the read-only shell mode. Enforcement is the kernel sandbox or a refusal — the
 *  closing sentence states which one this deployment gives, from the same measured posture the Host
 *  path grants section renders. */
function readonlyBashBody(posture: 'confined' | 'unconfined' | undefined): string {
  const here =
    posture === 'confined'
      ? "This deployment's boot probe measured a working sandbox, so the mode is enforced here."
      : posture === 'unconfined'
        ? "This deployment's boot probe found no working sandbox, so here every `bash: 'readonly'` call fails closed, and `workflow_register` warns about it in advance."
        : "Whether it is enforced or refused depends on the serving deployment's measured posture — the live `workflow_authoring_guide` response says which.";
  return (
    'When an agent needs a shell to run commands and report their output, but must not change ' +
    "anything, add `bash: 'readonly'` beside its `allowedTools`:\n\n" +
    '```js\n' +
    "const facts = await agent('clerk', { prompt: 'Run `ls -la src` and `wc -l src/*.ts`; paste the raw output.', allowedTools: ['Bash', 'Read', 'Grep', 'Glob'], bash: 'readonly' });\n" +
    '```\n\n' +
    "The kernel sandbox enforces it, not the prompt and not the tool list: that agent's `Bash` gets " +
    "no writable path — not the run workspace and not any host path grant. Only the CLI's own " +
    'private scratch directory stays writable, because the shell cannot run without it. ' +
    'That combination does not trip `BASH_SUBSUMES_FILE_TOOLS`. ' +
    'On a host with no working Bash sandbox, the engine never downgrades a readonly agent to a writable shell. ' +
    'The call fails closed: the agent returns `null`, and its record carries ' +
    '`BASH_READONLY_UNENFORCEABLE`, with no session started. ' +
    "`workflow_register` refuses `bash: 'readonly'` beside `Write`, `Edit` or `NotebookEdit`, with " +
    'no literal `allowedTools` (the deployment default includes write tools), or with no `Bash` in ' +
    'the list — `SCAN_VIOLATION` `BASH_READONLY_CONFLICT`. It refuses any other `bash` value ' +
    '(`BASH_MODE_INVALID`) and a `bash` key in `meta.params`. `run_start` overrides cannot change it. ' +
    "When a session starts, the agent's `harness.bash` record in `run_agent_log` shows `{mode, enforced}`; " +
    'a fail-closed call starts no session, so it has no harness record — read its detail instead. ' +
    here
  );
}

function hostPathGrantsBody(posture: 'confined' | 'unconfined' | undefined): string {
  if (posture === 'confined') return HOST_PATH_GRANTS_CONFINED;
  if (posture === 'unconfined') return HOST_PATH_GRANTS_UNCONFINED;
  return (
    "Whether `Bash` is confined to the run workspace depends on THIS deployment's measured " +
    'posture, checked once at boot. This generated page is built before any host boots, so it ' +
    'cannot state which one applies to the deployment serving it — it describes both:\n\n' +
    `**Confined:** ${HOST_PATH_GRANTS_CONFINED}\n\n` +
    `**Unconfined:** ${HOST_PATH_GRANTS_UNCONFINED}\n\n` +
    'The live `workflow_authoring_guide` tool response states which posture is actually in force ' +
    'on the deployment serving it — check there, not here, before relying on either description.'
  );
}

// issue #103(a): MCP_NOT_PROVISIONED/SKILL_NOT_PROVISIONED are the two `see:
// 'workflow_authoring_guide'` codes that are NOT a registration refusal — registration only WARNS
// about them (result.warnings), the refusal is admission-time (run_start / a firing / a nested
// workflow()). The section heading below ("refused with this code") is accurate for every OTHER
// row, so these two are carved out into their own, correctly-labeled note instead of silently
// contradicting the heading they'd otherwise sit under.
const ADMISSION_ONLY_CODES = new Set(['MCP_NOT_PROVISIONED', 'SKILL_NOT_PROVISIONED']);

/** The `see: 'workflow_authoring_guide'` slice of ERROR_CATALOG, rendered from the SAME table
 *  server.ts's error envelope reads (`toErrEnvelope`) — never a second hand-typed list. */
function authoringErrorRows(): string {
  return Object.entries(ERROR_CATALOG)
    .filter(([code, v]) => v.see === 'workflow_authoring_guide' && !ADMISSION_ONLY_CODES.has(code))
    .map(([code, v]) => `- \`${code}\` — ${v.hint}`)
    .join('\n');
}

/** issue #103(a): the admission-only carve-out this section's own heading can't cover — see
 *  ADMISSION_ONLY_CODES's comment. */
function admissionOnlyErrorRows(): string {
  return Object.entries(ERROR_CATALOG)
    .filter(([code]) => ADMISSION_ONLY_CODES.has(code))
    .map(([code, v]) => `- \`${code}\` — ${v.hint}`)
    .join('\n');
}

function exampleRows(examples: readonly GuideExample[]): string {
  return examples.map(
    (ex) =>
      `### ${ex.title}\n\n\`\`\`js\n${ex.script}\n\`\`\`\n\nMermaid:\n\n\`\`\`\n${ex.mermaid}\n\`\`\``,
  ).join('\n\n');
}

/** Issue #147: how a declared skill actually reaches the model is harness-specific, and the two
 *  rules are NOT interchangeable — a cold author reading only the sdk rule (the pre-#147 Skills
 *  section) would write `allowedTools: []` on a pi deployment and get `SKILL_REQUIRES_READ_TOOL`,
 *  a refusal the guide's own (correct, but many sections later) harness-disclosure paragraph
 *  explained — too late for a reader who already wrote the sdk shape. Rendered here, in the Skills
 *  section itself, with the ACTIVE harness (when known, i.e. the live `workflow_authoring_guide`
 *  tool response) leading; both shown, clearly labelled, when the harness isn't known yet (the
 *  generated static `docs/AUTHORING.md`, built once before any host boots). */
function skillsActivationParagraph(harness?: 'sdk' | 'pi'): string {
  const sdkBlock =
    'the model activates a declared skill through the Skill tool, which the engine adds to that ' +
    "agent's tool surface for you — do not list `Skill` in `allowedTools`. Declaring a skill grants " +
    'no file tools, and none are needed to reach it: an agent with `allowedTools: []` and a declared ' +
    'skill can still activate it.';
  const piBlock =
    'there is no separate `Skill` tool: pi only lists a declared skill in the model\'s system prompt ' +
    "when `allowedTools` includes `'Read'` or `'Bash'` — an agent with neither is refused " +
    "`SKILL_REQUIRES_READ_TOOL` before dispatch. `allowedTools: []` does NOT work here, unlike sdk.";
  if (harness === 'pi') {
    return (
      `**Active harness: pi.** Under \`gateway:"pi"\`, ${piBlock} (If this deployment instead ran ` +
      `\`gateway:"sdk"\`: ${sdkBlock})`
    );
  }
  if (harness === 'sdk') {
    return (
      `**Active harness: sdk.** Under \`gateway:"sdk"\` (the default), ${sdkBlock} (If this ` +
      `deployment instead ran \`gateway:"pi"\`: ${piBlock})`
    );
  }
  return (
    `Under \`gateway:"sdk"\` (the default), ${sdkBlock} Under \`gateway:"pi"\`, ${piBlock} This ` +
    "guide is generated once and is not per-deployment — the LIVE `workflow_authoring_guide` tool " +
    "response states which one THIS engine actually runs (`system_info`'s `harness.name` does too)."
  );
}

/** pi harness v1 (spec "Disclosure"): static text describing the ALTERNATIVE `gateway:"pi"`
 *  configuration — this guide is generated once (`npm run gen:authoring`), not per-deployment, so it
 *  cannot read a live `ServerConfig.harnessProviders` the way `system_info`'s `harness` field does;
 *  it instead documents the gap honestly as a configuration fact, and points at `system_info` for
 *  which one THIS deployment actually runs. Kept in sync with `harness-info.ts`'s own data (the
 *  provider list and unsupported-tools list are literals there; read the same list here). */
function harnessDisclosureParagraph(): string {
  return (
    'This deployment may instead be configured with `gateway:"pi"` in rwe.config.json (default and ' +
    'production stay `"sdk"`) — a different harness with the SAME agent()/tool contract but a ' +
    "narrower surface: only `openrouter`/`ollama` models are usable (an `anthropic/*` ref is refused " +
    "`PROVIDER_UNSUPPORTED_BY_HARNESS` at registration/run_start/admission — route a Claude model " +
    'through `openrouter/anthropic/...` instead); the tool surface is limited to Read/Write/Edit/' +
    `Bash/Grep/Glob/LS (${PI_UNSUPPORTED_TOOLS.join('/')} are refused \`TOOL_UNSUPPORTED_BY_HARNESS\`). ` +
    "Pre-existing Glob quirk, unrelated to pi specifically but worth restating here since pi's Glob " +
    "maps straight onto it: a `**/*.txt`-shaped pattern does not match a file sitting directly in the " +
    "searched directory (only one nested one level or deeper does) — unlike Claude's own Glob tool, " +
    'which matches the root too; write `*.txt` (or `{,**/}*.txt`) when top-level files must match. ' +
    'MCP and skills ARE supported under `gateway:"pi"` (resolved through the same shared resolver/ ' +
    'materializer as the sdk gateway — `${secret:}`/`${run:dir}` substitution never diverges between ' +
    'the two), with two pi-specific differences: a declared skill requires `Read` or `Bash` in ' +
    "`allowedTools` (pi only lists a skill in its system prompt when one of those two tools is present " +
    '— no separate `Skill` tool exists on pi — refused `SKILL_REQUIRES_READ_TOOL` up front with ' +
    'neither), and a `seedManifest`/`workspace_push` skill file\'s ' +
    '`exec:true` is only ever a file-permission bit (0o755 vs 0o644) on pi — there is no inline-shell ' +
    '(`!cmd`) skill syntax to gate the way the sdk gateway\'s `disableSkillShellExecution` does. ' +
    "Known network difference: pi's Bash network policy is allow-all, but the underlying sandbox " +
    'library routes ALL traffic through its own MITM proxy once any network field is set at all, which ' +
    'makes `localhost`/`127.0.0.1` destinations from inside the confined Bash unreachable — unlike ' +
    '`gateway:"sdk"`, whose Bash leaves the network field unset entirely and keeps full host network ' +
    'including loopback. A workflow whose Bash needs a same-host service must use `gateway:"sdk"` for ' +
    'now (see DEPLOY.md §1b2 for the full writeup). ' +
    "Known unconfined-posture limitation (review R2-2): a Bash command that backgrounds a process " +
    "via `setsid` (not `nohup`, which stays reachable) escapes this dispatch's process group and " +
    'survives even normal completion — accepted because the unconfined posture only ever runs a ' +
    'local submission to begin with; the confined posture never has this gap (bwrap\'s own pid-' +
    'namespace teardown reaps everything regardless of process group). ' +
    'Confined Bash\'s own `TMPDIR` is a per-dispatch directory this engine verifies, never srt\'s ' +
    'shared `/tmp/claude` fallback — a host `/tmp/claude` (any local user can create one) is readable ' +
    '(the same exposure as every other host `/tmp` path) but never writable from inside confined ' +
    'Bash, and its mere presence only emits an operator-visible warning event, never a refusal ' +
    '(review round 4, R4-2). Issue #131: `gateway:"sdk"` (the default) got this identical ' +
    '`/tmp/claude` protection too — no longer a pi-only difference — see DEPLOY.md §1b2/§1c for the ' +
    'full writeup. Other pi-specific refusals an ' +
    'operator may see on a failed agent (run_status.agentFailures / run_agent_log, not a direct ' +
    'tool-call error) are listed with the rest of this engine\'s error codes below, and in DEPLOY.md ' +
    '§1b2\'s own remediation table. ' +
    "`system_info`'s `harness` field states which one THIS engine runs " +
    '(`{name, version, providers, unsupportedTools, effort, usage}`) — read it rather than assuming.'
  );
}

/** 2026-09-26 (alias mechanism removed, owner decisions 1/2/6): the model-ref rule — static text,
 *  the same on every deployment (no resolved table to interpolate any more). */
function modelRefSentence(): string {
  return 'A declared `model.default` (and every entry of a declared `model.enum`) MUST be a full ' +
    '`<provider>/<model-id>` ref — providers are exactly `anthropic`, `openrouter`, `ollama` — split ' +
    'at the FIRST `/` (an openrouter id can itself carry further `/`s, e.g. ' +
    '`openrouter/openai/gpt-4.1`; an ollama id can carry `:`/`.`, e.g. `ollama/qwen2.5:7b`). There ' +
    'are no aliases, no bare names, and no `\'default\'`/`\'local\'`-style shortcut — a bare name, an ' +
    'unrecognized provider prefix, or an empty model id is refused `UNKNOWN_MODEL`, naming the ' +
    'expected form and the three providers. `models_list` shows the catalog this deployment can ' +
    "reach: each row's `ref` field IS the exact string to paste — copy it verbatim, never hand-type " +
    'a variant. An openrouter/ollama ref is checked against that provider\'s live catalog listing ' +
    'when one is available (refused `UNKNOWN_MODEL` if genuinely absent from it; accepted with a ' +
    'non-fatal `MODEL_CATALOG_UNVERIFIED` warning if the listing could not be checked); an anthropic ' +
    "id not yet in this deployment's static price table is likewise accepted with that same warning " +
    '— a new Anthropic model is never blocked. The model is bound once at `workflow_register` time ' +
    '(the `.default` above) and may be replaced with a different full ref per run via ' +
    '`run_start`\'s `overrides.agents.<label>.model` — there is no other override surface (a ' +
    'scheduled/webhook-fired run, and a nested `workflow()` call, always use the target version\'s ' +
    'own bound `.default`). ' +
    // review L7: this rule is static text, identical on every deployment (this guide's own header
    // comment) — but a `gateway:"pi"` deployment narrows the provider set to just two of these
    // three; said in full, with the exact refusal code, in the pi harness note further below. Named
    // here too so a reader who stops at THIS sentence (the first place "three providers" is stated)
    // is not left believing anthropic always works.
    'A `gateway:"pi"` deployment narrows this to only `openrouter`/`ollama` — see the pi harness note ' +
    'below for the exact refusal code and remediation.';
}

/** v24 Gate 7.5 (D-4): the node-shape table, rendered from `checkMermaid`'s own closed grammar. */
function shapeRows(): string {
  return SHAPES.map((s) => `- \`${s.open}…${s.close}\` (${s.name}) — ${s.role}`).join('\n');
}

/** v26 (DES-187, TASK-193): the three guarded determinism calls, rendered from guards.ts's own
 *  DATA export — each with the resume-replay reasoning and the safe alternative. */
function determinismGuardRows(): string {
  return DETERMINISM_GUARDED.map(
    (g) => `- \`${g.call}\` — refused \`DETERMINISM_GUARD\`. ${g.why} Instead: ${g.instead}`,
  ).join('\n');
}

/** v26 (DES-187, TASK-193, REQ-121): the three seed shapes plus workspace_push, read from the SAME
 *  `run_start`/`workspace_push` schema `tools/list` serves — never a second hand-typed list. */
function seedShapeRows(): string {
  const runStart = TOOL_SPECS.find((t) => t.name === 'run_start')!;
  const props = (runStart.inputSchema as unknown as { properties: Record<string, { description?: string }> }).properties;
  const workspacePush = TOOL_SPECS.find((t) => t.name === 'workspace_push')!;
  return [
    `- \`seed\` — ${props.seed?.description ?? ''}`,
    `- \`seedManifest\` — ${props.seedManifest?.description ?? ''}`,
    `- \`seedManifestRef\` — ${props.seedManifestRef?.description ?? ''}`,
    `- \`workspace_push\` — ${workspacePush.description}`,
  ].join('\n');
}

/** v26 (DES-187, TASK-193, ADR-041): one row per provider, read from `PROVIDER_CAPS` — the SAME
 *  table `resolveAlias`/`validateAliases` check against.
 *  issue #150: harness-aware. `harnessProviders === undefined` renders the sdk gateway's own
 *  OBSERVED fact (`effortDelivered`, VAL-186) unchanged — true for every pre-#150 caller
 *  (`scripts/gen-authoring-md.ts` has no live deployment to ask, same limit `confinementPosture`
 *  already has). Present (pi harness) renders what's actually true under pi: openrouter's
 *  `reasoning.effort` DOES reach the wire, but only per-model (a catalog capability, not a
 *  per-provider constant) — `models_list`'s `effortAppliedOnTransport` is the live, per-model answer;
 *  ollama still has no dial either way. */
function providerCapsRows(harnessProviders?: readonly Provider[]): string {
  if (harnessProviders !== undefined) {
    return PROVIDERS.filter((p) => (harnessProviders as readonly string[]).includes(p)).map((p) => {
      const caps = PROVIDER_CAPS[p];
      return p === 'openrouter'
        ? `- \`${p}\` — tool surface: ${caps.tools}, effort applies: per model — this harness (pi) DOES carry ` +
          "`reasoning.effort` to the wire, but only for a model whose catalog row declares reasoning support; " +
          'check `models_list`\'s `effortAppliedOnTransport` for the live, per-model answer (`run_agent_log.harness.effortApplied` confirms it per call).'
        : `- \`${p}\` — tool surface: ${caps.tools}, effort applies: no (no reasoning dial under any gateway)`;
    }).join('\n');
  }
  return PROVIDERS.map((p) => {
    const caps = PROVIDER_CAPS[p];
    // v26 Gate 7.5 round 1 (REQ-126, VAL-186): rendered from `effortDelivered`, the OBSERVED fact,
    // not from `effort !== null`, which only says the provider has a dial. openrouter has one and the
    // sdk gateway's dispatch path never delivers it; a manual that says otherwise sends authors
    // chasing a no-op. (Under the pi harness this is per-model, not per-provider — the live
    // `workflow_authoring_guide` response renders that case instead; see this function's own doc.)
    return `- \`${p}\` — tool surface: ${caps.tools}, effort applies: ${caps.effortDelivered ? 'yes' : 'no'}${
      caps.effort !== null && !caps.effortDelivered
        ? ' (the provider has a reasoning dial, but this deployment\'s dispatch path does not carry it — `effortApplied` says so per call)'
        : ''
    }`;
  }).join('\n');
}

/** v24 Gate 7.5 (D-4): the edge table, likewise read from the checker rather than re-typed. */
function edgeRows(): string {
  return EDGE_FORMS.map((e) => `- \`a${e.token}b\` — ${e.role}`).join('\n');
}

/** Issue #105 (Q6, owner decision): the role x asset-kind/scope/transport matrix a cold author
 *  needs up front — issue #105's own reproduction table is what showed nothing this specific
 *  existed anywhere a client could read before dispatching. `minRole`/`ownership` values match
 *  `tool-specs.ts`'s `pushMode()`/`workspace_push.authz.rows` exactly; this is prose ABOUT that
 *  table, not a second copy of the authz engine — a role/ownership check drifting from this text
 *  is a docs bug, never enforced from here. */
function roleAssetMatrixRows(): string {
  return [
    '| Capability | `user` | `author` | `admin` |',
    '|---|---|---|---|',
    "| Push a skill, `scope:'workflow'` (must own the workflow) | `FORBIDDEN_ROLE` | yes | yes |",
    "| Push a skill, `scope:'global'` | `FORBIDDEN_ROLE` | `FORBIDDEN_ROLE` | yes |",
    '| Use a skill your own run declares (workflow-scoped OR global — either resolves) | yes | yes | yes |',
    "| Push an MCP server, `type:'http'` (remote) | `FORBIDDEN_ROLE` | yes, gated on `mcpEgressAllowlist` + a live probe | yes, same gates |",
    "| Push an MCP server, `type:'stdio'` (local process) | `FORBIDDEN_ROLE` | `FORBIDDEN_ROLE` | yes |",
    '| Use an MCP server your own run declares (workflow-scoped OR global) | yes | yes | yes |',
    "| Ship a CLI as a skill file with `exec:true` | `FORBIDDEN_ROLE` | yes, for a workflow you own | yes |",
    "| Ship a CLI via a `run_start`/version-default `seedManifest` entry with `exec:true` | yes (`workspace_push({sha256,contentB64})` is `cas`-mode, no role floor beyond authenticated `user`; `run_start` itself is `user`-level too) | yes | yes |",
    '| Install a package/tool AT RUN TIME (`npm install`, `pip install`, a fetched binary, …) | not a supported path on any role — see "Shipping a CLI" below for the posture caveat | | |',
  ].join('\n');
}

/** DES-157 / ARCH-107: assembled from the enforcement constants — the ONE builder both
 *  `workflow_authoring_guide` (the MCP tool, over the composition root's RESOLVED ceilings) and
 *  `scripts/gen-authoring-md.ts` (over `DEFAULT_CEILINGS`, the documented unconfigured default)
 *  call. `ceilings` is the only input — everything else (locked/tunable keys, the authoring error
 *  codes, the ten examples) is read from its own module, never re-typed here. */
export function buildAuthoringGuide(ceilings: GuideCeilings): string {
  const parts: string[] = [];

  parts.push('# Authoring a workflow script');
  parts.push(
    'This engine has no bundled guidance skill — the tool schemas returned by `tools/list` are the ' +
      'only documentation a cold MCP client ever sees, and `workflow_authoring_guide` (this text) is ' +
      "what every authoring error's `see` field points back to.",
  );

  parts.push(
    section(
      'The sandbox API',
      'A workflow script runs inside a restricted VM context with exactly these globals — nothing else ' +
        `is reachable (\`${SANDBOX_GLOBALS.join('\`, \`')}\`; \`Date\`/\`Math\`/\`Intl\` are GUARDED, see below). ` +
        'The script body IS the function the engine calls — write statements and a `return`, with no ' +
        '`function`/`async function` DECLARATION wrapped around any of it (`const thunk = () => ' +
        "agent(...)`, used for parallel()/pipeline(), is fine — only a top-level `function` STATEMENT " +
        'is refused, `PARSE_ERROR`, issue #154). Call `agent`/`phase`/`parallel`/`pipeline`/`workflow` ' +
        "DIRECTLY — `agent('label', {...})`, not `const a = agent; a(...)` or `agent.call(...)` — " +
        'registration can only see a call it can read at the call site; an alias, a `.call`/`.bind`, or ' +
        'any other indirection is refused `SCRIPT_INVALID` (issue #154).\n\n' +
        "- `await agent(label, options)` — dispatches one agent call. `label` MUST be a literal string " +
        'identifier (`/^[A-Za-z_][\\w-]*$/`) matching a `meta.params.agents.<label>` declaration; ' +
        '`options` MUST be a literal object: no variable, no spread (`{...x}`), no shorthand ' +
        'property (`{allowedTools}`) — every key must be written `key: <literal>` so it can be ' +
        'checked statically (a spread or shorthand entry is refused `AGENT_OPTS_SPREAD` / ' +
        '`AGENT_OPTS_SHORTHAND` at registration, issue #154).\n' +
        '- `await parallel([thunk, ...])` — runs an array of zero-argument thunks concurrently, each ' +
        'returning `null` on its own thrown error rather than rejecting the whole call.\n' +
        '- `await pipeline([item, ...], stage1, stage2, ...)` — runs each item through the stage chain.\n' +
        "- `phase(title)` — names the current step for observability. Titles are public (see below). " +
        "`meta.phases: [{title}, ...]` is REQUIRED and must equal these calls in count/order (see " +
        "'Declaring the parameter contract' below).\n" +
        '- `log(...)` — a no-op placeholder in this sandbox (accepted, does nothing).\n' +
        '- `args` — the caller-supplied run arguments, shaped by `meta.params.args`.\n' +
        '- `budget` — read-only: `{limits: {usd, tokens}, total, spent(), remaining(), tokens()}` (see ' +
        '"Budget, concurrency" below for which accessor answers which limit).\n' +
        '- `await workflow(name, args)` — runs another registered workflow. A workflow() call may ' +
        "itself call workflow() again, recursing up to this deployment's configured `maxWorkflowDepth` " +
        '(cycle-checked, descendant-capped) — a call that exceeds the depth is refused ' +
        '`NESTING_DEPTH_EXCEEDED`, one that would re-enter an ancestor on ' +
        'its own chain is refused `NESTING_CYCLE`, and one that pushes the run past its descendant cap is ' +
        'refused `DESCENDANT_CAP_EXCEEDED`. (An earlier one-level cap with a flatten-it instruction is ' +
        "what an older draft of this guide taught — that no longer matches what's shipped.) Even with " +
        "depth available, the simplest and most readable script still flattens a needless wrapper into " +
        "its caller, and draws another owner's workflow as a black-box rectangle node in your diagram " +
        "rather than expanding it. A nested workflow()'s own phase() calls are recorded on THAT " +
        "sub-workflow's card, not folded into the parent run as one of its lanes. Its agent() calls run on " +
        "THAT workflow's own `meta.params.agents` defaults — your run's `overrides.agents` never reach " +
        'them (labels belong to the workflow that declares them, even when a name collides) — and its ' +
        "models are priced into, and bound by, your run's budget.\n\n" +
        '`Date`, `Math`, and `Intl` are present but GUARDED — the calls below are refused ' +
        '`DETERMINISM_GUARD` because resume replays agent() calls keyed by prompt+opts, so a ' +
        'wall-clock or random value baked into that key would change it on replay and re-dispatch an ' +
        'already-paid call:\n\n' +
        determinismGuardRows() +
        // #157 B1: this paragraph used to claim the vm context ITSELF was the security boundary
        // ("process... simply absent from the context, not merely shadowed... holds no secrets/
        // store/network handle") — that was FALSE as implemented: `<injected>.constructor.
        // constructor(...)` reached the sandbox child process's own `process`/`fetch`, which (before
        // #157's fix) carried the engine's full inherited env. Both halves are now actually true —
        // the escape itself is closed (every value exposed into the context is realm-safe) AND the
        // child process now holds no inherited secrets regardless — but the paragraph is rewritten
        // to describe the REAL, now-closed containment rather than repeat a claim that happened to
        // be right for the wrong reason.
        '\n\n`setTimeout`, `fetch`, `require`, `process`, and `fs` are genuinely absent from this ' +
        'context (not merely shadowed) — standard `node:vm` behavior, unrelated to the guards above. ' +
        // issue #157 B3: `console` is a default global of ANY vm context (like `Intl` was before it
        // was guarded above) that this engine never removes — it is present, not absent, so it does
        // not belong in the "genuinely absent" list this sentence used to include it in. Documented
        // here rather than removed (an owner-decision call, not a security fix either way: removing
        // it would be a design choice, not a defect) — it is harmless to leave present: it writes to
        // an inert per-realm stream a real forked child's own stdout never surfaces (confirmed: a
        // script's `console.log(...)` produces no observable output anywhere this engine reads).
        '`console` IS present (unlike the five above) but writes nowhere observable — a `node:vm` ' +
        'context gets its own inert console whose output never reaches this engine\'s logs or your ' +
        'run\'s result; it is harmless, just not useful; `log(...)` (listed above) is this engine\'s ' +
        'own no-op placeholder, included for forward compatibility, not a working substitute today.' +
        // #157 B1 (Gate 8 v2 re-review): the prior wording here claimed layer 1 alone meant "there is
        // no live reference back to engine internals to find" — false as a general claim even after
        // that round's fix: a RETURNED Promise, a static method's own un-severed prototype, and a
        // guard thrower's own `.prototype` object each turned out to be a separate value this engine
        // exposes that the first pass missed, each re-opening the same escape. `node:vm` itself
        // documents that it is not a security boundary (any value or function this engine builds and
        // hands in is a NEW surface to re-check, every time); this guide should not promise otherwise.
        //
        // #157 (final blocker, Gate 8 v3 re-review): the script's own top-level `this`/`globalThis`
        // turned out to be the one surface the per-property fixes above never reached (`vm.createContext`
        // never re-realms the global object it is handed). This paragraph now names all THREE
        // independent layers this engine actually runs, in the order a defeat of one falls back to the
        // next — see guards.ts's `evaluateScript` and host.ts's `SandboxHost.run` for the real code.
        '\n\nSecurity containment here is THREE independent layers, not one — defeating any single one ' +
        'still leaves your script stopped by the next:\n\n' +
        '1. **In-realm hardening** (`node:vm`, hygiene, not a boundary by itself): every value exposed ' +
        'into your script — `agent`/`parallel`/`pipeline`/`phase`/`log`/`workflow`, the `Math.random`/' +
        '`Intl.DateTimeFormat`/`Date.now` guards, the budget accessors — is built NATIVE to your ' +
        "script's own vm context (not merely given its `[[Prototype]]` severed after the fact), and so " +
        "is the context's global object itself (`globalThis`/top-level `this`), reparented to the " +
        "context's own `Object.prototype` instead of keeping the engine's. The context additionally " +
        'disables code generation from strings (`codeGeneration: { strings: false }`), so even the ' +
        "context's own (otherwise harmless) `Function`/`eval` cannot build new code from a string, and " +
        'your script body is compiled strict-mode and invoked with no receiver, so a bare top-level ' +
        '`this` is `undefined`, not the global object — closing `this.constructor...`, `eval(...)`, ' +
        '`globalThis.constructor...`, and (as a side effect of strict mode) `arguments.callee`/`.caller` ' +
        'and `Error.prepareStackTrace` reassignment (a classic `vm`-sandbox stack-walking escape, ' +
        'locked to always-`undefined` on this call\'s own `Error`) all at once. `node:vm` itself still ' +
        'documents that it does not provide a complete boundary, so this layer is treated as hygiene, ' +
        'not as the reason the next two layers are "just in case".\n\n' +
        '2. **Empty child environment**: your script runs in a real, separate OS process (layer 3 ' +
        "below), forked with NO inherited environment at all — no provider API keys, no " +
        '`RWE_SECRET_*`, nothing from the engine\'s own process.env. Even if layer 1 were ever defeated ' +
        'by an escape nobody has found yet, the process it reaches carries no secrets to begin with.\n\n' +
        "3. **OS-level containment of that same process**: it is launched under Node's own permission " +
        'model (`--permission`), with filesystem READ permitted only for the engine\'s own source ' +
        'directory (nothing else — not your workspace, not the rest of the host) and NO permission at ' +
        'all to write files, spawn a child process, start a worker thread, or load a native addon. So ' +
        'even a live `process` handle reached through a future layer-1 regression cannot read an ' +
        'arbitrary host file or run a shell command — both fail closed with `ERR_ACCESS_DENIED`.\n\n' +
        'Treat anything a script can reach as untrusted until it leaves the forked child regardless — ' +
        'these layers are independent precisely so that a gap found in one is still caught by another.\n\n' +
        "A script's own top-level `return` value (and an agent()/workflow() call's resolved value, " +
        'which crosses the same boundary) must be JSON-serializable — no circular references, no ' +
        "BigInt — and under 10MB serialized; either violation is refused "
        + '(`RESULT_NOT_SERIALIZABLE` / `RESULT_TOO_LARGE`) rather than crashing the run. Return a ' +
        'summary or a reference (an id, a CAS blob hash) instead of a large payload. ' +
        '`RESULT_NOT_SERIALIZABLE` also rejects an agent()/workflow()/phase() call whose OWN ' +
        "arguments aren't JSON-serializable (there is no size check on a call's own arguments, so " +
        "`RESULT_TOO_LARGE` never applies there) — that failure is local to the one call your script " +
        'made and is catchable with a normal try/catch, not run-terminating.\n\n' +
        'Two more limits bound the sandbox itself, independent of anything your script does right or ' +
        "wrong: the run has a wall-clock deadline (`maxRunDurationMs`, a generous multi-hour default " +
        "covering every agent()/workflow() round trip across every phase — not a single call, which " +
        "`timeoutMs` already bounds) and the sandboxed process has a memory cap. Exceeding either " +
        'terminates the run with a coded `SCRIPT_TIMEOUT` or `SCRIPT_OOM` rather than hanging ' +
        'forever or crashing opaquely — including a synchronous infinite loop (`while(true){}`), ' +
        "which blocks the script's own event loop and so cannot be caught or reported from inside " +
        'the script itself.',
    ),
  );

  parts.push(
    section(
      'Declaring the parameter contract',
      // v26 Gate 7.5 round 1 (defect D6): the ten examples all SHOW this shape and no sentence ever
      // STATED it, which is what cost the round-1 cold subject its first registration (VAL-188): it
      // wrapped the body in `export default async function () {…}` (PARSE_ERROR), then stripped the
      // `export` off `meta` to dodge that (AGENT_UNDECLARED, twice). Both mistakes are named here,
      // in the first section that shows a script.
      '**The script body is a bare async function body.** The statements you send as `script` ARE ' +
        'the body of an `async function` the engine wraps for you: `await` at the top level is ' +
        'fine, and a `return` returns the run result. Do not wrap it yourself — ' +
        '`export default async function () { … }`, a top-level `function`/`async function` ' +
        'STATEMENT, and any top-level `import` are refused `PARSE_ERROR` (which names the line and ' +
        "the construct). A `const` arrow function used as a thunk (for `parallel()`/`pipeline()`, " +
        'or called back out by name) is fine — but an `agent()`/`phase()` call written inside ANY ' +
        'function (a `const`-bound arrow, a nested `function` declaration, …) that the script never ' +
        'demonstrably reaches is refused `SCRIPT_INVALID`, issue #154: the engine counts the call ' +
        'site as live and the run silently dispatches nothing. ' +
        '`export const meta = {…}` is the ONE exception to the no-wrapper rule, and it must be ' +
        'written exactly that way, as a literal object: dropping the `export` makes the whole ' +
        'declaration invisible to the engine, and every `agent()` label is then refused ' +
        '`AGENT_UNDECLARED`.\n\n' +
        'Every `agent(label, ...)` call in the script needs a matching `meta.params.agents.<label>` ' +
        'declaration — `model`, `effort`, and `timeoutMs` are all required, each with a `.default` (v24: ' +
        'there is no implicit engine default per agent). `appendPrompt`, `skills`, and `mcp` are optional. ' +
        'A working example:\n\n' +
        '```js\n' +
        'export const meta = {\n' +
        "  description: 'Summarize the given topic in one paragraph',\n" +
        "  phases: [{ title: 'summarize' }],\n" +
        '  params: {\n' +
        '    agents: {\n' +
        `      writer: { model: { type: 'string', default: '${EXAMPLE_MODEL}' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },\n` +
        '    },\n' +
        '  },\n' +
        '};\n' +
        '```\n\n' +
        `${modelRefSentence()}\n\n` +
        // v39 (owner decision 2026-09-30): meta.phases is now REQUIRED (previously optional, and
        // silently read back verbatim when present) — this is the whole authoring rule, stated
        // exactly once, self-contained.
        '**Declaring `meta.phases`.** `meta.phases: [{title}, ...]` is REQUIRED and must equal your ' +
        "script's own `phase()` calls, in the same count and order — the SAME `writer: {...}` shape " +
        "above but with `phase('summarize');` in the script body. A script with zero `phase()` calls " +
        'must still declare `phases: []` explicitly (an absent key is refused even then). Refused ' +
        "`PHASES_REQUIRED` when `meta.phases` is missing, not an array, or has an entry with no " +
        'string `title`; `PHASES_MISMATCH` when it disagrees with the script — count, order, or ' +
        "title (the message names both lists and the first difference). A `phase()` call whose " +
        "title is computed at runtime (`phase('tier:' + args.tier)`) cannot be checked textually — " +
        'declare ANY non-empty title for it, at the right position; only the position, never the ' +
        "text, is checked there (mirrors the diagram's own dynamic-lane rule below). This is what " +
        "`workflow_describe`'s `phases` reads back (`phasesSource:'declared'`); a version registered " +
        "before this rule existed has its `phases` DERIVED from its own `phase()` calls instead " +
        "(`phasesSource:'derived'`) rather than reported empty.\n\n" +
        // issues #81/#83: nothing said how a declared skill is activated, and the only example
        // paired one with file tools — authors could not tell a skill never reached the model.
        '**Skills.** `skills: [name, ...]` names skills pushed with `workspace_push` (`kind: \'skill\'`). ' +
        // Issue #102 (asset squatting): workspace_push refuses a workflow-scoped push against a
        // name nobody has registered yet (WORKFLOW_NOT_FOUND) — registering first, THEN pushing,
        // is not merely convenient, it is now the only order that works.
        'Register the workflow FIRST (`workflow_register`), then `workspace_push` each declared ' +
        'skill against that already-registered name — a push naming an unregistered workflow is ' +
        'refused `WORKFLOW_NOT_FOUND`; registration itself never requires a declared skill to exist yet. ' +
        `${skillsActivationParagraph(ceilings.activeHarness)}\n\n` +
        "Only the agent's own declared skills can be activated (other " +
        "skills are hidden from it), and a skill's inline shell command (the `!` prefix form) is not executed. " +
        "A declared skill's files are PRIVATE to the dispatch that declared it: they materialize into a " +
        "directory outside the run workspace for the lifetime of that one dispatch only, never into " +
        '`.claude/skills/` or anywhere else inside the workspace — another agent in the same run ' +
        '(parallel or later, sharing that workspace) cannot read them with Read/Bash/Glob, they are ' +
        "never visible to `workspace_pull`/`workspace_list`, and they are gone once the dispatch ends. " +
        "If a skill's own instructions reference a supporting file by relative path, resolve it against " +
        "the base directory the Skill tool itself reports when activating it (or, under `gateway:\"pi\"`, " +
        'the path in the skill listing pi\'s own prompt shows) — never a hand-written `.claude/skills/...` ' +
        "path, which will not exist. In `run_agent_log`, `harness.skillsExposed` lists the skills the " +
        "model could activate (by the plain name you declared); `harness.materialized` records which " +
        'ones were actually found and materialized for this dispatch (also by plain name) — neither ' +
        'field, and nothing else in this run, exposes WHERE a materialized skill lives on disk.\n\n' +
        // Issue #106: MCP tools were missing from the first turn; authors could not see it.
        '**MCP servers.** `mcp: [name, ...]` names MCP servers pushed with `workspace_push` (`kind: ' +
        "'mcp'`). Every tool of a declared server is on that agent's tool surface from its FIRST turn, " +
        'whatever `allowedTools` says — `allowedTools` narrows only the built-in tools, and an ' +
        '`mcp__<server>__<tool>` entry in it only pre-approves that call, it does not hide the ' +
        "server's other tools. So `allowedTools: []` plus a declared server is a valid MCP-only agent. " +
        'The engine waits for each declared server to connect before the first turn, for at most ' +
        'about 5 seconds; a server that is slower than that to start (e.g. a first `npx` download ' +
        'on a new host) misses the turn. When that happens, or the server fails, `run_agent_log` ' +
        "shows it: `harness.mcpStatus` lists each server's status and exposed tool names as the " +
        'session started, and `harness.warnings` (rolled up onto `run_status.warnings` with the ' +
        "agent's label) carries `MCP_SERVER_NOT_CONNECTED`.\n\n" +
        '`meta.params.args` declares the run-time inputs the script reads off `args.<name>` — `{type, ' +
        'enum?, min?, max?, default?}`. A declared `.default` fills in the key when the caller omits ' +
        "it (or a run_start call omits `args` entirely); an explicit caller-supplied value always " +
        "wins, including an explicit `undefined`. `type` is one of `string | number | enum` (an " +
        '`enum` type requires the `enum` array of legal values).\n\n' +
        // issue #107: args are typed data the AUTHOR places into their own trusted prompt — the
        // bound is the contract's job, not the caller's good behaviour, because `args` is validated
        // on BOTH admission doors a run can arrive through.
        '`args` are typed data YOU (the author) interpolate into your own trusted prompt — declaring ' +
        '`type`/`enum`/`min`/`max` is what keeps a caller-supplied value inside the shape you wrote ' +
        'the prompt for. This is enforced on `run_start` AND on a nested `workflow(name, args)` call ' +
        "(the SAME contract, the CALLED workflow's own — a caller composing your workflow cannot " +
        'send anything your declared `args` would not already accept directly); a value outside the ' +
        'contract is refused before your script runs at all. `appendPrompt` is the separate, ' +
        "author-OPT-IN channel for a caller's own free-text instructions, framed so the model can " +
        "tell them apart from yours — a `string`-typed arg you interpolate verbatim carries no such " +
        'framing, so a loose `{type:\'string\'}` (no `enum`, no byte-length `max`) lets ANY text ' +
        'through your own bound; constrain it with `enum`/`max`, or route free text through ' +
        '`appendPrompt` instead.\n\n' +
        `\`meta.params.knobs\` and \`meta.defaults\` are retired — a script that declares either is ` +
        `refused \`DEFAULTS_RETIRED\`, naming \`meta.params.agents.<label>.<key>.default\` as the ` +
        `replacement.\n\n` +
        'The engine-owned keys are never written inside an `agent()` call\'s options literal — ' +
        `\`${TUNABLE_KEYS.join('`, `')}\` there are refused \`SCAN_VIOLATION\`, naming the key ` +
        `and the \`meta.params.agents.<label>.<key>.default\` it belongs in instead.\n\n` +
        // v25 (#55, adjudication #9 I-1.3/I-1.4): the guide has to say that the options object is
        // CLOSED, because until v25 it was not, and a dropped key is indistinguishable from a
        // honoured one at the call site.
        'The options object is closed. An `agent()` option key that is not one of ' +
        `\`${WRITABLE_AGENT_OPT_KEYS.join('`, `')}\` is refused \`SCAN_VIOLATION: PARAM_UNKNOWN\` at ` +
        'registration, naming the key you wrote and listing the ones that are accepted. It is never ' +
        'silently dropped — before v25 it was, and an author who reached for a plausible-sounding ' +
        'name got a run that looked correct and ignored the option.',
    ),
  );

  parts.push(
    section(
      "The agent's tool surface",
      // v25 (#55): the capability shipped in v21 and no author-facing surface named it until now.
      // The second paragraph is the knowledge the v24 cold subject had to derive from a failing
      // run; REQ-117's rule is that such knowledge belongs here so nobody derives it twice.
      'Each `agent()` call decides which tools its model may use, with `allowedTools`:\n\n' +
        '```js\n' +
        "const verdict = await agent('judge', { prompt: 'Answer with one word: PASS or FAIL.', allowedTools: [] });\n" +
        "const editor  = await agent('editor', { prompt: 'Fix the typo in README.md.', allowedTools: ['Read', 'Edit'] });\n" +
        '```\n\n' +
        // v34 (DES-229, TASK-230, REQ-202/203): the retired `agentType` frontmatter rung is gone —
        // two SETTABLE layers, and the claim is scoped to the tool-calling (SDK gateway) path,
        // because the direct-fetch transport has no tool surface at all (surfaceType:'none') and a
        // cold client choosing it must not read a curated-tool promise that does not apply.
        // v34 send-back repair (Gate 8 AC-1): the guide named only the two settable layers and
        // omitted the built-in core-tool fallback (BUILT_IN_CORE_TOOLS,
        // claude-agent-sdk-client.ts:190/544-547) that applies when a deployment configures
        // neither — silent to a script author but not to the model, which never receives an
        // unset tool surface. Named here rather than built by defaulting `defaultAllowedTools`
        // in composeConfig (that would still need this sentence, since a cold author cannot read
        // rwe.config.json, and it would duplicate BUILT_IN_CORE_TOOLS across a module boundary).
        'Two layers are **settable**, on the tool-calling (SDK gateway) path, and the first one ' +
        "present wins: the per-call `allowedTools` above, then this deployment's configured " +
        '`defaultAllowedTools`. Only the first is settable from a script. If the deployment ' +
        'configures neither, the engine applies a built-in core set — `Read`, `Write`, `Edit`, ' +
        '`Glob`, `Grep`, `Bash` — so a session is never handed the CLI\'s full uncurated tool ' +
        'list. (The direct-fetch transport has no tool surface at all — this section does not ' +
        'apply to it.)\n\n' +
        // Issue #78(a): reproduced — `allowedTools: ['Bash']` wrote a file. The list names tools;
        // it does not bound what a shell can do. Posture-neutral on purpose: the next section
        // (Host path grants) is the one that says whether Bash is confined on this deployment.
        '`allowedTools` restricts tool **names**, not what the agent can reach. `Bash` can read, ' +
        'write and search anything `Read`, `Write`, `Edit`, `Grep` and `Glob` can — inside the run ' +
        'workspace when this deployment confines `Bash`, anywhere the engine process can reach when ' +
        "it does not (see Host path grants). So `['Bash']` alone can still write files, and a list " +
        "that names `Bash` beside any of those five is no narrower than `Bash` alone: " +
        '`workflow_register` answers it with a non-fatal `result.warnings` entry ' +
        '(`BASH_SUBSUMES_FILE_TOOLS`) and registers the version anyway. A read-only agent is ' +
        "`['Read', 'Grep', 'Glob']`, with no `Bash`. An agent that also declares a `skill` is a " +
        'partial exception on `gateway:"pi"` (see Skills, above): dropping `Read` there is still ' +
        "safe for the skill's own visibility, because `Bash` alone already satisfies pi's " +
        '`SKILL_REQUIRES_READ_TOOL` requirement — the warning states this explicitly when it ' +
        'applies.\n\n' +
        readonlyBashBody(ceilings.confinementPosture) +
        '\n\n' +
        // Issue #77: the SDK's Write description says "must be absolute"; the engine cannot change
        // that text, so the guide states the rule the engine actually applies.
        'File tools take workspace-relative paths: `out/result.txt` resolves inside the run ' +
        "workspace, even where a tool's own description asks for an absolute path. A file-tool path " +
        'that resolves outside the workspace is refused, and the refusal names the workspace root.\n\n' +
        '`allowedTools: []` means no tools at all, and for a prose-only task that is usually what you ' +
        'want — especially on a smaller model. A smaller model handed a working tool surface tends to ' +
        'answer with a tool call rather than with prose: ask it to produce a summary while it holds ' +
        '`Write`, and the reply can come back as a tool-call envelope your script then has to unwrap. ' +
        'Emptying the surface removes the option and the model answers in text. It also makes the call ' +
        'markedly cheaper — the tool definitions are prompt tokens on every turn (measured on this ' +
        "engine: 162 input tokens with an empty surface against 1722 with the default one, for the " +
        'same prompt).',
    ),
  );

  parts.push(
    section(
      'Host path grants',
      // v37 (DES-258, ARCH-107, TASK-256, REQ-117, REQ-218, ARCH-181, ADR-083 posture C —
      // corrected 2026-09-22 per the owner's ruling on DES-258's owner_decision): what Bash may
      // touch on the host filesystem is now POSTURE-CONDITIONAL, not a static claim — the v37 boot
      // probe (ARCH-181) measures whether Bash is actually confined on THIS deployment, and a
      // guide that always asserted confinement was a false claim on a host measured 'unconfined'
      // (this one). The grant LIST itself stays static (no GuideCeilings.grantedHostPaths, no new
      // ServerConfig hop — the owner left that half of DES-258's question unresolved on purpose).
      // No GUIDE_EXAMPLES entry either way (an EROFS happens inside a tool result the workflow
      // script never sees, so an example demonstrating one would teach an invalid example).
      hostPathGrantsBody(ceilings.confinementPosture),
    ),
  );

  parts.push(
    section(
      'Prompt layering',
      // v34 (DES-229, TASK-230, REQ-202/203): after the `agentType` mechanism's retirement there
      // are exactly two author/caller segments, plus the engine's own scaffolding — nothing else
      // contributes text to what the model actually sees.
      'After v34 there are exactly two author/caller segments in the prompt a model receives: the ' +
        "script's own `prompt` argument to `agent()`, then a caller-supplied `appendPrompt` override, " +
        'framed inline as `<user-instructions untrusted="true">…</user-instructions>`. The engine ' +
        "adds only its own scaffolding around them (a schema suffix and a retry nudge) — it does not " +
        'decide whether the appended segment is an authorized override or a foreign injection. An ' +
        'author who wants the appended segment to carry override force has to write the adoption rule ' +
        "into their OWN prompt; the engine draws no such line on the author's behalf.",
    ),
  );

  parts.push(
    section(
      'Locked vs. tunable',
      `The ${numberWord(LOCKED_KEYS.length)} locked keys are engine-owned and can never be overridden by a caller: ` +
        `${LOCKED_KEYS.join(', ')}. The ${numberWord(TUNABLE_KEYS.length)} tunable keys an override may target, per declared agent ` +
        `label, are: ${TUNABLE_KEYS.join(', ')}.`,
    ),
  );

  parts.push(
    section(
      'Engine ceilings (this deployment)',
      `The ceilings below are this build's resolved values — operator-overridable, so a different ` +
        `deployment's engine may render different numbers here: a declared agent's \`timeoutMs.default\` may ` +
        `not exceed ${ceilings.maxTimeoutMs}ms, a declared \`appendPrompt.default\` may not exceed ` +
        `${ceilings.maxAppendPromptBytes} bytes, and a declared \`effort.default\` may not rank above ` +
        // issue #89 item 2: registration and a run-time override answer DIFFERENT codes for the
        // same "out of bounds" fact — verified against params/contract.ts's validateOneAgentSpec
        // (registration) vs validateOneAgentOverride/checkValueAgainstSpec (a run_start override).
        // The guide used to say every over-ceiling value is PARAM_OUT_OF_RANGE, which is only true
        // of the override case; a declaration above a ceiling is PARAM_CONTRACT_INVALID instead.
        `'${ceilings.maxEffort}'. A declaration above any of these ceilings (in ` +
        '`meta.params.agents.<label>`) is refused `PARAM_CONTRACT_INVALID` at registration — never ' +
        'silently clamped. A run-time **override** (`run_start`\'s `overrides.agents.<label>`) that ' +
        'names a value outside the effective (author ∩ ceiling) bound is a DIFFERENT refusal, ' +
        '`PARAM_OUT_OF_RANGE`, at admission.\n\n' +
        modelRefSentence(),
    ),
  );

  parts.push(
    section(
      'Providers and the model catalog',
      'A full model ref\'s provider prefix names exactly one of three providers, each with its own ' +
        'declared capability row — read from the SAME table `parseModelRef`/`checkModelRef` check ' +
        'against, labelled **declared, not probed**: nothing here is learned by dispatching a call.\n\n' +
        providerCapsRows(ceilings.harnessProviders) +
        '\n\nThere is no `openai` row: OpenRouter is the many-model front door for everything that is ' +
        'not Anthropic-direct or a local Ollama model, so swapping a model — or a transport — is a ' +
        'different `<provider>/<model-id>` ref, not a new provider.\n\n' +
        "`models_list` shows the CATALOG this deployment can reach — every row's `ref` field is the " +
        'exact `<provider>/<model-id>` string to paste into `model.default`/a run_start override ' +
        '(see "Engine ceilings" above for the full-ref rule). One row per model — there is no alias ' +
        'overlay, so a model is never listed twice under two names. Its `toolUseDeclared`/`effortDeclared` flags and ' +
        '`costLevel` rating are DECLARED capability, never probed by dispatching a call, and carry ' +
        "their own provenance: `declaredSource` ('upstream'|'static'|'unknown') says where the flag " +
        'came from, and `catalogFetchedAt` is per-row catalog provenance (a timestamp, or `null`). ' +
        '`toolUseVerified`/`proseVerified` are the OBSERVED counterpart: the engine periodically probes ' +
        'each configured model with one prose call and one call that must read a file through the Read ' +
        'tool (`null` = never probed; `lastProbedAt`/`probeDetail` say when and what happened), and ' +
        "`stabilitySource:'probe'` means `stability` reflects that probe ('unavailable' = no prose " +
        "answer, 'degraded' = no tool use). If an agent needs tools, pick a model whose row says " +
        '`toolUseVerified: true` — `run_start` answers a non-fatal `warnings` entry ' +
        '(MODEL_TOOL_USE_UNVERIFIED) when an agent holding tools lands on one whose probe saw none. ' +
        "Probe results are PER HARNESS (issue #138): a result only counts as evidence for the gateway/" +
        'transport that actually produced it, so after this deployment switches `gateway` (e.g. `"sdk"` to ' +
        '`"pi"`), every model\'s `toolUseVerified`/`proseVerified` read `null` again (`stabilitySource` falls ' +
        'back to the rule tier) until re-probed under the new harness — automatically on the periodic ' +
        "prober's next tick, or immediately via an admin `models_probe()` call.\n\n" +
        // Issue #104: the selection surface — the tool description itself documents every field.
        'To CHOOSE a model, `models_list` answers one page `{ models, nextCursor, total }` of compact ' +
        "rows (`fields: ['*']` for every field; pass `nextCursor` back as `cursor`). Filter by " +
        "`modelType: 'chat'` (only chat models can drive an agent), `toolUseVerified`, `structuredOutput`, " +
        '`reasoning`, benchmark minimums, or observed latency/success/cost; sort with `sortBy` (price, ' +
        'intelligence, coding, agentic, latency, successRate, avgCostPerCall, …; nulls last). `observed` is ' +
        "what THIS engine measured for the model over 30 days (split `prose` vs `tools` calls — " +
        '`avgCostUsdPerCall` includes the harness overhead, so it predicts a run\'s cost better than unit ' +
        'price); `benchmarks` are third-party scores republished by OpenRouter (null when none). ' +
        // issue #150: per-model and harness-aware now, computed the SAME way on every row this
        // deployment ever serves — never a blanket per-provider claim (ollama never carries it under
        // either gateway; the sdk gateway's dispatch path never carries it for openrouter either; the
        // pi harness DOES, but only for a model whose own row declares reasoning support).
        '`effortAppliedOnTransport` says whether an agent\'s `effort` actually reaches THIS model on this ' +
        'engine\'s dispatch path — a live, per-model fact (never a blanket per-provider one), whatever ' +
        '`effortDeclared` (the upstream catalog\'s own declaration) says.\n\n' +
        'Reading the numbers: `null` means "not published / not measured", never a low score — OpenRouter ' +
        'republishes only Artificial Analysis intelligence/coding/agentic (plus Design Arena), so compare models ' +
        'only on dimensions both have; there is no instruction-following or tool-calling score. `observed.successRate` ' +
        'counts calls that finished, NOT schema conformance: a call whose output keeps failing an agent() `schema` ' +
        'resolves null in your script yet still counts as a success. The engine enforces `schema` itself (states it in ' +
        'the prompt, validates the reply, re-asks up to 3 times) on every model, so `capabilities.structuredOutput` ' +
        '(an upstream declaration, null on anthropic-direct rows) neither enables nor guarantees it — keep the schema a ' +
        'small top-level object, prefer stronger models for strict JSON, and handle a null result (retry with another ' +
        'model). Fields outside the compact row (`capabilities`, `ratesPerM`, full `observed` buckets) need ' +
        "`fields: ['*']` or `fields: [...]`. " +
        'The vendor of `openrouter/<vendor>/<model>` is its second segment; `:batch`/`:free` ' +
        'suffixes are the same model on another pricing tier. There is no score-per-dollar field — compute it from ' +
        '`ratesPerM`. Cap every agent with `timeoutMs` and the run budget so a model that loops on tools cannot run away ' +
        '(visible as high `avgCacheReadTokens` and low `avgOutputTokens` in `observed.tools`).\n\n' +
        harnessDisclosureParagraph(),
    ),
  );

  parts.push(
    section(
      'Budget, concurrency, and how wide a fan-out really runs',
      // v25 (DES-168, REQ-120, issue #61): the limit an author had NO way to learn. The owner hit it
      // in production — a 3-wide parallel() silently ran 2 — and the guide said nothing about budget
      // interacting with fan-out width at all.
      `\`parallel([a, b, c, ...])\` dispatches every thunk, and this deployment runs up to ` +
        `**${ceilings.runConcurrency}** of them at a time (\`runConcurrency\`, operator-configurable). ` +
        'Past that they QUEUE and run as slots free: a wider fan-out is slower, never truncated. ' +
        'This applies identically whether the fanned-out thunks call `agent()` or nested `workflow()` ' +
        '— a wide `parallel()` of nested `workflow()` calls is throttled by its own same-sized pool, ' +
        'never left to fork every child process at once (issue #163).\n\n' +
        "`run_start`'s `budget` takes TWO independent limits — `{usd?, tokens?}` — either of which " +
        'may be omitted or `null` for unbounded. Each is a **stop-dispatching signal, not a hard ' +
        'ceiling**, and this is the honest description of what the engine can enforce. Before each ' +
        'dispatch it asks one question per armed limit: has this run already spent it? If yes, the ' +
        'call is refused `BUDGET_EXCEEDED`; if no, it goes. What a call will cost cannot be known ' +
        'before it finishes, so calls already in flight when a limit runs out still complete — a run ' +
        `can therefore overshoot EITHER limit by up to one concurrency window ` +
        `(${ceilings.runConcurrency} x one call's cost). Size a budget for the whole workflow, not ` +
        'per call.\n\n' +
        'Inside the script, the read-only `budget` object answers each limit with its own accessor: ' +
        '`budget.limits.usd` / `budget.limits.tokens` are the two ceilings (`null` when that limit is ' +
        'unbounded — `null` is `===`-detectable but NOT comparison-safe, `null < 1000` is `true`); ' +
        '`budget.total` aliases `budget.limits.usd`; `budget.spent()` / `budget.remaining()` answer ' +
        'the USD limit only (`remaining()` is `null` when no USD limit is armed); `budget.tokens()` ' +
        'answers the token limit — it returns the four-column `{input, output, cacheRead, ' +
        'cacheWrite, sum}` spent so far. A USD budget counts only calls the model catalog can price ' +
        '— an unpriced call adds 0 to USD spend and never trips a USD limit — so set `budget.tokens` ' +
        'for a limit that binds on every model, including local ones with no listed price.\n\n' +
        // v26 Gate 7.5 round 1 (defect D4): the four columns are priced at FOUR rates, and an
        // author sizing a USD budget for a cache-heavy workflow has no other way to learn which
        // cache-write multiplier the engine assumes.
        'The four token columns are priced at four different rates, not one. On the Anthropic ' +
        'models this deployment prices statically, a cache READ costs about a tenth of a fresh ' +
        'input token and a cache WRITE costs more than one: the published multipliers are 1.25x ' +
        'input for a 5-minute cache and 2x for a 1-hour one. **This engine bills every cache write ' +
        'at 2x** — the usage it receives reports a single `cacheWrite` figure with no TTL in it, so ' +
        'the two cannot be told apart, and the more expensive of the two is the safe assumption for ' +
        'a spend limit (a budget that stops slightly early is recoverable; one that stops late is ' +
        'not). Your `costUSD` for a cache-writing call is therefore an upper bound, never an ' +
        'undercount.\n\n' +
        'A refusal is visible, and is NOT the same thing as your own thunk throwing:\n\n' +
        '- your thunk throws → `parallel()`/`pipeline()` give that slot `null` and the rest keep going ' +
        '(the documented contract);\n' +
        '- the ENGINE refuses to dispatch → the error PROPAGATES out of `parallel()` with the code ' +
        '`BUDGET_EXCEEDED`, the run fails with that code unless you catch it, and the refused call ' +
        "appears in `run_status.agents` as `state: 'refused'` with `reasonCode: 'BUDGET_EXCEEDED'`. " +
        'A refusal rejects the WHOLE `parallel()` call, so its already-completed branches are not ' +
        'returned to you either. Catch it only if the run has something useful to do without them:' +
        '\n\n' +
        '```js\n' +
        'let findings = [];\n' +
        'try {\n' +
        '  findings = await parallel(lenses.map((lens) => () => agent(\'researcher\', { prompt: lens })));\n' +
        '} catch (e) {\n' +
        '  if (e.code !== \'BUDGET_EXCEEDED\') throw e;\n' +
        '  // Out of budget: `findings` is still [] — this phase produced nothing. Continue with what\n' +
        '  // earlier phases returned, or rethrow to fail the run with BUDGET_EXCEEDED.\n' +
        '}\n' +
        '```\n\n' +
        // v25 (DES-169, REQ-120, issue #63): the example above rethrew every time until v25, because
        // the code rode on `name` and nothing set `code`. The realm caveat BELOW was stated rather
        // than fixed back then — see the DES entry; that has since changed (#157 B1 — the realm
        // mismatch itself was the same hazard a sandbox-escape vector exploited, so fixing the
        // SECURITY hole fixed this caveat as a side effect).
        '`e.code` is still the recommended handle — a plain own property, simplest to branch on, and ' +
        'unaffected by anything below. `e instanceof Error` and `args instanceof Object` now also ' +
        'work correctly (fixed by #157 B1): every value the engine hands your script — errors, ' +
        '`args`, agent()/workflow() results — is built natively in your script\'s own realm, not the ' +
        'engine\'s, so standard checks (`instanceof`, `Array.isArray`) behave exactly as they would ' +
        'for a value you constructed yourself. Every engine refusal carries the same `e.code`/`e.name` ' +
        'catalog code as `run_result.error.code`, plus a human `e.message`.\n\n' +
        // issue #127: an agent() call cut short by run_suspend/run_stop, a timeout, or a terminal
        // provider error still charges whatever it spent — the pre-#127 engine silently dropped it,
        // so cost/budget under-counted real provider spend and a budget could be exceeded without
        // ever tripping. Two things an author needs from this, beyond what the resume-replay
        // paragraph above already says (same root cause, two different surfaces).
        // v0374 integration review L-3: `markUsage`'s live-streamed per-attempt figure (issue #141's
        // own `_liveAttemptUsage` side channel) is never stamped onto a running agent's own record —
        // only a FULLY SETTLED attempt's committed usage is. Document this before an author assumes
        // polling run_status mid-call will show a live-updating token count.
        'A `running` agent\'s `tokens`/`costUSD` on `run_status` show only COMMITTED usage — every ' +
        'already-settled attempt so far (e.g. an earlier schema re-ask that failed validation and is ' +
        'retrying) — never the CURRENTLY in-flight attempt\'s own live total; for a plain single-' +
        'attempt call that means no `tokens` field at all until the agent itself goes terminal. ' +
        'Polling `run_status` mid-call will not show a live-updating count; read run_agent_log for the ' +
        'transcript as it streams instead.\n\n' +
        '`run_status.agents[].tokens`/`costUSD` are populated on a FAILED agent too, not only a ' +
        'done one, whenever the gateway reported usage before the call ended; `agents[].partial: ' +
        'true` marks that figure as a LOWER BOUND — the deduped sum of what streamed in before the ' +
        'cutoff, not the provider\'s own finalized total (a terminal provider error that DID report ' +
        'its own total is NOT marked partial — only a genuine abort/timeout/mid-stream cutoff is). ' +
        'On a `partial` figure, treat `output` as the column most likely to be a severe ' +
        'underestimate (the per-turn streamed snapshot it is built from only reaches a turn\'s true ' +
        '`output_tokens` on that turn\'s own final frame, which a cut-short call\'s in-flight turn ' +
        'never reaches) — `input`/cache columns track the eventual finalized total closely. ' +
        'This figure is charged against `budget` exactly like a completed call\'s, so a repeated ' +
        'suspend/resume cycle of a usage-heavy agent now counts toward, and can trip, a token or ' +
        'USD limit even though every individual attempt was interrupted. Separately: resuming a ' +
        'suspended/interrupted run RE-DISPATCHES the agent() call that was in flight at the cutoff ' +
        'from the START, with a NEW agentId — it does not continue the old one. An agent() whose ' +
        'ONLY effect is its return value (e.g. a pure-text or `schema`-validated response) is safe to ' +
        're-dispatch this way; one that also performs a non-idempotent side effect through an MCP ' +
        'tool or Bash (writing a row, sending a message, charging something) may perform that effect ' +
        'TWICE across a suspend/resume — design such a call to be idempotent (a dedupe key, an ' +
        '"upsert" instead of an "insert") or keep it out of a label a workflow might resume into.',
    ),
  );

  parts.push(
    section(
      'The author-supplied diagram',
      'Every registration requires a non-empty Mermaid `mermaid` string (`MERMAID_REQUIRED`) — the ' +
        'engine no longer draws the diagram for you (that generator is retired: registering a script ' +
        'used to send the whole script body to an LLM as a prompt; the diagram is now yours to draw, so ' +
        'nothing you write is sent anywhere just to produce a picture). A node is `id<shape>`, one per ' +
        'line, and these are the shapes this engine accepts — nothing else parses:\n\n' +
        shapeRows() +
        '\n\nThe stadium (agent) nodes MUST exactly match your script\'s `agent()` labels, checked both ' +
        'ways: an agent label with no matching node, or a stadium node with no matching label, is ' +
        '`DIAGRAM_MISMATCH`. The other four shapes are free text and are excluded from that check.\n\n' +
        'An agent node may also carry its resolved settings after a `<br/>`, as the triple ' +
        '`label<br/>model · effort · timeout` (separated by ` · `, a space-padded middle dot; the ' +
        'timeout as `120s`, `120000` or `120000ms`). If you write the triple it must AGREE with that ' +
        "label's declared defaults — a disagreement is refused `VALUE_MISMATCH`. A node with no " +
        '`<br/>` is simply not compared, so the triple is optional and, once written, is held to the ' +
        'contract.\n\nEdges:\n\n' +
        edgeRows() +
        '\n\nAn edge may carry a label as `a-->|text|b`. Write ONE edge per line: the `&` fan-out ' +
        'shorthand (`a-->b & c`) is refused `COLLAPSED_EDGE` — the checker matches your diagram ' +
        'against your script edge by edge. Any edge that sits inside a cycle (a directed loop back to ' +
        'an ancestor, or a self-loop) MUST carry a `|label|` — describe what the loop is doing (e.g. ' +
        '`|revise|`), not just that it loops. A `subgraph "title"` / `end` pair boxes related nodes ' +
        '(e.g. a debate) under a mandatory quoted title. For a live preview before you register, paste ' +
        'your diagram into a Mermaid live editor (e.g. https://mermaid.live/) — this guide only checks ' +
        'the grammar, it does not render.',
    ),
  );

  // v26 (REQ-128, DES-184, ADR-043, integrator — no TASK owned this prose): the four v2 rules in
  // author-readable words. Written HERE and, compressed, on `workflow_register`'s own `mermaid`
  // parameter description (tool-specs.ts), because a cold client that only reads `tools/list` must
  // be able to satisfy the contract first try (REQ-117). The four codes are named literally so an
  // author who meets one can find this paragraph by searching for it.
  parts.push(
    section(
      'Canonical diagram',
      'From v26 every NEW registration is checked against the shape of your own script, not just ' +
        'against its label set. Four rules, each with its own refusal code, each carrying the line ' +
        'and the structure the checker EXPECTED (as data — the engine never hands you a corrected ' +
        'diagram; writing it is the point).\n\n' +
        '1. **Direction — `DIAGRAM_DIRECTION`.** The first line must be `graph LR` or `flowchart LR`. ' +
        'The diagram is a swimlane read left to right; `TD` is refused before anything structural is ' +
        'looked at, because a top-down diagram has no lanes to check.\n' +
        '2. **Lanes — `LANE_MISMATCH`.** One `subgraph "title"` / `end` block per `phase()` call in ' +
        'your script, in CALL ORDER, and every agent node declared inside the lane of the `phase()` ' +
        'it is dispatched under. A phase title computed at runtime (`phase(\'tier:\' + args.tier)`) ' +
        'is matched by POSITION, so any non-empty title is accepted for that lane. This is why every ' +
        '`agent()` must sit inside a `phase()`: a call before your first `phase()` is refused ' +
        '`AGENT_BEFORE_PHASE`, since an unnamed zeroth lane is neither checkable nor drawable.\n' +
        // issue #89 item 5: this used to say the tools segment "may carry" the surface, implying it
        // is ALWAYS optional. It is not — checkMermaid's checkTools (rule 12) compares it whenever
        // the call declares a LITERAL `allowedTools` array (including `[]`) and refuses
        // TOOLS_MISMATCH for a bare node (no third segment at all) in that case; the checker's own
        // strictness is unchanged, only this prose was wrong. It is skipped ONLY when the call
        // declares no `allowedTools` key at all.
        '3. **Tools — `TOOLS_MISMATCH`.** Whenever an `agent()` call declares a literal ' +
        '`allowedTools` array — including the empty array `allowedTools: []` — its node\'s third ' +
        '`<br/>` segment is REQUIRED and checked exactly: `label<br/>model · effort · timeout<br/>' +
        'tools: Edit, Read` — the names sorted, comma-space separated, exactly the literal ' +
        '`allowedTools` array on that call, or `tools: none` for `allowedTools: []`. Omitting the ' +
        'segment (or leaving the node with no `<br/>` at all) while `allowedTools` is a literal array ' +
        'is refused `TOOLS_MISMATCH` — it does NOT fall back to "not compared". Only when the call ' +
        'declares no `allowedTools` key at all is the segment optional and skipped entirely: write ' +
        '`tools: default` (the honest word for "whatever this deployment configures") or leave the ' +
        'segment off.\n' +
        '4. **Edges — `EDGE_MISMATCH`.** Consecutive calls in your script must be joined in the ' +
        'diagram, across lane boundaries too. A path may run through non-agent shapes (a diamond for ' +
        'a branch, an aggregation for a non-agent join), which is how you draw a ternary or an ' +
        '`if/else`. A direct agent→agent edge between calls that are NOT consecutive needs a ' +
        '`|label|` saying what it means. Members of one `parallel([...])` (or of the two arms of one ' +
        'branch) are never edged to each other — they fan in to whatever follows.\n\n' +
        'A script whose shape a static read cannot resolve at all — an `agent()` inside a `for`, ' +
        '`while` or `switch` body — makes that lane DYNAMIC: it predicts no slots, so rule 4 has no ' +
        'edges to compare there. Declare the agent\'s node inside that lane anyway: rule 2 (LANE) ' +
        'still requires it, and rule 3 (TOOLS) still applies whenever that call declares a literal ' +
        '`allowedTools` array — only an absent or variable `allowedTools` on a dynamic-lane call ' +
        'skips rule 3, same as everywhere else.\n\n' +
        'Minimal accepted example:\n\n' +
        '```\ngraph LR\nsubgraph "draft"\nwriter(["writer"])\nend\nsubgraph "review"\n' +
        'critic(["critic"])\nend\nwriter-->critic\n```\n\n' +
        'Versions registered BEFORE v26 are grandfathered: they keep `diagramContract: \'v1\'`, are ' +
        'never re-checked, and render exactly as they always did. `workflow_describe` tells you ' +
        'which contract a version was admitted under.',
    ),
  );

  parts.push(
    section(
      'Seeding a workspace',
      "A run's workspace can be pre-populated three ways on `run_start`, mutually exclusive with " +
        'each other and with `seedRef` (a mixed request is refused `SEED_SOURCE_CONFLICT`):\n\n' +
        seedShapeRows() +
        '\n\nEvery `seed`/`seedManifest`/`seedManifestRef` element that does not match its declared ' +
        'shape is refused `INVALID_SEED_SPEC` before a single byte is written — a `seed` element ' +
        'missing `contentB64` (or carrying only a `sha256`) does NOT silently materialize a 0-byte ' +
        'file; the refusal names the offending `path` and points at `seedManifest` instead. Content ' +
        'referenced only by hash (`seedManifest`, `seedManifestRef`) must already exist in the CAS ' +
        '— push it first with `workspace_push`.\n\n' +
        // Issue #82 (option B): rendered from workflow_register's own schema, like the rows above.
        '**Scheduled and webhook-fired runs** carry no `run_start` arguments, so they cannot bring a ' +
        'seed of their own — bind one to the workflow VERSION instead: `workflow_register({name, ' +
        'script, mermaid, seedManifestRef})`. ' +
        ((TOOL_SPECS.find((t) => t.name === 'workflow_register')!.inputSchema as unknown as { properties: Record<string, { description?: string }> })
          .properties.seedManifestRef?.description ?? '') +
        // Owner decision 2026-10-02: the CAS quota, cleanup and disk floor an author meets while seeding.
        '\n\n**Storage quota and cleanup.** Everything you upload to the CAS (POST /assets/blob, ' +
        'POST /assets/manifest, `workspace_push` blob mode, and trees the engine fetches for your ' +
        '`seedRef`) counts against YOUR content-store quota — by default user 1 GiB, author 5 GiB, ' +
        'admin unlimited (the operator sets `casQuota`; an administrator can override one account ' +
        'with `principal_set_quota`). Usage is the total size of every blob in your pool; a blob ' +
        'other accounts also hold still counts fully for you. `workspace_diff` returns your ' +
        '`quota {usedBytes, limitBytes, source}` with every diff. An upload that would exceed the ' +
        'limit is refused `QUOTA_EXCEEDED {usedBytes, limitBytes, requestedBytes, hint}` (HTTP 507) ' +
        'before anything is stored. Free space with `workspace_prune_blobs` — a dry run by default; ' +
        '`dryRun:false` removes blobs that no version you registered with `seedManifestRef` needs ' +
        '(the manifest and every blob it lists are kept) and that were not used for `olderThanDays` ' +
        '(default 30). Separately, while the engine\'s disk is below its free-space floor every ' +
        'upload and every new run (run_start, run_resume, schedule/webhook firings, nested ' +
        '`workflow()`) is refused `DISK_LOW {freeBytes, floorBytes}` — transient (HTTP 503), retry ' +
        'later; runs already in flight continue.\n\n' +
        // Issue #144 / v0374 review L-1: a seeded `.claude/skills/**` was never activatable (the
        // engine's own `Options.skills`/`plugins` wiring is an explicit list it builds itself, never
        // scanned off the workspace), but before this engine also removed it entirely at the first
        // dispatch (the same leftover-config sweep that already removed `.claude/settings.json`/
        // `.claude/hooks`/`.mcp.json`), it just sat there unreachable; a cold author seeding one had
        // no way to learn why it silently did nothing, and now also why it disappears from
        // `workspace_pull` after the run\'s first agent() call.
        '**A seeded `.claude/skills/**` is removed, not merely inert.** If your `seed`/`seedManifest` ' +
        'includes files under `.claude/skills/`, the engine strips them from the run workspace before ' +
        'the first `agent()` dispatch — the same sweep that already removes a planted `.claude/' +
        'settings.json`, `.claude/hooks/`, or `.mcp.json` (leftover engine-owned config paths, never ' +
        'something a seed is meant to control). They will not appear in `workspace_pull` after that ' +
        'point, and were never activatable even before the sweep existed. Provision a skill with ' +
        "`workspace_push({kind:'skill', workflow, name, files})` instead — see \"Provisioning skills " +
        'and MCP servers\" below.',
    ),
  );

  // v35 (DES-239, ARCH-151, TASK-237, REQ-207/210): three facts a cold author got wrong that
  // nothing else in the guide states this plainly — a failed SEQUENTIAL agent() call, the meaning
  // of timeoutMs once retries are deployed, and the double-JSON envelope every tool result arrives
  // in (including this guide's own).
  parts.push(
    section(
      'Three things a cold author gets wrong',
      'A **sequential** `await agent(label, options)` call that fails or times out resolves to ' +
        '`null` for that reason — it does not throw. (An ENGINE refusal, e.g. `BUDGET_EXCEEDED`, is ' +
        'a different case and still propagates as a thrown error — see "Budget, concurrency" above.) ' +
        "Guard every sequential call the same way `parallel()`'s own thunks already are:\n\n" +
        '```js\n' +
        "const out = await agent('reviewer', { prompt: 'Review the draft' });\n" +
        'if (out === null) {\n' +
        '  // the agent failed or timed out — there is no result to read here\n' +
        '  return;\n' +
        '}\n' +
        '```\n\n' +
        '`timeoutMs` bounds ONE attempt, never the whole call: this deployment MAY retry a failed ' +
        'attempt — how many times is deployment-configured (it can be zero); ' +
        "`workflow_describe`'s `timeoutMs.attempts` for that agent is authoritative, not an " +
        'assumption. The deployed retry count multiplies the single-attempt bound into the actual ' +
        "worst-case wait — `workflow_describe` reports the multiplied figure as that agent's " +
        '`timeoutMs.worstCaseMs`, next to the single-attempt `timeoutMs.default`. An `agent()` call ' +
        'with no timeoutMs set — neither on the call itself (`timeoutMs`) nor as this deployment\'s ' +
        'own configured default — runs once: retries apply only to a call that has a bounded timeout ' +
        'in effect.\n\n' +
        'Every tool result — including this guide\'s own — arrives as a JSON string inside ' +
        '`content[0].text`, never as a structured object: parse it again to reach the actual ' +
        "payload.\n\nA run's structured refusal marker (`refusalRef`, carried internally from the " +
        "sandbox to the run's own ledger) is engine-attested — it can only name a refusal this " +
        'SAME run genuinely raised. `error.code` alone is **not** attested and never has been: a ' +
        "script that catches an error and sets `e.name` before rethrowing it can forge any code, " +
        'with no marker to back it.',
    ),
  );

  parts.push(
    section(
      'Registration and versioning',
      'The normal loop: `workflow_register` a script under a name, `run_start({name, version})` the ' +
        'version it just returned to iterate, and once it is stable `workflow_publish(release)` it — ' +
        'registering the same name again appends a new version and never overwrites an existing one. ' +
        'The rest of this section is exceptions, not the common path.\n\n' +
        'Registering a script that predates the v24 contract (or was never migrated) resolves ' +
        '`runnable:false` with `runnableReason: LEGACY_REREGISTER` — re-register it under the current ' +
        'contract; there is no legacy-resolution ladder. Omitting a currently-registered trigger from a ' +
        'new version does not release it (omission does not release) — deregister the trigger ' +
        'explicitly if you mean to stop it. A `once` trigger is consumed on its firing attempt — whether ' +
        "that attempt succeeds or is refused — and will not fire again; a refused `cron` firing instead " +
        'gets a fresh future `nextFire` and tries again next time. Assets (skills/mcp) registered under ' +
        'an owner are shared across every version of that workflow name, not pinned to the version that ' +
        'first declared them.\n\n' +
        'A trigger bound through `triggers:[id]` is PINNED to the HIGHEST-numbered version that ' +
        'declares it — it runs that version directly when it fires, regardless of what `release`/`beta` ' +
        'point at, and even while neither channel is published at all. Re-declaring the same id in a ' +
        'later registration moves the binding forward to that version; omitting it from a later ' +
        'version leaves the binding on the older version that still lists it (the "omission does not ' +
        'release" rule above). A trigger `workflow_deregister` releases is also DISABLED — a schedule ' +
        'needs `schedule_setEnabled({id, enabled:true})` after it is re-claimed to fire again; a ' +
        'disabled webhook has no re-enable call and answers every delivery `403 {code:TRIGGER_DISABLED}` ' +
        'until it is deleted and a new one is created.',
    ),
  );

  parts.push(
    section(
      'Authoring rules this engine enforces (refused with this code)',
      authoringErrorRows(),
    ),
  );

  parts.push(
    section(
      'Provisioning skills and MCP servers: roles, config shapes, and the trust boundary',
      // Issue #105 (q1-q6, owner decision): before this section the engine had NO documentation
      // anywhere a cold client could read about the MCP config shapes, the secret-handle grammar,
      // WHY stdio is admin-only, or which role can push what — an author found out by trial and
      // error (issue #105's own reproduction table). This section is the answer.
      'The role/scope/transport matrix (`author` = owns the target workflow; `admin` bypasses ' +
        'ownership):\n\n' +
        roleAssetMatrixRows() +
        '\n\n' +
        // Owner decision 2026-09-30 (verify-i MEDIUM-1): `user` is the lowest TOOL role, not the
        // floor for a signed-in account.
        'With authentication enabled, an account that has signed in but has no role in the engine\'s ' +
        'principals config (and no role granted at runtime) is `none` = pending approval: EVERY tool ' +
        'answers `ACCOUNT_PENDING_APPROVAL` until an admin grants user/author/admin with ' +
        '`principal_set_role` (or the dashboard admin page).\n\n' +
        // Q2: the skill exec flag (workspace_push's own schema documents the mechanics; this is
        // the "when" a script author actually needs).
        '**Skill files and the `exec` flag.** `workspace_push({kind:\'skill\', files:[{path, ' +
        "contentB64, exec?}]})` materializes each file 0o755 (`exec:true`) or 0o644 (absent/false) " +
        '— identical in shape and meaning to a `seedManifest` entry\'s `{path, sha256, exec?}`. Set ' +
        'it on a script with a shebang or a compiled CLI (an ELF binary, not a text script) that the ' +
        "agent should be able to run directly; never on the skill's own top-level `SKILL.md` " +
        '(refused `INVALID_ARGUMENT` — it is the manifest, never executed). The dispatched agent ' +
        'always runs inside its Bash sandbox either way: without `exec` a shebang script still runs ' +
        'via `sh <path>` or `python3 <path>`, but a compiled binary cannot run at all without it. ' +
        'Legacy skills pushed before this flag existed carry no mode information — they stay at ' +
        'whatever mode the original write happened to give them (umask-dependent, never made ' +
        'executable by this) — push again with `exec:true` to change that.\n\n' +
        // Q3: no kind:'tool', ship it in a skill or a seed, never install at run time. Posture-
        // dependent claim (advisor review): "cannot install at run time" is only unconditionally
        // true when this deployment measures confined — say so, matching readonlyBashBody's own
        // framing elsewhere in this guide, rather than a categorical "never".
        '**Shipping a CLI.** There is no separate `kind:\'tool\'` asset — the two supported paths are ' +
        'a skill file with `exec:true` (above, `author`/`admin` only, and only into a workflow you ' +
        'own) or a `run_start`/version-default `seedManifest` entry with `exec:true` (see "Seeding a ' +
        'workspace" above — the CAS blob push and `run_start` behind that path are both `user`-level, ' +
        'no ownership required). Installing a package or tool AT RUN TIME (`npm install`, `pip ' +
        'install`, a fetched binary, …) is not a supported path on this engine: on a `confined` ' +
        'deployment the sandbox blocks egress and confines writes to the run workspace (see "Host ' +
        'path grants" above for this deployment\'s measured posture), so it genuinely cannot work; ' +
        'ship the binary bytes with the push instead regardless of posture.\n\n' +
        // Q1: config shapes, secret handles, the probe, and the trust boundary reasoning.
        '**MCP config shapes.** `workspace_push({kind:\'mcp\', name, config})` accepts exactly two ' +
        'server-runnable shapes — `stdio` requires `command` to be EXACTLY `"npx"` (any other ' +
        'command, including a direct binary path or `node -e ...`, does not classify as a supported ' +
        'transport). Anything else — the exact two shapes below are the only ones — is refused ' +
        '`UNSUPPORTED_TRANSPORT` inside `MCP_PROBE_FAILED`\'s `detail.code` before any probe:\n\n' +
        '```json\n' +
        '{ "type": "http", "url": "https://example.com/mcp" }\n' +
        '{ "type": "stdio", "command": "npx", "args": ["-y", "@some/mcp-server"] }\n' +
        '```\n\n' +
        'A `${secret:NAME}` placeholder may appear anywhere inside `config` — in any string value, ' +
        'at any depth of a nested object or array — and is resolved from `RWE_SECRET_<NAME>` in the ' +
        "engine's OWN environment (operator-provisioned, e.g. `~/.config/rwe.env`), never sent to " +
        'any sandbox and never visible to an agent. Resolution is atomic and happens at DISPATCH ' +
        'time (a run actually declaring that MCP name), not at push time: every handle in the config ' +
        'must resolve or that `agent()` call fails, its failure detail carrying `SECRET_MISSING: ...` ' +
        '(a handle naming no such secret) or `SECRET_HANDLE_INVALID: ...` (malformed ' +
        '`${secret:...}` grammar) — never a partial substitution, never the literal placeholder ' +
        'smuggled through as a value.\n\n' +
        '**The push-time probe.** Before a `kind:\'mcp\'` push is accepted, the engine runs a ' +
        "lightweight reachability check ONCE, IN THE ENGINE'S OWN PROCESS: a `type:'http'` config " +
        'gets a short HTTP HEAD request; a `type:\'stdio\'` config SPAWNS the configured command ' +
        "directly on the engine host to confirm it launches. Since only `command:'npx'` is accepted, " +
        "this means the package download happens for real, right then, into the ENGINE USER's own " +
        '`~/.npm` cache — using whatever network access that user has, not the sandboxed egress a ' +
        "dispatched agent gets. A failed probe is refused `MCP_PROBE_FAILED`, whose `detail` carries " +
        'the underlying probe code/message/transport (`UNSUPPORTED_TRANSPORT`, `UNREACHABLE`, ' +
        '`PROBE_FAILED`, …); nothing is stored either way until the probe succeeds.\n\n' +
        '**Why `stdio` is admin-only.** A pushed `stdio` MCP server is not run inside the per-agent ' +
        "Bash sandbox at all — it runs as an ordinary child process of the ENGINE ITSELF, with the " +
        "engine user's full filesystem and network access (in principle, it can read the engine's " +
        'own secrets and data — the same trust tier as the engine process, not a dispatched agent). ' +
        "It is also not gated by `mcpEgressAllowlist` at all (that list only inspects a config's " +
        "`url` field, which a `stdio` config never carries). Pushing one is handing it host-level " +
        'trust, which is why every role below `admin` is refused `FORBIDDEN_ROLE` before any probe ' +
        "ever runs — this is intentional, not a gap to work around. `type:'http'` stays " +
        "author-reachable because it IS gated — `mcpEgressAllowlist` (an `rwe.config.json` key: an " +
        'https-only URL-prefix allowlist, the same fail-closed convention as `seedRefAllowlist`; ' +
        'omitted or empty denies EVERY `http` MCP config with `EGRESS_DENIED`, checked BEFORE the ' +
        'probe, zero probe attempts) is an operator decision an author cannot widen — but you can ' +
        'SEE it before pushing: `system_info`\'s `policy.mcpEgressAllowlist` (owner decision ' +
        '2026-09-30) reports this deployment\'s effective list to any authenticated caller, and an ' +
        '`EGRESS_DENIED` refusal from `workspace_push({kind:\'mcp\'})` points back at that same ' +
        'field.\n\n' +
        // issue #126: a stdio MCP server's own persisted state (not the engine's secrets/data
        // covered above — its OWN files) is shared host-wide unless the config opts into a
        // per-run private directory via ${run:dir}/${run:id}.
        '**A `stdio` server\'s own state is shared across EVERY run and principal that declares it, ' +
        'unless you ask for it to be kept per-run.** The trust-tier point above is about what the ' +
        'server CAN reach; this is about what it actually keeps. A `stdio` server runs as one ' +
        "ordinary engine-host process per agent session — not a fresh process per run — so any " +
        "state it persists OUTSIDE its own process (a file under its default location in the " +
        "engine user's HOME, its `npx` package cache, an absolute path baked into its own " +
        'defaults) is a single host-global store every run of every principal that declares the ' +
        'SAME server name reads and writes. `@modelcontextprotocol/server-memory`, for example, ' +
        'defaults to a JSONL file inside its own npx package directory — two unrelated runs ' +
        'started minutes apart by two different principals, each creating entities under what ' +
        'they each believe is THEIR OWN graph, actually read and write the exact same file. ' +
        "Nothing in the run sandbox catches this (the workspace, `/tmp`, and materialized skills " +
        'are each correctly kept separate per run — this is the one channel that is not, because ' +
        "the server itself runs outside that sandbox, per the trust-tier paragraph above).\n\n" +
        '`config`\'s `env` values and `args` items may reference two per-run placeholders, resolved ' +
        'at DISPATCH time (same timing as `${secret:NAME}`, and stored unresolved, same as it): ' +
        '`${run:dir}` (an empty, private directory this engine creates 0700 the first time THIS ' +
        'run uses it — `<workflowFolder>/mcp-state/<runId>/<serverName>/`, never inside the ' +
        'pulled run workspace, so it is NOT reachable via `workspace_pull`/`workspace_list`) and ' +
        '`${run:id}` (this run\'s id, as a plain string). The SAME run\'s agents that declare the ' +
        'same server share the SAME `${run:dir}` (sequential `agent()` calls can hand off through ' +
        "it); a DIFFERENT run — even of the same workflow, even started by the same principal — " +
        "never sees it, and it is deleted when the run's own workspace is (the engine's existing " +
        'workspace retention/GC policy, unchanged — see DEPLOY.md). Any OTHER `${run:xxx}` name is ' +
        'refused `UNKNOWN_RUN_PLACEHOLDER` at push time, before the probe ever runs, so a typo is ' +
        'caught immediately rather than surfacing as a confusing launch failure on a run\'s first ' +
        'dispatch. Example — the server-memory server above, made per-run instead of host-global:\n\n' +
        '```json\n' +
        '{\n' +
        '  "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"],\n' +
        '  "env": { "MEMORY_FILE_PATH": "${run:dir}/memory.jsonl" }\n' +
        '}\n' +
        '```\n\n' +
        'A server with no state of its own (nothing written outside the one request/response it is ' +
        'handling) needs neither placeholder — most servers are this shape, and `${run:dir}` costs ' +
        'nothing for them to skip. When in doubt, prefer a stateless server, or point whatever state ' +
        'it keeps at `${run:dir}`.\n\n' +
        // Q5: global-scope visibility is declaration-gated, not automatic.
        '**Global assets are opt-in per script, not automatic.** An admin-pushed `scope:\'global\'` ' +
        "skill or MCP server is usable by every principal's runs, but ONLY when that run's OWN " +
        'script declares the name (`meta.params.agents.<label>.skills`/`.mcp`) — existing at global ' +
        "scope never auto-grants it to an agent that doesn't ask for it, and a declared-but-absent " +
        'name (workflow-scoped or global, checked in that order) is refused `SKILL_NOT_PROVISIONED`/' +
        '`MCP_NOT_PROVISIONED` at admission, not registration. ' +
        // issue #109: the one-line pointer to the discovery tool — global assets are opt-in by
        // exact name, so finding that name is the first step; this is where it's discoverable.
        "Don't know the exact name? `workspace_list({scope:'global', kind:'skill'|'mcp'})` lists " +
        "every global asset of that kind — name plus (skill) its SKILL.md description or (mcp) its " +
        'transport type, nothing more. Add `includeBody:true` (skills only) to also read the FULL ' +
        'SKILL.md text — its instructions and any dependency it names (e.g. "requires MCP X") — ' +
        `BEFORE you declare/register against it (capped at ${GLOBAL_SKILL_BODY_MAX_BYTES / 1024} ` +
        "KiB, `bodyTruncated:true` past the cap; refused `INVALID_ARGUMENT` outside " +
        "`{scope:'global', kind:'skill'}`). That text is " +
        'visible to every approved principal this way, same as the description already is — an ' +
        "admin pushing a global skill must never put a secret in its SKILL.md.",
    ),
  );

  parts.push(
    section(
      'Provisioning: warned at registration, refused at admission',
      'Registering a script whose agent() declares an mcp/skill name with no `workspace_push`-' +
        'provisioned asset SUCCEEDS anyway (the version registers, with a `result.warnings` entry ' +
        "naming the label and the missing name(s)) — it is `run_start` (and a schedule/webhook " +
        'firing, and a nested `workflow()` call) that REFUSES, before any side effect, once the ' +
        'name is still unprovisioned at admission time:\n\n' +
        admissionOnlyErrorRows(),
    ),
  );

  parts.push(
    section(
      'Authoring convention (not checked)',
      // v24 (integrator, REQ-106 — found by the Batch-B executor): the builder rendered three of
      // REQ-106's four rules and silently dropped the second, so the generated AUTHORING.md taught
      // three quarters of the contract. It is an authoring SMELL, deliberately not enforced
      // (REQ-106's own last clause), which is exactly why it belongs in this section and why
      // nothing else in the engine would ever have caught its absence.
      'Declare every knob a user might need in `meta.params` rather than hard-coding it, and ' +
        'never read a value the contract does not declare: a value the script reaches for but the ' +
        'contract never named cannot be tuned by a caller, cannot be shown by `workflow_describe`, ' +
        'and cannot be bounded by the engine ceilings. Nothing refuses it — the cost is simply that ' +
        'the workflow can only be changed by editing it.\n\n' +
        // v24 (integrator): "the generated diagram" named a generator that no longer exists — v23/v24
      // retired the analyzer that drew one (ARCH-101), and the diagram is now the AUTHOR's own
      // `mermaid`, served verbatim by `workflow_describe`. The disclosure is unchanged and if
      // anything wider: the author's diagram is public too.
      "Phase titles (`phase(title)` and `meta.phases[].title`) are visible to every principal who can " +
        "see the workflow, including the non-owner projection and your own `mermaid` diagram, which " +
        "`workflow_describe` serves verbatim to any caller — a phase " +
        'title is not a private annotation, so keep secrets and distinctive internal prose out of it. ' +
        "The diagram you draw is structure-only: it is your responsibility, not an enforced check, to " +
        "keep secrets out of node text and labels.",
    ),
  );

  parts.push(
    section(
      'Registered examples',
      exampleRows(GUIDE_EXAMPLES),
    ),
  );

  // Send-back L8 (spec §Docs): a cold MCP-only consumer reading ONLY this guide (never DEPLOY.md)
  // had no way to learn that non-interactive access exists at all — service_account_create's own
  // description covers the admin-tool side, but nothing here covered the OTHER end: how a program
  // actually connects. Kept short on purpose; DEPLOY.md's own "服務帳號" section has the full
  // worked example (curl, a complete headersHelper script, rotation procedure).
  parts.push(
    section(
      'Service accounts (non-interactive access)',
      'A program, CI job, or bot connects without a human login via a SERVICE ACCOUNT — an admin creates one with `service_account_create` (role `author`/`user`, never `admin`; an optional `workflows` allowlist). ' +
        'It authenticates with `POST /token` (RFC 6749 §4.4 `client_credentials`), client id `sa:<name>`, client secret the `clientSecret` shown ONCE at create/rotate:\n\n' +
        '```bash\n' +
        'curl -s https://<host>/token -d grant_type=client_credentials \\\n' +
        '  -d client_id=sa:ci-bot -d client_secret=rwe_sa_...\n' +
        '# => {"access_token":"...","token_type":"Bearer","expires_in":3600}  (no refresh_token)\n' +
        '```\n\n' +
        'The `access_token` is a normal engine bearer — `Authorization: Bearer <token>` on `/mcp`, same as a human session. ' +
        'To connect Claude Code non-interactively, configure the rwe MCP server with a `headersHelper` script that performs this exchange (caching until near expiry) and prints the header as a JSON OBJECT — `{"Authorization":"Bearer <token>"}` — NOT a raw `Header: value` text line; the bundled CLI `JSON.parse`s the script\'s stdout. ' +
        'Full worked example (the complete script, `claude mcp add-json`/`--mcp-config --strict-mcp-config` usage, rotation procedure, least-privilege allowlist guidance): see DEPLOY.md\'s "服務帳號 (Service accounts)" section.',
    ),
  );

  return parts.join('\n\n') + '\n';
}
