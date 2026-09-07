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

// v24 (ARCH-107, DES-157): the ten named patterns, each a real script + a real author-supplied
// Mermaid diagram, registered over a booted engine by tests/integration/guide-examples-register.
// test.ts — a guide that teaches an invalid example is worse than none (v23's own defect).
export const GUIDE_EXAMPLES: GuideExample[] = [
  {
    title: 'single agent',
    script:
      `export const meta = {\n` +
      `  description: 'Summarize the given topic in one paragraph',\n` +
      `  params: { agents: { writer: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `return await agent('writer', { prompt: 'Summarize the topic' });`,
    mermaid: `graph TD\nwriter(["writer"])`,
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
    mermaid: `graph TD\ndraft(["draft"])\nedit(["edit"])\nfinal(["final"])\ndraft-->edit\nedit-->final`,
    expectRegister: 'ok',
  },
  {
    title: 'fan-out/fan-in',
    script:
      `export const meta = {\n` +
      `  description: 'Fan out research to three topics in parallel, then combine the results',\n` +
      `  params: { agents: { researcher: ${agentSpec('low', 60000)}, combiner: ${agentSpec('medium', 90000)} } },\n` +
      `};\n` +
      `const topics = ['a', 'b', 'c'];\n` +
      `const results = await parallel(topics.map((t) => () => agent('researcher', { prompt: 'Research ' + t })));\n` +
      `return await agent('combiner', { prompt: 'Combine: ' + results.join(', ') });`,
    mermaid: `graph TD\nr1(["researcher"])\nr2(["researcher"])\nr3(["researcher"])\ncombiner(["combiner"])\nr1-->combiner\nr2-->combiner\nr3-->combiner`,
    expectRegister: 'ok',
  },
  {
    title: 'non-agent aggregation',
    script:
      `export const meta = {\n` +
      `  description: 'Score three candidates with an agent, then pick the best score without another agent call',\n` +
      `  params: { agents: { scorer: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `const items = ['x', 'y', 'z'];\n` +
      `const scores = await parallel(items.map((it) => () => agent('scorer', { prompt: 'Score ' + it })));\n` +
      `return scores.reduce((best, s) => (Number(s) > Number(best) ? s : best), scores[0]);`,
    // v24 adjudication #6 F-4: this drew the aggregation as a RECTANGLE `aggregate["…"]`, the shape
    // this same guide's SHAPES table reserves for the nested-workflow black box. `checkMermaid`
    // accepts either (both free text), so only a reader notices — and the only reader this guide
    // has is a cold model with no other documentation. `{{"…"}}` is the shape the table declares
    // for exactly this node, and it is what the example teaches now.
    mermaid: `graph TD\nscorer(["scorer"])\naggregate{{"pick the best score (no agent call)"}}\nscorer-->aggregate`,
    expectRegister: 'ok',
  },
  {
    title: 'conditional',
    script:
      `export const meta = {\n` +
      `  description: 'Classify the input, then branch to one of two agents',\n` +
      `  params: { agents: { classifier: ${agentSpec('low', 60000)}, simple: ${agentSpec('low', 60000)}, complex: ${agentSpec('high', 120000)} } },\n` +
      `};\n` +
      `const kind = await agent('classifier', { prompt: 'Classify the request' });\n` +
      `if (kind === 'simple') {\n` +
      `  return await agent('simple', { prompt: 'Handle the simple case' });\n` +
      `}\n` +
      `return await agent('complex', { prompt: 'Handle the complex case' });`,
    mermaid: `graph TD\nclassifier(["classifier"])\nsimple(["simple"])\ncomplex(["complex"])\nclassifier-->simple\nclassifier-->complex`,
    expectRegister: 'ok',
  },
  {
    title: 'labelled loop',
    script:
      `export const meta = {\n` +
      `  description: 'Draft and critique in a bounded loop until the critic approves',\n` +
      `  params: { agents: { writer: ${agentSpec('low', 60000)}, critic: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `let draft = await agent('writer', { prompt: 'Write a draft' });\n` +
      `for (let i = 0; i < 3; i++) {\n` +
      `  const verdict = await agent('critic', { prompt: 'Critique: ' + draft });\n` +
      `  if (verdict === 'approved') break;\n` +
      `  draft = await agent('writer', { prompt: 'Revise using: ' + verdict });\n` +
      `}\n` +
      `return draft;`,
    mermaid: `graph TD\nwriter(["writer"])\ncritic(["critic"])\nwriter-->|draft|critic\ncritic-->|revise|writer`,
    expectRegister: 'ok',
  },
  {
    title: 'debate subgraph',
    script:
      `export const meta = {\n` +
      `  description: "Two agents debate a proposition, each seeing the other's point",\n` +
      `  params: { agents: { proponent: ${agentSpec('medium', 90000)}, opponent: ${agentSpec('medium', 90000)} } },\n` +
      `};\n` +
      `const a = await agent('proponent', { prompt: 'Argue for the proposition' });\n` +
      `const b = await agent('opponent', { prompt: 'Argue against, given: ' + a });\n` +
      `return { a, b };`,
    mermaid: `graph TD\nsubgraph "debate"\nproponent(["proponent"])\nopponent(["opponent"])\nproponent<-->opponent\nend`,
    expectRegister: 'ok',
  },
  {
    title: 'nested workflow() black box',
    script:
      `export const meta = {\n` +
      `  description: 'Delegates to another registered workflow, then summarizes its result',\n` +
      `  params: { agents: { summarizer: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `const child = await workflow('other-team-etl', { since: 'yesterday' });\n` +
      `return await agent('summarizer', { prompt: 'Summarize: ' + JSON.stringify(child) });`,
    mermaid: `graph TD\netl["workflow: other-team-etl (black box)"]\nsummarizer(["summarizer"])\netl-->summarizer`,
    expectRegister: 'ok',
  },
  {
    title: 'declared args',
    script:
      `export const meta = {\n` +
      `  description: 'Uses a declared arg to steer the single agent call',\n` +
      `  params: { args: { topic: { type: 'string' } }, agents: { writer: ${agentSpec('low', 60000)} } },\n` +
      `};\n` +
      `return await agent('writer', { prompt: 'Write about: ' + args.topic });`,
    mermaid: `graph TD\nwriter(["writer"])`,
    expectRegister: 'ok',
  },
  {
    title: 'skills and mcp',
    script:
      `export const meta = {\n` +
      `  description: 'An agent declared with a skill name and an mcp server name',\n` +
      `  params: { agents: { coder: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 120000 }, skills: ['repo-search'], mcp: ['project-tracker'] } } },\n` +
      `};\n` +
      `return await agent('coder', { prompt: 'Fix the failing test' });`,
    mermaid: `graph TD\ncoder(["coder"])`,
    expectRegister: 'ok',
  },
];

function section(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
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
    'known alias`. An `agent()` call naming an unknown alias is refused `UNKNOWN_ALIAS`. (The one ' +
    'exception is an `openrouter/<model-id>` passthrough, which the validator accepts by prefix ' +
    'and needs no entry in the table above.)';
}

/** v24 Gate 7.5 (D-4): the node-shape table, rendered from `checkMermaid`'s own closed grammar. */
function shapeRows(): string {
  return SHAPES.map((s) => `- \`${s.open}…${s.close}\` (${s.name}) — ${s.role}`).join('\n');
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
        'is reachable (`agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`, `workflow`):\n\n' +
        "- `await agent(label, options)` — dispatches one agent call. `label` MUST be a literal string " +
        'identifier (`/^[A-Za-z_][\\w-]*$/`) matching a `meta.params.agents.<label>` declaration; ' +
        '`options` MUST be a literal object (no variable, no spread).\n' +
        '- `await parallel([thunk, ...])` — runs an array of zero-argument thunks concurrently, each ' +
        'returning `null` on its own thrown error rather than rejecting the whole call.\n' +
        '- `await pipeline([item, ...], stage1, stage2, ...)` — runs each item through the stage chain.\n' +
        "- `phase(title)` — names the current step for observability. Titles are public (see below).\n" +
        '- `log(...)` — a no-op placeholder in this sandbox (accepted, does nothing).\n' +
        '- `args` — the caller-supplied run arguments, shaped by `meta.params.args`.\n' +
        '- `budget` — `{total, spent(), remaining()}`, read-only.\n' +
        '- `await workflow(name, args)` — runs another registered workflow. A workflow() call may ' +
        "itself call workflow() again, recursing up to this deployment's configured `maxWorkflowDepth` " +
        '(cycle-checked, descendant-capped) — a call that exceeds the depth is refused ' +
        '`NESTING_DEPTH_EXCEEDED`, one that would re-enter an ancestor on ' +
        'its own chain is refused `NESTING_CYCLE`, and one that pushes the run past its descendant cap is ' +
        'refused `DESCENDANT_CAP_EXCEEDED`. (An earlier one-level cap with a flatten-it instruction is ' +
        "what an older draft of this guide taught — that no longer matches what's shipped.) Even with " +
        "depth available, the simplest and most readable script still flattens a needless wrapper into " +
        "its caller, and draws another owner's workflow as a black-box rectangle node in your diagram " +
        'rather than expanding it.',
    ),
  );

  parts.push(
    section(
      'Declaring the parameter contract',
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
        '`meta.params.args` declares the run-time inputs the script reads off `args.<name>` — `{type, ' +
        'enum?, min?, max?}`, no `.default` (a declared args default is refused: it is advertised but ' +
        'never applied).\n\n' +
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
        'Three layers set it, and the first one present wins: the per-call `allowedTools` above, then ' +
        "the `tools` field in an `agentType` definition's frontmatter (selected with the `agentType` " +
        'option), then this deployment\'s configured `defaultAllowedTools`. Only the first is settable ' +
        'from a script, and it is the only one of the three names that goes inside an `agent()` call.\n\n' +
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
      'Budget, concurrency, and how wide a fan-out really runs',
      // v25 (DES-168, REQ-120, issue #61): the limit an author had NO way to learn. The owner hit it
      // in production — a 3-wide parallel() silently ran 2 — and the guide said nothing about budget
      // interacting with fan-out width at all.
      `\`parallel([a, b, c, ...])\` dispatches every thunk, and this deployment runs up to ` +
        `**${ceilings.runConcurrency}** of them at a time (\`runConcurrency\`, operator-configurable). ` +
        'Past that they QUEUE and run as slots free: a wider fan-out is slower, never truncated.\n\n' +
        "`run_start`'s `budget` is a **stop-dispatching signal, not a hard ceiling**, and this is the " +
        'honest description of what the engine can enforce. Before each dispatch it asks one question: ' +
        'has this run already spent `budget` tokens? If yes, the call is refused ' +
        '`BUDGET_EXCEEDED`; if no, it goes. What a call will cost cannot be known before it finishes, ' +
        'so the calls already in flight when the budget runs out still complete — a run can therefore ' +
        `overshoot its budget by up to one concurrency window (${ceilings.runConcurrency} x one ` +
        'call\'s cost). Size the budget for the whole workflow, not per call; an omitted or `null` ' +
        '`budget` means unbounded.\n\n' +
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
        '```',
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

  parts.push(
    section(
      'Registration and versioning',
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
