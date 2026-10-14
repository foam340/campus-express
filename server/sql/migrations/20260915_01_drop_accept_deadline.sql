-- 2026-09-15：停用「20:30 无人接单自动取消」后，orders.accept_deadline_at 不再被任何代码写入或读取，
-- 索引 idx_orders_status_accept_deadline 也随之成为死索引。删除二者。
-- 生产库执行前已用 mysqldump 备份 orders 表。
ALTER TABLE orders DROP INDEX idx_orders_status_accept_deadline;
ALTER TABLE orders DROP COLUMN accept_deadline_at;
