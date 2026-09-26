# Example workflows

Reference workflows for the remote-workflow-engine. Each is a plain Claude-format dynamic-workflow
JS file — register it once, then invoke by name.

---

## `customer-service.workflow.js` — multi-model draft → verify/synthesize

**Pattern**: two cheaper/faster models each independently **draft** a reply to a customer inquiry
(in parallel), then one stronger model **verifies** both drafts — dropping hallucinations,
over-confident or unsupported claims — and **synthesizes** the single best final reply to send.

Cheap models mass-produce candidates; a strong model is the quality gate. Observed in testing: the
verifier reliably caught real problems in the drafts (a garbled hallucination, an unsupported
"definitely still under warranty" claim, leftover template placeholders) and merged the good parts
into a tighter, correct final reply.

### Register + run

```bash
# 1. register once (script = the file's contents)
workflow_register({ name: "customer-service", script: <contents of customer-service.workflow.js> })

# 2. run — args is an object; the engine tolerates a JSON-string args too (MCP-client interop)
workflow_run({
  name: "customer-service",
  args: {
    inquiry: "我上週買的無線耳機右耳沒有聲音,已重新配對還是一樣。還在保固內嗎?",
    draftModels: ["openrouter/minimax/minimax-m3", "openrouter/moonshotai/kimi-k3"],
    verifyModel: "openrouter/openai/gpt-5.6-sol"
  }
})
# 3. poll workflow_status(runId) until completed, then workflow_result(runId)
```

### args

| field | type | default | notes |
|---|---|---|---|
| `inquiry` | string (required) | — | the customer's question |
| `draftModels` | string[] | two free OpenRouter models | any full `<provider>/<model-id>` ref; runs in **parallel** |
| `verifyModel` | string | `"anthropic/claude-opus-4-8"` | the aggregator/verifier; any full `<provider>/<model-id>` ref |

Discover available models with the `models_list` tool (filter e.g. `{location:"remote", toolUse:true, maxPricePerM:1}`) — each row's `ref` field is the exact string to paste.

### Using Anthropic-direct Opus (subscription or API key) as the verifier

`verifyModel:"anthropic/claude-opus-4-8"` dispatches straight to the real Anthropic API (bypassing
LiteLLM for native quality) — no config-file entry is needed for the model itself, just auth. In
`rwe.config.json`:

```jsonc
"anthropicAuth": "subscription"        // or "api-key"
```

and a secret in `~/.config/rwe.env`:

- subscription (Claude Pro/Max, zero API bill): `RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN=...`  (from `claude setup-token`)
- API key: `RWE_SECRET_ANTHROPIC_API_KEY=...`

then `systemctl --user restart rwe.service`.

### Measured E2E latency (real runs, this engine)

The two drafts run in **parallel**, so end-to-end ≈ `max(draftA, draftB) + verify` (not the sum).

| model tier | E2E latency | notes |
|---|---|---|
| **paid capable** (minimax-m3 / kimi-k3 / gpt-5.6-sol) | **~27–30 s** | consistent; the reliable choice |
| free OpenRouter tier | minutes, unreliable | rate-limited; some free models stall for 2–4 min |

Recommendation: for anything interactive, use capable models (paid, or Anthropic-direct) for the
drafts too — the free tier's latency/reliability dominates the wall-clock.
