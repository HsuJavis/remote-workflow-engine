// UT-159 (DES-157, v24): buildAuthoringGuide(inputs) — pure over resolved ServerConfig ceilings;
// GUIDE_EXAMPLES; every ERROR_CATALOG-key-shaped token traced, every tool name real, no model
// alias in any example script. Written test-first (Gate 5, RED) — src/authoring-guide.ts does
// not exist yet.
import { describe, it, expect } from 'vitest';
import { buildAuthoringGuide, GUIDE_EXAMPLES } from '../../src/authoring-guide.js';
import { SHAPES, EDGE_FORMS } from '../../src/check-mermaid.js';
// v37 owner ruling on DES-258 (ARCH-181, ADR-083 posture C): the load-bearing correction test
// below calls the REAL boot probe against THIS host, same precedent as UT-323b.
import { probeConfinement } from '../../src/gateway/confinement-probe.js';

const CEILINGS = { maxTimeoutMs: 600000, maxAppendPromptBytes: 1024, maxEffort: 'high' as const, aliases: ['default', 'sonnet'], runConcurrency: 24 };

describe('buildAuthoringGuide (UT-159, DES-157)', () => {
  it('a FAKE ceiling appears verbatim in the text (proves interpolation, not a hard-coded 600000)', () => {
    const text = buildAuthoringGuide({ maxTimeoutMs: 12345, maxAppendPromptBytes: 999, maxEffort: 'medium', aliases: ['default'], runConcurrency: 24 });
    expect(text).toMatch(/12345/);
  });

  it('at least ten GUIDE_EXAMPLES, each with title/script/mermaid/expectRegister', () => {
    expect(GUIDE_EXAMPLES.length).toBeGreaterThanOrEqual(10);
    for (const ex of GUIDE_EXAMPLES as Array<{ title: string; script: string; mermaid: string; expectRegister: string }>) {
      expect(ex.title).toBeTruthy();
      expect(ex.script).toBeTruthy();
      expect(ex.mermaid).toBeTruthy();
      expect(ex.expectRegister).toBe('ok');
    }
  });

  it('no example script contains a hard-coded model alias literal', () => {
    for (const ex of GUIDE_EXAMPLES as Array<{ script: string }>) {
      expect(ex.script).not.toMatch(/sonnet-5|opus|haiku|gpt-4/);
    }
  });

  it('the guide names the one-level nesting limit and the flatten instruction', () => {
    const text = buildAuthoringGuide(CEILINGS);
    expect(text).toMatch(/one.level/i);
    expect(text).toMatch(/flatten/i);
  });

  it('the guide states LEGACY_REREGISTER and what to do', () => {
    const text = buildAuthoringGuide(CEILINGS);
    expect(text).toMatch(/LEGACY_REREGISTER/);
  });

  // v35 (item 7 of the Gate 8 return, REQ-206): the guide used to teach the retired v21 rule — "a
  // declared args default is refused: advertised but never applied" — while `tool-specs.ts`'s own
  // `run_start.args` description (asserted by tests/unit/tool-specs.test.ts's
  // "states {} on omission and that a declared default is applied") says defaults ARE applied. A
  // self-contradicting advertised surface between the human guide and the tool schema is exactly
  // the defect class REQ-202/REQ-209 exist to prevent. Written test-first for THIS assertion (the
  // sentence itself was already fixed by the implementer; no test forced it until now).
  //
  // Red reason (measured): before this test existed, nothing in the suite read this sentence at
  // all — a regression back to the retired wording would pass every other test in this file.
  it('the guide states a declared meta.params.args default IS applied on omission (matches tool-specs.ts, never the retired "advertised but never applied" claim)', () => {
    const text = buildAuthoringGuide(CEILINGS);
    const section = text.slice(text.indexOf('`meta.params.args` declares'));
    expect(section).toMatch(/A declared `\.default` fills in the key when the caller omits it/);
    expect(section).not.toMatch(/never applied/i);
  });

  // v25 (DES-168, REQ-120, issue #61): the limit an author had NO way to learn. The owner's 3-wide
  // parallel() ran 2 branches in production and the guide said nothing about budget, fan-out width,
  // or their interaction — REQ-120 makes teaching it acceptance, not a nicety.
  it("the guide teaches how wide a parallel() really runs, from THIS deployment's resolved cap", () => {
    const text = buildAuthoringGuide({ ...CEILINGS, runConcurrency: 77 });
    const section = text.slice(text.indexOf('Budget, concurrency'));
    expect(section).toMatch(/77/); // interpolated, never a hard-coded 24
    expect(section).toMatch(/runConcurrency/);
    expect(section).toMatch(/queue/i); // past the cap calls QUEUE — a fan-out is slower, not truncated
    expect(buildAuthoringGuide(CEILINGS)).not.toMatch(/\b77\b/);
  });

  it('the guide states the honest budget contract: a stop signal, with a bounded overshoot', () => {
    const text = buildAuthoringGuide(CEILINGS);
    const section = text.slice(text.indexOf('Budget, concurrency'));
    expect(section).toMatch(/not a hard ceiling/i);
    expect(section).toMatch(/overshoot/i);
    expect(section).toMatch(/BUDGET_EXCEEDED/);
    expect(section).toMatch(/unbounded/); // omitted/null budget
    // …and that an engine refusal is NOT the author's own thunk throwing (the #61 conflation).
    expect(section).toMatch(/refused/);
    expect(section).toMatch(/null/);
  });
});

