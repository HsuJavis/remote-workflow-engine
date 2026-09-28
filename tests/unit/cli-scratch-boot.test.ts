// Issue #101 (CLI scratch), boot half: composeConfig() refuses a workRoot too long for the per-dispatch
// CLI scratch's unix sockets — but only where the kernel sandbox will actually be used (sdk gateway +
// a measured 'confined' probe + a real absolute workRoot) — and main()'s boot sweep removes the
// leftovers of a killed process. Mock policy: the SDK query seam and the proxy manager are fakes.
import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeConfig, sweepCliScratch } from '../../src/main.js';

const DEPS = {
  queryImpl: vi.fn(),
  proxyManager: { start: vi.fn().mockResolvedValue({ port: 4001 }), stop: vi.fn(), isRunning: vi.fn().mockReturnValue(false) },
} as unknown as Parameters<typeof composeConfig>[1];

const CONFINED = { ...DEPS, confinementProbe: { posture: 'confined' } } as unknown as Parameters<typeof composeConfig>[1];
const UNCONFINED = { ...DEPS, confinementProbe: { posture: 'unconfined', reason: 'x' } } as unknown as Parameters<typeof composeConfig>[1];

// 56 bytes is the largest workRoot whose `<workRoot>/cli-tmp/dXXXXXX/claude-socks-<16hex>.sock` fits 107.
const AT_LIMIT = '/' + 'w'.repeat(55);
const OVER = AT_LIMIT + 'w';

describe('issue #101 composeConfig refuses a workRoot too long for the per-dispatch CLI scratch', () => {
  it('confined sdk boot with a 57-byte workRoot refuses, naming the limit and the fix', async () => {
    const err = await composeConfig({ gateway: 'sdk', workRoot: OVER }, CONFINED).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/CLI_SCRATCH_PATH_TOO_LONG/);
    expect(err?.message).toContain(OVER);
    expect(err?.message).toMatch(/56 bytes/);
    expect(err?.message).toMatch(/shorter workRoot/i);
  });

  it('boundary and real paths pass: 56 bytes, production (32) and the planned engine user (31)', async () => {
    for (const workRoot of [AT_LIMIT, '/home/user/.local/share/rwe-data', '/home/rwe/.local/share/rwe-data']) {
      await expect(composeConfig({ gateway: 'sdk', workRoot }, CONFINED)).resolves.toBeDefined();
    }
  });

  it('does not apply where no sandbox is used: unconfined probe, no probe, direct-fetch gateway, --check-config placeholder', async () => {
    await expect(composeConfig({ gateway: 'sdk', workRoot: OVER }, UNCONFINED)).resolves.toBeDefined();
    await expect(composeConfig({ gateway: 'sdk', workRoot: OVER }, DEPS)).resolves.toBeDefined();
    await expect(composeConfig({ gateway: 'direct-fetch', workRoot: OVER }, CONFINED)).resolves.toBeDefined();
    const placeholder = { ...CONFINED, workRootDefault: '<workRoot not set — a temp dir is created at real boot, with a long placeholder>' } as unknown as Parameters<typeof composeConfig>[1];
    await expect(composeConfig({ gateway: 'sdk' }, placeholder)).resolves.toBeDefined();
  });
});

describe('issue #101 boot sweep of <workRoot>/cli-tmp', () => {
  it('removes every leftover per-dispatch scratch and leaves the rest of workRoot alone; absent dir is fine', () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-cliboot-'));
    mkdirSync(join(workRoot, 'cli-tmp', 'dAAAAAA', 'claude-1000'), { recursive: true });
    writeFileSync(join(workRoot, 'cli-tmp', 'dAAAAAA', 'claude-1000', 'x.txt'), 'x');
    mkdirSync(join(workRoot, 'workflows'));
    sweepCliScratch(workRoot);
    expect(existsSync(join(workRoot, 'cli-tmp'))).toBe(false);
    expect(existsSync(join(workRoot, 'workflows'))).toBe(true);
    expect(() => sweepCliScratch(workRoot)).not.toThrow();
    rmSync(workRoot, { recursive: true, force: true });
  });
});
