// UT-032: Client plugin artifact invariants — dir layout + MCP config + guidance skill (DES-021, TASK-022)
// RED: plugin/ directory does not exist yet — existsSync assertions fail, never returns early.
// This is a pure structural/artifact test (no runtime behavior — DES-021 is "mostly non-code").
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolve relative to the repo root (this test file lives at tests/unit/).
const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname);
const PLUGIN_DIR = join(REPO_ROOT, 'plugin');

describe('Client plugin artifact (DES-021)', () => {
  it('plugin directory exists', () => {
    expect(existsSync(PLUGIN_DIR)).toBe(true);
  });

  it('.mcp.json is present and valid JSON', () => {
    const mcpJson = join(PLUGIN_DIR, '.mcp.json');
    expect(existsSync(mcpJson)).toBe(true);
    expect(() => JSON.parse(readFileSync(mcpJson, 'utf8'))).not.toThrow();
  });

  it('guidance skill SKILL.md is present under the reserved rwe-* prefix path', () => {
    const skillPath = join(PLUGIN_DIR, 'skills', 'rwe-remote-workflow', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
  });

  it('SKILL.md mentions the async workflow_run→poll→workflow_result contract (DES-021)', () => {
    const skillPath = join(PLUGIN_DIR, 'skills', 'rwe-remote-workflow', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
    const text = readFileSync(skillPath, 'utf8');
    expect(text).toMatch(/workflow_status/i);
    expect(text).toMatch(/workflow_result/i);
  });

  it('plugin MCP server name does NOT collide with the built-in dynamic Workflow tool (REQ-010)', () => {
    const mcpJson = join(PLUGIN_DIR, '.mcp.json');
    expect(existsSync(mcpJson)).toBe(true);
    const config = JSON.parse(readFileSync(mcpJson, 'utf8')) as { mcpServers?: Record<string, unknown> };
    const names = Object.keys(config.mcpServers ?? {}).map((n) => n.toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    expect(names.includes('workflow')).toBe(false);
  });

  it('plugin skills/ dir contains at least one rwe-* skill (matches DES-019 recursion-guard prefix)', () => {
    const skillsDir = join(PLUGIN_DIR, 'skills');
    expect(existsSync(skillsDir)).toBe(true);
    const dirs = readdirSync(skillsDir);
    expect(dirs.some((d) => d.startsWith('rwe-'))).toBe(true);
  });
});
