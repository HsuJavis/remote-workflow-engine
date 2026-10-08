// UT-175 (DES-170, ARCH-110, TASK-175, v26): `tools/list`'s `run_start` schema describes all three
// seed shapes with real item schemas (today `seed`/`seedManifest` are bare `{type:'array'}` with no
// `items`, which is exactly how issue #64's `[{path, sha256}]` slipped past — a caller reading
// `tools/list` alone cannot tell `contentB64` is required). Written test-first (Gate 5, RED): the
// current schema carries no `items` key on `seed`/`seedManifest` and no `pattern` on
// `seedManifestRef`.
// Mock policy (unit): pure data assertion over TOOL_SPECS, no I/O.
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { TOOL_SPECS, projectToolsList } from '../../src/tool-specs.js';

function runStartSchema() {
  const spec = TOOL_SPECS.find((s) => s.name === 'run_start');
  if (!spec) throw new Error('run_start not found in TOOL_SPECS');
  return (spec.inputSchema as any).properties;
}

describe('run_start tools/list schema describes all three seed shapes (UT-175, DES-170)', () => {
  it('seed.items requires path and describes contentB64 as REQUIRED base64', () => {
    const props = runStartSchema();
    const items = props.seed?.items;
    expect(items).toBeDefined();
    expect(items.required).toContain('path');
    expect(items.properties?.contentB64?.description).toMatch(/base64/i);
  });

  it('seedManifest.items requires path and sha256 with a hex-64 pattern', () => {
    const props = runStartSchema();
    const items = props.seedManifest?.items;
    expect(items).toBeDefined();
    expect(items.required).toEqual(expect.arrayContaining(['path', 'sha256']));
    expect(items.properties?.sha256?.pattern).toBe('^[0-9a-f]{64}$');
  });

  it('seedManifest.items exec is an optional boolean', () => {
    const props = runStartSchema();
    const items = props.seedManifest?.items;
    expect(items.properties?.exec?.type).toBe('boolean');
  });

  it('seedManifestRef is a hex-64 string pattern', () => {
    const props = runStartSchema();
    expect(props.seedManifestRef?.type).toBe('string');
    expect(props.seedManifestRef?.pattern).toBe('^[0-9a-f]{64}$');
  });

  it('budget schema description says "seed elements carry bytes inline as contentB64" pointing seed-only callers at seedManifest', () => {
    const props = runStartSchema();
    expect(props.seed?.items?.properties?.contentB64?.description).toMatch(/seedManifest/);
  });
});

// UT-213 (v26 Gate 7.5 round 1, defect D1): every array-typed property ANYWHERE in TOOL_SPECS
// declares `items`. A bare `{type:'array'}` is not merely under-documented — Google/Gemini-family
// clients reject the WHOLE `tools/list` payload with
// `400 … function_declarations[0].parameters.properties[triggers].items: missing field`, so one
// missing key costs every tool on the surface for a whole client family (observed for real: the
// round-1 cold-model probe died before its first tool call). REQ-121/DES-170 closed this for
// `run_start.seed`; this walk is the drift-lock so the fifth site cannot be added in silence.
// The walk recurses through `properties`/`items`/`oneOf`/`anyOf`/`allOf` — `workspace_push`'s
// `files` lives inside a `oneOf` branch, which a flat top-level scan would miss.
// Mock policy (unit): pure data assertion over TOOL_SPECS, no I/O.
function arraysWithoutItems(node: unknown, path: string): string[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as Record<string, unknown>;
  const found: string[] = [];
  if (n['type'] === 'array' && n['items'] === undefined) found.push(path);
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const branches = n[key];
    if (Array.isArray(branches)) {
      branches.forEach((b, i) => found.push(...arraysWithoutItems(b, `${path}.${key}[${i}]`)));
    }
  }
  const props = n['properties'];
  if (props && typeof props === 'object') {
    for (const [name, sub] of Object.entries(props as Record<string, unknown>)) {
      found.push(...arraysWithoutItems(sub, `${path}.${name}`));
    }
  }
  if (n['items'] !== undefined) found.push(...arraysWithoutItems(n['items'], `${path}[]`));
  return found;
}

