const db = require('../db');
const { notifyRoles } = require('../utils/notify');
const { ROLES } = require('../middleware/auth');

const RETRY_LIMIT = 10;
const BATCH_SIZE = 20;

async function deliver(job) {
  const config = {
    email: ['EMAIL_API_URL', 'EMAIL_API_KEY'],
    sms: ['SMS_API_URL', 'SMS_API_KEY'],
    push: ['PUSH_API_URL', 'PUSH_API_KEY']
  }[job.channel];
  const [urlKey, tokenKey] = config;
  const endpoint = process.env[urlKey];
  if (!endpoint) throw new Error(`${job.channel} delivery is not configured`);
  const headers = { 'content-type': 'application/json' };
  if (process.env[tokenKey]) headers.authorization = `Bearer ${process.env[tokenKey]}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ channel: job.channel, to: job.recipient, ...job.payload }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`${job.channel} provider returned HTTP ${response.status}`);
}

async function drainNotificationQueue() {
  const { rows } = await db.query(
    `WITH ready AS (
       SELECT id FROM notification_queue
        WHERE (status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP)
           OR (status = 'processing' AND created_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
        ORDER BY next_attempt_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
     )
     UPDATE notification_queue q
        SET status = 'processing'
       FROM ready
      WHERE q.id = ready.id
      RETURNING q.id, q.channel, q.recipient, q.payload, q.attempts`,
    [BATCH_SIZE]
  );

  for (const job of rows) {
    try {
      await deliver(job);
      await db.query(
        `UPDATE notification_queue
            SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
                attempts = attempts + 1, last_error = NULL
          WHERE id = $1`,
        [job.id]
      );
    } catch (err) {
      const attempts = job.attempts + 1;
      const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
      await db.query(
        `UPDATE notification_queue
            SET status = CASE WHEN $2 >= $3 THEN 'failed' ELSE 'pending' END,
                attempts = $2,
                next_attempt_at = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 minute'),
                last_error = $5
          WHERE id = $1`,
        [job.id, attempts, RETRY_LIMIT, delayMinutes, String(err.message).slice(0, 1000)]
      );
    }
  }
}

async function repeatUnacknowledgedAlerts() {
  const { rows } = await db.query(
    `UPDATE emergency_alerts
        SET last_repeated_at = CURRENT_TIMESTAMP,
            repeat_count = repeat_count + 1
      WHERE status = 'Triggered'
        AND COALESCE(last_repeated_at, triggered_at) <= CURRENT_TIMESTAMP - INTERVAL '1 minute'
      RETURNING id, user_id, lat, lng, message, repeat_count`
  );
  for (const alert of rows) {
    const position = alert.lat == null || alert.lng == null
      ? 'Location is unknown.'
      : `Location: ${alert.lat}, ${alert.lng}.`;
    await notifyRoles(
      [ROLES.ADMIN, ROLES.HEAD_OF_SECURITY, ROLES.SECURITY_OFFICER],
      'UNACKNOWLEDGED EMERGENCY ALERT',
      `Emergency alert #${alert.id} remains unacknowledged. ${position}`,
      'emergency',
      `/emergency/${alert.id}`
    );
  }
}

async function detectMissedPatrolCheckpoints() {
  const { rows } = await db.query(
    `INSERT INTO patrol_missed_alerts (roster_id, checkpoint_id)
     SELECT d.id, c.id
       FROM duty_rosters d
       JOIN route_checkpoints rc ON rc.route_id = d.route_id
       JOIN checkpoints c ON c.id = rc.checkpoint_id
      WHERE d.end_at < CURRENT_TIMESTAMP
        AND NOT EXISTS (
          SELECT 1 FROM patrol_logs p
           WHERE p.officer_id = d.officer_id
             AND p.checkpoint_id = c.id
             AND p.scanned_at BETWEEN d.start_at AND d.end_at
        )
     ON CONFLICT (roster_id, checkpoint_id) DO NOTHING
     RETURNING roster_id, checkpoint_id`
  );
  if (rows.length) {
    await notifyRoles(
      [ROLES.ADMIN, ROLES.HEAD_OF_SECURITY],
      'Missed patrol checkpoints',
      `${rows.length} patrol checkpoint(s) were not scanned during a completed shift.`,
      'patrol',
      '/dashboard.html#patrol'
    );
  }
}

let timer;
let running = false;

async function runOnce() {
  if (running) return;
  running = true;
  try {
    await Promise.all([
      drainNotificationQueue(),
      repeatUnacknowledgedAlerts(),
      detectMissedPatrolCheckpoints()
    ]);
  } catch (err) {
    console.error('Background worker cycle failed:', err.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(runOnce, Number(process.env.BACKGROUND_WORKER_INTERVAL_MS) || 10000);
  timer.unref();
  void runOnce();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce, drainNotificationQueue };
