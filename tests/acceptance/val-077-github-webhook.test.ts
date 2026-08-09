// VAL-077 (REQ-068): GitHub tag webhook (HMAC-verified) records an update request.
// Acceptance tier — MUST NOT mock the SUT's own boundaries: real HTTP server, real SQLite,
// real flag path, real HMAC verify, real dedup. Only the webhook secret comes from a test env var.
// TEST-FIRST (RED): POST /github/webhook not yet registered; falls through to 404.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  mkdtempSync, rmSync, readFileSync, existsSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const WEBHOOK_SECRET = 'val-077-acceptance-secret';

function sign(rawBody: Buffer): string {
  return 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

function postToWebhook(
  port: number,
  rawBody: Buffer,
  headers: Record<string, string | number>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const allHeaders: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': rawBody.length,
      ...headers,
    };
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path: '/github/webhook', method: 'POST', headers: allHeaders },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.end(rawBody);
  });
}

let server: Server;
let workDir: string;
let auxDir: string;  // flag + DB dir, always outside workRoot

const flagPath = () => join(auxDir, 'update.flag');
const dbPath = () => join(auxDir, 'self-update.db');

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'rwe-val077-wk-'));
  auxDir = mkdtempSync(join(tmpdir(), 'rwe-val077-aux-'));
  process.env.RWE_SECRET_GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: workDir,
    updateFlagPath: flagPath(),
    selfUpdateDbPath: dbPath(),
  });
});
afterAll(async () => {
  await server?.close();
  delete process.env.RWE_SECRET_GITHUB_WEBHOOK_SECRET;
  rmSync(workDir, { recursive: true, force: true });
  rmSync(auxDir, { recursive: true, force: true });
});

beforeEach(() => {
  if (existsSync(flagPath())) unlinkSync(flagPath());
});

describe('VAL-077 — REQ-068 acceptance: HMAC-verified GitHub tag webhook records an update request', () => {
  it('correctly-signed create for v1.4.0 → 202 + update request for v1.4.0 recorded (flag written)', async () => {
    const body = Buffer.from(JSON.stringify({
      ref_type: 'tag', ref: 'v1.4.0',
      repository: { full_name: 'HsuJavis/remote-workflow-engine' },
    }));
    const res = await postToWebhook(server.port, body, {
      'X-GitHub-Event': 'create',
      'X-Hub-Signature-256': sign(body),
      'X-GitHub-Delivery': 'val077-del-001',
    });
    // REQ-068 acceptance: update request recorded
    expect(res.status).toBe(202);
    expect(readFileSync(flagPath(), 'utf-8')).toBe('v1.4.0\n');
  });

  it('same body with wrong signature → 401, no request recorded', async () => {
    const body = Buffer.from(JSON.stringify({
      ref_type: 'tag', ref: 'v1.4.1',
      repository: { full_name: 'HsuJavis/remote-workflow-engine' },
    }));
    const res = await postToWebhook(server.port, body, {
      'X-GitHub-Event': 'create',
      'X-Hub-Signature-256': 'sha256=' + 'wrong'.padEnd(64, '0'),
      'X-GitHub-Delivery': 'val077-del-002',
    });
    // REQ-068 acceptance: invalid signature → 401 and NO update request
    expect(res.status).toBe(401);
    expect(existsSync(flagPath())).toBe(false);
  });

  it('signed branch push → 200 no-op, no update request recorded', async () => {
    const body = Buffer.from(JSON.stringify({
      ref: 'refs/heads/main', deleted: false,
      repository: { full_name: 'HsuJavis/remote-workflow-engine' },
    }));
    const res = await postToWebhook(server.port, body, {
      'X-GitHub-Event': 'push',
      'X-Hub-Signature-256': sign(body),
      'X-GitHub-Delivery': 'val077-del-003',
    });
    // REQ-068 acceptance: non-tag event → 200 and NO update request
    expect(res.status).toBe(200);
    expect(existsSync(flagPath())).toBe(false);
  });
});
