import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
    // Many tests spawn real child processes (sandbox host) or a real HTTP server.
    // Running test files fully in parallel creates host-level scheduling contention
    // that occasionally pushes real subprocess round-trips (e.g. suspend) past their
    // poll windows — an intermittent-timeout flake, not a logic defect (VAL-006/E2E-002).
    fileParallelism: false,
  },
});
