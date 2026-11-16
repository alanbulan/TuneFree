-- 推荐刷新调度状态：保存偏好失效时间和云端尝试时间，重启不重置请求冷却。
CREATE TABLE IF NOT EXISTS recommendation_refresh_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  preference_changed_at INTEGER NOT NULL DEFAULT 0,
  cloud_attempted_at INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO recommendation_refresh_state (id) VALUES (1);
