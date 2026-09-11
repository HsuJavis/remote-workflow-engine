// v27 (DES-191, TASK-196, UT-232): the browser tier must FAIL when required, never silently skip.
// Every acceptance file that finds no Chrome computes a SKIPPED reason and calls `ctx.skip()` per
// case — correct for local dev, but on a CI box with no browser it makes the whole real-tier suite
// green for the wrong reason. `RWE_REQUIRE_BROWSER=1` (Gate 7.5's own runbook, DEPLOY.md) turns
// that same absence into a hard failure instead.
export function throwIfBrowserRequired(chrome: string | null): void {
  if (!chrome && process.env['RWE_REQUIRE_BROWSER'] === '1') {
    throw new Error('browser tier required (RWE_REQUIRE_BROWSER=1) but no Chrome found');
  }
}
