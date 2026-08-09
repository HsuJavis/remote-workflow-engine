// IT-061 (DES-059, ARCH-038, REQ-068): POST /github/webhook engine wiring — HMAC verify, flag-writer,
// dedup, Host-exemption, and boot guard. Real HTTP server, real SQLite, real tmp flag paths.
// Mock policy (integration): real everything; only the GITHUB_WEBHOOK_SECRET comes from a test env var.
// TEST-FIRST (RED): POST /github/webhook is not registered; signed requests fall through to a 404.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  mkdtempSync, rmSync, readFileSync, existsSync, unlinkSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const WEBHOOK_SECRET = 'it-061-test-secret';

function sign(secret: string, rawBody: Buffer): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

function createTagBody(tag: string): Buffer {
  return Buffer.from(JSON.stringify({
    ref_type: 'tag', ref: tag,
    repository: { full_name: 'test/rwe', html_url: 'https://github.com/test/rwe' },
  }));
}

/** Post to POST /github/webhook, optionally overriding Host. Returns status + body text. */
function postGithubWebhook(
  port: number,
  rawBody: Buffer,
  opts: { sig?: string; deliveryId?: string; event?: string; host?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': rawBody.length,
      'X-GitHub-Event': opts.event ?? 'create',
    };
    if (opts.sig) headers['X-Hub-Signature-256'] = opts.sig;
    if (opts.deliveryId) headers['X-GitHub-Delivery'] = opts.deliveryId;
    if (opts.host) headers['Host'] = opts.host;

    const req = httpRequest(
      { hostname: '127.0.0.1', port, path: '/github/webhook', method: 'POST', headers },
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

// ─── describe: unconfigured server → 503 ──────────────────────────────────────

describe('unconfigured server (no secret/flagPath) → 503 UPDATE_WEBHOOK_UNCONFIGURED', () => {
  let server: Server;
  let workDir: string;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'rwe-it061-uncfg-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: workDir });
  });
  afterAll(async () => {
    await server?.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('POST /github/webhook with no secret configured → 503', async () => {
    const body = createTagBody('v1.0.0');
    const res = await postGithubWebhook(server.port, body, {});
    expect(res.status).toBe(503);
  });
});

// ─── describe: configured server ──────────────────────────────────────────────

describe('configured server: HMAC verify + flag-writer + dedup + Host-exempt (DES-059)', () => {
  let server: Server;
  let workDir: string;
  let flagDir: string;

  const flagPath = () => join(flagDir, 'update.flag');
  const dbPath = () => join(flagDir, 'self-update.db');

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'rwe-it061-wk-'));
    flagDir = mkdtempSync(join(tmpdir(), 'rwe-it061-fl-'));  // outside workRoot
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
    rmSync(flagDir, { recursive: true, force: true });
  });

  // Clean up the flag between tests for isolation.
  beforeEach(() => {
    if (existsSync(flagPath())) unlinkSync(flagPath());
  });

  it('valid signed create-tag → 202, flag written with "<tag>\\n", mode 0600', async () => {
    const body = createTagBody('v1.5.0');
    const res = await postGithubWebhook(server.port, body, {
      sig: sign(WEBHOOK_SECRET, body),
      deliveryId: 'gh-del-it061-001',
    });
    expect(res.status).toBe(202);
    expect(readFileSync(flagPath(), 'utf-8')).toBe('v1.5.0\n');
    const mode = statSync(flagPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('bad signature → 401, no flag written', async () => {
    const body = createTagBody('v1.6.0');
    const res = await postGithubWebhook(server.port, body, {
      sig: 'sha256=' + 'bad'.padEnd(64, '0'),
      deliveryId: 'gh-del-it061-002',
    });
    expect(res.status).toBe(401);
    expect(existsSync(flagPath())).toBe(false);
  });

  it('replayed deliveryId → 200 (idempotent), flag written only once', async () => {
    const body = createTagBody('v1.7.0');
    const first = await postGithubWebhook(server.port, body, {
      sig: sign(WEBHOOK_SECRET, body),
      deliveryId: 'gh-del-it061-replay',
    });
    expect(first.status).toBe(202);
    const flagAfterFirst = readFileSync(flagPath(), 'utf-8');

    // Replay the same deliveryId → should be idempotent 200 with no second write.
    const second = await postGithubWebhook(server.port, body, {
      sig: sign(WEBHOOK_SECRET, body),
      deliveryId: 'gh-del-it061-replay',
    });
    expect(second.status).toBe(200);
    // Flag content unchanged (still the first write).
    expect(readFileSync(flagPath(), 'utf-8')).toBe(flagAfterFirst);
  });

  it('non-tag event (branch push) → 200 no-op, no flag written', async () => {
    const branchBody = Buffer.from(JSON.stringify({
      ref: 'refs/heads/main', deleted: false,
      repository: { full_name: 'test/rwe' },
    }));
    const res = await postGithubWebhook(server.port, branchBody, {
      sig: sign(WEBHOOK_SECRET, branchBody),
      deliveryId: 'gh-del-it061-branch',
      event: 'push',
    });
    expect(res.status).toBe(200);
    expect(existsSync(flagPath())).toBe(false);
  });

  it('foreign Host header → 202 (Host-exempt: HMAC is the auth for this route)', async () => {
    // Node.js fetch/undici blocks setting arbitrary Host; use raw node:http.request.
    // After implementation the /github/webhook route bypasses isAllowedHost (Host-exempt by design).
    const body = createTagBody('v1.8.0');
    const res = await postGithubWebhook(server.port, body, {
      sig: sign(WEBHOOK_SECRET, body),
      deliveryId: 'gh-del-it061-host',
      host: 'evil.example.com',
    });
    // Currently: the allowlist returns 403 because the route doesn't exist / allowlist runs first.
    // After implementation: the route intercepts before the allowlist runs → 202.
    expect(res.status).toBe(202);
  });
});

// ─── describe: boot guard ─────────────────────────────────────────────────────

describe('boot guard: updateFlagPath inside workRoot → UPDATE_FLAG_INSIDE_WORKROOT', () => {
  it('createServer rejects if the flag path resolves inside workRoot', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it061-bg-'));
    try {
      await expect(
        createServer({
          port: 0, bind: '127.0.0.1', workRoot,
          updateFlagPath: join(workRoot, 'update.flag'),  // inside workRoot → must reject
          selfUpdateDbPath: join(tmpdir(), 'safe-it061.db'),
        }),
      ).rejects.toThrow('UPDATE_FLAG_INSIDE_WORKROOT');
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });
});
