// UT-309/UT-310 (DES-252/DES-254, ARCH-175, TASK-251, REQ-218) — buildBashConfinement() +
// validateHostPathGrants()/formatGrantRefusals(): the pure confinement posture the SDK gateway
// wires into every Bash call, and the boot-time grant validator it is built on.
// Written test-first (Gate 5, RED): src/gateway/bash-confinement.ts does not exist yet.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import * as mod from '../../src/gateway/bash-confinement.js';
import {
  buildBashConfinement,
  validateHostPathGrants,
  formatGrantRefusals,
  MASK_PROVIDER_ENV,
  toolchainReadCandidates,
  CLI_SCRATCH_DIR,
  sharedCliScratch,
  cliScratchRefusal,
} from '../../src/gateway/bash-confinement.js';

const WORKROOT = '/var/lib/rwe-data';
const ROOT = '/var/lib/rwe-data/workflows/wf/runs/run-1';
const PROTECTED = ['/home/op/rwe.config.json', join(WORKROOT, 'auth-tokens.db')];
const HOME = '/home/op';
const TOOLCHAIN = ['/home/op/.local/node'];

describe('UT-309 buildBashConfinement() — the whole posture as one pure function (DES-252)', () => {
  it('returns every fixed field of the posture for a known root/workRoot/home (issue #101 deny-by-default reads)', () => {
    const s = buildBashConfinement({ root: ROOT, grantedHostPaths: [], protectedFiles: PROTECTED, workRoot: WORKROOT, homeDir: HOME, allowReadPaths: TOOLCHAIN });
    expect(s.enabled).toBe(true);
    expect(s.failIfUnavailable).toBe(true);
    expect(s.autoAllowBashIfSandboxed).toBe(true);
    expect(s.allowUnsandboxedCommands).toBe(false);
    expect(s.filesystem?.allowWrite).toEqual([ROOT]);
    // Issue #101: the workspace and the toolchain are re-opened INSIDE the denied home/workRoot.
    expect(s.filesystem?.allowRead).toEqual([ROOT, ...TOOLCHAIN]);
    // Every project-configuration path the CLI loads from the workspace (bash-confinement.ts
    // PROJECT_CONFIG_PATHS + ENGINE_OWNED_CONFIG_PATHS), spelled out here so a list change is seen.
    expect(s.filesystem?.denyWrite).toEqual(['.claude/settings.json', '.claude/settings.local.json', '.claude/hooks', '.claude/agents', '.claude/commands', '.claude/workflows', '.claude/routines', '.claude/scheduled_tasks.json', '.claude/launch.json', '.claude/skills', '.mcp.json'].map((rel) => join(ROOT, rel)));
    // Issue #101: the WHOLE home and the WHOLE workRoot are denied (every other run's workspace,
    // ~/.claude credentials, ~/.config, ...), then protectedFiles on top.
    expect(s.filesystem?.denyRead).toEqual([HOME, WORKROOT, ...PROTECTED]);
    expect(s.credentials?.files).toEqual(PROTECTED.map((path) => ({ path, mode: 'deny' })));
    expect(s.network).toBeUndefined();
    expect(s.excludedCommands).toBeUndefined();
  });

  it('root === undefined and root === "" take the SAME branch: allowWrite: [] and allowRead is only the toolchain — never an absent sandbox', () => {
    const a = buildBashConfinement({ root: undefined, grantedHostPaths: [], protectedFiles: [], workRoot: WORKROOT, homeDir: HOME, allowReadPaths: TOOLCHAIN });
    const b = buildBashConfinement({ root: '', grantedHostPaths: [], protectedFiles: [], workRoot: WORKROOT, homeDir: HOME, allowReadPaths: TOOLCHAIN });
    for (const s of [a, b]) {
      expect(s.enabled).toBe(true);
      expect(s.filesystem?.allowWrite).toEqual([]);
      expect(s.filesystem?.allowRead).toEqual(TOOLCHAIN);
      expect(s.filesystem?.denyWrite).toEqual([]);
      expect(s.filesystem?.denyRead).toEqual([HOME, WORKROOT]);
    }
  });

  it('workRoot/homeDir undefined never leak a literal "undefined" into denyRead, and denyRead is just protectedFiles', () => {
    const s = buildBashConfinement({ root: ROOT, grantedHostPaths: [], protectedFiles: PROTECTED, workRoot: undefined, homeDir: undefined, allowReadPaths: [] });
    expect(s.filesystem?.denyRead).toEqual(PROTECTED);
    expect(JSON.stringify(s)).not.toContain('undefined');
  });

  it('grants appear verbatim in BOTH allowWrite and allowRead; toolchain paths are read-only (allowRead only)', () => {
    const grant = '/srv/shared-cache';
    const s = buildBashConfinement({ root: ROOT, grantedHostPaths: [grant], protectedFiles: [], workRoot: WORKROOT, homeDir: HOME, allowReadPaths: TOOLCHAIN });
    expect(s.filesystem?.allowWrite).toEqual([ROOT, grant]);
    expect(s.filesystem?.allowRead).toEqual([ROOT, grant, ...TOOLCHAIN]);
  });

  it('allowManagedReadPathsOnly is NEVER set', () => {
    const s = buildBashConfinement({ root: ROOT, grantedHostPaths: [], protectedFiles: [], workRoot: WORKROOT, homeDir: HOME, allowReadPaths: [] });
    expect(s.filesystem?.allowManagedReadPathsOnly).toBeUndefined();
  });

  it('issue #101: the retired enumerated posture is gone (no DENY_READ_MODE / ENGINE_STATE_DENY exports)', () => {
    expect((mod as Record<string, unknown>)['DENY_READ_MODE']).toBeUndefined();
    expect((mod as Record<string, unknown>)['ENGINE_STATE_DENY']).toBeUndefined();
  });

  it('S8: emits credentials.envVars for the three provider-auth vars IFF MASK_PROVIDER_ENV is true (written for both arms)', () => {
    const s = buildBashConfinement({ root: ROOT, grantedHostPaths: [], protectedFiles: [], workRoot: undefined, homeDir: undefined, allowReadPaths: [] });
    if (MASK_PROVIDER_ENV) {
      expect(s.credentials?.envVars).toEqual(
        ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENROUTER_API_KEY'].map((name) => ({ name, mode: 'mask' })),
      );
    } else {
      expect(s.credentials?.envVars).toBeUndefined();
    }
  });
});

