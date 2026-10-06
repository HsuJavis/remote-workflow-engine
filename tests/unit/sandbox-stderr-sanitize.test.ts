// issue #162 A/B (defense in depth, unit tier): `sanitizeStderrTail` — the second, host-side layer
// of the fix. Even after child-entry.ts no longer lets a serialization throw crash the child, ANY
// future child crash (OOM, a real engine bug, a change that reintroduces an uncaught throw) must
// not leak the engine's own absolute source paths or Node version into a caller-visible message.
//
// Mock policy: pure unit — sanitizeStderrTail is a pure string function, no I/O.
import { describe, it, expect } from 'vitest';
import { sanitizeStderrTail } from '../../src/sandbox/host.js';

describe('sanitizeStderrTail (issue #162 A/B)', () => {
  it('redacts node:internal module frames', () => {
    const raw = 'TypeError: x\n    at writeChannelMessage (node:internal/child_process:164:20)';
    expect(sanitizeStderrTail(raw)).not.toMatch(/node:internal\/child_process/);
    expect(sanitizeStderrTail(raw)).toContain('<node internal>');
  });

  it('redacts absolute source paths', () => {
    const raw = '    at send (/home/rwe/app/src/sandbox/child-entry.ts:51:15)';
    const out = sanitizeStderrTail(raw);
    expect(out).not.toContain('/home/rwe');
    expect(out).not.toContain('child-entry.ts');
  });

  it('redacts the Node version string', () => {
    const raw = 'Node.js v22.14.3';
    expect(sanitizeStderrTail(raw)).not.toMatch(/v\d+\.\d+\.\d+/);
  });

  it('a real captured crash tail (issue #162 repro shape) carries none of the three after sanitizing', () => {
    const raw =
      'node:internal/child_process:164\n' +
      '    const string = JSONStringify(message) + \'\\n\';\n' +
      '                   ^\n\n' +
      'TypeError: Converting circular structure to JSON\n' +
      '    at stringify (<anonymous>)\n' +
      '    at writeChannelMessage (node:internal/child_process:164:20)\n' +
      '    at send (/home/user/Documents/rwe-wt/edge-g2-nested/src/sandbox/child-entry.ts:51:15)\n' +
      '    at main (/home/user/Documents/rwe-wt/edge-g2-nested/src/sandbox/child-entry.ts:149:5)\n\n' +
      'Node.js v22.14.3';
    const out = sanitizeStderrTail(raw);
    expect(out).not.toMatch(/node:internal/);
    expect(out).not.toMatch(/\/home\//);
    expect(out).not.toMatch(/\bv\d+\.\d+\.\d+\b/);
    // The useful diagnostic content (the error TYPE and message) survives — this is a redaction,
    // not a wipe.
    expect(out).toContain('TypeError: Converting circular structure to JSON');
  });

  it('leaves ordinary diagnostic text (no paths/versions) unchanged', () => {
    const raw = 'TypeError: Converting circular structure to JSON';
    expect(sanitizeStderrTail(raw)).toBe(raw);
  });

  // g2 minor (sandbox robustness sweep): the prior regex (`\bv\d+\.\d+\.\d+\b`) matched ANY
  // vX.Y.Z-shaped substring, not just Node's own version — a legitimate script-authored message
  // naming a dependency/semver version got mangled into unreadable nonsense. Narrowed to Node's own
  // version string (`process.version`, exact — the child runs the same binary as the host) and/or
  // the "Node.js vX.Y.Z" trailer format Node's own uncaught-exception printer uses (covered by the
  // existing cases above), never a bare "vX.Y.Z" with no Node-identifying context around it.
  it('does not mangle a script-authored semver-looking string with no Node.js prefix', () => {
    const raw = 'Error: dependency v1.2.3 failed to install';
    expect(sanitizeStderrTail(raw)).toBe(raw);
  });

  it('still redacts the exact running Node version wherever it appears, Node.js prefix or not', () => {
    const raw = `some internal detail mentioning ${process.version} directly`;
    const out = sanitizeStderrTail(raw);
    expect(out).not.toContain(process.version);
    expect(out).toContain('<node version>');
  });
});
