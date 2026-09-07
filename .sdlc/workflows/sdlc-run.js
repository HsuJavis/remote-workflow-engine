export const meta = {
  name: 'sdlc-run',
  description: 'Drives iso-agile-sdlc Gate 2→8 (Gate 0 exploration & Gate 1 clarification are handled by the orchestrator in the main conversation, since they need user dialogue). v2.0 gate-as-workflow: pass args.gate (architecture|design|tests|impl|verify|validation|review) to run exactly ONE gate as its own workflow invocation with its documented input/output doc contract + structured report, or args.gates=[...] for an impact-scoped subset (iteration path); no args.gate runs the full sequence. v2.0 model policy: per-task models come from a policy table overridable via args.models — gates never inherit the parent conversation model. Roles run on the GENERIC agents (executor/researcher/reviewer/explorer) each reading its role contract file from references/contracts/. Architecture/design decided via grouped-expert debate panels (round 2 runs only when round-1 stances conflict); Gate 3 tasks are written by the design synthesizer (merged dispatch); implementation parallelizes implementers in task chunks + integrate; includes red-green self-repair; Gate 7 = /simplify cleanup then full regression (merged); a Validation gate (7.5) boots the real system, enforces the mock hard-rule (each REQ needs a real-tier green, mock-only=unverified) and writes human README/DEPLOY from the actual run; review has grouped architecture experts checking consistency vs Gate 2 on the touched files. v1.23 adaptive tiering right-sizes the process: a lean tier (small/low-risk/single-area QM feature) lets the role agents self-decide Gate 2/4 with no panel and Gate 8 skip the arch experts, while the TDD gates + Gate 7.5 real-run always stay full and a lean gate can self-escalate to a panel; non-QM is always full. v1.25 adds a fix mode (args.mode=fix, via /sdlc-fix) that runs a compressed F1–F6 iteration for a bug/small change on an existing feature (impact-design delta → test-first RED → GREEN → full regression → validate touched REQs → review-lite), reusing the same engine/watchdog; QM-only, TDD + real-run never scale down. Each role uses plugin agents/sdlc-* (agentType). Per-phase token cost is logged (cost observability).',
  whenToUse: 'After requirements (01-requirements.md) are finalized (brownfield also needs Gate 0 exploration done), run Gate 2→8 end to end and report consistency.',
  phases: [
    { title: 'Precheck' },
    { title: 'Architecture' },
    { title: 'Design' },
    { title: 'Test-first RED' },
    { title: 'Implement GREEN' },
    { title: 'Test fix' },
    { title: 'Verify' },
    { title: 'Validation' },
    { title: 'Review' },
  ],
}

// ── Args ───────────────────────────────────────────────
// args = { feature: 'features/001-login', skillDir?: '.claude/skills/iso-agile-sdlc' }
log(`received args = ${JSON.stringify(args)} (type=${typeof args})`)
let A = args || {}
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { A = { feature: A } } // tolerant: args may arrive as a JSON string
}
const FEATURE = A.feature
const SKILL = A.skillDir || '.claude/skills/iso-agile-sdlc'
if (!FEATURE) {
  return { error: 'args.feature is required, e.g. { feature: "001-login" } or "features/001-login"' }
}
// SDLC = this feature's ledger (docs) dir. New layout: .sdlc/features/<id>; old: <feature>/sdlc.
// The command passes args.sdlcDir explicitly (only it can probe the filesystem); fall back to old layout.
const SDLC = A.sdlcDir || `${FEATURE}/sdlc`
// trace launcher (resolves python3/python/py + caches): new layout shares one at <root>/.sdlc/trace; old at <ledger>/trace.
// Invoke as `sh ${TRACE} ...` so we never assume `python3` exists on the host.
const _si = SDLC.indexOf('.sdlc/')
const TRACE = _si >= 0 ? `${SDLC.slice(0, _si)}.sdlc/trace` : `${SDLC}/trace`
// Plugin agents are namespaced in the registry (plugin:name). Default prefix iso-agile-sdlc:;
// if your install namespace differs, pass args.agentPrefix to override (e.g. '' for bare names).
const AGENT_NS = (A.agentPrefix !== undefined) ? A.agentPrefix : 'iso-agile-sdlc:'
const AT = (n) => `${AGENT_NS}${n}`
// v2.0: roles run on GENERIC agents; the gate prompt names the role-contract file to read first.
const CONTRACT = (role) => `${SKILL}/references/contracts/${role}.md`

// ── Model policy (v2.0, dynamic — nothing is hardcoded to a dated model id) ──
// Models are chosen PER TASK from a two-layer policy — a gate never inherits the caller's model,
// and no concrete model id is pinned in this script (environments differ: local Claude Code,
// open-source backends, future model families).
//   layer 1  task key → CAPABILITY TIER (strong / mid / fast):
//     decision-heavy gates (arch/design synthesis, adversarial panel, safety) → strong;
//     mechanical execution (tests/implement/verify/validate/review) → mid;
//     cheap checks (referee / precheck / output-verify) → fast.
//   layer 2  tier → CONCRETE MODEL, resolved at run time:
//     args.modelTiers (the launching command probes the ENVIRONMENT for the currently-available
//     models and passes {strong,mid,fast}) → else the host's
//     version-agnostic aliases ('opus'/'sonnet'/'haiku'), which the runtime maps to its CURRENT models.
// Per-task override: args.models values may be a tier name OR any concrete model id
// (e.g. { implement: 'my-local-qwen', design_synth: 'strong' }); the command reads
// state.yaml `model_policy:` and passes it as args.models.
// v2.2 SCALE (S/M/L/XL): measured by scale_probe at Gate 0, recorded in state.yaml scale:, passed as
// args.scale. S→lean, M→full (tier mapping unchanged); L/XL additionally REQUIRE module build contracts
// (ARCH build:/selftest:), the 02 Feature model section, and module_check at Gate 6.5+7.
const SCALE = (A.scale || 'M').toUpperCase()
const IS_LARGE = SCALE === 'L' || SCALE === 'XL'
const SCALE_RULE = IS_LARGE
  ? `SCALE(${SCALE} — large system): every ARCH module MUST declare build: (one command that builds ONLY that module) + selftest: (module-scoped tests); switchable capabilities go in the 02 "Feature model" section as FLAG-* (default/depends) referenced by ARCH flag:; trace --check enforces 旗標斷鏈/旗標循環/旗標依賴倒置 and module_check verifies independent builds + the all_off/all_on build matrix.`
  : ''
const TIERS = { strong: 'opus', mid: 'sonnet', fast: 'haiku', ...(A.modelTiers && typeof A.modelTiers === 'object' ? A.modelTiers : {}) }
const MODEL_POLICY = {
  arch_synth: 'strong',       // Gate 2 synthesizer/decider
  design_synth: 'strong',     // Gate 3+4 synthesizer/decider
  panel_adversarial: 'strong',
  panel_quality: 'mid',
  safety: 'strong',           // non-QM safety/cybersec lenses & reviews
  tests: 'mid',               // Gate 5 test-first author
  implement: 'mid',           // Gate 6 implementers + integrator
  partition: 'mid',           // Gate 6 batch dispatcher
  verify: 'mid',              // Gate 6.5+7
  validate: 'mid',            // Gate 7.5
  review: 'mid',              // Gate 8 synthesizer
  cheap: 'fast',              // referee / precheck / output-verify
  ...(A.models && typeof A.models === 'object' ? A.models : {}),
}
const M = (k) => { const v = MODEL_POLICY[k] || 'mid'; return TIERS[v] || v } // tier name → resolve; concrete id → pass through

// ── ISO 26262/21434 safety tailoring ──────────────────────
// QM(default) ⇒ behaviour is byte-identical to before. Non-QM ⇒ +2 expert lenses (functional-safety
// 26262 + cybersecurity 21434) on every panel/single-agent gate, and trace.py enforces SG/CG/SAN gates.
// safety_class comes from state.yaml (set at Gate 1.5); the launching command passes it as args.safetyClass.
const SAFETY = (A.safetyClass || 'QM').toUpperCase().replace('ASIL-', '')
const IS_SAFETY = SAFETY !== 'QM' && SAFETY !== ''
const SAFETY_RULE = IS_SAFETY
  ? `SAFETY(ASIL-${SAFETY}): this feature is safety/security-relevant. Every safety/security ARCH/DES/test traces back to a Safety Goal SG-* or Cybersecurity Goal CG-* in 00-safety.md; architecture/design produce the analysis work products as SAN-* (FMEA/FTA/DFA/TARA attack-paths); ASIL C/D requirements need real:true (non-mock) verification. trace.py flags 缺安全概念/缺安全分析/缺安全目標/安全驗證不足 as gaps.`
  : ''

// ── v2.0 delta scoping (right-sized iteration; /sdlc-triage routes here) ──
// impactIds + iteration WITHOUT mode:'fix' turn the selected gates into an IN-PLACE delta on an
// existing feature: update items inside the closure, bump iter:, never fork the namespace. Combined
// with args.gates this is the middle path between /sdlc-fix (F1–F6) and a full re-run — e.g. an
// arch-touching change runs gates:['architecture','design','tests','impl','verify','validation','review']
// but each gate edits ONLY the closure instead of re-decomposing the system.
// ── v2.4.1 send-back repair scoping (issue #16) ────────────
// While Gate 8's auto re-run repairs the gates listed in send_back, this context is non-null and every
// gate prompt carries a REPAIR rule scoped to the review's named findings — the re-run must NOT redo
// the whole gate (observed twice: an unscoped impl re-run re-partitioned ALL TASKs and fanned out ~10
// zero-change implementers). The impl runner additionally skips partition/fan-out entirely.
let SENDBACK_CTX = null
const SENDBACK_RULE = () => SENDBACK_CTX
  ? `SEND-BACK REPAIR RUN (Gate 8 blocking findings): fix ONLY the findings listed here — ${SENDBACK_CTX.findings.filter(Boolean).map((f, i) => `(${i + 1}) ${f}`).join(' ')} — update the touched items/code in place and bump their iter:. Do NOT redo the rest of the gate: no re-decomposition, no re-partitioning, no re-running work that was not named blocking. If a finding turns out to require broader changes than named, STOP and return needs_clarification instead of expanding scope.`
  : ''

const DELTA_IDS = (A.mode !== 'fix' && A.impactIds) ? (Array.isArray(A.impactIds) ? A.impactIds.filter(Boolean) : [A.impactIds]) : []
const DELTA_RULE = DELTA_IDS.length
  ? `DELTA ITERATION on an EXISTING feature — impact closure: ${DELTA_IDS.join(', ')}; iteration ${A.iteration || 'vNext'}. Work ONLY within the closure: UPDATE existing items in place and bump their iter: (docs and code are two faces of the same iteration), do NOT open a new ledger or ID namespace, keep every existing trace link intact. If the change outgrows the closure, STOP and return needs_clarification instead of silently expanding scope.`
  : ''

