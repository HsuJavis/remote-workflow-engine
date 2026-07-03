// agentType definitions composition-root loader (D-F2 / DES-007 / ARCH-004): loads server-side
// agent definitions from a directory of `agents/*.md` frontmatter files (compat-spec §5:
// "frontmatter single-sources model/tools/prompt") into the `agentTypes` registry AgentExecutor
// already knows how to resolve against (D-V5). `tools:` (a comma-separated list, e.g.
// "Read, Write") is now stored as AgentTypeDef.tools — AgentExecutor.run() applies it to the
// outbound opts.allowedTools (D-F11/UT-025), closing the gap this file's header used to document.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentTypeDef } from './agent-executor.js';

/** Splits a `---\n...\n---\nbody` file into its flat `key: value` frontmatter attributes and the
 *  remaining body text. Files with no frontmatter block are treated as pure body (name falls back
 *  to the filename). */
function parseFrontmatter(raw: string): { attrs: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { attrs: {}, body: raw.trim() };
  const [, frontmatter, body] = match;
  const attrs: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) attrs[key] = value;
  }
  return { attrs, body: body.trim() };
}

/** Loads every `*.md` file directly under `dir` into a name -> AgentTypeDef registry. A missing
 *  directory resolves to an empty registry (fail-fast for unknown agentType names still happens at
 *  AgentExecutor resolution time, not here) rather than throwing at startup. */
export function loadAgentDefinitions(dir: string): Record<string, AgentTypeDef> {
  const registry: Record<string, AgentTypeDef> = {};
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return registry;
  }
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf8');
    const { attrs, body } = parseFrontmatter(raw);
    const name = attrs['name'] ?? file.replace(/\.md$/, '');
    const def: AgentTypeDef = { systemPrompt: body };
    if (attrs['model']) def.model = attrs['model'];
    if (attrs['tools']) def.tools = attrs['tools'].split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    registry[name] = def;
  }
  return registry;
}
