# Authoring a workflow script

This engine has no bundled guidance skills — the tool schemas returned by `tools/list` are the
only documentation a cold MCP client ever sees, and this file is what `workflow_register`'s
`script` parameter description points back to (see `SCRIPT_DSL_DOC` in `src/server.ts`).

Four rules govern a well-behaved workflow script:

1. **Declare every knob a user might need in `meta.params`, rather than hard-coding it.** A value
   the caller should be able to tune at run time belongs in the workflow's declared param
   contract, not a literal baked into the script body.

2. **Never read a value the contract does not declare.** A script that reaches for a param key
   outside its own `meta.params` declaration is reading a value nobody promised it, and nobody
   who published/audited the workflow can see it coming.

3. **Treat the six `LOCKED_KEYS` as engine-owned.** `prompt`, `tools`, `skills`, `mcp`, `workdir`,
   `cwd` are reserved — a workflow's own params contract must not redeclare or repurpose them.

4. **Phase titles are visible to every principal who can see the workflow — keep secrets and
   distinctive prose out of them.** `phase(title)` names (and the equivalent `meta.phases` entries)
   are public on every read surface, including the non-owner projection and the generated diagram
   (adjudication #1, 2026-09-02, `一律公開`). A phase title is not a private annotation.

## Standing note: registration and the diagram generator

Registering a workflow sends the **script itself** to the configured LLM provider so it can draw
a diagram (`workflow_describe`'s `diagram` field). This is not optional obfuscation — the whole
script body is the prompt. Set `graphAnalyzer.enabled: false` in `rwe.config.json` to turn this
off entirely; registration still succeeds, and `workflow_describe` reports the diagram as
unavailable instead.
