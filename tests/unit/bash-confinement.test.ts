// UT-309/UT-310 (DES-252/DES-254, ARCH-175, TASK-251, REQ-218) — buildBashConfinement() +
// validateHostPathGrants()/formatGrantRefusals(): the pure confinement posture the SDK gateway
// wires into every Bash call, and the boot-time grant validator it is built on.
// Written test-first (Gate 5, RED): src/gateway/bash-confinement.ts does not exist yet.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  buildBashConfinement,
  validateHostPathGrants,
  formatGrantRefusals,
  DENY_READ_MODE,
  MASK_PROVIDER_ENV,
  ENGINE_STATE_DENY,
} from '../../src/gateway/bash-confinement.js';

const WORKROOT = '/var/lib/rwe-data';
const ROOT = '/var/lib/rwe-data/workflows/wf/runs/run-1';
const PROTECTED = ['/home/op/rwe.config.json', join(WORKROOT, 'auth-tokens.db')];

describe('UT-309 buildBashConfinement() — the whole posture as one pure function (DES-252)', () => {
  it('returns every fixed field of the posture for a known root/workRoot, enumerated mode', () => {
    const s = buildBashConfinement({ root: ROOT, grantedHostPaths: [], protectedFiles: PROTECTED, workRoot: WORKROOT, denyReadMode: 'enumerated' });
    expect(s.enabled).toBe(true);
    expect(s.failIfUnavailable).toBe(true);
    expect(s.autoAllowBashIfSandboxed).toBe(true);
    expect(s.allowUnsandboxedCommands).toBe(false);
    expect(s.filesystem?.allowWrite).toEqual([ROOT]);
    expect(s.filesystem?.allowRead).toEqual([ROOT]);
    // Every project-configuration path the CLI loads from the workspace (bash-confinement.ts
    // PROJECT_CONFIG_PATHS + ENGINE_OWNED_CONFIG_PATHS), spelled out here so a list change is seen.
    expect(s.filesystem?.denyWrite).toEqual(['.claude/settings.json', '.claude/settings.local.json', '.claude/hooks', '.claude/agents', '.claude/commands', '.claude/workflows', '.claude/routines', '.claude/scheduled_tasks.json', '.claude/launch.json', '.claude/skills', '.mcp.json'].map((rel) => join(ROOT, rel)));
    // v37 Gate-8 send-back note (finding A3): this assertion tests buildBashConfinement()'s OWN
    // join/concat MECHANICS (does it correctly fold ENGINE_STATE_DENY + protectedFiles into
    // denyRead?) — deriving the expectation from the same constant is the right shape for THAT
    // question. It is deliberately NOT the completeness guard for ENGINE_STATE_DENY itself (a
    // constant compared to a copy of itself can never catch an omission there); INV-V37-4's real
    // guard is `sandbox-config-wiring.test.ts`'s "an operator-overridden casDir/selfUpdateDbPath
    // reaches protectedFiles as the resolved value" case, which fails against the COMPOSED CONFIG
    // if a resolved override silently drops out.
    expect(s.filesystem?.denyRead).toEqual([...ENGINE_STATE_DENY.map((p: string) => join(WORKROOT, p)), ...PROTECTED]);
    expect(s.credentials?.files).toEqual(PROTECTED.map((path) => ({ path, mode: 'deny' })));
    expect(s.network).toBeUndefined();
    expect(s.excludedCommands).toBeUndefined();
  });

  it('root === undefined and root === "" take the SAME branch: allowWrite/allowRead: [] — never an absent sandbox', () => {
    const a = buildBashConfinement({ root: undefined, grantedHostPaths: [], protectedFiles: [], workRoot: WORKROOT, denyReadMode: 'enumerated' });
    const b = buildBashConfinement({ root: '', grantedHostPaths: [], protectedFiles: [], workRoot: WORKROOT, denyReadMode: 'enumerated' });
    for (const s of [a, b]) {
      expect(s.enabled).toBe(true);
      expect(s.filesystem?.allowWrite).toEqual([]);
      expect(s.filesystem?.allowRead).toEqual([]);
      expect(s.filesystem?.denyWrite).toEqual([]);
    }
  });

  it('workRoot === undefined never leaks a literal "undefined" into denyRead, and denyRead is just protectedFiles', () => {
    const s = buildBashConfinement({ root: ROOT, grantedHostPaths: [], protectedFiles: PROTECTED, workRoot: undefined, denyReadMode: 'enumerated' });
    expect(s.filesystem?.denyRead).toEqual(PROTECTED);
    expect(JSON.stringify(s)).not.toContain('undefined');
  });

  it('grants appear verbatim in BOTH allowWrite and allowRead', () => {
    const grant = '/srv/shared-cache';
    const s = buildBashConfinement({ root: ROOT, grantedHostPaths: [grant], protectedFiles: [], workRoot: WORKROOT, denyReadMode: 'enumerated' });
    expect(s.filesystem?.allowWrite).toEqual([ROOT, grant]);
    expect(s.filesystem?.allowRead).toEqual([ROOT, grant]);
  });

  it('"workroot" mode: denyRead is [workRoot, ...protectedFiles] and allowRead is STILL emitted (load-bearing under this mode)', () => {
    const grant = '/srv/shared-cache';
    const s = buildBashConfinement({ root: ROOT, grantedHostPaths: [grant], protectedFiles: PROTECTED, workRoot: WORKROOT, denyReadMode: 'workroot' });
    expect(s.filesystem?.denyRead).toEqual([WORKROOT, ...PROTECTED]);
    expect(s.filesystem?.allowRead).toEqual([ROOT, grant]);
  });

  it('allowManagedReadPathsOnly is NEVER set, in either mode', () => {
    const enumerated = buildBashConfinement({ root: ROOT, grantedHostPaths: [], protectedFiles: [], workRoot: WORKROOT, denyReadMode: 'enumerated' });
    const workroot = buildBashConfinement({ root: ROOT, grantedHostPaths: [], protectedFiles: [], workRoot: WORKROOT, denyReadMode: 'workroot' });
    expect(enumerated.filesystem?.allowManagedReadPathsOnly).toBeUndefined();
    expect(workroot.filesystem?.allowManagedReadPathsOnly).toBeUndefined();
  });

  it('DENY_READ_MODE is the fixed module constant "enumerated" until a positive S7 flips it', () => {
    expect(DENY_READ_MODE).toBe('enumerated');
  });

  it('S8: emits credentials.envVars for the three provider-auth vars IFF MASK_PROVIDER_ENV is true (written for both arms)', () => {
    const s = buildBashConfinement({ root: ROOT, grantedHostPaths: [], protectedFiles: [], workRoot: undefined, denyReadMode: 'enumerated' });
    if (MASK_PROVIDER_ENV) {
      expect(s.credentials?.envVars).toEqual(
        ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENROUTER_API_KEY'].map((name) => ({ name, mode: 'mask' })),
      );
    } else {
      expect(s.credentials?.envVars).toBeUndefined();
    }
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
