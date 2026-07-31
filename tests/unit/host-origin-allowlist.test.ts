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