// ── Structured report schemas ──────────────────────────
const GATE = {
  type: 'object',
  properties: {
    passed: { type: 'boolean', description: 'whether the exit Gate passed' },
    completed_ids: { type: 'array', items: { type: 'string' } },
    gate_check: { type: 'string', description: 'trace.py self-check summary' },
    needs_clarification: {
      type: 'array', items: { type: 'string' },
      description: 'things needing a user/product/technical decision you cannot make alone; empty array if none',
    },
    owner_decisions: {
      type: 'array', items: { type: 'string' },
      description: 'PRODUCT decisions you deferred to the owner in a document (e.g. an ADR): one string each, same text as the item\'s `- **owner_decision:** pending — …` metadata. MUST mirror every pending marker you wrote — a deferral that exists only in prose is a contract violation (an unmarked deferral counts as YOUR decision). Empty array = explicit attestation none were deferred. Unlike needs_clarification this does NOT stop the run; the workflow collects and surfaces them.',
    },
    test_defects: {
      type: 'array',
      description: '(implementation stage only) tests judged "the test itself is wrong" rather than code wrong; empty otherwise',
      items: {
        type: 'object',
        properties: {
          test_id: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' },
        },
        required: ['test_id', 'problem', 'fix'],
      },
    },
  },
  required: ['passed', 'completed_ids', 'gate_check', 'needs_clarification', 'test_defects', 'owner_decisions'],
}
// Experts write the full proposal to a file and return only a pointer — context via files, not prompt text.
const PROPOSAL = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    file: { type: 'string', description: 'path of the proposal file you wrote' },
    headline: { type: 'string', description: 'one-line conclusion (for the log only, not for passing context)' },
  },
  required: ['lens', 'file', 'headline'],
}
const REVIEW = {
  type: 'object',
  properties: {
    gaps_high: { type: 'number' }, gaps_mid: { type: 'number' }, gaps_low: { type: 'number' },
    drift: { type: 'string', description: 'doc↔code drift summary' },
    arch_consistent: { type: 'boolean', description: 'whether implementation matches the Gate 2 architecture decisions (consolidated from N architecture experts)' },
    arch_violations: { type: 'array', items: { type: 'string' }, description: 'where it violates/deviates from the architecture decisions; empty if none' },
    owner_decisions: { type: 'array', items: { type: 'string' }, description: 'UNANSWERED owner_decision: pending markers found anywhere in the ledger at review time (reconcile the metadata key mechanically — never by grepping prose phrases); [] = all answered/none' },
    send_back: { type: 'array', items: { type: 'string', enum: ['architecture', 'design', 'tests', 'impl', 'verify', 'validation'] },
      description: 'BLOCKING findings only — the gate(s) that must re-run to fix them. In the full run the workflow AUTO RE-RUNS each listed gate ONCE and then re-reviews; still-blocking after that hands back to the orchestrator. Non-blocking findings go to recorded tech debt with send_back=[] (the iteration closes).' },
    blocking_findings: { type: 'array', items: { type: 'string' },
      description: 'REQUIRED NON-EMPTY whenever send_back is non-empty (issue #16): one entry per blocking finding, each actionable on its own — "<ID or file>: <what is wrong> → <what fixed looks like>". These are handed VERBATIM to the repair agent as its ONLY scope, so a finding not listed here will NOT be fixed (prose in conclusion is never parsed — same structured-channel rule as issue #15). [] when send_back is [].' },
    conclusion: { type: 'string', description: 'can close / send back to which Gate (must agree with send_back)' },
  },
  required: ['gaps_high', 'gaps_mid', 'gaps_low', 'drift', 'arch_consistent', 'arch_violations', 'owner_decisions', 'send_back', 'blocking_findings', 'conclusion'],
}
// Gate 7.5 Validation: real-run grounding + mock census + human handover docs
const VALIDATION = {
  type: 'object',
  properties: {
    passed: { type: 'boolean', description: 'true only if every REQ has a real-tier green and the system booted from docs only' },
    completed_ids: { type: 'array', items: { type: 'string' }, description: 'real:true green VAL/E2E ids' },
    booted_from_docs_only: { type: 'boolean', description: 'system came up using only documented steps (no undocumented manual fix)' },
    real_tier: { type: 'array', description: 'per-REQ real-run result',
      items: { type: 'object',
        properties: { req: { type: 'string' }, status: { type: 'string', description: 'pass | fail | unreachable-dep' }, evidence: { type: 'string' } },
        required: ['req', 'status', 'evidence'] } },
    mock_census: { type: 'string', description: 'trace.py result: verified-real=N / mock-only=M / unverified=K' },
    docs_written: { type: 'array', items: { type: 'string' }, description: 'human handover docs written, e.g. README.md, DEPLOY.md' },
    owner_decisions: { type: 'array', items: { type: 'string' }, description: 'product decisions deferred to the owner (mirror of any owner_decision: pending markers written); [] = none' },
    unreachable_deps: { type: 'array', items: { type: 'string' }, description: 'real dependencies that could not be reached (explicit gaps, not mock-passed)' },
    gate_check: { type: 'string' },
    needs_clarification: { type: 'array', items: { type: 'string' } },
  },
  required: ['passed', 'completed_ids', 'booted_from_docs_only', 'real_tier', 'mock_census', 'docs_written', 'unreachable_deps', 'gate_check', 'needs_clarification', 'owner_decisions'],
}
// Parallel implementation: split TASKs into parallel-safe batches
const BATCHES = {
  type: 'object',
  properties: {
    batches: { type: 'array', description: 'array of batches; within a batch TASKs are independent with non-overlapping files (parallelizable); batches run in order',
      items: { type: 'array', items: { type: 'string' } } },
    note: { type: 'string', description: 'batching rationale (dependency/file-overlap considerations)' },
  },
  required: ['batches', 'note'],
}
// Parallel-implementer report (data only, no shared-doc writes; the integrator writes 06-impl-log)
const PARIMPL = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    impls: { type: 'array', description: 'IMPL items this implementer completed',
      items: { type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' }, files: { type: 'string' }, greens: { type: 'string' } },
        required: ['id', 'title', 'files', 'greens'] } },
    test_defects: GATE.properties.test_defects,
    gate_check: { type: 'string' },
    needs_clarification: { type: 'array', items: { type: 'string' } },
  },
  required: ['passed', 'impls', 'test_defects', 'gate_check', 'needs_clarification'],
}
// Architecture-consistency check (Gate 8's N experts; context via files, return a pointer only)
const ARCHCHECK = {
  type: 'object',
  properties: {
    lens: { type: 'string' }, file: { type: 'string', description: 'the report file written' },
    consistent: { type: 'boolean' }, violations: { type: 'number', description: 'number of inconsistencies found' },
  },
  required: ['lens', 'file', 'consistent', 'violations'],
}

// ── Architecture/design expert lenses (grouped-agent debate to decide) ──
// Karpathy simplicity-first discipline: the FULL guideline text lives in ONE place —
// agents/sdlc-{architect,designer,verifier,implementer}.md (their system prompts). Since every gate/synth
// runs via agentType, each agent already carries the full wording; prompts here invoke it BY REFERENCE
// (v1.21 dedup — previously the full text was embedded 5+ times and re-paid by every agent).
const KARPATHY_SUFFIX = ' Apply the Karpathy simplicity-first discipline from your role contract throughout (think before coding, surface trade-offs; minimum code, nothing speculative; surgical changes only; goal-driven, verify until green).'
// v1.21 GROUPED PANELS: lenses are grouped into agents, not one-agent-per-lens (debate value lives in
// STANCE CONFLICT, not in process count). Every panel = 2 agents/round at QM:
//   A) the ADVERSARIAL group — lenses that genuinely trade off against each other;
//   B) the QUALITY-DIMENSIONS group — the 4 cross-cutting checklist dimensions (observability incl.
//      traceability / replaceability / consumability / self-sustainability), each read at BOTH the
//      system altitude AND the AI-agent altitude (judge from tech_stack which applies).
// The full per-lens wording is preserved verbatim inside the group prompts (grouped, not diluted).
// Non-QM only: a functional-safety (26262) + cybersecurity (21434) pair, appended to every panel.
// QM ⇒ SAFETY_LENSES is [] so the panels/review are unchanged.
const SAFETY_LENSES = IS_SAFETY ? [
  { key: 'fsafety',  model: M('safety'), lens: `Functional-safety expert (ISO 26262, ASIL-${SAFETY}): safety reqs trace to Safety Goals SG-*; own FMEA/FTA/DFA as SAN-*; freedom-from-interference between ASIL & QM parts; failure detection & safe state; verification rigor scaled to ASIL (C/D need real-tier + structural coverage).` },
  { key: 'cybersec', model: M('safety'), lens: 'Cybersecurity expert (ISO 21434 spirit): run TARA — assets/threats/attack-paths; Cybersecurity Goals CG-* + controls; trust boundaries & attack surface; fuzz/pen tests; rigor scaled to CAL.' },
] : []
const CROSSCUT_GROUP = { key: 'quality-dimensions', model: M('panel_quality'), lens: [
  'Quality-dimensions expert — you carry FOUR cross-cutting dimensions in one review; produce ONE clearly-headed section per dimension (all four, explicitly — a skipped dimension is a defect):',
  '(1) Observability — transparency of internal state (folds in traceability). System: logs / metrics / distributed traces so a request path is followable end-to-end and a bottleneck is locatable in seconds. Agent: its chain-of-thought, token usage, and tool-call sequence must be inspectable — never a black box. Goal: internal state observable at any time, feeding automated ops. A silent/opaque failure is a design defect — design the observable seam.',
  '(2) Replaceability — decoupling & pluggability. System: loosely-coupled, plug-and-play modules via interfaces / dependency injection (e.g. swap MySQL→PostgreSQL without rewriting business logic). Agent: the LLM backend is decoupled so GPT↔Claude↔a local model (Llama) is a config change, not a rewrite. Goal: cut tech debt; keep pace with tech iteration; no single-vendor/tech lock-in.',
  '(3) Consumability — ease of use & low integration cost (interface friendliness). System: standardized REST/GraphQL API with generated docs (OpenAPI/Swagger) so callers integrate fast. Agent: structured, well-typed I/O (JSON) + a clear SDK so other software can invoke its reasoning like an ordinary function. Goal: minimize the caller\'s learning curve & integration cost; maximize reuse of the software asset.',
  '(4) Self-sustainability — closed-loop autonomy & lifecycle management. System: autoscaling, self-healing (restart a bad instance), circuit-breaker / graceful degradation under extreme load. Agent: memory metabolism (periodically compress/archive long-term memory to avoid context blow-up), tool-liveness checks (probe an API still works), self-reflection / prompt calibration to environment change. Goal: minimize human intervention; design for long-term autonomous survival & adaptation.',
].join(' ') }
const ARCH_LENSES = [
  { key: 'adversarial', model: M('panel_adversarial'), lens: [
    'Adversarial architecture group — you carry THREE lenses that trade off against each other; argue each and surface the internal conflicts explicitly:',
    '(a) Security: authn/authz correctness, secret protection, attack surface (brute force, JWT forgery, timing attacks).',
    '(b) Scalability/performance: state storage, horizontal scaling, concurrency & consistency of failure counting.',
    '(c) Testability: clear module boundaries, injectable dependencies, easy to write unit/integration tests.',
    'Also apply the Karpathy simplicity-first discipline as your tie-breaker (minimum architecture that solves the problem, nothing speculative).',
  ].join(' ') },
  CROSSCUT_GROUP,
  ...SAFETY_LENSES,
]
const DES_LENSES = [
  { key: 'adversarial', model: M('panel_adversarial'), lens: [
    'Adversarial design group — you carry THREE lenses that trade off against each other; argue each and surface the internal conflicts explicitly:',
    '(a) Interface-contract: clear API/function signatures, input/output types, compatibility.',
    '(b) Boundary/error: failure modes, error codes, completeness of boundary conditions.',
    '(c) Testability: every DES coverable by a UT, clock/storage injectable.',
    'Also apply the Karpathy simplicity-first discipline as your tie-breaker (minimum design that solves the problem, no needless flexibility).',
  ].join(' ') },
  CROSSCUT_GROUP,
  ...SAFETY_LENSES,
]

// ── Stage descriptors ──────────────────────────────────
// v2.0: role gates run on GENERIC agents (agentType) + a role-CONTRACT file the prompt orders them to
// read first (single source of the role text), + a policy model (never inherited from the caller).
const S_ARCH   = { phase: 'Architecture', gate: 'architecture', next: 'design', agentType: AT('executor'), contract: CONTRACT('architect'), model: M('arch_synth'), rounds: 2,
                   scope: 'Decompose all REQs in 01-requirements.md (functional AND kind:nfr — non-functional requirements get architecture too: where do the logs/healthcheck/limits live) into a Software Architecture Document (SAD): ARCH-* modules (each traces back to its REQ, with module:/deps: metadata for solid_check; on L/XL scale also build:/selftest:/flag: per the SCALE rule), FLAG-* feature model for switchable capabilities, ADR-* records for contested technology choices, 4+1-view mermaid diagrams + data architecture + API contracts per the 02-architecture template', lenses: ARCH_LENSES }
// v1.21: Gate 3 (tasks) is MERGED into the design dispatch — the designer/synthesizer writes 03-tasks.md
// then 04-design.md in one pass (the task layer is a thin ARCH→DES bridge; a separate dispatch re-paid
// a full agent boot + doc reread for it). TASK ids/format/traces are unchanged; trace.py sees no difference.
const S_DESIGN = { phase: 'Design', gate: 'design', next: 'tests', agentType: AT('executor'), contract: CONTRACT('designer'), model: M('design_synth'), rounds: 2,
                   scope: 'FIRST (merged Gate 3) break all ARCH into independently-implementable TASKs and write them to 03-tasks.md (each TASK traces back to its ARCH, estimate S/M/L; every ARCH gets ≥1 TASK; also set state.yaml gates.tasks.passed=true); THEN write DES for key TASKs (interfaces/data/boundaries, testable) to 04-design.md. **Keep 04-design LEAN**: each DES holds implementable specifics only — signature / schema / boundary-conditions — do NOT restate requirements or write long prose; put any lengthy trade-off reasoning in ONE file-end "## Decision rationale". Downstream implementers grep 04-design for their TASK ids and read only the matching DES, so a bloated design re-pays tens of k tokens on every implementer/verifier read.', lenses: DES_LENSES }
