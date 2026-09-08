// v11 Sprint 2 (DES-061 / TASK-064): dashboard update panel — server-side injects a JSON init
// block with the last update outcome so the static HTML contains the status text (e.g. "applied",
// "failed") in a way that plain-fetch CI tests can assert without running the SPA's JS. The panel
// is rendered client-side (textContent-only, XSS-safe) from the injected window.__RWE_INIT__ var.
import type { UpdateOutcome } from './update-types.js';
import { UTIL_PCT_CONVENTION } from './system-info.js';
import { DAG_BOX_DEFAULTS } from './dashboard.js';

// ─── DES-065 (TASK-068): pure logical→pixel mapper + Morandi palette ─────────────────────────────

/** Logical grid cell from the layout engine. */
export interface LayoutCell { col: number; row: number; laneSpan: number }
/** Box dimensions shared between server and browser (one constant controls the visual rhythm). */
export interface BoxSize { cellW: number; cellH: number; gap: number }
/** Screen-space rectangle returned by cellToPixel. */
export interface Rect { x: number; y: number; width: number; height: number }

/** Morandi muted palette — one hue per frame; lives as a CSS-custom-property set so a single
 *  file swap reskins the graph without touching model/topology code. */
const MORANDI_PALETTE = [
  '#b5c4b1', '#c4b5b5', '#b5b9c4', '#c4c0b5', '#b5c4c0',
  '#c8b8b8', '#b8c8c4', '#c4c8b8', '#b8bec8', '#c8c4b8',
];

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Pure logical→pixel mapper. The only place logical grid coordinates become screen geometry;
 *  a box-size restyle (cellW/cellH/gap) touches zero model or topology tests. */
export function cellToPixel(cell: LayoutCell, box: BoxSize): Rect {
  return {
    x: cell.col * (box.cellW + box.gap),
    y: cell.row * (box.cellH + box.gap),
    width: box.cellW,
    height: cell.laneSpan * box.cellH + (cell.laneSpan - 1) * box.gap,
  };
}

/** Pure per-frame hue selector — same frame string always returns the same palette entry (no
 *  flicker across the 3s poll). Two different frames may hash to the same hue by design. */