// v24 Gate 7.5 (D-12, REQ-117): the cold subject's FIRST registration was refused
// `PARAM_CONTRACT_INVALID: default not a known alias: claude-haiku-4-5-20251001` — it took a model
// id from `models_list` because nothing on the tool surface said which alias names this deployment
// accepts. The guide's own "Engine ceilings (this deployment)" section rendered the three numeric
// ceilings and not the alias table, no tool schema listed them, and `models_list` lists catalog
// models, not aliases. Per REQ-117's own rule ("write it right the first time; if not, the
// documentation is at fault"), that is a documentation defect.
describe('the accepted model aliases are ON the surface (UT-159 v24, D-12, REQ-117)', () => {
  it("this deployment's alias names appear in the ceilings section, interpolated — never a hard-coded table", () => {
    const text = buildAuthoringGuide({ maxTimeoutMs: 600000, maxAppendPromptBytes: 1024, maxEffort: 'high', aliases: ['zz-alpha', 'zz-beta'], runConcurrency: 24 });
    const section = text.slice(text.indexOf('Engine ceilings (this deployment)'));
    expect(section).toMatch(/zz-alpha/);
    expect(section).toMatch(/zz-beta/);
    // A different deployment renders different names — the same proof the numeric ceilings get.
    expect(buildAuthoringGuide(CEILINGS)).not.toMatch(/zz-alpha/);
  });

  it('the alias names are named as such, so a reader knows what to put in `model.default`', () => {
    const text = buildAuthoringGuide(CEILINGS);
    expect(text).toMatch(/model.*alias|alias.*model/i);
    expect(text).toMatch(/UNKNOWN_ALIAS|not a known alias/);
  });
});

// v24 Gate 7.5 (D-4, REQ-116/REQ-112): the guide taught THREE node shapes while `checkMermaid`
// accepts FIVE (both extras registered live), and never mentioned the `<br/>` value triple, the
// one-edge-per-line rule (`COLLAPSED_EDGE`) or dashed = skipped. A guide that teaches less than the
// engine accepts makes an author believe they cannot draw what they can draw. The vocabulary is
// interpolated from `check-mermaid.ts`'s own SHAPES/EDGE_FORMS — the modules' comments already say
// this file should read them rather than re-type the grammar.
describe('the diagram section teaches the COMPLETE checkMermaid vocabulary (UT-159 v24, D-4)', () => {
  const text = () => buildAuthoringGuide(CEILINGS);

  it('every one of the five node shapes appears, by token pair', () => {
    for (const shape of SHAPES) {
      expect(text(), `shape ${shape.name} is accepted by checkMermaid but missing from the guide`).toContain(`${shape.open}…${shape.close}`);
    }
  });

  it('every one of the three edge forms appears', () => {
    for (const edge of EDGE_FORMS) expect(text()).toContain(edge.token);
  });

  it('the `<br/>` value triple, its separator and its units are stated', () => {
    expect(text()).toContain('<br/>');
    expect(text()).toContain(' · ');
    expect(text()).toMatch(/VALUE_MISMATCH/);
  });

  it('the one-edge-per-line rule is stated with the code it is refused under', () => {
    expect(text()).toMatch(/COLLAPSED_EDGE/);
  });

  it('the dashed edge is explained as a skipped path, not just listed', () => {
    expect(text()).toMatch(/skip/i);
  });
});

