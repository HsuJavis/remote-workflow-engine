import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // v27 (DES-191, TASK-196): src/dashboard/{lib,ui}/*.js has no build step (ADR-049) and its unit
    // tests are plain .js files importing those bytes directly — without this, a .test.js file is
    // never collected at all and its absence reads as a pass (DES-191's own boundary warning).
    include: ['tests/**/*.test.{ts,js}'],
    testTimeout: 15000,
    // Many tests spawn real child processes (sandbox host) or a real HTTP server.
    // Running test files fully in parallel creates host-level scheduling contention
    // that occasionally pushes real subprocess round-trips (e.g. suspend) past their
    // poll windows — an intermittent-timeout flake, not a logic defect (VAL-006/E2E-002).
    fileParallelism: false,
    // Run beforeAll/afterAll hooks sequentially (stack order) so that hooks which
    // start real HTTP servers (fake Google, engine) are fully ready before dependent
    // hooks consume their ports. Vitest v1.6.1 default is "parallel" which races them.
    sequence: { hooks: 'stack' },
  },
});
