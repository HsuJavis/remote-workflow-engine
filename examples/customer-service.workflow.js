// customer-service.workflow.js — a "multi-model draft → verify/synthesize" workflow.
//
// KNOWN STALE (pre-existing, not touched by the 2026-09-26 alias-removal change): this file
// predates the v24 `agent(label, options)` + static `meta.params.agents.<label>` contract (ARCH-096
// requires a literal label and a literal options object per call, declared ahead of time) — the
// dynamic per-item `agent(prompt, {model, label})` calls below will not register on the current
// engine as-is. Only the alias/model-ref wording and defaults were updated here; a full v24
// migration (bounded draft slots, each with its own static contract entry) is separate follow-up
// work, tracked outside this change.
//
// Two cheaper/faster models each independently DRAFT a reply to a customer inquiry (in parallel),
// then one stronger model VERIFIES both drafts (drops hallucinations / over-confident or unsupported
// claims) and SYNTHESIZES the single best final reply to send. This is a cheap way to raise answer
// quality: cheap models mass-produce candidates, a strong model does the quality gate.
//
// Register once, then invoke by name:
//   workflow_register({ name: "customer-service", script: <this file's contents> })
//   workflow_run({ name: "customer-service", args: { inquiry: "..." } })
//
// args:
//   inquiry      (string, required)  the customer's question
//   draftModels  (string[], optional) two full `<provider>/<model-id>` refs that draft in parallel.
//                default: two free OpenRouter models. Any `openrouter/<id>` (or other provider) ref works.
//   verifyModel  (string, optional)  the aggregator/verifier. default: "anthropic/claude-opus-4-8"
//                (an anthropic-direct ref — configure auth on the engine; see examples/README.md).
//
// returns: { inquiry, draftModels, verifyModel, drafts: [reply1, reply2], final }

export const meta = {
  name: 'customer-service',
  description: 'Two OSS models draft customer-support replies in parallel; a stronger model verifies both and synthesizes the single best final reply.',
  phases: [
    { title: 'Draft', detail: 'two models each draft a reply in parallel' },
    { title: 'Verify & synthesize', detail: 'verifier checks both drafts and writes the final reply' },
  ],
};

const inquiry = String(args.inquiry ?? '').trim();
const draftModels = args.draftModels ?? [
  'openrouter/google/gemma-4-26b-a4b-it:free',
  'openrouter/openai/gpt-oss-20b:free',
];
const verifyModel = args.verifyModel ?? 'anthropic/claude-opus-4-8';

if (!inquiry) return { error: 'ISSUE: args.inquiry is required (the customer question)' };

const SYS =
  'You are a helpful, accurate, concise customer-support agent. Answer the customer directly and ' +
  'politely. Do not invent facts; if unsure, say what you can confirm and offer a next step.';

phase('Draft');
const drafts = await parallel(
  draftModels.map((m, i) => () =>
    agent(`${SYS}\n\nCustomer inquiry:\n"""${inquiry}"""\n\nWrite your reply to the customer.`, {
      model: m,
      label: `draft-${i + 1} (${m})`,
    }),
  ),
);

phase('Verify & synthesize');
const verifyPrompt =
  `A customer asked:\n"""${inquiry}"""\n\n` +
  `Two support agents independently drafted these replies:\n\n` +
  `[Draft 1]\n${drafts[0] ?? '(no reply — model failed)'}\n\n` +
  `[Draft 2]\n${drafts[1] ?? '(no reply — model failed)'}\n\n` +
  `Your job: VERIFY both drafts for factual correctness, completeness, and tone; discard anything ` +
  `wrong or unsupported; then write ONE best final reply to send to the customer — concise, polite, ` +
  `correct. Output ONLY the final reply text (no preamble).`;
const final = await agent(verifyPrompt, { model: verifyModel, label: `verify-synthesize (${verifyModel})` });

return { inquiry, draftModels, verifyModel, drafts, final };
