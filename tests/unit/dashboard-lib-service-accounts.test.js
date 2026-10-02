// Service accounts spec (owner decision 2026-10-03): the pure half of the admin page's
// "Service accounts" section — row projection + form-input parsing. No `document` (lib/ boundary).
import { describe, it, expect } from 'vitest';
import { serviceAccountRows, secretRows, parseWorkflowsInput, parseExpiresAtInput, curlSnippet } from '../../src/dashboard/lib/service-accounts.js';

const NOW = Date.parse('2026-10-03T12:00:00.000Z');

describe('serviceAccountRows(list)', () => {
  it('projects clientId/role/status/workflows/lastUsed, "unrestricted" for no allowlist', () => {
    const rows = serviceAccountRows([
      { clientId: 'sa:ci-bot', name: 'ci-bot', description: 'CI', role: 'user', workflows: ['foo', 'bar'], expiresAt: null, disabled: false, lastUsedAt: '2026-10-03T01:02:03.000Z', secrets: [] },
      { clientId: 'sa:unscoped', name: 'unscoped', description: null, role: 'author', workflows: null, expiresAt: null, disabled: true, lastUsedAt: null, secrets: [] },
    ], NOW);
    expect(rows[0]).toMatchObject({ id: 'sa:ci-bot', role: 'user', workflowsText: 'foo, bar', statusKey: 'saEnabled', lastUsed: '2026-10-03 01:02:03' });
    expect(rows[1]).toMatchObject({ id: 'sa:unscoped', workflowsText: null, statusKey: 'saDisabledStatus', lastUsed: null });
  });

  it('marks an account past its own expiresAt as expired (even if not explicitly disabled)', () => {
    const rows = serviceAccountRows([
      { clientId: 'sa:exp', name: 'exp', role: 'user', workflows: null, expiresAt: '2026-10-01T00:00:00.000Z', disabled: false, lastUsedAt: null, secrets: [] },
    ], NOW);
    expect(rows[0]).toMatchObject({ expired: true, statusKey: 'saExpired' });
  });

  it('non-array input returns []', () => {
    expect(serviceAccountRows(null)).toEqual([]);
    expect(serviceAccountRows(undefined)).toEqual([]);
  });
});

describe('secretRows(secrets)', () => {
  it('projects id/createdAt/lastUsed/expiresAt and flags an expired secret', () => {
    const rows = secretRows([
      { id: 's1', createdAt: '2026-09-01T00:00:00.000Z', lastUsedAt: '2026-10-02T00:00:00.000Z', expiresAt: null },
      { id: 's2', createdAt: '2026-09-01T00:00:00.000Z', lastUsedAt: null, expiresAt: '2026-10-01T00:00:00.000Z' },
    ], undefined, NOW);
    expect(rows[0]).toMatchObject({ id: 's1', lastUsed: '2026-10-02 00:00:00', expiresAt: null, expired: false });
    expect(rows[1]).toMatchObject({ id: 's2', lastUsed: null, expired: true });
  });
});

describe('parseWorkflowsInput(text)', () => {
  it('blank/whitespace -> undefined (unrestricted)', () => {
    expect(parseWorkflowsInput('')).toBeUndefined();
    expect(parseWorkflowsInput('   ')).toBeUndefined();
    expect(parseWorkflowsInput(undefined)).toBeUndefined();
  });
  it('comma-separated, trimmed, empties dropped', () => {
    expect(parseWorkflowsInput('foo, bar ,, baz')).toEqual(['foo', 'bar', 'baz']);
  });
});

describe('parseExpiresAtInput(text)', () => {
  it('blank -> undefined; otherwise passed through verbatim for the server to validate', () => {
    expect(parseExpiresAtInput('')).toBeUndefined();
    expect(parseExpiresAtInput('  ')).toBeUndefined();
    expect(parseExpiresAtInput('2027-01-01T00:00:00.000Z')).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('curlSnippet', () => {
  it('builds a ready-to-run client_credentials exchange', () => {
    expect(curlSnippet('https://host', 'sa:ci-bot', 'rwe_sa_xxx')).toBe(
      'curl -s https://host/token -d grant_type=client_credentials -d client_id=sa:ci-bot -d client_secret=rwe_sa_xxx',
    );
  });
});