describe('issue #101 toolchainReadCandidates() — the home-resident toolchain a denied home must re-open', () => {
  it('keeps PATH entries under home; a node-style <prefix>/bin execPath re-opens the whole prefix (npm/npx live in its lib/)', () => {
    const path = `/home/op/.venv/bin:/home/op/.local/node/bin:/usr/local/bin:/usr/bin:/bin`;
    expect(toolchainReadCandidates(path, '/home/op', '/home/op/.local/node/bin/node')).toEqual([
      '/home/op/.venv/bin', '/home/op/.local/node/bin', '/home/op/.local/node',
    ]);
  });

  it('never yields home itself, ~/.local, relative entries, or anything outside home', () => {
    const path = `/home/op:relative/bin::/home/op/.local/bin:/opt/x/bin`;
    expect(toolchainReadCandidates(path, '/home/op', '/home/op/.local/bin/node')).toEqual(['/home/op/.local/bin']);
    expect(toolchainReadCandidates(path, '/home/op', '/home/op/bin/node')).toEqual(['/home/op/.local/bin']);
    expect(toolchainReadCandidates(path, '/home/op', '/usr/bin/node')).toEqual(['/home/op/.local/bin']);
  });

  it('trailing-slash spellings of home and ~/.local are still excluded', () => {
    expect(toolchainReadCandidates('/home/op/:/home/op/.local/:/home/op/.local/node/bin/', '/home/op', '/usr/bin/node')).toEqual(['/home/op/.local/node/bin']);
  });

  it('no home or no PATH ⇒ nothing', () => {
    expect(toolchainReadCandidates(undefined, '/home/op', '/home/op/.local/node/bin/node')).toEqual(['/home/op/.local/node']);
    expect(toolchainReadCandidates('/home/op/.local/node/bin', undefined, '/home/op/.local/node/bin/node')).toEqual([]);
  });
});

