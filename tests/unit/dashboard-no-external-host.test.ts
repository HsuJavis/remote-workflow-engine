// UT-231 (DES-191, ARCH-124, TASK-196, REQ-131): the v27 client ships from `/static/dashboard/*`
// only (ARCH-123) — REQ-131's offline stance ("無網路環境開啟頁面 ... 字體由本 repo 自帶") means no
// `src/dashboard/**/*.{css,js}` byte may reference an external host. Three checks: (a) no
// `https?://` outside a comment, (b) every CSS `url(...)` argument starts with `/static/dashboard/`,
// (c) no `@import`.
//
// Tier: unit, pure static analysis (same convention as no-skeleton-surface/no-retired-surface).
//
// This guard MUST tolerate an ABSENT `src/dashboard/` — TASK-196 (this file) lands before
// TASK-204..212 create that directory. The real-directory arm is therefore vacuously green today
// (Mode C: nothing exists yet to violate the rule) — the RED half is the planted-fixture arm below,
// which proves the detector actually catches a violation once real files exist to scan.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DASHBOARD_CLIENT_ROOT = join(__dirname, '..', '..', 'src', 'dashboard');

function walkCssJs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkCssJs(p));
    else if (entry.endsWith('.css') || entry.endsWith('.js')) out.push(p);
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface Violation { file: string; reason: string }

function findViolations(dir: string): Violation[] {
  const violations: Violation[] = [];
  for (const file of walkCssJs(dir)) {
    const raw = readFileSync(file, 'utf8');
    const text = stripComments(raw);
    if (/https?:\/\//.test(text)) violations.push({ file, reason: 'external URL scheme' });
    if (/@import/.test(text)) violations.push({ file, reason: '@import' });
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      const target = m[1] ?? '';
      if (!target.startsWith('/static/dashboard/') && !target.startsWith('data:')) {
        violations.push({ file, reason: `url() not under /static/dashboard/: ${target}` });
      }
    }
  }
  return violations;
}

describe('dashboard client ships no external-host reference (UT-231, DES-191, REQ-131)', () => {
  it('src/dashboard/**/*.{css,js} carries no external host today (vacuously true — the directory does not exist yet)', () => {
    expect(findViolations(DASHBOARD_CLIENT_ROOT)).toEqual([]);
  });

  it('a planted external URL / bad url() / @import in a temp fixture dir IS caught (proves the detector, not just the absence)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'no-external-host-planted-'));
    try {
      writeFileSync(join(tmp, 'bad.css'), "@import url('https://fonts.googleapis.com/css');\n.x{background:url(https://cdn.example.com/img.png)}\n");
      writeFileSync(join(tmp, 'bad.js'), "fetch('http://evil.example/x');\n");
      const violations = findViolations(tmp);
      expect(violations.length).toBeGreaterThanOrEqual(3); // @import + external url() + http:// literal
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
