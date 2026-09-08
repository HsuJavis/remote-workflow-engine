// REQ-129 / D8 real-browser re-validation — v26 Gate 7.5 round 3 (validator).
// Real Chromium, real wheel, real drag-pan with real mouse events, real click on the Fit control.
// Usage: node req129-round3.mjs <port> <runId> <outJson> <pngDir>
import puppeteer from '/home/user/Documents/remote-workflow/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [, , PORT, RUN_ID, OUT, PNGDIR] = process.argv;
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
const R = { port: PORT, runId: RUN_ID, at: new Date().toISOString() };
const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
const base = `http://127.0.0.1:${PORT}`;
await page.goto(`${base}/dashboard/${RUN_ID}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const s = document.getElementById('dag-graph');
  return s && s.childElementCount > 0;
}, { timeout: 20000 });

const hit = (x, y) => page.evaluate((x, y) => {
  const e = document.elementFromPoint(x, y);
  return e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') : null;
}, x, y);
const tf = () => page.evaluate(() => document.getElementById('dag-zoom').style.transform);

R.svg = await page.evaluate(() => {
  const s = document.getElementById('dag-graph');
  const r = s.getBoundingClientRect();
  const cells = s.querySelectorAll('rect').length;
  const labels = [...s.querySelectorAll('text')].map((t) => t.textContent).slice(0, 40);
  return {
    viewBox: s.getAttribute('viewBox'), width: s.getAttribute('width'),
    preserveAspectRatio: s.getAttribute('preserveAspectRatio'),
    renderedW: Math.round(r.width), renderedH: Math.round(r.height),
    windowW: window.innerWidth, rects: cells, labels,
  };
});
// D8 — the four token columns readable on the page
R.d8 = await page.evaluate(() => ({
  runUsageText: (document.getElementById('run-usage') || {}).textContent,
  usageColsSpan: (document.querySelector('#run-usage .usage-cols') || {}).textContent || null,
  firstAgentNode: (document.querySelector('.tok') || {}).textContent || null,
  agentNodeTexts: [...document.querySelectorAll('.tok')].map((n) => n.textContent).slice(0, 6),
  treeText: (document.getElementById('tree') || {}).textContent?.slice(0, 400) || null,
}));
R.phases = await page.evaluate(() => [...document.querySelectorAll('#phases .phase')].map((p) => p.textContent));

const btn = await page.evaluate(() => {
  const b = document.getElementById('dag-fit').getBoundingClientRect();
  return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, w: b.width, h: b.height };
});
R.fitButtonCentre = btn;
R.hitBeforeAnything = await hit(btn.cx, btn.cy);
await page.screenshot({ path: join(PNGDIR, 'req129-round3-before-pan.png') });

// --- wheel zoom (real wheel event through the browser input pipeline) ---
const gc = await page.evaluate(() => {
  const b = document.getElementById('dag-graph').getBoundingClientRect();
  return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
});
R.transformInitial = await tf();
await page.mouse.move(gc.cx, gc.cy);
await page.mouse.wheel({ deltaY: -120 });
await new Promise((r) => setTimeout(r, 200));
R.transformAfterWheelZoom = await tf();
R.hitAfterWheelZoom = await hit(btn.cx, btn.cy);
await page.screenshot({ path: join(PNGDIR, 'req129-round3-zoomed.png') });

// instrument the button's OWN listener so we can tell a real trusted click from a synthetic one
await page.evaluate(() => {
  window.__fitHits = [];
  document.getElementById('dag-fit').addEventListener('click', (e) => window.__fitHits.push({ trusted: e.isTrusted, target: e.target.id }), true);
});
await page.mouse.click(btn.cx, btn.cy);
await new Promise((r) => setTimeout(r, 150));
R.afterZoomFitClick = { transform: await tf(), hits: await page.evaluate(() => window.__fitHits) };

// --- real drag-pan ---
await page.mouse.move(gc.cx, gc.cy);
await page.mouse.down();
await page.mouse.move(gc.cx - 220, gc.cy - 120, { steps: 15 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 200));
R.transformAfterPan = await tf();
R.hitAfterPan = await hit(btn.cx, btn.cy);
await page.screenshot({ path: join(PNGDIR, 'req129-round3-after-pan.png') });

// --- the round-1 red line: a REAL mouse click on Fit after a pan ---
await page.evaluate(() => { window.__fitHits = []; });
await page.mouse.click(btn.cx, btn.cy);
await new Promise((r) => setTimeout(r, 200));
R.realClickAfterPan = await page.evaluate(() => window.__fitHits);
R.transformAfterFitClick = await tf();
await page.screenshot({ path: join(PNGDIR, 'req129-round3-after-fit.png') });

// --- the 3s poll must not reset a user's zoom/pan ---
await page.mouse.move(gc.cx, gc.cy);
await page.mouse.down();
await page.mouse.move(gc.cx - 90, gc.cy - 40, { steps: 8 });
await page.mouse.up();
const beforeWait = await tf();
await new Promise((r) => setTimeout(r, 4200));
R.pollSurvival = { before: beforeWait, after4200ms: await tf() };
await page.mouse.click(btn.cx, btn.cy);

// --- the author diagram on the same page (REQ-129 covers BOTH figures) ---
R.authorDiagram = await page.evaluate(() => {
  const z = document.getElementById('diagram-zoom');
  const f = document.getElementById('diagram-fit');
  const img = document.getElementById('diagram-img');
  const r = img ? img.getBoundingClientRect() : null;
  return {
    zoomVisible: z ? getComputedStyle(z).display : null,
    fitVisible: f ? getComputedStyle(f).display : null,
    imgSrc: img ? img.getAttribute('src') : null,
    renderedW: r ? Math.round(r.width) : null, renderedH: r ? Math.round(r.height) : null,
  };
});
if (R.authorDiagram.zoomVisible && R.authorDiagram.zoomVisible !== 'none') {
  const dbtn = await page.evaluate(() => {
    const b = document.getElementById('diagram-fit').getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  });
  const dc = await page.evaluate(() => {
    const b = document.getElementById('diagram-img').getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  const dtf = () => page.evaluate(() => document.getElementById('diagram-zoom').style.transform);
  await page.mouse.move(dc.cx, dc.cy);
  await page.mouse.wheel({ deltaY: -120 });
  await new Promise((r) => setTimeout(r, 150));
  const zoomTf = await dtf();
  await page.mouse.move(dc.cx, dc.cy);
  await page.mouse.down();
  await page.mouse.move(dc.cx - 150, dc.cy - 60, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 150));
  const panTf = await dtf();
  const hitAfterPan = await hit(dbtn.cx, dbtn.cy);
  await page.evaluate(() => {
    window.__dfitHits = [];
    document.getElementById('diagram-fit').addEventListener('click', (e) => window.__dfitHits.push({ trusted: e.isTrusted }), true);
  });
  await page.mouse.click(dbtn.cx, dbtn.cy);
  await new Promise((r) => setTimeout(r, 150));
  R.authorDiagramInteraction = {
    afterWheel: zoomTf, afterPan: panTf, hitAfterPan,
    hits: await page.evaluate(() => window.__dfitHits), afterFitClick: await dtf(),
  };
  await page.screenshot({ path: join(PNGDIR, 'req129-round3-author-diagram.png') });
}
await browser.close();
writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
