// pi harness v1, slice (h) real-tier evidence: a REAL PiGatewayClient.invoke() dispatch, through a
// REAL spawned pi child, to a REAL local Ollama (qwen2.5:7b), with a REAL materialized skill
// (SKILL.md copied into <ws>/.claude/skills/<name>) — proves the DefaultResourceLoader +
// additionalSkillPaths branch (session-runner.ts's buildResourceLoader) actually boots a real pi
// session without crashing; the unit tests (pi-gateway-client.test.ts) only prove the file
// materialization and the childConfig wire shape against a FAKE child, which cannot catch a
// pi-internal runtime error (wrong export, wrong option shape) the way a real spawned child can.
//
// review B2 (HIGH): gated on the EXPLICIT opt-in RWE_PI_REAL_TESTS=1, never on host reachability
// alone (see tests/helpers/pi-real-gate.ts's own header for why).
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import { piRealTestsEnabled, ollamaReachable, ollamaModelPulled, isDead } from '../helpers/pi-real-gate.js';

const MODEL_TAG = 'qwen2.5:7b';
const RUN = piRealTestsEnabled() && ollamaReachable() && ollamaModelPulled(MODEL_TAG);
const WHY_NOT = ` [UNVERIFIED here: needs RWE_PI_REAL_TESTS=1, a real local Ollama at localhost:11434, and ${MODEL_TAG} pulled]`;

describe('pi harness v1 — REAL skill materialization + real ollama (slice h)', () => {
  it.skipIf(!RUN)('a real dispatch with a materialized skill boots a real pi session (DefaultResourceLoader + additionalSkillPaths) without crashing' + WHY_NOT, async () => {
    const root = mkdtempSync(join(tmpdir(), 'rwe-pi-skill-real-'));
    const ws = join(root, 'ws');
    mkdirSync(ws, { recursive: true });
    mkdirSync(join(root, 'wf', 'skill', 'greeting'), { recursive: true });
    writeFileSync(
      join(root, 'wf', 'skill', 'greeting', 'SKILL.md'),
      '---\nname: greeting\ndescription: Says hello in a distinctive way. Use when asked to greet someone.\n---\n\nAlways greet with: "Ahoy from the greeting skill!"\n',
    );
    const captured: { pid?: number } = {};
    try {
      const gw = new PiGatewayClient({
        ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 60_000,
        spawnChild: ((cmd: string, args: string[], opts: Record<string, unknown>) => {
          const child = spawn(cmd, args, opts);
          captured.pid = child.pid;
          return child;
        }) as never,
      });
      const result = await gw.invoke({
        prompt: 'Reply with exactly the single word: PONG',
        opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Read'] },
        runId: 'skill-real-r1',
        agentId: 'skill-real-a1',
        workspace: ws,
        assets: { roots: { workflow: join(root, 'wf'), global: join(root, 'gl') }, declared: { skills: ['greeting'], mcp: [] }, workflow: 'wf' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(String(result.content).toUpperCase()).toContain('PONG');
      expect(existsSync(join(ws, '.claude', 'skills', 'greeting', 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 300));
      // review P6-2: scoped to the exact pid this test spawned, never a host-wide pgrep pattern.
      if (captured.pid !== undefined) expect(isDead(captured.pid)).toBe(true);
    }
  }, 90_000);
});