describe('every array-typed property in TOOL_SPECS declares items (UT-213, defect D1)', () => {
  it('no tool advertises a bare {type:"array"} on any input schema, at any depth', () => {
    const offenders = TOOL_SPECS.flatMap((s) => arraysWithoutItems(s.inputSchema, s.name));
    expect(offenders).toEqual([]);
  });

  it('the four named round-1 sites each carry an items schema', () => {
    const props = (name: string) =>
      (TOOL_SPECS.find((s) => s.name === name)!.inputSchema as any).properties;
    expect(props('workflow_register').triggers.items.type).toBe('string');
    expect(props('workspace_diff').manifest.items.required).toEqual(expect.arrayContaining(['sha256']));
    expect(props('workspace_delete').paths.items.type).toBe('string');
    const pushModeB = (TOOL_SPECS.find((s) => s.name === 'workspace_push')!.inputSchema as any).oneOf[1];
    expect(pushModeB.properties.files.items.required).toEqual(expect.arrayContaining(['path', 'contentB64']));
  });
});

// Issue #92 part B: `kind`/`scope` on workspace_delete/workspace_push used to be bare `{type:
// 'string'}`, so `kind:'nonsense'` passed ajv and only failed deep inside the handler (or, for
// workspace_delete specifically, did not fail at all — see val-009's live test). An enum of the
// actually-supported `AssetKind`/`AssetScope` values makes ajv answer INVALID_ARGUMENT itself,
// before any handler runs — the schema is the only doc a cold MCP client reads.
describe('workspace_delete/workspace_push kind and scope are closed enums, not bare strings (issue #92 part B)', () => {
  it('workspace_delete.kind and .scope are enums of the real AssetKind/AssetScope values', () => {
    const props = (TOOL_SPECS.find((s) => s.name === 'workspace_delete')!.inputSchema as any).properties;
    expect(props.kind.enum).toEqual(['skill', 'mcp']);
    expect(props.scope.enum).toEqual(['workflow', 'global']);
    // runId/paths mode is untouched — neither key required, so {runId, paths} still validates.
    expect((TOOL_SPECS.find((s) => s.name === 'workspace_delete')!.inputSchema as any).required ?? []).toEqual([]);
  });

  it('workspace_push mode-B (asset) .kind and .scope are the same closed enums', () => {
    const pushModeB = (TOOL_SPECS.find((s) => s.name === 'workspace_push')!.inputSchema as any).oneOf[1];
    expect(pushModeB.properties.kind.enum).toEqual(['skill', 'mcp']);
    expect(pushModeB.properties.scope.enum).toEqual(['workflow', 'global']);
  });

  // Issue #92 part B/C follow-up: workspace_list.kind was the one sibling still left as a bare
  // string — a junk kind reached the handler and answered an empty list rather than
  // INVALID_ARGUMENT (workspace_list has no `scope` argument at all, so only `kind` applies here).
  it('workspace_list.kind is the same closed enum', () => {
    const props = (TOOL_SPECS.find((s) => s.name === 'workspace_list')!.inputSchema as any).properties;
    expect(props.kind.enum).toEqual(['skill', 'mcp']);
  });
});

