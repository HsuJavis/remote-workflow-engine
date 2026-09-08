// UT-159 (DES-157, v24): buildAuthoringGuide(inputs) — pure over resolved ServerConfig ceilings;
// GUIDE_EXAMPLES; every ERROR_CATALOG-key-shaped token traced, every tool name real, no model
// alias in any example script. Written test-first (Gate 5, RED) — src/authoring-guide.ts does
// not exist yet.
import { describe, it, expect } from 'vitest';
import { buildAuthoringGuide, GUIDE_EXAMPLES } from '../../src/authoring-guide.js';
import { SHAPES, EDGE_FORMS } from '../../src/check-mermaid.js';

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

  it('disambiguates the three layers by their real names, since guessing between them is the defect', () => {
    // per-call `allowedTools` > agentType frontmatter `tools` > config `defaultAllowedTools`
    expect(text).toMatch(/defaultAllowedTools/);
    expect(text).toMatch(/agentType/);
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
