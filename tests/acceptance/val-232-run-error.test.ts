// VAL-232 (REQ-205): a failed run leaves a diagnosable reason on disk and on every read surface —
// run_status/run_result/run_list, GET /api/runs/:id, journal.jsonl, and the dashboard (detail +
// list row). Written test-first (Gate 5, RED) — none of these surfaces carry an error today.
//
// Scope note: criterion 4 (a structured `violation` marker reaching the run-level error) is
// EXCLUDED — see DES-230's `owner_decision: pending` (traced nothing can reach it upstream). The
// restart-survives-a-process-restart half is IT-tier (`run-error-restart.test.ts`); the
// failedAgentCount/redaction edge matrices are IT/UT-tier (DES-231/232/234's own `tests:` bullets).
// This file is the single real-user-facing action: boot, fail a run for real, read every surface.
//
// Mock policy (acceptance — real, no mock of the SUT boundary): real createServer(), real MCP
// HTTP, real puppeteer/Chromium against the real dashboard.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, type ToolCaller } from '../helpers/workflow-fixtures.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';

function findChrome(): string | null {
  const explicit = process.env['PUPPETEER_EXECUTABLE_PATH'];
  if (explicit && existsSync(explicit)) return explicit;
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (!existsSync(root)) return null;
  for (const rev of readdirSync(root)) {
    for (const layout of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, rev, layout);
      if (existsSync(p)) return p;
    }
  }
  return null;
}
const chrome = findChrome();
throwIfBrowserRequired(chrome);

let server: Server;
let baseUrl: string;
let runId: string;
let workRoot: string;

function call(): ToolCaller {
  return async (name, args) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  };
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val232-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
  baseUrl = `http://127.0.0.1:${server.port}`;
  const c = call();
  await registerPublishedVia(c, 'val232-fails', "throw new Error('boom, VAL-232 real failure');");
  const started = (await c('run_start', { name: 'val232-fails' })) as { runId: string };
  runId = started.runId;
  let status = 'queued';
  for (let i = 0; i < 100 && status !== 'failed'; i++) {
    await new Promise((r) => setTimeout(r, 40));
    status = ((await c('run_status', { runId })) as { status: string }).status;
  }
  expect(status).toBe('failed');
});

afterAll(async () => { await server?.close(); if (workRoot) rmSync(workRoot, { recursive: true, force: true }); });

describe('VAL-232 — a failed run leaves a diagnosable reason everywhere (REQ-205)', () => {
  it('run_status and run_result carry error:{code,message}', async () => {
    const c = call();
    const status = (await c('run_status', { runId })) as { result?: { error?: { code: string; message: string } } };
    const result = (await c('run_result', { runId })) as { error?: { code: string; message: string } };
    expect(status.result?.error?.message).toMatch(/boom, VAL-232/);
    expect(result.error?.message).toMatch(/boom, VAL-232/);
  });

  it('run_list surfaces the same reason for this terminal run', async () => {
    const c = call();
    const rows = (await c('run_list', {})) as { result?: Array<{ runId: string; error?: { code: string; message: string } }> };
    const row = rows.result?.find((r) => r.runId === runId);
    expect(row?.error?.message).toMatch(/boom, VAL-232/);
  });

  it('GET /api/runs/:id carries the error field', async () => {
    const res = await fetch(`${baseUrl}/api/runs/${runId}`);
    const body = (await res.json()) as { error?: { code: string; message: string } };
    expect(body.error?.message).toMatch(/boom, VAL-232/);
  });

  it('the run directory has a journal.jsonl line recording the terminal reason', async () => {
    const path = join(workRoot, 'store', 'runs', runId, 'journal.jsonl');
    expect(existsSync(path), `expected a journal.jsonl at ${path}`).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/"type":"error"/);
    expect(text).toMatch(/boom, VAL-232/);
  });

  const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
    it(name, async (ctx) => { if (!chrome) ctx.skip(); await fn(); }, timeout);
  };

  itReal('the dashboard workflow-detail page (run chips/history + selected-run detail pane) renders the error code/message for the failed run', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/val232-fails`, { waitUntil: 'networkidle0', timeout: 10000 });
      await new Promise((r) => setTimeout(r, 500)); // one poll tick — the run is auto-selected (terminal, most-recent)
      const text = await page.evaluate(() => document.body.innerText || '');
      // SCRIPT_ERROR is the code (list row + detail pane both read it); the message is asserted
      // separately below against a completed run with no error, to rule out an "always shows the
      // last-thrown-anywhere text" false positive.
      expect(text).toMatch(/SCRIPT_ERROR/);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('a completed run with NO error renders no error block (never "undefined")', async () => {
    const c = call();
    await registerPublishedVia(c, 'val232-ok', 'return 1;');
    const okRun = (await c('run_start', { name: 'val232-ok' })) as { runId: string };
    let status = 'queued';
    for (let i = 0; i < 100 && status !== 'completed'; i++) {
      await new Promise((r) => setTimeout(r, 40));
      status = ((await c('run_status', { runId: okRun.runId })) as { status: string }).status;
    }
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/val232-ok`, { waitUntil: 'networkidle0', timeout: 10000 });
      await new Promise((r) => setTimeout(r, 500));
      const text = await page.evaluate(() => document.body.innerText || '');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('SCRIPT_ERROR');
    } finally {
      await browser.close();
    }
  }, 20000);
});
