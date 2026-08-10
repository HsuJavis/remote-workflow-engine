// v8 Defer B (REQ-056): Host/Origin allowlist truth-table (DNS-rebinding + CSRF defense).
import { describe, it, expect } from 'vitest';
import { isAllowedHost, isAllowedOrigin } from '../../src/net-guard.js';

describe('isAllowedHost — DNS-rebinding defense (v8 Defer B, REQ-056)', () => {
  const PORT = 8787;
  it('accepts loopback authorities at the server port', () => {
    for (const h of ['127.0.0.1:8787', 'localhost:8787', '127.0.0.1', 'localhost', '[::1]:8787']) {
      expect(isAllowedHost(h, '127.0.0.1', PORT)).toBe(true);
    }
  });
  it('rejects a foreign Host (rebinding) and a wrong port', () => {
    expect(isAllowedHost('evil.example.com', '127.0.0.1', PORT)).toBe(false);
    expect(isAllowedHost('evil.example.com:8787', '127.0.0.1', PORT)).toBe(false);
    expect(isAllowedHost('127.0.0.1:9999', '127.0.0.1', PORT)).toBe(false); // wrong port
    expect(isAllowedHost('127.0.0.1.evil.example.com:8787', '127.0.0.1', PORT)).toBe(false); // prefix bypass
  });
  it('rejects an absent Host (fail-closed) — HTTP/1.1 requires it', () => {
    expect(isAllowedHost(undefined, '127.0.0.1', PORT)).toBe(false);
  });
  it('accepts the configured LAN bind host when bound non-loopback', () => {
    expect(isAllowedHost('192.168.0.10:8787', '192.168.0.10', PORT)).toBe(true);
    expect(isAllowedHost('127.0.0.1:8787', '192.168.0.10', PORT)).toBe(true); // loopback always ok
    expect(isAllowedHost('192.168.0.99:8787', '192.168.0.10', PORT)).toBe(false); // a different LAN host
  });
});

describe('isAllowedOrigin — CSRF defense, fail-open on absent (v8 Defer B, REQ-056)', () => {
  const PORT = 8787;
  it('ALLOWS an absent/empty/null Origin (programmatic MCP clients + tests send none)', () => {
    expect(isAllowedOrigin(undefined, '127.0.0.1', PORT)).toBe(true);
    expect(isAllowedOrigin('', '127.0.0.1', PORT)).toBe(true);
    expect(isAllowedOrigin('null', '127.0.0.1', PORT)).toBe(true);
  });
  it('allows a loopback Origin at the server port', () => {
    expect(isAllowedOrigin('http://127.0.0.1:8787', '127.0.0.1', PORT)).toBe(true);
    expect(isAllowedOrigin('http://localhost:8787', '127.0.0.1', PORT)).toBe(true);
  });
  it('rejects a drive-by browser Origin (CSRF)', () => {
    expect(isAllowedOrigin('http://evil.example.com', '127.0.0.1', PORT)).toBe(false);
    expect(isAllowedOrigin('https://evil.example.com', '127.0.0.1', PORT)).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:9999', '127.0.0.1', PORT)).toBe(false); // wrong port
    expect(isAllowedOrigin('not-a-url', '127.0.0.1', PORT)).toBe(false); // malformed → reject
  });
});

describe('isAllowedHost/Origin — configurable extra hosts (ServerConfig.allowedHosts; LAN IP / proxy while bound 0.0.0.0)', () => {
  const PORT = 8899;
  it('a LAN-IP Host is REJECTED by default (0.0.0.0 → loopback-only) but ACCEPTED when configured', () => {
    expect(isAllowedHost('192.168.0.125:8899', '0.0.0.0', PORT)).toBe(false);
    expect(isAllowedHost('192.168.0.125:8899', '0.0.0.0', PORT, ['192.168.0.125'])).toBe(true);
    expect(isAllowedHost('localhost:8899', '0.0.0.0', PORT, ['192.168.0.125'])).toBe(true); // loopback still works
  });
  it('still enforces the port and rejects hosts outside the union', () => {
    expect(isAllowedHost('192.168.0.125:9999', '0.0.0.0', PORT, ['192.168.0.125'])).toBe(false); // wrong port
    expect(isAllowedHost('192.168.0.99:8899', '0.0.0.0', PORT, ['192.168.0.125'])).toBe(false); // not configured
    expect(isAllowedHost('evil.example.com:8899', '0.0.0.0', PORT, ['192.168.0.125'])).toBe(false);
  });
  it('a configured proxy hostname Origin passes (no port = HTTPS default); others still rejected', () => {
    expect(isAllowedOrigin('https://dash.nicecream.work', '0.0.0.0', PORT, ['dash.nicecream.work'])).toBe(true);
    expect(isAllowedOrigin('https://evil.example.com', '0.0.0.0', PORT, ['dash.nicecream.work'])).toBe(false);
  });
});
