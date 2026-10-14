SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 小程序现支持 1-8栋、25号楼和 A-H栋；数据库保存规范化楼栋代码“25”。
ALTER TABLE users
  MODIFY COLUMN building VARCHAR(4) NOT NULL DEFAULT '1';

ALTER TABLE orders
  MODIFY COLUMN building VARCHAR(4) NOT NULL;

SET @has_status_deadline_index = (
  SELECT COUNT(*)
    FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'orders'
     AND index_name = 'idx_orders_status_deadline'
);
SET @add_status_deadline_index_sql = IF(
  @has_status_deadline_index = 0,
  'ALTER TABLE orders ADD INDEX idx_orders_status_deadline (status, deadline_at)',
  'SELECT 1'
);
PREPARE add_status_deadline_index_statement FROM @add_status_deadline_index_sql;
EXECUTE add_status_deadline_index_statement;
DEALLOCATE PREPARE add_status_deadline_index_statement;
