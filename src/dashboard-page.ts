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
:root{--bg:#0f1419;--panel:#161c26;--panel2:#1a2029;--line:#2c3440;--ink:#d8e0ea;--muted:#8b97a6;--link:#4ea1ff}
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
.st-queued{color:#d29922}.st-running{color:#4ea1ff}.st-done,.st-completed{color:#3fb950}.st-failed{color:#f85149}.st-stopped,.st-suspended{color:#8b97a6}.st-interrupted{color:#d29922}
#tree{margin-top:6px}
.grp{border-left:2px solid var(--line);margin:6px 0 6px 4px;padding:2px 0 2px 12px}
.grp-h{font-size:12px;color:var(--muted);margin:4px 0}
.grp-h b{color:var(--ink);font-family:ui-monospace,Consolas,monospace}
.node{padding:5px 9px;margin:4px 0;background:var(--panel2);border:1px solid var(--line);border-radius:8px;font-size:12.5px;cursor:pointer;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.node:hover{border-color:var(--link)}
.node .dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:none}
.node .lbl{font-weight:600}.node .mdl{color:var(--muted);font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
.node .tok{color:var(--muted);font-size:11px;margin-left:auto}
.node .dur{color:var(--muted);font-size:11px}
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
    <h2>Registered workflows</h2>
    <div id="workflows" class="cards"></div>
    <h2>Runs</h2>
    <div id="runs" class="cards"></div>
  </section>
  <section id="detail" style="display:none">
    <p><a class="back" href="/dashboard">&larr; all runs</a></p>
    <h2>Run <span id="detail-runid"></span> <span id="detail-status" class="pill"></span></h2>
    <div id="phases"></div>
    <div id="tree"></div>
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

async function loadWorkflows(){
  var box=document.getElementById('workflows'); var list=await getJSON('/api/workflows')||[];
  box.innerHTML='';
  if(!list.length){ box.appendChild(el('div','empty','(none registered)')); return; }
  list.forEach(function(w){
    var c=el('div','card'); c.appendChild(el('div','t',w.name));
    if(w.description) c.appendChild(el('div','s',w.description)); // v9: purpose visible on the card
    c.appendChild(el('div','s','version '+w.version));
    c.onclick=function(){ showSkeleton(w.name); }; // v9: click → predicted DAG (inspect before reuse)
    box.appendChild(c);
  });
}
// v9 (REQ-062): a workflow's predicted static DAG — inspect its shape before deciding to reuse it.
async function showSkeleton(name){
  var s=await getJSON('/api/workflows/'+encodeURIComponent(name)+'/skeleton'); if(!s) return;
  var tree=document.getElementById('tree'); document.getElementById('home').style.display='none'; document.getElementById('detail').style.display='block';
  document.getElementById('detail-runid').textContent='workflow: '+name;
  var badge=document.getElementById('detail-status'); badge.textContent='skeleton (predicted)'; badge.className='pill';
  renderPhases([], ''); document.getElementById('transcript').textContent=s.description||'(no description)';
  tree.innerHTML='';
  var curGroup=null, groupBox=null;
  (s.skeleton||[]).forEach(function(n){
    if(n.kind==='agent' && n.parallel!=null){
      if(n.parallel!==curGroup){ curGroup=n.parallel; groupBox=el('div','grp'); groupBox.appendChild(el('div','grp-h','parallel group')); tree.appendChild(groupBox); }
    } else { curGroup=null; groupBox=null; }
    var label = n.kind==='phase' ? ('phase: '+(n.title||'')) : n.kind==='workflow' ? ('workflow: '+(n.workflow||'?')) : 'agent';
    var node=el('div','node'); node.appendChild(el('span','lbl',label));
    if(n.dynamic) node.appendChild(el('span','mdl','×? (dynamic)'));
    (groupBox||tree).appendChild(node);
  });
}
async function loadRuns(){
  var box=document.getElementById('runs'); var list=await getJSON('/api/runs')||[];
  box.innerHTML='';
  if(!list.length){ box.appendChild(el('div','empty','(no runs yet)')); return; }
  list.forEach(function(r){
    var c=el('div','card'); c.onclick=function(){ go(r.runId); };
    c.appendChild(el('div','t',r.runId));
    var s=el('div','s'); s.appendChild(el('span','st-'+r.status,r.status)); s.appendChild(document.createTextNode(' · '+(r.name||'(ad-hoc)'))); c.appendChild(s);
    box.appendChild(c);
  });
}

async function loadTranscript(runId, agentId, label){
  document.getElementById('tr-agent').textContent = label?('· '+label+' ('+agentId+')'):('· '+agentId);
  var ev=await getJSON('/api/runs/'+encodeURIComponent(runId)+'/agents/'+encodeURIComponent(agentId));
  document.getElementById('transcript').textContent = ev? JSON.stringify(ev,null,2) : '(no transcript)';
}

function renderAgent(runId, a){
  var n=el('div','node st-'+a.state); n.appendChild(el('span','dot'));
  n.appendChild(el('span','lbl',a.label||a.agentId));
  n.appendChild(el('span','mdl',a.model||'—'));
  n.appendChild(el('span','st-'+a.state,a.state));
  n.appendChild(el('span','tok',(a.tokens||0)+' tok'));
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
// Recursively render a DagNode. Root: agents + children directly. Composite: a labeled group.
function renderNode(runId, node, container){
  (node.agents||[]).forEach(function(a){ container.appendChild(renderAgent(runId,a)); });
  (node.children||[]).forEach(function(child){
    var g=el('div','grp'); var h=el('div','grp-h'); h.appendChild(document.createTextNode('workflow ')); var b=el('b',null,child.name||child.frame); h.appendChild(b); h.appendChild(document.createTextNode(' · depth '+child.depth)); g.appendChild(h);
    renderNode(runId, child, g); container.appendChild(g);
  });
}

async function loadDag(runId){
  document.getElementById('detail-runid').textContent=runId;
  var view=await getJSON('/api/runs/'+encodeURIComponent(runId));
  var status=view?view.status:'';
  var badge=document.getElementById('detail-status'); badge.textContent=status; badge.className='pill st-'+status;
  renderPhases((view&&view.phases)||[], status);
  var root=await getJSON('/api/runs/'+encodeURIComponent(runId)+'/dag');
  var tree=document.getElementById('tree'); tree.innerHTML='';
  if(!root){ tree.appendChild(el('div','empty','(run not found)')); return; }
  if(!(root.agents||[]).length && !(root.children||[]).length){ tree.appendChild(el('div','empty','(no agents yet)')); }
  renderNode(runId, root, tree);
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

async function render(){
  var runId=currentRunId();
  var issuesView=isIssuesView();
  document.getElementById('home').style.display = (!runId&&!issuesView)?'block':'none';
  document.getElementById('detail').style.display = (runId&&!issuesView)?'block':'none';
  document.getElementById('issues').style.display = issuesView?'block':'none';
  if(issuesView){ await loadIssues(); }
  else if(runId){ await loadDag(runId); }
  else { await loadWorkflows(); await loadRuns(); }
}
render();
setInterval(render, 3000);
</script>
</body>
</html>
`;