// UT-266 (v33, REQ-201, TASK-227, DES-222, ARCH-087/091): two SERVED descriptions must teach the
// version loop, because ARCH-087's own rule is "the description text *is* the API" — a cold client
// registered four names in 45 minutes and published every one to `release` within seconds because
// nothing on the tool surface said re-registering a name STACKS a version, and `run_start`'s row
// taught `workflow_publish` first with `{version}` as the fallback (the opposite of the loop a
// just-registered author actually wants). Written test-first (Gate 5, RED): today
// `workflow_register`'s description is "Register a new workflow version under a name; the caller
// becomes its owner." (no "append"/"overwrite" wording) and `run_start`'s description has
// `workflow_publish` BEFORE `{version}` — confirmed by reading src/tool-specs.ts:216,395.
// Mock policy (unit): pure data assertion over projectToolsList()'s SERVED projection, no I/O.
describe('workflow_register/run_start descriptions teach the version loop (UT-266, DES-222, REQ-201)', () => {
  const desc = (name: string) => projectToolsList().find((t) => t.name === name)!.description;

  it('workflow_register states that registering the SAME name appends a version and overwrites nothing', () => {
    // Loose on phrasing deliberately: DES-222 (2) says "registering the SAME name appends a NEW
    // version… overwrites nothing" (no "re-"); ARCH-087/TASK-227 say "re-registering". Pinning the
    // "re-" prefix would fail an implementation that follows DES-222's own wording verbatim.
    const text = desc('workflow_register');
    expect(text).toMatch(/same name/i);
    expect(text).toMatch(/append/i);
    expect(text).toMatch(/overwrite/i);
  });

  it('the derived "See also: workflow_authoring_guide" pointer survives the rewrite (regression guard, not re-typed)', () => {
    expect(desc('workflow_register')).toContain('workflow_authoring_guide');
  });

  it('run_start mentions {version} at a LOWER index than workflow_publish (order, not presence — today both are present in the wrong order)', () => {
    const text = desc('run_start');
    const versionIdx = text.indexOf('{version}');
    const publishIdx = text.indexOf('workflow_publish');
    expect(versionIdx).toBeGreaterThanOrEqual(0);
    expect(publishIdx).toBeGreaterThanOrEqual(0);
    expect(versionIdx).toBeLessThan(publishIdx);
  });

  it('run_start still carries the no-result trap sentence (regression guard)', () => {
    const text = desc('run_start');
    expect(text).toMatch(/returns no result/i);
    expect(text).toMatch(/run_status/);
    expect(text).toMatch(/run_result/);
  });
});

// UT-275 (DES-229, ARCH-087, ADR-032, TASK-230, REQ-202/REQ-203): `run_start.overrides`' advertised
// description states the three appendPrompt rules a COLD client needs BEFORE its first call, and
// `run_agent_log`'s harness sentence stops advertising a mechanism that no longer exists.
//
// Red reason: `overrides`'s description today says only "{agents: {'<label>': {model?, effort?,
// timeoutMs?, appendPrompt?}}}. There are no workflow-wide override fields… LOCKED_KEYS are
// author-locked" — none of the three appendPrompt rules (declare-or-PARAM_UNKNOWN, untrusted
// framing, byte ceiling + no frame-close) are present. `run_agent_log`'s description still says
// "An agentType's system prompt is never in harness.prompt; harness.systemPrompt:{agentType,bytes}
// records only that one was applied" — the sentence TASK-230 rewrites.
describe('tools/list advertises the v34 appendPrompt rules and the two-segment harness truth (DES-229, UT-275)', () => {
  function overridesDescription(): string {
    const projected = projectToolsList().find((t) => t.name === 'run_start')!;
    const props = (projected.inputSchema as { properties?: Record<string, { description?: string }> }).properties;
    return props?.['overrides']?.description ?? '';
  }

  it('states the key must be declared in meta.params.agents.<label> or the call is refused PARAM_UNKNOWN', () => {
    const text = overridesDescription();
    expect(text).toMatch(/meta\.params\.agents/);
    expect(text).toMatch(/PARAM_UNKNOWN/);
  });

  it('states appendPrompt is wrapped in <user-instructions untrusted="true"> and the model is told it is untrusted', () => {
    const text = overridesDescription();
    expect(text).toContain('<user-instructions untrusted="true">');
    expect(text).toMatch(/untrusted/i);
  });

  it('states the effective bound is min(author, maxAppendPromptBytes) in BYTES and the frame-close delimiter is refused', () => {
    const text = overridesDescription();
    expect(text).toMatch(/maxAppendPromptBytes/);
    expect(text).toMatch(/bytes?/i);
    expect(text).toMatch(/PARAM_OUT_OF_RANGE|frame.?close/i);
  });

  it('run_agent_log no longer advertises the retired agentType/systemPrompt harness sentence', () => {
    const text = projectToolsList().find((t) => t.name === 'run_agent_log')!.description;
    expect(text).not.toContain('agentType');
    expect(text).not.toContain('systemPrompt');
  });
});

