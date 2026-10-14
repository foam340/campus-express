SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 「不划给骑手」标记：骑手临时有事由管理员代拿时，阻止该单骑手收入划入骑手余额。
-- 默认 0（正常划给骑手）；置 1 后 mini 端冻结/结算、用户确认收货立即冻结、
-- 管理台 convert-completed 均跳过该单收入，钱留在平台、不入任何骑手余额。

SET @has_withhold = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'orders'
    AND column_name = 'withhold_rider_income'
);
SET @add_withhold_sql = IF(@has_withhold = 0,
  'ALTER TABLE orders ADD COLUMN withhold_rider_income TINYINT(1) NOT NULL DEFAULT 0 AFTER rider_income',
  'SELECT 1');
PREPARE s FROM @add_withhold_sql; EXECUTE s; DEALLOCATE PREPARE s;
