// Issue #138 review L-138-1: `ModelProbeStore`'s additive `harness`-column migration was
// check-then-ALTER (PRAGMA table_info, then ALTER TABLE if the column was absent) — not atomic.
// The review reproduced a real race with 4 concurrent OS processes opening the SAME pre-migration
// db at once (5 trials, 15/20 boots failed with "duplicate column name: harness", which would make
// `createServer()` reject and boot fail outright — `server.ts` constructs `ModelProbeStore`
// unguarded). A crash-restart overlap (two instances briefly alive on the same workRoot) is the
// realistic trigger, not normal single-instance operation.
//
// This needs REAL concurrent processes — better-sqlite3 is synchronous, so two `ModelProbeStore`
// constructions inside one Node process can never interleave; there is no yield point between a
// check and an ALTER for anything else to land in. `spawn` (not `execFileSync`, which would run
// them one at a time) launches several real `tsx` processes that each busy-wait to a shared future
// timestamp before opening the db, maximizing the collision window the review's own `sim138/boot.mjs`
// used the same technique for.
//
// Mock policy: none — this is the one place a real race needs real OS processes; no fake stands in
// for "two processes touched the same file at once".
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const PROJECT_ROOT = join(__dirname, '..', '..');
const MODEL_PROBE_SRC = join(PROJECT_ROOT, 'src', 'models', 'model-probe.ts');

function runChild(tsxBin: string, scriptPath: string, barrier: number, dbPath: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(tsxBin, [scriptPath, String(barrier), dbPath], { cwd: PROJECT_ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}

describe('ModelProbeStore additive harness-column migration — concurrent-boot race (issue #138 review L-138-1)', () => {
  it('several processes opening the same pre-migration db at once all boot cleanly, never "duplicate column name"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-probe-race-'));
    try {
      const dbPath = join(dir, 'index.db');
      // A pre-#138 db: the 8-column schema with no `harness` column at all — exactly what a real
      // deployment upgrading across this change has on disk.
      const legacy = new Database(dbPath);
      legacy.exec(`CREATE TABLE model_probes (
        provider TEXT NOT NULL, model TEXT NOT NULL,
        prose_ok INTEGER NOT NULL, tools_ok INTEGER NOT NULL, probed_at TEXT NOT NULL,
        prose_ms INTEGER NOT NULL, tools_ms INTEGER NOT NULL, detail TEXT NOT NULL,
        PRIMARY KEY (provider, model))`);
      legacy.prepare('INSERT INTO model_probes VALUES (?,?,?,?,?,?,?,?)').run(
        'ollama', 'qwen2.5:7b', 1, 0, '2026-01-01T00:00:00.000Z', 100, 200, 'pre-harness-column row',
      );
      legacy.close();

      const scriptPath = join(dir, 'boot.mjs');
      writeFileSync(
        scriptPath,
        [
          `import { ModelProbeStore } from ${JSON.stringify(MODEL_PROBE_SRC)};`,
          'const barrier = Number(process.argv[2]);',
          'const dbPath = process.argv[3];',
          'while (Date.now() < barrier) { /* busy-wait to the shared start time */ }',
          'try { const s = new ModelProbeStore(dbPath); s.close(); process.exit(0); }',
          'catch (e) { console.error(e && e.message ? e.message : String(e)); process.exit(1); }',
        ].join('\n'),
      );

      const tsxBin = join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
      const barrier = Date.now() + 400;
      const CONCURRENCY = 6;
      const runs = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => runChild(tsxBin, scriptPath, barrier, dbPath)),
      );
      const failed = runs.filter((r) => r.code !== 0);
      expect(failed).toEqual([]);

      // The pre-existing row must have survived every concurrent boot, backfilled with the
      // documented legacy default — the race must not corrupt or drop data either.
      const check = new Database(dbPath);
      const row = check.prepare('SELECT * FROM model_probes WHERE provider = ? AND model = ?').get('ollama', 'qwen2.5:7b') as { harness: string; detail: string };
      expect(row).toMatchObject({ harness: 'sdk', detail: 'pre-harness-column row' });
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