// v35 (DES-239, ARCH-152/154, TASK-237, REQ-210): `ENVELOPE_NOTE` — ONE exported constant, stating
// the double-JSON envelope, consumed by BOTH the `initialize` handshake and (transitively) this
// module. Written test-first (Gate 5, RED) — `src/tool-specs.ts` exports no such name today.
describe('ENVELOPE_NOTE (DES-239, v35, REQ-210)', () => {
  it('is exported and states the double-JSON-encoding envelope', async () => {
    const mod = await import('../../src/tool-specs.js');
    expect(typeof (mod as unknown as { ENVELOPE_NOTE?: string }).ENVELOPE_NOTE).toBe('string');
    expect((mod as unknown as { ENVELOPE_NOTE: string }).ENVELOPE_NOTE).toMatch(/content\[0\]\.text/i);
  });
});

// v35 (DES-239, ARCH-154, TASK-237, REQ-206/207): `run_start.args`, `run_result`/`run_status`/
// `run_list` descriptions state the omission semantics a cold caller got wrong (REQ-206/210's own
// evidence: `args:'null'`/an undisclosed `failedAgentCount` omission rule). Written test-first
// (Gate 5, RED) — none of today's descriptions mention it.
describe('advertised tool descriptions state the v35 omission semantics (DES-239, REQ-206/207)', () => {
  it('run_start.args states {} on omission and that a declared default is applied', () => {
    const argsSchema = (TOOL_SPECS.find((t) => t.name === 'run_start')!.inputSchema as unknown as { properties: Record<string, { description?: string }> }).properties['args'];
    expect(argsSchema?.description).toMatch(/\{\}/);
    expect(argsSchema?.description).toMatch(/default/i);
  });

  it('run_result/run_status/run_list describe error:{code,message} and the failedAgentCount omission rule (absent ≠ healthy; run_list is terminal-only)', () => {
    const runResult = projectToolsList().find((t) => t.name === 'run_result')!.description;
    const runStatus = projectToolsList().find((t) => t.name === 'run_status')!.description;
    const runList = projectToolsList().find((t) => t.name === 'run_list')!.description;
    expect(runResult).toMatch(/error/i);
    expect(runResult).toMatch(/code/i);
    expect(`${runStatus} ${runList}`).toMatch(/failedAgentCount/);
    expect(`${runStatus} ${runList}`).toMatch(/omit|absent/i);
  });

  // Gate-8 send-back (TASK-247 DoD 4): the attestation-boundary sentence — a terminal failure's
  // `error.code` alone is NOT engine-attested (a script can forge one by setting `e.name` before
  // rethrowing, `refusalCode()`/`guards.ts`); only the run's own captured refusal ledger
  // (`refusalRef`, TASK-246) is. Implemented on both descriptions already; this pins it.
  it('run_result/run_status state error.code alone is NOT engine-attested — only this run\'s own refusal ledger is', () => {
    const runResult = projectToolsList().find((t) => t.name === 'run_result')!.description;
    const runStatus = projectToolsList().find((t) => t.name === 'run_status')!.description;
    for (const desc of [runResult, runStatus]) {
      expect(desc).toMatch(/not.*engine-attested|engine-attested/i);
      expect(desc).toMatch(/forge/i);
    }
  });

  // #160 DOC-1 (2026-10-07 re-verification): the "agent() calls that fail or time out still resolve
  // null to the script" sentence, as originally written, read as covering EVERY failure reason —
  // but reason:'aborted' structurally cannot resolve anything to the script (the run is suspended
  // mid-call; a resume re-dispatches a brand-new agentId from scratch, and only THAT call's eventual
  // outcome ever resolves to the script). The description must carve 'aborted' out of that claim,
  // while still stating the aborted attempt itself counts in failedAgentCount/agentFailures.
  it('run_status/run_result carve "aborted" out of the "resolves null to the script" claim, and say it still counts as a failure', () => {
    const runStatus = projectToolsList().find((t) => t.name === 'run_status')!.description;
    const runResult = projectToolsList().find((t) => t.name === 'run_result')!.description;
    for (const desc of [runStatus, runResult]) {
      expect(desc).toMatch(/aborted/i);
      // the carve-out must sit near the "resolve null" claim, not just mention "aborted" elsewhere
      // (run_status already names 'aborted' in the agentFailures reason enum, which is not enough).
      expect(desc).toMatch(/aborted[^.]*(never resolv|not resolving|does not resolv|cannot resolv)|re-?dispatch(ed|es)? a (brand-)?new agentId[^.]*aborted/i);
      expect(desc).toMatch(/aborted[^.]*(failedAgentCount|agentFailures|AGENT_FAILED|aborted attempt included)/i);
    }
  });
});

