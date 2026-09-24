import Database from '/home/user/Documents/remote-workflow/node_modules/better-sqlite3/lib/index.js';

const WORK_ROOT = '/tmp/claude-1000/-home-user-Documents-remote-workflow/496d7ce9-a92e-471e-b720-1913af7dbafb/scratchpad/workroot258';

console.log('--- (8c) SQL form, schedules: WHERE workflow IS NOT NULL AND claimedBy IS NULL ---');
{
  const db = new Database(`${WORK_ROOT}/schedules.db`, { readonly: true });
  const rows = db.prepare('SELECT id, workflow FROM schedules WHERE workflow IS NOT NULL AND claimedBy IS NULL').all();
  console.log(JSON.stringify(rows, null, 2));
  db.close();
}

console.log('--- (8c) SQL form, webhooks: ATTACH catalog.db, NOT EXISTS json_each over workflow_versions.triggers ---');
{
  const db = new Database(`${WORK_ROOT}/webhooks.db`, { readonly: true });
  db.exec(`ATTACH '${WORK_ROOT}/catalog.db' AS cat`);
  const rows = db.prepare(`
    SELECT w.id, w.workflow FROM webhooks w
    WHERE w.workflow IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM cat.workflow_versions v, json_each(v.triggers) t
        WHERE v.name = w.workflow AND t.value = w.id
      )
  `).all();
  console.log(JSON.stringify(rows, null, 2));
  db.close();
}

console.log('--- cross-check: workflow_versions.triggers raw column for both legacy workflow names ---');
{
  const db = new Database(`${WORK_ROOT}/catalog.db`, { readonly: true });
  const rows = db.prepare(`SELECT name, version, triggers FROM workflow_versions WHERE name IN ('val258-legacy-sched-wf','val258-legacy-hook-wf')`).all();
  console.log(JSON.stringify(rows, null, 2));
  db.close();
}