// v24 adjudication #6 F-4: the guide's EXAMPLES must obey the guide's own shape TABLE. The
// "non-agent aggregation" example drew its aggregation as `aggregate["…"]` — the rectangle, which
// `SHAPES` declares to be the "nested workflow() black box" — while the very table printed a few
// sections above says `{{"…"}}` is the non-agent aggregation shape. `checkMermaid` accepts either
// (both are free-text, both excluded from the label diff), so nothing in the engine could catch it;
// the cost is a cold model reading one document that contradicts itself, and this guide is the
// ONLY document REQ-117's subject ever reads.
//
// The invariant asserted is the table's own semantic, read from SHAPES rather than re-typed: a
// rectangle node is the black-box stand-in for a `workflow()` call, so it may appear in an example
// only when that example's script actually calls `workflow(`.
describe("the guide's examples use the shapes the guide's own table declares (UT-159 v24, F-4)", () => {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Classify one diagram node line against SHAPES — the longest matching `open` token wins, which
   *  is `checkMermaid`'s own precedence (`{{"` before `{"`, `(["` before `["`). */
  function shapeOf(line: string): string | null {
    const hits = SHAPES.filter((s) => new RegExp(`^\\w+${esc(s.open)}.*${esc(s.close)}$`).test(line));
    if (hits.length === 0) return null;
    return hits.reduce((a, b) => (b.open.length > a.open.length ? b : a)).name;
  }

  const nodeLines = (mermaid: string) =>
    mermaid.split('\n').map((l) => l.trim())
      .filter((l) => l !== '' && !/^(graph|flowchart)\s/.test(l) && !/<-->|-\.->|-->/.test(l) && !/^subgraph\s/.test(l) && l !== 'end');

  it('the classifier itself agrees with SHAPES (guards the assertion below from silently matching nothing)', () => {
    expect(shapeOf('a(["writer"])')).toBe('stadium');
    expect(shapeOf('a["free text"]')).toBe('rectangle');
    expect(shapeOf('a{{"agg"}}')).toBe('aggregation');
    expect(shapeOf('a{"cond"}')).toBe('diamond');
    expect(shapeOf('a[/"trigger"/]')).toBe('trapezoid');
  });

  it.each(GUIDE_EXAMPLES as Array<{ title: string; script: string; mermaid: string }>)(
    'every node in "%s" is a shape SHAPES declares, and a rectangle only stands in for a workflow() call',
    (ex) => {
      const lines = nodeLines(ex.mermaid);
      for (const line of lines) {
        const shape = shapeOf(line);
        expect(shape, `"${ex.title}": node line \`${line}\` matches none of the five declared shapes`).not.toBeNull();
        if (shape === 'rectangle') {
          expect(
            ex.script.includes('workflow('),
            `"${ex.title}": \`${line}\` uses the rectangle, which SHAPES reserves for the ` +
              `"nested workflow() black box", but this example's script never calls workflow() — ` +
              `the guide is contradicting its own shape table`,
          ).toBe(true);
        }
      }
    },
  );
});

