// DES-081/082 (ARCH-053, TASK-077/078): SeedRefFetcher port + hardened-git impl.
// The port (interfaces) is declared for RunManager's fake-fetcher seam; HardenedSeedRefFetcher is the
// real, SSRF-hardened git subprocess impl (REQ-080). SECURITY-CRITICAL — the whole point of the egress
// allowlist is undone if this subprocess inherits ambient config or follows a redirect off-allowlist.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { codedError } from './errors.js';
import type { ManifestEntry } from './types.js';

export interface SeedRefRequest {
  repoUrl: string;
  sha: string;
  timeoutMs: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

export interface SeedRefResult {
  resolvedSha: string;
  bytesTransferred: number;
  /** entries: ManifestEntry[] — load-bearing; feeds the EXISTING materializeManifest branch (D-v13-A). */
  entries: ManifestEntry[];
  dropped: string[];
}

/**
 * SeedRefFetcher port (DES-081). The real impl is HardenedSeedRefFetcher (TASK-078).
 * putBlob MUST be awaited: CasStore.putBlob is async; a later readBlobSync in materialize
 * must not race a pending write.
 */
export interface SeedRefFetcher {
  fetch(req: SeedRefRequest, putBlob: (sha: string, bytes: Buffer) => Promise<void>): Promise<SeedRefResult>;
}

/**
 * buildGitInvocation (DES-082 K2/K3/K4) — pure: the hardened env + args for the git fetch subprocess.
 * SECURITY: env is a FROM-SCRATCH set (NEVER `{...process.env}`) so no ambient API key / ~/.gitconfig /
 * insteadOf rewrite leaks in; HOME + GIT_CONFIG_GLOBAL point at an isolated (empty) dir; system config is
 * disabled; only https transport; no terminal prompt (private-repo auth fails typed, never hangs). Args:
 * a shallow (`--depth 1`) fetch of the EXACT sha, with cross-host redirect and submodule recursion
 * disabled (both are attacker-controllable pivots off the allowlist). `isolatedHome` is supplied by the
 * fetcher (a per-call temp dir); the function stays pure. */
export function buildGitInvocation(req: SeedRefRequest, isolatedHome = join(tmpdir(), 'rwe-seedref-isolated-home')): { args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_TERMINAL_PROMPT: '0',
    HOME: isolatedHome,
    GIT_CONFIG_GLOBAL: join(isolatedHome, '.gitconfig'),
    // A minimal PATH so `git` still resolves, but NOT the host's full PATH (which could shadow git).
    PATH: '/usr/bin:/bin:/usr/local/bin',
  };
  const args = [
    '-c', 'http.followRedirects=false',
    '-c', 'submodule.recurse=false',
    'fetch', '--depth', '1', '--no-tags',
    req.repoUrl, req.sha,
  ];
  return { args, env };
}

const OCTET_SYMLINK = '120000';
const OCTET_GITLINK = '160000';

/** Run one git subprocess with a hard timeout that SIGTERM→SIGKILLs a hung child (the sole timer in
 *  the fetcher). Resolves stdout; rejects on non-zero exit / spawn error / timeout. execFile (NOT
 *  execFileSync) so the kill is real — an uninterruptible sync spawn would make timeoutMs cosmetic. */
function runGit(args: string[], opts: { cwd: string; env: Record<string, string>; timeoutMs: number; maxBuffer: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd: opts.cwd, env: opts.env, maxBuffer: opts.maxBuffer, encoding: 'buffer' }, (err, stdout) => {
      clearTimeout(timer);
      if (killed) return reject(codedError('SEEDREF_FETCH_FAILED', `git timed out after ${opts.timeoutMs}ms`));
      if (err) return reject(codedError('SEEDREF_FETCH_FAILED', `git ${args[0] === '-c' ? args[4] : args[0]} failed: ${String((err as { message?: string }).message ?? err).slice(0, 200)}`));
      resolve((stdout as Buffer).toString('utf8'));
    });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 2000);
    }, opts.timeoutMs);
  });
}

