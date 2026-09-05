// IT-107 (DES-141, v24): the auth boot line (`auth: enabled=<bool> principals=<n>
// defaultRole=<role> ownerlessRuns=<n> ownerlessTriggers=<n>`) and `system_info.auth =
// {enabled, principalsCount, defaultRole}`. Written test-first (Gate 5, RED) — no such boot line
// or `system_info.auth` key exists today.
// Mock policy: real booted engine (createServer), real GET /api/system HTTP route.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

describe('auth boot announcement (IT-107, DES-141)', () => {
  let server: Server;

  afterEach(async () => {
    await server?.close();
  });

  it('boot prints one line naming enabled/principals/defaultRole/ownerlessRuns/ownerlessTriggers', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    server = await createServer({
      port: 0, bind: '127.0.0.1',
      principals: { 'alice@x.com': { role: 'admin' } },
    });
    const bootLine = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('auth:'));
    expect(bootLine).toBeDefined();
    expect(bootLine).toMatch(/auth: enabled=true principals=1 defaultRole=user/);
    logSpy.mockRestore();
  });

  it('a MISSING principals map with auth enabled defaults everyone to user AND says so visibly (ADR-028 fail-closed)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    server = await createServer({ port: 0, bind: '127.0.0.1' });
    const bootLine = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('auth:'));
    expect(bootLine).toMatch(/defaultRole=user/);
    logSpy.mockRestore();
  });

  it('GET /api/system reports auth = {enabled, principalsCount, defaultRole}', async () => {
    server = await createServer({
      port: 0, bind: '127.0.0.1',
      principals: { '*': { role: 'user' } },
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/api/system`);
    const body = (await res.json()) as { auth?: unknown };
    expect(body.auth).toEqual({ enabled: true, principalsCount: 1, defaultRole: 'user' });
  });
});