// v36 (DES-245, TASK-243, REQ-213/212): the guard that keeps `run.terminal`'s omission of
// `bypass`/`idSource` (DES-243/DES-245's own decision rationale item 2) honest — `run_start` must
// refuse a caller-supplied `principal` argument. If admission ever starts honouring one, THIS test
// goes red and forces the event line to grow the field rather than silently becoming a lie. Checked
// at the schema level (`additionalProperties:false`, no `principal` key) rather than by driving a
// live call — the cheapest form that still proves the refusal is structural, not incidental.
// This is a REGRESSION PIN, not a Gate-5 red item: the schema already refuses an unknown property.
describe('run_start refuses a caller-supplied principal — the guard behind run.terminal (v36, DES-245)', () => {
  it('run_start.inputSchema has additionalProperties:false and declares no principal property', () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'run_start')!;
    const schema = spec.inputSchema as unknown as { additionalProperties?: boolean; properties: Record<string, unknown> };
    expect(schema.additionalProperties).toBe(false);
    expect(Object.hasOwn(schema.properties, 'principal')).toBe(false);
  });
});

// issue #89 item 4: `workflow_publish`'s `channel` property is `{type:'string', enum:['release',
// 'beta']}` and REQUIRED (`inputSchema`'s `required` array) — `call-tool.ts:228`'s ajv validation
// runs BEFORE `facade.workflowPublish` is ever called (`call-tool.ts:241+`'s switch), so
// `channel:'alpha'` is refused by ajv's own `must be equal to one of the allowed values` message,
// as `INVALID_ARGUMENT` — `mcp-facade.ts:536`'s own `INVALID_CHANNEL` throw is UNREACHABLE from the
// wire (confirmed: `facade.workflowPublish` has exactly one caller, `call-tool.ts`, always past
// ajv). It stays live and tested for a DIRECT (non-wire) facade caller
// (`tests/unit/facade-refusal-arms.test.ts`'s own pin) — this item only fixes what the TOOL
// advertises a wire caller will see.
describe('workflow_publish advertises the refusal a wire caller actually gets for a bad channel (issue #89 item 4)', () => {
  it('errors[] lists INVALID_ARGUMENT, not the wire-unreachable INVALID_CHANNEL', () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'workflow_publish')!;
    expect(spec.errors).toContain('INVALID_ARGUMENT');
    expect(spec.errors).not.toContain('INVALID_CHANNEL');
  });

  it('the channel property\'s own description says an out-of-enum value is refused INVALID_ARGUMENT by schema validation', () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'workflow_publish')!;
    const channelDesc = (spec.inputSchema as unknown as { properties: Record<string, { description?: string }> }).properties['channel']?.description ?? '';
    expect(channelDesc).toMatch(/INVALID_ARGUMENT/);
  });
});

// REPAIR (issue #160 BUG-2 follow-up, review D1-item1): commit 081bea5 tightened run_list.limit to
// `{type:'integer', minimum:1}`, which refuses an explicit `limit:0` with INVALID_ARGUMENT at the
// wire. But `limit:0` meaning "return []" is PRE-EXISTING, owner-acknowledged behavior (issue #160's
// own DOC section), not a defect — a design choice the task's owner rules require be left unchanged
// and only flagged. `minimum:0` still refuses every float (ajv's `integer` check) and every negative
// value, which are the actual BUG-2 defects (raw driver error / ceiling bypass) — only an explicit
// `0` is let back through, unchanged from before the fix.
describe('run_list.limit keeps 0 as a valid value — the owner-acknowledged "limit:0 means []" behavior must not be refused by the BUG-2 schema tightening (issue #160 BUG-2 follow-up)', () => {
  it('limit schema is integer with minimum 0 (not 1) — 0 is not refused, floats/negatives still are', () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'run_list')!;
    const limitSchema = (spec.inputSchema as unknown as { properties: Record<string, { type?: string; minimum?: number }> }).properties['limit'];
    expect(limitSchema?.type).toBe('integer');
    expect(limitSchema?.minimum).toBe(0);
  });
});

