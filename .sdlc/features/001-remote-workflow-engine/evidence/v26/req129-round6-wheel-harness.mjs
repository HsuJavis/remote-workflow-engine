// REQ-129 — the WHEEL-ZOOM clause on BOTH figures, v26 Gate 7.5 round 6 (validator).
//
// Why this harness drives the wheel through the compositor, and the trap it documents:
//   `page.mouse.wheel()` sends a raw CDP `Input.dispatchMouseEvent{type:'mouseWheel'}`, and that
//   event is validated against the BROWSER WINDOW, not against the emulated viewport. Headless
//   Chromium's default window is 800x600; with `setViewport(1100x900)` every wheel below y=600 is
//   silently dropped — the page's own handler never runs AND the document does not scroll (measured:
//   the author figure sits at y~695 and was dead, the run DAG at y~333 zoomed fine, and adding any
//   document-level wheel listener made the same dead call work, which is what makes it look like a
//   product defect). `--window-size=1120,960` removes the trap; this harness then measures the wheel
//   BOTH ways — the raw dispatch AND `Input.synthesizeScrollGesture{gestureSourceType:'mouse'}`,
//   which drives the real compositor input pipeline — plus a control gesture over a plain area that
//   scrolls the page, proving the pipeline is live when nothing handles the wheel.
//   (synthesizeScrollGesture validates against the window too: without --window-size it fails
//   outright with "Position out of bounds", which is how the trap was found.)
// Usage: node req129-round6-wheel-harness.mjs <port> <workflow> <runId> <outJson> <pngDir>
import puppeteer from '/home/user/Documents/remote-workflow/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) for (const l of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = join(root, rev, l); if (existsSync(p)) return p; }
  return null;
}
const [, , PORT, WF, RUN, OUT, PNGDIR] = process.argv;
const R = { port: PORT, workflow: WF, runId: RUN, at: new Date().toISOString() };
const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox', '--window-size=1120,960'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
const cdp = await page.createCDPSession();
const wheelUp = (x, y) => cdp.send('Input.synthesizeScrollGesture', { x: Math.round(x), y: Math.round(y), yDistance: 120, gestureSourceType: 'mouse', speed: 800 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the author figure ───────────────────────────────────────────────────────────────────────────
await page.goto(`http://127.0.0.1:${PORT}/dashboard`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.card');
await page.evaluate((wf) => [...document.querySelectorAll('.card')].find((x) => (x.querySelector('.t') || {}).textContent === wf).click(), WF);
await page.waitForFunction(() => {
  const z = document.getElementById('diagram-zoom');
  const i = document.getElementById('diagram-img');
  return z && getComputedStyle(z).display !== 'none' && i && i.naturalWidth > 0;
}, { timeout: 30000 });
await wait(1500);
const atf = () => page.evaluate(() => document.getElementById('diagram-zoom').style.transform);
// point INSIDE the figure and inside the browser window: a tall (TD) figure's own centre can sit
// below the window, and both wheel APIs validate against the window ("Position out of bounds").
const abox = await page.evaluate(() => {
  const r = document.getElementById('diagram-img').getBoundingClientRect();
  const top = Math.max(r.y, 0), bottom = Math.min(r.y + r.height, window.innerHeight);
  return { cx: r.x + r.width / 2, cy: Math.min((top + bottom) / 2, 850) };
});
R.author = { box: abox, before: await atf() };
// (a) the tool artefact, recorded so the next round does not re-discover it
await page.mouse.move(abox.cx, abox.cy);
await page.mouse.wheel({ deltaY: -120 });
await wait(300);
R.author.afterRawMouseWheel = await atf();
R.author.pageScrollAfterRawMouseWheel = await page.evaluate(() => window.scrollY);
R.author.documentIsScrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
// (b) the real thing
await wheelUp(abox.cx, abox.cy);
await wait(600);
R.author.afterSynthesizedWheel = await atf();
R.author.pageScrollAfterSynthesizedWheel = await page.evaluate(() => window.scrollY);
await page.screenshot({ path: join(PNGDIR, 'req129-round6-author-wheel-zoomed.png') });
// (c) Fit resets it, by a REAL trusted mouse click. A TD figure is ~2300 px tall, so its Fit
//     control sits below the fold — scroll to it exactly as a human would, then click for real.
await page.evaluate(() => document.getElementById('diagram-fit').scrollIntoView({ block: 'center' }));
await wait(400);
const abtn = await page.evaluate(() => {
  const r = document.getElementById('diagram-fit').getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const el = document.elementFromPoint(cx, cy);
  return { cx, cy, hit: el ? el.tagName + '#' + el.id : null };
});
R.author.fitHit = abtn.hit;
await page.evaluate(() => { window.__h = []; document.getElementById('diagram-fit').addEventListener('click', (e) => window.__h.push({ trusted: e.isTrusted })); });
await page.mouse.click(abtn.cx, abtn.cy);
await wait(300);
R.author.fitClick = await page.evaluate(() => window.__h);
R.author.afterFit = await atf();
await page.screenshot({ path: join(PNGDIR, 'req129-round6-author-after-fit.png') });
// (d) control: the same gesture over a plain area of the same page DOES scroll it
await page.evaluate(() => window.scrollTo(0, 0));
await cdp.send('Input.synthesizeScrollGesture', { x: 900, y: 200, yDistance: -200, gestureSourceType: 'mouse', speed: 800 });
await wait(600);
R.author.controlPlainAreaScrollY = await page.evaluate(() => window.scrollY);

// ── the run DAG ─────────────────────────────────────────────────────────────────────────────────
await page.goto(`http://127.0.0.1:${PORT}/dashboard/${RUN}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => { const s = document.getElementById('dag-graph'); return s && s.childElementCount > 0; }, { timeout: 20000 });
await wait(800);
const dtf = () => page.evaluate(() => document.getElementById('dag-zoom').style.transform);
const dbox = await page.evaluate(() => { const r = document.getElementById('dag-graph').getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
R.dag = { box: dbox, before: await dtf() };
await wheelUp(dbox.cx, dbox.cy);
await wait(600);
R.dag.afterSynthesizedWheel = await dtf();
await page.screenshot({ path: join(PNGDIR, 'req129-round6-dag-wheel-zoomed.png') });
const dbtn = await page.evaluate(() => { const r = document.getElementById('dag-fit').getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
await page.evaluate(() => { window.__h2 = []; document.getElementById('dag-fit').addEventListener('click', (e) => window.__h2.push({ trusted: e.isTrusted, target: e.target.id })); });
await page.mouse.click(dbtn.cx, dbtn.cy);
await wait(300);
R.dag.fitClick = await page.evaluate(() => window.__h2);
R.dag.afterFit = await dtf();

await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