// UT-166 (v25, issue #55, adjudication #9 I-1.3): the guide has to TEACH the per-agent tool
// surface, and the lesson that goes with it.
//
// Two separate failures met in the v24 tmux experiment. (a) The capability — an empty tool surface
// per agent — has shipped since v21 under the name `allowedTools`, and no author-facing surface
// named it: not the guide, not `AgentOpts`, not the locked-key list (which said `tools`). (b) The
// knowledge — a small model handed Write/Edit/Bash will answer with a tool-call envelope instead of
// prose — the cold subject had to derive on its own, from a failing run, in the dark. REQ-117's
// standing rule is that a thing a cold model had to derive belongs on the surface, so the next one
// does not derive it again.
//
// RED before the fix: `buildAuthoringGuide()` contained neither the word `allowedTools` nor any
// mention of tool surfaces at all.
describe('the guide teaches the per-agent tool surface and why to empty it (UT-166, #55)', () => {
  const text = buildAuthoringGuide(CEILINGS);

  it('names the option an author can actually write', () => {
    expect(text).toMatch(/allowedTools/);
  });

  it('shows the empty surface — the exact spelling that fixes the prose-only case', () => {
    expect(text).toMatch(/allowedTools:\s*\[\]/);
  });

  it('states the lesson: a small model handed a tool surface emits tool calls instead of prose', () => {
    expect(text).toMatch(/small(er)?[- ]model/i);
    expect(text).toMatch(/tool call/i);
  });

  it('disambiguates the two layers by their real names, since guessing between them is the defect', () => {
    // v34 (REQ-203): the agentType frontmatter `tools` layer is retired; only two layers remain —
    // per-call `allowedTools` > config `defaultAllowedTools`. See UT-276 for the section-level
    // assertion that `agentType` leaves no trace in the built guide at all.
    expect(text).toMatch(/allowedTools/);
    expect(text).toMatch(/defaultAllowedTools/);
  });

  it('warns that an unknown agent() option key is refused, not ignored', () => {
    expect(text).toMatch(/PARAM_UNKNOWN/);
  });
});

// v26 (DES-187, ARCH-121, TASK-193, REQ-130/121/127/001, issue #71): the guide's five gaps a cold
// client white-ran into — seeding, sandbox globals+determinism guards, meta.params.args types, the
// alias/provider/effort table, and models_list's declared-not-probed flags. Written test-first
// (Gate 5, RED): today's guide has none of these five sections.
describe('the guide closes the five cold-client gaps (UT-159x, DES-187, REQ-130)', () => {
  const text = buildAuthoringGuide(CEILINGS);

  it('(a) Seeding a workspace: names all three shapes and the sha256-only refusal', () => {
    expect(text).toMatch(/seedManifest/);
    expect(text).toMatch(/seedManifestRef/);
    expect(text).toMatch(/contentB64/);
    expect(text).toMatch(/DETERMINISM_GUARD|INVALID_SEED_SPEC/);
  });

  it('(b) What the sandbox has and lacks: names the determinism guard by its real code and the why/instead', () => {
    expect(text).toMatch(/DETERMINISM_GUARD/);
    expect(text).toMatch(/Math\.random/);
    expect(text).toMatch(/run_status|run_result/);
  });

  it('(c) meta.params.args legal types', () => {
    expect(text).toMatch(/string \| number \| enum|string\|number\|enum/);
  });

  it('(d) the alias table is generated, labelled "declared, not probed"', () => {
    expect(text).toMatch(/declared,? not probed/i);
  });

  it('(e) models_list flags are declarations with declaredSource and catalogFetchedAt', () => {
    expect(text).toMatch(/declaredSource/);
    expect(text).toMatch(/catalogFetchedAt/);
  });

  it('the budget section is rewritten for {usd, tokens} and names which accessor answers which limit', () => {
    expect(text).toMatch(/budget\.tokens\(\)/);
    expect(text).toMatch(/stop-dispatching/i);
  });
});

// UT-215 (v26 Gate 7.5 round 1, defect D6): the guide STATES the script-body form. Ten examples
// showed it and no sentence said it, so the round-1 cold subject wrapped its body in
// `export default async function () {…}` and lost its first-attempt registration (VAL-188, REQ-128).
describe('the guide states the script-body form (UT-215, defect D6)', () => {
  const text = buildAuthoringGuide(CEILINGS);

  it('says the body is a bare async function body and refuses the three module constructs by name', () => {
    expect(text).toMatch(/bare async function body/i);
    expect(text).toMatch(/export default/);
    expect(text).toMatch(/top-level `import`/);
  });

  it('says `export const meta` is the one exception and that dropping its export costs AGENT_UNDECLARED', () => {
    const para = text.slice(text.indexOf('bare async function body'), text.indexOf('bare async function body') + 900);
    expect(para).toMatch(/export const meta/);
    expect(para).toMatch(/AGENT_UNDECLARED/);
  });
});

