SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 将本地未支付清理时间与 XorPay 二维码的 10 分钟有效期绑定。
SET @has_payment_expires_at = (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'orders'
     AND column_name = 'payment_expires_at'
);
SET @add_payment_expires_at_sql = IF(
  @has_payment_expires_at = 0,
  'ALTER TABLE orders ADD COLUMN payment_expires_at DATETIME NULL AFTER payment_aoid',
  'SELECT 1'
);
PREPARE add_payment_expires_at_statement FROM @add_payment_expires_at_sql;
EXECUTE add_payment_expires_at_statement;
DEALLOCATE PREPARE add_payment_expires_at_statement;

-- 退款是订单履约状态之外的独立资金流程。唯一订单号与唯一平台订单号用于防止重复退款任务。
CREATE TABLE IF NOT EXISTS order_refunds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(32) NOT NULL,
  payment_aoid VARCHAR(64) NULL,
  amount DECIMAL(10,2) NOT NULL,
  reason VARCHAR(40) NOT NULL,
  status ENUM('pending','processing','succeeded','retryable','manual_review') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NOT NULL DEFAULT '',
  next_retry_at DATETIME NULL,
  processing_started_at DATETIME NULL,
  succeeded_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_refunds_order (order_id),
  UNIQUE KEY uk_order_refunds_aoid (payment_aoid),
  KEY idx_order_refunds_status_retry (status, next_retry_at),
  CONSTRAINT fk_order_refunds_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
