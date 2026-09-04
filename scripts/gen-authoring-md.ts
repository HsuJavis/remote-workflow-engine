// scripts/gen-authoring-md.ts (DES-157, TASK-150, v24)
//
// Writes docs/AUTHORING.md from buildAuthoringGuide() over DEFAULT_CEILINGS — the documented
// default for an unconfigured deployment. tests/unit/authoring-md-generated.test.ts asserts the
// committed file is byte-equal to this same call; re-run this script (`npm run gen:authoring`)
// after any change to src/authoring-guide.ts and commit the regenerated file.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildAuthoringGuide } from '../src/authoring-guide.js';
import { DEFAULT_CEILINGS } from '../src/params/contract.js';
// v24 Gate 7.5 (D-12): the DOCUMENTED default alias table, imported — the same fallback
// `server.ts` resolves `aliasNames` from when the operator configures none. Never a literal list.
import { DEFAULT_ALIASES } from '../src/default-aliases.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = buildAuthoringGuide({ ...DEFAULT_CEILINGS, aliases: Object.keys(DEFAULT_ALIASES) });
const outPath = join(ROOT, 'docs/AUTHORING.md');
writeFileSync(outPath, text);
console.log(`docs/AUTHORING.md written (${Buffer.byteLength(text, 'utf8')} bytes)`);
