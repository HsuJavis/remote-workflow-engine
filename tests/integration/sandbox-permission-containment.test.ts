// Issue #157 layer 3 (OS/Node-level containment, defense in depth under layers 1+2): proves the
// EXACT flags `SandboxHost` launches the sandbox child with (`SANDBOX_CHILD_EXEC_ARGV`) deny fs/
// child-process access REGARDLESS of whether the in-realm (layer 1) and env-scrub (layer 2) defenses
// hold. Deliberately bypasses `evaluateScript`/the vm context entirely and spawns a real `node`
// process directly with those flags, handing it a probe that reaches `process` the way an attacker
// would if layer 1 ever regressed (`process.getBuiltinModule(...)`, which works in both ESM and CJS
// and needs no `require`) — so this test keeps failing closed even if guards.ts is rewritten later in
// a way that reopens the realm escape. A second test confirms a LEGITIMATE script still completes
// normally under the same flags (the containment must not also break real runs).
//
// Mock policy (integration, DES-015): a real `node` child process is spawned with the real exported
// exec-argv constant — nothing here is faked.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SANDBOX_CHILD_EXEC_ARGV, SandboxHost } from '../../src/sandbox/host.js';

function runProbe(code: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...SANDBOX_CHILD_EXEC_ARGV.filter((a) => a !== '--disable-warning=ExperimentalWarning'), '-e', code], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {},
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

describe('#157 layer 3: the sandbox child\'s OWN exec flags deny fs/child-process even if `process` is reached directly', () => {
  it('fs.readFileSync via process.getBuiltinModule fails with ERR_ACCESS_DENIED', async () => {
    const { stdout } = await runProbe(
      `try { process.getBuiltinModule('fs').readFileSync('/etc/hostname'); console.log(JSON.stringify({ blocked: false })); }` +
        ` catch (e) { console.log(JSON.stringify({ blocked: true, code: e.code })); }`,
    );
    const out = JSON.parse(stdout.trim());
    expect(out.blocked).toBe(true);
    expect(out.code).toBe('ERR_ACCESS_DENIED');
  });

  it('child_process.execSync via process.getBuiltinModule fails with ERR_ACCESS_DENIED', async () => {
    const { stdout } = await runProbe(
      `try { process.getBuiltinModule('child_process').execSync('id'); console.log(JSON.stringify({ blocked: false })); }` +
        ` catch (e) { console.log(JSON.stringify({ blocked: true, code: e.code })); }`,
    );
    const out = JSON.parse(stdout.trim());
    expect(out.blocked).toBe(true);
    expect(out.code).toBe('ERR_ACCESS_DENIED');
  });

  it('a write outside the granted fs-read scope also fails (no --allow-fs-write was granted at all)', async () => {
    const { stdout } = await runProbe(
      `try { process.getBuiltinModule('fs').writeFileSync('/tmp/rwe-157-should-not-exist-${process.pid}', 'x'); console.log(JSON.stringify({ blocked: false })); }` +
        ` catch (e) { console.log(JSON.stringify({ blocked: true, code: e.code })); }`,
    );
    const out = JSON.parse(stdout.trim());
    expect(out.blocked).toBe(true);
    expect(out.code).toBe('ERR_ACCESS_DENIED');
  });
});

describe('#157 layer 3: the containment does not break a legitimate sandbox child', () => {
  it('a real SandboxHost.run() still completes an ordinary script under the hardened exec flags', async () => {
    const workDir = join(tmpdir(), 'rwe-157-permission-sanity');
    const host = new SandboxHost({ workspaceRoot: workDir, onAgentRequest: async () => 'stub-response' });
    const r = await host.run(
      'it157-permission-sanity',
      `
        const greeted = await agent('hello');
        const parts = await parallel([async () => 1, async () => 2]);
        return { greeted, sum: parts[0] + parts[1] };
      `,
      {},
      null,
    );
    expect('result' in (r as object) ? (r as { result: unknown }).result : r).toEqual({ greeted: 'stub-response', sum: 3 });
  });
});
