// UT-260 (DES-212, ARCH-132, TASK-220, REQ-143): the retirement tripwire — REQ-143 registers its
// OWN exit ("正式上線前移除示範資料集") and the mechanism must be MECHANICAL: an allowlist of the
// `src/dashboard/**` files permitted to mention "demo"/"示範", closed BOTH ways, same convention as
// `static-assets.test.ts:50-71` / `no-skeleton-surface.test.ts` — (1) `demo/dataset.js` must be
// PRESENT ON DISK (deleting the directory in a future retirement commit turns this half red until
// every OTHER describer retires with it) and (2) every mention anywhere else under
// `src/dashboard/**` is a leak this half catches.
//
// Scope is DELIBERATELY `src/dashboard/**` only, not the whole repo: this guard's whole purpose is
// REQ-143's own "刪掉了卻還有東西在描述它" hazard for the DASHBOARD's demo feature specifically — a
// repo-wide grep would also flag the many PRE-EXISTING, unrelated fixture names spelled "demo"
// elsewhere (measured: `tests/unit/meta-literal.test.ts`, `tests/acceptance/v24-tool-surface.test.ts`,
// `tests/integration/catalog-v24.test.ts`, `tests/integration/asset-mcp-config-wiring.test.ts`,
// `src/tool-specs.ts` all use "demo" as a generic example workflow/asset name, years before this
// REQ existed) — flagging those would be exactly the "poisoned oracle" carry-forward lesson warns
// against, not a real leak.
//
// Measured finding, folded into the allowlist rather than hidden: `src/dashboard/dashboard.css:166`
// ALREADY quotes the README verbatim in a comment ("`Demo data` outline") — pre-existing, dated
// [v27 README-fidelity closure], and exactly the file TASK-221/DES-219 is expected to add a REAL
// `.is-demo`-style selector to for this same feature. `dashboard.css` is allowlisted rather than
// treated as a leak.
//
// Tier: unit — pure static analysis.
//
// Red reason (measured): `src/dashboard/demo/dataset.js` does not exist on disk.
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const CLIENT_ROOT = join(__dirname, '..', '..', 'src', 'dashboard');
const DATASET_FILE = join(CLIENT_ROOT, 'demo', 'dataset.js');

// Relative to `src/dashboard/`.
const PRODUCTION_ALLOWLIST = new Set(['demo/dataset.js', 'lib/connection.js', 'lib/strings.js', 'ui/app.js', 'ui/poll.js', 'dashboard.css']);

function listAllFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listAllFiles(p));
    else out.push(p);
  }
  return out;
}

describe('demo-surface: the allowlist is closed BOTH ways over src/dashboard/** (UT-260, DES-212)', () => {
  it('half 1 — demo/dataset.js is PRESENT ON DISK (the retirement-commit direction)', () => {
    expect(existsSync(DATASET_FILE), 'src/dashboard/demo/dataset.js does not exist').toBe(true);
  });

  it('half 2 — every "demo"/"示範" mention under src/dashboard/** is in a listed file (the leak direction)', () => {
    if (!existsSync(CLIENT_ROOT)) return; // nothing to scan yet, not a pass this guard should claim credit for
    const offenders: string[] = [];
    for (const file of listAllFiles(CLIENT_ROOT)) {
      const rel = relative(CLIENT_ROOT, file).split('\\').join('/');
      if (PRODUCTION_ALLOWLIST.has(rel)) continue;
      const text = readFileSync(file, 'utf8');
      if (/\bdemo\b/i.test(text) || text.includes('示範')) offenders.push(rel);
    }
    expect(offenders, `unlisted file(s) mentioning demo/示範: ${offenders.join(', ')}`).toEqual([]);
  });
});
