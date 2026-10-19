const db = require('../db');
const crypto = require('crypto');
const webpush = require('web-push');
const appConfig = require('../config');
const { notifyRoles, notifyOnDutyOfficers } = require('../utils/notify');
const { ROLES } = require('../middleware/auth');

const RETRY_LIMIT = 10;
const BATCH_SIZE = 20;

async function deliver(job) {
  let payload = job.payload;
  if (payload?.encrypted) {
    const key = crypto.createHash('sha256').update(appConfig.jwtSecret).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    payload = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()
    ]).toString('utf8'));
  }
  if (job.channel === 'push' && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:security@rp.ac.rw',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    try {
      await webpush.sendNotification({
        endpoint: job.recipient,
        keys: payload.keys
      }, JSON.stringify({
        title: payload.title,
        message: payload.message,
        type: payload.type,
        link: payload.link
      }), {
        TTL: 3600,
        urgency: payload.type === 'emergency' ? 'high' : 'normal'
      });
      return;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [job.recipient]);
      }
      throw err;
    }
  }
  const config = {
    email: ['EMAIL_API_URL', 'EMAIL_API_KEY'],
    sms: ['SMS_API_URL', 'SMS_API_KEY'],
    push: ['PUSH_API_URL', 'PUSH_API_KEY']
  }[job.channel];
  const [urlKey, tokenKey] = config;
  const endpoint = process.env[urlKey];
  if (!endpoint && process.env.NODE_ENV !== 'production') {
    if (payload.sensitive) {
      console.log(`[CSRS DEV ONLY ${job.channel} fake] ${job.recipient}: ${payload.message}`);
      return;
    }
    console.log(`[CSRS ${job.channel} fake] ${job.recipient}: ${job.payload.title} — ${job.payload.message}`);
    return;
  }
  if (!endpoint) throw new Error(`${job.channel} delivery is not configured`);
  const headers = { 'content-type': 'application/json' };
  if (process.env[tokenKey]) headers.authorization = `Bearer ${process.env[tokenKey]}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ channel: job.channel, to: job.recipient, ...payload }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`${job.channel} provider returned HTTP ${response.status}`);
}

async function drainNotificationQueue() {
  const { rows } = await db.query(
    `WITH ready AS (
       SELECT id FROM notification_queue
        WHERE (status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP)
           OR (status = 'processing' AND locked_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
        ORDER BY next_attempt_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
     )
     UPDATE notification_queue q
        SET status = 'processing', locked_at = CURRENT_TIMESTAMP
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
            SET status = 'sent', sent_at = CURRENT_TIMESTAMP, locked_at = NULL,
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
                locked_at = NULL,
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
    const senderResult = await db.query(
      'SELECT full_name, phone, username FROM users WHERE id = $1',
      [alert.user_id]
    );
    const sender = senderResult.rows[0];
    const senderDetails = sender
      ? `From ${sender.full_name || sender.username}.${sender.phone ? ` Phone: ${sender.phone}.` : ' Phone number is not recorded.'}`
      : 'Sender details are unavailable.';
    const position = alert.lat == null || alert.lng == null
      ? 'Location is unknown.'
      : `Location: ${alert.lat}, ${alert.lng}.`;
    await notifyRoles(
      [ROLES.ADMIN, ROLES.HEAD_OF_SECURITY],
      'UNACKNOWLEDGED EMERGENCY ALERT',
      `Emergency alert #${alert.id} remains unacknowledged. ${senderDetails} ${position}`,
      'emergency',
      `/emergency/${alert.id}`
    );
    await notifyOnDutyOfficers(
      'UNACKNOWLEDGED EMERGENCY ALERT',
      `Emergency alert #${alert.id} remains unacknowledged. ${senderDetails} ${position}`,
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
  const pending = await db.query(
    `SELECT roster_id, checkpoint_id FROM patrol_missed_alerts WHERE notified_at IS NULL`
  );
  if (pending.rows.length) {
    await notifyRoles(
      [ROLES.ADMIN, ROLES.HEAD_OF_SECURITY],
      'Missed patrol checkpoints',
      `${pending.rows.length} patrol checkpoint(s) were not scanned during a completed shift.`,
      'patrol',
      '/dashboard.html#patrol'
    );
    await db.query(
      `UPDATE patrol_missed_alerts p SET notified_at = CURRENT_TIMESTAMP
        FROM unnest($1::int[], $2::int[]) AS pending(roster_id, checkpoint_id)
       WHERE p.roster_id = pending.roster_id AND p.checkpoint_id = pending.checkpoint_id`,
      [pending.rows.map((row) => row.roster_id), pending.rows.map((row) => row.checkpoint_id)]
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
  timer = setInterval(runOnce, Number(process.env.BACKGROUND_WORKER_INTERVAL_MS) || 5000);
  timer.unref();
  void runOnce();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce, drainNotificationQueue };