// UT-221 (v26 Gate 7.5 round 1, defect D4): the guide states WHICH cache-write multiplier the
// engine bills at and why — an author sizing a USD budget for a cache-heavy workflow cannot learn
// it anywhere else, and the engine had to pick one because the usage it receives carries no TTL.
describe('the guide states the cache-write multiplier it bills (UT-221, defect D4)', () => {
  const text = buildAuthoringGuide(CEILINGS);

  it('names both published multipliers, the one this engine uses, and the reason', () => {
    expect(text).toMatch(/1\.25x/);
    expect(text).toMatch(/every cache write \*\*? ?at 2x|cache write.{0,40}2x/i);
    expect(text).toMatch(/no TTL|without a TTL|no TTL in it/i);
    expect(text).toMatch(/upper bound/i);
  });
});

// UT-267 (v33, REQ-201, TASK-227, DES-222, ARCH-107, ADR-032, TASK-150/DES-157): the "Registration
// and versioning" section taught ONLY the three exceptions (LEGACY_REREGISTER, omission-does-not-
// release, assets-shared-across-versions) and never the normal loop, so a cold client that had read
// the whole guide still treated `release` as the only way to run what it had just registered. The
// section must now OPEN with the loop — `workflow_register` → `run_start({name, version})` →
// iterate → `workflow_publish(release)` — with the three exception paragraphs kept VERBATIM after
// it. Written test-first (Gate 5, RED): today the section opens directly with the
// `LEGACY_REREGISTER` sentence — confirmed by reading src/authoring-guide.ts:757-767.
describe('the Registration and versioning section opens with the normal loop (UT-267, DES-222)', () => {
  const text = buildAuthoringGuide(CEILINGS);

  function section(): string {
    const start = text.indexOf('## Registration and versioning');
    expect(start, 'the "Registration and versioning" section is missing entirely').toBeGreaterThanOrEqual(0);
    const next = text.indexOf('\n## ', start + 1);
    return text.slice(start, next === -1 ? text.length : next);
  }

  it('opens with the four-step loop, in order, before the LEGACY_REREGISTER exception paragraph', () => {
    const sec = section();
    const legacyIdx = sec.indexOf('LEGACY_REREGISTER');
    expect(legacyIdx, 'LEGACY_REREGISTER sentence missing — it must be kept, not deleted').toBeGreaterThan(0);
    const loopTokens = ['workflow_register', 'run_start({name, version})', 'workflow_publish(release)'];
    let cursor = -1;
    for (const token of loopTokens) {
      const idx = sec.indexOf(token);
      expect(idx, `"${token}" missing from the opening of the Registration and versioning section`).toBeGreaterThan(cursor);
      expect(idx, `"${token}" must appear BEFORE the LEGACY_REREGISTER exception paragraph (the loop is the opening, not an afterthought)`).toBeLessThan(legacyIdx);
      cursor = idx;
    }
  });

  it('the three exception sentences remain, verbatim, after the loop (regression guard — nothing deleted)', () => {
    const sec = section();
    expect(sec).toMatch(/LEGACY_REREGISTER/);
    expect(sec).toMatch(/omission does not release/i);
    expect(sec).toMatch(/shared across every version/i);
  });
});