const S_TESTS  = { phase: 'Test-first RED', gate: 'tests', next: 'impl', agentType: AT('executor'), contract: CONTRACT('verifier'), model: M('tests'),
                   scope: '[Mode A test-first] before implementation write UT/IT/E2E/VAL, status:red, result:fail, confirm red because unimplemented' + KARPATHY_SUFFIX }
const S_IMPL   = { phase: 'Implement GREEN', gate: 'impl', next: 'verification', agentType: AT('executor'), contract: CONTRACT('implementer'), model: M('implement'),
                   scope: '[GREEN→REFACTOR] minimal code to turn red tests green, then refactor staying green; IMPL records greened tests via greens' + KARPATHY_SUFFIX }
// v1.21: Gate 6.5 (/simplify) is MERGED into the Gate 7 dispatch — one agent does simplify-then-regression
// (a separate simplify agent re-ran the full suite that Gate 7 immediately re-ran again).
const S_VERIFY = { phase: 'Verify', gate: 'verification', next: 'validation', agentType: AT('executor'), contract: CONTRACT('verifier'), model: M('verify'),
                   scope: '[merged Gate 6.5+7] FIRST apply the /simplify spirit to the code implemented at Gate 6 (reuse/simplification/efficiency/altitude cleanup; QUALITY ONLY, no behavior change; use the Skill tool to call simplify if available, else simplify manually by its principles; if code changed update the matching IMPL-* in 06-impl-log.md; revert any cleanup that goes red); THEN [Mode B regression] run the FULL regression, add system-level IT/E2E/VAL, mark passing green/pass; THEN [coverage gate] measure UT/IT line coverage over layout.src — every function/method (>5 lines) must be ≥ 95%, short functions (≤5 lines) may miss at most 1 line, and the whole tree must be ≥ 90% (state.yaml coverage: overrides); a shortfall means WRITE the missing tests (logged in 05-tests.md) and re-measure, never pass under the bar; report overall % + worst per-function offenders in gate_check; THEN [module gate, dormant unless ARCH declares build:] run \`sh <trace> --tool module_check <ledger> --selftest --matrix\` — every module must build independently and the all_off/all_on matrix must pass; a failure is a gate failure (fix the module boundary, never delete the build: contract to pass)' + KARPATHY_SUFFIX }
const S_VALIDATE = { phase: 'Validation', gate: 'validation', next: 'review', agentType: AT('executor'), contract: CONTRACT('validator'), model: M('validate'),
                     scope: '[Gate 7.5 real-run] boot the real system from documented steps, exercise each REQ against real wiring (no SUT-boundary mock), write 08-validation.md + human README/DEPLOY' }

// ── Prompt generators ──────────────────────────────────
const baseRules = (s) => [
  ...(SENDBACK_CTX ? [SENDBACK_RULE()] : []),
  ...(DELTA_RULE ? [DELTA_RULE] : []),
  `Feature workspace: ${FEATURE} (docs ${SDLC}/; code/test locations in ${SDLC}/state.yaml layout; tech stack in tech_stack — follow it, don't pick your own).`,
  `OWNER-DEFERRAL RULE (issue #15): a decision you must NOT take yourself (a product call, anything "owner-overrulable") goes into BOTH structured channels — (a) on the item: \`- **owner_decision:** pending — <the exact question>\` (fixed metadata key, language-independent, trace.py parses it and BLOCKS Gate 8 while unanswered), and (b) your report's owner_decisions array (same text). Prose-only deferral is a contract violation: an unmarked deferral counts as YOUR OWN decision and you carry it at review.`,
  `Work-item format (trace.py parses it; metadata MUST be "- **key:** value" bold-colon, NOT plain "key: value"): one "### <ID> — <title>" level-3 heading per item, followed by lines like "- **status:** …", "- **traces:** <upstream IDs, comma-separated>", "- **iter:** v1"; write into the matching ${SDLC}/0X file.`,
  `When done, self-run \`sh ${TRACE} ${SDLC}\` (add --check at verification); confirm the exit Gate and no new gaps.`,
  `On Gate pass, update ${SDLC}/state.yaml: gates.${s.gate}.passed=true, current_stage=${s.next}, updated; append a line to ${SDLC}/journal.md. This is your job, not a clarification.`,
  ...(SAFETY_RULE ? [SAFETY_RULE] : []),
  ...(SCALE_RULE ? [SCALE_RULE] : []),
]

const gatePrompt = (s) => [
  `You are the "${s.phase}" subagent of the iso-agile-sdlc workflow.`,
  `1. READ YOUR ROLE CONTRACT FIRST${s.contract ? `: ${s.contract}` : ''} — then execute strictly per it (inputs→actions→outputs→exit-Gate self-check→report format).`,
  // issue #16: during a send-back repair the normal gate objective is SUSPENDED — a contradictory
  // "do the whole gate" line here is exactly what weak executors follow instead of the repair rule.
  `2. This scope: ${SENDBACK_CTX ? `**SUSPENDED — SEND-BACK REPAIR RUN.** Your ONLY objective is the SEND-BACK REPAIR rule below (fix the listed findings, nothing else). The normal scope, for role context only, was: ${s.scope}` : s.scope}.`,
  ...baseRules(s).map((t, i) => `${i + 3}. ${t}`),
  `${baseRules(s).length + 3}. Report GATE: passed, completed_ids, gate_check; needs_clarification only for user/product/technical decisions (process & state maintenance don't count), else empty.`,
  `${baseRules(s).length + 4}. test_defects (implementation stage only): if a test fails but you judge "the test itself is wrong" not your code — don't change the test, don't fudge the code; list {test_id,problem,fix} and the workflow auto-routes it back to the verifier; empty for other stages.`,
].join('\n')

// v1.23 LEAN tier: for small/low-risk/single-area QM features the role agent DECIDES the gate itself —
// no adversarial panel is spawned. It self-applies the same lenses (as a checklist), and if it hits a
// genuine cross-cutting conflict it can't resolve alone it ESCALATES via needs_clarification=['request-panel: …'];
// the workflow then re-runs THIS gate as a full panel (quality fail-safe #2). This is DISTINCT from the
// no-Agent-tool degraded fallback: here the agent CAN spawn but is trusted to self-review at lean scale.
const leanGatePrompt = (s) => [
  `You are the "${s.phase}" decider of the iso-agile-sdlc workflow, running in LEAN tier — this is a small, low-risk, single-area feature, so NO expert panel is spawned; you self-apply the review lenses as a checklist and decide.`,
  `1. READ YOUR ROLE CONTRACT FIRST${s.contract ? `: ${s.contract}` : ''} — then execute strictly per it (inputs→actions→outputs→exit-Gate self-check→report format).`,
  `2. This scope: ${SENDBACK_CTX ? `**SUSPENDED — SEND-BACK REPAIR RUN.** Your ONLY objective is the SEND-BACK REPAIR rule below (fix the listed findings, nothing else). The normal scope, for role context only, was: ${s.scope}` : s.scope}.`,
  `3. **Self-apply these lenses as a checklist** (you carry them yourself since no panel runs — for each, note in the item's note or a file-end "## Decision rationale" how you satisfied it; a silently-skipped lens is a defect):`,
  ...(s.lenses || []).map((L) => `   • ${L.lens}`),
  `4. **Escalation fail-safe**: if you hit a genuine cross-cutting trade-off you CANNOT resolve alone (two lenses materially conflict and choosing wrong is costly), do NOT guess — return needs_clarification=['request-panel: <one line naming what conflicts>'] and STOP; the workflow will re-run THIS gate as a full adversarial panel. Use this ONLY for real conflicts, not for ordinary judgement calls.`,
  ...baseRules(s).map((t, i) => `${i + 5}. ${t}`),
  `${baseRules(s).length + 5}. Report GATE: passed, completed_ids, gate_check; needs_clarification empty UNLESS you are escalating (a single 'request-panel: …' string) or a real user decision is needed; test_defects empty.`,
].join('\n')

// Debate round 1: each expert proposes independently → writes <lens>.r1.md
const panelProposePrompt = (s, L, dir) => [
  `You are an expert reviewer for the iso-agile-sdlc "${s.phase}" stage, lens: ${L.lens} This is debate round 1 (independent proposal).`,
  ...(L.ref ? [`First read your review basis: ${L.ref}, follow it throughout.`] : []),
  `First read ${SDLC}/01-requirements.md${s.gate === 'design' ? ` and ${SDLC}/02-architecture.md (03-tasks.md does NOT exist yet — the design synthesizer writes it; where task-splitting affects your lens, say so in your proposal)` : ''} and ${SDLC}/state.yaml tech_stack.`,
  `If your lens reads differently for a conventional software system vs an AI-agent system (the quality dimensions observability/replaceability/consumability/self-sustainability each have a "system" and an "agent" altitude), FIRST判斷 from tech_stack + requirements which this project is — a plain system, an AI-agent system, or both — and apply the fitting altitude(s); don't force the irrelevant one.`,
  `Write your full proposal to a file ${dir}/${L.key}.r1.md, containing: summary, key_points, risks, expected disagreements with other lenses.`,
  `**Context always via files**: don't stuff the full proposal into the report. Return PROPOSAL with only lens, file (=the path above), headline (one line).`,
].join('\n')

// Debate round N (N≥2): read the previous round, rebut/concede/hold, aim to converge → write <lens>.rN.md
const panelDebatePrompt = (s, L, dir, rnd) => [
  `You are an expert for the iso-agile-sdlc "${s.phase}" stage, lens: ${L.lens} This is debate round ${rnd}.`,
  ...(L.ref ? [`Follow your review basis: ${L.ref}.`] : []),
  `**First read all experts' previous-round proposals (*.r${rnd - 1}.md) under ${dir}/**, especially those conflicting with your stance.`,
  `For each disagreement state "rebut / concede / hold" with engineering reasons; integrate where you can, drop where you should — aim to converge, not talk past each other.`,
  `Write this round's stance to ${dir}/${L.key}.r${rnd}.md (responses to others, your final position, remaining disagreements).`,
  `**Context via files**: return PROPOSAL with only lens, file (=this round's file), headline (one line: converged on what / what's still disputed).`,
].join('\n')

const panelSynthPrompt = (s, dir, rounds) => [
  `You are the "${s.phase}" synthesizer/decider for iso-agile-sdlc${s.contract ? ` (READ YOUR ROLE CONTRACT FIRST: ${s.contract})` : ''}; produce the final doc.`,
  `The lens panel ALREADY RAN (its proposals are in ${dir}/) — synthesize from them only; do NOT spawn another panel.`,
  `**First read all rounds of expert proposals under ${dir}/** (round 1 *.r1.md through the final round ${rounds} *.r${rounds}.md)`,
  `${rounds > 1 ? '— favor the final round\'s converged stance, with the debate as supporting context — ' : ', '}digest the lenses, reconcile remaining conflicts, make engineering trade-offs, then decide:`,
  `1. This scope: ${s.scope}. For contested trade-offs, in the item's note or a "## Decision rationale" at the file end, record one line on why (including debate convergence: who conceded / why).${KARPATHY_SUFFIX} When two proposals deliver equal value, pick the simpler.`,
  ...baseRules(s).map((t, i) => `${i + 2}. ${t}`),
  `${baseRules(s).length + 2}. Report GATE: passed, completed_ids, gate_check, needs_clarification (user decisions only), test_defects (empty).`,
].join('\n')

