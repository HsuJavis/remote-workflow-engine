// src/gateway/bash-confinement.ts (DES-252/254, ARCH-175, TASK-251, REQ-218): the whole confinement
// POSTURE as one pure function, plus the boot-time grant validator it is built on. PURE — no fs, no
// process, no env, no clock. Imports SandboxSettings TYPE-ONLY from the SDK (the compiler is the
// only guard against a renamed field). See src/gateway/confinement-probe.ts (impure) for the
// SEPARATE, host-measured question of whether the kernel can actually enforce this object at all —
// that answer decides WHETHER this builder's output is even handed to `query()` (ARCH-181/DES-262),
// never what it contains.
import type { SandboxSettings } from '@anthropic-ai/claude-agent-sdk';
import { join } from 'node:path';
import { isPathContained } from '../path-containment.js';

// Fixed by spike S7 (TASK-250, evidence/v37-spike/S7.md — inconclusive, blocked by the same
// apply-seccomp/AppArmor failure S1 root-caused): a PARAMETER, never a config key. 'enumerated' is
// the built-in posture because a wrong 'workroot' fails "the agent cannot read its own workspace" —
// every run dead — not "cross-run reads stay open". A positive S7 flips this constant and deletes
// the 'enumerated' arm + ENGINE_STATE_DENY in the same change (ARCH-175's own instruction).
export const DENY_READ_MODE: 'enumerated' | 'workroot' = 'enumerated';

// Fixed by spike S8 (blocked by the same S1 finding — could not measure whether masking survives
// the CLI's own authentication). A parameter, never a config key, same discipline as DENY_READ_MODE.
export const MASK_PROVIDER_ENV = false;

// v37 (ARCH-175 note): denyRead names workRoot's own engine-state directories, not a stale sibling
// run-directory list (those are created concurrently and would be stale before use).
// v37 Gate-8 send-back amendment (finding A3, ARCH-175): this is now HALF of the deny surface, and
// it is a BRIDGE — maintained until a positive spike S7, deleted together with the 'enumerated' arm
// at the flip (see DENY_READ_MODE's own comment) — not a control anyone should extend. It holds
// ONLY the knob-less literals: paths with no `FileConfig` override key, so a literal is the honest
// expression for them rather than an oversight. `mcp-registry.db` (workflow-catalog.ts:398) and
// `_global_assets` (asset-sync.ts:145, hangs off workRoot, NOT the overridable assetRoot) were
// MISSING before this amendment. Every OPERATOR-OVERRIDABLE path (casDir, assetRoot,
// webhookDbPath, schedulerDbPath, selfUpdateDbPath, continuationDbPath) is deliberately NOT here —
// re-deriving an override from a key name is exactly the class of bug this amendment exists to
// close (INV-V37-4); those arrive as RESOLVED VALUES in `protectedFiles` from the composition root
// (main.ts's composeConfig()) instead. `'continuations.db'` is REMOVED — `continuationDbPath` has
// no production construction site anywhere (verified: `grep -rn -i continuation src/`), so it was
// a phantom, not a completeness gap.
export const ENGINE_STATE_DENY = [
  'store', 'catalog.db', 'auth-tokens.db', 'mcp-registry.db', '_global_assets',
] as const;

export interface ConfinementInput {
  /** This call's workspace (req.workspace ?? cfg.cwd). undefined/'' both mean "nothing to write". */
  readonly root: string | undefined;
  /** Operator-granted host paths (validated + realpath'd at boot — DES-254). */
  readonly grantedHostPaths: readonly string[];
  /** Absolute paths that must stay unreadable regardless of any grant (DES-255). */
  readonly protectedFiles: readonly string[];
  readonly workRoot: string | undefined;
  readonly denyReadMode: 'enumerated' | 'workroot';
}

function isNonEmptyString(s: string | undefined | null): s is string {
  return typeof s === 'string' && s.length > 0;
}

/** DES-252: returns the whole posture — every field fixed here because the posture IS the design.
 *  `root === undefined` and `root === ''` take the SAME branch (`allowWrite: []`) — an absent
 *  workspace means "nothing may be written", never "no sandbox" (the ARCH-176 bug-class: a guard
 *  whose "nothing to check" arm must not return the same verdict as its "checked and clean" arm). */