/** HardenedSeedRefFetcher (DES-082): the real SSRF-hardened engine-pull. Fetches the exact sha shallowly
 *  into a throwaway temp dir under the hardened env, enforces byte caps BEFORE reading blobs, two-step
 *  verifies the sha (rev-parse HEAD == sha AND cat-file -t == commit — closes the shallow alt-object
 *  confused-deputy), streams each surviving regular-file blob into the CAS, and removes the temp dir on
 *  EVERY exit path. All transport/git failures fold into SEEDREF_FETCH_FAILED; size → SEEDREF_TOO_LARGE;
 *  provenance → SEEDREF_SHA_MISMATCH. */
export class HardenedSeedRefFetcher implements SeedRefFetcher {
  async fetch(req: SeedRefRequest, putBlob: (sha: string, bytes: Buffer) => Promise<void>): Promise<SeedRefResult> {
    const work = mkdtempSync(join(tmpdir(), 'rwe-seedref-'));
    const home = mkdtempSync(join(tmpdir(), 'rwe-seedref-home-'));
    const { env } = buildGitInvocation(req, home);
    // maxBuffer bounds git's OWN stdout capture (the ls-tree listing text, rev-parse output) — a fixed
    // generous cap, INDEPENDENT of req.maxTotalBytes (which bounds the TREE and is enforced from the
    // ls-tree sizes below). Tying them would make a tiny maxTotalBytes:1 (a legit "reject-by-size" test
    // input) break git's I/O buffering before the size check ever runs.
    const gitOpts = { cwd: work, env, timeoutMs: req.timeoutMs, maxBuffer: 64 * 1024 * 1024 };
    try {
      await runGit(['init', '-q'], gitOpts);
      // Fetch the exact sha shallowly (hardened env + config flags), then materialize the tree at it.
      const { args } = buildGitInvocation(req, home);
      await runGit(args, gitOpts);
      await runGit(['checkout', '-q', '--detach', 'FETCH_HEAD'], gitOpts);

      // Two-step sha verify (DES-082 step 4) BEFORE trusting any content.
      const head = (await runGit(['rev-parse', 'HEAD'], gitOpts)).trim();
      if (head !== req.sha) throw codedError('SEEDREF_SHA_MISMATCH', `resolved HEAD ${head.slice(0, 12)} != requested ${req.sha.slice(0, 12)}`);
      const objType = (await runGit(['cat-file', '-t', req.sha], gitOpts)).trim();
      if (objType !== 'commit') throw codedError('SEEDREF_SHA_MISMATCH', `sha ${req.sha.slice(0, 12)} is a ${objType}, not a commit`);

      // ls-tree -l -r: mode SP type SP objsha SP size TAB path — sum sizes + enforce caps BEFORE reading.
      const listing = await runGit(['ls-tree', '-l', '-r', req.sha], gitOpts);
      const dropped: string[] = [];
      const keep: Array<{ path: string; mode: string }> = [];
      let total = 0;
      for (const line of listing.split('\n')) {
        if (!line.trim()) continue;
        const tab = line.indexOf('\t');
        if (tab === -1) continue;
        const meta = line.slice(0, tab).split(/\s+/); // [mode, type, objsha, size]
        const path = line.slice(tab + 1);
        const mode = meta[0];
        const size = Number(meta[3]);
        if (mode === OCTET_SYMLINK || mode === OCTET_GITLINK) { dropped.push(path); continue; } // never materialize symlinks/gitlinks
        if (Number.isFinite(size)) {
          if (size > req.maxFileBytes) throw codedError('SEEDREF_TOO_LARGE', `file ${path} is ${size}B > maxFileBytes ${req.maxFileBytes}`);
          total += size;
          if (total > req.maxTotalBytes) throw codedError('SEEDREF_TOO_LARGE', `tree exceeds maxTotalBytes ${req.maxTotalBytes}`);
        }
        keep.push({ path, mode });
      }

      const entries: ManifestEntry[] = [];
      let bytesTransferred = 0;
      for (const { path, mode } of keep) {
        const abs = join(work, path);
        const bytes = readFileSync(abs);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        await putBlob(sha256, bytes); // CAS stores under COMPUTED hash → poisoning-safe; awaited (no readBlobSync race)
        const exec = mode === '100755' || (() => { try { return (statSync(abs).mode & 0o111) !== 0; } catch { return false; } })();
        entries.push({ path, sha256, exec });
        bytesTransferred += bytes.length;
      }
      return { resolvedSha: head, bytesTransferred, entries, dropped };
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
}
