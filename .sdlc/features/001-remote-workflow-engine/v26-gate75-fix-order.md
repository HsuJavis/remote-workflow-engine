# v26 Gate 7.5 round 1 — fix order (orchestrator → fixer)

**Date:** 2026-09-09. **Recovery point:** `ed517bf` (Gate 7.5 round-1 output + the state.yaml YAML repair).
**Round-1 result:** 7/10 REQs real-green. `npx vitest run` 2534 passed / 0 failed / 26 env-gated skips;
`tsc --noEmit` clean; production `rwe.service` never restarted (`NRestarts=0`).

You are ONE fixer. Everything below is already ruled on — do not re-plan and do not re-open a REQ.
**CLAUDE.md binds you:** never `git checkout <sha> -- <path>`, `git restore --source=`, `git stash`, or the
no-sha `git checkout -- <path>` / `git restore <path>`. Read an old version only with `git show <sha>:<path>`.
**Never touch production:** `rwe.service` on port 8899 runs `src/main.ts` **out of this very working tree**.
Do not restart it, do not `pkill -f "tsx ... src/main.ts"` (its argv reads `… loader.mjs src/main.ts`, so a
pattern kill aimed at a scratch engine can hit production), and never write `rwe.config.json` or
`~/.config/rwe.env`. Scratch engines get their own port and a workRoot outside every Claude project.

**REQ-126 is NOT in your scope** — it is with the owner. Leave `wireEffort` alone except for the one honesty
fix in item 8.

---

## 1. REQ-128 red — the cold-model clause (defect D6), then a re-run that actually counts

A fresh `openai/gpt-5.6-luna`, given only `tools/list` + the guide, needed **four** `workflow_register`
attempts. The first was refused `PARSE_ERROR: Unexpected token export` because it wrapped the body in
`export default async function`. No diagram rule ever refused it — **the guide never states the script-body
form.**

- Say it in `src/authoring-guide.ts`, in the section that first shows a script: the body is a **bare async
  function body** — statements and a `return`, no `export`, no `function` wrapper, no top-level `import`;
  `export const meta = {…}` is the one exception and it is a literal.
- Make `PARSE_ERROR` name **the line and the offending construct**, not just the parser's raw message.
- Regenerate `docs/AUTHORING.md` via `scripts/gen-authoring-md.ts` afterwards or the byte-lock test fails.
- **Then re-run the cold-model protocol with a DIFFERENT fresh subject** — a different model id, a new
  context, only `tools/list` + the guide, on a scratch engine. The runbook's own rule: a corrected document
  re-verified by the same contaminated model proves nothing. **Acceptance is a first-attempt register.** A
  doc fix alone does not close REQ-128.

## 2. REQ-129 red — the pan-translated figure covers its own Fit button

After a drag-pan on the run DAG, `document.elementFromPoint` at `#dag-fit`'s own centre returns
`svg#dag-graph`; a programmatic `.click()` still resets, so the handler is alive and this is z-order.
Fix with stacking order or `pointer-events` on the control, and **re-verify with a real Chromium mouse click
after a real pan** — not `.click()`, which is what hid it.

## 3. D3/D4 — the price table is wrong, and REQ-127's whole point is the numbers

- `claude-sonnet-5` is listed at `$3/$15` per MTok; the real rate is **$2/$10**. Fix it and drop the stale
  intro-pricing caveat.
- Cache read and cache write are priced at the **input** rate. The published multipliers are ~**0.1×** input
  for a cache read and **1.25× (5m) / 2× (1h)** for a cache write. The code comment justifying the flat rate
  ("no published per-TTL breakdown") no longer holds. LiteLLM's usage reports a single
  `cache_creation_input_tokens` with no TTL split, so **pick one write multiplier, state which, and say why**
  in the code and in the guide's cost paragraph.
- **Re-derive the smoke number** afterwards: `costUSD 0.003011` for 2796 in + 43 out on
  `claude-haiku-4-5-20251001`. Haiku's rates were not named as wrong, so it should hold — confirm, don't assume.

## 4. D1 — three array parameters have no `items`, and that kills a whole client family