const validatePrompt = (fixCtx) => [
  `You are the "Validation" subagent (Gate 7.5) of the iso-agile-sdlc workflow. READ YOUR ROLE CONTRACT FIRST: ${CONTRACT('validator')}.`,
  ...(fixCtx ? [`**FIX-MODE SCOPE**: ${fixCtx}`] : []),
  `1. Boot the real system using DOCUMENTED steps only; record every command. If a needed step isn't documented, fold it into DEPLOY.md (don't silently fix).`,
  `2. Exercise EACH REQ against real wiring and observe an externally-visible result. **Mock hard rule: at e2e/acceptance do NOT mock the SUT's own boundaries**; external tools via sandbox/test credentials.`,
  `3. A real dependency that genuinely can't be reached → record as an explicit gap in needs_clarification; do NOT pass the REQ on mock-only evidence.`,
  `4. Write ${SDLC}/08-validation.md: VAL/E2E items with **tier** + **real:true only when run against real wiring** + **evidence** (command + observed output). Set real:true on the test items you actually validated.`,
  `5. Write the human-facing 繁體中文 handover docs to state.yaml layout.readme + layout.deploy (the PRODUCT ROOT, e.g. README.md + DEPLOY.md at the repo root — NOT inside the .sdlc/ ledger), from the exact steps you ran (quickstart = the validation script; step-by-step, copy-paste runnable, healthcheck/rollback/troubleshooting in DEPLOY). **STYLE (human-facing)**: 淺顯易懂的繁體中文 — short sentences, no jargon without a one-line explanation; where structure/flow helps understanding, draw a simple ASCII diagram (架構框圖/流程箭頭) directly in the doc.`,
  `5c. **ONE-COMMAND DEPLOY (一鍵部署)**: DEPLOY.md MUST lead with a single command that brings the system up from a fresh checkout — a committed \`deploy.sh\` (or make target / single copy-paste line) that chains install→configure→start→healthcheck. You must ACTUALLY RUN it as part of this validation (it IS the boot-from-docs-only evidence); if any step can't be automated, the script stops with a clear message telling the human exactly what to do.`,
  `5a. **CURRENT-STATE RULE (supersede, don't append)**: README/DEPLOY are operation manuals for the system AS IT IS NOW — not a process log. If the files already exist (iteration), REWRITE each affected statement to describe only current behavior: delete or replace anything the current system no longer does (old commands, old keys, old ports, old defaults). NEVER leave "previously X / now Y" pairs, version-conditional instructions, or dead steps — a reader must follow the doc verbatim TODAY with zero historical filtering. Content about untouched features stays only because it is still true (your quickstart re-run proves it), not because it was there before. **The manuals contain NO history at all — no changelog, no version diffs, no migration notes**: everything historical (what changed per iteration, upgrade actions) lives ONLY in the .sdlc ledger (journal.md line + 08-validation iter entries; the dashboard's 迭代差異 tab and git history render the diffs).`,
  `5b. **Config-file sync check + single settings reference**: if the system has any config/settings files (e.g. config.toml / .env(.example) / settings.json / wrangler.jsonc / docker-compose / k8s manifests / systemd unit), CHECK whether THIS iteration's changes need them updated — new keys, secrets, defaults, ports, feature flags, dependencies. If so, update the file (and its committed .example/template) AND update the "## 設定總表 Configuration Reference" in DEPLOY.md — the SINGLE authoritative list of every key / secret-name / port / flag the system reads (one row per key: carrier=env/.env/config§/flag/port, purpose, type/default, required, iter last touched). Add rows for new keys, edit rows for changed ones, DELETE rows for removed ones; never document a key anywhere else in README/DEPLOY (other sections reference it by name — "見設定總表 <KEY>"). Cross-check BOTH directions: every key the code/config expects has a row, and every row still corresponds to a key the code reads. Also refresh "## 0. Quickstart" so it equals the exact boot sequence you just ran (the 一鍵部署 command first, then the expanded per-step sequence — one non-interactive command per step + its expected output/result so a human OR an agent can follow it verbatim; every placeholder must be a 設定總表 row). Never leave config drift where the code expects a key the config/docs don't mention. If no config files exist or none changed, say so explicitly.`,
  ...baseRules(S_VALIDATE).map((t, i) => `${i + 6}. ${t}`),
  `${baseRules(S_VALIDATE).length + 6}. self-run \`sh ${TRACE} ${SDLC} --check\`: confirm NO 未真實驗證(mock-only)/未驗證 gaps (exit 0).`,
  `Report VALIDATION: passed, completed_ids (real:true greens), booted_from_docs_only, real_tier (per REQ: req/status/evidence), mock_census (trace.py verified-real/mock-only/unverified), docs_written, unreachable_deps, gate_check, needs_clarification.`,
].join('\n')

const testerFixPrompt = (defects) => [
  `You are the iso-agile-sdlc "test-first author" (verifier mode A; role contract: ${CONTRACT('verifier')}), auto-routed back by the workflow to fix test defects.`,
  `Feature workspace: ${FEATURE} (docs ${SDLC}/; test locations in state.yaml layout; tech stack in tech_stack).`,
  `The implementer reported these tests as "wrong themselves" (the code matches the design, the test is the problem):`,
  ...defects.map((d, i) => `  ${i + 1}. ${d.test_id} | problem: ${d.problem} | suggested fix: ${d.fix}`),
  `Fix only these tests (per the suggestion or an equivalent better fix) so they correctly reflect the DES/REQ intent; do not loosen them to always-pass, do not delete tests.`,
  `After fixing, run them to confirm they should be green against the implemented feature; update result in ${SDLC}/05-tests.md.`,
  `Report GATE: passed (tests fixed and decidable), completed_ids (fixed tests), gate_check (test run summary), needs_clarification (only if a user decision is still needed, else empty), test_defects (empty).`,
].join('\n')

// ── Gate 6 parallel implementation ──
const partitionPrompt = () => [
  `You are the iso-agile-sdlc implementation dispatcher (role contract: ${CONTRACT('task-planner')}, Gate 6 dispatcher section). Read ${SDLC}/03-tasks.md and ${SDLC}/04-design.md and split TASKs into "parallel-safe" batches.`,
  `Rule: TASKs in the same batch must be mutually independent and expected to change non-overlapping source files (implementable concurrently); put dependent or shared-file tasks in different batches, run batches in order.`,
  `Report batches (array of arrays of TASK ids) and note (rationale). If all independent, one batch; if all dependent, one per batch.`,
].join('\n')

const parImplPrompt = (taskIds) => [
  `You are an iso-agile-sdlc implementer (READ YOUR ROLE CONTRACT FIRST: ${CONTRACT('implementer')}), **responsible only for these TASKs: ${taskIds.join(', ')}** (non-overlapping files vs other parallel implementers); do red→green→refactor.`,
  `Feature workspace: ${FEATURE} (code location in ${SDLC}/state.yaml layout.src; tests in layout.tests; tech stack in tech_stack).`,
  `**Read only your design slice (04-design.md can be large — reading it whole re-pays tens of k tokens per implementer):** grep ${SDLC}/04-design.md for your TASK ids (${taskIds.join(', ')}) to locate the DES-* whose "traces:" include them, and read ONLY those DES entries (plus any DES they directly reference at a module boundary). Do NOT read the whole 04-design.md.`,
  `Write only your TASKs' code to turn their red tests green. **Do not touch ${SDLC}/06-impl-log.md or state.yaml** (the integrator writes those, to avoid parallel conflicts).`,
  `If you judge a test "wrong itself" (code matches design) → don't appease it; list it in test_defects.`,
  `Report PARIMPL: passed, impls (your completed IMPL: id/title/files/greens), test_defects, gate_check, needs_clarification.`,
].join('\n')

const integratePrompt = (impls) => [
  `You are the iso-agile-sdlc implementation integrator (Gate 6 closeout). The parallel implementers each finished their code; the reported IMPL are below (JSON):`,
  JSON.stringify(impls),
  `1. Confirm all code is in the main working tree with no file conflicts (if parallel conflicts exist, point them out and return passed=false).`,
  `2. Write the IMPL-* above into ${SDLC}/06-impl-log.md in the §1 format (greens records the greened tests).`,
  `3. Run the **full** suite to confirm all green; run \`sh ${TRACE} ${SDLC} --check\` with no severe gaps.`,
  `4. Update ${SDLC}/state.yaml (gates.impl.passed, current_stage=verification) and journal.`,
  `Report GATE: passed, completed_ids (integrated IMPL), gate_check (full-suite + trace summary), needs_clarification, test_defects (if a test is still wrong itself).`,
].join('\n')

// ── Gate 8 architecture consistency (N experts vs the Gate 2 output) ──
const archConsistencyPrompt = (L, dir) => [
  `You are an architecture-consistency reviewer for the iso-agile-sdlc review stage, lens: ${L.lens}`,
  ...(L.ref ? [`Follow your review basis: ${L.ref}.`] : []),
  `Compare "the Gate 2 architecture decisions" against "the actual implementation": read ${SDLC}/02-architecture.md (ARCH-*, cross-component invariants INV, decision rationale) and ${SDLC}/06-impl-log.md.`,
  `Scope your code reading to THIS iteration: collect the files listed on each IMPL's "files:" in 06-impl-log.md and read ONLY those (plus any file they directly reference at a module boundary). Do NOT scan the whole source tree — full-tree exploration belongs to Gate 0 (the explorer agent), not review.`,
  `From your lens, find where "the implementation deviates from / violates the architecture decisions" (e.g. a required invariant not enforced, a module boundary broken, a rationale contradicted).`,
  `Write findings to a file ${dir}/${L.key}.md (each: which ARCH/INV violated, evidence file:line, severity).`,
  `Report ARCHCHECK: lens, file (=the path above), consistent (yes/no), violations (count).`,
].join('\n')

// ── Flow-control helpers ───────────────────────────────
const results = []
const clarifications = []
const ownerDecisions = []   // issue #15: deferrals collected across gates; surfaced in the final result — the orchestrator MUST relay them to the owner
const collectOD = (phase, r) => { if (r && Array.isArray(r.owner_decisions) && r.owner_decisions.length) ownerDecisions.push({ phase, items: r.owner_decisions }) }
function stopIf(phase, r) {
  collectOD(phase, r)
  if (!r) return { stopped: `Gate "${phase}" execution failed`, results, clarifications, owner_decisions: ownerDecisions }
  if (r.needs_clarification && r.needs_clarification.length) {
    clarifications.push({ phase, items: r.needs_clarification })
    return { stopped: 'has items needing a user decision; handed back to orchestrator', clarifications, results, hint: 'after the main conversation answers, resume with resumeFromRunId' }
  }
  if (!r.passed) return { stopped: `Gate "${phase}" did not pass: ${r.gate_check}`, results, clarifications }
  return null
}
async function single(s) {
  phase(s.phase)
  const r = await runGate(s.phase,
    () => agent(gatePrompt(s), { schema: GATE, label: `gate:${s.phase}`, agentType: s.agentType, model: s.model }),
    verifyOutputs(s))
  results.push({ phase: s.phase, result: r })
  return r
}
// Non-QM: after a single-agent stage (test/impl/validate), run the functional-safety + cybersecurity
// experts as reviewers. QM ⇒ no-op (returns null immediately). A high finding blocks the gate.
async function safetyReview(stageLabel) {
  if (!IS_SAFETY) return null
  const dir = `${SDLC}/.panel/${stageLabel.replace(/[^A-Za-z0-9]+/g, '-')}-safety`
  const revs = (await parallel(SAFETY_LENSES.map((L) => () =>
    agent([
      `You are the ${L.key} expert reviewing the just-completed "${stageLabel}" stage of a SAFETY-RELEVANT feature (ASIL-${SAFETY}).`,
      `Read ${SDLC}/00-safety.md + this stage's doc + the code/tests under state.yaml layout. ${L.lens}`,
      `Verify the stage produced its required safety/security work products (per the non-QM per-stage table in ${SKILL}/references/stage-contracts.md §1) and that they trace correctly (SG-/CG-/SAN-).`,
      `Write findings to ${dir}/${L.key}.md. Report GATE: passed (false if any high/blocking gap), completed_ids, gate_check (summary), needs_clarification.`,
    ].join('\n'), { schema: GATE, label: `safety:${stageLabel}/${L.key}`, phase: stageLabel, agentType: AT('reviewer'), model: M('safety') })
  ))).filter(Boolean)
  results.push({ phase: `${stageLabel} safety/security review`, result: revs })
  const blocked = revs.filter((x) => !x.passed)
  if (blocked.length) return { stopped: `safety/security review blocked "${stageLabel}"`, results, clarifications, detail: blocked }
  return null
}
// v1.21 conditional debate: round 2+ runs ONLY when round-1 stances materially conflict.
// A cheap haiku referee reads the experts' one-line headlines (not the proposal files); no conflict →
// straight to synthesis. Fail-safe: referee died (null) ⇒ run the debate round (never skip on error).
const shouldSkipDebate = (det) => !!(det && det.conflict === false)
// v1.23: a lean gate escalates to a full panel by putting a 'request-panel: …' string in needs_clarification.
const needsPanel = (r) => !!(r && Array.isArray(r.needs_clarification) && r.needs_clarification.some((x) => typeof x === 'string' && x.toLowerCase().includes('request-panel')))
async function fullPanel(s) {
  phase(s.phase)
  const dir = `${SDLC}/.panel/${s.gate}` // proposal files land here (trace.py skips .panel)
  const rounds = s.rounds || 1
  // Round 1: each expert group proposes independently (parallel)
  let props = await parallel(s.lenses.map((L) => () =>
    agent(panelProposePrompt(s, L, dir), { schema: PROPOSAL, label: `${s.phase}:${L.key}:r1`, model: L.model })
  ))
  // Rounds 2..N: debate — only if the referee sees a material conflict (context via files)
  let ranRounds = 1
  for (let rnd = 2; rnd <= rounds; rnd++) {
    if (budgetStop(`${s.phase} debate round ${rnd}`)) break // converge early if budget is low
    const heads = (props || []).filter(Boolean).map((p) => `- [${p.lens}] ${p.headline}`)
    const det = heads.length > 1 ? await agent([
      `You are the debate referee for the iso-agile-sdlc "${s.phase}" stage. Below are the one-line headlines of the independent expert proposals from the previous round:`,
      ...heads,
      `Decide whether they MATERIALLY CONFLICT — contradictory recommendations that need a rebuttal round to converge (e.g. one says split module X, another says keep it single) — versus merely complementary/orthogonal concerns.`,
      `Report conflict (true/false) and a one-line reason. When genuinely uncertain, report conflict=true (debating is the safe default).`,
    ].join('\n'), { schema: { type: 'object', properties: { conflict: { type: 'boolean' }, reason: { type: 'string' } }, required: ['conflict', 'reason'] }, label: `${s.phase}:conflict?`, model: M('cheap') }) : null
    if (shouldSkipDebate(det)) { log(`${s.phase}: round-1 stances don't conflict (${det.reason}) → skipping debate round ${rnd}, straight to synthesis`); break }
    log(`${s.phase}: debate round ${rnd}/${rounds} (${det ? det.reason : 'referee unavailable — defaulting to debate'})`)
    props = await parallel(s.lenses.map((L) => () =>
      agent(panelDebatePrompt(s, L, dir, rnd), { schema: PROPOSAL, label: `${s.phase}:${L.key}:r${rnd}`, model: L.model })
    ))
    ranRounds = rnd
  }
  const good = (props || []).filter(Boolean)
  log(`${s.phase}: ${ranRounds} debate round(s) run, ${good.length} final proposals in ${dir}/; synthesizer reads & decides`)
  const r = await runGate(`${s.phase}:decide`,
    () => agent(panelSynthPrompt(s, dir, ranRounds), { schema: GATE, label: `${s.phase}:decide`, agentType: s.agentType, model: s.model }),
    verifyOutputs(s))
  results.push({ phase: s.phase, result: r })
  return r
}
// v1.23: tier-aware gate dispatch. LEAN (QM only) → the role agent self-decides (no panel); on a
// self-escalation ('request-panel:') it falls through to the full panel. FULL / non-QM → full panel, unchanged.
async function decide(s) {
  if (LEAN && !IS_SAFETY) {
    phase(s.phase)
    const r = await runGate(s.phase,
      () => agent(leanGatePrompt(s), { schema: GATE, label: `lean:${s.phase}`, agentType: s.agentType, model: s.model }),
      verifyOutputs(s))
    if (needsPanel(r)) { log(`${s.phase}: lean gate self-escalated to a full adversarial panel (${r.needs_clarification.filter((x) => String(x).toLowerCase().includes('request-panel')).join('; ')})`); return fullPanel(s) }
    results.push({ phase: s.phase, result: r })
    return r
  }
  return fullPanel(s)
}

