SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 将历史上手工加入生产库的支付与审核字段正式纳入迁移，脚本可重复执行。
SET @has_payment_aoid = (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'orders'
     AND column_name = 'payment_aoid'
);
SET @add_payment_aoid_sql = IF(
  @has_payment_aoid = 0,
  'ALTER TABLE orders ADD COLUMN payment_aoid VARCHAR(64) NULL AFTER rider_income',
  'SELECT 1'
);
PREPARE add_payment_aoid_statement FROM @add_payment_aoid_sql;
EXECUTE add_payment_aoid_statement;
DEALLOCATE PREPARE add_payment_aoid_statement;

ALTER TABLE orders
  MODIFY COLUMN status ENUM(
    'unpaid','waiting','accepted','picked','delivering','delivered','completed','cancelled','disputed'
  ) NOT NULL DEFAULT 'waiting';

SET @has_review_mode = (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'platform_settings'
     AND column_name = 'review_mode'
);
SET @add_review_mode_sql = IF(
  @has_review_mode = 0,
  'ALTER TABLE platform_settings ADD COLUMN review_mode TINYINT(1) NOT NULL DEFAULT 0 AFTER service_notice',
  'SELECT 1'
);
PREPARE add_review_mode_statement FROM @add_review_mode_sql;
EXECUTE add_review_mode_statement;
DEALLOCATE PREPARE add_review_mode_statement;
