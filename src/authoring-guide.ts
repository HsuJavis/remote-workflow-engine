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
// v26 (DES-187, ARCH-121, TASK-193, ADR-041): the provider capability table, read from the same
// data resolveAlias/validateAliases check against.
import { PROVIDER_CAPS, PROVIDERS } from './providers.js';

export interface GuideCeilings {
  maxTimeoutMs: number;
  maxAppendPromptBytes: number;
  maxEffort: Effort;
  /** v24 Gate 7.5 (D-12, REQ-117): the model-alias names THIS deployment accepts, from the same
   *  resolved alias table the registration validator checks `model.default` against (server.ts's
   *  `aliasNames`). An empty array means the deployment configured none, in which case the
   *  validator accepts any string — the guide says so rather than printing an empty list. */
  aliases: readonly string[];
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
}

export interface GuideExample {
  title: string;
  script: string;
  mermaid: string;
  expectRegister: 'ok';
}

// One agent contract block, reused verbatim by every example below (DES-144: model/effort/
// timeoutMs are all REQUIRED with a `.default`). `model` is always the 'default' alias — no
// example ever hard-codes a vendor model name, so the guide never goes stale when the operator's
// alias table changes (tests/unit/authoring-guide.test.ts: "no model alias literal").
function agentSpec(effort: 'low' | 'medium' | 'high', timeoutMs: number): string {
  return `{ model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: '${effort}' }, timeoutMs: { type: 'number', default: ${timeoutMs} } }`;
}

/** v26 (DES-185, ARCH-119, TASK-190): a v2-conformant stadium (agent) node —
 *  `id(["label<br/>model · effort · timeoutMs<br/>tools: …"])`. The middle segment must literally
 *  equal the agent's resolved `model.default`/`effort.default`/`timeoutMs.default` (checkMermaid's
 *  existing v1 value-triple check, step 7). `tools` is the sorted, comma-space `allowedTools`
 *  array, `'none'` for `[]`, or `'default'` when the call carries no `allowedTools` key — ARCH-119
 *  rule (12) skips comparing the 'default' case entirely, so the exact text there is never
 *  checked, but writing it out keeps every example visually consistent. */
function stadiumNode(id: string, label: string, effort: string, timeoutMs: number, tools: 'default' | 'none' | string[]): string {
  const toolsText = tools === 'default' ? 'tools: default' : tools === 'none' ? 'tools: none' : `tools: ${[...tools].sort().join(', ')}`;
  return `${id}(["${label}<br/>default · ${effort} · ${timeoutMs}<br/>${toolsText}"])`;
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
      `  description: 'The phase title is computed from a declared arg — a static scan cannot know it in advance',\n` +
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
      `  params: { agents: { coder: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 120000 }, skills: ['repo-search'], mcp: ['project-tracker'] } } },\n` +
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
  "an ordinary `EACCES` inside the agent's own tool result, not as an engine refusal — a " +
  'script that shells out to a global cache sees a failed command, not a special error your ' +
  'script can branch on.\n\n' +
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
  '`schedule_list`\'s `lastError`) all return `CONFINEMENT_UNAVAILABLE` instead of admitting ' +
  'Bash-capable work — this is a rule about every admission route this posture gates, not a ' +
  'fixed list of tool names.';

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

/** The `see: 'workflow_authoring_guide'` slice of ERROR_CATALOG, rendered from the SAME table
 *  server.ts's error envelope reads (`toErrEnvelope`) — never a second hand-typed list. */
function authoringErrorRows(): string {
  return Object.entries(ERROR_CATALOG)
    .filter(([, v]) => v.see === 'workflow_authoring_guide')
    .map(([code, v]) => `- \`${code}\` — ${v.hint}`)
    .join('\n');
}

function exampleRows(): string {
  return GUIDE_EXAMPLES.map(
    (ex) =>
      `### ${ex.title}\n\n\`\`\`js\n${ex.script}\n\`\`\`\n\nMermaid:\n\n\`\`\`\n${ex.mermaid}\n\`\`\``,
  ).join('\n\n');
}

/** v24 Gate 7.5 (D-12): the alias sentence, over the deployment's own resolved alias names. */
function aliasSentence(aliases: readonly string[]): string {
  if (aliases.length === 0) {
    return 'This deployment configures no model-alias table, so any string is accepted as a ' +
      '`model.default` and resolution happens at dispatch time.';
  }
  return 'A declared `model.default` (and every entry of a declared `model.enum`) must be one of ' +
    `this deployment's model ALIAS names — ${aliases.map((a) => `\`${a}\``).join(', ')} — not a ` +
    'provider model id. `models_list` shows the catalog MODELS an alias may resolve to; it is not ' +
    'the alias table, and passing an id from it is refused `PARAM_CONTRACT_INVALID: default not a ' +
    'known alias`. Each catalog row does carry an `aliases` list — every configured name that ' +
    'resolves to that one model — so a row is where you LOOK UP a legal name, and the row itself ' +
    'is never the answer. An `agent()` call naming an unknown alias is refused `UNKNOWN_ALIAS`. (The one ' +
    'exception is an `openrouter/<model-id>` passthrough, which the validator accepts by prefix ' +
    'and needs no entry in the table above.)';
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
 *  table `resolveAlias`/`validateAliases` check against. */
