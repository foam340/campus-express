SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(64) NULL,
  unionid VARCHAR(64) NULL,
  nickname VARCHAR(80) NOT NULL DEFAULT '',
  phone VARCHAR(20) NOT NULL,
  building VARCHAR(16) NOT NULL DEFAULT '1',
  room VARCHAR(50) NOT NULL DEFAULT '',
  campus VARCHAR(16) NOT NULL DEFAULT 'nanhai',
  address VARCHAR(200) NOT NULL DEFAULT '',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_openid (openid),
  KEY idx_users_phone (phone),
  KEY idx_users_status_created (status, created_at),
  KEY idx_users_campus (campus)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  roles_json TEXT NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  campus VARCHAR(16) NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_users_username (username),
  KEY idx_admin_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rider_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  name VARCHAR(80) NOT NULL,
  real_name VARCHAR(40) NULL,
  student_id VARCHAR(40) NOT NULL,
  gender ENUM('male','female') NULL,
  phone VARCHAR(20) NOT NULL,
  rules_version VARCHAR(32) NOT NULL,
  campus VARCHAR(16) NOT NULL DEFAULT 'nanhai',
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  review_reason VARCHAR(300) NOT NULL DEFAULT '',
  reviewed_by BIGINT UNSIGNED NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rider_applications_status_submitted (status, submitted_at),
  KEY idx_rider_applications_phone (phone),
  CONSTRAINT fk_rider_applications_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_rider_applications_admin FOREIGN KEY (reviewed_by) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS riders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  application_id BIGINT UNSIGNED NULL,
  name VARCHAR(80) NOT NULL,
  name_note VARCHAR(40) NULL,
  gender ENUM('male','female') NULL,
  student_id VARCHAR(40) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  campus VARCHAR(16) NOT NULL DEFAULT 'nanhai',
  email VARCHAR(128) NULL,
  status ENUM('approved','suspended') NOT NULL DEFAULT 'approved',
  valid_overtimes INT UNSIGNED NOT NULL DEFAULT 0,
  history_overtimes INT UNSIGNED NOT NULL DEFAULT 0,
  experience_points INT UNSIGNED NOT NULL DEFAULT 0,
  available_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
  frozen_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_riders_user (user_id),
  UNIQUE KEY uk_riders_phone (phone),
  UNIQUE KEY uk_riders_application (application_id),
  KEY idx_riders_status (status),
  CONSTRAINT fk_riders_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_riders_application FOREIGN KEY (application_id) REFERENCES rider_applications(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rider_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rider_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  valid_overtimes_before INT UNSIGNED NOT NULL DEFAULT 0,
  valid_overtimes_after INT UNSIGNED NOT NULL DEFAULT 0,
  reason VARCHAR(300) NOT NULL DEFAULT '',
  operator_admin_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rider_events_rider_created (rider_id, created_at),
  CONSTRAINT fk_rider_events_rider FOREIGN KEY (rider_id) REFERENCES riders(id),
  CONSTRAINT fk_rider_events_admin FOREIGN KEY (operator_admin_id) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupon_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  min_spend DECIMAL(10,2) NOT NULL DEFAULT 0,
  valid_days INT UNSIGNED NOT NULL,
  scope ENUM('single','all','new_user') NOT NULL,
  campus VARCHAR(16) NULL COMMENT '券活动所属校区，NULL=全校区通用',
  issued_count INT UNSIGNED NOT NULL DEFAULT 0,
  used_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('running','ended') NOT NULL DEFAULT 'running',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_coupon_campaigns_status_created (status, created_at),
  CONSTRAINT fk_coupon_campaigns_admin FOREIGN KEY (created_by) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_coupons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  campaign_id BIGINT UNSIGNED NULL,
  name VARCHAR(80) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  min_spend DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('available','used','expired','cancelled') NOT NULL DEFAULT 'available',
  campus VARCHAR(16) NULL COMMENT '用户券校区（领券时快照），NULL=全校区通用',
  expires_at DATETIME NOT NULL,
  used_order_id VARCHAR(32) NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_coupons_user_status_expiry (user_id, status, expires_at),
  KEY idx_user_coupons_campaign (campaign_id),
  CONSTRAINT fk_user_coupons_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_coupons_campaign FOREIGN KEY (campaign_id) REFERENCES coupon_campaigns(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupon_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code_hash CHAR(64) NOT NULL,
  code_hint CHAR(4) NOT NULL,
  name VARCHAR(80) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  min_spend DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('available','redeemed','expired','disabled') NOT NULL DEFAULT 'available',
  campus VARCHAR(16) NULL COMMENT '兑换码所属校区，NULL=全校区通用',
  expires_at DATETIME NOT NULL,
  redeemed_by BIGINT UNSIGNED NULL,
  redeemed_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_coupon_codes_hash (code_hash),
  KEY idx_coupon_codes_status_expiry (status, expires_at),
  CONSTRAINT fk_coupon_codes_user FOREIGN KEY (redeemed_by) REFERENCES users(id),
  CONSTRAINT fk_coupon_codes_admin FOREIGN KEY (created_by) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  contact_name VARCHAR(80) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  building VARCHAR(16) NOT NULL,
  room VARCHAR(50) NOT NULL,
  campus VARCHAR(16) NOT NULL DEFAULT 'nanhai',
  address VARCHAR(200) NOT NULL DEFAULT '',
  pickup_station VARCHAR(16) NULL,
  pieces INT UNSIGNED NOT NULL DEFAULT 1,
  is_large TINYINT(1) NOT NULL DEFAULT 0,
  urgency ENUM('urgent','today','tomorrow','soon') NOT NULL,
  pickup_scope ENUM('campus','off_campus') NULL DEFAULT NULL,
  deadline_at DATETIME NULL,
  note VARCHAR(100) NOT NULL DEFAULT '',
  no_upstairs TINYINT(1) NOT NULL DEFAULT 0,
  pricing_model VARCHAR(20) NOT NULL DEFAULT 'legacy',
  pricing_version INT UNSIGNED NOT NULL DEFAULT 1,
  item_details_json LONGTEXT NULL,
  item_subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  bundle_discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  urgency_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  door_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  building_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  pickup_screenshot_url VARCHAR(500) NOT NULL DEFAULT '',
  delivery_photo_url VARCHAR(500) NOT NULL DEFAULT '',
  original_price DECIMAL(10,2) NOT NULL,
  coupon_discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(10,2) NOT NULL,
  rider_income DECIMAL(10,2) NOT NULL,
  withhold_rider_income TINYINT(1) NOT NULL DEFAULT 0,
  payment_aoid VARCHAR(64) NULL,
  payment_expires_at DATETIME NULL,
  rider_id BIGINT UNSIGNED NULL,
  status ENUM('unpaid','waiting','accepted','picked','delivering','delivered','completed','cancelled','disputed') NOT NULL DEFAULT 'waiting',
  accepted_at DATETIME NULL,
  delivered_at DATETIME NULL,
  completed_at DATETIME NULL,
  income_frozen_at DATETIME NULL,
  settled_at DATETIME NULL,
  withdrawn_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_orders_user_created (user_id, created_at),
  KEY idx_orders_rider_status (rider_id, status),
  KEY idx_orders_status_created (status, created_at),
  KEY idx_orders_status_deadline (status, deadline_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_orders_rider FOREIGN KEY (rider_id) REFERENCES riders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- 骑手转单流水。库里原本没有任何「订单–骑手历史关系」表，转单后无法追溯原骑手，故新建。
-- 这张表同时承担两道防滥用刹车：2 小时内不能接回自己转出的单（idx_order_transfers_rider_created），
-- 以及每日转单次数上限（TRANSFER_DAILY_LIMIT，见 mini.js）。
CREATE TABLE IF NOT EXISTS order_transfers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(32) NOT NULL,
  from_rider_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order_transfers_order (order_id),
  KEY idx_order_transfers_rider_created (from_rider_id, created_at),
  CONSTRAINT fk_order_transfers_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_transfers_rider FOREIGN KEY (from_rider_id) REFERENCES riders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS order_uploads (
  id CHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('pickup','delivery') NOT NULL,
  storage_path VARCHAR(600) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  status ENUM('uploaded','attached','deleted') NOT NULL DEFAULT 'uploaded',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order_uploads_user_status (user_id, status, created_at),
  CONSTRAINT fk_order_uploads_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(32) NOT NULL,
  upload_id CHAR(32) NOT NULL,
  kind ENUM('pickup','delivery') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_attachments_upload (upload_id),
  KEY idx_order_attachments_order_kind (order_id, kind),
  CONSTRAINT fk_order_attachments_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_attachments_upload FOREIGN KEY (upload_id) REFERENCES order_uploads(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS after_sales (
  id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32) NOT NULL,
  type VARCHAR(80) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  item_value DECIMAL(10,2) NOT NULL,
  claim_amount DECIMAL(10,2) NOT NULL,
  evidence_json TEXT NOT NULL,
  status ENUM('open','processing','resolved') NOT NULL DEFAULT 'open',
  resolution VARCHAR(500) NOT NULL DEFAULT '',
  compensation_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  resolved_by BIGINT UNSIGNED NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_after_sales_status_created (status, created_at),
  KEY idx_after_sales_order (order_id),
  CONSTRAINT fk_after_sales_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_after_sales_admin FOREIGN KEY (resolved_by) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feedbacks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  category ENUM('suggestion','problem','other') NOT NULL,
  content VARCHAR(500) NOT NULL,
  status ENUM('unread','read','resolved') NOT NULL DEFAULT 'unread',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_feedbacks_status_created (status, created_at),
  KEY idx_feedbacks_user_created (user_id, created_at),
  CONSTRAINT fk_feedbacks_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 校区变更申请：用户从南海转石牌（或反向）的审核流。详见 migrations/20260924_02_campus_expansion_backend.sql
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

-- 额外收支记账：管理台「净收入明细」页手工登记的订单外收支。详见 migrations/20260921_01_ledger_entries.sql
CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entry_date DATE NOT NULL,
  direction ENUM('income','expense') NOT NULL,
  category VARCHAR(32) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  campus VARCHAR(16) NOT NULL DEFAULT 'nanhai',
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ledger_entries_date (entry_date, id),
  KEY idx_ledger_entries_created (created_at),
  CONSTRAINT fk_ledger_entries_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id),
  CONSTRAINT fk_ledger_entries_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS withdrawals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rider_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('pending','paid','rejected') NOT NULL DEFAULT 'pending',
  reason VARCHAR(300) NOT NULL DEFAULT '',
  reviewed_by BIGINT UNSIGNED NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_withdrawals_status_requested (status, requested_at),
  KEY idx_withdrawals_rider_requested (rider_id, requested_at),
  CONSTRAINT fk_withdrawals_rider FOREIGN KEY (rider_id) REFERENCES riders(id),
  CONSTRAINT fk_withdrawals_admin FOREIGN KEY (reviewed_by) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_settings (
  id TINYINT UNSIGNED NOT NULL,
  campus VARCHAR(16) NOT NULL DEFAULT 'nanhai',
  close_time TIME NOT NULL,
  campus_price DECIMAL(10,2) NOT NULL DEFAULT 2.00,
  off_campus_price DECIMAL(10,2) NOT NULL DEFAULT 3.00,
  campus_urgent_price DECIMAL(10,2) NOT NULL DEFAULT 9.00,
  off_campus_urgent_price DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  extra_piece_price DECIMAL(10,2) NOT NULL,
  large_price DECIMAL(10,2) NOT NULL,
  item_pricing_version INT UNSIGNED NOT NULL DEFAULT 1,
  item_small_campus_price DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  item_small_off_campus_price DECIMAL(10,2) NOT NULL DEFAULT 2.00,
  item_medium_campus_price DECIMAL(10,2) NOT NULL DEFAULT 3.00,
  item_medium_off_campus_price DECIMAL(10,2) NOT NULL DEFAULT 4.00,
  item_large_campus_price DECIMAL(10,2) NOT NULL DEFAULT 5.00,
  item_large_off_campus_price DECIMAL(10,2) NOT NULL DEFAULT 6.00,
  item_urgent_fee DECIMAL(10,2) NOT NULL DEFAULT 5.00,
  item_door_fee DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  item_building_9_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  item_upper_floor_door_fee DECIMAL(10,2) NOT NULL DEFAULT 1.50,
  bundle_tier0_threshold DECIMAL(10,2) NOT NULL DEFAULT 5.00,
  bundle_tier0_discount DECIMAL(10,2) NOT NULL DEFAULT 0.50,
  bundle_tier1_threshold DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  bundle_tier1_discount DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  bundle_tier2_threshold DECIMAL(10,2) NOT NULL DEFAULT 20.00,
  bundle_tier2_discount DECIMAL(10,2) NOT NULL DEFAULT 3.00,
  auto_confirm_hours SMALLINT UNSIGNED NOT NULL,
  observation_hours SMALLINT UNSIGNED NOT NULL,
  claim_limit DECIMAL(10,2) NOT NULL,
  commission_rate DECIMAL(5,2) NOT NULL,
  service_status ENUM('open','closed') NOT NULL DEFAULT 'open',
  service_notice VARCHAR(200) NOT NULL DEFAULT '节假日小程序暂停服务，恢复时间另行通知',
  review_mode TINYINT(1) NOT NULL DEFAULT 0,
  rider_experience_started_at DATETIME NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_platform_settings_admin FOREIGN KEY (updated_by) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id BIGINT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  detail_json TEXT NOT NULL,
  request_id VARCHAR(64) NOT NULL DEFAULT '',
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_audit_admin_created (admin_id, created_at),
  KEY idx_admin_audit_target (target_type, target_id),
  CONSTRAINT fk_admin_audit_admin FOREIGN KEY (admin_id) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key_hash CHAR(64) NOT NULL,
  admin_id BIGINT UNSIGNED NOT NULL,
  method VARCHAR(10) NOT NULL,
  request_path VARCHAR(255) NOT NULL,
  response_status SMALLINT UNSIGNED NOT NULL,
  response_body MEDIUMTEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key_hash),
  KEY idx_idempotency_expiry (expires_at),
  CONSTRAINT fk_idempotency_admin FOREIGN KEY (admin_id) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 小程序侧的幂等键。结构与 idempotency_keys 相同，但主体是 mini 用户：
-- idempotency_keys.admin_id 的外键指向 admin_users，装不下 mini 用户 id。见 20260921_02 迁移。
CREATE TABLE IF NOT EXISTS mini_idempotency_keys (
  key_hash CHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  method VARCHAR(10) NOT NULL,
  request_path VARCHAR(255) NOT NULL,
  response_status SMALLINT UNSIGNED NOT NULL,
  response_body MEDIUMTEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key_hash),
  KEY idx_mini_idempotency_expiry (expires_at),
  CONSTRAINT fk_mini_idempotency_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_settings
  (id, close_time,
   campus_price, off_campus_price, campus_urgent_price, off_campus_urgent_price,
   extra_piece_price, large_price, item_pricing_version,
   item_small_campus_price, item_small_off_campus_price,
   item_medium_campus_price, item_medium_off_campus_price,
   item_large_campus_price, item_large_off_campus_price,
   item_urgent_fee, item_door_fee, item_building_9_fee, item_upper_floor_door_fee,
   bundle_tier0_threshold, bundle_tier0_discount,
   bundle_tier1_threshold, bundle_tier1_discount, bundle_tier2_threshold, bundle_tier2_discount,
   auto_confirm_hours, observation_hours, claim_limit,
   commission_rate, rider_experience_started_at, updated_by, created_at, updated_at)
VALUES
  (1, '23:00:00', 2.00, 3.00, 9.00, 10.00,
   1.50, 8.00, 1,
   1.00, 2.00, 3.00, 4.00, 5.00, 6.00,
   5.00, 1.00, 0.00, 1.50, 5.00, 0.50, 10.00, 1.00, 20.00, 3.00,
   12, 24, 200.00, 0.00,
   UTC_TIMESTAMP(), NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE id = VALUES(id);

-- 石牌校区 platform_settings 行（id=2）：照南海 id=1 种子整行复制，改 item_* 为石牌价。
-- 与迁移文件 20260923_01_campus_expansion.sql 的 INSERT…SELECT 语义一致（legacy/运营字段照抄南海）。
INSERT INTO platform_settings
  (id, campus, close_time,
   campus_price, off_campus_price, campus_urgent_price, off_campus_urgent_price,
   extra_piece_price, large_price, item_pricing_version,
   item_small_campus_price, item_small_off_campus_price,
   item_medium_campus_price, item_medium_off_campus_price,
   item_large_campus_price, item_large_off_campus_price,
   item_urgent_fee, item_door_fee, item_building_9_fee, item_upper_floor_door_fee,
   bundle_tier0_threshold, bundle_tier0_discount,
   bundle_tier1_threshold, bundle_tier1_discount, bundle_tier2_threshold, bundle_tier2_discount,
   auto_confirm_hours, observation_hours, claim_limit,
   commission_rate, rider_experience_started_at, updated_by, created_at, updated_at)
VALUES
  (2, 'shipai', '23:00:00', 2.00, 3.00, 9.00, 10.00,
   1.50, 8.00, 2,
   2.00, 2.00, 4.00, 4.00, 7.00, 7.00,
   4.00, 2.00, 0.00, 2.00, 5.00, 0.50, 10.00, 1.00, 20.00, 3.00,
   12, 24, 200.00, 0.00,
   UTC_TIMESTAMP(), NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE id = VALUES(id);
