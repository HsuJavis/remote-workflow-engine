// REQ-129 / D10 re-verification — v26 Gate 7.5 round 4 (fixer), on the FIXED tree.
// Two things the round-3 sticky harness (re-run verbatim as req129-round4-author-sticky.json) does
// not cover:
//   (1) the author figure's own Fit control after a REAL drag-pan — the fix must not cost the
//       clause VAL-191 closed;
//   (2) the DAG's per-agent transcript links, because the fix adds `e.preventDefault()` to the
//       shared `.zoomable` mousedown handler. preventDefault on mousedown must NOT cancel the
//       later click; this measures that with a REAL mouse click on a REAL run's agent cell.
// Usage: node req129-round4-harness.mjs <port> <workflow> <runId> <outJson> <pngDir>
import puppeteer from '/home/user/Documents/remote-workflow/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [, , PORT, WF, RUN_ID, OUT, PNGDIR] = process.argv;
function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) {
    for (const l of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = join(root, rev, l);
      if (existsSync(p)) return p;
    }
  }
  return null;
}
const R = { at: new Date().toISOString(), port: PORT, workflow: WF, runId: RUN_ID };
const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
const base = `http://127.0.0.1:${PORT}`;

// ---------- (1) the author figure: real drag, then a real click on its Fit ----------
await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.card');
await page.evaluate((wf) => [...document.querySelectorAll('.card')].find((x) => (x.querySelector('.t') || {}).textContent === wf).click(), WF);
await page.waitForFunction(() => {
  const z = document.getElementById('diagram-zoom');
  const i = document.getElementById('diagram-img');
  return z && getComputedStyle(z).display !== 'none' && i && i.naturalWidth > 0;
}, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 400));
const dtf = () => page.evaluate(() => document.getElementById('diagram-zoom').style.transform);
R.imgDraggableAttr = await page.evaluate(() => document.getElementById('diagram-img').getAttribute('draggable'));
R.imgUserDrag = await page.evaluate(() => getComputedStyle(document.getElementById('diagram-img')).webkitUserDrag || null);
const img = await page.evaluate(() => {
  const b = document.getElementById('diagram-img').getBoundingClientRect();
  return { cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) };
});
R.imgRect = img;
await page.screenshot({ path: join(PNGDIR, 'req129-round4-author-before-pan.png') });
R.transformInitial = await dtf();
await page.mouse.move(img.cx, img.cy);
await page.mouse.down();
await page.mouse.move(img.cx - 180, img.cy - 90, { steps: 12 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 200));
R.transformAfterRealDrag = await dtf();
R.gestureRequested = { dx: -180, dy: -90 };
await page.screenshot({ path: join(PNGDIR, 'req129-round4-author-after-pan.png') });

const dbtn = await page.evaluate(() => {
  const b = document.getElementById('diagram-fit').getBoundingClientRect();
  return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
});
R.hitAtFitCentreAfterPan = await page.evaluate(({ cx, cy }) => {
  const e = document.elementFromPoint(cx, cy);
  return e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') : null;
}, dbtn);
await page.evaluate(() => {
  window.__dfitHits = [];
  document.getElementById('diagram-fit').addEventListener('click', (e) => window.__dfitHits.push({ trusted: e.isTrusted }), true);
});
await page.mouse.click(dbtn.cx, dbtn.cy);
await new Promise((r) => setTimeout(r, 200));
R.realFitClick = await page.evaluate(() => window.__dfitHits);
R.transformAfterFitClick = await dtf();
await page.screenshot({ path: join(PNGDIR, 'req129-round4-author-after-fit.png') });

// ---------- (2) the run DAG: a real click on an agent cell still opens its transcript ----------
await page.goto(`${base}/dashboard/${RUN_ID}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const s = document.getElementById('dag-graph');
  return s && s.childElementCount > 0;
}, { timeout: 30000 });
const cell = await page.evaluate(() => {
  const g = [...document.querySelectorAll('#dag-graph g')].find((n) => typeof n.onclick === 'function');
  if (!g) return null;
  const b = g.getBoundingClientRect();
  return { cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2), label: g.textContent };
});
R.dagCell = cell;
R.transcriptBefore = await page.evaluate(() => (document.getElementById('transcript') || {}).textContent?.slice(0, 60) ?? null);
if (cell) {
  await page.mouse.click(cell.cx, cell.cy);
  await new Promise((r) => setTimeout(r, 1200));
}
R.transcriptAfterRealCellClick = await page.evaluate(() => (document.getElementById('transcript') || {}).textContent?.slice(0, 200) ?? null);
R.dagTransformAfterCellClick = await page.evaluate(() => document.getElementById('dag-zoom').style.transform);
await page.screenshot({ path: join(PNGDIR, 'req129-round4-dag-after-cell-click.png') });

await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