function providerCapsRows(): string {
  return PROVIDERS.map((p) => {
    const caps = PROVIDER_CAPS[p];
    // v26 Gate 7.5 round 1 (REQ-126, VAL-186): rendered from `effortDelivered`, the OBSERVED fact,
    // not from `effort !== null`, which only says the provider has a dial. openrouter has one and the
    // dispatch path never delivers it; a manual that says otherwise sends authors chasing a no-op.
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
        `is reachable (\`${SANDBOX_GLOBALS.join('\`, \`')}\`; \`Date\`/\`Math\` are GUARDED, see below):\n\n` +
        "- `await agent(label, options)` — dispatches one agent call. `label` MUST be a literal string " +
        'identifier (`/^[A-Za-z_][\\w-]*$/`) matching a `meta.params.agents.<label>` declaration; ' +
        '`options` MUST be a literal object (no variable, no spread).\n' +
        '- `await parallel([thunk, ...])` — runs an array of zero-argument thunks concurrently, each ' +
        'returning `null` on its own thrown error rather than rejecting the whole call.\n' +
        '- `await pipeline([item, ...], stage1, stage2, ...)` — runs each item through the stage chain.\n' +
        "- `phase(title)` — names the current step for observability. Titles are public (see below).\n" +
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
        "sub-workflow's card, not folded into the parent run as one of its lanes.\n\n" +
        '`Date` and `Math` are present but GUARDED — three calls are refused `DETERMINISM_GUARD` ' +
        "because resume replays agent() calls keyed by prompt+opts, so a wall-clock or random value " +
        'baked into that key would change it on replay and re-dispatch an already-paid call:\n\n' +
        determinismGuardRows() +
        '\n\nThis is documented as HYGIENE, not a security boundary — `node:vm` is not a sandbox, and ' +
        'the real containment is the per-run child PROCESS, which holds no secrets/store/network ' +
        'handle, not these two guarded globals. `setTimeout`, `fetch`, `console`, `require`, ' +
        '`process`, and `fs` are simply absent from the context, not merely shadowed.',
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
        '`export default async function () { … }`, a `function` wrapper of any kind, and any ' +
        'top-level `import` are refused `PARSE_ERROR` (which names the line and the construct). ' +
        '`export const meta = {…}` is the ONE exception, and it must be written exactly that way, ' +
        'as a literal object: dropping the `export` makes the whole declaration invisible to the ' +
        'engine, and every `agent()` label is then refused `AGENT_UNDECLARED`.\n\n' +
        'Every `agent(label, ...)` call in the script needs a matching `meta.params.agents.<label>` ' +
        'declaration — `model`, `effort`, and `timeoutMs` are all required, each with a `.default` (v24: ' +
        'there is no implicit engine default per agent). `appendPrompt`, `skills`, and `mcp` are optional. ' +
        'A working example:\n\n' +
        '```js\n' +
        'export const meta = {\n' +
        "  description: 'Summarize the given topic in one paragraph',\n" +
        '  params: {\n' +
        '    agents: {\n' +
        "      writer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },\n" +
        '    },\n' +
        '  },\n' +
        '};\n' +
        '```\n\n' +
        // issues #81/#83: nothing said how a declared skill is activated, and the only example
        // paired one with file tools — authors could not tell a skill never reached the model.
        '**Skills.** `skills: [name, ...]` names skills pushed with `workspace_push` (`kind: \'skill\'`). ' +
        'The model activates a declared skill through the Skill tool, which the engine adds to that ' +
        "agent's tool surface for you — do not list `Skill` in `allowedTools`. Declaring a skill grants " +
        'no file tools, and none are needed to reach it: an agent with `allowedTools: []` and a declared ' +
        "skill can still activate it. Only the agent's own declared skills can be activated (other " +
        "skills are hidden from it), and a skill's inline shell command (the `!` prefix form) is not executed. In " +
        "`run_agent_log`, `harness.skillsExposed` lists the skills the model could activate; " +
        '`harness.materialized` only records which files were copied into the workspace.\n\n' +
        '`meta.params.args` declares the run-time inputs the script reads off `args.<name>` — `{type, ' +
        'enum?, min?, max?, default?}`. A declared `.default` fills in the key when the caller omits ' +
        "it (or a run_start call omits `args` entirely); an explicit caller-supplied value always " +
        "wins, including an explicit `undefined`. `type` is one of `string | number | enum` (an " +
        '`enum` type requires the `enum` array of legal values).\n\n' +
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
        "`['Read', 'Grep', 'Glob']`, with no `Bash`.\n\n" +
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
      // No GUIDE_EXAMPLES entry either way (an EACCES happens inside a tool result the workflow
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
      `The six locked keys are engine-owned and can never be overridden by a caller: ` +
        `${LOCKED_KEYS.join(', ')}. The four tunable keys an override may target, per declared agent ` +
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
        `'${ceilings.maxEffort}'. A declaration above any of these ceilings is refused ` +
        '`PARAM_OUT_OF_RANGE` at registration — never silently clamped.\n\n' +
        // v24 Gate 7.5 (D-12, REQ-117): the alias names, from the SAME resolved table the
        // registration validator checks against. The cold subject's first registration was refused
        // because it read a model id out of `models_list` (which lists catalog MODELS, not
        // aliases) — nothing on the surface named what belongs in `model.default`.
        aliasSentence(ceilings.aliases),
    ),
  );

  parts.push(
    section(
      'Providers and the model catalog',
      'Every model alias resolves to exactly one of three providers, each with its own declared ' +
        'capability row — read from the SAME table `resolveAlias`/`validateAliases` check against, ' +
        'labelled **declared, not probed**: nothing here is learned by dispatching a call.\n\n' +
        providerCapsRows() +
        '\n\nThere is no `openai` row: OpenRouter is the many-model front door for everything that is ' +
        "not Anthropic-direct or a local Ollama model, so swapping a model — or a transport — is a " +
        'config change to an alias, not a new provider.\n\n' +
        "`models_list` shows the CATALOG this deployment's aliases can resolve into — it is not the " +
        'alias table (see "Engine ceilings" above). It serves ONE row per model, and that row lists ' +
        'in `aliases` every configured name resolving to it (`ref` is the first — the one to pass to ' +
        '`agent({model})`), so a model named twice is one priced row, never a duplicate that reports ' +
        '`price:"unknown"`. Its `toolUseDeclared`/`effortDeclared` flags and ' +
        '`costLevel` rating are DECLARED capability, never probed by dispatching a call, and carry ' +
        "their own provenance: `declaredSource` ('upstream'|'static'|'unknown') says where the flag " +
        'came from, and `catalogFetchedAt` is per-row catalog provenance (a timestamp, or `null`).',
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
        'Past that they QUEUE and run as slots free: a wider fan-out is slower, never truncated.\n\n' +
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
        // the code rode on `name` and nothing set `code`. The realm caveat is stated rather than
        // fixed — see the DES entry: it is a property of `node:vm`, not of errors, and holds for
        // `args` too, so "fix it for errors" would teach a half-truth.
        'Branch on `e.code` — not on `e instanceof Error`. Your script runs in a `node:vm` context ' +
        'whose intrinsics are a different realm from the engine that raises these errors, so ' +
        '`instanceof` is **false** for anything the engine hands you: engine errors, and `args` and ' +
        'its contents alike (`args instanceof Object` is false; `Array.isArray(args.xs)` is true — ' +
        'realm-safe checks work). Errors you construct yourself inside the script are ordinary and ' +
        'unaffected. Every engine refusal carries the same `e.code`/`e.name` catalog code as ' +
        '`run_result.error.code`, plus a human `e.message`.',
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
        '3. **Tools — `TOOLS_MISMATCH`.** An agent node may carry a third `<br/>` segment naming its ' +
        'tool surface: `label<br/>model · effort · timeout<br/>tools: Edit, Read` — the names sorted, ' +
        'comma-space separated, exactly the literal `allowedTools` array on that `agent()` call, or ' +
        '`tools: none` when you passed `allowedTools: []`. If the call declares no `allowedTools` at ' +
        'all, the segment is NOT compared: write `tools: default` (the honest word for "whatever ' +
        'this deployment configures") or leave the segment off.\n' +
        '4. **Edges — `EDGE_MISMATCH`.** Consecutive calls in your script must be joined in the ' +
        'diagram, across lane boundaries too. A path may run through non-agent shapes (a diamond for ' +
        'a branch, an aggregation for a non-agent join), which is how you draw a ternary or an ' +
        '`if/else`. A direct agent→agent edge between calls that are NOT consecutive needs a ' +
        '`|label|` saying what it means. Members of one `parallel([...])` (or of the two arms of one ' +
        'branch) are never edged to each other — they fan in to whatever follows.\n\n' +
        'A script whose shape a static read cannot resolve at all — an `agent()` inside a `for`, ' +
        '`while` or `switch` body — makes that lane DYNAMIC: it predicts no slots, so rules 3 and 4 ' +
        'have nothing to compare there. Declare the agent\'s node inside that lane anyway; the ' +
        'label check (both ways) still applies.\n\n' +
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
          .properties.seedManifestRef?.description ?? ''),
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
        '`timeoutMs` bounds ONE attempt, never the whole call: this deployment retries a failed ' +
        'attempt, and the deployed retry count multiplies the single-attempt bound into the actual ' +
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
        'first declared them.',
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

  parts.push(section('Registered examples', exampleRows()));

  return parts.join('\n\n') + '\n';
}
