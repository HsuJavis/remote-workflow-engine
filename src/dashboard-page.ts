// Static browser dashboard page (DES-018 / D-V2V-2 / REQ-008, VAL-018 route-back): a minimal
// self-contained HTML/JS page served at GET /dashboard on the SAME server/port as /mcp and
// /api/runs* (server.ts's own single createHttpServer handler). One data model, two transports:
// this page's own client JS calls the SAME read-only /api/runs* JSON API (DES-018) the MCP
// tools/dashboard already share — never a parallel dashboard DTO. Client-side "SPA" routing:
// /dashboard/<runId> serves this exact same static page; the page's own JS reads the runId back
// out of location.pathname and drills in via fetch(), no server-side per-run render needed.
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Remote Workflow Engine — Dashboard</title>
<style>
body{font-family:-apple-system,Segoe UI,sans-serif;margin:0;background:#0f1419;color:#d8e0ea}
header{padding:16px 24px;border-bottom:1px solid #2c3440}
h1{font-size:18px;margin:0}
main{padding:20px 24px;max-width:1100px}
table{width:100%;border-collapse:collapse;margin-bottom:24px}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #2c3440;font-size:13px}
a{color:#4ea1ff}
#tree div{padding:4px 0 4px 12px;border-left:2px solid #2c3440;margin:4px 0;font-size:13px}
.state-queued{color:#d29922}.state-running{color:#4ea1ff}.state-done{color:#3fb950}.state-failed{color:#f85149}
pre{white-space:pre-wrap;background:#1a2029;padding:12px;border-radius:6px;max-height:320px;overflow:auto;font-size:12px}
</style>
</head>
<body>
<header><h1>Remote Workflow Engine — Live Dashboard</h1></header>
<main>
  <section id="run-list">
    <h2>Runs</h2>
    <table id="runs-table"><thead><tr><th>runId</th><th>status</th><th>workflow</th></tr></thead><tbody></tbody></table>
  </section>
  <section id="run-detail" style="display:none">
    <h2>Run <span id="detail-runid"></span></h2>
    <div id="tree"></div>
    <h3>Transcript</h3>
    <pre id="transcript">(select an agent above)</pre>
  </section>
</main>
<script>
function currentRunId() {
  var m = /^\\/dashboard\\/(.+)$/.exec(location.pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

async function loadRuns() {
  var res = await fetch('/api/runs');
  var runs = await res.json();
  var tbody = document.querySelector('#runs-table tbody');
  tbody.innerHTML = '';
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    var tr = document.createElement('tr');
    var idCell = document.createElement('td');
    var link = document.createElement('a');
    link.href = '/dashboard/' + encodeURIComponent(r.runId);
    link.textContent = r.runId;
    idCell.appendChild(link);
    var statusCell = document.createElement('td');
    statusCell.textContent = r.status;
    var nameCell = document.createElement('td');
    nameCell.textContent = r.name || '';
    tr.appendChild(idCell);
    tr.appendChild(statusCell);
    tr.appendChild(nameCell);
    tbody.appendChild(tr);
  }
}

async function loadTranscript(runId, agentId) {
  var res = await fetch('/api/runs/' + runId + '/agents/' + agentId);
  var events = await res.json();
  document.getElementById('transcript').textContent = JSON.stringify(events, null, 2);
}

async function loadRun(runId) {
  var res = await fetch('/api/runs/' + runId);
  var view = await res.json();
  document.getElementById('run-detail').style.display = 'block';
  document.getElementById('detail-runid').textContent = runId;
  var tree = document.getElementById('tree');
  tree.innerHTML = '';
  var agents = (view && view.agents) || [];
  for (var i = 0; i < agents.length; i++) {
    var a = agents[i];
    var tokens = a.tokens ? (a.tokens.input + a.tokens.output) : 0;
    var div = document.createElement('div');
    div.className = 'state-' + a.state;
    div.textContent = 'agentId=' + a.agentId + ' state=' + a.state + ' tokens=' + tokens;
    div.onclick = (function (agentId) { return function () { loadTranscript(runId, agentId); }; })(a.agentId);
    tree.appendChild(div);
  }
}

async function refresh() {
  await loadRuns();
  var runId = currentRunId();
  if (runId) await loadRun(runId);
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>
`;