// Per-phase token accounting (cost observability — the workflow watches its own spend):
// budget.spent() is cumulative across the turn, so log the delta after each gate. Feeds future tuning
// with measured per-gate costs instead of structural estimates.
let _lastSpent = (typeof budget !== 'undefined' && budget) ? budget.spent() : 0
const costLog = []
function logCost(label) {
  if (typeof budget === 'undefined' || !budget) return
  const now = budget.spent()
  const delta = Math.round((now - _lastSpent) / 1000)
  costLog.push({ phase: label, ktokens: delta })
  log(`cost: ${label} ≈ ${delta}k tokens (cumulative ${Math.round(now / 1000)}k${budget.total ? ` / target ${Math.round(budget.total / 1000)}k` : ''})`)
  _lastSpent = now
}

// Token budget gate (enforced at the outermost level; wall-clock can't be measured in-script — Date.now is disabled — enforce via external TaskStop/overall budget)
const RESERVE_TOKENS = 100_000 // reserve for the tail (verify/validate/review)
const budgetLeft = () => (budget && budget.total ? budget.remaining() : Infinity)
function budgetStop(where) {
  if (budgetLeft() < RESERVE_TOKENS) {
    log(`token budget low (~${Math.round(budgetLeft() / 1000)}k left) → stopping before "${where}"`)
    return { stopped: `token budget low, stopped before "${where}"`, results, clarifications, hint: 'raise this turn\'s +Nk budget or narrow scope, then resume with resumeFromRunId' }
  }
  return null
}

// ── Liveness watchdog (in-script) ──────────────────────
// Wall-clock CAN'T be measured here (Date.now is disabled to keep resume deterministic), so a stuck agent
// is detected by its RESULT, not by timing: a dead agent() returns null; an incomplete gate reports
// !passed / no completed_ids; and an independent verifier confirms the artifacts actually landed on disk.
// On any of these the gate is RE-RUN (a fresh agent — the prior one is already dead/abandoned), bounded by
// MAX_GATE_ATTEMPTS. TRUE hangs (an agent that never resolves) are killed EXTERNALLY by the orchestrator's
// progress-based watchdog (Monitor the output file; TaskStop on a sustained no-output idle window — NOT a
// total-runtime timeout, since long gates are normal) or capped by the token budget — see SKILL.md "§ Liveness & watchdog".
const MAX_GATE_ATTEMPTS = 3
// Independent output-completeness check (the "確認產出都有完成" guard): a cheap agent confirms the gate's
// reported ids really exist in the ledger doc and trace introduced no NEW structural gap. Returns {ok,reason}.
const verifyOutputs = (s) => async (r) => agent([
  `You are the iso-agile-sdlc gate-output VERIFIER — a liveness/completeness check, NOT the gate worker; do NOT redo the work.`,
  `The "${s.phase}" gate just reported passed=true with ids: ${(r.completed_ids || []).join(', ') || '(none)'}.`,
  `Independently CONFIRM the artifacts landed: in ${SDLC}/ open the relevant 0X stage doc(s) — ids may span two docs on a merged gate (e.g. TASK-* in 03-tasks.md AND DES-* in 04-design.md) — and confirm EACH reported id has a real "### <ID> — …" heading with metadata (not merely mentioned); then run \`sh ${TRACE} ${SDLC} --check\` and confirm NO new broken-links/orphans/TDD-violation were introduced (pre-existing mock-only / real:true-pending gaps are allowed).`,
  `OWNER-DEFERRAL RECONCILIATION: grep the gate doc(s) for the fixed metadata key \`owner_decision:\` — every \`pending\` marker on disk MUST appear in the report's owner_decisions array (and vice versa). A mismatch (deferral on disk missing from the report, or reported but not marked) → ok=false naming the item id.`,
  ...(s.gate === 'impl' ? [`DES-CONFORMANCE SPOT CHECK (weak-executor guard): pick 2–3 of the reported IMPL ids, open the implemented interface(s) their files declare, and compare against the matching DES-* signature/schema in ${SDLC}/04-design.md — name, parameters, return/response shape must match. A green suite does NOT excuse a signature that drifted from the design; any mismatch → ok=false naming the DES id.`] : []),
  `Report ok=true ONLY if every reported id exists on disk AND trace shows no new structural gap; else ok=false with a one-line reason.`,
].join('\n'), { schema: { type: 'object', properties: { ok: { type: 'boolean' }, reason: { type: 'string' } }, required: ['ok', 'reason'] }, label: `verify:${s.phase}`, model: M('cheap') })

// Full watchdog for doc-producing GATE-schema stages: liveness + completeness + independent output verify, with retry.
async function runGate(label, attemptFn, verify) {
  let last = null
  for (let attempt = 1; attempt <= MAX_GATE_ATTEMPTS; attempt++) {
    if (attempt > 1) log(`watchdog: gate "${label}" re-run ${attempt}/${MAX_GATE_ATTEMPTS} (prior attempt died or produced incomplete output)`)
    const r = await attemptFn(attempt)
    last = r
    if (!r) { log(`watchdog: gate "${label}" attempt ${attempt} → no result (agent died/skipped); retrying`); continue }
    if (r.needs_clarification && r.needs_clarification.length) return r // a real user-decision stop — never retry
    if (!r.passed) { log(`watchdog: gate "${label}" attempt ${attempt} → not passed (${r.gate_check || 'no gate_check'}); retrying`); continue }
    if (!r.completed_ids || !r.completed_ids.length) { log(`watchdog: gate "${label}" attempt ${attempt} → passed but produced no ids (incomplete); retrying`); continue }
    if (verify) {
      const v = await verify(r, attempt)
      if (v && v.ok === false) { log(`watchdog: gate "${label}" attempt ${attempt} → output verify FAILED: ${v.reason}; retrying`); continue }
    }
    if (attempt > 1) log(`watchdog: gate "${label}" recovered on attempt ${attempt}`)
    return r // healthy & outputs confirmed
  }
  log(`watchdog: gate "${label}" still unhealthy after ${MAX_GATE_ATTEMPTS} attempts — handing back (caller will stop)`)
  return last
}
// Liveness-only retry (re-run only when the agent DIED/returned null) — for stages with bespoke result
// schemas or routing (impl test-defect loop, validation, review) where a blind !passed re-run would be wrong.
async function runLive(label, fn) {
  let r = null
  for (let a = 1; a <= MAX_GATE_ATTEMPTS && !r; a++) {
    if (a > 1) log(`watchdog: "${label}" re-run ${a}/${MAX_GATE_ATTEMPTS} (prior attempt died/returned nothing)`)
    r = await fn(a)
  }
  return r
}

// ── Precheck: requirements must be finalized (Gate 1 done in the main conversation) ──
phase('Precheck')
let pre
if (A.gate || (Array.isArray(A.gates) && A.gates.length)) {
  // Gate-scoped invocation (gate-as-workflow): the caller (orchestrator or the composing parent run)
  // already passed the full precheck; synthesize the tier fields so pickTier stays the one resolver.
  pre = { ok: true, reason: 'gate-scoped invocation — precheck done by the caller', req_count: -1, git_repo: true, clarified: true, suggested_tier: A.tier === 'lean' ? 'lean' : 'full', tier_reason: 'caller-resolved' }
} else pre = await agent([
  `Check whether the iso-agile-sdlc feature workspace ${SDLC} is ready:`,
  `1. Read ${SDLC}/01-requirements.md; count REQ-* items and whether each has acceptance.`,
  `2. Read ${SDLC}/state.yaml; confirm gates.requirements.passed is true, layout has real paths, and mode (new/modify/refactor).`,
  `2b. GATE 1 CLARIFICATION EVIDENCE — read the "## Clarification log" section of ${SDLC}/01-requirements.md. It must record at least one REAL question-and-answer round with the user (5W1H / Example-Mapping questions AND the user's actual answers — not placeholders) plus an explicit user-confirmation line. Missing section, empty log, or no confirmation → clarified=false AND ok=false with reason "Gate 1 interview not evidenced — run /sdlc-clarify first". Requirements transcribed from a literal reading of the request, without dialogue, are exactly the failure Gate 1 exists to prevent.`,
  `3. Run \`git rev-parse --is-inside-work-tree\` to confirm a git repo (git_repo=true/false).`,
  `4. TRIAGE — iteration vs new feature: check this ${FEATURE} is not an existing feature's iteration mis-opened as a new folder.`,
  `   Read ${SDLC}/01-requirements.md and ${SDLC}/state.yaml layout.src; if they declare sharing/extending ANOTHER feature's source tree`,
  `   (e.g. text like "features/<other>/src", "共享 src", "擴充既有 ... 套件"), this work belongs as an ITERATION of that other feature`,
  `   (continue in its sdlc/, run trace.py --impact, bump iter:), NOT a new features/NNN — set ok=false.`,
  `5. ADAPTIVE TIER — right-size the process to the feature's size/risk. Judge from 01-requirements.md + state.yaml and suggest 'lean' ONLY if ALL hold: (a) small scope (roughly ≤2 REQ, or a few tightly-related REQ in ONE cohesive area), (b) NO new external integration/dependency (no new API / service / protocol / hardware), (c) NOT safety/security-relevant, (d) changes localized to one module/surface, low blast radius. Otherwise suggest 'full'. When unsure → 'full'. Put the deciding factor in tier_reason.`,
  `Report ok, reason, req_count, git_repo, clarified, suggested_tier, tier_reason. Rules: requirements missing acceptance or gate1 not passed → ok=false; no clarification evidence (step 2b) → clarified=false and ok=false;`,
  `mode is modify/refactor but git_repo=false → ok=false (brownfield needs a git baseline to diff/isolate);`,
  `feature shares/extends another feature's src tree (step 4) → ok=false, reason names the owning feature to iterate instead.`,
].join('\n'), {
  label: 'precheck', model: M('cheap'),
  schema: {
    type: 'object',
    properties: { ok: { type: 'boolean' }, reason: { type: 'string' },
      req_count: { type: 'number' }, git_repo: { type: 'boolean' },
      suggested_tier: { type: 'string', enum: ['lean', 'full'], description: 'lean = small/low-risk/single-area QM feature (skip panels); full = anything larger, new integration, or safety-relevant' },
      tier_reason: { type: 'string', description: 'the deciding factor for the tier suggestion' },
      clarified: { type: 'boolean', description: 'the Clarification log evidences a real Gate 1 interview (Q/A rounds + user confirmation)' } },
    required: ['ok', 'reason', 'req_count', 'git_repo', 'suggested_tier', 'tier_reason', 'clarified'],
  },
})
if (!pre || !pre.ok) {
  log(`precheck failed: ${pre ? pre.reason : 'precheck agent failed'}`)
  return { stopped: 'precheck failed', detail: pre, hint: 'first complete Gate 1 clarification — /sdlc-clarify runs the 5W1H/Example-Mapping interview and writes the Clarification log (gates.requirements.passed=true); brownfield must be inside a git repo (git init or an existing repo)' }
}
if (!pre.git_repo) {
  log('⚠ not a git repo: suggest git init to enable worktree isolation and multi-agent parallel dev (see references/git-worktree-strategy.md). Continuing.')
}
log(`requirements ready (${pre.req_count} REQs, git_repo=${pre.git_repo}); starting Gate 2→8`)