export function morandiFrameHue(frame: string): string {
  return MORANDI_PALETTE[stableHash(frame) % MORANDI_PALETTE.length]!;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Build the dashboard HTML, optionally injecting a server-side update outcome.
 * When lastUpdate is provided the init JSON is embedded in a <script> block so:
 *   - CI tests: `html.toContain('applied')` passes (the JSON contains the status word).
 *   - Headless browser: the inline script renders the update panel in the header.
 */
export function buildDashboardHtml(init?: { lastUpdate?: UpdateOutcome | null; interruptedRuns?: number }): string {
  if (!init?.lastUpdate) return DASHBOARD_HTML;
  // Escape `<` to avoid breaking out of the <script> block (KP-12 XSS mandate, DES-061).
  const initJson = JSON.stringify(init).replace(/</g, '\\u003c');
  // Inject a minimal update-panel renderer before </body>. All user content via textContent.
  const panelScript = `<script>
(function(){
var i=(${initJson});
var u=i&&i.lastUpdate;
if(!u)return;
var h=document.querySelector('header');
if(!h)return;
var p=document.createElement('span');
p.id='rwe-update-panel';
p.style.cssText='font-size:12px;margin-left:auto;padding:0 8px';
var clr={pending:'#d29922',applied:'#3fb950',failed:'#f85149',skipped:'#8b97a6'};
p.style.color=clr[u.status]||'inherit';
p.textContent='update '+u.tag+': '+u.status;
if(u.detail){var d=document.createElement('pre');d.style.cssText='margin:2px 0;font-size:10px';d.textContent=u.detail;p.appendChild(d);}
// v26 (DES-172, TASK-172): configCheck — VISIBLE text, never a silent 'skipped'; the guard means
// an absent key (a pre-v26 result file) renders nothing rather than a stray literal.
if(u.configCheck){var cc=document.createElement('span');cc.style.cssText='margin-left:6px;font-size:11px;color:#8b97a6';cc.textContent='config check: '+u.configCheck;p.appendChild(cc);}
// DES-061: call-to-action when applied + interrupted runs (update caused restart mid-run).
if(u.status==='applied'&&i.interruptedRuns>0){var c=document.createElement('span');c.style.cssText='margin-left:8px;font-size:11px;color:#d29922';c.textContent=i.interruptedRuns+' run(s) interrupted by the update; use workflow_resume';p.appendChild(c);}
h.appendChild(p);
})();
</script>
</body>`;
  return DASHBOARD_HTML.replace('</body>', panelScript);
}

// Static browser dashboard page (DES-018 / REQ-008; v8 Slice 3 REQ-049 upgrade): a self-contained
// HTML/JS page served at GET /dashboard on the SAME server/port as /mcp and /api/* (server.ts's
// single createHttpServer handler). One data model, two transports — this page's client JS calls the
// SAME read-only /api/* JSON the MCP tools share; never a parallel dashboard DTO. Client-side "SPA"
// routing: /dashboard/<runId> serves this exact page; its JS reads the runId from location.pathname
// and drills in via fetch(). v8 Slice 3 adds: registered-workflow + run CARDS on the home view, and a
// nested DAG (from /api/runs/:id/dag, backed by buildDagModel) where composite sub-workflows render as
// labeled groups of state-colored agent nodes; clicking an agent node loads its transcript. 3s poll.
// v11 (REQ-067): /dashboard/issues — read-only Issues view (Open/Resolved groups, click-to-detail).
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Remote Workflow Engine — Dashboard</title>
<style>
/* REQ-071: Morandi light theme — muted, low-saturation warm neutrals + soft dusty accents (not the
   old dark palette; the graph, cards and frame tints all read off these tokens). */
:root{--bg:#E9E6DF;--panel:#F2EFE8;--panel2:#E2DED4;--line:#CFC9BC;--ink:#4A4842;--muted:#8C877B;--link:#7D93A6}
body{font-family:-apple-system,Segoe UI,sans-serif;margin:0;background:var(--bg);color:var(--ink)}
header{padding:16px 24px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:24px}
h1{font-size:18px;margin:0}h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 10px}
main{padding:16px 24px;max-width:1100px}
a{color:var(--link);text-decoration:none}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px 13px;font-size:13px;cursor:pointer}
.card:hover{border-color:var(--link)}
.card .t{font-weight:600;font-family:ui-monospace,Consolas,monospace;word-break:break-all}
.card .s{color:var(--muted);font-size:11.5px;margin-top:4px}
.pill{display:inline-block;padding:1px 7px;border-radius:100px;font-size:11px;border:1px solid var(--line)}
/* Morandi-muted semantic state colours (low-saturation, legible on the light greige ground). */
.st-queued{color:#B08A5B}.st-running{color:#6E8199}.st-done,.st-completed{color:#7A9078}.st-failed{color:#B0776E}.st-stopped,.st-suspended{color:#9A948A}.st-interrupted{color:#B08A5B}
#diagram-img{max-width:100%;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px;margin:6px 0}
/* v26 (DES-186, ARCH-120, ADR-044, TASK-191, REQ-129): one .zoomable wrapper serves BOTH the run
   DAG svg and the author's diagram img — the wheel/drag transform lives HERE, never on the SVG
   children renderGraph() rebuilds every 3s poll, so a user's zoom never snaps back. */
.zoomable{transform-origin:0 0;touch-action:none}
.fit-btn{font-size:11px;padding:2px 9px;border-radius:100px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;margin:4px 0}
.fit-btn:hover{border-color:var(--link)}
#tree{margin-top:6px}
.grp{border-left:2px solid var(--line);margin:6px 0 6px 4px;padding:2px 0 2px 12px}
.grp-h{font-size:12px;color:var(--muted);margin:4px 0}
.grp-h b{color:var(--ink);font-family:ui-monospace,Consolas,monospace}
.node{padding:5px 9px;margin:4px 0;background:var(--panel2);border:1px solid var(--line);border-radius:8px;font-size:12.5px;cursor:pointer;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.node:hover{border-color:var(--link)}
.node .dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:none}
.node .lbl{font-weight:600}.node .mdl{color:var(--muted);font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
.node .tok{color:var(--muted);font-size:11px;margin-left:auto}
.node .cost{color:var(--muted);font-size:11px}
.node .unpriced{color:var(--warn,#B08A5B);font-size:10.5px}
.node .dur{color:var(--muted);font-size:11px}
/* v26 (DES-183, TASK-183, REQ-127): the run-level usage summary — token/USD total, the unpriced-
   call count and a "lower bound" qualifier whenever costUSD cannot be the whole story. */
#run-usage{margin:2px 0 8px;font-size:11.5px;color:var(--muted)}
#run-usage span{margin-right:12px}
#run-usage .usage-lowerbound{color:var(--warn,#B08A5B)}
#phases{margin:8px 0 4px}
.ph-lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-right:6px}
.phase{display:inline-block;padding:2px 9px;margin:2px 5px 2px 0;border-radius:100px;border:1px solid var(--line);font-size:11.5px;color:var(--muted)}
.phase.cur{border-color:var(--link);color:var(--link);font-weight:600}
pre{white-space:pre-wrap;background:var(--panel2);border:1px solid var(--line);padding:12px;border-radius:8px;max-height:340px;overflow:auto;font-size:12px}
.back{font-size:13px}
.empty{color:var(--muted);font-size:12.5px}
.issue-row{display:flex;align-items:baseline;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px;cursor:pointer}
.issue-row:hover .issue-title{color:var(--link)}
.issue-num{color:var(--muted);font-family:ui-monospace,Consolas,monospace;min-width:40px}
.issue-title{flex:1}
.issue-lbl{font-size:11px;padding:1px 6px;border-radius:100px;border:1px solid var(--line);color:var(--muted)}
.issue-detail{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px;margin-top:10px;font-size:13px}
.issue-detail pre{max-height:200px}
.degraded{color:var(--muted);font-size:12.5px;font-style:italic}
.sys-table,.models-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}
.sys-table td,.models-table td,.models-table th{padding:4px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.sys-table td:first-child{color:var(--muted);font-size:11px;width:140px}
.models-table th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
</style>
</head>
<body>
<header>
  <h1>Remote Workflow Engine — Live Dashboard</h1>
  <a href="/dashboard">Runs</a>
  <a href="/dashboard/issues">Issues</a>
</header>
<main>
  <section id="home">
    <h2>Running</h2>
    <div id="home-running" class="cards"></div>
    <h2>Registered</h2>
    <div id="home-registered" class="cards"></div>
    <h2>Other</h2>
    <div id="home-other" class="cards"></div>
    <h2>System</h2>
    <div id="system-panel"></div>
    <h2>Models</h2>
    <div id="models-panel"></div>
  </section>
  <section id="detail" style="display:none">
    <p><a class="back" href="/dashboard">&larr; all runs</a></p>
    <h2>Run <span id="detail-runid"></span> <span id="detail-status" class="pill"></span></h2>
    <div id="phases"></div>
    <div id="run-usage"></div>
    <div id="graph-container" style="overflow:hidden;height:420px;margin:10px 0">
      <button type="button" id="dag-fit" class="fit-btn">Fit</button>
      <div id="dag-zoom" class="zoomable">
        <svg id="dag-graph" xmlns="http://www.w3.org/2000/svg" style="display:block"></svg>
      </div>
    </div>
    <div id="tree"></div>
    <!-- The diagram figure has no separate clipping ancestor (unlike #graph-container above): a
         zoomed-in author SVG may spill past this pane's edge — accepted, Gate 7.5 tracks it. -->
    <div id="diagram-zoom" class="zoomable" style="display:none">
      <img id="diagram-img" alt="workflow diagram">
    </div>
    <button type="button" id="diagram-fit" class="fit-btn" style="display:none">Fit</button>
    <pre id="diagram" style="display:none"></pre>
    <p id="mermaidNote" style="display:none"></p>
    <div id="harness-table-section" style="display:none">
      <h2>Agents</h2>
      <div id="harness-table"></div>
    </div>
    <h2>Transcript <span id="tr-agent" class="mdl"></span></h2>
    <pre id="transcript">Select an agent node above.</pre>
  </section>
  <section id="issues" style="display:none">
    <p><a class="back" href="/dashboard">&larr; runs</a></p>
    <h2>Open</h2>
    <div id="issues-open"></div>
    <h2>Resolved</h2>
    <div id="issues-resolved"></div>
    <div id="issue-detail" style="display:none" class="issue-detail">
      <p id="issue-detail-meta"></p>
      <p><a id="issue-detail-link" href="#" target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a></p>
      <pre id="issue-detail-body"></pre>
    </div>
  </section>
</main>
<script>
function el(tag, cls, txt){ var e=document.createElement(tag); if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e; }
// v11: special-case 'issues' so /dashboard/issues is the Issues view, NOT a run id fed to /api/runs/issues/dag.
function currentRunId(){ var m=/^\\/dashboard\\/(.+)$/.exec(location.pathname); var id=m?decodeURIComponent(m[1]):null; return (id==='issues')?null:id; }
function isIssuesView(){ var m=/^\\/dashboard\\/(.+)$/.exec(location.pathname); return m?decodeURIComponent(m[1])==='issues':false; }
function go(runId){ history.pushState(null,'','/dashboard/'+encodeURIComponent(runId)); render(); }
window.addEventListener('popstate', render);

async function getJSON(u){ try{ var r=await fetch(u); if(!r.ok) return null; return await r.json(); }catch(e){ return null; } }

// v24 (DES-156, TASK-149): a workflow's public description — the author-supplied Mermaid source
// (stored verbatim, never rendered client-side — no Mermaid library ships here, ADR-033) replaces
// the v23 analyzer-drawn ASCII diagram / its ready-pending-unavailable polling. currentWorkflowName is re-read by
// render() on every 3s tick (no new timer), so a re-registered mermaid string appears within the
// existing poll — there is no separate pending/ready state to branch on any more.
var currentWorkflowName=null;
function showDescribe(name){
  currentWorkflowName=name;
  document.getElementById('home').style.display='none'; document.getElementById('detail').style.display='block';
  document.getElementById('tree').innerHTML='';
  renderDescribe(name);
}
async function renderDescribe(name){
  var s=await getJSON('/api/workflows/'+encodeURIComponent(name)+'/describe'); if(!s) return;
  document.getElementById('detail-runid').textContent='workflow: '+name;
  var badge=document.getElementById('detail-status'); badge.textContent=s.runnable?'runnable':(s.runnableReason||''); badge.className='pill';
  renderPhases([], ''); document.getElementById('transcript').textContent=s.description||'(no description)';
  var pre=document.getElementById('diagram'); var note=document.getElementById('mermaidNote');
  pre.textContent=s.mermaid||'';
  if(s.mermaid){ renderDiagram(name, s.version); }
  else {
    // Nothing to draw (a legacy row): the honest note, and no request to the render route.
    diagramKey=null; document.getElementById('diagram-zoom').style.display='none'; document.getElementById('diagram-fit').style.display='none';
    pre.style.display='block'; note.style.display='block'; note.textContent=s.mermaidNote||'';
  }
  await renderHarnessTable(s.params&&s.params.agents);
}
// v26 (DES-184, ARCH-119, TASK-192, REQ-128/REQ-110): one row per params.agents.<label> — label /
// declared model -> resolved model / effort / timeoutMs / tools, every cell via textContent (no
// innerHTML on any run- or author-derived string). "resolved model" joins the declared alias
// against the SAME /api/models catalog the Models panel already fetches (ModelEntry.alias, DES-076)
// — the live alias->provider/model resolution, never a fabricated value. re-entrant: renderDescribe
// re-runs on every 3s tick, so this clears+rebuilds rather than appending.
async function renderHarnessTable(agents){
  var section=document.getElementById('harness-table-section');
  var box=document.getElementById('harness-table');
  box.innerHTML='';
  var labels=agents?Object.keys(agents):[];
  if(!labels.length){ section.style.display='none'; return; }
  section.style.display='block';
  var models=await getJSON('/api/models');
  var byAlias={};
  if(models&&Array.isArray(models)){ models.forEach(function(m){ if(m.alias) byAlias[m.alias]=m; }); }
  function cellText(spec,key){ return spec&&spec[key]&&spec[key].default!=null?String(spec[key].default):'—'; }
  var t=document.createElement('table'); t.className='models-table';
  var thead=document.createElement('thead'); var hrow=document.createElement('tr');
  ['label','declared model','resolved model','effort','timeoutMs','tools'].forEach(function(h){ var th=document.createElement('th'); th.textContent=h; hrow.appendChild(th); });
  thead.appendChild(hrow); t.appendChild(thead);
  var tbody=document.createElement('tbody');
  labels.forEach(function(label){
    var spec=agents[label]||{};
    var declared=cellText(spec,'model');
    var resolvedEntry=byAlias[declared];
    var resolved=resolvedEntry?(resolvedEntry.provider+'/'+resolvedEntry.model):'—';
    var tr=document.createElement('tr');
    function td(v){ var c=document.createElement('td'); c.textContent=v; return c; }
    tr.appendChild(td(label));
    tr.appendChild(td(declared));
    tr.appendChild(td(resolved));
    tr.appendChild(td(cellText(spec,'effort')));
    tr.appendChild(td(cellText(spec,'timeoutMs')));
    // tools: not exposed by workflow_describe's params.agents today (DES-156/workflow-view.ts,
    // outside this task's file scope) — the honest absence, not a fabricated value.
    tr.appendChild(td('—'));
    tbody.appendChild(tr);
  });
  t.appendChild(tbody); box.appendChild(t);
}
// v25 (REQ-119, DES-166, TASK-166): the PICTURE. It is rendered SERVER-SIDE and arrives as an
// image/svg+xml, loaded into an <img> tag — never an object or embed element, which load an SVG as
// a DOCUMENT and would execute script inside it (UT-169 greps this file for those two tag names, so
// they are named in prose here deliberately). That is how REQ-119 keeps both of ADR-033's reasons
// while overruling its display decision: no author-controlled text reaches an HTML renderer here,
// and no Mermaid library is shipped to the client (UT-161's grep guard is untouched).
// Memoized on (name, version): render() re-enters this on every 3s tick, and a version's diagram is
// immutable (REQ-111), so one fetch per version per viewer is exactly right. A failure is memoized
// too — the fallback below is already showing the source, and re-asking every 3s would hammer an
// anonymous, render-capable route.
var diagramKey=null, diagramUrl=null;
function hideDiagram(){
  diagramKey=null;
  var img=document.getElementById('diagram-img'); img.removeAttribute('src');
  document.getElementById('diagram-zoom').style.display='none'; document.getElementById('diagram-fit').style.display='none';
  if(diagramUrl){ URL.revokeObjectURL(diagramUrl); diagramUrl=null; }
  document.getElementById('diagram').style.display='none';
  document.getElementById('mermaidNote').style.display='none';
}
async function renderDiagram(name, version){
  var key=name+'@'+version;
  if(diagramKey===key) return;
  diagramKey=key;
  var img=document.getElementById('diagram-img'); var pre=document.getElementById('diagram'); var note=document.getElementById('mermaidNote');
  pre.style.display='block'; // the source is visible while the first render is in flight
  var r=null; try{ r=await fetch('/api/workflows/'+encodeURIComponent(name)+'/diagram.svg?version='+encodeURIComponent(version)); }catch(e){ r=null; }
  if(r&&r.ok){
    var blob=await r.blob();
    if(diagramUrl) URL.revokeObjectURL(diagramUrl);
    diagramUrl=URL.createObjectURL(blob);
    img.src=diagramUrl; document.getElementById('diagram-zoom').style.display='block'; document.getElementById('diagram-fit').style.display='inline-block';
    pre.style.display='none'; note.style.display='none';
    return;
  }
  // Degrade to the pre-v25 display with an observable reason — never a blank pane.
  var reason='unreachable';
  try{ var j=r?await r.json():null; if(j&&j.reason) reason=j.reason; }catch(e){}
  img.removeAttribute('src'); document.getElementById('diagram-zoom').style.display='none'; document.getElementById('diagram-fit').style.display='none';
  note.style.display='block'; note.textContent='diagram not rendered ('+reason+') — showing the source';
}
// v11 F1 (REQ-074/075, DES-070/071): home view — 3-way grouped cards with metrics.
function fmtMetric(val,suffix){ return val==null?'—':Math.round(val)+suffix; }
// v23 (DES-133, owner decision A1): honest absence, no fallback drawing — the old node-array
// SVG preview is gone (no structured shape survives to the client), and the /describe fetch that
// briefly replaced it is DELETED too (ARCH-084 A4): it discarded every response, so each card was
// costing one request per 3s tick for nothing. No mini-preview until one is designed.
function renderHomeGroup(box,cards){
  box.innerHTML='';
  if(!cards||!cards.length){ box.appendChild(el('div','empty','(none)')); return; }
  cards.forEach(function(card){
    var c=el('div','card');
    c.appendChild(el('div','t',card.name||'(inline)'));
    if(card.description) c.appendChild(el('div','s',card.description));
    var m=card.metrics||{successRate:null,avgDurationMs:null,terminalCount:0};
    var ms=el('div','s');
    ms.textContent='sr: '+fmtMetric(m.successRate!=null?Math.round(m.successRate*100):null,'%')+' · avg: '+fmtMetric(m.avgDurationMs,'ms')+' · runs: '+m.terminalCount;
    c.appendChild(ms);
    if(card.activeRunId){ var aid=card.activeRunId; c.onclick=function(){ go(aid); }; }
    else if(card.name){ var cname=card.name; c.onclick=function(){ showDescribe(cname); }; }
    else if(card.latestRunId){ var lid=card.latestRunId; c.onclick=function(){ go(lid); }; }
    box.appendChild(c);
  });
}
// DES-073: System panel — renders GET /api/system via the 3s poll, textContent-only (KP-12).
function fmtBytes(b){ if(b>=1e9)return (b/1e9).toFixed(1)+' GB'; if(b>=1e6)return (b/1e6).toFixed(1)+' MB'; if(b>=1e3)return (b/1e3).toFixed(1)+' KB'; return b+' B'; }
async function loadSystem(){
  var box=document.getElementById('system-panel'); if(!box) return;
  var data=await getJSON('/api/system'); if(!data){ box.textContent='(unavailable)'; return; }
  var t=document.createElement('table'); t.className='sys-table';
  function sysRow(k,v){ var tr=document.createElement('tr'); var td1=document.createElement('td'); td1.textContent=k; var td2=document.createElement('td'); td2.textContent=String(v!=null?v:'—'); tr.appendChild(td1); tr.appendChild(td2); return tr; }
  t.appendChild(sysRow('cpu cores',data.cpu.cores));
  t.appendChild(sysRow('load avg 1m/5m/15m',data.cpu.loadAvg.map(function(v){return v.toFixed(2);}).join(' / ')));
  var utilStr=data.cpu.utilizationPct!=null ? data.cpu.utilizationPct.toFixed(1)+'%' : ('— ('+((data.cpu.utilizationDegraded&&data.cpu.utilizationDegraded.reason)||'degraded')+')');
  t.appendChild(sysRow('cpu util ('+UTIL_PCT_CONVENTION+')',utilStr));
  if(data.memory&&!('reason' in data.memory)){ t.appendChild(sysRow('memory',fmtBytes(data.memory.usedBytes)+' / '+fmtBytes(data.memory.totalBytes)+' ('+data.memory.usedPct.toFixed(1)+'%)')); }
  else { t.appendChild(sysRow('memory','— ('+((data.memory&&data.memory.reason)||'degraded')+')')); }
  if(data.disk&&!('reason' in data.disk)){ t.appendChild(sysRow('disk '+data.disk.path,fmtBytes(data.disk.usedBytes)+' / '+fmtBytes(data.disk.totalBytes)+' ('+data.disk.usedPct.toFixed(1)+'%)')); }
  else { t.appendChild(sysRow('disk','— ('+((data.disk&&data.disk.reason)||'degraded')+')')); }
  t.appendChild(sysRow('sampled at',data.sampledAt));
  box.innerHTML=''; box.appendChild(t);
}
// DES-076: Models section — columns provider|model|capability|stability|costLevel|modalities (KP-12).
async function loadModels(){
  var box=document.getElementById('models-panel'); if(!box) return;
  var entries=await getJSON('/api/models');
  if(!entries||!Array.isArray(entries)){ box.textContent='(unavailable)'; return; }
  box.innerHTML='';
  if(!entries.length){ box.appendChild(el('div','empty','(no models)')); return; }
  var t=document.createElement('table'); t.className='models-table';
  var thead=document.createElement('thead'); var hrow=document.createElement('tr');
  ['provider','model','capability','stability','costLevel','modalities'].forEach(function(h){ var th=document.createElement('th'); th.textContent=h; hrow.appendChild(th); });
  thead.appendChild(hrow); t.appendChild(thead);
  var tbody=document.createElement('tbody');
  entries.forEach(function(e){
    var tr=document.createElement('tr');
    function td(v){ var c=document.createElement('td'); c.textContent=v!=null?String(v):'—'; return c; }
    tr.appendChild(td(e.provider));
    tr.appendChild(td(e.model));
    tr.appendChild(td(e.capability));
    tr.appendChild(td(e.stability));
    tr.appendChild(td(e.costLevel!=null?String(e.costLevel):'—'));
    var ins=(e.modalities&&e.modalities.in?e.modalities.in.join(','):'?');
    var outs=(e.modalities&&e.modalities.out?e.modalities.out.join(','):'?');
    tr.appendChild(td(ins+' → '+outs));
    tbody.appendChild(tr);
  });
  t.appendChild(tbody); box.appendChild(t);
}
async function loadHome(){
  var home=await getJSON('/api/home');
  if(!home) home={running:[],registered:[],other:[]};
  renderHomeGroup(document.getElementById('home-running'),home.running);
  renderHomeGroup(document.getElementById('home-registered'),home.registered);
  renderHomeGroup(document.getElementById('home-other'),home.other);
  await loadSystem();
  await loadModels();
}

async function loadTranscript(runId, agentId, label){
  document.getElementById('tr-agent').textContent = label?('· '+label+' ('+agentId+')'):('· '+agentId);
  var ev=await getJSON('/api/runs/'+encodeURIComponent(runId)+'/agents/'+encodeURIComponent(agentId));
  document.getElementById('transcript').textContent = ev? JSON.stringify(ev,null,2) : '(no transcript)';
}

// v26 (DES-180, TASK-180): mirrors run-guard.ts's sumTokens (same duplication convention as
// cellToPixelLocal above) — DagAgentNode.tokens already arrives as the server-summed four-column
// total (a plain number, dashboard.ts's buildDagModel), so the object branch here is a defensive
// guard against the exact widening trap DES-180 names ([object Object] tok), not the common case.
function sumTokens(t){ return (t&&typeof t==='object') ? ((t.input||0)+(t.output||0)+(t.cacheRead||0)+(t.cacheWrite||0)) : (t||0); }
function renderAgent(runId, a){
  var n=el('div','node st-'+a.state); n.appendChild(el('span','dot'));
  n.appendChild(el('span','lbl',a.label||a.agentId));
  n.appendChild(el('span','mdl',a.model||'—'));
  n.appendChild(el('span','st-'+a.state,a.state));
  n.appendChild(el('span','tok',sumTokens(a.tokens)+' tok'));
  n.appendChild(el('span','cost','$'+(a.costUSD||0).toFixed(4)));
  if(a.unpriced){ n.appendChild(el('span','unpriced','(unpriced)')); }
  if(a.durationMs!=null){ n.appendChild(el('span','dur',a.durationMs+' ms')); }
  n.onclick=function(){ loadTranscript(runId,a.agentId,a.label); };
  return n;
}
// v8 Slice 2b: phase timeline — the last chip is the current step while the run is still running.
function renderPhases(phases, status){
  var box=document.getElementById('phases'); box.innerHTML='';
  if(!phases.length) return;
  box.appendChild(el('span','ph-lbl','steps'));
  phases.forEach(function(p,i){
    var cur=(status==='running' && i===phases.length-1);
    var c=el('span','phase'+(cur?' cur':''), p.title); if(p.ts) c.title=p.ts; box.appendChild(c);
  });
}
// v26 (DES-183, TASK-183, REQ-127): the run-level usage summary — token/USD total, the unpriced-
// call count and a "lower bound" qualifier whenever unpricedCalls > 0 (costUSD then undercounts).
function renderUsage(usage){
  var box=document.getElementById('run-usage'); box.innerHTML='';
  if(!usage) return;
  box.appendChild(el('span','usage-tok',sumTokens(usage.tokens)+' tok'));
  box.appendChild(el('span','usage-cost','$'+(usage.costUSD||0).toFixed(4)));
  if(usage.unpricedCalls>0){
    box.appendChild(el('span','usage-unpriced',usage.unpricedCalls+' unpriced call(s)'));
    box.appendChild(el('span','usage-lowerbound','(lower bound)'));
  }
  var unmappedNames=Object.keys(usage.unmappedMessages||{});
  if(unmappedNames.length){
    box.appendChild(el('span','usage-unmapped','unmapped: '+unmappedNames.map(function(k){ return k+'×'+usage.unmappedMessages[k]; }).join(', ')));
  }
}
// Recursively render a DagNode. Root: agents + children directly. Composite: a labeled group.
function renderNode(runId, node, container){
  (node.agents||[]).forEach(function(a){ container.appendChild(renderAgent(runId,a)); });
  (node.children||[]).forEach(function(child){
    var g=el('div','grp'); var h=el('div','grp-h'); h.appendChild(document.createTextNode('workflow ')); var b=el('b',null,child.name||child.frame); h.appendChild(b); h.appendChild(document.createTextNode(' · depth '+child.depth)); g.appendChild(h);
    renderNode(runId, child, g); container.appendChild(g);
  });
}

// DES-065 (TASK-068): Morandi palette + DES-073 util convention — derived from server-side TS constants.
var MORANDI_PALETTE=${JSON.stringify(MORANDI_PALETTE)};
var UTIL_PCT_CONVENTION=${JSON.stringify(UTIL_PCT_CONVENTION)};
// v26 (DES-186, TASK-191): the same cell-box numbers dagBox() (src/dashboard.ts) is unit-tested
// against — interpolated so the two can never drift, same pattern as MORANDI_PALETTE above.
var DAG_BOX=${JSON.stringify(DAG_BOX_DEFAULTS)};
function stableHash(s){ var h=0; for(var i=0;i<s.length;i++){ h=((Math.imul(31,h)+s.charCodeAt(i))>>>0); } return h; }
function morandiHue(frame){ return MORANDI_PALETTE[stableHash(frame)%MORANDI_PALETTE.length]; }
function cellToPixelLocal(cell,box){ return {x:cell.col*(box.cellW+box.gap),y:cell.row*(box.cellH+box.gap),width:box.cellW,height:cell.laneSpan*box.cellH+(cell.laneSpan-1)*box.gap}; }

// DES-065: render GraphPayload cells+edges as inline SVG (textContent-only for all run-derived strings).
function renderGraph(payload, runId){
  var svgEl=document.getElementById('dag-graph');
  svgEl.innerHTML='';
  var BOX=DAG_BOX;
  var cells=(payload.cells)||[];
  var edges=(payload.edges)||[];
  // No cells (the legacy DagNode/tree fallback, or a genuinely empty run) — hidden, not an empty
  // ~470px band of viewBox at width:100%; a REAL non-empty payload always sets 'block' below.
  svgEl.style.display=cells.length?'block':'none';
  if(!cells.length) return;
  // v26 (DES-186, ARCH-120, ADR-044, TASK-191, REQ-129): dagBox's own formula (src/dashboard.ts).
  var maxCol=0,maxRow=0,maxSpan=1;
  cells.forEach(function(c){ if(c.col>maxCol)maxCol=c.col; if(c.row>maxRow)maxRow=c.row; if(c.laneSpan>maxSpan)maxSpan=c.laneSpan; });
  var svgW=(maxCol+1)*(BOX.cellW+BOX.gap)+BOX.gap;
  var svgH=(maxRow+maxSpan)*(BOX.cellH+BOX.gap)+BOX.gap;
  // The run DAG scales with its container: viewBox + width:100% + preserveAspectRatio, NO absolute
  // pixel width/height (those would defeat the container-relative scaling REQ-129 asks for).
  svgEl.setAttribute('viewBox','0 0 '+svgW+' '+svgH);
  svgEl.setAttribute('width','100%');
  svgEl.setAttribute('preserveAspectRatio','xMinYMin meet');
  var ns='http://www.w3.org/2000/svg';
  // Edge layer (drawn first, behind nodes).
  edges.forEach(function(e){
    var from=cells.find(function(c){return c.id===e.from;}), to=cells.find(function(c){return c.id===e.to;});
    if(!from||!to) return;
    var fr=cellToPixelLocal(from,BOX), tr=cellToPixelLocal(to,BOX);
    var line=document.createElementNS(ns,'line');
    line.setAttribute('x1',String(fr.x+fr.width)); line.setAttribute('y1',String(fr.y+fr.height/2));
    line.setAttribute('x2',String(tr.x)); line.setAttribute('y2',String(tr.y+tr.height/2));
    line.setAttribute('stroke','#AAB4BC'); line.setAttribute('stroke-width','1.5');
    svgEl.appendChild(line);
  });
  // Node boxes.
  cells.forEach(function(c){
    var r=cellToPixelLocal(c,BOX);
    var g=document.createElementNS(ns,'g');
    // Frame tint (background rect for non-root frames).
    if(c.frame && c.frame!==''){
      var bg=document.createElementNS(ns,'rect');
      bg.setAttribute('x',String(r.x-3)); bg.setAttribute('y',String(r.y-3));
      bg.setAttribute('width',String(r.width+6)); bg.setAttribute('height',String(r.height+6));
      bg.setAttribute('rx','8'); bg.setAttribute('fill',morandiHue(c.frame)); bg.setAttribute('opacity','0.25');
      g.appendChild(bg);
    }
    var rect=document.createElementNS(ns,'rect');
    rect.setAttribute('x',String(r.x)); rect.setAttribute('y',String(r.y));
    rect.setAttribute('width',String(r.width)); rect.setAttribute('height',String(r.height));
    rect.setAttribute('rx','7');
    // Morandi light node fills; agents tinted by state so the graph reads at a glance.
    var sf={queued:'#ECE6DB',running:'#D7E0E6',done:'#DCE5DA',completed:'#DCE5DA',failed:'#ECDBD6',stopped:'#E4E0D7',suspended:'#E4E0D7',interrupted:'#ECE6DB'};
    var fill=c.kind==='trigger'?'#D6DEE6':c.kind==='agent'?(sf[c.state]||'#F2EFE8'):'#E6E2D9';
    rect.setAttribute('fill',fill); rect.setAttribute('stroke','#C4BDAE');
    g.appendChild(rect);
    // Label — textContent only (security invariant, DES-065).
    var label=document.createElementNS(ns,'text');
    label.setAttribute('x',String(r.x+8)); label.setAttribute('y',String(r.y+r.height/2+4));
    label.setAttribute('font-size','11'); label.setAttribute('fill','#4A4842');
    label.textContent=c.label||c.kind||'';
    g.appendChild(label);
    if(c.kind==='agent' && runId){
      g.style.cursor='pointer';
      g.onclick=function(){ loadTranscript(runId,c.agentId||c.id,c.label); };
    }
    svgEl.appendChild(g);
  });
  // Warnings badge.
  var warnings=(payload.warnings||[]);
  if(warnings.length){
    var warn=document.createElementNS(ns,'text');
    warn.setAttribute('x','4'); warn.setAttribute('y',String(svgH-4));
    warn.setAttribute('font-size','10'); warn.setAttribute('fill','#B08A5B');
    warn.textContent=warnings.length+' warning(s)';
    svgEl.appendChild(warn);
  }
}

async function loadDag(runId){
  document.getElementById('detail-runid').textContent=runId;
  // v25 (REQ-119, DES-166): #detail is ONE pane shared by the workflow view and the run view, so a
  // diagram left over from a previously-viewed workflow would sit above this run's DAG. The <pre>
  // had this defect since v24 and it was easy to miss; a 60KB picture is not, so it is closed here.
  hideDiagram();
  // v26 (DES-184, TASK-192): same shared-pane defect for the harness table — a previously-viewed
  // workflow's per-agent table must not linger above this run's DAG.
  document.getElementById('harness-table-section').style.display='none';
  document.getElementById('harness-table').innerHTML='';
  var view=await getJSON('/api/runs/'+encodeURIComponent(runId));
  var status=view?view.status:'';
  var badge=document.getElementById('detail-status'); badge.textContent=status; badge.className='pill st-'+status;
  renderPhases((view&&view.phases)||[], status);
  renderUsage(view&&view.usage);
  var payload=await getJSON('/api/runs/'+encodeURIComponent(runId)+'/dag');
  // Handle both the new GraphPayload (kind:'run') and the legacy DagNode (kind:'root').
  if(payload && payload.kind==='run'){
    renderGraph(payload, runId);
    var tree=document.getElementById('tree'); tree.innerHTML='';
  } else {
    // v26 (DES-186): the legacy DagNode/tree fallback has no cells — reuse renderGraph's own empty
    // path so the SVG resets to the same non-zero minimum viewBox (never the old width='0' vanish).
    renderGraph({cells:[],edges:[],warnings:[]}, runId);
    var tree=document.getElementById('tree'); tree.innerHTML='';
    if(!payload){ tree.appendChild(el('div','empty','(run not found)')); return; }
    if(!(payload.agents||[]).length && !(payload.children||[]).length){ tree.appendChild(el('div','empty','(no agents yet)')); }
    renderNode(runId, payload, tree);
  }
}

// v11 (REQ-067): render a list of issue summaries in a container (XSS-safe: textContent only).
function renderIssueList(issues, container){
  container.innerHTML='';
  if(!issues||!issues.length){ container.appendChild(el('div','empty','(none)')); return; }
  issues.forEach(function(iss){
    var row=el('div','issue-row');
    row.appendChild(el('span','issue-num','#'+iss.number));
    row.appendChild(el('span','issue-title',iss.title));
    // Show severity from labels (e.g. "severity:high") as a pill.
    (iss.labels||[]).forEach(function(lbl){
      if(lbl&&lbl!=='agent-reported'){ row.appendChild(el('span','issue-lbl',lbl)); }
    });
    row.onclick=function(){ loadIssueDetail(iss.number); };
    container.appendChild(row);
  });
}

async function loadIssueDetail(number){
  var data=await getJSON('/api/issues/'+number);
  var box=document.getElementById('issue-detail');
  if(!data||data.degraded){ box.style.display='none'; return; }
  // XSS-safe: all fields via textContent; body in a <pre>.
  var meta=document.getElementById('issue-detail-meta');
  meta.textContent='#'+data.number+' · '+data.state+' · '+data.commentCount+' comment(s)';
  var link=document.getElementById('issue-detail-link');
  link.textContent='Open on GitHub ↗';
  link.setAttribute('href', data.url||'#');
  document.getElementById('issue-detail-body').textContent=data.body||'(no body)';
  box.style.display='block';
}

async function loadIssues(){
  var openEl=document.getElementById('issues-open'); openEl.innerHTML='';
  var resolvedEl=document.getElementById('issues-resolved'); resolvedEl.innerHTML='';
  var data=await getJSON('/api/issues');
  if(!data){ return; }
  if(data.degraded){
    openEl.appendChild(el('div','degraded',data.degraded));
    resolvedEl.appendChild(el('div','degraded',data.degraded));
    return;
  }
  renderIssueList(data.open||[], openEl);
  renderIssueList(data.resolved||[], resolvedEl);
}

// v26 (DES-186, ARCH-120, ADR-044, TASK-191, REQ-129/REQ-119): wheel-zoom + drag-pan + fit for ONE
// .zoomable wrapper (shared by both the run DAG svg and the author's diagram img, ADR-044's own
// "no library" call — ~40 lines). The transform lives on 'el' (the WRAPPER) — el's own CHILDREN are
// rebuilt wholesale by renderGraph() every 3s poll and by renderDiagram()'s img.src swap, so this
// never touches them: a user's zoom survives both. fit() resets to identity, called on load, on the
// fit button, and on window resize (a viewBox recompute alone does NOT re-fit — only these three do).
function initZoomable(el, fitBtn){
  var scale=1, tx=0, ty=0;
  function apply(){ el.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')'; }
  function fit(){ scale=1; tx=0; ty=0; apply(); }
  el.addEventListener('wheel', function(e){
    e.preventDefault();
    var rect=el.getBoundingClientRect();
    var mx=e.clientX-rect.left, my=e.clientY-rect.top;
    var next=Math.min(4, Math.max(0.25, scale*(e.deltaY<0?1.1:0.9)));
    tx=mx-(mx-tx)*(next/scale); ty=my-(my-ty)*(next/scale);
    scale=next; apply();
  }, {passive:false});
  var dragging=false, sx=0, sy=0, stx=0, sty=0;
  el.addEventListener('mousedown', function(e){ dragging=true; sx=e.clientX; sy=e.clientY; stx=tx; sty=ty; });
  window.addEventListener('mousemove', function(e){ if(!dragging) return; tx=stx+(e.clientX-sx); ty=sty+(e.clientY-sy); apply(); });
  window.addEventListener('mouseup', function(){ dragging=false; });
  if(fitBtn) fitBtn.onclick=fit;
  window.addEventListener('resize', fit);
  fit();
}
initZoomable(document.getElementById('dag-zoom'), document.getElementById('dag-fit'));
initZoomable(document.getElementById('diagram-zoom'), document.getElementById('diagram-fit'));

async function render(){
  var runId=currentRunId();
  var issuesView=isIssuesView();
  if(runId||issuesView) currentWorkflowName=null;
  document.getElementById('home').style.display = (!runId&&!issuesView&&!currentWorkflowName)?'block':'none';
  document.getElementById('detail').style.display = ((runId||currentWorkflowName)&&!issuesView)?'block':'none';
  document.getElementById('issues').style.display = issuesView?'block':'none';
  if(issuesView){ await loadIssues(); }
  else if(runId){ await loadDag(runId); }
  else if(currentWorkflowName){ await renderDescribe(currentWorkflowName); }
  else { await loadHome(); }
}
render();
setInterval(render, 3000);
</script>
</body>
</html>
`;
