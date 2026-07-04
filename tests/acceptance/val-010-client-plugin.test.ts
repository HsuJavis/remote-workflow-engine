// VAL-010: Claude Code client plugin — installed artifact + tool namespace coexistence (REQ-010)
// RED: plugin/ directory does not exist yet — existsSync assertions fail.
// DES-023 real-tier: the plugin artifact is tested directly (client-side artifact, not a server API).
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname);
const PLUGIN_DIR = join(REPO_ROOT, 'plugin');

describe('Client plugin artifact (REQ-010, VAL-010)', () => {
  it('plugin directory exists at repo root (installable by Claude Code)', () => {
    expect(existsSync(PLUGIN_DIR)).toBe(true);
  });

  it('.mcp.json exists and is valid JSON', () => {
    const p = join(PLUGIN_DIR, '.mcp.json');
    expect(existsSync(p)).toBe(true);
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    expect(typeof parsed).toBe('object');
  });

  it('guidance skill SKILL.md exists under rwe-* reserved name (DES-021)', () => {
    expect(existsSync(join(PLUGIN_DIR, 'skills', 'rwe-remote-workflow', 'SKILL.md'))).toBe(true);
  });

  it('plugin MCP server name does NOT collide with the built-in Workflow tool namespace (REQ-010)', () => {
    const mcpJson = join(PLUGIN_DIR, '.mcp.json');
    expect(existsSync(mcpJson)).toBe(true);
    const cfg = JSON.parse(readFileSync(mcpJson, 'utf8')) as { mcpServers?: Record<string, unknown> };
    const names = Object.keys(cfg.mcpServers ?? {}).map((n) => n.toLowerCase());
    // Must not be empty AND must not shadow the built-in 'workflow' namespace
    expect(names.length).toBeGreaterThan(0);
    expect(names.includes('workflow')).toBe(false);
  });

  it('plugin .mcp.json references an HTTP server endpoint (not a placeholder)', () => {
    const mcpJson = join(PLUGIN_DIR, '.mcp.json');
    expect(existsSync(mcpJson)).toBe(true);
    const text = readFileSync(mcpJson, 'utf8');
    expect(text).toMatch(/https?:\/\//);
  });

  it('plugin skill directory contains a rwe-* named skill (matches DES-019 recursion-guard prefix)', () => {
    const skillsDir = join(PLUGIN_DIR, 'skills');
    expect(existsSync(skillsDir)).toBe(true);
    const dirs = readdirSync(skillsDir);
    expect(dirs.some((d) => d.startsWith('rwe-'))).toBe(true);
  });
});