// UT-276 (DES-229, ARCH-107, ADR-032, TASK-230, REQ-202/REQ-203): the guide gains a
// "prompt layering" section naming exactly two author/caller segments plus the engine's own
// scaffolding, and the tool-surface section's THREE layers ("per-call allowedTools, then the
// agentType frontmatter tools field, then defaultAllowedTools") collapse to TWO. The word
// `agentType` disappears from the built guide entirely — a mechanism-teaching sentence surviving
// its own retirement is worse than no sentence.
//
// Red reason: today's guide has no "prompt layering"/"Prompt layering" heading at all, the tool
// section still names THREE layers including the `agentType` frontmatter `tools` field
// (`authoring-guide.ts:530-532`), and `agentType` appears in the built guide text (confirmed
// above at :531).
describe('the guide teaches v34 prompt layering and the two-layer tool surface (DES-229, UT-276)', () => {
  const text = buildAuthoringGuide(CEILINGS);

  it('has a prompt-layering section naming exactly two author/caller segments (script prompt, framed appendPrompt) plus engine scaffolding', () => {
    expect(text).toMatch(/prompt layering/i);
    expect(text).toMatch(/appendPrompt/);
    // The engine does not decide the "authorized override" vs "foreign injection" line for the author.
    expect(text).toMatch(/authorized override/i);
    expect(text).toMatch(/foreign injection/i);
  });

  it('the tool surface section now states TWO layers (per-call allowedTools, then defaultAllowedTools), scoped to the SDK gateway path', () => {
    const start = text.indexOf("The agent's tool surface");
    expect(start, 'the tool surface section is missing').toBeGreaterThanOrEqual(0);
    const next = text.indexOf('\n## ', start + 1);
    const section = text.slice(start, next === -1 ? text.length : next);
    expect(section).toMatch(/two layers/i);
    expect(section).toContain('defaultAllowedTools');
    expect(section).not.toContain('agentType');
  });

  // Gate 8 send-back AC-1: the guide advertised exactly two layers and never named the built-in
  // core-tool fallback (BUILT_IN_CORE_TOOLS, claude-agent-sdk-client.ts:190) that applies when a
  // deployment configures neither layer. Red until the section names it and its six tools.
  it('the tool surface section names the built-in core-tool fallback and its six tools (Gate 8 AC-1)', () => {
    const start = text.indexOf("The agent's tool surface");
    const next = text.indexOf('\n## ', start + 1);
    const section = text.slice(start, next === -1 ? text.length : next);
    expect(section).toMatch(/built-in/i);
    for (const tool of ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']) {
      expect(section).toContain(tool);
    }
  });

  it('agentType does not appear anywhere in the built guide (the retired mechanism leaves no trace)', () => {
    expect(text).not.toContain('agentType');
  });
});

// v35 (DES-239, ARCH-151, TASK-237, REQ-207/210): the three facts a cold author got wrong —
// (1) a failed SEQUENTIAL `await agent()` returns `null` (does NOT throw) — today the guide only
// states this for `parallel()`'s thunks; (2) `timeoutMs` bounds ONE attempt and the deployed
// `retries` multiplies the actual wait, stated WITHOUT the SDK-only untimed exception (the two
// gateways disagree there); (3) every tool result arrives as a JSON string inside
// `content[0].text` (the double-encoding envelope). Written test-first (Gate 5, RED).
describe('buildAuthoringGuide — the three v35 facts a cold author got wrong (DES-239, REQ-207/210)', () => {
  const text = buildAuthoringGuide(CEILINGS);

  it('states that a failed SEQUENTIAL await agent() returns null and does NOT throw, with a self-protection pattern', () => {
    expect(text).toMatch(/await agent\([^)]*\)[^.]*\bnull\b/is);
    expect(text).toMatch(/does not throw|never throws|no exception/i);
    expect(text).toMatch(/if\s*\(\s*\w+\s*===\s*null\s*\)/); // the `if (out === null)` self-protection pattern
  });

  it('states timeoutMs bounds ONE attempt and the deployed retries multiplies the actual wait', () => {
    expect(text).toMatch(/timeoutMs/);
    expect(text).toMatch(/one attempt|single attempt/i);
    expect(text).toMatch(/retries|retry/i);
    expect(text).toMatch(/multipl/i);
  });

  it('states every tool result arrives as a JSON string inside content[0].text (the double-encoding envelope)', () => {
    expect(text).toMatch(/content\[0\]\.text/i);
    expect(text).toMatch(/JSON/i);
  });
});

