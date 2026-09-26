// Issues #78(a) and #77 — two facts the guide's tool-surface section must state, because a cold
// author cannot derive them from tool names or the SDK's own tool descriptions:
//  * #78(a): `allowedTools` restricts tool NAMES; Bash can do what Read/Write/Edit/Grep/Glob do
//    (reproduced: `allowedTools:['Bash']` wrote a file); a read-only agent is Read/Grep/Glob, no Bash.
//  * #77: file tools take workspace-relative paths (the SDK's Write description says "absolute").
// Checked on the builder AND on the generated docs/AUTHORING.md so neither can drift alone.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAuthoringGuide } from '../../src/authoring-guide.js';
import { DEFAULT_RUN_CONCURRENCY } from '../../src/run-manager.js';

function toolSurfaceSection(text: string): string {
  const start = text.indexOf("## The agent's tool surface");
  const end = text.indexOf('\n## ', start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  return text.slice(start, end);
}

const sources: Array<[string, string]> = [
  ['buildAuthoringGuide()', buildAuthoringGuide({ maxTimeoutMs: 600000, maxAppendPromptBytes: 1024, maxEffort: 'high', runConcurrency: DEFAULT_RUN_CONCURRENCY })],
  ['docs/AUTHORING.md', readFileSync(join(process.cwd(), 'docs/AUTHORING.md'), 'utf8')],
];

describe.each(sources)('%s — tool-surface section', (_name, text) => {
  it('#78(a): says allowedTools restricts names and Bash subsumes the file tools', () => {
    const s = toolSurfaceSection(text);
    expect(s).toMatch(/`allowedTools` restricts tool \*\*names\*\*/);
    expect(s).toMatch(/`Bash` can read, write and search anything `Read`, `Write`, `Edit`, `Grep` and `Glob` can/);
    expect(s).toContain("A read-only agent is `['Read', 'Grep', 'Glob']`, with no `Bash`");
    expect(s).toContain('BASH_SUBSUMES_FILE_TOOLS');
  });

  it('#78(a): states the reach both ways (confined → workspace; unconfined → wherever the process reaches)', () => {
    const s = toolSurfaceSection(text);
    expect(s).toMatch(/inside the run workspace when this deployment confines `Bash`/);
    expect(s).toMatch(/anywhere the engine process can reach when it does not/);
  });

  it('#77: says file tools take workspace-relative paths', () => {
    const s = toolSurfaceSection(text);
    expect(s).toMatch(/File tools take workspace-relative paths/);
  });
});
