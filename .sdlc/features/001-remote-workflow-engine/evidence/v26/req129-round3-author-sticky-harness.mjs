// After a drag attempt on the author figure, does the figure follow the mouse with NO button held?
import puppeteer from '/home/user/Documents/remote-workflow/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [, , PORT, WF, HEADLESS, OUT] = process.argv;
function findChrome(){const root=join(homedir(),'.cache','puppeteer','chrome');for(const rev of readdirSync(root))for(const l of ['chrome-linux64/chrome','chrome-linux/chrome']){const p=join(root,rev,l);if(existsSync(p))return p;}return null;}
const headless = HEADLESS === 'false' ? false : 'new';
const R = { headless: String(headless), at: new Date().toISOString(), port: PORT, workflow: WF };
const browser = await puppeteer.launch({ headless, executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
await page.goto(`http://127.0.0.1:${PORT}/dashboard`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.card');
await page.evaluate((wf)=>[...document.querySelectorAll('.card')].find(x=>(x.querySelector('.t')||{}).textContent===wf).click(), WF);
await page.waitForFunction(()=>{const z=document.getElementById('diagram-zoom');const i=document.getElementById('diagram-img');return z&&getComputedStyle(z).display!=='none'&&i&&i.naturalWidth>0;},{timeout:20000});
await new Promise(r=>setTimeout(r,500));
const tf=()=>page.evaluate(()=>document.getElementById('diagram-zoom').style.transform);
await page.evaluate(()=>{window.__drag=[];document.addEventListener('dragstart',e=>window.__drag.push('dragstart:'+(e.target.id||e.target.tagName)),true);document.addEventListener('mouseup',()=>window.__drag.push('mouseup'),true);document.addEventListener('dragend',()=>window.__drag.push('dragend'),true);});
const img = await page.evaluate(()=>{const b=document.getElementById('diagram-img').getBoundingClientRect();return {cx:Math.round(b.left+b.width/2),cy:Math.round(b.top+b.height/2)};});
R.transformInitial = await tf();
await page.mouse.move(img.cx, img.cy);
await page.mouse.down();
for (let i=1;i<=8;i++){ await page.mouse.move(img.cx-i*20, img.cy-i*10); await new Promise(r=>setTimeout(r,40)); }
await page.mouse.up();
await new Promise(r=>setTimeout(r,300));
R.gestureRequested={dx:-160,dy:-80};
R.transformAfterDragGesture = await tf();
R.eventsDuringGesture = await page.evaluate(()=>window.__drag);
// mouse is now UP. Move it around with no button pressed:
await page.mouse.move(img.cx+200, img.cy+100); await new Promise(r=>setTimeout(r,150));
R.transformAfterMouseMoveWithNoButton = await tf();
await page.mouse.move(img.cx-300, img.cy-150); await new Promise(r=>setTimeout(r,150));
R.transformAfterSecondMouseMoveWithNoButton = await tf();
await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify(R,null,1));
console.log(JSON.stringify(R,null,1));
