SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @has_experience_points = (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'riders'
     AND column_name = 'experience_points'
);
SET @add_experience_points_sql = IF(
  @has_experience_points = 0,
  'ALTER TABLE riders ADD COLUMN experience_points INT UNSIGNED NOT NULL DEFAULT 0 AFTER history_overtimes',
  'SELECT 1'
);
PREPARE add_experience_points_statement FROM @add_experience_points_sql;
EXECUTE add_experience_points_statement;
DEALLOCATE PREPARE add_experience_points_statement;

CREATE TABLE IF NOT EXISTS rider_experience_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rider_id BIGINT UNSIGNED NOT NULL,
  order_id VARCHAR(32) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  points SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rider_experience_order_type (order_id, event_type),
  KEY idx_rider_experience_rider_created (rider_id, created_at),
  CONSTRAINT fk_rider_experience_rider FOREIGN KEY (rider_id) REFERENCES riders(id),
  CONSTRAINT fk_rider_experience_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_rider_experience_started_at = (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'platform_settings'
     AND column_name = 'rider_experience_started_at'
);
SET @add_rider_experience_started_at_sql = IF(
  @has_rider_experience_started_at = 0,
  'ALTER TABLE platform_settings ADD COLUMN rider_experience_started_at DATETIME NULL AFTER review_mode',
  'SELECT 1'
);
PREPARE add_rider_experience_started_at_statement FROM @add_rider_experience_started_at_sql;
EXECUTE add_rider_experience_started_at_statement;
DEALLOCATE PREPARE add_rider_experience_started_at_statement;

-- 只允许启用时刻之后创建的订单累计经验，不回填历史订单。
UPDATE platform_settings
   SET rider_experience_started_at = COALESCE(rider_experience_started_at, UTC_TIMESTAMP())
 WHERE id = 1;
