// UT-168 (v25, REQ-119, DES-166, TASK-166): the mmdc spawn wrapper's FAILURE contract, exercised
// against a real child process without needing Chrome.
//
// REQ-119: "渲染失敗(逾時、Chrome 缺席、mermaid-cli 缺席)Then 降級回現行的原始碼顯示,並回報可觀測的
// 原因 —— 不得整頁空白,也不得假裝成功." Each of those degradations is a case here.
//
// Mock policy (unit, DES-119): the CHILD is real (a stub `mmdc` written to a temp dir, driven by an
// env var), only the renderer binary is substituted. That is deliberate — the two properties worth
// proving are process-shaped: a malformed output file must not be served as a diagram, and a hung
// render must have its whole PROCESS GROUP killed, because mmdc spawns Chrome and killing only mmdc
// leaves a ~300MB orphan behind. A mocked `spawn` could not observe either. Real mmdc + real Chrome
// is VAL-152 (real tier).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagramRenderer, renderWithMmdc } from '../../src/diagram-render.js';

let dir: string;
let stub: string;

/** A stand-in for `mmdc`: same CLI shape (`-i in -o out …`), behaviour chosen by RWE_STUB_MODE. */
const STUB = `
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const out = process.argv[process.argv.indexOf('-o') + 1];
const mode = process.env['RWE_STUB_MODE'];
if (mode === 'ok') { writeFileSync(out, '<svg xmlns="http://www.w3.org/2000/svg">stub</svg>'); }
else if (mode === 'garbage') { writeFileSync(out, 'Error: could not launch browser'); }
else if (mode === 'nofile') { /* exits 0 having written nothing */ }
else if (mode === 'fail') { process.stderr.write('stub failure: no chrome\\n'); process.exit(7); }
else if (mode === 'hang') {
  // A grandchild that also hangs — killing the group must reap BOTH (this is the Chrome mmdc
  // starts). Both pids are recorded so the test can assert they are gone.
  const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(process.env['RWE_STUB_PIDS'], JSON.stringify({ self: process.pid, kid: kid.pid }));
  setInterval(() => {}, 1000);
}
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-mmdc-stub-'));
  stub = join(dir, 'stub-mmdc.mjs');
  writeFileSync(stub, STUB);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('renderWithMmdc — degrades with an observable reason, never a fake success (UT-168, REQ-119)', () => {
  it('a renderer that is not installed answers RENDERER_MISSING (never a throw, never a blank svg)', async () => {
    const out = await renderWithMmdc('graph TD;\\nA(["a"])', new AbortController().signal, { cliPath: join(dir, 'does-not-exist.js') });
    expect(out).toMatchObject({ ok: false, reason: 'RENDERER_MISSING' });
  });

  it('an unresolvable package (cliPath: null) answers RENDERER_MISSING — the optionalDependency-absent case', async () => {
    const out = await renderWithMmdc('graph TD;', new AbortController().signal, { cliPath: null });
    expect(out).toMatchObject({ ok: false, reason: 'RENDERER_MISSING' });
  });

  it('a renderer that exits non-zero answers RENDER_FAILED and carries its stderr as the reason detail', async () => {
    const out = await renderWithMmdc('graph TD;', new AbortController().signal, { cliPath: stub, env: { RWE_STUB_MODE: 'fail' } });
    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ reason: 'RENDER_FAILED' });
    expect((out as { detail?: string }).detail ?? '').toContain('no chrome');
  });

  it('output that is not an SVG is RENDER_FAILED — malformed output is never served as a picture', async () => {
    const out = await renderWithMmdc('graph TD;', new AbortController().signal, { cliPath: stub, env: { RWE_STUB_MODE: 'garbage' } });
    expect(out).toMatchObject({ ok: false, reason: 'RENDER_FAILED' });
  });

  it('an exit-0 run that wrote no output file is RENDER_FAILED, not an empty success', async () => {
    const out = await renderWithMmdc('graph TD;', new AbortController().signal, { cliPath: stub, env: { RWE_STUB_MODE: 'nofile' } });
    expect(out).toMatchObject({ ok: false, reason: 'RENDER_FAILED' });
  });

  it('a real child that writes a real SVG is returned verbatim, and its temp dir is cleaned up', async () => {
    const out = await renderWithMmdc('graph TD;', new AbortController().signal, { cliPath: stub, env: { RWE_STUB_MODE: 'ok' } });
    expect(out).toEqual({ ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg">stub</svg>' });
  });
});

describe('renderWithMmdc — a hung render is killed by PROCESS GROUP (UT-168, REQ-119 defence c)', () => {
  it('the deadline kills mmdc AND its grandchild, and the caller gets RENDER_TIMEOUT', async () => {
    const pidFile = join(dir, 'pids.json');
    rmSync(pidFile, { force: true });
    const renderer = new DiagramRenderer({
      timeoutMs: 400,
      render: (src, signal) => renderWithMmdc(src, signal, { cliPath: stub, env: { RWE_STUB_MODE: 'hang', RWE_STUB_PIDS: pidFile } }),
    });

    const out = await renderer.get('wf', 'v1', 'graph TD;');
    expect(out).toEqual({ ok: false, reason: 'RENDER_TIMEOUT' });

    expect(existsSync(pidFile)).toBe(true); // the stub really did start (a vacuous pass is not a pass)
    const { self, kid } = JSON.parse(readFileSync(pidFile, 'utf-8')) as { self: number; kid: number };
    // SIGTERM to the group is asynchronous; give it a beat, then assert BOTH are gone. The
    // grandchild is the one that matters: it stands in for the Chrome mmdc spawns.
    for (let i = 0; i < 40 && (alive(self) || alive(kid)); i++) await new Promise((r) => setTimeout(r, 50));
    expect({ mmdc: alive(self), chrome: alive(kid) }).toEqual({ mmdc: false, chrome: false });
  }, 15000);
});
