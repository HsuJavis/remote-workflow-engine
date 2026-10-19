// src/gateway/mcp-config-resolver.ts (pi harness v1, spec "Shared MCP resolution"). Extracted from
// `ClaudeAgentSdkGatewayClient._resolveMcpConfigs` (claude-agent-sdk-client.ts) verbatim — NO
// behaviour change for the sdk gateway, whose own tests (mcp-run-state-dispatch.test.ts,
// val-021-secret-store.test.ts, nested-asset-skill-mcp-scope.test.ts, authoring-guide.test.ts) stay
// green unmodified because that class now calls this function instead of its own private copy.
// `PiGatewayClient` calls the SAME function, so `${secret:NAME}`/`${run:dir}`/`${run:id}`
// substitution can never diverge between the two gateways.
import { mkdirSync } from 'node:fs';
import type { McpServerConfig } from '../mcp-probe.js';
import { resolveConfig, type SecretSource } from '../secret-resolver.js';
import { resolveRunPlaceholders, mcpStateDir, workflowFolderOfWorkspace } from '../mcp-run-state.js';

export type ResolveMcpFn = (workflow: string, names: string[]) => Promise<{ configs: Record<string, McpServerConfig>; missing: string[] }>;

/** issue #126 B (moved verbatim, see this file's own header): after `${secret:NAME}` substitution,
 *  also resolves `${run:dir}`/`${run:id}` against THIS run's own private state dir —
 *  `<workflowFolder>/mcp-state/<runId>/<server>/`, a SIBLING of the run workspace (never inside it,
 *  so it is invisible to `workspace_pull`/`workspace_list` and to the run's own confined Bash),
 *  derived structurally from `workspace`. Created 0700 on first use, ONLY when the config actually
 *  references `${run:dir}` (`usedDir`) — a server that never asks for one never gets a directory. */
export async function resolveMcpConfigs(
  deps: { resolveMcp?: ResolveMcpFn; secretSource?: SecretSource },
  workflow: string,
  names: string[],
  runId: string,
  workspace: string,
): Promise<{ configs: Record<string, McpServerConfig>; missing: string[] }> {
  if (deps.resolveMcp === undefined || names.length === 0) return { configs: {}, missing: names };
  const resolved = await deps.resolveMcp(workflow, names);
  const workflowFolder = workflowFolderOfWorkspace(workspace);
  const out: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(resolved.configs)) {
    try {
      const secretResolved = (deps.secretSource !== undefined ? resolveConfig(config, deps.secretSource) : config) as McpServerConfig;
      const stateDir = mcpStateDir(workflowFolder, runId, name);
      const { config: runResolved, usedDir } = resolveRunPlaceholders(secretResolved, { id: runId, dir: stateDir });
      if (usedDir) mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      out[name] = runResolved as McpServerConfig;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 'SECRET_MISSING' || code === 'SECRET_HANDLE_INVALID') {
        throw new Error(`${code}: provisioned MCP '${name}' has an unresolved secret handle — ${(err as Error).message}`);
      }
      throw err;
    }
  }
  return { configs: out, missing: resolved.missing };
}
