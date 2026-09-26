// DES-092 (ARCH-059, TASK-085): pure OAuth 2.0 metadata builders — no I/O, no clock.
// Three pure functions consumed by server.ts route wiring (TASK-086).

interface AuthCfg {
  issuer: string;
  [key: string]: unknown;
}

/** Strip any trailing slash from the issuer base URL so path segments don't double-slash. */
function base(issuer: string): string {
  return issuer.replace(/\/$/, '');
}

/**
 * Scopes this engine's AS actually supports — shared by the PRM's `scopes_supported` and the
 * AS metadata's `scopes_supported` so the two documents never drift (issue #86).
 * Also the source for the `scope=` param on the WWW-Authenticate 401 challenge, which is
 * priority (1) in the MCP authorization spec's client scope-selection order (PRM
 * scopes_supported is priority (2)). Without either, a spec-following client resolves scope
 * to "" and Google/this AS never issues a refresh token → session hard-expires after 7 days.
 */
export const OAUTH_SCOPES_SUPPORTED = ['openid', 'email', 'offline_access'];

/** RFC 9728 Protected Resource Metadata for the MCP authorization spec. */
export function buildProtectedResourceMetadata(cfg: AuthCfg): {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
} {
  const b = base(cfg.issuer);
  return {
    resource: b,
    authorization_servers: [b],
    scopes_supported: OAUTH_SCOPES_SUPPORTED,
  };
}

/** RFC 8414 Authorization Server Metadata with PKCE S256 required. */
export function buildAuthServerMetadata(cfg: AuthCfg): {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  code_challenge_methods_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  scopes_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  authorization_response_iss_parameter_supported: boolean;
} {
  const b = base(cfg.issuer);
  return {
    issuer: cfg.issuer,
    authorization_endpoint: `${b}/authorize`,
    token_endpoint: `${b}/token`,
    registration_endpoint: `${b}/register`,
    code_challenge_methods_supported: ['S256'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: OAUTH_SCOPES_SUPPORTED,
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
  };
}

/**
 * RFC 6750 WWW-Authenticate challenge pointing at the PRM document, plus a `scope` auth-param
 * (issue #86) — priority (1) in the MCP spec's client scope-selection order, ahead of PRM
 * scopes_supported (priority 2). Comma-separated per RFC 6750 auth-param syntax.
 */
export function wwwAuthenticateHeader(cfg: AuthCfg): string {
  const b = base(cfg.issuer);
  return `Bearer resource_metadata="${b}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPES_SUPPORTED.join(' ')}"`;
}