// ── v1.23 ADAPTIVE TIERING ──────────────────────────────
// Right-size the process to the feature. LEAN (small/low-risk/single-area, QM only): the role agents at
// Gate 2/4 decide themselves (self-apply the lenses) with NO adversarial panel, and Gate 8 skips the
// pre-run architecture experts. FULL: unchanged v1.22 behaviour. Three quality fail-safes keep this safe:
//   (1) the TDD gates (5 RED, 6 GREEN, 6.5+7 verify) and Gate 7.5 real-run NEVER scale down — coverage is
//       always full; only the *deliberation* around design decisions is thinned.
//   (2) a lean gate can SELF-ESCALATE: if the role agent hits a real cross-cutting conflict it can't settle
//       alone, it returns needs_clarification=['request-panel: …'] and that gate re-runs as a full panel.
//   (3) non-QM (safety/security) is ALWAYS full — pickTier forces it, even over a manual args.tier=lean.
// Precheck (the haiku triage agent) suggests the tier for free; args.tier=lean|full overrides (QM only).
const pickTier = (suggested, isSafety, override) => isSafety ? 'full'
  : (override === 'lean' || override === 'full') ? override
  : (suggested === 'lean' ? 'lean' : 'full') // default full when unsure
const TIER = pickTier(pre.suggested_tier, IS_SAFETY, A.tier)
const LEAN = TIER === 'lean'
log(`tier: ${TIER}${LEAN ? ' (lean — small/low-risk/single-area QM: role agents self-decide Gate 2/4, no panels; Gate 8 skips arch experts; TDD & real-run stay full; self-escalation armed)' : ` (full${IS_SAFETY ? ', forced by safety class' : ''})`}${A.tier ? ` [manual override args.tier=${A.tier}${IS_SAFETY ? ', ignored — non-QM forces full' : ''}]` : ` [precheck suggested ${pre.suggested_tier}: ${pre.tier_reason || ''}]`}`)

let st
logCost('Precheck')

// ── v1.25 FIX MODE (/sdlc-fix): compressed F1–F6 for an iteration/bugfix on an EXISTING feature ──
// F0 (locate owning ledger + `trace --impact` + size guard) and F0.5 (change-REQ) already ran in the
// /sdlc-fix command (main conversation — only it can talk to the user). Here we run the MINIMAL gates that
// keep the trace chain + TDD intact, reusing the same single/runGate/runLive helpers. Every non-negotiable
// survives structurally: F2 test-first is a hard gate (red before green), F3 keeps the test-defect→F2 repair
// loop, F4 runs the FULL regression, F5 keeps the mock hard-rule + real:true for touched REQs, F6 --check
// fails on any new broken chain / iter: drift. QM-only; a safety-relevant change is refused → full flow.
if (A.mode === 'fix') {
  if (IS_SAFETY) return { stopped: 'fix mode is QM-only; a safety/security-relevant change must go through the full /sdlc-run flow (safety reviews + full panels)', hint: 'run /sdlc-run instead of /sdlc-fix for ASIL/CAL features' }
  const IMPACT = Array.isArray(A.impactIds) ? A.impactIds.filter(Boolean) : (A.impactIds ? [A.impactIds] : [])
  const ITER = A.iteration || 'v2'
  const FIX_MAX_REPAIR = 3
  const impactStr = IMPACT.length ? IMPACT.join(', ') : '(derive from the changed REQ + `sh <trace> <ledger> --impact <ID>`)'
  log(`fix mode: impact closure = ${impactStr}; iteration = ${ITER} (F1 delta → F2 red → F3 green → F4 regression → F5 validate-touched → F6 review-lite)`)
  const fixHead = `This is an ITERATION/bugfix on an EXISTING feature (fix mode) — NOT a greenfield build. Impact closure to work within: ${impactStr}. UPDATE existing items in place and bump their iter: to ${ITER}; do NOT open a new ledger or new ID namespace, and keep every existing trace link intact. Stay within the --impact closure; if the change turns out to need more than that, STOP and return needs_clarification (it should escalate to a full /sdlc-run).`

  // F1 — impact-design delta (designer, single, NO panel): update touched ARCH/DES + TASK for the fix
  let r = await single({ phase: 'Design', gate: 'design', next: 'tests', agentType: AT('executor'), contract: CONTRACT('designer'), model: M('design_synth'),
    scope: `[FIX F1 — impact-design delta] ${fixHead} Read ONLY the impact closure — do NOT re-decompose the system. Update in place the touched ARCH-* in 02-architecture.md and DES-* in 04-design.md (signatures/schema/boundaries for THIS change, keep 04-design LEAN), and add/adjust the TASK-* in 03-tasks.md this fix needs (each traces to its ARCH). Bump iter: to ${ITER} on every item you touch. Leave gates.architecture/design.passed true. NO expert panel — self-decide at this scale; if a real cross-cutting conflict makes it unsafe to decide alone, return needs_clarification.` })
  if ((st = stopIf('Design (fix delta)', r))) return st
  log(`✓ F1 impact-design delta (${r.completed_ids.length} items)`); logCost('Fix F1 design delta')

  // F2 — test-first RED (verifier mode A): the failing test that reproduces the bug / specifies the change
  r = await single({ phase: 'Test-first RED', gate: 'tests', next: 'impl', agentType: AT('executor'), contract: CONTRACT('verifier'), model: M('tests'),
    scope: `[FIX F2 — test-first RED] ${fixHead} Write the FAILING test(s) that reproduce the bug or specify the change, tracing to the touched DES/REQ, iter:${ITER}, status:red/result:fail; confirm red for the RIGHT reason (the fix isn't in yet). This gate is NEVER skippable — no green without a red first.` + KARPATHY_SUFFIX })
  if ((st = stopIf('Test-first RED (fix)', r))) return st
  log(`✓ F2 test-first (${r.completed_ids.length} red)`); logCost('Fix F2 test-first')

  // F3 — implement GREEN (single implementer) + test-defect → F2 repair loop (bounded, same routing as full flow)
  const S_FIX_IMPL = { phase: 'Implement GREEN', gate: 'impl', next: 'verification', agentType: AT('executor'), contract: CONTRACT('implementer'), model: M('implement'),
    scope: `[FIX F3 — GREEN→REFACTOR] ${fixHead} Write the MINIMAL code to turn the F2 red tests green, then refactor staying green; record IMPL-* (or bump touched IMPL iter:) with greens in 06-impl-log.md. Fixes are small — no partition/parallel machinery. If a test is "wrong itself" (code matches design) list it in test_defects rather than appeasing it.` + KARPATHY_SUFFIX }
  let implR, fixRepair = 0
  while (true) {
    phase('Implement GREEN')
    implR = await runLive(fixRepair ? `Implement GREEN (fix)#retry${fixRepair}` : 'Implement GREEN (fix)',
      () => agent(gatePrompt(S_FIX_IMPL), { schema: GATE, label: fixRepair ? `fix:impl#retry${fixRepair}` : 'fix:impl', agentType: S_FIX_IMPL.agentType, model: S_FIX_IMPL.model }))
    results.push({ phase: fixRepair ? `Implement GREEN (fix)#retry${fixRepair}` : 'Implement GREEN (fix)', result: implR })
    if (!implR) return { stopped: 'fix Implement GREEN failed (agent died after retries)', results, clarifications }
    const defects = implR.test_defects || []
    if (defects.length && fixRepair < FIX_MAX_REPAIR) {
      fixRepair++
      log(`${defects.length} test defect(s) → fix repair ${fixRepair}/${FIX_MAX_REPAIR}: route back to F2 verifier`)
      phase('Test fix')
      const fix = await agent(testerFixPrompt(defects), { schema: GATE, label: `fix:tester-fix#${fixRepair}`, agentType: AT('executor'), model: M('tests') })
      results.push({ phase: `Test fix (fix)#${fixRepair}`, result: fix })
      if (!fix) return { stopped: 'fix test-fix agent failed', results, clarifications }
      if (fix.needs_clarification && fix.needs_clarification.length) {
        clarifications.push({ phase: `Test fix (fix)#${fixRepair}`, items: fix.needs_clarification })
        return { stopped: 'fix test fix needs a user decision', clarifications, results, hint: 'after the main conversation answers, resume with resumeFromRunId' }
      }
      continue
    }
    if (defects.length) {
      clarifications.push({ phase: 'Implement GREEN (fix)', items: defects.map((d) => `${d.test_id}: ${d.problem} (suggested: ${d.fix})`) })
      return { stopped: `fix test defects unresolved after ${FIX_MAX_REPAIR} repairs`, clarifications, results }
    }
    if ((st = stopIf('Implement GREEN (fix)', implR))) return st
    break
  }
  log(`✓ F3 implement GREEN (${fixRepair} test repairs)`); logCost('Fix F3 implement')

  // F4 — verify (simplify-lite on the diff + FULL regression), single verifier
  r = await single({ phase: 'Verify', gate: 'verification', next: 'validation', agentType: AT('executor'), contract: CONTRACT('verifier'), model: M('verify'),
    scope: `[FIX F4 — simplify-lite + FULL regression] ${fixHead} FIRST apply the /simplify spirit to the code you changed this iteration (quality only, no behavior change; revert anything that goes red; update touched IMPL-*). THEN run the FULL regression suite — NOT just the impacted tests — because catching regressions elsewhere is the whole point of a fix gate; add any needed system-level IT/E2E/VAL; mark passing green.` + KARPATHY_SUFFIX })
  if ((st = stopIf('Verify (fix)', r))) return st
  log(`✓ F4 verify (simplify + full regression)`); logCost('Fix F4 verify')

  // F5 — validation delta: real-run ONLY the touched REQs; rewrite README/DEPLOY to current state
  if ((st = budgetStop('Validation (fix)'))) return st
  phase('Validation')
  const fixVal = await runLive('Validation (fix)', () => agent(validatePrompt(`this is an iteration touching ${impactStr}. Real-run (real:true, no SUT-boundary mock) the REQ(s) whose behavior THIS fix changed; for UNTOUCHED REQs their existing real:true evidence in 08-validation.md stands — re-affirm they are still green (a quick smoke is enough), you need not re-run every one. No touched REQ may pass on mock-only evidence, and trace --check must still show no 未真實驗證/未驗證 gap. Bump touched VAL iter: to ${ITER}, and record this iteration in the LEDGER (journal.md) — the manuals stay history-free (no changelog in README/DEPLOY).`), { schema: VALIDATION, label: 'fix:validation', agentType: S_VALIDATE.agentType, model: S_VALIDATE.model }))
  results.push({ phase: 'Validation (fix)', result: fixVal })
  if ((st = stopIf('Validation (fix)', fixVal))) return st
  log(`✓ F5 validation (touched REQs real-green; ${fixVal.mock_census || ''}; docs: ${(fixVal.docs_written || []).join(', ')})`); logCost('Fix F5 validation')

  // F6 — review-lite: trace --check (the iter: drift check is the chain guard), touched-files arch self-check, retro
  if ((st = budgetStop('Review (fix)'))) return st
  phase('Review')
  const fixReview = await runLive('Review (fix)', () => agent([
    `You are the iso-agile-sdlc reviewer (READ YOUR ROLE CONTRACT FIRST: ${CONTRACT('reviewer')}); do a LIGHT review of this fix iteration in ${SDLC}.`,
    `This was a fix-mode iteration (impact closure ${impactStr}, iter ${ITER}). NO pre-run architecture experts — do the consistency check YOURSELF, scoped to the files this fix touched (the "files:" on the IMPL-* you just added/updated in 06-impl-log.md, plus any they directly reference at a module boundary), compared against the Gate 2 ARCH/INV/rationale in 02-architecture.md. Do NOT scan the whole source tree.`,
    `1. Regenerate the dashboard sh ${TRACE} ${SDLC}; run --check — confirm the fix introduced NO new broken-link/orphan/未驗證/漂移 gap (the iter: drift check — design/test lagging code — is the chain guard for a fix; it MUST be clean).`,
    `2. **Architecture consistency** (from your self-check): does the change still honour the Gate 2 decisions? list any violation.`,
    `3. **Validation & handover**: confirm F5 — trace shows no mock-only/未驗證 for the touched REQs, 08-validation.md updated, and README/DEPLOY read as CURRENT-STATE (history-free manuals — no changelog/version diffs anywhere in them, history lives only in the ledger; a single deduplicated 設定總表; the 一鍵部署 command still works).`,
    `4. Append a short fix-iteration retro to ${SDLC}/07-review.md (what changed, impact closure, any residual debt), bump ${SDLC}/state.yaml iteration to ${ITER}, and append a journal line.`,
    `Report REVIEW: gaps_high/mid/low, drift, arch_consistent, arch_violations, conclusion (any new broken chain, arch violation, or mock-only touched REQ must be reflected — may send back to F1/F3/F5).`,
  ].join('\n'), { schema: REVIEW, label: 'fix:review', agentType: AT('reviewer'), model: M('review') }))
  logCost('Fix F6 review')
  log(`fix done: gaps high=${fixReview ? fixReview.gaps_high : '?'} mid=${fixReview ? fixReview.gaps_mid : '?'} low=${fixReview ? fixReview.gaps_low : '?'}; arch_consistent=${fixReview ? fixReview.arch_consistent : '?'}`)
  log(`cost profile: ${costLog.map((c) => `${c.phase}=${c.ktokens}k`).join(' · ')}`)
  return { feature: FEATURE, mode: 'fix', impact: IMPACT, iteration: ITER, results, clarifications, owner_decisions: ownerDecisions, review: fixReview, cost_profile: costLog }
}

