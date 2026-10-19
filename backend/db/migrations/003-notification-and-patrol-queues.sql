-- Durable outbound notification queue and deduplicated missed-patrol alerts.
ALTER TABLE emergency_alerts
  ADD COLUMN IF NOT EXISTS last_repeated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS repeat_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS notification_queue (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
  recipient TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_ready
  ON notification_queue (next_attempt_at, id)
  WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS patrol_missed_alerts (
  roster_id INTEGER NOT NULL REFERENCES duty_rosters(id) ON DELETE CASCADE,
  checkpoint_id INTEGER NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (roster_id, checkpoint_id)
);

INSERT INTO schema_migrations (version)
VALUES ('003-notification-and-patrol-queues')
ON CONFLICT (version) DO NOTHING;
