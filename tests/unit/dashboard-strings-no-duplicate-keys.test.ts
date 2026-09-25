// A duplicate key in an object literal silently keeps the LAST value. #73's follow-up added a
// second `unavailable:` to STR.zh/STR.en and overwrote the System tab's '無法取樣' — caught only by
// the real-Chromium VAL-199/VAL-204 acceptance tests. Guard the class at the unit tier.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

describe('dashboard string table has no duplicate keys per locale', () => {
  it('STR.zh and STR.en each declare every key exactly once', () => {
    const file = 'src/dashboard/lib/strings.js';
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const dupes: string[] = [];
    let locales = 0;
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'STR' && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
        for (const loc of n.initializer.properties) {
          if (!ts.isPropertyAssignment(loc) || !ts.isObjectLiteralExpression(loc.initializer)) continue;
          locales++;
          const seen = new Set<string>();
          for (const p of loc.initializer.properties) {
            const k = p.name?.getText(sf).replace(/^['"]|['"]$/g, '');
            if (k === undefined) continue;
            if (seen.has(k)) dupes.push(`${loc.name.getText(sf)}.${k}`);
            seen.add(k);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(locales).toBeGreaterThanOrEqual(2);
    expect(dupes).toEqual([]);
  });
});
