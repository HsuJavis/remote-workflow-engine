// UT-343 (DES-267, TASK-263): import-boundary lock — no file OUTSIDE `src/direct-models/` imports
// `@earendil-works/pi-ai/api/*`. Given a POSITIVE arm too (per Gate-5 review discipline): the lock
// must not be satisfiable by simply never building the feature — it also asserts `call.ts` itself
// DOES import both pi-ai entrypoints, so deleting the feature fails this file, not passes it.
//
// Red reason (today): `src/direct-models/call.ts` does not exist, so the positive-arm assertion
// fails (the import is absent everywhere, including where it is required). The negative-arm sweep
// is vacuously true today (nothing imports pi-ai/api/* yet) but is not the whole test.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');
const PI_API_IMPORT_RE = /@earendil-works\/pi-ai\/api\//;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listTsFiles(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('UT-343: direct-models import boundary (DES-267)', () => {
  it('no file outside src/direct-models/ imports @earendil-works/pi-ai/api/*', () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      if (rel.startsWith(join('direct-models'))) continue;
      const text = readFileSync(file, 'utf8');
      if (PI_API_IMPORT_RE.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('POSITIVE ARM: src/direct-models/call.ts exists and imports BOTH pi-ai entrypoints (the lock has teeth)', () => {
    const callTsPath = join(SRC_ROOT, 'direct-models', 'call.ts');
    const text = readFileSync(callTsPath, 'utf8');
    expect(text).toMatch(/@earendil-works\/pi-ai\/api\/typesafe-system-one/);
    expect(text).toMatch(/@earendil-works\/pi-ai\/api\/openrouter-images/);
  });
});
