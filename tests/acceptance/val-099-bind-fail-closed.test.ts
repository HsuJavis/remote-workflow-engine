// VAL-099 (REQ-089): D-BIND fail-closed — non-loopback callers without a valid principal are
// refused (401); loopback exempt; /github/webhook (HMAC) unaffected; auth-disabled → guard dormant.
//
// REQ-089 acceptance criteria:
//   Given auth enabled + bind 0.0.0.0:
//     - request from non-loopback peer (own LAN IP) without bearer → 401 (fail-closed)
//     - same request from 127.0.0.1 (loopback) → NOT 401 (exempt — local admin, self-update path)
//     - valid-HMAC webhook POST from LAN IP → NOT 401 (own HMAC control, unaffected by D-BIND)
//   Given auth disabled: bind 0.0.0.0, LAN IP, no bearer → NOT 401 (guard dormant)
//
// Guard: requires a non-internal IPv4 LAN IP (os.networkInterfaces). Skip LAN-IP cases if absent.
// The loopback-exempt case is a partial-green pre-impl (already true). Red comes from LAN-IP→401.
//
// Red reason: D-BIND guard not yet implemented → LAN IP hit gets 200 instead of 401 → FAIL.
//
// Mock policy (acceptance — DES-100): MUST NOT mock the SUT's own net-guard.
//   `0.0.0.0` bind + own LAN IP produces a genuine non-loopback `remoteAddress` on the socket.
//   This is a real socket touch — no mocks.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

// ── LAN IP detection ──────────────────────────────────────────────────────────

function getLanIp(): string | undefined {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return undefined;
}

const LAN_IP = getLanIp();
const HAS_LAN_IP = LAN_IP !== undefined;

// ── auth-enabled server bound to 0.0.0.0 ─────────────────────────────────────

let serverOn: Server;
let tmpDir1: string;

beforeAll(async () => {
  tmpDir1 = mkdtempSync(join(tmpdir(), 'rwe-val099a-'));
  // allowedHosts includes the LAN IP so the existing host-allowlist check passes;
  // D-BIND then applies its 401 gate on top for un-tokened non-loopback callers.
  serverOn = await createServer({
    port: 0,
    bind: '0.0.0.0',
    workRoot: tmpDir1,
    allowedHosts: LAN_IP ? [LAN_IP] : [],
    auth: {
      enabled: true,
      issuer: `http://127.0.0.1:0`,
      googleClientId: 'val099-cid',
      googleClientSecret: 'val099-cs',
    },
  } as never);
});

afterAll(async () => {
  await serverOn?.close();
  rmSync(tmpDir1, { recursive: true, force: true });
});

// ── auth-disabled server (guard must be dormant) ──────────────────────────────

let serverOff: Server;
let tmpDir2: string;

beforeAll(async () => {
  tmpDir2 = mkdtempSync(join(tmpdir(), 'rwe-val099b-'));
  serverOff = await createServer({
    port: 0, bind: '0.0.0.0', workRoot: tmpDir2,
    allowedHosts: LAN_IP ? [LAN_IP] : [],
  });
});

afterAll(async () => {
  await serverOff?.close();
  rmSync(tmpDir2, { recursive: true, force: true });
});

const mcpBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'val099', version: '1' } } });

describe('REQ-089: D-BIND fail-closed (VAL-099)', () => {
  it('loopback (127.0.0.1) → NOT 401 (exempt)', async () => {
    // Loopback is always exempt — the local admin and the tag-triggered self-update rescue path
    // must keep working without a bearer
    const res = await fetch(`http://127.0.0.1:${serverOn.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mcpBody,
    });
    expect(res.status).not.toBe(401);
  });

  it.skipIf(!HAS_LAN_IP)('LAN IP (non-loopback) without bearer → 401 (fail-closed)', async () => {
    const res = await fetch(`http://${LAN_IP}:${serverOn.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mcpBody,
    });
    expect(res.status).toBe(401);
  });

  it.skipIf(!HAS_LAN_IP)('POST /github/webhook via LAN IP with HMAC → NOT 401 (D-BIND does not gate webhook)', async () => {
    // The webhook path is guarded by its own HMAC, not D-BIND
    const body = JSON.stringify({ action: 'published', release: { tag_name: 'v0.0.99' } });
    // Use a bogus HMAC — just verifying that we don't get 401 from D-BIND specifically
    // (may get 401/403 from the HMAC guard, which is its own control — not D-BIND)
    const sig = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';
    const res = await fetch(`http://${LAN_IP}:${serverOn.port}/github/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'release', 'X-Hub-Signature-256': sig },
      body,
    });
    // D-BIND must NOT return 401 for this path; the HMAC guard returns 4xx for wrong HMAC
    // (403 or 401 from the HMAC guard is OK, but ONLY the D-BIND 401 has WWW-Authenticate)
    if (res.status === 401) {
      // Only pass if WWW-Authenticate is absent (meaning the 401 came from HMAC, not D-BIND)
      const wwwAuth = res.headers.get('www-authenticate');
      expect(wwwAuth).toBeNull(); // D-BIND 401 MUST include WWW-Authenticate; HMAC 401 must NOT
    }
  });

  it.skipIf(!HAS_LAN_IP)('auth disabled: LAN IP without bearer → NOT 401 (guard dormant, pre-v15 open LAN)', async () => {
    const res = await fetch(`http://${LAN_IP}:${serverOff.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mcpBody,
    });
    expect(res.status).not.toBe(401);
  });
});
