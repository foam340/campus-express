-- 双校区后端改造（第二部分）：orders/riders/rider_applications/admin_users/ledger_entries 加 campus 列，
-- 建 campus_change_requests 表。
-- ⚠️ 一次性迁移，别重复跑（MySQL 5.7 的 ALTER ADD COLUMN 无 IF NOT EXISTS）。
-- ⚠️ 第一部分 20260923_01_campus_expansion.sql 已在生产执行过，别重复跑。

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE orders
  ADD COLUMN campus VARCHAR(16) NOT NULL DEFAULT 'nanhai',
  ADD COLUMN address VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN pickup_station ENUM('south','west') NULL;

ALTER TABLE riders
  ADD COLUMN campus VARCHAR(16) NOT NULL DEFAULT 'nanhai',
  ADD COLUMN email VARCHAR(128) NULL;

ALTER TABLE rider_applications
  ADD COLUMN campus VARCHAR(16) NOT NULL DEFAULT 'nanhai';

ALTER TABLE admin_users
  ADD COLUMN campus VARCHAR(16) NULL;

-- 账目按校区隔离（2026-09-24 拍板）：ledger_entries 也加 campus 列。
ALTER TABLE ledger_entries
  ADD COLUMN campus VARCHAR(16) NOT NULL DEFAULT 'nanhai';

-- 回填：所有既有管理账号先归 nanhai；老板账号需在部署时单独置 NULL（campus=NULL=可看全部校区）。
-- 部署时先确认老板账号再执行：
--   SELECT id, username, display_name, roles_json FROM admin_users;
--   UPDATE admin_users SET campus = NULL WHERE id = <老板账号 id>;
UPDATE admin_users SET campus = 'nanhai' WHERE campus IS NULL;

CREATE TABLE IF NOT EXISTS campus_change_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  from_campus VARCHAR(16) NOT NULL,
  to_campus VARCHAR(16) NOT NULL,
  reason VARCHAR(300) NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT UNSIGNED NULL,
  review_reason VARCHAR(300) NOT NULL DEFAULT '',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_campus_change_user (user_id, status),
  KEY idx_campus_change_status_submitted (status, submitted_at),
  CONSTRAINT fk_campus_change_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_campus_change_admin FOREIGN KEY (reviewed_by) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
