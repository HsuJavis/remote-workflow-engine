// Service accounts spec send-back D1 (HIGH): "trigger firings bypass SA state". A webhook delivery
// carries no bearer, so the ONLY place that can refuse it for a disabled/narrowed/deleted sa:
// creator is RunManager.start()'s own admission (server.ts wires PrincipalAdmin.serviceAccountStatus
// into it). This is the real end-to-end repro from the review: narrow the SA's allowlist, disable
// it, then delete it — each one must refuse the NEXT delivery, 409, recorded+replayed exactly like
// any other permanent admission refusal (webhook-registry.ts's existing admissionErrorToOutcome
// classification, unchanged — only run-manager.ts's ADMISSION_STATUS table gained the 2 new codes).
//
// Mock policy (integration tier, mirrors webhook-ingress-http.test.ts): real createServer() + real
// HTTP + real auth (bearer-minted SA/admin) + real HMAC-signed deliveries.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

let server: Server;
let tmpDir: string;
const base = () => `http://127.0.0.1:${server.port}`;

function mintBearer(email: string): string {
  const db = new Database(join(tmpDir, 'auth-tokens.db'));
  try { return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) }).issue(email, 7 * 24 * 3600_000).token; }
  finally { db.close(); }
}

async function callTool(name: string, args: unknown, bearer: string): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

function deliver(url: string, secret: string, deliveryId: string, bodyObj: unknown) {
  const body = JSON.stringify(bodyObj);
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RWE-Signature': sig, 'X-RWE-Timestamp': new Date().toISOString(), 'X-RWE-Delivery': deliveryId },
    body,
  });
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-wh-sa-state-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'x', googleClientSecret: 'y' },
    principals: { 'admin@x.com': { role: 'admin' } },
  } as never);
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('webhook deliveries respect sa: creator state (service accounts spec send-back D1)', () => {
  it('narrowing the allowlist, disabling, then deleting the SA each refuse the NEXT delivery — 409, recorded+replayed', async () => {
    const adminToken = mintBearer('admin@x.com');
    const created = await callTool('service_account_create', { name: 'hook-bot', role: 'author', workflows: ['alpha'] }, adminToken);
    const saToken = (await (await fetch(`${base()}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'sa:hook-bot', client_secret: created.result.clientSecret }),
    })).json()).access_token as string;

    const wh = await callTool('webhook_create', {}, saToken);
    await callTool('workflow_register', { name: 'alpha', script: "export const meta = { phases: [] };\nreturn 'ok';", mermaid: 'graph LR', triggers: [wh.result.webhookId] }, saToken);
    await callTool('workflow_publish', { name: 'alpha', version: 'v1', channel: 'release' }, saToken);
    const { url, secret } = wh.result as { url: string; secret: string };

    // 1. live + allowlisted -> 202, a real run starts.
    const ok = await deliver(url, secret, 'd-1', { x: 1 });
    expect(ok.status).toBe(202);
    expect(typeof (await ok.json() as { runId?: string }).runId).toBe('string');

    // 2. admin narrows the allowlist to exclude 'alpha' -> refused, 409, recorded+replayed.
    await callTool('service_account_update', { name: 'hook-bot', workflows: ['something-else'] }, adminToken);
    const narrowed = await deliver(url, secret, 'd-2', { x: 2 });
    expect(narrowed.status).toBe(409);
    const narrowedBody = await narrowed.json() as { code?: string };
    expect(narrowedBody.code).toBe('WORKFLOW_NOT_ALLOWED');
    const narrowedReplay = await deliver(url, secret, 'd-2', { x: 2 });
    expect(narrowedReplay.status).toBe(409);
    expect((await narrowedReplay.json() as { code?: string }).code).toBe('WORKFLOW_NOT_ALLOWED');

    // 3. admin disables the account outright -> refused, 409, SERVICE_ACCOUNT_DISABLED.
    await callTool('service_account_update', { name: 'hook-bot', disabled: true }, adminToken);
    const disabled = await deliver(url, secret, 'd-3', { x: 3 });
    expect(disabled.status).toBe(409);
    expect((await disabled.json() as { code?: string }).code).toBe('SERVICE_ACCOUNT_DISABLED');

    // 4. admin deletes the account -> a NEW delivery id is still refused (the trigger/workflow
    // remain, owned by the now-dead sa:hook-bot — spec: "owned workflows/runs remain").
    await callTool('service_account_delete', { name: 'hook-bot' }, adminToken);
    const deleted = await deliver(url, secret, 'd-4', { x: 4 });
    expect(deleted.status).toBe(409);
    expect((await deleted.json() as { code?: string }).code).toBe('SERVICE_ACCOUNT_DISABLED');
  });
});
