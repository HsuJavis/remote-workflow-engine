// v27c (DES-209, ADR-053): the shared "規格逐條核" oracle consumed by val-198..201 — one row per
// REQ-131..135 constant (`tests/fixtures/dashboard-spec.ts`'s `SPEC_ROWS`). A row's `anchor` is
// always a `TEST_ANCHORS` entry, `:root`, or a `[anchor] .hook`/`.hook::pseudo` narrowing of one
// (never a bare style hook — DES-209's "a test may never key on a style hook"; a state-specific row
// such as `.card.running::before` or `[data-node-cell].is-failed` narrows WITHIN an already-anchored
// element, since state is only ever encoded as an `is-*` hook — there is no other way to express it).
// A `::before`/`::after` suffix on `anchor` is read via `getComputedStyle(el, pseudo)`. This helper
// judges each row by kind: `literal` (theme/hue-invariant, compared verbatim against
// `getComputedStyle`), `token` (compared to a same-page probe element that sets the ROW'S OWN
// property to `var(--<token>)` — never a hardcoded resolved string, DES-209's rule that a literal
// `oklch(...)` is only true for hue 236; a self-referential `:root` row, where `prop` already IS
// `--<token>`, has no independent reference to probe against, so it is checked for non-emptiness
// only — the weakest row kind, recorded as such), `animation` (`[name, duration]` against
// `animation-name`/`animation-duration`). A row whose anchor matches no element is a FAILURE the
// caller collects, never a skip — `expect(failures).toEqual([])` at the call site.
import type { Page } from 'puppeteer';
import type { SpecRow } from '../fixtures/dashboard-spec.js';

function splitPseudo(anchor: string): { selector: string; pseudo: string | null } {
  const m = anchor.match(/^(.*)(::(?:before|after))$/);
  if (m) return { selector: m[1]!, pseudo: m[2]! };
  return { selector: anchor, pseudo: null };
}

function selectorFor(anchor: string): string {
  if (anchor === ':root' || anchor.startsWith('[') || anchor.startsWith('.') || anchor.startsWith('#')) return anchor;
  return `[${anchor}]`;
}

const ANCHOR_NOT_FOUND = '__SPEC_ROW_ANCHOR_NOT_FOUND__';

async function computedProp(page: Page, anchor: string, prop: string): Promise<string> {
  const { selector, pseudo } = splitPseudo(selectorFor(anchor));
  return page.evaluate(
    (sel: string, ps: string | null, p: string, sentinel: string) => {
      const el = sel === ':root' ? document.documentElement : document.querySelector(sel);
      if (!el) return sentinel;
      return getComputedStyle(el, ps).getPropertyValue(p).trim();
    },
    selector,
    pseudo,
    prop,
    ANCHOR_NOT_FOUND,
  );
}

/** Probe a fresh element with `prop: var(--token)` and read the SAME prop back — generalises
 * DES-209's "styled `color: var(--<token>)`" example to whatever property the row is judging
 * (a `color:`-only probe cannot judge `box-shadow`, a compound property with no color grammar). */
async function tokenProbeValue(page: Page, prop: string, token: string): Promise<string> {
  return page.evaluate(
    (p: string, t: string) => {
      const probe = document.createElement('span');
      probe.style.setProperty(p, `var(--${t})`);
      document.body.appendChild(probe);
      const v = getComputedStyle(probe).getPropertyValue(p).trim();
      probe.remove();
      return v;
    },
    prop,
    token,
  );
}

/** One pass over `rows` at the page's CURRENT theme/hue. Returns human-readable failure strings. */
export async function specRowFailures(page: Page, rows: readonly SpecRow[]): Promise<string[]> {
  const failures: string[] = [];
  for (const row of rows) {
    const actual = await computedProp(page, row.anchor, row.prop);
    if (actual === ANCHOR_NOT_FOUND) {
      failures.push(`${row.req} ${row.anchor} ${row.prop}: anchor matched no element`);
      continue;
    }
    if ('literal' in row.expect) {
      if (actual !== row.expect.literal) {
        failures.push(`${row.req} ${row.anchor} ${row.prop}: expected literal "${row.expect.literal}", got "${actual}"`);
      }
    } else if ('token' in row.expect) {
      if (row.prop === `--${row.expect.token}`) {
        // Self-referential :root row — nothing on the page to compare against but itself
        // (probing `prop: var(--token)` would just re-read the same custom property). The
        // meaningful check available is that theme/hue swap still leaves it DEFINED.
        if (actual === '') failures.push(`${row.req} ${row.anchor} ${row.prop}: token --${row.expect.token} resolved empty`);
      } else {
        const probe = await tokenProbeValue(page, row.prop, row.expect.token);
        if (actual !== probe) {
          failures.push(`${row.req} ${row.anchor} ${row.prop}: expected token --${row.expect.token} ("${probe}"), got "${actual}"`);
        }
      }
    } else {
      const [name, duration] = row.expect.animation;
      if (actual !== name) {
        failures.push(`${row.req} ${row.anchor} animation-name: expected "${name}", got "${actual}"`);
      }
      const actualDuration = await computedProp(page, row.anchor, 'animation-duration');
      if (actualDuration !== duration) {
        failures.push(`${row.req} ${row.anchor} animation-duration: expected "${duration}", got "${actualDuration}"`);
      }
    }
  }
  return failures;
}

/** DES-209: iterate under BOTH `data-theme` values and once more after a hue-slider move. */
export async function specRowFailuresAcrossThemeAndHue(page: Page, rows: readonly SpecRow[]): Promise<string[]> {
  const failures: string[] = [];
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((t: string) => { document.documentElement.setAttribute('data-theme', t); }, theme);
    failures.push(...(await specRowFailures(page, rows)).map((f) => `[data-theme=${theme}] ${f}`));
  }
  await page.evaluate(() => { document.documentElement.style.setProperty('--rwe-hue', '80'); });
  failures.push(...(await specRowFailures(page, rows)).map((f) => `[--rwe-hue=80] ${f}`));
  return failures;
}
