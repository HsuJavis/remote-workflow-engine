// Dashboard auth spec §A/§A2 (2026-09-30): the pure half of the header identity, the admin tab's
// visibility, and the admin page's row model; plus poll.js's 401 -> login redirect (a 401 must
// re-authenticate, never count as an outage that engages demo mode).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tabsFor, headerIdentity, principalRows, roleChangeValue, loginUrlFor, isPending } from '../../src/dashboard/lib/principals.js';

describe('tabsFor(auth)', () => {
  it('adds the admin tab only for an authenticated admin', () => {
    const base = ['workflows', 'models', 'system', 'issues'];
    expect(tabsFor({ enabled: true, id: 'r@x', role: 'admin' })).toEqual([...base, 'admin']);
    expect(tabsFor({ enabled: true, id: 'a@x', role: 'author' })).toEqual(base);
    expect(tabsFor({ enabled: true, loopback: true })).toEqual(base);
    expect(tabsFor({ enabled: false })).toEqual(base);
    expect(tabsFor(undefined)).toEqual(base);
  });
});

describe('headerIdentity(auth, lang)', () => {
  it('shows email + role + sign-out for a signed-in user', () => {
    expect(headerIdentity({ enabled: true, id: 'a@x', role: 'author' }, 'en')).toEqual({ label: 'a@x', role: 'author', signOut: true });
  });
  it('shows a local label and no sign-out on the loopback rescue path', () => {
    expect(headerIdentity({ enabled: true, loopback: true }, 'en')).toEqual({ label: 'Local (loopback)', role: null, signOut: false });
  });
  it('shows nothing with auth disabled', () => {
    expect(headerIdentity({ enabled: false }, 'zh')).toBeNull();
    expect(headerIdentity(undefined, 'zh')).toBeNull();
  });
});

describe('principalRows(list, lang)', () => {
  it('locks config admins, marks the override state, and formats never-seen', () => {
    const rows = principalRows({ authEnabled: true, principals: [
      { id: 'root@x', role: 'admin', source: 'config-locked', firstSeenAt: null, lastSeenAt: '2026-09-30T01:02:03.000Z' },
      { id: 'bob@x', role: 'author', source: 'db', firstSeenAt: null, lastSeenAt: null, updatedBy: 'root@x', updatedAt: '2026-09-30T00:00:00.000Z' },
    ] }, 'en');
    expect(rows[0]).toMatchObject({ id: 'root@x', role: 'admin', locked: true, selected: 'admin', lastSeen: '2026-09-30 01:02:03' });
    expect(rows[1]).toMatchObject({ id: 'bob@x', role: 'author', locked: false, selected: 'author', lastSeen: 'never' });
    expect(rows[1].sourceText).toContain('root@x');
  });
  it('a row with no runtime override selects the "default" option (value "")', () => {
    const rows = principalRows({ authEnabled: true, principals: [{ id: 'c@x', role: 'author', source: 'config', firstSeenAt: null, lastSeenAt: null }] }, 'zh');
    expect(rows[0].selected).toBe('');
  });
  it('tolerates a malformed body', () => {
    expect(principalRows(null, 'en')).toEqual([]);
    expect(principalRows({ principals: 'x' }, 'en')).toEqual([]);
  });
});

describe('roleChangeValue(selectValue)', () => {
  it('maps the default option to null and passes the three roles through', () => {
    expect(roleChangeValue('')).toBeNull();
    for (const r of ['admin', 'author', 'user']) expect(roleChangeValue(r)).toBe(r);
    expect(roleChangeValue('owner')).toBeUndefined();
  });
});

describe('loginUrlFor(pathname, search)', () => {
  it('carries the current page as next', () => {
    expect(loginUrlFor('/dashboard/workflow/x', '?a=1')).toBe('/dashboard/login?next=%2Fdashboard%2Fworkflow%2Fx%3Fa%3D1');
    expect(loginUrlFor('/dashboard', '')).toBe('/dashboard/login?next=%2Fdashboard');
  });
});

describe('poll.js getJSON: a 401 sends the browser to the login page', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; delete globalThis.location; });

  it('calls location.assign(login?next=...) and resolves a non-throwing fail result', async () => {
    const assign = vi.fn();
    globalThis.location = { pathname: '/dashboard/abc', search: '', assign };
    globalThis.fetch = async () => ({ status: 401, json: async () => ({ error: 'unauthorized' }) });
    const { getJSON } = await import('../../src/dashboard/ui/poll.js');
    const r = await getJSON('/api/runs');
    expect(assign).toHaveBeenCalledWith('/dashboard/login?next=%2Fdashboard%2Fabc');
    expect(r.reached).toBe(true);
  });

  it('a 200 does not redirect', async () => {
    const assign = vi.fn();
    globalThis.location = { pathname: '/dashboard', search: '', assign };
    globalThis.fetch = async () => ({ status: 200, json: async () => [] });
    const { getJSON } = await import('../../src/dashboard/ui/poll.js');
    await getJSON('/api/runs');
    expect(assign).not.toHaveBeenCalled();
  });
});

// Owner decision 2026-09-30 (verify-i MEDIUM-1): a signed-in principal with role 'none' is pending.
describe("pending approval ('none')", () => {
  it('isPending is true only for a signed-in none principal', () => {
    expect(isPending({ enabled: true, id: 'n@x', role: 'none' })).toBe(true);
    expect(isPending({ enabled: true, id: 'u@x', role: 'user' })).toBe(false);
    expect(isPending({ enabled: true, loopback: true })).toBe(false);
    expect(isPending({ enabled: false })).toBe(false);
    expect(isPending(undefined)).toBe(false);
  });
  it('a pending principal gets no tabs at all', () => {
    expect(tabsFor({ enabled: true, id: 'n@x', role: 'none' })).toEqual([]);
  });
  it('the header still names them and offers sign-out', () => {
    expect(headerIdentity({ enabled: true, id: 'n@x', role: 'none' }, 'en')).toEqual({ label: 'n@x', role: 'none', signOut: true });
  });
  it('an admin row for a none principal is marked pending (one-click grant) and none is a valid selector value', () => {
    const rows = principalRows({ authEnabled: true, principals: [
      { id: 'n@x', role: 'none', source: 'default', firstSeenAt: null, lastSeenAt: '2026-09-30T01:02:03.000Z' },
      { id: 'r@x', role: 'none', source: 'db', firstSeenAt: null, lastSeenAt: null, updatedBy: 'root@x' },
      { id: 'u@x', role: 'user', source: 'db', firstSeenAt: null, lastSeenAt: null, updatedBy: 'root@x' },
    ] }, 'en');
    expect(rows.map((r) => r.pending)).toEqual([true, true, false]);
    expect(rows[1].selected).toBe('none');
    expect(roleChangeValue('none')).toBe('none');
  });
});
