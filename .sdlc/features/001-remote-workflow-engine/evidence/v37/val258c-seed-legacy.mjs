// VAL-258 part (c): seed a genuine pre-v24-shaped row directly into the on-disk store,
// replicating what `ALTER TABLE schedules ADD COLUMN claimedBy TEXT` (v24's own migration,
// scheduler.ts:207) leaves behind for every row that predates it: `workflow` set, `claimedBy`
// left at the column's SQL default (NULL) because the ALTER TABLE cannot retroactively fill it.
// NOT produced via SqliteSchedulerPort.create({workflow}) — that code path (scheduler.ts:307,
// `claimedBy: s.workflow ?? null`) is the store's OWN "born already claimed" compat write for a
// bind-at-creation call, which is a DIFFERENT shape (claimedBy DOES get set) from a true migrated
// ancient row (claimedBy stays NULL). The call-tool.ts:180-184 door that used to accept
// `workflow` on schedule_create/webhook_create is closed for new rows since v24 adjudication #8,
// so this shape can only be produced today by a direct write to the on-disk file — exactly how a
// real pre-v24 deployment's data looks after upgrading, not a mock of the SUT's own boundary.
import Database from '/home/user/Documents/remote-workflow/node_modules/better-sqlite3/lib/index.js';
import { randomUUID, randomBytes } from 'node:crypto';

const WORK_ROOT = '/tmp/claude-1000/-home-user-Documents-remote-workflow/496d7ce9-a92e-471e-b720-1913af7dbafb/scratchpad/workroot258';

const legacyScheduleId = randomUUID();
const legacyScheduleWf = 'val258-legacy-sched-wf';
{
  const db = new Database(`${WORK_ROOT}/schedules.db`);
  db.prepare(`
    INSERT INTO schedules (id, kind, workflow, claimedBy, createdBy, createdRemote, argsJson, cron, tz, at, enabled, nextFire, lastFire, lastRunId, lastError, refusalCount, lastRefusedAt, lastRefusalReason)
    VALUES (@id, 'once', @workflow, NULL, NULL, 0, NULL, NULL, NULL, @at, 0, @nextFire, NULL, NULL, NULL, 0, NULL, NULL)
  `).run({ id: legacyScheduleId, workflow: legacyScheduleWf, at: new Date(Date.now() - 5000).toISOString(), nextFire: Date.now() - 5000 });
  db.close();
  console.log('seeded legacy schedule row:', legacyScheduleId, 'bound to', legacyScheduleWf, '(workflow SET, claimedBy NULL — genuine pre-v24 shape)');
}

const legacyWebhookId = randomUUID();
const legacyWebhookWf = 'val258-legacy-hook-wf';
const legacySecret = randomBytes(32).toString('hex');
{
  const db = new Database(`${WORK_ROOT}/webhooks.db`);
  db.prepare(`
    INSERT INTO webhooks (id, workflow, createdBy, secret, enabled, createdAt, refusalCount, lastRefusedAt, lastRefusalReason, createdRemote)
    VALUES (@id, @workflow, NULL, @secret, 1, @createdAt, 0, NULL, NULL, 0)
  `).run({ id: legacyWebhookId, workflow: legacyWebhookWf, secret: legacySecret, createdAt: new Date().toISOString() });
  db.close();
  console.log('seeded legacy webhook row:', legacyWebhookId, 'bound to', legacyWebhookWf);
}

console.log(JSON.stringify({ legacyScheduleId, legacyScheduleWf, legacyWebhookId, legacyWebhookWf, legacySecret }));
