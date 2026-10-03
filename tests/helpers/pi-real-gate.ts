// pi harness v1, independent review B2 (HIGH): shared gating + process-scoping helpers for the pi
// real-tier acceptance tests. Before this file, each real-tier test decided whether to run itself
// just from `curl localhost:11434/api/tags == 200` — on the production host (user `rwe`, same loopback
// Ollama, bwrap/socat installed, npm ci's own claude-agent-sdk-linux-x64 binary usable as rg) that
// condition is TRUE, so these tests silently started running against a real 7B model, with 60-75s
// timeouts, INSIDE the self-update's full-suite run (`deploy/rwe-update.sh`) — any flake there
// reverts the deploy. Every pre-existing real-tier test in this repo opts in through an explicit env
// var instead; this file gives the pi tests the same contract: `RWE_PI_REAL_TESTS=1` is required IN
// ADDITION to the dependency checks, never instead of them.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

/** The one explicit opt-in every pi real-tier test requires before even checking host state. */
export function piRealTestsEnabled(): boolean {
  return process.env['RWE_PI_REAL_TESTS'] === '1';
}

export function ollamaReachable(baseUrl = 'http://localhost:11434'): boolean {
  try {
    return execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 2 ${baseUrl}/api/tags`, { encoding: 'utf8' }).trim() === '200';
  } catch {
    return false;
  }
}

/** review P6-1: the gate never checked that the SPECIFIC model tag the test prompts is actually
 *  pulled — Ollama reachable with a DIFFERENT model installed still passed the old gate, then failed
 *  at dispatch time. Parses the real `/api/tags` response body (not just the status code). */
export function ollamaModelPulled(tag: string, baseUrl = 'http://localhost:11434'): boolean {
  try {
    const body = execSync(`curl -s --max-time 2 ${baseUrl}/api/tags`, { encoding: 'utf8' });
    const parsed = JSON.parse(body) as { models?: Array<{ name?: string }> };
    return (parsed.models ?? []).some((m) => m.name === tag);
  } catch {
    return false;
  }
}

/** review P6-3: mcp-real.test.ts needs the npm registry (and a warm npx cache) to launch
 *  `npx -y @modelcontextprotocol/server-everything`, but was gated on Ollama alone — with Ollama up
 *  and the registry unreachable it failed at dispatch instead of skipping cleanly. */
export function npmRegistryReachable(): boolean {
  try {
    execSync('curl -s -o /dev/null --max-time 3 https://registry.npmjs.org/', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function hasBinary(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** True once `pid` is no longer a live process (ESRCH) — the direct, zero-ambiguity liveness check
 *  for a PID this test itself captured (e.g. via the `spawnChild` test seam), as opposed to a
 *  host-wide `pgrep` pattern that matches every OTHER process on the host with a similar command
 *  line (review P6-2's exact finding: production running its own pi dispatch or server-everything at
 *  deploy time made these assertions fail for a completely unrelated reason). */
export function isDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function directChildren(pid: number): number[] {
  try {
    const raw = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
    return raw.length === 0 ? [] : raw.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

/** Snapshots the FULL descendant pid tree of `rootPid` right now (while it is still alive) — the
 *  scoped alternative to a host-wide `pgrep -af <name>` for proving a specific dispatch's own
 *  grandchildren (e.g. an MCP server launched via `npx`) are gone afterward: call this WHILE the
 *  dispatch is in flight (its pid tree still attached to `rootPid`), then assert every captured pid
 *  `isDead()` once the dispatch has settled. */
export function collectDescendantPids(rootPid: number): number[] {
  const all: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const kid of directChildren(pid)) {
      all.push(kid);
      queue.push(kid);
    }
  }
  return all;
}

/** Best-effort: every `/proc/[0-9]+` entry whose `cmdline` contains `needle`, EXCLUDING `excludePid`
 *  (this test's own shell/runner, which may itself have `needle` as a substring of the full command
 *  line used to launch vitest). Used only as a LAST-RESORT fallback when a process has already
 *  reparented away from any pid this test captured (e.g. `npx`'s own child after `npx` itself exits)
 *  — scoped by content match on `/proc` directly rather than shelling out to a host-wide `pgrep`, and
 *  callers are expected to additionally confirm via `collectDescendantPids` wherever possible. */
export function procMatching(needle: string, excludePid: number): number[] {
  const out: number[] = [];
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return out;
  }
  for (const name of entries) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0 || pid === excludePid) continue;
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (cmdline.includes(needle)) out.push(pid);
    } catch {
      // process exited between readdir and read, or unreadable — not ours either way
    }
  }
  return out;
}