// ═══ v2.0 GATE-AS-WORKFLOW REGISTRY ═════════════════════════════════════════
// Each runner executes ONE gate end-to-end and returns a stop object (halt / hand back) or null
// (gate passed; its structured result is on `results`). The overall SDLC run is a COMPOSITION of
// these same per-gate workflows: with args.scriptPath + a host `workflow()` it launches each gate as
// its own child workflow run (progress-grouped, resumable per gate); otherwise it runs them inline —
// byte-identical behavior. args.gate runs exactly one gate; args.gates an (impact-scoped) subset.
// Per-gate DOCUMENT IO CONTRACT — every gate consumes and delivers FILES (the document deliverable)
// plus a structured report (the machine-readable side). Returned with gate-scoped runs.
const GATE_IO = {
  architecture: { reads: ['01-requirements.md', 'state.yaml'], writes: ['02-architecture.md (SAD: ARCH-*/ADR-*, 4+1 views, data architecture, API contracts)'], report: 'GATE' },
  design:       { reads: ['01-requirements.md', '02-architecture.md', 'state.yaml'], writes: ['03-tasks.md (TASK-* cards: files/dod/estimate)', '04-design.md (DES-* lean LLD: signature/schema/boundary)'], report: 'GATE' },
  tests:        { reads: ['04-design.md', '02-architecture.md', '01-requirements.md'], writes: ['05-tests.md (UT/IT/E2E/VAL, red)', 'test code @ layout.tests'], report: 'GATE' },
  impl:         { reads: ['03-tasks.md', '04-design.md (DES slices only)', '05-tests.md'], writes: ['code @ layout.src', '06-impl-log.md (IMPL-*)'], report: 'GATE (+PARIMPL per parallel implementer)' },
  verify:       { reads: ['05-tests.md', '06-impl-log.md', 'code'], writes: ['05-tests.md (green + system-level tests)', '06-impl-log.md (if simplify changed code)'], report: 'GATE' },
  validation:   { reads: ['whole ledger', 'code', 'config files'], writes: ['08-validation.md (real:true evidence)', 'README.md + DEPLOY.md (product root, 繁中)'], report: 'VALIDATION' },
  review:       { reads: ['whole ledger', 'touched files', '.panel/review/'], writes: ['07-review.md', 'dashboard.html'], report: 'REVIEW' },
}
let finalReview = null, finalVal = null

// v1.21: implementers are spawned per CHUNK of ~IMPL_CHUNK tasks, not per task — a per-task agent
// re-paid a full boot (contract + design-doc reread) for every small task. Chunks within a batch stay
// parallel. v2.0: args.implChunk right-sizes it to the executor model (weak/open-source model → 1).
let IMPL_CHUNK = 3
if (A.implChunk) IMPL_CHUNK = Math.max(1, A.implChunk | 0)
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

const RUNNERS = {

// ── Gate 2 Architecture (grouped-expert debate) ──
architecture: async () => {
  if ((st = budgetStop('Architecture'))) return st
  let r = await decide(S_ARCH); st = stopIf(S_ARCH.phase, r); if (st) return st
  log(`✓ Architecture decided (${r.completed_ids.length} ARCH)`)
  logCost('Architecture')
  return null
},

// ── Gate 3+4 Tasks & Design (merged dispatch: designer writes 03-tasks then 04-design; grouped-expert debate) ──
design: async () => {
  if ((st = budgetStop('Design'))) return st
  const r = await decide(S_DESIGN); st = stopIf(S_DESIGN.phase, r); if (st) return st
  log(`✓ Tasks & Design decided (${r.completed_ids.length} TASK+DES)`)
  logCost('Design (incl. Tasks)')
  return null
},

// ── Gate 5 Test-first RED (single agent) ──
tests: async () => {
  const r = await single(S_TESTS); st = stopIf(S_TESTS.phase, r); if (st) return st
  if ((st = await safetyReview(S_TESTS.phase))) return st
  log(`✓ Test-first (${r.completed_ids.length} tests, red)`)
  logCost('Test-first RED')
  return null
},

// ── Gate 6 Implement GREEN (partition → parallel implement → integrate → red-green self-repair loop) ──
impl: async () => {
  if ((st = budgetStop('Implement GREEN'))) return st
  phase('Implement GREEN')
  // 6a partition: split TASKs into parallel-safe batches (independent, non-overlapping files).
  // v2.4.1 (issue #16): a SEND-BACK REPAIR re-run skips partition/fan-out entirely — one scoped
  // implementer repairs only the named findings; re-partitioning ALL TASKs here was the observed bug.
  const part = SENDBACK_CTX ? null : await agent(partitionPrompt(), { schema: BATCHES, label: 'impl:partition', agentType: AT('researcher'), model: M('partition') })
  if (SENDBACK_CTX) log('send-back repair: skipping partition/parallel fan-out — single scoped implementer only')
  const batches = part && Array.isArray(part.batches) ? part.batches.filter((b) => b && b.length) : []
  let allImpls = [], parDefects = [], parClar = []
  // 6b implement each batch in parallel (implementer chunks concurrent within a batch, batches sequential; code only, no shared docs)
  if (batches.length) {
    log(`impl dispatch: ${batches.length} parallel batch(es) (${part.note || ''})`)
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi]
      const chunks = chunk(batch, IMPL_CHUNK)
      log(`batch ${bi + 1}/${batches.length}: ${batch.length} TASKs → ${chunks.length} implementer(s) in parallel (≤${IMPL_CHUNK} TASKs each)`)
      const rs = (await parallel(chunks.map((tids) => () =>
        agent(parImplPrompt(tids), { schema: PARIMPL, label: `impl:${tids.join('+')}`, agentType: AT('executor'), model: M('implement') })
      ))).filter(Boolean)
      for (const x of rs) {
        allImpls = allImpls.concat(x.impls || [])
        parDefects = parDefects.concat(x.test_defects || [])
        if (x.needs_clarification && x.needs_clarification.length) parClar = parClar.concat(x.needs_clarification)
      }
    }
    if (parClar.length) {
      clarifications.push({ phase: 'Implement GREEN (parallel)', items: parClar })
      return { stopped: 'parallel implementation needs clarification', clarifications, results, hint: 'after the main conversation answers, resume with resumeFromRunId' }
    }
  } else {
    if (!SENDBACK_CTX) log('partition failed / no batches → fall back to a single sequential implementer')
  }
  // 6c integrate (parallel) or single implement (fallback) + red-green self-repair loop
  let implR, repair = 0
  const MAX_REPAIR = 3
  while (true) {
    if (repair) phase('Implement GREEN')
    implR = await runLive(repair ? `Implement GREEN#retry${repair}` : 'Implement GREEN', () => batches.length
      ? agent(integratePrompt(allImpls), { schema: GATE, label: repair ? `impl:integrate#retry${repair}` : 'impl:integrate', agentType: AT('executor'), model: M('implement') })
      : agent(gatePrompt(S_IMPL), { schema: GATE, label: repair ? `gate:Implement GREEN#retry${repair}` : 'gate:Implement GREEN', agentType: S_IMPL.agentType, model: S_IMPL.model }))
    results.push({ phase: repair ? `integrate#retry${repair}` : (batches.length ? 'integrate' : 'Implement GREEN'), result: implR })
    if (!implR) return { stopped: 'Gate "Implement GREEN" execution failed (agent died after retries)', results, clarifications }
    const defects = (repair === 0 ? parDefects : []).concat(implR.test_defects || [])
    if (defects.length && repair < MAX_REPAIR) {
      repair++
      log(`${defects.length} test defect(s) found → repair ${repair}/${MAX_REPAIR}: auto-route back to Gate 5 verifier`)
      phase('Test fix')
      const fix = await agent(testerFixPrompt(defects), { schema: GATE, label: `tester-fix#${repair}`, agentType: AT('executor'), model: M('tests') })
      results.push({ phase: `Test fix#${repair}`, result: fix })
      if (!fix) return { stopped: 'test-fix agent failed', results, clarifications }
      if (fix.needs_clarification && fix.needs_clarification.length) {
        clarifications.push({ phase: `Test fix#${repair}`, items: fix.needs_clarification })
        return { stopped: 'test fix needs a user decision', clarifications, results, hint: 'after the main conversation answers, resume with resumeFromRunId' }
      }
      continue
    }
    if (defects.length) {
      clarifications.push({ phase: 'Implement GREEN', items: defects.map((d) => `${d.test_id}: ${d.problem} (suggested: ${d.fix})`) })
      log(`test defects unresolved after ${MAX_REPAIR} repairs; handing back`)
      return { stopped: `test defects unresolved after ${MAX_REPAIR} repairs`, clarifications, results, hint: 'after the main conversation answers, resume with resumeFromRunId' }
    }
    st = stopIf('Implement GREEN', implR); if (st) return st
    break
  }
  if ((st = await safetyReview('Implement GREEN'))) return st
  log(`✓ Implement GREEN passed (${batches.length ? allImpls.length + ' IMPL, ' + batches.length + ' parallel batches' : 'single mode'}, ${repair} test repairs)`)
  logCost('Implement GREEN')
  return null
},

// ── Gate 6.5+7 Verify (merged: /simplify cleanup then full regression, one agent) ──
verify: async () => {
  const r = await single(S_VERIFY); st = stopIf(S_VERIFY.phase, r); if (st) return st
  log(`✓ Verify (simplify + regression)`)
  logCost('Verify (incl. Simplify)')
  return null
},

// ── Gate 7.5 Validation (real-run grounding + mock census hard-rule + human README/DEPLOY) ──
validation: async () => {
  if ((st = budgetStop('Validation'))) return st
  phase('Validation')
  const val = await runLive('Validation', () => agent(validatePrompt(), { schema: VALIDATION, label: 'validation', agentType: S_VALIDATE.agentType, model: S_VALIDATE.model }))
  results.push({ phase: 'Validation', result: val })
  st = stopIf('Validation', val); if (st) return st
  if ((st = await safetyReview('Validation'))) return st
  finalVal = val
  log(`✓ Validation (real-tier all green; ${val.mock_census || ''}; docs: ${(val.docs_written || []).join(', ')})`)
  logCost('Validation')
  return null
},

