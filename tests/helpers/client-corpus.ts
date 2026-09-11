// v27 (DES-208, TASK-213): the anti-vacuity helper for the page-source pin migration. A negative
// grep (`expect(x).not.toContain(...)`) with nothing scanned at all PASSES TRIVIALLY — this module
// is what a re-pointed test's positive anchor reads instead of `DASHBOARD_HTML`. THROWS on an empty
// directory rather than returning '' — without this the anti-vacuity floor is itself vacuous
// (adjudication (v23) #4's exact failure class).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_ROOT = join(__dirname, '..', '..', 'src', 'dashboard');

function listJsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listJsFiles(p));
    else if (entry.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Every `src/dashboard/{lib,ui}/**\/*.js` file concatenated. THROWS if the directory is absent or
 *  empty — a re-pointed guard reading '' would pass every negative assertion vacuously. */
export function clientCorpus(): string {
  const files = listJsFiles(CLIENT_ROOT);
  if (files.length === 0) throw new Error(`clientCorpus(): no .js files found under ${CLIENT_ROOT} — the client has not been built yet`);
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

/** One named client file's text, for a re-pointed assertion that needs a SPECIFIC file rather than
 *  the whole corpus (e.g. `ui/run.js`'s viewBox literal). `rel` is relative to `src/dashboard/`. */
export function clientFile(rel: string): string {
  return readFileSync(join(CLIENT_ROOT, rel), 'utf8');
}
