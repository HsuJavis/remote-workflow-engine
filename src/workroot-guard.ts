// WorkRoot isolation guard (REQ-021 / D-V3M-5): a run workspace nested under a Claude Code project
// makes the SDK-gateway agent CLI (which runs with settingSources:['project'] to load the workspace's
// own materialized .claude/skills) resolve the project root to that ancestor and load ITS CLAUDE.md +
// ~/.claude/projects/<hash>/memory into the agent context — a confinement leak that bypasses the
// tool-level workspace jail (D-V2G8-1(d)), because it happens at session-init, not via a Read tool
// call (empirically reproduced 2026-07-11: workRoot:"./data" inside the engine repo → a qwen agent
// verbatim echoed the operator's MEMORY.md). This is a boot-time fail-closed guard: refuse to start
// when workRoot (or any ancestor) is a Claude Code project, rather than run and leak silently.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export class WorkRootInsideProjectError extends Error {
  readonly code = 'WORKROOT_INSIDE_PROJECT' as const;
  constructor(workRoot: string, offending: string) {
    super(
      `workRoot "${workRoot}" is inside a Claude Code project (${offending} contains .git or CLAUDE.md). ` +
        'Agent run workspaces nested under a project cause the SDK-gateway agent CLI to load that ' +
        "project's CLAUDE.md and auto-memory into the agent context — a confinement leak (it bypasses " +
        'the tool-level workspace jail because it happens at session-init). Set workRoot to a path ' +
        'OUTSIDE any project/git repo (e.g. /var/lib/remote-workflow-engine, or ~/.local/share/rwe-data).',
    );
    this.name = 'WorkRootInsideProjectError';
  }
}

/** PURE (fs probe injected for tests): throws WorkRootInsideProjectError when `workRoot` itself or any
 *  ancestor up to the filesystem root contains a `.git` or `CLAUDE.md` project marker. A `.git`/
 *  `CLAUDE.md` ancestor is exactly what makes the agent CLI treat that dir as the project whose
 *  CLAUDE.md/auto-memory it loads — so it is the precise signal for the REQ-021 leak. (`~/.claude`
 *  alone is the CLI's GLOBAL config, not a project marker, so a data dir merely under $HOME does not
 *  trip this — only a real git repo / CLAUDE.md-bearing dir does.) */
export function assertWorkRootIsolated(workRoot: string, existsImpl: (p: string) => boolean = existsSync): void {
  let dir = resolve(workRoot);
  for (;;) {
    if (existsImpl(join(dir, '.git')) || existsImpl(join(dir, 'CLAUDE.md'))) {
      throw new WorkRootInsideProjectError(workRoot, dir);
    }
    const parent = dirname(dir);
    if (parent === dir) return; // reached the filesystem root — clean
    dir = parent;
  }
}