// ── Gate 8 Review (N architecture experts vs Gate 2 consistency + reviewer synthesis) ──
review: async () => {
  if ((st = budgetStop('Review'))) return st
  phase('Review')
  // 8a N architecture experts check "implementation vs Gate 2 architecture decisions" in parallel (context via files)
  const rdir = `${SDLC}/.panel/review`
  // v1.23 LEAN: skip the pre-run architecture experts — the reviewer does the touched-files consistency check itself.
  const archChecks = LEAN ? [] : (await parallel(S_ARCH.lenses.map((L) => () =>
    agent(archConsistencyPrompt(L, rdir), { schema: ARCHCHECK, label: `review:arch-${L.key}`, model: L.model })
  ))).filter(Boolean)
  const inconsistent = archChecks.filter((x) => !x.consistent).length
  if (LEAN) log(`lean tier: no pre-run architecture experts; the reviewer self-checks touched-files consistency`)
  else log(`architecture-consistency review: ${archChecks.length} experts, ${inconsistent} found inconsistencies (reports in ${rdir}/)`)
  // 8b reviewer synthesizes: traceability consistency + architecture consistency.
  // v2.1: BLOCKING findings auto re-run the owning gate ONCE (structured send_back), then re-review;
  // still-blocking after that hands back to the orchestrator — capped at one loop to avoid cycles.
  const reviewOnce = (pass, fixedGates) => runLive(pass > 1 ? `Review#${pass}` : 'Review', () => agent([
    `You are the iso-agile-sdlc reviewer (READ YOUR ROLE CONTRACT FIRST: ${CONTRACT('reviewer')}); do the final review of ${SDLC}.`,
    ...(pass > 1 ? [`**RE-REVIEW after auto send-back**: your previous review listed BLOCKING findings and the workflow re-ran gate(s) [${(fixedGates || []).join(', ')}] once. Verify the previously-blocking items are actually fixed (on disk, re-run the checks); do NOT re-open the full review scope. If still blocking, list the gates in send_back again — the workflow will STOP and hand back (auto re-run happens only once).`] : []),
    LEAN
      ? `Do the architecture-consistency check YOURSELF — scope to THIS iteration's touched files (the files listed on each IMPL's "files:" in ${SDLC}/06-impl-log.md, plus any they directly reference at a module boundary) and compare against the Gate 2 ARCH/INV/rationale in ${SDLC}/02-architecture.md. No pre-run experts ran (lean tier); do NOT scan the whole source tree.`
      : `The ${archChecks.length} architecture-consistency experts ALREADY RAN (their reports are in ${rdir}/) — consolidate from them only; do NOT spawn more experts.`,
    `1. Regenerate the dashboard sh ${TRACE} ${SDLC}; run --check for gaps; check doc↔code iter drift.`,
    `1b. **DASHBOARD QA (the deliverable must actually render)**: run \`sh ${TRACE} --tool dashboard_check ${SDLC}\` — it verifies every SoT file:line link target exists (file present, line within range) and every embedded mermaid block passes a lexical sanity check. If the playwright browser tools are available in your session, ALSO open ${SDLC}/dashboard.html in the browser, switch through the tabs, and confirm each diagram rendered to an <svg> (no mermaid error text, no forever-blank block) and spot-click 2–3 SoT links. A dashboard that fails to render or whose links dead-end is a Gate 8 FINDING (fix the doc/diagram or record it) — never report "review done" over a broken dashboard.`,
    `1c2. **MODULE BUILD CHECK (dormant unless ARCH declares build:)**: run \`sh ${TRACE} --tool module_check ${SDLC}\` — independent-build failures are findings (send back to impl).`,
    `1c. **MODULE-BOUNDARY CHECK (SOLID enforcement)**: run \`sh ${TRACE} --tool solid_check ${SDLC}\` — it builds the import graph of layout.src and flags undeclared cross-module dependencies, dependency cycles, deep-internal imports bypassing a module's public surface, and god-modules, against the module:/deps: declarations on the ARCH-* items. Violations are findings (send back to Gate 6, or record as accepted debt with a reason).`,
    LEAN
      ? `2. **Architecture consistency**: from the self-check above, record "does the implementation match the Gate 2 architecture decisions (ARCH/INV/rationale)", list violations.`
      : `2. **Architecture consistency**: read the ${archChecks.length} architecture-expert reports under ${rdir}/, consolidate "does the implementation match the Gate 2 architecture decisions (ARCH/INV/rationale)", list violations.`,
    `3. **Validation & handover**: confirm Gate 7.5 — trace.py shows no 未真實驗證(mock-only)/未驗證 gaps (every REQ has a real:true green), ${SDLC}/08-validation.md exists, and the handover docs at state.yaml layout.readme/layout.deploy (product root) exist, are step-by-step, written in 淺顯易懂的繁體中文 (ASCII diagrams where structure helps), and read as CURRENT-STATE (no superseded instructions/keys/ports anywhere; **history-free manuals** — no changelog/version-diff content at all, history lives only in the .sdlc ledger; a single deduplicated 設定總表 is the only place config keys are documented; **DEPLOY.md leads with a working 一鍵部署 command that Gate 7.5 actually ran**). Any REQ on mock-only evidence, missing handover doc, a manual carrying history/stale/duplicated instructions, or a missing/unverified one-command deploy is a finding (send back to Gate 7.5).`,
    `3b. **SPECIAL-FILE REVIEWS (only for files THIS iteration touched — check 06-impl-log files: + git status)**: touched CLAUDE.md or AGENTS.md → review it with the claude-md-improver skill (Skill tool); touched any SKILL.md → review it with the skill-creator skill. If the Skill tool or those skills are unavailable in your session, review the file manually against their principles (accuracy, no stale instructions, concise imperative guidance) and note the degraded mode. Findings here follow the same blocking/debt routing as everything else.`,
    `3c. **OWNER-DEFERRAL LEDGER SWEEP (issue #15)**: mechanically reconcile deferred product decisions — run \`grep -rn "owner_decision" ${SDLC}\` (a FIXED metadata key; never grep prose phrases, they vary by language). Every \`pending\` hit is an owner decision that never got answered: list them ALL in your report's owner_decisions array (trace --check also flags them as 待業主決策 high gaps — the iteration cannot close over an unanswered one; the orchestrator must relay them and the item updated to \`answered(<date>) — <ruling>\` after the owner rules). Also spot-check the ADRs for decision-shaped hedging WITHOUT the marker ("not taken here", "product decision" in any language) — an unmarked deferral is a producer contract violation: report it as a finding against that gate.`,
    `4. Write ${SDLC}/07-review.md (traceability-consistency + architecture-consistency + dashboard-QA + module-boundary + owner-deferral + validation/handover sections + retro).`,
    `4b. On pass, update ${SDLC}/state.yaml: gates.review.passed=true, current_stage=review, updated; append a journal line. This is your job, not a clarification (found in E2E: the fix-mode F6 prompt had this step but the full-run Gate 8 prompt didn't, leaving the review gate un-landed in state.yaml).`,
    `5. **Cleanup transient artifacts — ONLY when closing (send_back is empty)**: the debate/panel proposal files under ${SDLC}/.panel/ are process scratch (trace.py already ignores them; their decisions are baked into 02-architecture.md / 04-design.md and this review). If and only if you are NOT sending anything back, remove them with \`rm -rf ${SDLC}/.panel\` to keep the ledger lean. When send_back is non-empty, LEAVE .panel in place — the re-run gates and the re-review still need it. (A mid-run resume relies on them too.)`,
    `Report REVIEW: gaps_high/mid/low, drift, arch_consistent, arch_violations, send_back (BLOCKING findings → the owning gate keys, e.g. ["validation"]; recorded-debt-only → []), blocking_findings (MANDATORY whenever send_back is non-empty — one actionable entry per blocking finding, "<ID or file>: <what is wrong> → <what fixed looks like>"; the repair agent receives ONLY this list as its scope, so anything you leave to prose will NOT be fixed), conclusion (must agree with send_back; architecture inconsistency, a mock-only/undocumented REQ, a non-rendering dashboard, module-boundary violations, or a history-carrying/no-一鍵部署 manual must be reflected).`,
  ].join('\n'), { schema: REVIEW, label: pass > 1 ? `review#${pass}` : 'review', agentType: AT('reviewer'), model: M('review') }))

  let review = await reviewOnce(1)
  finalReview = review
  logCost('Review')
  const sbOf = (r) => (r && Array.isArray(r.send_back)) ? [...new Set(r.send_back.filter((g) => RUNNERS[g] && g !== 'review'))] : []
  const sb = sbOf(review)
  if (sb.length) {
    log(`review send-back (BLOCKING): ${sb.join(', ')} → auto re-running each gate ONCE (scoped to the named findings, issue #16), then re-reviewing (capped at one loop)`)
    SENDBACK_CTX = { gates: sb,
      findings: ((review.blocking_findings && review.blocking_findings.length)
        ? review.blocking_findings
        : [...(review.arch_violations || []), review.conclusion]).filter(Boolean).slice(0, 12) }
    try {
      for (const g of sb) { const st2 = await RUNNERS[g](); if (st2) return st2 }
    } finally {
      SENDBACK_CTX = null   // the re-review is a normal verification pass, never a repair run
    }
    review = await reviewOnce(2, sb)
    finalReview = review
    logCost('Review (re-review)')
    const sb2 = sbOf(review)
    if (sb2.length) {
      return { stopped: `review still BLOCKING after one auto re-run (send_back: ${sb2.join(', ')})`, results, clarifications, review,
        hint: `auto re-run is capped at ONCE to avoid long loops — decide explicitly: re-run just those gates (args.gates: ${JSON.stringify(sb2)}), accept as recorded debt, or investigate manually` }
    }
    log('re-review clean — previously blocking findings fixed')
  }
  log(`done: gaps high=${review ? review.gaps_high : '?'} mid=${review ? review.gaps_mid : '?'} low=${review ? review.gaps_low : '?'}; arch_consistent=${review ? review.arch_consistent : '?'}; send_back=${review && review.send_back ? review.send_back.length : '?'}`)
  return null
},
}

// ── Driver: single gate / subset / full composition ──
const GATE_ORDER = ['architecture', 'design', 'tests', 'impl', 'verify', 'validation', 'review']
const RUN_LIST = A.gate ? [A.gate] : (Array.isArray(A.gates) && A.gates.length ? A.gates : GATE_ORDER)
for (const g of RUN_LIST) if (!RUNNERS[g]) return { error: `unknown gate "${g}" — valid gates: ${GATE_ORDER.join(', ')}` }
if (A.gate || (Array.isArray(A.gates) && A.gates.length)) log(`gate-scoped run: ${RUN_LIST.join(' → ')}${DELTA_IDS.length ? ` (delta closure: ${DELTA_IDS.join(', ')})` : ''}`)

// Compose mode (the overall SDLC workflow REQUIRES each gate's own workflow): with a host `workflow()`
// and args.scriptPath (the command passes this script's own path), each gate runs as a CHILD workflow
// invocation of this same script with args.gate set — per-gate progress grouping, per-gate journal and
// resume. Any child failure falls back to running that gate inline (same runner, same behavior);
// hosts without workflow()/scriptPath run everything inline — the classic single-run behavior.
const CAN_COMPOSE = !A.gate && !(Array.isArray(A.gates) && A.gates.length) && typeof workflow === 'function' && !!A.scriptPath && A.compose !== false
if (CAN_COMPOSE) log('compose mode: each gate runs as its own child workflow (per-gate progress/resume)')
for (const g of RUN_LIST) {
  let usedChild = false, st2 = null
  if (CAN_COMPOSE) {
    try {
      const child = await workflow({ scriptPath: A.scriptPath }, { ...A, gate: g, tier: TIER, compose: false })
      usedChild = true
      if (!child) st2 = { stopped: `gate "${g}" child workflow returned nothing`, results, clarifications }
      else {
        results.push({ phase: `gate:${g} (child workflow)`, result: child.results || child })
        if (child.clarifications && child.clarifications.length) clarifications.push(...child.clarifications)
        if (child.review) finalReview = child.review
        if (child.validation) finalVal = child.validation
        if (child.cost_profile) for (const c of child.cost_profile) costLog.push({ phase: `${g}:${c.phase}`, ktokens: c.ktokens })
        if (child.stopped) st2 = { stopped: child.stopped, gate: g, detail: child.detail, results, clarifications,
          // composed runs resume by GATE LIST, not runId: the child's own runId is not surfaced, and
          // workflow()-child caching on parent resume is unverified — re-invoke with the remaining gates.
          hint: `composed run stopped at gate "${g}" — after answering, resume by re-invoking with args.gates: ${JSON.stringify(RUN_LIST.slice(RUN_LIST.indexOf(g)))} (same impactIds/iteration); resumeFromRunId applies to inline runs only` }
      }
    } catch (e) {
      log(`compose: child workflow for "${g}" unavailable/failed (${e && e.message ? e.message : e}) → running this gate inline`)
    }
  }
  if (!usedChild && !st2) st2 = await RUNNERS[g]()
  if (st2) return st2
}

log(`cost profile: ${costLog.map((c) => `${c.phase}=${c.ktokens}k`).join(' · ')}`)
return { feature: FEATURE, gates_run: RUN_LIST, ...(A.gate ? { gate: A.gate, io: GATE_IO[A.gate] } : {}), results, clarifications, owner_decisions: ownerDecisions, review: finalReview, validation: finalVal, cost_profile: costLog }
