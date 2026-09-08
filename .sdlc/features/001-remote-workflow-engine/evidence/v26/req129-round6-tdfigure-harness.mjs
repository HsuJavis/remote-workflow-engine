// REQ-129 — the clause 「既有 TD 圖同樣適用(渲染層,不動圖本身)」, v26 Gate 7.5 round 6 (validator).
//
// The five figures this deployment serves on their RELEASE channel are all `graph LR` after the v26
// migration, so the TD half of the clause needs a grandfathered version: this box's own
// `gp-runner v3` is a real pre-v26 `graph TD` figure (9 nodes) and the scratch engine publishes it
// to `release` for the measurement.
//
// A TD figure is TALL: rendered 1052 x ~2345 in a 1100 px window. Every geometry the round-3 author
// harness hard-codes (grab the figure's CENTRE, click Fit at its own rect) then falls outside the
// viewport, and the browser delivers nothing — which reads exactly like a dead pan/dead Fit but is
// the harness, not the page. This one therefore grabs a point that is inside BOTH the figure and
// the viewport, and scrolls the Fit control into view before clicking it.
// Usage: node req129-round6-tdfigure-harness.mjs <port> <workflow> <outJson> <pngDir>
import puppeteer from '/home/user/Documents/remote-workflow/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) for (const l of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = join(root, rev, l); if (existsSync(p)) return p; }
  return null;
}
const [, , PORT, WF, OUT, PNGDIR] = process.argv;
const R = { port: PORT, workflow: WF, at: new Date().toISOString() };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox', '--window-size=1120,960'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
await page.goto(`http://127.0.0.1:${PORT}/dashboard`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.card');
await page.evaluate((wf) => [...document.querySelectorAll('.card')].find((x) => (x.querySelector('.t') || {}).textContent === wf).click(), WF);
await page.waitForFunction(() => {
  const z = document.getElementById('diagram-zoom');
  const i = document.getElementById('diagram-img');
  return z && getComputedStyle(z).display !== 'none' && i && i.naturalWidth > 0;
}, { timeout: 30000 });
await wait(1500);

const tf = () => page.evaluate(() => document.getElementById('diagram-zoom').style.transform);
R.source = await page.evaluate((wf) => fetch('/api/workflows/' + encodeURIComponent(wf) + '/describe').then((r) => r.json()).then((j) => ({
  version: j.version, orientation: (j.mermaid || '').trim().split('\n')[0], nodes: ((j.mermaid || '').match(/^\s*[A-Za-z_]\w*\s*[([]/gm) || []).length,
})), WF);
R.figure = await page.evaluate(() => {
  const i = document.getElementById('diagram-img');
  const r = i.getBoundingClientRect();
  return { naturalW: i.naturalWidth, naturalH: i.naturalHeight, renderedW: Math.round(r.width), renderedH: Math.round(r.height), windowW: window.innerWidth, windowH: window.innerHeight, fitsWidth: r.width <= window.innerWidth };
});
await page.screenshot({ path: join(PNGDIR, 'req129-round6-td-figure-1100px.png') });

// ---- real drag-pan, grabbing a point inside BOTH the figure and the viewport ----
const grab = await page.evaluate(() => {
  const r = document.getElementById('diagram-img').getBoundingClientRect();
  const top = Math.max(r.y, 0), bottom = Math.min(r.y + r.height, window.innerHeight);
  return { x: r.x + r.width / 2, y: (top + bottom) / 2 };
});
R.grabPoint = grab;
R.transformInitial = await tf();
await page.evaluate(() => { window.__ev = []; ['dragstart', 'dragend', 'mouseup'].forEach((n) => document.addEventListener(n, (e) => window.__ev.push(n + (e.target.id ? ':' + e.target.id : '')))); });
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
await page.mouse.move(grab.x - 180, grab.y - 90, { steps: 12 });
await page.mouse.up();
await wait(300);
R.transformAfterPan = await tf();
R.eventsDuringGesture = await page.evaluate(() => window.__ev);
// sticky check: move with NO button held — the figure must not follow the cursor
await page.mouse.move(grab.x + 200, grab.y + 100, { steps: 6 });
await wait(200);
R.transformAfterMouseMoveWithNoButton = await tf();
await page.screenshot({ path: join(PNGDIR, 'req129-round6-td-after-pan.png') });

// ---- the Fit control: below the fold on a figure this tall, so scroll to it, then REAL click ----
R.fitBeforeScroll = await page.evaluate(() => {
  const b = document.getElementById('diagram-fit').getBoundingClientRect();
  return { y: Math.round(b.y), inViewport: b.y > 0 && b.y < window.innerHeight };
});
await page.evaluate(() => document.getElementById('diagram-fit').scrollIntoView({ block: 'center' }));
await wait(400);
const btn = await page.evaluate(() => {
  const b = document.getElementById('diagram-fit').getBoundingClientRect();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const el = document.elementFromPoint(cx, cy);
  window.__h = [];
  document.getElementById('diagram-fit').addEventListener('click', (e) => window.__h.push({ trusted: e.isTrusted }));
  return { cx, cy, hit: el ? el.tagName + '#' + el.id : null };
});
R.fitAfterScroll = btn;
await page.mouse.click(btn.cx, btn.cy);
await wait(300);
R.fitClick = await page.evaluate(() => window.__h);
R.transformAfterFit = await tf();
await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
