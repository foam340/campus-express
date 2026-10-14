-- 回滚双校区后端改造（第二部分）。
-- ⚠️ 会销毁 campus_change_requests 全部数据（不可恢复），并丢失 orders.address / pickup_station、
--    riders.email 等新列里已写入的值。仅用于回退，勿在生产无备份时执行。

SET NAMES utf8mb4;
SET time_zone = '+00:00';

DROP TABLE IF EXISTS campus_change_requests;

ALTER TABLE orders
  DROP COLUMN pickup_station,
  DROP COLUMN address,
  DROP COLUMN campus;

ALTER TABLE riders
  DROP COLUMN email,
  DROP COLUMN campus;

ALTER TABLE rider_applications
  DROP COLUMN campus;

ALTER TABLE admin_users
  DROP COLUMN campus;

ALTER TABLE ledger_entries
  DROP COLUMN campus;
