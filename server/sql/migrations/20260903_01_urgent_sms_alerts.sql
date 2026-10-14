SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS order_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(32) NOT NULL,
  notification_type VARCHAR(40) NOT NULL,
  status ENUM('pending','processing','sent','skipped','retryable','unknown','failed') NOT NULL DEFAULT 'pending',
  due_at DATETIME NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NULL,
  processing_started_at DATETIME NULL,
  provider_request_id VARCHAR(128) NOT NULL DEFAULT '',
  provider_biz_id VARCHAR(128) NOT NULL DEFAULT '',
  last_error VARCHAR(500) NOT NULL DEFAULT '',
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_notifications_order_type (order_id, notification_type),
  KEY idx_order_notifications_due (notification_type, status, due_at, next_attempt_at),
  CONSTRAINT fk_order_notifications_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 历史迁移文件名保留不变；表结构与供应商无关，不回填已有订单。
-- 邮件启用后，实付订单由有效支付回调创建任务，0元免支付订单在创建后直接创建任务。
