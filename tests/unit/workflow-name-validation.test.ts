// Issue #154 B4 (CRITICAL): workflow name validation checked only a case-sensitive `rwe-` prefix —
// empty/whitespace/`..`/`/`/overlong names all registered, and the raw name is joined UNSANITIZED
// into a real host filesystem path (`workFolder(name) = join(workRoot, 'workflows', name)`, which
// becomes the forked sandbox child's own `cwd` and the directory `mkdirSync`'d before every run) with
// no containment check anywhere on this path. A sufficiently-dotted name escapes `workRoot` onto an
// arbitrary host path the engine process can write to.
//
// RED before the fix: `validateRegistration` accepts every name below (no throw), and
// `workFolder('../../../../tmp/evil')` resolves OUTSIDE workRoot.
//
// Mock policy (unit): a REAL WorkflowCatalog on a tmp sqlite — the same tier
// bash-readonly-registration.test.ts uses for validateRegistration.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';

const CLOCK = new FixedClock(new Date('2026-10-06T10:00:00.000Z'));
const VALID_SCRIPT = "export const meta = { description: 'd', phases: [] };\nreturn 1;";
const VALID_MERMAID = 'graph LR\n';

let workRoot: string;
let catalog: WorkflowCatalog;

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-154b4-'));
  catalog = new WorkflowCatalog(workRoot, CLOCK);
});

afterEach(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

// issue #154 B4 follow-up (2026-10-09 re-verification): an EMBEDDED control character (not just
// leading/trailing whitespace, which `.trim()` already caught) registered successfully —
// `'ver2-01-tab\tmid'` round-tripped through `trim()` unchanged.
const BAD_NAMES = ['', '   ', '..', '../x', 'a/../../b', 'a/b', '.', 'a'.repeat(300), 'tab\tmid', 'newline\nmid', 'cr\rmid'];

describe('#154 B4: workflow_register refuses malformed/escaping names, not just the rwe- prefix', () => {
  for (const name of BAD_NAMES) {
    it(`refuses name ${JSON.stringify(name.length > 20 ? name.slice(0, 20) + '…(len=' + name.length + ')' : name)}`, async () => {
      await expect(
        catalog.validateRegistration({ name, script: VALID_SCRIPT, mermaid: VALID_MERMAID }),
      ).rejects.toThrow();
    });
  }

  it('a normal, well-formed name still registers successfully (no false positive)', async () => {
    await expect(
      catalog.validateRegistration({ name: 'my-workflow_v2.1', script: VALID_SCRIPT, mermaid: VALID_MERMAID }),
    ).resolves.toBeDefined();
  });

  it('the refusal code is INVALID_NAME (distinct from RESERVED_PREFIX, which stays for rwe-*)', async () => {
    await expect(catalog.validateRegistration({ name: '../x', script: VALID_SCRIPT, mermaid: VALID_MERMAID })).rejects.toMatchObject({
      code: 'INVALID_NAME',
    });
  });

  it('workFolder() refuses outright rather than ever resolving OUTSIDE workRoot (defense in depth)', () => {
    const malicious = '../../../../tmp/rwe-154b4-escape-check';
    // Stronger than silently clamping: workFolder() itself refuses (INVALID_NAME) if a malicious
    // name ever reached it bypassing validateRegistration — it never returns an escaping path.
    expect(() => catalog.workFolder(malicious)).toThrow(/INVALID_NAME/);
  });

  it('workFolder() accepts the internal "_adhoc" sentinel (run-manager.ts\'s unregistered-run name), which never goes through validateRegistration\'s charset check', () => {
    const folder = catalog.workFolder('_adhoc');
    expect(resolve(folder).startsWith(resolve(workRoot))).toBe(true);
  });
});

// Issue #166 decision 2: a name within the 128-CHARACTER limit can still exceed Linux's NAME_MAX
// (255 UTF-8 bytes per path component) once it is built from multi-byte characters — the exact
// live repro (`ver-01-u-` + ~119 CJK characters, 128 chars/~366 bytes) that reached
// `workflow_deregister` and threw a raw `ENAMETOOLONG` instead of ever being refused at
// registration. New registrations must ALSO satisfy a 200-UTF-8-byte ceiling
// (`MAX_BARE_NAME_BYTES`, path-verdict.ts) — refused INVALID_NAME, with the byte limit named in
// the message so a caller can tell this refusal apart from the character-count one.
describe('#166 decision 2: workflow_register ALSO refuses a byte-oversized (but character-limit-compliant) name', () => {
  it('a 128-character CJK name (well under MAX_BARE_NAME_LENGTH, ~384 UTF-8 bytes) is refused INVALID_NAME', async () => {
    const name = '名'.repeat(128);
    expect(name.length).toBe(128);
    expect(Buffer.byteLength(name, 'utf8')).toBeGreaterThan(255);
    await expect(
      catalog.validateRegistration({ name, script: VALID_SCRIPT, mermaid: VALID_MERMAID }),
    ).rejects.toMatchObject({ code: 'INVALID_NAME' });
  });

  it('the INVALID_NAME message names the 200-byte ceiling (not just the 128-character one)', async () => {
    const name = '名'.repeat(128);
    await expect(
      catalog.validateRegistration({ name, script: VALID_SCRIPT, mermaid: VALID_MERMAID }),
    ).rejects.toMatchObject({ message: expect.stringContaining('200') });
  });

  it('a name just under BOTH ceilings (character and byte) still registers (no false positive)', async () => {
    // 100 chars of 'ñ' (2 UTF-8 bytes each) = 100 characters, 200 bytes — exactly AT the byte
    // ceiling and well under the character one; MAX_BARE_NAME_BYTES itself is inclusive.
    const name = 'ñ'.repeat(100);
    await expect(
      catalog.validateRegistration({ name, script: VALID_SCRIPT, mermaid: VALID_MERMAID }),
    ).resolves.toBeDefined();
  });
});