export function buildBashConfinement(input: ConfinementInput): SandboxSettings {
  const { root, grantedHostPaths, protectedFiles, workRoot, denyReadMode } = input;
  const grants = grantedHostPaths.filter(isNonEmptyString);
  const allowPaths = isNonEmptyString(root) ? [root, ...grants] : [];
  const filteredProtected = protectedFiles.filter(isNonEmptyString);
  const denyRead =
    denyReadMode === 'workroot'
      ? [workRoot, ...filteredProtected].filter(isNonEmptyString)
      : [...(isNonEmptyString(workRoot) ? ENGINE_STATE_DENY.map((p) => join(workRoot, p)) : []), ...filteredProtected].filter(isNonEmptyString);
  const settings: SandboxSettings = {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    filesystem: {
      allowWrite: allowPaths,
      allowRead: allowPaths,
      denyRead,
      denyWrite: isNonEmptyString(root) ? [join(root, '.claude', 'settings.json'), join(root, '.claude', 'settings.local.json')] : [],
    },
    credentials: {
      files: filteredProtected.map((path) => ({ path, mode: 'deny' as const })),
      // S8 (ARCH-025, DES-252): positive result joins this posture; negative leaves the field absent
      // and the exposure is a filed v38 candidate — never a silent widening of the credentials block.
      ...(MASK_PROVIDER_ENV
        ? { envVars: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENROUTER_API_KEY'].map((name) => ({ name, mode: 'mask' as const })) }
        : {}),
    },
  };
  return settings;
}

export type GrantRule = 'NOT_ABSOLUTE' | 'UNRESOLVABLE' | 'INSIDE_WORKROOT' | 'COVERS_PROTECTED' | 'GLOB';
export interface GrantRefusal {
  readonly entry: string;
  readonly rule: GrantRule;
}

const REMEDY: Record<GrantRule, string> = {
  NOT_ABSOLUTE: 'give an absolute path; `~` is never expanded against whatever cwd systemd gave us',
  UNRESOLVABLE: 'create the directory before boot — a not-yet-existing path can later be created as a symlink to anything',
  INSIDE_WORKROOT: "grant a path outside workRoot; `<workRoot>/cas` would hand over the content store",
  COVERS_PROTECTED: 'grant a narrower path; this one would hand back exactly what denyRead takes away',
  GLOB: 'a literal path only — a glob is a second grammar nobody asked for',
};

/** DES-254: boot refuses a grant that would undo the control. Realpath is injected (pure); all
 *  refusals are returned, never just the first (an operator editing several bad rows at once is told
 *  about all of them, once). Containment is tested in BOTH directions via the repo's single existing
 *  primitive (`isPathContained`) — no second containment idiom is minted. */
export function validateHostPathGrants(
  grants: readonly string[],
  ctx: { workRoot: string; protectedFiles: readonly string[] },
  realpathImpl: (p: string) => string,
): { ok: true; resolved: string[] } | { ok: false; refusals: GrantRefusal[] } {
  const refusals: GrantRefusal[] = [];
  const resolved: string[] = [];
  for (const entry of grants) {
    if (!entry.startsWith('/') || entry.startsWith('~')) {
      refusals.push({ entry, rule: 'NOT_ABSOLUTE' });
      continue;
    }
    if (/[*?[]/.test(entry)) {
      refusals.push({ entry, rule: 'GLOB' });
      continue;
    }
    let target: string;
    try {
      target = realpathImpl(entry);
    } catch {
      refusals.push({ entry, rule: 'UNRESOLVABLE' });
      continue;
    }
    if (isPathContained(target, ctx.workRoot, (p) => p) || isPathContained(ctx.workRoot, target, (p) => p)) {
      refusals.push({ entry, rule: 'INSIDE_WORKROOT' });
      continue;
    }
    const coversProtected = ctx.protectedFiles.some(
      (pf) => target === pf || isPathContained(pf, target, (p) => p),
    );
    if (coversProtected) {
      refusals.push({ entry, rule: 'COVERS_PROTECTED' });
      continue;
    }
    resolved.push(target);
  }
  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, resolved };
}

/** ONE formatter, all refusals — a table rendered as one line per refusal, naming the offending
 *  entry verbatim plus its remedy (ADR-028's "one typed message" idiom, satisfied by one message
 *  that LISTS the entries rather than four ad-hoc strings that drift). */
export function formatGrantRefusals(refusals: readonly GrantRefusal[]): string {
  return refusals.map((r) => `${r.entry}: not a valid host-path grant (${r.rule}) — ${REMEDY[r.rule]}`).join('\n');
}
