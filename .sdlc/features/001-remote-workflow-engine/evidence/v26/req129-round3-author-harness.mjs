// REQ-129 — the AUTHOR figure, clean protocol, no page mutation before the measurement.
// Fresh load -> real drag-pan -> real Fit click -> real wheel zoom -> real Fit click.
// Usage: node req129-author-clean.mjs <port> <workflowName> <outJson> <pngDir>
import puppeteer from '/home/user/Documents/remote-workflow/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [, , PORT, WF, OUT, PNGDIR] = process.argv;
function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) for (const l of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = join(root, rev, l); if (existsSync(p)) return p; }
  return null;
}
const R = { port: PORT, workflow: WF, at: new Date().toISOString() };
const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
await page.goto(`http://127.0.0.1:${PORT}/dashboard`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.card');
await page.evaluate((wf) => [...document.querySelectorAll('.card')].find((x) => (x.querySelector('.t') || {}).textContent === wf).click(), WF);
await page.waitForFunction(() => { const z = document.getElementById('diagram-zoom'); const i = document.getElementById('diagram-img'); return z && getComputedStyle(z).display !== 'none' && i && i.naturalWidth > 0; }, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 400));
const tf = () => page.evaluate(() => document.getElementById('diagram-zoom').style.transform);
const hit = (x, y) => page.evaluate((x, y) => { const e = document.elementFromPoint(x, y); return e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') : null; }, x, y);
await page.evaluate(() => { window.__drag = []; document.addEventListener('dragstart', (e) => window.__drag.push('dragstart:' + e.target.id), true); });
const img = await page.evaluate(() => { const b = document.getElementById('diagram-img').getBoundingClientRect(); return { cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height), windowW: window.innerWidth }; });
const btn = await page.evaluate(() => { const b = document.getElementById('diagram-fit').getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; });
R.figure = img; R.fitCentre = btn;
R.transformInitial = await tf();
R.hitOnFitBeforeAnything = await hit(btn.cx, btn.cy);
await page.screenshot({ path: join(PNGDIR, 'req129-round3-author-before.png') });

// 1) real drag-pan, 10 steps of (-18,-9) = a -180,-90 gesture
await page.mouse.move(img.cx, img.cy);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(img.cx - i * 18, img.cy - i * 9); await new Promise((r) => setTimeout(r, 40)); }
await page.mouse.up();
await new Promise((r) => setTimeout(r, 250));
R.gestureRequested = { dx: -180, dy: -90 };
R.transformAfterPan = await tf();
R.nativeDragEvents = await page.evaluate(() => window.__drag);
await page.screenshot({ path: join(PNGDIR, 'req129-round3-author-after-pan.png') });

// 2) real mouse click on Fit after the pan
await page.evaluate(() => { window.__dfitHits = []; document.getElementById('diagram-fit').addEventListener('click', (e) => window.__dfitHits.push({ trusted: e.isTrusted }), true); });
R.hitOnFitAfterPan = await hit(btn.cx, btn.cy);
await page.mouse.click(btn.cx, btn.cy);
await new Promise((r) => setTimeout(r, 250));
R.realClickAfterPan = await page.evaluate(() => window.__dfitHits);
R.transformAfterFitClick = await tf();

// 3) real wheel zoom, then Fit again
await page.mouse.move(img.cx, img.cy);
await page.mouse.wheel({ deltaY: -120 });
await new Promise((r) => setTimeout(r, 250));
R.transformAfterWheel = await tf();
await page.screenshot({ path: join(PNGDIR, 'req129-round3-author-zoomed.png') });
await page.evaluate(() => { window.__dfitHits = []; });
await page.mouse.click(btn.cx, btn.cy);
await new Promise((r) => setTimeout(r, 250));
R.transformAfterSecondFit = await tf();
R.realClickAfterZoom = await page.evaluate(() => window.__dfitHits);

// 4) counterfactual, isolating the cause: the ONLY change is turning the browser's native
//    image-drag off. Nothing else about the page or the gesture differs.
await page.evaluate(() => { document.getElementById('diagram-img').draggable = false; });
await page.mouse.move(img.cx, img.cy);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(img.cx - i * 18, img.cy - i * 9); await new Promise((r) => setTimeout(r, 40)); }
await page.mouse.up();
await new Promise((r) => setTimeout(r, 250));
R.counterfactualDraggableFalse = { transformAfterSameGesture: await tf() };
await browser.close();
writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
