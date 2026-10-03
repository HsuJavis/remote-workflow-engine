// pi harness v1, slice (h) real-tier evidence: a REAL PiGatewayClient.invoke() dispatch, through a
// REAL spawned pi child, to a REAL local Ollama (qwen2.5:7b), with a REAL materialized skill
// (SKILL.md copied into <ws>/.claude/skills/<name>) — proves the DefaultResourceLoader +
// additionalSkillPaths branch (session-runner.ts's buildResourceLoader) actually boots a real pi
// session without crashing; the unit tests (pi-gateway-client.test.ts) only prove the file
// materialization and the childConfig wire shape against a FAKE child, which cannot catch a
// pi-internal runtime error (wrong export, wrong option shape) the way a real spawned child can.
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';

function ollamaReachable(): boolean {
  try {
    return execSync('curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:11434/api/tags', { encoding: 'utf8' }).trim() === '200';
  } catch {
    return false;
  }
}
const HAS_OLLAMA = ollamaReachable();
const WHY_NOT = ' [UNVERIFIED here: needs a real local Ollama at localhost:11434 with qwen2.5:7b pulled]';

describe('pi harness v1 — REAL skill materialization + real ollama (slice h)', () => {
  it.skipIf(!HAS_OLLAMA)('a real dispatch with a materialized skill boots a real pi session (DefaultResourceLoader + additionalSkillPaths) without crashing' + WHY_NOT, async () => {
    const root = mkdtempSync(join(tmpdir(), 'rwe-pi-skill-real-'));
    const ws = join(root, 'ws');
    mkdirSync(ws, { recursive: true });
    mkdirSync(join(root, 'wf', 'skill', 'greeting'), { recursive: true });
    writeFileSync(
      join(root, 'wf', 'skill', 'greeting', 'SKILL.md'),
      '---\nname: greeting\ndescription: Says hello in a distinctive way. Use when asked to greet someone.\n---\n\nAlways greet with: "Ahoy from the greeting skill!"\n',
    );
    try {
      const gw = new PiGatewayClient({ ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 60_000 });
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
      const leftover = execSync('pgrep -af "pi-child/entr[y]" || true', { encoding: 'utf8' }).trim();
      expect(leftover).toBe('');
    }
  }, 90_000);
});