// UT-293 amendment, v36 (DES-249, ARCH-171/173, TASK-247, REQ-216/K7, REQ-207): two sentences the
// v35 guide never stated — (1) an agent() call with NO timeoutMs runs ONCE (retries apply only to
// a call that set one; v35's ARCH-151 text stated the multiplied-worst-case wait but left out the
// untimed caveat, which is precisely what let `client.ts` ship the deviant retry-an-untimed-call
// bug K6/K7 close); (2) the attestation boundary — the run-level structured refusal marker
// (`refusalRef`) is engine-attested (lifted only against the parent's own ledger), while
// `error.code` is NOT and never has been (a script can forge `name:'PARAM_UNKNOWN'` and produce the
// code with no marker) — without this sentence the first reader of the new marker field reasonably
// assumes both are attested. Written test-first (Gate 5, RED).
describe('buildAuthoringGuide — v36: the untimed-call caveat and the refusalRef attestation boundary (DES-249, REQ-216/K7)', () => {
  const text = buildAuthoringGuide(CEILINGS);

  it('states an agent() call with NO timeoutMs runs ONCE — retries apply only to a call that set one', () => {
    expect(text).toMatch(/no\s+timeoutMs|without\s+(a\s+)?timeoutMs|timeoutMs\s+is\s+(not\s+set|absent|omitted)/i);
    expect(text).toMatch(/runs\s+once|one\s+attempt|single\s+attempt/i);
  });

  it('states the refusalRef marker is engine-attested but error.code is NOT (a script can forge the code with no marker)', () => {
    expect(text).toMatch(/refusalRef/);
    expect(text).toMatch(/attest/i);
    expect(text).toMatch(/error\.code|\bcode\b.*forg|forg.*code/i);
  });
});

// v37 (DES-258, ARCH-107, TASK-256, REQ-117, REQ-218): a new "host path grants" paragraph a cold
// author cannot infer from the tool schema alone — what Bash may touch, what an escape looks like
// from inside the sandbox (an ordinary EACCES, never a typed engine refusal), and where a shared
// host path comes from (an operator grant, visible per-run in agent.confinement). Deliberately
// titled "host path grants", never "sandbox" — authoring-guide.ts already owns that word for the
// node:vm script sandbox (SANDBOX_GLOBALS section above), and the same collision ARCH-175 avoided
// in the filesystem must not reappear in the one document a cold author reads.
// Written test-first (Gate 5, RED): this section does not exist yet.
describe('buildAuthoringGuide — v37: the host-path-grants paragraph (DES-258, REQ-218)', () => {
  const text = buildAuthoringGuide(CEILINGS);

  it('titles the new section "host path grants" — never "sandbox" (that word is already owned by the script sandbox section)', () => {
    expect(text).toMatch(/host path grants/i);
  });

  it('states Bash may write inside the run workspace and nowhere else, and an escape arrives as an ordinary EACCES in the tool result, never a typed engine refusal', () => {
    const section = text.slice(text.search(/host path grants/i));
    expect(section).toMatch(/\bBash\b/);
    expect(section).toMatch(/run workspace/i);
    expect(section).toMatch(/EACCES/);
    expect(section).not.toMatch(/typed engine (refusal|error)/i);
  });

  it('states a shared host path is an OPERATOR grant in rwe.config.json, visible per-run in the agent.confinement log line', () => {
    const section = text.slice(text.search(/host path grants/i));
    expect(section).toMatch(/operator/i);
    expect(section).toMatch(/rwe\.config\.json/);
    expect(section).toMatch(/agent\.confinement/);
  });

  it('adds NO GUIDE_EXAMPLES entry for this section — an EACCES happens inside a tool result the workflow script never sees', () => {
    const titles = GUIDE_EXAMPLES.map((ex: { title: string }) => ex.title.toLowerCase());
    expect(titles.some((t: string) => t.includes('host path') || t.includes('sandbox') || t.includes('eacces'))).toBe(false);
  });
});