// issue #155 B2a (owner-approved, 2026-10-07): VALUE_MISMATCH/COLLAPSED_EDGE now self-map (RULE_CODE,
// workflow-catalog.ts) instead of folding into MERMAID_INVALID — the tool's advertised errors[] must
// name both, same "every code this tool can throw is on its errors list" convention this file's own
// workflow_publish case above pins for INVALID_ARGUMENT/INVALID_CHANNEL.
describe('workflow_register advertises VALUE_MISMATCH/COLLAPSED_EDGE as their own codes (issue #155 B2a)', () => {
  it('errors[] lists VALUE_MISMATCH and COLLAPSED_EDGE alongside MERMAID_INVALID', () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'workflow_register')!;
    expect(spec.errors).toContain('VALUE_MISMATCH');
    expect(spec.errors).toContain('COLLAPSED_EDGE');
    expect(spec.errors).toContain('MERMAID_INVALID');
  });
});

// issue #158 NEW (tester re-verify): run_agent_log's implementation (mcp-facade.ts's `runAgentLog`)
// already branches on `agentId` when present — the code works — but the ADVERTISED schema declared
// only `{runId, label}` with BOTH required, so a caller who already knows an agentId (e.g. from
// run_status's own `agents[].agentId`) could not express an agentId-only call at all: ajv refused it
// with "must have required property 'label'" before mcp-facade.ts's implementation was ever reached.
// This matters specifically when two concurrent agent() calls share a label (parallel dispatch,
// issue #158's own concurrency scenario): mcp-facade.ts's label branch is a `.find()`, which returns
// only the FIRST matching record, so a later-failing same-label agent's log is unreachable by label
// alone — agentId is the only way to disambiguate, and it must be a DOCUMENTED, schema-valid input.
describe('run_agent_log advertises agentId as an alternative to label (issue #158 NEW)', () => {
  const ajv = new Ajv();

  function compiled() {
    const spec = TOOL_SPECS.find((s) => s.name === 'run_agent_log')!;
    return { spec, validate: ajv.compile(spec.inputSchema) };
  }

  it('inputSchema declares an agentId property', () => {
    const { spec } = compiled();
    const props = (spec.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props['agentId']).toEqual({ type: 'string' });
  });

  it('{runId, agentId} with NO label is schema-valid (today it is wrongly refused)', () => {
    const { validate } = compiled();
    expect(validate({ runId: 'r1', agentId: 'a2' })).toBe(true);
  });

  it('{runId, label} with no agentId is still schema-valid (pre-existing shape unchanged)', () => {
    const { validate } = compiled();
    expect(validate({ runId: 'r1', label: 'greet' })).toBe(true);
  });

  it('{runId} alone (neither label nor agentId) is still refused', () => {
    const { validate } = compiled();
    expect(validate({ runId: 'r1' })).toBe(false);
  });

  it('description documents agentId as a disambiguator for same-label concurrent agents', () => {
    const { spec } = compiled();
    expect(spec.description).toMatch(/agentId/);
  });
});

// issue #156 NEW-2 (2026-10-09 re-verification): run_start can genuinely return
// PARAM_CONTRACT_INVALID (overrides.agents/overrides.agents.<label> the wrong shape,
// e.g. a bare string) — the code was live before this fix but missing from this row's
// OWN advertised errors[], so a cold client reading tools/list had no way to learn it.
describe('run_start advertises PARAM_CONTRACT_INVALID (issue #156 NEW-2)', () => {
  it("run_start's errors[] includes PARAM_CONTRACT_INVALID", () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'run_start');
    if (!spec) throw new Error('run_start not found in TOOL_SPECS');
    expect(spec.errors).toContain('PARAM_CONTRACT_INVALID');
  });
});
