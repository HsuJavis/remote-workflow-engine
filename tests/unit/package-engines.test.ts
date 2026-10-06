// Owner decision 2026-10-06 (issue audit A4): package.json carries no `engines` field at all, so
// `npm install` on a Node < 22.19 host (the pi packages' own declared floor — see
// node_modules/@earendil-works/pi-coding-agent/package.json's `engines.node`) only gets a silent
// warning, never a clear refusal. This locks the floor declared in package.json itself matches the
// pi dependency's own floor, so the two can never drift apart silently.
// Red reason: package.json has no `engines` key today — `pkg.engines` is `undefined`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('package.json engines (A4, pi dependency floor)', () => {
  it('declares a Node floor matching the pi packages own >=22.19.0 requirement', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe('>=22.19.0');
  });
});
