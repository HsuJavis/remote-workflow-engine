// Dashboard auth spec §A/§A2 (2026-09-30): the auth DB gains (1) browser sessions — raw token
// never stored, sha256 at rest, 7-day sliding TTL, GC'd with the rest; (2) an oauth_state `flow`
// marker so the shared Google callback can tell a dashboard login from an MCP authorize; (3) the
// role store — DB overrides + principals seen at login.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { TokenStore, SESSION_TTL_MS } from '../../src/auth/token-store.js';
import { RoleStore } from '../../src/auth/role-store.js';
import { sessionCookie, readSessionCookie, LoginRateLimiter, safeDashboardNext } from '../../src/auth/auth-service.js';

function counterCsprng() {
  let c = 1;
  return (n: number) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (c++ + i) & 0xff; return b; };
}

function makeStores(start = Date.UTC(2026, 8, 30)) {
  const db = new Database(':memory:');
  let now = start;
  const clock = () => now;
  const tokens = new TokenStore(db, { clock, csprng: counterCsprng() });
  const roles = new RoleStore(db, { clock });
  return { db, tokens, roles, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe('TokenStore dashboard sessions', () => {
  it('SESSION_TTL_MS is 7 days', () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 3600_000);
  });

  it('createSession returns a >=256-bit raw token, stored only as its sha256', () => {
    const { db, tokens } = makeStores();
    const { token } = tokens.createSession('alice@x.com');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const rows = db.prepare('SELECT * FROM dashboard_sessions').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!['token_hash']).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('verifySession answers the principal; unknown/expired/deleted answer null', () => {
    const { tokens, advance } = makeStores();
    const { token } = tokens.createSession('alice@x.com');
    expect(tokens.verifySession(token)?.principal).toBe('alice@x.com');
    expect(tokens.verifySession('f'.repeat(64))).toBeNull();
    advance(SESSION_TTL_MS + 1);
    expect(tokens.verifySession(token)).toBeNull();
    const s2 = tokens.createSession('bob@x.com');
    tokens.deleteSession(s2.token);
    expect(tokens.verifySession(s2.token)).toBeNull();
  });

  it('slides: a session used after more than a day is extended to a fresh 7 days (and says so)', () => {
    const { tokens, advance, now } = makeStores();
    const { token } = tokens.createSession('alice@x.com');
    expect(tokens.verifySession(token)?.slid).toBe(false);
    advance(2 * 24 * 3600_000);
    const v = tokens.verifySession(token);
    expect(v?.slid).toBe(true);
    expect(v?.expiresAt).toBe(now() + SESSION_TTL_MS);
    advance(6 * 24 * 3600_000); // 8 days after creation, 6 after the slide
    expect(tokens.verifySession(token)?.principal).toBe('alice@x.com');
  });

  it('gcExpired deletes expired sessions', () => {
    const { db, tokens, advance } = makeStores();
    tokens.createSession('alice@x.com');
    advance(SESSION_TTL_MS + 1);
    tokens.gcExpired();
    expect((db.prepare('SELECT COUNT(*) AS n FROM dashboard_sessions').get() as { n: number }).n).toBe(0);
  });

  it('oauth_state carries a flow marker; an MCP state reads back flow null', () => {
    const { tokens } = makeStores();
    tokens.putState({ state: 's1', nonce: 'n1', codeChallenge: '', redirectUri: '/dashboard/x', flow: 'dashboard' });
    tokens.putState({ state: 's2', nonce: 'n2', codeChallenge: 'c', redirectUri: 'http://127.0.0.1:1/cb' });
    expect(tokens.consumeState('s1')).toMatchObject({ flow: 'dashboard', redirectUri: '/dashboard/x' });
    expect(tokens.consumeState('s2')).toMatchObject({ flow: null });
  });
});

describe('RoleStore', () => {
  it('set / get / clear a DB override, recording updatedBy + updatedAt', () => {
    const { roles, now } = makeStores();
    expect(roles.getOverride('bob@x.com')).toBeUndefined();
    roles.setOverride('bob@x.com', 'author', 'root@x.com');
    expect(roles.getOverride('bob@x.com')).toBe('author');
    expect(roles.overrides()).toEqual([{ id: 'bob@x.com', role: 'author', updatedBy: 'root@x.com', updatedAt: new Date(now()).toISOString() }]);
    roles.setOverride('bob@x.com', null, 'root@x.com');
    expect(roles.getOverride('bob@x.com')).toBeUndefined();
  });

  it('markSeen records first/last seen; lastSeen advances, firstSeen does not', () => {
    const { roles, advance, now } = makeStores();
    const t0 = new Date(now()).toISOString();
    roles.markSeen('alice@x.com');
    advance(10 * 60_000);
    roles.markSeen('alice@x.com');
    const t1 = new Date(now()).toISOString();
    expect(roles.seen()).toEqual([{ id: 'alice@x.com', firstSeenAt: t0, lastSeenAt: t1 }]);
  });

  it('knownPrincipals folds in every principal already holding a bearer/refresh token or a session', () => {
    const { tokens, roles } = makeStores();
    tokens.issue('legacy@x.com', 1000);
    tokens.issueRefresh('refresh@x.com', null, null, 1000);
    tokens.createSession('dash@x.com');
    roles.markSeen('seen@x.com');
    roles.setOverride('pre@x.com', 'author', 'root@x.com');
    expect(roles.knownPrincipals().sort()).toEqual(['dash@x.com', 'legacy@x.com', 'pre@x.com', 'refresh@x.com', 'seen@x.com']);
  });

  it('knownPrincipals works on a DB with no token tables (auth disabled)', () => {
    const db = new Database(':memory:');
    const roles = new RoleStore(db, { clock: () => 0 });
    roles.setOverride('a@x.com', 'admin', 'local');
    expect(roles.knownPrincipals()).toEqual(['a@x.com']);
  });
});

describe('session cookie attributes', () => {
  it('Secure iff the issuer is https; always HttpOnly, SameSite=Lax, Path=/, 7-day Max-Age', () => {
    const tok = 'a'.repeat(64);
    expect(sessionCookie(tok, 'https://rwe.example.test')).toBe(`rwe_session=${tok}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure`);
    expect(sessionCookie(tok, 'http://127.0.0.1:1')).toBe(`rwe_session=${tok}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax`);
  });
  it('readSessionCookie picks rwe_session out of a Cookie header and rejects a malformed value', () => {
    const tok = 'b'.repeat(64);
    expect(readSessionCookie(`x=1; rwe_session=${tok}; y=2`)).toBe(tok);
    expect(readSessionCookie('rwe_session=not-hex')).toBeNull();
    expect(readSessionCookie(undefined)).toBeNull();
  });
});

describe('verify-i LOW-2/LOW-3 helpers', () => {
  it('LoginRateLimiter: a burst of capacity, then refused, then refills with time; keys are independent', () => {
    let now = 0;
    const l = new LoginRateLimiter(3, 3 / 60_000, () => now);
    expect([l.take('a'), l.take('a'), l.take('a'), l.take('a')]).toEqual([true, true, true, false]);
    expect(l.take('b')).toBe(true);
    now += 20_000; // one token back
    expect([l.take('a'), l.take('a')]).toEqual([true, false]);
  });
  it('safeDashboardNext rejects any non-printable-ASCII next', () => {
    expect(safeDashboardNext('/dashboard/\u0100')).toBe('/dashboard');
    expect(safeDashboardNext('/dashboard/workflow/%E4%B8%AD')).toBe('/dashboard/workflow/%E4%B8%AD');
  });
});
