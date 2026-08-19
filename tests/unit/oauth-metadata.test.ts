// UT-092 (DES-092, ARCH-059, TASK-085): pure `buildProtectedResourceMetadata`,
// `buildAuthServerMetadata`, `wwwAuthenticateHeader` functions from `src/auth/oauth-metadata.ts`.
//
// Auth config shape (pinned contract per DES-092/095; these keys live on the `ServerConfig.auth`
// object when implemented):
//   { issuer: string; googleClientId: string; googleClientSecret: string;
//     bearerTtlMs?: number; googleBase?: string; jwksFetch?: fn }
//
// Cases:
//   buildProtectedResourceMetadata:
//     - returns { resource, authorization_servers: string[] }
//     - authorization_servers contains the issuer URL
//     - no trailing-slash drift between issuer and .well-known path
//   buildAuthServerMetadata:
//     - returns { issuer, authorization_endpoint, token_endpoint }
//     - code_challenge_methods_supported === ['S256']
//     - response_types_supported === ['code']
//     - grant_types_supported === ['authorization_code']
//     - endpoints derive from issuer without trailing-slash drift
//   wwwAuthenticateHeader:
//     - returns exact Bearer challenge with resource_metadata URI
//     - resource_metadata URI is `<issuer>/.well-known/oauth-protected-resource`
//     - no trailing slash before /.well-known
//
// Red reason: `src/auth/oauth-metadata.ts` does not exist → MODULE NOT FOUND →
//   all tests fail at collect time. Correct red for an unimplemented module.
//
// Mock policy (unit): pure functions, zero I/O, zero clock, no network.

import { describe, it, expect } from 'vitest';
import {
  buildProtectedResourceMetadata,
  buildAuthServerMetadata,
  wwwAuthenticateHeader,
} from '../../src/auth/oauth-metadata.js';

const CFG = {
  issuer: 'http://127.0.0.1:8787',
  googleClientId: 'test-client-id',
  googleClientSecret: 'test-client-secret',
};

describe('buildProtectedResourceMetadata (DES-092)', () => {
  it('returns resource and authorization_servers array', () => {
    const m = buildProtectedResourceMetadata(CFG);
    expect(typeof m.resource).toBe('string');
    expect(Array.isArray(m.authorization_servers)).toBe(true);
    expect(m.authorization_servers.length).toBeGreaterThan(0);
  });

  it('authorization_servers contains the issuer', () => {
    const m = buildProtectedResourceMetadata(CFG);
    expect(m.authorization_servers).toContain(CFG.issuer);
  });

  it('no trailing-slash drift: resource_metadata URI starts with issuer + /.well-known', () => {
    // The resource field should be derived from issuer without double-slash
    const m = buildProtectedResourceMetadata(CFG);
    expect(m.resource).not.toMatch(/\/\/\.well-known/);
  });
});

describe('buildAuthServerMetadata (DES-092)', () => {
  it('returns correct issuer', () => {
    const m = buildAuthServerMetadata(CFG);
    expect(m.issuer).toBe(CFG.issuer);
  });

  it('returns authorization_endpoint and token_endpoint as strings', () => {
    const m = buildAuthServerMetadata(CFG);
    expect(typeof m.authorization_endpoint).toBe('string');
    expect(typeof m.token_endpoint).toBe('string');
  });

  it('code_challenge_methods_supported is exactly ["S256"]', () => {
    const m = buildAuthServerMetadata(CFG);
    expect(m.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('response_types_supported is exactly ["code"]', () => {
    const m = buildAuthServerMetadata(CFG);
    expect(m.response_types_supported).toEqual(['code']);
  });

  // v20 (DES-092 v20): grant_types_supported gains refresh_token
  // Pre-impl: ['authorization_code'] → toEqual(['authorization_code','refresh_token']) FAILS
  it('grant_types_supported is exactly ["authorization_code","refresh_token"] (v20)', () => {
    const m = buildAuthServerMetadata(CFG);
    expect(m.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
  });

  // v20 (DES-092 v20): new fields required by MCP offline_access / RFC 8414
  // Pre-impl: field absent → undefined → assertion FAILS
  it('scopes_supported is exactly ["openid","email","offline_access"] (v20)', () => {
    const m = buildAuthServerMetadata(CFG) as Record<string, unknown>;
    expect(m['scopes_supported']).toEqual(['openid', 'email', 'offline_access']);
  });

  it('token_endpoint_auth_methods_supported is exactly ["none"] (v20)', () => {
    const m = buildAuthServerMetadata(CFG) as Record<string, unknown>;
    expect(m['token_endpoint_auth_methods_supported']).toEqual(['none']);
  });

  it('authorization_response_iss_parameter_supported is true (v20)', () => {
    const m = buildAuthServerMetadata(CFG) as Record<string, unknown>;
    expect(m['authorization_response_iss_parameter_supported']).toBe(true);
  });

  it('endpoints derive from issuer (no trailing slash before path segments)', () => {
    const m = buildAuthServerMetadata(CFG);
    // Each endpoint should start with the issuer
    expect(m.authorization_endpoint.startsWith(CFG.issuer)).toBe(true);
    expect(m.token_endpoint.startsWith(CFG.issuer)).toBe(true);
    // No double-slash
    const base = CFG.issuer.replace(/\/$/, '');
    expect(m.authorization_endpoint).not.toContain(`${base}//`);
    expect(m.token_endpoint).not.toContain(`${base}//`);
  });

  it('issuer with trailing slash: no drift in .well-known path', () => {
    const cfgTrail = { ...CFG, issuer: 'http://127.0.0.1:8787/' };
    const m = buildAuthServerMetadata(cfgTrail);
    // e.g. /.well-known/oauth-authorization-server should not be // in the path portion.
    // Strip scheme before checking (http:// legitimately contains // in the scheme separator).
    const base = cfgTrail.issuer.replace(/\/$/, '');
    expect(m.authorization_endpoint).not.toContain(`${base}//`);
    expect(m.token_endpoint).not.toContain(`${base}//`);
  });
});

describe('wwwAuthenticateHeader (DES-092)', () => {
  it('returns a Bearer scheme header string', () => {
    const h = wwwAuthenticateHeader(CFG);
    expect(h).toMatch(/^Bearer /);
  });

  it('contains resource_metadata parameter', () => {
    const h = wwwAuthenticateHeader(CFG);
    expect(h).toMatch(/resource_metadata=/);
  });

  it('resource_metadata URI is issuer + /.well-known/oauth-protected-resource', () => {
    const h = wwwAuthenticateHeader(CFG);
    const expected = `${CFG.issuer}/.well-known/oauth-protected-resource`;
    expect(h).toContain(expected);
  });

  it('no double-slash in resource_metadata URI', () => {
    const h = wwwAuthenticateHeader(CFG);
    // Verify no double-slash after scheme
    const uriMatch = h.match(/resource_metadata="([^"]+)"/);
    const uri = uriMatch?.[1] ?? '';
    expect(uri.replace(/^https?:\/\//, '')).not.toContain('//');
  });
});