`workflow_register.triggers`, `workspace_diff.manifest` and `workspace_delete.paths` are declared
`{type:'array'}` with no `items`, so Google/Gemini clients reject the **entire** tool surface with
`400 INVALID_ARGUMENT` — observed for real when the first cold-model probe died before its first tool call.
This is the same hole REQ-121 just closed for `seed`, in three more places. Fix all three, then add a
**drift-lock test**: every array-typed property anywhere in `TOOL_SPECS` declares `items`. Re-run
`RWE_TOOL_SURFACE_REPORT=1 npx vitest run tests/acceptance/v24-tool-surface.test.ts` last so the committed
surface table is current.

## 5. D2 — `direct-fetch` is broken, and it lies about it

Two defects, both need a red test first:
- `gateway:"direct-fetch"` with `useLiteLLMProxy` left on sends the **bare alias** while
  `generateLiteLLMConfig` only registers `rwe-proxy-<alias>`, so the proxy answers
  `400 no healthy deployments for model=local` on every `agent()` call. `proxyModelName()`'s own comment
  says it must be applied on both sides — apply it.
- That terminal failure is recorded as `AgentRecord state:'done'`. The SDK path correctly records `'failed'`.
  A failed call that reads as done is the observability defect REQ-125 exists to prevent.

## 6. D7 — `agentSlots` is a dead config key (this is the THIRD time)

`agentSlots` is in `KNOWN_FILE_CONFIG_KEYS` but `composeConfig()` never forwards it: booting with
`agentSlots:7` still reports `agentSemaphore.total 32`. Forward it, add the case to
`compose-config-v2-wiring.test.ts`, and **while you are there, mechanically check every
`KNOWN_FILE_CONFIG_KEYS` entry against `composeConfig()` and report any others you find.** This exact class
has now bitten v11, v15 and v26; a one-off fix without the sweep invites a fourth.

## 7. D8 — ruled: the dashboard shows four columns

REQ-127 names the dashboard among the surfaces where the four token columns must be visible. It currently
renders their **sum** plus `costUSD` and an unpriced marker; both API surfaces do show all four. Render the
four. A tooltip or an expandable cell is fine — the requirement is that a human can read
input / output / cacheRead / cacheWrite without leaving the page.

## 8. REQ-126 — one honesty fix only, the rest is the owner's

`harness.effortApplied` currently reports `{param:'thinking', value:1024|4096}` for a request that carries
**no** reasoning field at all on the wire (VAL-186 captured both bodies through a recording pass-through).
Whatever the owner rules, that record is false today. Make `effortApplied` on the OpenRouter-via-CLI path
report `{applied:false, reason:'…'}` naming the real cause: the Claude CLI collapses the thinking budget to
`thinking:{type:'adaptive'}`, so low and high are byte-identical on the wire and LiteLLM drops it for
OpenRouter. Do **not** change routing, and do not amend REQ-126's acceptance — that is the owner's call.

---

## Definition of done

1. `npx tsc --noEmit` clean; `npx vitest run` green. No test deleted or skipped to get there.
2. Items 1 and 2 each carry the **live** re-verification named above (a fresh cold subject that registers on
   the first attempt; a real mouse click after a real pan). Record what you observed, with the model id and
   the element the click landed on.
3. Every fix has a test that was **measured red first** — quote the red message.
4. Write `VAL-191`+ rows in `08-validation.md` for the re-verifications and `IMPL-207`+ rows in
   `06-impl-log.md` for the code, each naming the defect id (D1/D2/D3/D4/D6/D7/D8) it closes.
5. `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine` — no new broken links or orphans; and
   `python3 -c "import yaml;yaml.safe_load(open('.sdlc/features/001-remote-workflow-engine/state.yaml'))"`
   must still parse (a note written into a `{…}` flow scalar broke it once already this iteration — put long
   notes on a block scalar or escape properly).
6. Commit with `git commit -F <file>`, never `-m` with backticks. Do not flip
   `gates.validation.passed` — the Gate 7.5 delta re-run does that, not you.