// v37 owner ruling on DES-258's owner_decision (2026-09-22): the guide's "host path grants"
// section used to assert fact (a) — "Bash may write inside the run workspace and nowhere else" —
// UNCONDITIONALLY, which is FALSE on a deployment whose boot probe (ARCH-181, ADR-083 posture C)
// measures 'unconfined'. The ruling: render the POSTURE live, leave the grant list itself static.
// This block is the load-bearing correction — without threading `confinementPosture` through
// `buildAuthoringGuide()`, it fails against the REAL probe result on THIS host (case below).
describe('buildAuthoringGuide — v37 correction: the host-path-grants section states the MEASURED posture, not a hardcoded claim (DES-258 owner ruling, ARCH-181)', () => {
  it('under a "confined" posture, states Bash IS confined to the run workspace (unqualified) and says nothing about being unconfined', () => {
    const text = buildAuthoringGuide({ ...CEILINGS, confinementPosture: 'confined' });
    const section = text.slice(text.search(/host path grants/i));
    expect(section).toMatch(/may write inside the run workspace and nowhere else/i);
    expect(section).not.toMatch(/not confined/i);
  });

  it('under an "unconfined" posture, states PLAINLY that Bash is not confined, that a local run still executes that way, and that a remote submission is refused', () => {
    const text = buildAuthoringGuide({ ...CEILINGS, confinementPosture: 'unconfined' });
    const section = text.slice(text.search(/host path grants/i));
    expect(section).toMatch(/\bnot confined\b/i);
    expect(section).toMatch(/local(ly)?[\s-]?submitted/i);
    expect(section).toMatch(/remote/i);
    expect(section).toMatch(/refus/i);
    // never describe posture (C) as isolation
    expect(section).not.toMatch(/\bisolat/i);
  });

  it('with no posture in scope (the generated static docs/AUTHORING.md, built before any host boots), describes BOTH postures and points to the live tool for the real answer — never asserts one', () => {
    const text = buildAuthoringGuide(CEILINGS);
    const section = text.slice(text.search(/host path grants/i));
    expect(section).toMatch(/confined/i);
    expect(section).toMatch(/\bnot confined\b/i);
    expect(section).toMatch(/workflow_authoring_guide/);
  });

  it('LOAD-BEARING: the guide never asserts unconditional confinement when THIS deployment\'s real, unmocked boot probe measures unconfined (fails red if the posture is not threaded through)', () => {
    const { posture } = probeConfinement();
    const text = buildAuthoringGuide({ ...CEILINGS, confinementPosture: posture });
    const section = text.slice(text.search(/host path grants/i));
    if (posture === 'unconfined') {
      expect(section).toMatch(/\bnot confined\b/i);
      expect(section).not.toMatch(/may write inside the run workspace and nowhere else/i);
    } else {
      expect(section).toMatch(/may write inside the run workspace and nowhere else/i);
    }
  });
});

// issues #81/#83: the guide never said how a declared skill is activated, and its only skills
// example paired the skill with `allowedTools: ['Read', 'Edit']` — which made it look like a
// skill needs file tools to be read. It does not: the engine puts the SDK's Skill tool on the
// agent's surface for its declared skills (tests/unit/sdk-gateway-skill-exposure.test.ts).
describe('the guide teaches how declared skills reach the model (#81/#83)', () => {
  it('states the Skill-tool activation, that no file tools are needed, and that only declared skills activate', () => {
    const text = buildAuthoringGuide(CEILINGS);
    expect(text).toMatch(/activates? .*through the Skill tool/i);
    expect(text).toMatch(/do not list `Skill` in `allowedTools`/i);
    expect(text).toMatch(/grants no file tools/i);
    expect(text).toMatch(/Only the agent's own declared skills/i);
    expect(text).toMatch(/skillsExposed/);
  });

  it('the skills example is a skill-only agent (allowedTools: []) — the shape a reader would doubt works', () => {
    const ex = (GUIDE_EXAMPLES as Array<{ title: string; script: string; mermaid: string }>).find((e) => e.title === 'skills and mcp');
    expect(ex, 'the skills example is missing').toBeDefined();
    expect(ex!.script).toMatch(/skills: \['repo-search'\]/);
    expect(ex!.script).toMatch(/allowedTools: \[\]/);
    expect(ex!.mermaid).toMatch(/tools: none/);
  });
});
