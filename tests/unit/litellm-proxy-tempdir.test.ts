// #60 (v25): LiteLLMProxyManager creates a temp dir per start (`mkdtemp(tmpdir(), 'rwe-litellm-')`)
// to hold the generated config.yaml, and never removed it. On the owner's host that had accumulated
// 11,251 directories over six days — 44MB of disk, but 11,251 inodes and directory entries, which is
// the cost that actually bites on a container or a small /tmp.
//
// DEPLOY.md promised "正常關機（SIGTERM）會連帶停掉這個子行程，不留孤兒" and that promise is TRUE
// for the PROCESS — the cold-start check confirmed the child dies with the engine. It said nothing
// about the directory, so the sentence was accurate and the reader still ended up with 11,251 of
// them. Written test-first (RED).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';

const HEALTHY = vi.fn(async () => ({ ok: true }) as unknown as Response);

function makeFakeProc(): ChildProcess & EventEmitter {
  const proc = new EventEmitter() as EventEmitter & { exitCode: number | null; pid: undefined; kill: () => void };
  proc.exitCode = null;
  proc.pid = undefined;
  proc.kill = () => { proc.exitCode = 0; };
  return proc as unknown as ChildProcess & EventEmitter;
}

const dirsNow = (): string[] =>
  readdirSync(tmpdir()).filter((n) => n.startsWith('rwe-litellm-'));

describe('#60 LiteLLM temp dir lifecycle', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('stop() removes the temp dir it created — not just the process', async () => {
    const before = new Set(dirsNow());
    const proxy = new LiteLLMProxyManager({
      port: 48310,
      spawnImpl: (() => makeFakeProc()) as unknown as typeof import('node:child_process').spawn,
      fetchImpl: HEALTHY as unknown as typeof fetch,
    } as never);

    await proxy.start();
    const created = dirsNow().filter((n) => !before.has(n));
    expect(created.length, 'start() should have created exactly one temp dir').toBe(1);
    const dir = join(tmpdir(), created[0]!);
    expect(existsSync(join(dir, 'config.yaml'))).toBe(true);

    await proxy.stop();

    // The assertion that matters: the DIRECTORY is gone, not only the process.
    expect(existsSync(dir), `stop() left ${dir} behind`).toBe(false);
  });

  // THE CASE THAT WAS MISSING, and it cost the production engine its live config dir minutes after
  // the first version of this fix shipped. That sweep used age alone, and a stable long-running
  // engine's dir is OLD PRECISELY BECAUSE the engine is stable — so "old" and "abandoned" are not
  // the same thing. Ownership is the real question, so this pins it: an ANCIENT dir whose owning
  // pid is still alive must survive.
  it('an ancient dir whose owner pid is STILL ALIVE is never swept (the production regression)', async () => {
    const live = join(tmpdir(), `rwe-litellm-livetest${Date.now()}`);
    mkdirSync(live, { recursive: true });
    writeFileSync(join(live, 'config.yaml'), 'a long-running engine is using this', 'utf8');
    writeFileSync(join(live, 'owner.pid'), String(process.pid), 'utf8'); // this test IS alive
    const ancient = Date.now() - 30 * 24 * 3600_000; // a month old
    const { utimesSync } = await import('node:fs');
    utimesSync(live, ancient / 1000, ancient / 1000);

    const proxy = new LiteLLMProxyManager({
      port: 48313,
      spawnImpl: (() => makeFakeProc()) as unknown as typeof import('node:child_process').spawn,
      fetchImpl: HEALTHY as unknown as typeof fetch,
    } as never);

    try {
      await proxy.start();
      expect(existsSync(live), 'the sweep took a dir whose owner is still running').toBe(true);
      expect(readFileSync(join(live, 'config.yaml'), 'utf8')).toBe('a long-running engine is using this');
    } finally {
      await proxy.stop();
      rmSync(live, { recursive: true, force: true });
    }
  });

  // The mirror of the above: an owner that is GONE means the dir is reclaimable however new it is.
  it('a dir whose owner pid is dead is swept even when recent', async () => {
    const orphan = join(tmpdir(), `rwe-litellm-orphantest${Date.now()}`);
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, 'config.yaml'), 'owner crashed', 'utf8');
    // A pid that cannot be running: max_pid+1 territory, verified unused below.
    let deadPid = 4194303;
    try { process.kill(deadPid, 0); deadPid = 999999; } catch { /* confirmed not running */ }
    writeFileSync(join(orphan, 'owner.pid'), String(deadPid), 'utf8');

    const proxy = new LiteLLMProxyManager({
      port: 48314,
      spawnImpl: (() => makeFakeProc()) as unknown as typeof import('node:child_process').spawn,
      fetchImpl: HEALTHY as unknown as typeof fetch,
    } as never);

    try {
      await proxy.start();
      expect(existsSync(orphan), 'an orphaned dir survived the sweep').toBe(false);
    } finally {
      await proxy.stop();
      rmSync(orphan, { recursive: true, force: true });
    }
  });

  // The sweep is age-gated for a reason: DEPLOY §0 documents running a SECOND instance on another
  // port, and its live dir must survive this one's start(). Without this case the sweep could be
  // deleting a concurrent engine's config out from under it and both other tests would still pass.
  it('a RECENT rwe-litellm-* dir (a concurrent instance\'s live one) is NOT swept', async () => {
    const fresh = join(tmpdir(), `rwe-litellm-freshtest${Date.now()}`);
    mkdirSync(fresh, { recursive: true });
    writeFileSync(join(fresh, 'config.yaml'), 'another instance is using this', 'utf8');

    const proxy = new LiteLLMProxyManager({
      port: 48312,
      spawnImpl: (() => makeFakeProc()) as unknown as typeof import('node:child_process').spawn,
      fetchImpl: HEALTHY as unknown as typeof fetch,
    } as never);

    try {
      await proxy.start();
      expect(existsSync(fresh), 'the sweep took a live dir belonging to another instance').toBe(true);
      expect(readFileSync(join(fresh, 'config.yaml'), 'utf8')).toBe('another instance is using this');
    } finally {
      await proxy.stop();
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('a stale rwe-litellm-* dir from a previous crash is swept at start()', async () => {
    // 11,251 dirs in six days means some engines died WITHOUT running stop(), so a teardown-only
    // fix cannot converge. A boot sweep is what collects those.
    const stale = join(tmpdir(), `rwe-litellm-staletest${Date.now()}`);
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'config.yaml'), 'stale', 'utf8');
    // Age it well past any sane threshold.
    const old = Date.now() - 48 * 3600_000;
    const { utimesSync } = await import('node:fs');
    utimesSync(stale, old / 1000, old / 1000);

    const proxy = new LiteLLMProxyManager({
      port: 48311,
      spawnImpl: (() => makeFakeProc()) as unknown as typeof import('node:child_process').spawn,
      fetchImpl: HEALTHY as unknown as typeof fetch,
    } as never);

    try {
      await proxy.start();
      expect(existsSync(stale), 'a stale temp dir survived start()').toBe(false);
    } finally {
      await proxy.stop();
      rmSync(stale, { recursive: true, force: true });
    }
  });
});