describe('UT-310 validateHostPathGrants() + formatGrantRefusals() — boot refuses a grant that would undo the control (DES-254)', () => {
  const ctx = { workRoot: WORKROOT, protectedFiles: PROTECTED };
  const identity = (p: string): string => p;

  it('NOT_ABSOLUTE: a relative path or a ~ path is refused', () => {
    const r = validateHostPathGrants(['relative/path', '~/cache'], ctx, identity);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusals).toEqual([
        { entry: 'relative/path', rule: 'NOT_ABSOLUTE' },
        { entry: '~/cache', rule: 'NOT_ABSOLUTE' },
      ]);
    }
  });

  it('UNRESOLVABLE: a throwing realpathImpl refuses the grant (a not-yet-existing path)', () => {
    const throwing = (): string => { throw new Error('ENOENT'); };
    const r = validateHostPathGrants(['/no/such/path'], ctx, throwing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals).toEqual([{ entry: '/no/such/path', rule: 'UNRESOLVABLE' }]);
  });

  it('INSIDE_WORKROOT: refused in BOTH directions (a grant inside workRoot, and a grant that contains workRoot)', () => {
    const inside = validateHostPathGrants([join(WORKROOT, 'cas')], ctx, identity);
    expect(inside.ok).toBe(false);
    if (!inside.ok) expect(inside.refusals).toEqual([{ entry: join(WORKROOT, 'cas'), rule: 'INSIDE_WORKROOT' }]);

    const containing = validateHostPathGrants(['/var/lib'], ctx, identity);
    expect(containing.ok).toBe(false);
    if (!containing.ok) expect(containing.refusals).toEqual([{ entry: '/var/lib', rule: 'INSIDE_WORKROOT' }]);
  });

  it('COVERS_PROTECTED: a grant equal to or an ancestor of a protected file is refused', () => {
    const r = validateHostPathGrants(['/home/op'], ctx, identity);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals).toEqual([{ entry: '/home/op', rule: 'COVERS_PROTECTED' }]);
  });

  it('GLOB: a literal path only — *, ?, [ are refused', () => {
    const r = validateHostPathGrants(['/srv/cache/*'], ctx, identity);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals).toEqual([{ entry: '/srv/cache/*', rule: 'GLOB' }]);
  });

  it('ALL refusals are returned, never just the first', () => {
    const r = validateHostPathGrants(['relative/path', '/srv/cache/*', join(WORKROOT, 'cas')], ctx, identity);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals).toHaveLength(3);
  });

  it('a valid grant is stored REALPATH-RESOLVED (a symlinked grant resolves to its target)', () => {
    const target = '/srv/real-cache';
    const resolveSymlink = (p: string): string => (p === '/srv/cache-link' ? target : p);
    const r = validateHostPathGrants(['/srv/cache-link'], ctx, resolveSymlink);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved).toEqual([target]);
  });

  it('formatGrantRefusals() renders one line per refusal, naming the offending entry and its remedy', () => {
    const text = formatGrantRefusals([
      { entry: 'relative/path', rule: 'NOT_ABSOLUTE' },
      { entry: '/srv/cache/*', rule: 'GLOB' },
    ]);
    expect(text).toMatch(/relative\/path/);
    expect(text).toMatch(/absolute/i);
    expect(text).toMatch(/srv\/cache\/\*/);
    expect(text).toMatch(/literal/i);
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
  });
});

// Issue #101 residual (CLI scratch): the CLI re-binds its per-uid scratch writable AFTER every
// denyRead. The engine points each dispatch at its own scratch under workRoot (TMPDIR +
// CLAUDE_CODE_TMPDIR) and denies the host-shared one — docs/evidence/issue-101-cli-scratch.md.
describe('issue #101 CLI scratch — the shared per-uid dir is denied, the per-dispatch path is bounded', () => {
  it('sharedCliScratch is <tmpdir>/claude-<uid> (the CLI\'s own naming); no uid ⇒ undefined', () => {
    expect(sharedCliScratch('/tmp', 1000)).toBe('/tmp/claude-1000');
    expect(sharedCliScratch('/tmp', undefined)).toBeUndefined();
  });

  it('a given sharedCliScratch is appended to denyRead; absent ⇒ denyRead unchanged', () => {
    const base = { root: ROOT, grantedHostPaths: [], protectedFiles: PROTECTED, workRoot: WORKROOT, homeDir: HOME, allowReadPaths: TOOLCHAIN };
    expect(buildBashConfinement({ ...base, sharedCliScratch: '/tmp/claude-1000' }).filesystem?.denyRead).toEqual([HOME, WORKROOT, ...PROTECTED, '/tmp/claude-1000']);
    expect(buildBashConfinement(base).filesystem?.denyRead).toEqual([HOME, WORKROOT, ...PROTECTED]);
  });

  it('the scratch parent lives directly under workRoot (so the workRoot deny covers every other dispatch\'s scratch)', () => {
    expect(CLI_SCRATCH_DIR).toBe('cli-tmp');
  });

  it('cliScratchRefusal: null while <workRoot>/cli-tmp/dXXXXXX + the CLI\'s 34-byte socket name fits a unix socket path (107); typed refusal one byte past it', () => {
    // dir = workRoot + '/cli-tmp/dXXXXXX' (16 bytes); socket = dir + '/claude-socks-<16hex>.sock' (35).
    const fits = '/' + 'w'.repeat(107 - 35 - 16 - 1);
    expect(cliScratchRefusal(fits)).toBeNull();
    const over = fits + 'w';
    expect(cliScratchRefusal(over)).toMatch(/^CLI_SCRATCH_PATH_TOO_LONG: /);
    expect(cliScratchRefusal(over)).toContain(over);
    expect(cliScratchRefusal('/home/user/.local/share/rwe-data')).toBeNull();
  });
});
