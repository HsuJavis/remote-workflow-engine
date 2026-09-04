// UT-031: Asset MCP-config live-probe — classifyTransport (pure) + McpProbe injection (DES-020, TASK-026)
// RED: src/mcp-probe.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect } from 'vitest';
// Value import — causes module-not-found at load time when absent.
import { classifyTransport } from '../../src/mcp-probe.js';

describe('classifyTransport (pure, DES-020)', () => {
  it('a remote HTTP MCP config is classified as remote-http', () => {
    const cfg = { type: 'http', url: 'https://tools.example.com/mcp' };
    expect(classifyTransport(cfg)).toBe('remote-http');
  });

  it('a stdio MCP config using npx is classified as npx-stdio', () => {
    const cfg = { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp-package'] };
    expect(classifyTransport(cfg)).toBe('npx-stdio');
  });

  it('a stdio MCP config with an arbitrary binary is unsupported (not npx-installable)', () => {
    const cfg = { type: 'stdio', command: '/usr/bin/python3', args: ['server.py'] };
    expect(classifyTransport(cfg)).toBe('unsupported');
  });

  it('an unknown/missing type is classified as unsupported', () => {
    const cfg = { type: 'sse', url: 'http://example.com/sse' };
    expect(classifyTransport(cfg)).toBe('unsupported');
  });
});

// Note: McpProbe injection tests (fake accept/reject) are at integration tier (IT-034) where a
// real workspace_push (mode B, kind:'mcp' — v24 DES-153/TASK-152, the asset-push tool this used
// to name is retired) flow runs through a real AssetService + injected FakeMcpProbe. Unit tier only
// covers the pure classifyTransport gate (testability-first design from DES-020 Decision rationale).
